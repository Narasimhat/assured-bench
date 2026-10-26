import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesign, summarizeProcurementReadiness, selectKoGuidePair } from "../src/engine/design/designEngine.js";
import { loadLindel } from "../src/engine/design/lindel/loadLindel.js";
import { buildDesignSummary } from "../src/engine/design/reportHtml.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIPK2A = fs.readFileSync(path.join(HERE, "fixtures", "dipk2a-region.gb"), "utf8");
const lindel = await loadLindel();
const G1 = "TGTCAAAGCTGACGTCCAGG"; const G2 = "AGTTGGTCCTAGAGATGGGA";
const design = (options) => runDesign("ko", DIPK2A, "", "", 400, options);

test("without repair weights selection still enforces functional eligibility and exposes no invented outcomes", () => {
  const r = design({});
  assert.ok(r.gs.every(g => g.gc >= 40 && g.gc <= 60));
  assert.equal(r.koSelection.independentGuides.length, 2);
  assert.equal(r.koAssessment.outcomes, null); assert.equal(r.gs[0].ko.outcomes, undefined);
  assert.ok(!summarizeProcurementReadiness(r).warnings.some((w) => /loss-of-function alleles are|Repair-outcome/.test(w)));
});

test("repair scores are retained separately for independent guides and the stricter coordinated pair", () => {
  const r = design({ koLindel: lindel });
  const lof = r.gs.map((g) => g.ko.outcomes.lofPct);
  assert.ok(lof.every(Number.isFinite), String(lof));
  assert.ok(r.koSelection.independentGuides.every(g => g.gc >= 40 && g.gc <= 60));
  assert.equal(r.koAssessment.outcomes.minLofPct, Math.min(...lof));
  assert.ok(!r.gs.some(g => g.sp === "ATTATGTTGGAGAAGAACTG"), "the old 35% GC guide is ineligible");
  assert.ok(!summarizeProcurementReadiness(r).warnings.some((w) => /loss-of-function alleles are/.test(w)), "no warning when both guides are strong");
  const cuts = r.gs.map((g) => g.cut); assert.ok(Math.abs(cuts[1] - cuts[0]) >= 10 && Math.abs(cuts[1] - cuts[0]) <= 140, "pair spacing rule still holds");
});

test("pasting the guides of the clones that kept protein shows why: 73% and 36% predicted loss-of-function alleles, with a warning that gives the clone-level consequence", () => {
  const r = design({ koLindel: lindel, customGuides: [G1, G2] });
  const by = Object.fromEntries(r.gs.map((g) => [g.sp, g.ko.outcomes]));
  assert.equal(by[G1].lofPct, 72.7); assert.equal(by[G2].lofPct, 36.3); assert.equal(by[G2].frameshiftPct, 84.4);
  const warning = summarizeProcurementReadiness(r).warnings.find((w) => /loss-of-function alleles are/.test(w));
  assert.match(warning, /72\.7% for guide 1 and 36\.3% for guide 2/); assert.match(warning, /about 13% of clones/); assert.match(warning, /cutting efficiency is not part/);
});

test("the report names the predicted outcomes, and says so when the outcome model could not be applied", () => {
  const withModel = buildDesignSummary(design({ koLindel: lindel }));
  assert.match(withModel, /Guide 1 predicted repair outcomes: [\d.]+% loss-of-function alleles/);
  const failed = design({ koOutcomesUnavailable: "the Lindel weights could not be loaded (HTTP 404)." });
  assert.match(buildDesignSummary(failed), /Repair-outcome ranking not applied: the Lindel weights could not be loaded/);
  assert.ok(summarizeProcurementReadiness(failed).warnings.some((w) => /Guides were chosen by the frameshift-panel tier alone/.test(w)));
  assert.deepEqual(failed.gs.map(g => g.sp), design({}).gs.map(g => g.sp), "weights failure retains the strict sequence-supported ranking");
});

test("the outcome model is SpCas9-only: other enzymes are designed as before", () => {
  const plain = design({ enzyme: "spcas9ng" }); const withModel = design({ enzyme: "spcas9ng", koLindel: lindel });
  assert.equal(plain.err, undefined);
  assert.deepEqual(withModel.gs.map((g) => g.sp), plain.gs.map((g) => g.sp)); assert.equal(withModel.koAssessment && withModel.koAssessment.outcomes, null);
});

test("selectKoGuidePair ranks 25 acceptable pairs by default and as many as rankLimit when asked", () => {
  const guides = Array.from({ length: 60 }, (_, i) => ({ cut: 1000 + i * 3, str: i % 2 ? "+" : "-", gc: 50 }));
  const seen = new Set(); const rank = (candidate) => { seen.add(candidate); return 0; };
  selectKoGuidePair(guides, 140, { accept: () => true, rank }); assert.equal(seen.size, 25);
  seen.clear(); selectKoGuidePair(guides, 140, { accept: () => true, rank, rankLimit: 400 }); assert.equal(seen.size, 400);
});
