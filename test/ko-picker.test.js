import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesign, previewKoPair } from "../src/engine/design/designEngine.js";
import { buildDesignSummary, buildReportHtml } from "../src/engine/design/reportHtml.js";
import { loadLindel } from "../src/engine/design/lindel/loadLindel.js";
import { runBiomniCoScientist } from "../src/services/biomniAgent.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIPK2A = fs.readFileSync(path.join(HERE, "..", "public", "references", "dipk2a-region.gb"), "utf8");
const lindel = await loadLindel();
const design = (extra = {}) => runDesign("ko", DIPK2A, "", "", 400, { expectedGene: "DIPK2A", deliveryMethod: "rnp", koLindel: lindel, ...extra });
const RECOMMENDED = ["ATTATGTTGGAGAAGAACTG", "TTTCCATTAATTGCCAAGCG"];
const MANUAL = ["GAGTTACTTTAATGCGCCAT", "TTTCCATTAATTGCCAAGCG"];

test("a knockout design lists the ranked guides with their predicted outcomes, in the selector's order, and contains the chosen pair", () => {
  const r = design();
  const picker = r.koPicker;
  assert.equal(picker.eligible, 50); assert.equal(picker.listed, 50); assert.match(picker.outcomeModel, /Lindel/);
  assert.deepEqual(picker.rows.map(row => row.rank), picker.rows.map((_, i) => i + 1));
  for (const spacer of RECOMMENDED) assert.ok(picker.rows.find(row => row.spacer === spacer), spacer);
  const row = picker.rows.find(x => x.spacer === "ATTATGTTGGAGAAGAACTG");
  assert.deepEqual([row.gc, row.gcPenaltyPts, row.lofPct, row.effectiveLofPct, row.exon], [35, 10, 86.9, 76.9, 2]);
  for (const x of picker.rows) for (const key of ["spacer", "strand", "cut", "tier", "lofPct", "frameshiftPct", "plus1Pct", "inframePct", "biallelicPct", "offsetInExon"]) assert.ok(x[key] !== undefined && x[key] !== null, `${x.spacer} ${key}`);
  assert.equal(r.koPairChoice.source, "selector"); assert.deepEqual(r.koPairChoice.pair, RECOMMENDED); assert.equal(r.koPairChoice.minLofPct, 86.9);
  assert.equal(describe(r), "", "no pair-choice wording when the selector's pair is used");
});
const describe = (r) => buildDesignSummary(r).split("\n").filter(line => /chosen by the user|Selector's recommendation/.test(line)).join("\n");

test("without a repair-outcome model the list is still there, without predicted outcomes", () => {
  const r = runDesign("ko", DIPK2A, "", "", 400, { expectedGene: "DIPK2A" });
  assert.equal(r.koPicker.outcomeModel, null); assert.ok(r.koPicker.rows.every(row => row.lofPct === null && row.effectiveLofPct === null));
  assert.equal(r.koPairChoice.minLofPct, null);
});

test("choosing a pair regenerates the design for it, keeps the list, and records the selector's recommendation for comparison", () => {
  const r = design({ customGuides: MANUAL });
  assert.deepEqual(r.gs.map(g => g.sp), MANUAL);
  assert.equal(r.koPicker.listed, 50);
  assert.equal(r.koPairChoice.source, "user");
  assert.deepEqual(r.koPairChoice.recommended.pair, RECOMMENDED); assert.equal(r.koPairChoice.recommended.minLofPct, 86.9); assert.equal(r.koPairChoice.minLofPct, 75.2);
  assert.equal(r.deletionOutcome.deletionSize, 25); assert.match(r.amp, /WT ~477 bp \| deletion ~452 bp/);
  // the report states the deletion, the choice and the comparison
  const text = buildDesignSummary(r);
  assert.match(text, /Guide pair chosen by the user from the ranked list/);
  assert.match(text, /Selector's recommendation: ATTATGTTGGAGAAGAACTG \+ TTTCCATTAATTGCCAAGCG \(weaker guide predicted LoF 86\.9%\)\. This pair: GAGTTACTTTAATGCGCCAT \+ TTTCCATTAATTGCCAAGCG \(75\.2%\)/);
  const html = buildReportHtml({ projectType: "ko", gene: "DIPK2A" }, r, "DIPK2A.gb", null, [], null);
  assert.match(html, /Guide pair<\/th><td>Guide pair chosen by the user/); assert.match(html, /Expected excision<\/th><td>25 bp/);
});

test("choosing the selector's own pair by hand is not reported as a user choice", () => {
  const r = design({ customGuides: [...RECOMMENDED].reverse() });
  assert.equal(r.koPairChoice.source, "selector"); assert.equal(describe(r), "");
});

test("pair preview: deletion between the cuts, frame, tier, weaker guide's predicted LoF", () => {
  const rows = design().koPicker.rows; const pick = (...sp) => sp.map(s => rows.find(x => x.spacer === s));
  const p = previewKoPair(DIPK2A, pick(...RECOMMENDED), { expectedGene: "DIPK2A" });
  assert.equal(p.ok, true); assert.deepEqual([p.spacing, p.deletionMod3, p.frameshiftPredicted, p.tier, p.minLofPct, p.expectedBiallelicPct], [47, 2, true, "robust", 86.9, 75.5]);
  assert.ok(p.warnings.some(w => /ATTATGTTGGAGAAGAACTG has 35% GC \(10-point penalty/.test(w)));
  const manual = previewKoPair(DIPK2A, pick(...MANUAL), { expectedGene: "DIPK2A" });
  assert.equal(manual.spacing, 25); assert.equal(manual.minLofPct, 75.2); assert.deepEqual(manual.warnings, []);
  // the preview agrees with the design it announces
  assert.equal(design({ customGuides: MANUAL }).deletionOutcome.deletionSize, manual.spacing);
});

test("pair preview refuses what the design refuses and warns about what the report will state", () => {
  const rows = design().koPicker.rows; const row = s => rows.find(x => x.spacer === s);
  assert.deepEqual(previewKoPair(DIPK2A, [row(MANUAL[0])]).errors, ["Choose exactly two guides."]);
  assert.match(previewKoPair(DIPK2A, [row(MANUAL[0]), row(MANUAL[0])]).errors.join(" "), /same/);
  assert.match(previewKoPair(DIPK2A, [row(MANUAL[0]), { ...row(MANUAL[1]), cut: row(MANUAL[0]).cut }]).errors.join(" "), /same position/);
  const near = previewKoPair(DIPK2A, [row("TGACCTCGCTTGGCAATTAA"), row("TTTCCATTAATTGCCAAGCG")]);   // cuts 8 bp apart
  assert.equal(near.ok, true); assert.equal(near.spacing, 8); assert.ok(near.warnings.some(w => /8 bp apart; the selector searches 10-140 bp/.test(w)));
  const weak = rows.filter(x => x.lofPct < 60).slice(0, 1).concat(row(RECOMMENDED[1]));
  assert.ok(previewKoPair(DIPK2A, weak).warnings.some(w => /below 60%/.test(w)));
  assert.equal(previewKoPair("", [row(MANUAL[0]), row(MANUAL[1])]).ok, false);
});

test("choosing a pair does not repeat the gene-level lookups: isoforms, protein and ClinVar of the earlier run are reused for the same gene only", async () => {
  const calls = [];
  const fetchFn = async (url) => { calls.push(String(url)); return { ok: false, status: 404 }; };
  const project = { id: "p", gene: "DIPK2A", genbankRaw: DIPK2A, options: { enzyme: "spcas9" } };
  const first = await runBiomniCoScientist("Design a biallelic knockout for DIPK2A", project, { fetchFn, preloadedLindel: lindel });
  const uniprot = { ok: true, accession: "Q8NDZ4", domains: [], pLI: null, loeuf: null, depmapChronos: null, essentialityTier: "unknown", constraintSummary: null };
  calls.length = 0;
  const initial = design({ customGuides: MANUAL });
  const again = await runBiomniCoScientist("Design a biallelic knockout for DIPK2A", project, { fetchFn, preloadedLindel: lindel, initialDesignResult: initial, preserveCustomGuides: true,
    intentOverride: { gene: "DIPK2A", editType: "ko", mutation: "", tag: "FLAG", enzyme: "spcas9" }, reuse: { gene: "DIPK2A", mutation: "", isoformAnalysis: first.isoformAnalysis, uniprot, clinvar: null } });
  assert.ok(!calls.some(url => /uniprot/.test(url)), "no UniProt request");
  const byTool = Object.fromEntries(again.steps.map(s => [s.tool, s.output]));
  assert.equal(byTool.query_uniprot_protein.reusedFromEarlierRun, true); assert.equal(byTool.analyze_common_isoform_exons.reusedFromEarlierRun, true);
  assert.deepEqual(again.designResult.gs.map(g => g.sp), MANUAL, "the chosen pair is kept; nothing re-selects it");
  assert.equal(again.lindelRanking.displayGuides.filter(g => g.selected_in_pair).length, 2);
  // a different gene never reuses
  calls.length = 0;
  await runBiomniCoScientist("Design a biallelic knockout for DIPK2A", project, { fetchFn, preloadedLindel: lindel, reuse: { gene: "TP53", isoformAnalysis: first.isoformAnalysis, uniprot } });
  assert.ok(calls.some(url => /uniprot/.test(url)), "UniProt is asked again when the reused lookups belong to another gene");
});
