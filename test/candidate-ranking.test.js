import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { designWithCandidates, buildPmCandidateSet } from "../src/engine/design/pmCandidates.js";
import { normalizeGenBankToTranscriptModel } from "../src/engine/design/transcriptModel.js";
import { parseGB } from "../src/engine/design/designEngine.js";
import {
  buildCandidateRankingRequest, validateRankingReport, rankCandidates, compositeScore, resolveContext, metricNames, normalizeChromosome, HUMAN_CHROMOSOMES,
} from "../src/services/candidateRanking.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const APOE = fs.readFileSync(path.join(ROOT, "public", "references", "apoe-ensg00000130203.gb"), "utf8");
const FIX = (name) => JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "alphagenome-ranking", name), "utf8"));
const OPTIONS = { deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: "APOE" };
const CONTEXTS = ["glutamatergic-neuron", "wtc11"];
const NEURON = "CL:0000679"; const WTC11 = "EFO:0009747";
// Bundled APOE states "Imported from genome: GRCh38 … Location: chr19 44905754-44909393"; tests still pass an explicit mapping for clarity.
const MAPPING = { assembly: "GRCh38", chromosome: "19", referenceStart: 44905754, orientation: 1 };

async function apoeSetup(extra = {}) {
  const design = designWithCandidates(APOE, "R176C", OPTIONS);
  const project = { gene: "APOE", genbankRaw: APOE, designResult: design };
  const built = await buildCandidateRankingRequest(project, design.pmCandidates, { contexts: CONTEXTS, mapping: MAPPING, mappingConfirmed: true, ...extra });
  return { design, project, candidateSet: design.pmCandidates, ...built };
}
function fixtureReport(request) { const report = FIX("apoe-r176c-report.json"); report.requestId = request.requestId; return report; }

test("request: four distinct alleles, intended edit at rs7412, contexts from the catalog, annotation in chromosome coordinates", async () => {
  const { request, alleleOfCandidate, contexts } = await apoeSetup();
  assert.equal(request.schema, "assured-alphagenome-candidates-request/1");
  assert.deepEqual(request.intended, [{ position: 44908822, ref: "C", alt: "T" }]);
  assert.deepEqual(request.contexts, [NEURON, WTC11]);
  assert.deepEqual(contexts.map((c) => c.label), ["Glutamatergic neuron", "WTC11 iPSC reference"]);
  assert.deepEqual(request.alleles.map((a) => a.id), ["a1", "a2", "a3", "a4"]);
  assert.deepEqual(Object.values(alleleOfCandidate), ["a1", "a2", "a3", "a4"]);
  for (const a of request.alleles) assert.equal(a.variants.filter((v) => v.role === "intended").length, 1);
  assert.deepEqual(request.annotation.exons.at(-1), [44905754 + 2779, 44905754 + 3639]);
  assert.deepEqual(request.annotation.cdsSegments, [[44905754 + 871, 44905754 + 913], [44905754 + 2006, 44905754 + 2198], [44905754 + 2779, 44905754 + 3496]]);
  assert.deepEqual([request.annotation.geneStart, request.annotation.geneEnd], [44905754, 44909393]);
  assert.deepEqual(request.null, { perK: 30, ks: [1, 2, 3], windowBp: 35, seed: 20261027 });
});

test("request: candidates that share a substitution set share one allele", async () => {
  const model = normalizeGenBankToTranscriptModel(parseGB(APOE), { expectedGene: "APOE" });
  const loose = buildPmCandidateSet(model, "R176C", { rule: { ...designWithCandidates(APOE, "R176C", OPTIONS).pmCandidates.rule, thresholds: { ...designWithCandidates(APOE, "R176C", OPTIONS).pmCandidates.rule.thresholds, minArm: 20 } } });
  const design = designWithCandidates(APOE, "R176C", OPTIONS);
  const { request, alleleOfCandidate } = await buildCandidateRankingRequest({ gene: "APOE", genbankRaw: APOE, designResult: design }, loose, { contexts: CONTEXTS, mapping: MAPPING, mappingConfirmed: true });
  assert.ok(Object.keys(alleleOfCandidate).length > request.alleles.length, "more candidates than alleles");
  const shared = loose.alleles.find((a) => a.candidateIds.length > 1);
  assert.equal(new Set(shared.candidateIds.map((id) => alleleOfCandidate[id])).size, 1);
});

test("request refuses an unconfirmed mapping, a minus-strand orientation, an unknown context and too many contexts", async () => {
  const design = designWithCandidates(APOE, "R176C", OPTIONS);
  const project = { gene: "APOE", genbankRaw: APOE, designResult: design };
  await assert.rejects(buildCandidateRankingRequest(project, design.pmCandidates, { contexts: CONTEXTS, mapping: MAPPING }), /Confirm the assembly/);
  await assert.rejects(buildCandidateRankingRequest(project, design.pmCandidates, { contexts: CONTEXTS, mappingConfirmed: true, mapping: { assembly: "GRCh38", chromosome: "19", referenceStart: 44905754, orientation: -1 } }), /plus-strand/);
  await assert.rejects(buildCandidateRankingRequest(project, design.pmCandidates, { contexts: CONTEXTS, mappingConfirmed: true, mapping: { assembly: "GRCh37", chromosome: "19", referenceStart: 44905754, orientation: 1 } }), /GRCh38/);
  await assert.rejects(buildCandidateRankingRequest(project, design.pmCandidates, { contexts: ["nonexistent"], mapping: MAPPING, mappingConfirmed: true }), /Unknown model context/);
  await assert.rejects(buildCandidateRankingRequest(project, design.pmCandidates, { contexts: ["wtc11", "h1", "h9", "cardiac", "hepatic"], mapping: MAPPING, mappingConfirmed: true }), /one to four/);
  // Bundled APOE Location is readable: confirmed mapping without an explicit override must succeed.
  const fromRecord = await buildCandidateRankingRequest(project, design.pmCandidates, { contexts: CONTEXTS, mappingConfirmed: true });
  assert.deepEqual(fromRecord.request.intended, [{ position: 44908822, ref: "C", alt: "T" }]);
  // RefSeqGene TP53 has no chromosome coordinates, so ranking still requires a user-supplied mapping.
  const tp53 = fs.readFileSync(path.join(ROOT, "public", "references", "tp53-NG_017013.2.gb"), "utf8");
  const tp53Design = designWithCandidates(tp53, "R175H", { ...OPTIONS, expectedGene: "TP53" });
  await assert.rejects(buildCandidateRankingRequest({ gene: "TP53", genbankRaw: tp53, designResult: tp53Design }, tp53Design.pmCandidates, { contexts: CONTEXTS, mappingConfirmed: true }), /GRCh38 only/);
  assert.equal(resolveContext("CL:0000679").id, "glutamatergic-neuron");
});

test("the Python tool accepts the request offline: same digest, window and null size", async () => {
  const { request } = await apoeSetup();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assured-rank-"));
  try {
    const file = path.join(directory, "request.json");
    fs.writeFileSync(file, JSON.stringify(request));
    const run = spawnSync("python3", ["tools/alphagenome/rank.py", file, "--validate-only"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.status, "validated-offline"); assert.equal(out.requestId, request.requestId);
    assert.deepEqual(out.interval, [44900629, 44917013]);
    assert.equal(out.alleles, 4); assert.equal(out.nullAlleles, 90); assert.equal(out.codonsAvailable, 23); assert.equal(out.predictionPerformed, false);
    // a tampered request is refused
    const bad = { ...request, contexts: [WTC11, NEURON] };
    fs.writeFileSync(file, JSON.stringify(bad));
    const refused = spawnSync("python3", ["tools/alphagenome/rank.py", file, "--validate-only"], { cwd: ROOT, encoding: "utf8" });
    assert.notEqual(refused.status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("statistics: the composite and its p value match a hand calculation, and keep the size of a deviation", () => {
  const zero = (extra) => Object.fromEntries(metricNames(NEURON).map((m) => [m, extra?.[m] ?? 0]));
  const m1 = `M1_expr_log2|${NEURON}`;
  const pool = [1, 2, 3, 4].map((v, n) => ({ k: 1, n, metrics: zero({ [m1]: v }) }));
  const extreme = compositeScore(zero({ [m1]: 10 }), 1, pool, NEURON);
  assert.ok(Math.abs(extreme.composite - 7.5 / Math.sqrt(1.25)) < 1e-12); // mean 2.5, population sd sqrt(1.25)
  assert.equal(extreme.p, (1 + 0) / (4 + 1)); // no null member, left out of its own reference, deviates that far
  assert.deepEqual(extreme.aboveP95, [m1]);
  const typical = compositeScore(zero({ [m1]: 0 }), 1, pool, NEURON);
  assert.equal(typical.composite, 0); // the four constant metrics sit at the null mean
  assert.equal(typical.p, 1);
  assert.throws(() => compositeScore(zero(), 2, pool, NEURON), /No null alleles/);
  // Magnitude counts: a value ten times beyond the null scores higher than one just beyond it (a rank composite would tie them).
  assert.ok(compositeScore(zero({ [m1]: 40 }), 1, pool, NEURON).composite > compositeScore(zero({ [m1]: 5 }), 1, pool, NEURON).composite);
  // The scale floor stops a one-step difference in a coarse metric from looking extreme.
  const m5 = `M5_usage_annot|${NEURON}`;
  const flat = [0, 1, 2, 3].map((n) => ({ k: 1, n, metrics: zero({ [m5]: 0.00390625 }) }));
  assert.ok(compositeScore(zero({ [m5]: 0.0078125 }), 1, flat, NEURON).composite <= 1.0000001);
});

test("calibration on the saved null: a positive control is flagged, and null alleles are rarely flagged against the rest", async () => {
  const { request } = await apoeSetup();
  const report = fixtureReport(request);
  const strong = { ...report.alleles[0].metrics, [`M1_expr_log2|${NEURON}`]: 0.3 };
  const s = compositeScore(strong, 2, report.null.alleles, NEURON);
  assert.ok(Math.abs(s.p - 1 / 31) < 1e-12);
  for (const k of [1, 2, 3]) {
    const members = report.null.alleles.filter((a) => a.k === k);
    const flagged = members.filter((m) => compositeScore(m.metrics, k, report.null.alleles.filter((a) => a !== m), NEURON).p <= 0.05).length;
    assert.ok(flagged / members.length <= 0.07, `k=${k}: ${flagged} of ${members.length} null alleles flagged`);
  }
});

test("parity: the saved APOE R176C run reproduces the prototype composite p values and the tie", async () => {
  const setup = await apoeSetup();
  const expected = FIX("apoe-r176c-expected.json");
  const report = validateRankingReport(fixtureReport(setup.request), setup.request);
  const alleles = Object.fromEntries(report.alleles.map((a) => [a.id, a.metrics]));
  for (const [id, byContext] of Object.entries(expected.p)) {
    for (const [ontology, p] of Object.entries(byContext)) {
      const k = setup.request.alleles.find((a) => a.id === id).variants.length - 1;
      const s = compositeScore(alleles[id], k, report.null.alleles, ontology);
      assert.ok(Math.abs(s.p - p) < 1e-12, `${id} ${ontology}: ${s.p} vs ${p}`);
      assert.ok(Math.abs(s.composite - expected.composite_z[id][ontology]) < 1e-9);
    }
  }
  const ranking = rankCandidates(setup.candidateSet, { ...setup, report });
  assert.equal(ranking.wording, "Equally supported among 4 candidates evaluated in Glutamatergic neuron: Candidate 1 and Candidate 2.");
  assert.deepEqual(ranking.top, ["+3052.v0", "-3070.v1"]);
  assert.equal(ranking.tie, true); assert.equal(ranking.modelSeparatesCandidates, false);
  assert.deepEqual(ranking.ranking.map((r) => [r.id, r.finalTier, r.top]), [["+3052.v0", 1, true], ["-3070.v1", 1, true], ["-3058.v0", 2, false], ["-3070.v0", 3, false]]);
  assert.equal(ranking.primaryContext.informative, true);
  assert.deepEqual(ranking.otherContexts[0], { ontology: WTC11, label: "WTC11 iPSC reference", informative: true, flagged: [] });
  assert.equal(ranking.tieBreak.order[0], "+3052.v0");
  // The literal "any metric above the null 95th percentile" rule flags only the three-blocker candidate and leaves the top set unchanged.
  assert.deepEqual(ranking.sensitivity.literalAnyMetricAboveP95.flagged, ["-3058.v0"]);
  assert.deepEqual(ranking.sensitivity.literalAnyMetricAboveP95.top, ["+3052.v0", "-3070.v1"]);
  assert.deepEqual(expected.literal_above_p95_neuron.a3, ["M3_splice_annot_loss"]);
  // Reasons for the lower-ranked candidates come from Stage-1 facts, not from the model.
  const byId = Object.fromEntries(ranking.ranking.map((r) => [r.id, r]));
  assert.match(byId["-3058.v0"].reasonsRankedLower.join(" "), /3 blocking changes against 2/);
  assert.match(byId["-3070.v0"].reasonsRankedLower.join(" "), /one spacer mismatch/);
});

test("rule behaviour on perturbed copies of the saved report (synthetic; tests the rule, not biology)", async () => {
  const setup = await apoeSetup();
  // 1. A model departure demotes a top-tier candidate by one tier and breaks the tie.
  const demote = fixtureReport(setup.request);
  demote.alleles[0].metrics[`M1_expr_log2|${NEURON}`] = 1e3; // candidate 1 now exceeds every null allele of its size
  const demoted = rankCandidates(setup.candidateSet, { ...setup, report: demote });
  assert.equal(demoted.ranking.find((r) => r.id === "+3052.v0").flagged, true);
  assert.deepEqual(demoted.top, ["-3070.v1"]); assert.equal(demoted.tie, false);
  assert.equal(demoted.wording, "Best-supported among 4 candidates evaluated in Glutamatergic neuron: Candidate 2.");
  assert.match(demoted.ranking.find((r) => r.id === "+3052.v0").reasonsRankedLower.join(" "), /flagged it against the null/);
  // 2. A flag in the sensitivity context alone does not change the order.
  const other = fixtureReport(setup.request);
  other.alleles[1].metrics[`M1_expr_log2|${WTC11}`] = 1e3;
  const kept = rankCandidates(setup.candidateSet, { ...setup, report: other });
  assert.deepEqual(kept.top, ["+3052.v0", "-3070.v1"]); assert.deepEqual(kept.otherContexts[0].flagged, ["-3070.v1"]);
  // 3. An uninformative primary context gives no regulatory ordering at all.
  const quiet = fixtureReport(setup.request);
  quiet.referenceSignal[NEURON].exonMeanPlus = 0.4;
  const none = rankCandidates(setup.candidateSet, { ...setup, report: quiet });
  assert.equal(none.primaryContext.informative, false);
  assert.match(none.wording, /^No regulatory ordering/);
  assert.equal(none.ranking.every((r) => !r.flagged), true);
  assert.deepEqual(none.top, ["+3052.v0", "-3070.v1"]);
  // 4. A model flag cannot rescue anything: finalTier is never below the Stage-1 tier.
  for (const r of demoted.ranking) assert.ok(r.finalTier >= r.stage1Tier);
});

test("report validation refuses a report for another request, a changed null, missing metrics and non-finite values", async () => {
  const { request } = await apoeSetup();
  assert.doesNotThrow(() => validateRankingReport(fixtureReport(request), request));
  const wrongId = fixtureReport(request); wrongId.requestId = "0".repeat(64);
  assert.throws(() => validateRankingReport(wrongId, request), /does not match the current candidates/);
  const shortNull = fixtureReport(request); shortNull.null.alleles.pop();
  assert.throws(() => validateRankingReport(shortNull, request), /null for 3 blocking changes is incomplete/);
  const otherSeed = fixtureReport(request); otherSeed.null.seed = 1;
  assert.throws(() => validateRankingReport(otherSeed, request), /null does not match/);
  const missing = fixtureReport(request); delete missing.alleles[2].metrics["M3_splice_annot_loss"];
  assert.throws(() => validateRankingReport(missing, request), /missing metrics/);
  const nan = fixtureReport(request); nan.alleles[0].metrics[`M2_local_rel|${NEURON}`] = null;
  assert.throws(() => validateRankingReport(nan, request), /missing metrics/);
  const swapped = fixtureReport(request); swapped.contexts = [WTC11, NEURON];
  assert.throws(() => validateRankingReport(swapped, request), /contexts differ/);
  const reordered = fixtureReport(request); reordered.alleles.reverse();
  assert.throws(() => validateRankingReport(reordered, request), /alleles differ/);
  const noSignal = fixtureReport(request); delete noSignal.referenceSignal[WTC11];
  assert.throws(() => validateRankingReport(noSignal, request), /reference signal/);
});

test("chromosome input: tolerant of chr19, spaces and case; a missing or invalid chromosome gets a message that says what to do", async () => {
  assert.deepEqual(["19", "chr19", " Chr19 ", "x", "chrY", ""].map(normalizeChromosome), ["19", "19", "19", "X", "Y", ""]);
  assert.equal(HUMAN_CHROMOSOMES.length, 24); assert.deepEqual(HUMAN_CHROMOSOMES.slice(-3), ["22", "X", "Y"]);
  const design = designWithCandidates(APOE, "R176C", OPTIONS);
  const project = { gene: "APOE", genbankRaw: APOE, designResult: design };
  const tryWith = (chromosome) => buildCandidateRankingRequest(project, design.pmCandidates, { contexts: CONTEXTS, mappingConfirmed: true, mapping: { ...MAPPING, chromosome } });
  const typed = await tryWith(" chr19 ");
  assert.equal(typed.request.chromosome, "chr19", "the request names the chromosome the way the model's interval does, whatever form was typed");
  for (const bad of ["", "   ", "23", "MT", "NC_000019.10", "chr"]) await assert.rejects(tryWith(bad), /Select the human chromosome the uploaded reference sits on \(1-22, X or Y\)/, JSON.stringify(bad));
  await assert.rejects(buildCandidateRankingRequest(project, design.pmCandidates, { contexts: CONTEXTS, mappingConfirmed: true, mapping: { ...MAPPING, referenceStart: NaN } }), /Enter the GRCh38 position \(1-based\) of the first base/);
});
