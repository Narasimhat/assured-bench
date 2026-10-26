import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeClonalScreeningPower, computeQcPredictionCalibration, computeWetLabGenotypingAssay, wilsonInterval, runBiomniCoScientist } from "../src/services/biomniAgent.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIPK2A = fs.readFileSync(path.join(HERE, "..", "public", "references", "dipk2a-region.gb"), "utf8");
const atLeastTwo = (p, n) => 1 - (1 - p) ** n - n * p * (1 - p) ** (n - 1);

test("screening power: delivery x L^2 (delivery is per cell, LoF per allele), not (delivery x L)^2", () => {
  const r = computeClonalScreeningPower({ editType: "ko", weakerGuideLofPct: 90.4, deliveryEfficiency: 0.8 });
  assert.equal(r.predictedBiallelicClonePct, Math.round(0.8 * 0.904 ** 2 * 1000) / 10); // 65.4
  assert.notEqual(r.predictedBiallelicClonePct, Math.round((0.8 * 0.904) ** 2 * 1000) / 10); // the old 52.3
  const p = r.predictedBiallelicClonePct / 100;
  // smallest n with P(>=2 biallelic clones) >= 95%, computed independently here
  let n = 2; while (atLeastTwo(0.8 * 0.904 ** 2, n) < 0.95) n += 1;
  assert.equal(r.recommendedClonesToScreen, n); assert.ok(atLeastTwo(0.8 * 0.904 ** 2, n - 1) < 0.95 && p > 0);
  assert.equal(r.plates96Well, Math.ceil(n / 96));
  assert.ok(r.assumptions.length >= 4 && r.assumptions.some((a) => /80%/.test(a)));
});

test("screening power: no predicted LoF means no number (the old code used 80%), and knock-ins are not modelled (the old code used a 0.32 HDR rate)", () => {
  for (const args of [{ editType: "ko" }, { editType: "ko", weakerGuideLofPct: null }, { editType: "ko", weakerGuideLofPct: 0 }, { editType: "ko", weakerGuideLofPct: 85, deliveryEfficiency: 0 }]) {
    const r = computeClonalScreeningPower(args); assert.equal(r.ok, false); assert.ok(r.reason); assert.equal(r.predictedBiallelicClonePct, undefined);
  }
  for (const editType of ["pm", "ct", "nt", "it"]) { const r = computeClonalScreeningPower({ editType, weakerGuideLofPct: 85 }); assert.equal(r.ok, false); assert.match(r.reason, /Not modelled/); }
});

test("screening power: a very low yield is reported as out of range, not clamped to 1% or 192 clones", () => {
  const r = computeClonalScreeningPower({ editType: "ko", weakerGuideLofPct: 5, deliveryEfficiency: 0.5 });
  assert.equal(r.ok, true); assert.equal(r.recommendedClonesToScreen, null); assert.match(r.note, /More than 1536 clones/); assert.equal(r.predictedBiallelicClonePct, 0.1);
});

test("end to end on DIPK2A: the estimate uses the selected pair's weaker guide (75.2% for the default pair), not the top-ranked candidate", async () => {
  const res = await runBiomniCoScientist("Design a biallelic knockout for DIPK2A and rank exon guides with Lindel", { id: "p", gene: "DIPK2A", genbankRaw: DIPK2A, options: { enzyme: "spcas9" } }, { fetchFn: async () => ({ ok: false, status: 404 }) });
  const out = res.designResult.koAssessment.outcomes;
  assert.equal(res.screeningPower.ok, true);
  assert.equal(res.screeningPower.weakerGuideLofPct, out.minLofPct);
  assert.equal(res.screeningPower.weakerGuideLofPct, Math.min(...out.guides.map((g) => g.lofPct)));
  assert.equal(res.screeningPower.predictedBiallelicClonePct, Math.round(0.8 * (out.minLofPct / 100) ** 2 * 1000) / 10);
  // the genotyping assay lists the primers the design reports
  assert.equal(res.genotypingAssay.forwardPrimer, res.designResult.ps[0].s); assert.equal(res.genotypingAssay.reversePrimer, res.designResult.ps[1].s);
  assert.equal(res.genotypingAssay.wtAmpliconBp - res.genotypingAssay.editedAmpliconBp, res.genotypingAssay.deletionBp);
});

test("Wilson interval", () => {
  assert.deepEqual(wilsonInterval(2, 4), [15, 85]);
  assert.deepEqual(wilsonInterval(0, 0), null);
  const [lo, hi] = wilsonInterval(12, 40); assert.ok(lo < 30 && hi > 30 && lo > 17 && hi < 46);
});

test("QC comparison: only the model's estimate is compared; no per-allele LoF fraction is relabelled as 'biallelic'; the interval and the 'not a calibration' caveat are stated", () => {
  const qc = [{ name: "A1", ok: true, decision: { decision: "accept" } }, { name: "A2", ok: true, decision: { decision: "accept" } }, { name: "A3", ok: true, decision: { decision: "hold" } }, { name: "A4", ok: true, decision: { decision: "reject" } }];
  const power = computeClonalScreeningPower({ editType: "ko", weakerGuideLofPct: 75.2 });
  const withModel = computeQcPredictionCalibration({ biomniReport: { screeningPower: power } }, qc);
  assert.equal(withModel.observedAcceptedPct, 50); assert.deepEqual(withModel.observedInterval95Pct, [15, 85]);
  assert.equal(withModel.modelEstimateBiallelicPct, power.predictedBiallelicClonePct); assert.equal(withModel.withinInterval, true);
  assert.match(withModel.summary, /not a calibration/); assert.match(withModel.summary, /sequence level; protein loss is not tested/);
  // the old fallback: a project whose design carries only a per-allele minLofPct got that number shown as the prediction
  const onlyLof = computeQcPredictionCalibration({ designResult: { koAssessment: { outcomes: { minLofPct: 75.2 } } } }, qc);
  assert.equal(onlyLof.modelEstimateBiallelicPct, null); assert.equal(onlyLof.predictedBiallelicPct, null); assert.equal(onlyLof.withinInterval, null); assert.match(onlyLof.summary, /No model estimate/);
  const refused = computeQcPredictionCalibration({ biomniReport: { screeningPower: computeClonalScreeningPower({ editType: "ko" }) } }, qc);
  assert.equal(refused.modelEstimateBiallelicPct, null);
  assert.equal(computeQcPredictionCalibration({}, []), null);
});

const primers = [{ n: "Fw", s: "CTGAAAGGATCTGAGGATAGACC" }, { n: "Rv", s: "CATCTAAGGAGGAAATTCAAGGC" }];
test("genotyping assay: primers from the design for knock-outs and knock-ins; no 480 bp fallback; no unreferenced gel conditions", () => {
  const ko = computeWetLabGenotypingAssay({ editType: "ko", designResult: { ps: primers, amp: "WT ~477 bp | deletion ~452 bp", gs: [], koAssessment: { between: { sizeBp: 25 } } } });
  assert.deepEqual([ko.ok, ko.wtAmpliconBp, ko.editedAmpliconBp, ko.deletionBp, ko.forwardPrimer, ko.reversePrimer], [true, 477, 452, 25, primers[0].s, primers[1].s]);
  assert.equal(ko.relativeChangePct, 5.2); assert.ok(!/\b\d+\s*V\b|\bmin at\b|%\s*(TAE|TBE|agarose)|MetaPhor/i.test(JSON.stringify(ko)), "no voltage, run time, gel percentage or product name");
  assert.equal(ko.agaroseRecommendation, undefined); assert.equal(ko.gelShiftResolvable, undefined);
  const ki = computeWetLabGenotypingAssay({ editType: "ct", designResult: { ps: primers, amp: "WT ~600 bp", os: [] } });
  assert.deepEqual([ki.ok, ki.wtAmpliconBp, ki.forwardPrimer, ki.reversePrimer], [true, 600, primers[0].s, primers[1].s]);
  for (const editType of ["ko", "ct"]) {
    for (const designResult of [{ ps: [], gs: [] }, { ps: primers }, { ps: [{ s: primers[0].s }], amp: "WT ~600 bp" }]) {
      const r = computeWetLabGenotypingAssay({ editType, designResult }); assert.equal(r.ok, false, JSON.stringify([editType, designResult])); assert.ok(r.reason); assert.notEqual(r.wtAmpliconBp, 480);
    }
  }
  const tooBig = computeWetLabGenotypingAssay({ editType: "ko", designResult: { ps: primers, amp: "WT ~300 bp", koAssessment: { between: { sizeBp: 320 } } } });
  assert.equal(tooBig.ok, false); assert.match(tooBig.reason, /flank both cuts/);
});
