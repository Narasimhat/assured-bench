import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesign, parseGB, summarizeProcurementReadiness } from "../src/engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel } from "../src/engine/design/transcriptModel.js";
import { assessKoGuide, assessKoPair, classifyEdit, spliceEdit, panelEdits, KO_RULES } from "../src/engine/design/koOutcomes.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(HERE, "fixtures", name), "utf8");
const DIPK2A = read("dipk2a-region.gb");
const OPTIONS = { deliveryMethod: "rnp", maxBlockingChanges: 3, coDeliveryBlocking: true, ensureGuidePair: true, allowNonCodingBlockers: true };
const dipk2aModel = () => normalizeGenBankToTranscriptModel(parseGB(DIPK2A), {});
// cut sites (interbase indices into the record) of the pair the geometry-only selection chose, and of a guide in the 5' half of exon 2
const OLD_G1 = 14545; const OLD_G2 = 14586; const EARLY = 14403;
const OLD_PAIR = ["TGTCAAAGCTGACGTCCAGG", "AGTTGGTCCTAGAGATGGGA"];

// A synthetic gene: three coding segments of 600, 300 and 303 nt (the last ends in TAA), no ATG after the first codon in any frame, so reinitiation never applies.
function syntheticModel() {
  const codons = []; let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pool = ["GCT", "GAA", "AAA", "CTG", "GGC", "ACC", "TCC", "CAG", "GTG", "CCC", "AAC", "GAC", "TTC", "CGC"];
  while (codons.length < 400) codons.push(pool[Math.floor(rnd() * pool.length)]);
  const cds = `ATG${codons.slice(0, 399).join("")}TAA`.slice(0, 1203);
  const lens = [600, 300, 303]; const intron = "ggtaagt" + "c".repeat(60) + "ttttcag";
  let genomic = "a".repeat(200); const segs = []; let from = 0;
  lens.forEach((len, i) => { const start = genomic.length; genomic += cds.slice(from, from + len); segs.push([start, genomic.length]); from += len; if (i < lens.length - 1) genomic += intron; });
  genomic += "a".repeat(200);
  return { gene: "SYN", genomicSequence: genomic.toUpperCase(), cdsSequence: cds, cdsSegments: segs, proteinLength: 400, rawFeatures: [] };
}
// an in-frame TAA inserted at coding position c puts a premature stop exactly there
const stopAt = (model, c) => { let run = 0; for (const [a, b] of model.cdsSegments) { if (c < run + (b - a)) { const g = a + (c - run); return classifyEdit(model, { s: g, e: g, ins: "TAA" }); } run += b - a; } throw new Error("position outside the CDS"); };

test("NMD rules: a stop in the last coding exon, or within 55 nt of the last junction, is not predicted to decay", () => {
  const model = syntheticModel(); // coding junctions at 600 and 900; positions are codon starts so the inserted TAA is in frame
  assert.match(stopAt(model, 999).nmd.rule, /last coding exon/);
  // the inserted TAA moves the junction 3 nt downstream, so the margin is 903 minus the insertion position
  const at54 = stopAt(model, 849); assert.equal(at54.nmd.margin, 54); assert.equal(at54.nmd.predicted, false); assert.match(at54.nmd.rule, /50-55 nt rule/);
  assert.equal(stopAt(model, 852).nmd.predicted, false, "51 nt before the junction is inside the window");
  const at57 = stopAt(model, 846); assert.equal(at57.nmd.margin, 57); assert.equal(at57.nmd.predicted, true, "57 nt is outside the 55-nt window"); assert.equal(at57.nmd.borderline, true);
});

test("NMD rules: a stop more than 55 nt upstream is predicted, borderline up to 75 nt, clean beyond", () => {
  const model = syntheticModel();
  const b = stopAt(model, 837); assert.equal(b.nmd.margin, 66); assert.equal(b.class, "lof_nmd"); assert.equal(b.nmd.borderline, true);
  const c = stopAt(model, 801); assert.equal(c.class, "lof_nmd"); assert.equal(c.nmd.borderline, false); assert.equal(c.nmd.margin, 102);
});

test("NMD rules: start-proximal stops and stops in a coding exon longer than 407 nt are not predicted (uncertain)", () => {
  const model = syntheticModel();
  const early = stopAt(model, 90); assert.equal(early.nmd.predicted, false); assert.equal(early.nmd.uncertain, true); assert.match(early.nmd.rule, /start codon/);
  const longExon = stopAt(model, 300); assert.equal(longExon.nmd.predicted, false); assert.equal(longExon.nmd.uncertain, true); assert.match(longExon.nmd.rule, /long-exon/);
});

test("A deletion that touches a splice site is reported as unmodelled, an edit clear of the coding sequence as no coding effect, and one covering the start codon as start loss", () => {
  const model = syntheticModel(); const [a0, b0] = model.cdsSegments[0];
  assert.equal(classifyEdit(model, { s: b0 - 2, e: b0 + 3, ins: "" }).class, "unmodelled");
  assert.equal(classifyEdit(model, { s: 10, e: 14, ins: "" }).class, "no_coding_effect");
  assert.equal(spliceEdit(model, { s: 10, e: 14, ins: "" }).noEffect, true);
  const startLoss = classifyEdit(model, { s: a0 - 5, e: a0 + 20, ins: "" });
  assert.ok(["lof_start_loss", "start_loss_uncertain"].includes(startLoss.class), startLoss.class);
});

test("DIPK2A: the module reproduces the Assured QC engine's calls for the alleles seen in the clones", () => {
  const model = dipk2aModel();
  assert.equal(model.proteinLength, 430);
  // QC engine (coding.js) on the same record: -5 bp across the g2 cut -> truncation_uncertain, stop after residue 305, 70.9% of the protein, stop 41 nt before the last junction
  const del5 = classifyEdit(model, { s: OLD_G2 - 3, e: OLD_G2 + 2, ins: "" });
  assert.equal(del5.class, "truncation_uncertain"); assert.equal(del5.ptcAa, 305); assert.equal(del5.retainedPct, 70.9); assert.equal(del5.nmd.margin, 41); assert.equal(del5.nmd.predicted, false);
  // -1 bp at g2 -> lof_nmd, borderline, stop 57 nt before the last junction, stop after residue 301
  const del1 = classifyEdit(model, { s: OLD_G2, e: OLD_G2 + 1, ins: "" });
  assert.equal(del1.class, "lof_nmd"); assert.equal(del1.nmd.borderline, true); assert.equal(del1.nmd.margin, 57); assert.equal(del1.ptcAa, 301);
});

test("DIPK2A: the pair the geometry-only selection chose is graded 'escape', and so is the deletion between its cuts", () => {
  const model = dipk2aModel();
  const g1 = assessKoGuide(model, { cut: OLD_G1 }); const g2 = assessKoGuide(model, { cut: OLD_G2 });
  assert.equal(g2.tier, "escape"); assert.equal(g2.robustPct, 0); assert.ok(g2.escapePct > 30, `escape share ${g2.escapePct}`); assert.ok(g2.minMarginNt <= 12);
  assert.equal(g1.tier, "marginal"); assert.equal(g1.escapePct, 0);
  const pair = assessKoPair(model, { cut: OLD_G1 }, { cut: OLD_G2 });
  assert.equal(pair.tier, "escape"); assert.equal(pair.between.class, "truncation_uncertain"); assert.equal(pair.between.sizeBp, 41);
  assert.ok(pair.reasons.length >= 2);
});

test("DIPK2A: a guide in the 5' half of exon 2 is robust (every frameshift stops 160 nt or more upstream of the last junction)", () => {
  const a = assessKoGuide(dipk2aModel(), { cut: EARLY });
  assert.equal(a.tier, "robust"); assert.equal(a.robustPct, 100); assert.ok(a.minMarginNt >= 160);
});

test("Selection: strict functional selection cannot be bypassed with the former geometry opt-out", () => {
  const aware = runDesign("ko", DIPK2A, "", "", 400, OPTIONS);
  const formerOptOut = runDesign("ko", DIPK2A, "", "", 400, { ...OPTIONS, koAware: false });
  assert.ok(!aware.err, aware.err);
  assert.deepEqual(formerOptOut.gs.map(g => g.sp), aware.gs.map(g => g.sp));
  assert.notDeepEqual(aware.gs.map(g => g.sp), OLD_PAIR);
  assert.ok(aware.gs.every(g => g.gc >= 40 && g.gc <= 60));
  assert.ok(aware.koSelection.independentPair);
  assert.ok(aware.koSelection.recommendedPair);
});

test("Readiness: functional escape and missing external evidence remain explicit", () => {
  const poor = runDesign("ko", DIPK2A, "", "", 400, { ...OPTIONS, customGuides: OLD_PAIR });
  assert.ok(!poor.err, poor.err);
  assert.equal(poor.koAssessment.tier, "escape");
  const poorReadiness = summarizeProcurementReadiness(poor);
  assert.ok(poorReadiness.warnings.some((w) => /Knockout confidence is low/.test(w) && /last exon junction/.test(w)), JSON.stringify(poorReadiness.warnings));
  assert.notEqual(poorReadiness.status, "ready");
  const good = summarizeProcurementReadiness(runDesign("ko", DIPK2A, "", "", 400, OPTIONS));
  assert.ok(good.warnings.some(w => /has not assessed/.test(w)), "missing external evidence remains visible even for strong pairs");
});

test("Isoform escape remains reported even after shared coding coverage is required", () => {
  const aware = runDesign("ko", DIPK2A, "", "", 400, OPTIONS);
  assert.ok(aware.koAssessment.isoformGaps.every((id) => ["NM_001134470.2", "NM_001363944.1"].includes(id)), JSON.stringify(aware.koAssessment.isoformGaps));
  assert.match(aware.koAssessment.isoformNote || "", /Isoform coverage/);
  assert.ok(summarizeProcurementReadiness(aware).warnings.some((w) => /Isoform coverage/.test(w)));
});

test("Genes with no robust pair get an honest low-confidence warning instead of a silent pick (APOE: the penultimate exon runs into the last exon)", () => {
  const apoe = runDesign("ko", read("apoe-r154s.gb"), "", "", 400, OPTIONS);
  assert.ok(!apoe.err, apoe.err);
  assert.equal(apoe.koAssessment.tier, "escape");
  assert.ok(summarizeProcurementReadiness(apoe).warnings.some((w) => /Knockout confidence is low/.test(w)));
});

test("A record without a coding sequence to simulate on falls back to geometry and reports no assessment rather than failing", () => {
  const demo = runDesign("ko", read("reference_demo.gb"), "", "", 400, OPTIONS);
  assert.ok(!demo.err, demo.err);
  assert.ok(demo.koAssessment && demo.koAssessment.tier === "robust");
});

test("The simulated panel is bounded: 7 deletion sizes at every placement plus 1- and 2-base insertions, and a guide is assessed quickly", () => {
  const edits = panelEdits(1000);
  assert.equal(edits.filter((e) => e.ins === "").length, 2 + 3 + 5 + 6 + 8 + 9 + 11);
  assert.equal(edits.filter((e) => e.ins !== "").length, 4 + 16);
  const model = dipk2aModel(); const t0 = Date.now();
  for (let cut = 14360; cut < 14420; cut += 2) assessKoGuide(model, { cut, id: cut }, { panel: undefined, _bust: cut });
  assert.ok(Date.now() - t0 < 4000, `30 guides took ${Date.now() - t0} ms`);
});
