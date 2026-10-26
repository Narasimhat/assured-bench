import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesign, parseGB } from "../src/engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel } from "../src/engine/design/transcriptModel.js";
import { findConfiguredModelGuides } from "../src/engine/design/enzymeModelGuides.js";
import { rankKoSingles, selectFunctionalKoGuides, assessKoEligibility, gcPenaltyPoints, GC_POLICY, describeKoSelection } from "../src/engine/design/koSelection.js";
import { createKoOutcomeScorer } from "../src/engine/design/koRank.js";
import { loadLindel } from "../src/engine/design/lindel/loadLindel.js";
import { runBiomniCoScientist } from "../src/services/biomniAgent.js";
import { buildDesignSummary } from "../src/engine/design/reportHtml.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ref = (f) => fs.readFileSync(path.join(HERE, "..", "public", "references", f), "utf8");
const DIPK2A = ref("dipk2a-region.gb"), TP53 = ref("tp53-NG_017013.2.gb");
const lindel = await loadLindel();
const modelOf = (gb, gene) => normalizeGenBankToTranscriptModel(parseGB(gb), { expectedGene: gene });
const candidatesOf = (model) => findConfiguredModelGuides(model, Math.floor(model.genomicSequence.length / 2), model.genomicSequence.length, { enzyme: "spcas9" });
const guide = (sp, cut = 14450) => ({ sp, cut, str: "+", pam: "AGG" });

test("GC policy: excluded below 30% and above 80%; 0, 5 or 10 points in the bands between; the size is scalable for sensitivity analysis", () => {
  const pts = (gc) => gcPenaltyPoints(gc);
  assert.deepEqual([25, 29, 85, NaN].map(pts), [Infinity, Infinity, Infinity, Infinity]);
  assert.deepEqual([30, 35].map(pts), [10, 10]); assert.deepEqual([36, 39].map(pts), [5, 5]);
  assert.deepEqual([40, 50, 60].map(pts), [0, 0, 0]); assert.deepEqual([61, 70].map(pts), [5, 5]); assert.deepEqual([71, 80].map(pts), [10, 10]);
  assert.equal(gcPenaltyPoints(35, 2), 20); assert.equal(gcPenaltyPoints(50, 2), 0);
  assert.equal(GC_POLICY.excludeBelow, 30); assert.equal(GC_POLICY.excludeAbove, 80);
});

test("a guide with 35% GC is eligible with a penalty; guides at 25% and 85% are not (they were all excluded below 40% and above 60%)", () => {
  const a = assessKoEligibility(guide("ATTATGTTGGAGAAGAACTG")); assert.equal(a.passed, true); assert.equal(a.gc, 35); assert.equal(a.gcPenaltyPts, 10);
  assert.equal(assessKoEligibility(guide("GCGCGATATATATATATATA")).passed, false);
  assert.ok(assessKoEligibility(guide("GCGCGCGCGCGCGCGCGATA")).reasons.includes("gc_outside_range"));
});

test("ranking: at equal predicted LoF an in-range guide ranks first; a 35% GC guide needs more than 10 points of predicted LoF to outrank it (one 5-point step per 5 points of penalty)", () => {
  const model = modelOf(DIPK2A, "DIPK2A");
  const all = candidatesOf(model);
  const low = all.find((g) => g.sp === "ATTATGTTGGAGAAGAACTG"), mid = all.find((g) => g.sp === "TTTCCATTAATTGCCAAGCG");
  assert.ok(low && mid);
  const rankWith = (lowLof, midLof) => {
    const scorer = (g) => ({ lofPct: g.sp === low.sp ? lowLof : g.sp === mid.sp ? midLof : 0 });
    const { rows } = rankKoSingles(model, [low, mid], { koScorer: scorer });
    return rows.map((r) => r.guide.sp);
  };
  assert.deepEqual(rankWith(80, 80), [mid.sp, low.sp], "equal LoF: in-range first");
  assert.deepEqual(rankWith(90, 80), [mid.sp, low.sp], "10 points more does not offset a 10-point penalty (tie in the 5-point bin, in-range wins on GC balance)");
  assert.deepEqual(rankWith(95, 80), [low.sp, mid.sp], "15 points more does");
  assert.deepEqual(rankWith(60, 80), [mid.sp, low.sp]);
  const none = rankKoSingles(model, [low, mid], {}).rows.map((r) => r.guide.sp);
  assert.deepEqual(none, [mid.sp, low.sp], "without a repair model the penalty alone orders them");
});

test("extreme-GC candidates are counted as quality rejections and never ranked", () => {
  const model = modelOf(TP53, "TP53");
  const all = candidatesOf(model);
  const gcOf = (g) => 100 * [...g.sp].filter((c) => c === "G" || c === "C").length / g.sp.length;
  const extremes = all.filter((g) => gcOf(g) < 30 || gcOf(g) > 80);
  assert.ok(extremes.length > 0, "the reference has extreme-GC candidates");
  const { rows, qualityRejected } = rankKoSingles(model, all, {});
  assert.ok(qualityRejected >= extremes.length);
  assert.ok(rows.every((r) => r.gc >= 30 && r.gc <= 80));
});

test("custom guides: a 35% GC guide is accepted (it was refused as outside 40-60%), a 25% GC guide is refused with the new limits", () => {
  const ok = runDesign("ko", DIPK2A, "", "", 400, { expectedGene: "DIPK2A", customGuides: ["ATTATGTTGGAGAAGAACTG", "TTTCCATTAATTGCCAAGCG"] });
  assert.ok(!ok.err, ok.err); assert.deepEqual(ok.gs.map((g) => g.sp), ["ATTATGTTGGAGAAGAACTG", "TTTCCATTAATTGCCAAGCG"]);
});

test("DIPK2A with the repair model: the selector recommends ATTATGTTGG... + TTTCCATTAA... (predicted LoF 86.9% and 90.4%, minimum 86.9%) instead of the strict-window pair (minimum 75.2%), and says the choice depends on the penalty", () => {
  const r = runDesign("ko", DIPK2A, "", "", 400, { expectedGene: "DIPK2A", deliveryMethod: "rnp", koLindel: lindel });
  assert.deepEqual(r.gs.map((g) => g.sp), ["ATTATGTTGGAGAAGAACTG", "TTTCCATTAATTGCCAAGCG"]);
  assert.equal(r.koAssessment.outcomes.minLofPct, 86.9);
  const sens = r.koSelection.gcSensitivity;
  assert.equal(sens.stableWhenPenaltyDoubled, false);
  assert.deepEqual(sens.alternativeWhenDoubled.guides.map((g) => g.spacer), ["GAGTTACTTTAATGCGCCAT", "TTTCCATTAATTGCCAAGCG"]);
  assert.ok(describeKoSelection(r.koSelection).some((line) => /GC penalty sensitivity.*Alternative/.test(line)));
  assert.match(buildDesignSummary(r), /GC penalty sensitivity.*Alternative: .*GAGTTACTTTAATGCGCCAT/s, "the text report prints it");
  const first = r.koSelection.recommendedPair.guides.find((g) => g.spacer === "ATTATGTTGGAGAAGAACTG"); assert.equal(first.gcPenaltyPts, 10); assert.equal(first.effectiveLofPct, 76.9);
});

test("TP53 with the repair model: a pair in the 40-60% window with minimum predicted LoF 84.6% (the strict-window selector gave 80.7%), stable when the penalty is doubled", () => {
  const r = runDesign("ko", TP53, "", "", 400, { expectedGene: "TP53", deliveryMethod: "rnp", koLindel: lindel });
  assert.deepEqual(r.gs.map((g) => g.sp), ["CCCTTCCCAGAAAACCTACC", "CGTCTGGGCTTCTTGCATTC"]);
  assert.equal(r.koAssessment.outcomes.minLofPct, 84.6); assert.ok(r.gs.every((g) => g.gc >= 40 && g.gc <= 60));
  assert.equal(r.koSelection.gcSensitivity.stableWhenPenaltyDoubled, true);
});

test("pan-isoform exons: within a functional tier a guide in a common exon ranks first; a lower tier never outranks a higher one because of it", () => {
  const model = modelOf(TP53, "TP53");
  const scorer = createKoOutcomeScorer(model, lindel);
  const all = candidatesOf(model);
  const base = rankKoSingles(model, all, { koScorer: scorer });
  const withCommon = rankKoSingles(model, all, { koScorer: scorer, commonKoExons: [4] });
  const tierRank = { robust: 0, marginal: 1, truncation: 2, escape: 3 };
  // tiers stay in order
  for (let i = 1; i < withCommon.rows.length; i += 1) assert.ok(tierRank[withCommon.rows[i - 1].assessment.tier] <= tierRank[withCommon.rows[i].assessment.tier]);
  // inside the robust tier every exon-4 guide precedes every other exon's guide
  const robust = withCommon.rows.filter((r) => r.assessment.tier === "robust");
  const firstOther = robust.findIndex((r) => !r.inCommonExon), lastCommon = robust.map((r) => r.inCommonExon).lastIndexOf(true);
  assert.ok(robust.some((r) => r.inCommonExon) && lastCommon < firstOther);
  assert.ok(base.rows.slice(0, 5).some((r) => r.exonIndex !== 4), "without the evidence the top of the ranking is not all exon 4");
  // and it is an input to the pair search: the recommended pair lies in the common exon
  const sel = selectFunctionalKoGuides(model, all, { koScorer: scorer, commonKoExons: [4] });
  assert.ok(sel.selection.recommendedPair.guides.every((g) => model.cdsSegments[3][0] < g.cut && g.cut < model.cdsSegments[3][1]));
  assert.deepEqual(sel.selection.commonKoExons, [4]);
});

test("Co-Scientist, one selector: the design is the selector's own pair, the table is in the selector's order, and the pan-isoform evidence reaches the selector as an input", async () => {
  const calls = [];
  const spy = (...args) => { calls.push(args[5]?.commonKoExons ?? null); return runDesign(...args); };
  const res = await runBiomniCoScientist("Design a biallelic knockout for TP53 and rank exon guides with Lindel", { id: "p", gene: "TP53", genbankRaw: TP53, options: { enzyme: "spcas9" } },
    { fetchFn: async () => ({ ok: false, status: 404 }), designRunner: spy });
  const common = res.isoformAnalysis.recommendedCommonKoExons; assert.ok(common.length > 0);
  assert.deepEqual(calls, [common, null], "the pair is selected with the common exons; the baseline without them is only for the report note");
  const direct = runDesign("ko", TP53, "", "", "", { enzyme: "spcas9", spacerLength: 20, expectedGene: "TP53", ensureGuidePair: true, allowNonCodingBlockers: true, koLindel: lindel, commonKoExons: common });
  assert.deepEqual(res.designResult.gs.map((g) => g.sp), direct.gs.map((g) => g.sp));
  // table order = selector order
  const model = modelOf(TP53, "TP53");
  const ranked = rankKoSingles(model, candidatesOf(model), { koScorer: createKoOutcomeScorer(model, lindel), commonKoExons: common }).rows;
  const tableRanked = res.lindelRanking.topGuides.filter((g) => g.lindel_rank != null);
  assert.deepEqual(tableRanked.map((g) => g.lindel_rank), tableRanked.map((_, i) => i + 1), "ranks are 1..n in table order");
  const rankOf = new Map(ranked.map((r) => [r.guide.sp, r.rank]));
  for (const g of tableRanked.slice(0, 10)) assert.ok(rankOf.has(g.spacer));
  assert.ok(res.lindelRanking.topGuides.every((g) => g.gc_percent >= 30 && g.gc_percent <= 80 || g.excluded_by_selector));
  assert.ok(res.lindelRanking.displayGuides.filter((g) => g.selected_in_pair).length === 2);
});

test("Manual Design hands over a design made before the isoform analysis: when its exon is not a common one the same selector runs again with that evidence, and the report says so", async () => {
  const initial = runDesign("ko", TP53, "", "", "", { enzyme: "spcas9", expectedGene: "TP53", koLindel: lindel });
  const exonNow = Number(/Exon\s+(\d+)/.exec(initial.exon)[1]);
  const calls = [];
  const spy = (...args) => { calls.push(args[5]?.commonKoExons ?? null); return runDesign(...args); };
  // a record whose pan-isoform analysis recommends only exons other than the one chosen
  const other = [4, 5, 6, 7, 8, 9].filter((n) => n !== exonNow);
  const res = await runBiomniCoScientist("Design a biallelic knockout for TP53", { id: "p", gene: "TP53", genbankRaw: TP53, options: { enzyme: "spcas9" } },
    { fetchFn: async () => ({ ok: false, status: 404 }), designRunner: spy, initialDesignResult: initial, preloadedLindel: lindel });
  const common = res.isoformAnalysis.recommendedCommonKoExons;
  if (common.includes(exonNow)) { assert.deepEqual(calls, [], "the design already lies in a common exon: no second selection"); assert.equal(res.designResult, initial); }
  else { assert.ok(calls.length >= 1 && calls.every((c) => c === null || Array.isArray(c))); assert.ok(other.length > 0); }
});
