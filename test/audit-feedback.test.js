// Behaviour added after an external review of Bench designs for SCN5A, TP53 and DIPK2A (docs/AUDIT_2026-10.md, B17-B22).
// The network answers come from test/fixtures/isoform-evidence.json, recorded with scripts/record_isoform_fixtures.mjs; nothing here needs the network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runDesign, parseGB, summarizeProcurementReadiness } from "../src/engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel } from "../src/engine/design/transcriptModel.js";
import { findConfiguredModelGuides } from "../src/engine/design/enzymeModelGuides.js";
import { createKoOutcomeScorer } from "../src/engine/design/koRank.js";
import { rankKoSingles, selectFunctionalKoGuides, buildKoPicker } from "../src/engine/design/koSelection.js";
import { loadLindel } from "../src/engine/design/lindel/loadLindel.js";
import { queryGeneViability, summariseViability, describeViability, OPEN_TARGETS_API } from "../src/services/geneViability.js";
import { makeCutMapper, coverageAtCut, genomicPositionOfCut, summariseCutCoverage, describeCutCoverage } from "../src/services/isoformCoverage.js";
import { runBiomniCoScientist } from "../src/services/biomniAgent.js";
import { appendBiomniSummary } from "../src/services/designExport.js";
import { buildCasOffinderInput } from "../src/services/offTargetExport.js";
import { exonLabel, exonListLabel, exonOffset } from "../src/services/exonLabels.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/isoform-evidence.json", import.meta.url), "utf8")).genes;
const record = gene => fs.readFileSync(new URL(`../public/references/${fixtures[gene].file}`, import.meta.url), "utf8");
const lindel = await loadLindel();
const modelOf = (gene) => normalizeGenBankToTranscriptModel(parseGB(record(gene)), { expectedGene: gene });
const candidatesOf = (model) => findConfiguredModelGuides(model, 0, model.genomicSequence.length, { enzyme: "spcas9" });
const koOptions = gene => ({ enzyme: "spcas9", expectedGene: gene, koLindel: lindel, ensureGuidePair: true, allowNonCodingBlockers: true });

// what Open Targets and Ensembl answered, replayed
function replayFetch(gene) {
  const fx = fixtures[gene];
  return async (url, init = {}) => {
    const href = String(url);
    if (href === OPEN_TARGETS_API) {
      const { query } = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ data: /search\(/.test(query) ? fx.openTargets.search : fx.openTargets.target }) };
    }
    if (href.includes(`rest.ensembl.org/lookup/symbol/homo_sapiens/${gene}`)) {
      const Transcript = fx.ensembl.transcripts.map(t => ({ id: t.id, display_name: t.name, biotype: "protein_coding", is_canonical: t.canonical ? 1 : 0,
        Translation: { start: t.segs[0][0], end: t.segs.at(-1)[1] }, Exon: t.segs.map(([start, end]) => ({ start, end })) }));
      return { ok: true, status: 200, json: async () => ({ id: fx.ensembl.ensemblId, strand: fx.ensembl.strand, Transcript }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("exon numbering: the banner, the guide notes and the picker name the same exon, annotated transcript exon first", () => {
  const result = runDesign("ko", record("TP53"), "", "", "", koOptions("TP53"));
  assert.ok(!result.err, result.err);
  const m = /^Exon (\d+) \(coding exon (\d+), \d+-\d+, \d+ bp\)$/.exec(result.exon);
  assert.ok(m, `unexpected banner: ${result.exon}`);
  assert.equal(result.transcriptExon, Number(m[1]));
  assert.equal(result.codingExon, Number(m[2]));
  // TP53's first coding exon is the second exon of the transcript
  assert.equal(result.transcriptExon, result.codingExon + 1);
  // the guides' notes lead with the same number and carry the same bracket (a guide pair may span two exons only if the user chose it)
  for (const g of result.gs) assert.match(g.note, new RegExp(`exon ${result.transcriptExon} \\(coding exon ${result.codingExon}\\)`), g.note);
  // the picker rows lead with the annotated number too
  const row = result.koPicker.rows.find(r => r.spacer === result.gs[0].sp);
  assert.equal(row.transcriptExon, result.transcriptExon); assert.equal(row.exon, result.codingExon);
  assert.equal(exonLabel(2, 1), "exon 3 (coding exon 2)"); assert.equal(exonLabel(2, null), "coding exon 2");
  assert.equal(exonListLabel([3, 4, 5], 1), "exons 4, 5, 6 (coding exons 3, 4, 5)"); assert.equal(exonListLabel([2], 0), "exon 2 (coding exon 2)"); assert.equal(exonListLabel([], 1), "");
  assert.equal(exonOffset(result), 1); assert.equal(exonOffset({}), null);
});

test("a knockout is never 'ready' for procurement, including a pair chosen by hand", () => {
  const raw = record("TP53");
  const auto = runDesign("ko", raw, "", "", "", koOptions("TP53"));
  const spacers = auto.koPicker.rows.slice(0, 2).map(r => r.spacer);
  const picked = runDesign("ko", raw, "", "", "", { ...koOptions("TP53"), customGuides: [spacers[1], spacers[0]] });
  for (const result of [auto, picked]) {
    assert.ok(!result.err, result.err);
    const procurement = summarizeProcurementReadiness(result);
    assert.notEqual(procurement.status, "ready");
    assert.ok(procurement.warnings.some(w => /Knockout selection has not assessed/.test(w)), "the unassessed list is stated for every knockout");
  }
});

test("gene constraint and essentiality are read from Open Targets and shown whether or not they are reassuring", async () => {
  const tp53 = await queryGeneViability({ symbol: "TP53" }, replayFetch("TP53"));
  assert.equal(tp53.ok, true);
  assert.equal(tp53.gnomad.pLI, 1);
  assert.equal(tp53.gnomad.loeuf, 0.42);
  assert.equal(tp53.depmap.screensAtOrBelowCutoff, 5);
  assert.equal(tp53.depmap.cutoff, -0.5);
  const dipk2a = await queryGeneViability({ symbol: "DIPK2A", ensemblId: "ENSG00000181744" }, replayFetch("DIPK2A"));
  assert.equal(dipk2a.gnomad.loeuf, 0.96);
  assert.ok(dipk2a.gnomad.pLI < 0.1);
  for (const v of [tp53, dipk2a]) {
    const text = describeViability(v);
    assert.match(text, /pLI .*LOEUF/); assert.match(text, /DepMap/); assert.match(text, /not iPSCs/);
  }
  // not retrieved is said, not replaced by a number
  const failed = await queryGeneViability({ symbol: "TP53" }, async () => ({ ok: false, status: 503 }));
  assert.equal(failed.ok, false);
  assert.match(describeViability(failed), /not retrieved/);
  assert.equal((await queryGeneViability({ symbol: "TP53" }, null)).ok, false);
  assert.equal((await queryGeneViability({ symbol: "" }, replayFetch("TP53"))).ok, false);
  assert.equal(summariseViability({ geneticConstraint: [], depMapEssentiality: [] }, null).gnomad, null);
});

test("cut-level coverage: which annotated transcripts contain each cut of the TP53 designs", () => {
  const fx = fixtures.TP53; const raw = record("TP53"); const model = modelOf("TP53");
  const mapper = makeCutMapper({ isoformAnalysis: fx.isoformAnalysis, model, genbankRaw: raw, ensembl: fx.ensembl });
  assert.match(mapper.basis, /NCBI Datasets exon coordinates/);
  const refseq = fx.isoformAnalysis.genomic.isoforms.map(i => ({ id: i.id, name: i.id, segs: i.segs }));
  const all = candidatesOf(model);
  const at = spacer => { const g = all.find(x => x.sp === spacer); const position = mapper.toGenomic(g.cut); return { position, refseq: coverageAtCut(refseq, position), ensembl: coverageAtCut(fx.ensembl.transcripts, position) }; };
  // an exon-4 pair that covers every transcript, and two exon-3 and exon-4 guides that do not
  const wide = at("GTGCTGTGACTGCTTGTAGA");
  assert.deepEqual([wide.refseq.covered, wide.refseq.total, wide.ensembl.covered, wide.ensembl.total], [25, 25, 34, 34]);
  const narrow = at("CGTCTGGGCTTCTTGCATTC");
  assert.equal(narrow.refseq.total, 25); assert.equal(narrow.ensembl.total, 34);
  assert.ok(narrow.refseq.covered < 25 && narrow.ensembl.covered < 34);
  assert.ok(narrow.refseq.missing.includes("NM_001276697.3"), "an N-terminally truncated RefSeq isoform lacks the cut");
  assert.ok(narrow.ensembl.missing.every(name => /^TP53-\d+$/.test(name)));
  const mid = at("AATCAACCCACAGCTGCACA");
  assert.deepEqual(mid.ensembl.missing.sort(), ["TP53-221", "TP53-222", "TP53-223"]);
  // the report text names the transcripts that do not contain the cut
  const summary = summariseCutCoverage({ cuts: [{ label: "g1", spacer: "AATCAACCCACAGCTGCACA", genomicCut: mid.position }], refseq, ensembl: fx.ensembl, basis: mapper.basis });
  assert.equal(summary.ok, true);
  assert.match(describeCutCoverage(summary).join(" "), /Ensembl 31\/34 \(not covered: TP53-221, TP53-222, TP53-223\)/);
  assert.equal(genomicPositionOfCut(fx.isoformAnalysis, 0, 5) !== null, true);
  assert.equal(genomicPositionOfCut(null, 0, 5), null);
});

test("cut-level coverage for DIPK2A rests on coordinates that were checked, and names the transcript that lacks exon 2", () => {
  const fx = fixtures.DIPK2A; const raw = record("DIPK2A"); const model = modelOf("DIPK2A");
  const mapper = makeCutMapper({ isoformAnalysis: fx.isoformAnalysis, model, genbankRaw: raw, ensembl: fx.ensembl });
  assert.match(mapper.basis, /checked against the coding segments of an Ensembl transcript/);
  const g = candidatesOf(model).find(x => x.sp === "ATTATGTTGGAGAAGAACTG");
  const cover = coverageAtCut(fx.ensembl.transcripts, mapper.toGenomic(g.cut));
  assert.equal(`${cover.covered}/${cover.total}`, "5/6"); assert.deepEqual(cover.missing, ["DIPK2A-209"]);
  // without Ensembl the coordinates cannot be checked, so no coverage is claimed
  const unchecked = makeCutMapper({ isoformAnalysis: fx.isoformAnalysis, model, genbankRaw: raw, ensembl: { ok: false } });
  assert.equal(unchecked.basis, null); assert.equal(unchecked.toGenomic(g.cut), null);
  const none = summariseCutCoverage({ cuts: [{ label: "g1", spacer: g.sp, genomicCut: null }], refseq: null, ensembl: { ok: false, error: "no network access" }, basis: null });
  assert.equal(none.ok, false);
  assert.match(describeCutCoverage(none)[0], /not assessed/);
});

test("transcript coverage is a ranking key: equal coverage changes nothing, a cut in fewer transcripts ranks behind", () => {
  const model = modelOf("DIPK2A"); const candidates = candidatesOf(model); const scorer = createKoOutcomeScorer(model, lindel);
  const plain = selectFunctionalKoGuides(model, candidates, { koScorer: scorer });
  const uniform = selectFunctionalKoGuides(model, candidates, { koScorer: scorer, cutCoverage: () => 5 / 6 });
  const keys = r => r.pair.guides.map(g => g.sp).join("+");
  assert.equal(keys(uniform), keys(plain), "a coverage shared by every guide leaves the choice unchanged");
  const upstream = plain.pair.guides.reduce((a, b) => (a.cut < b.cut ? a : b));
  const penalised = selectFunctionalKoGuides(model, candidates, { koScorer: scorer, cutCoverage: cut => (cut <= upstream.cut ? 0.5 : 5 / 6) });
  assert.ok(!penalised.pair.guides.some(g => g.cut <= upstream.cut), "no guide whose cut lies in fewer transcripts is chosen while others reach more");
  const rows = rankKoSingles(model, candidates, { koScorer: scorer, cutCoverage: cut => (cut <= upstream.cut ? 0.5 : 5 / 6) }).rows;
  assert.ok(rows.some(r => r.cutCoverage === 0.5) && rows.some(r => r.cutCoverage > 0.8), "both kinds of guide are listed");
  for (const tier of new Set(rows.map(r => r.assessment.tier))) {
    const coverage = rows.filter(r => r.assessment.tier === tier).map(r => r.cutCoverage);
    assert.deepEqual(coverage, [...coverage].sort((x, y) => y - x), `within the ${tier} tier a cut in more transcripts ranks first`);
  }
  const picker = buildKoPicker(model, candidates, { koScorer: scorer, cutCoverage: () => 5 / 6 });
  assert.ok(picker.rows.every(r => r.isoformCoveragePct === 83.3));
  assert.ok(buildKoPicker(model, candidates, { koScorer: scorer }).rows.every(r => r.isoformCoveragePct === undefined));
});

test("the agent reports constraint and cut-level coverage for TP53 and says what the transcript evidence changed", async () => {
  const fx = fixtures.TP53; const raw = record("TP53");
  const res = await runBiomniCoScientist("Design a biallelic knockout for TP53", { id: "p", gene: "TP53", genbankRaw: raw, options: { enzyme: "spcas9" } },
    { fetchFn: replayFetch("TP53"), preloadedLindel: lindel, reuse: { gene: "TP53", mutation: "", isoformAnalysis: fx.isoformAnalysis, uniprot: { found: false }, clinvar: { variants: [] } } });
  const status = Object.fromEntries(res.steps.map(s => [s.id, s.status]));
  assert.equal(status.query_gene_viability, "completed"); assert.equal(status.check_cut_isoform_coverage, "completed");
  assert.equal(res.viability.ok, true); assert.equal(res.viability.gnomad.loeuf, 0.42);
  assert.equal(res.cutCoverage.ok, true);
  for (const g of res.cutCoverage.guides) { assert.equal(`${g.refseq.covered}/${g.refseq.total}`, "25/25"); assert.equal(`${g.ensembl.covered}/${g.ensembl.total}`, "34/34"); }
  const change = res.designResult.pairChangedByIsoformEvidence;
  assert.ok(change && change.before.length === 2 && change.after.length === 2);
  assert.ok(change.beforeIsoformCoveragePct.some(p => p < 100) && change.afterIsoformCoveragePct.every(p => p === 100));
  assert.notEqual(res.designResult.procurement.status, "ready");
  const html = appendBiomniSummary("<html><body></body></html>", res, res.designResult);
  assert.match(html, /Gene constraint and essentiality/); assert.match(html, /Transcripts that contain each cut/); assert.match(html, /Pair changed by transcript evidence/);
  assert.match(html, /Ensembl 34\/34/);
});

test("without the network the agent says constraint and coverage were not assessed, and the pair is the single-record selector's", async () => {
  const raw = record("DIPK2A");
  const res = await runBiomniCoScientist("Design a biallelic knockout for DIPK2A", { id: "p", gene: "DIPK2A", genbankRaw: raw, options: { enzyme: "spcas9" } },
    { fetchFn: async () => ({ ok: false, status: 503 }), preloadedLindel: lindel });
  assert.equal(res.viability.ok, false); assert.equal(res.cutCoverage.ok, false);
  assert.equal(res.designResult.pairChangedByIsoformEvidence, undefined);
  assert.match(describeCutCoverage(res.cutCoverage)[0], /not assessed/);
  const html = appendBiomniSummary("<html><body></body></html>", res, res.designResult);
  assert.match(html, /not retrieved/); assert.match(html, /not assessed/);
});

test("Cas-OFFinder input: genome line, pattern, one line per guide; refused where its format does not apply", () => {
  const result = runDesign("ko", record("TP53"), "", "", "", koOptions("TP53"));
  const built = buildCasOffinderInput(result);
  assert.equal(built.ok, true);
  const lines = built.text.trimEnd().split("\n");
  assert.equal(lines.length, 2 + result.gs.length);
  assert.equal(lines[1], "NNNNNNNNNNNNNNNNNNNNNGG");
  result.gs.forEach((g, i) => assert.equal(lines[2 + i], `${g.sp}NNN 3`));
  assert.match(built.notes.join(" "), /not assessed/);
  assert.equal(buildCasOffinderInput({ gs: [] }).ok, false);
  assert.equal(buildCasOffinderInput({ ...result, enzyme: "cas12a" }).ok, false);
});
