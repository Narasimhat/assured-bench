// The take-home message of a design (src/services/takeHome.js) and where it appears in the report.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runDesign, summarizeProcurementReadiness } from "../src/engine/design/designEngine.js";
import { loadLindel } from "../src/engine/design/lindel/loadLindel.js";
import { buildTakeHome, takeHomeLines } from "../src/services/takeHome.js";
import { generateReportHtml, renderTakeHomeHtml, withPrintOpeningFolds } from "../src/services/designExport.js";
import { parseDesignReport } from "../src/engine/qc/designReport.js";

const lindel = await loadLindel();
const read = name => fs.readFileSync(new URL(`../public/references/${name}`, import.meta.url), "utf8");
const dipk2a = read("dipk2a-region.gb");
const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/isoform-evidence.json", import.meta.url), "utf8")).genes;
const ko = (raw, gene, extra = {}) => { const r = runDesign("ko", raw, "", "", "", { enzyme: "spcas9", expectedGene: gene, koLindel: lindel, ensureGuidePair: true, allowNonCodingBlockers: true, ...extra }); r.procurement = summarizeProcurementReadiness(r); return r; };
const words = text => text.split(/\s+/).filter(Boolean).length;

const guide = { refseq: { covered: 3, total: 3, missing: [] }, ensembl: { covered: 5, total: 6, missing: ["DIPK2A-209"] } };
const report = {
  cutCoverage: { ok: true, guides: [guide, guide] },
  screeningPower: { ok: true, predictedBiallelicClonePct: 60.4, recommendedClonesToScreen: 6, plates96Well: 1, mode: "Biallelic LoF knockout", model: "m", assumptions: [] },
  genotypingAssay: { ok: true, wtAmpliconBp: 477, editedAmpliconBp: 430, deletionBp: 47 },
  variantScreen: { ok: true, status: "flagged", guideChecks: [{ label: "DIPK2A_KO_gRNA2", variants: [{ rsid: "rs9847681", class: "common", maf: 0.05218, allele: "T", location: { label: "spacer position 20 (PAM-adjacent)" } }] }] },
};

test("take-home for a good knockout: what, so what, four numbers, what to watch, what to do", () => {
  const t = buildTakeHome({ designResult: ko(dipk2a, "DIPK2A"), biomniReport: report });
  assert.match(t.headline, /^Two guides cut 47 bp apart in exon 2 of DIPK2A; the segment between them is deleted and the reading frame shifts\.$/);
  assert.match(t.bottomLine, /^Use this pair\. Frameshifts are predicted to trigger nonsense-mediated decay; the weaker guide gives at least 86\.9% loss-of-function alleles\./);
  assert.match(t.bottomLine, /Main risk: NM_001134470\.2, NM_001363944\.1 may still make protein\.$/);
  assert.equal(t.status.label, "Review before ordering");
  assert.deepEqual(t.facts.map(f => f.label), ["Guides", "Predicted protein loss", "Transcripts hit", "Clones to screen"]);
  assert.equal(t.facts[1].value, "\u2265 86.9%");
  assert.equal(t.facts[2].value, "3/3 RefSeq \u00b7 5/6 Ensembl");
  assert.equal(t.facts[3].value, "6"); assert.match(t.facts[3].note, /PCR 477 \u2192 430 bp/);
  assert.equal(t.nextSteps.length, 3); assert.match(t.nextSteps[2], /6 clones.*477 bp.*430 bp.*Western/);
  const text = takeHomeLines(t).join(" ");
  assert.ok(words(text) < 260, `the take-home stays short (${words(text)} words)`);
  assert.ok(t.watch.length <= 4);
});

test("watch-points: isoforms and common variants named, off-targets always said, nothing invented", () => {
  const t = buildTakeHome({ designResult: ko(dipk2a, "DIPK2A"), biomniReport: report });
  const keys = t.watch.map(w => w.key);
  assert.deepEqual(keys, ["isoforms", "variants", "offtargets"]);
  assert.match(t.watch[0].text, /NM_001134470\.2.*may still make protein; the cut is outside DIPK2A-209/);
  assert.match(t.watch[1].text, /rs9847681.*PAM-adjacent.*T allele 5\.2%.*check your line's genotype/);
  assert.match(t.watch.at(-1).text, /Off-targets are not checked/);
  // no report at all: only what the design itself knows, and the transcript check is said to be missing
  const bare = buildTakeHome({ designResult: ko(dipk2a, "DIPK2A"), biomniReport: null });
  assert.equal(bare.facts[2].value, "not checked"); assert.equal(bare.facts[3].value, "not estimated");
  assert.ok(bare.watch.some(w => w.key === "isoforms") && bare.watch.at(-1).key === "offtargets");
  // a screen that could not run is said, not read as clean
  const unchecked = buildTakeHome({ designResult: ko(dipk2a, "DIPK2A"), biomniReport: { ...report, variantScreen: { ok: false, status: "not_assessed" } } });
  assert.match(unchecked.watch.find(w => w.key === "variants").text, /not checked/);
});

test("gene constraint: constrained or essential or growth-advantage genes are flagged, a neutral gene is not", () => {
  const target = fixtures.TP53.openTargets.target;
  const viab = (patch = {}) => ({ ok: true, gnomad: { pLI: 1, loeuf: 0.42 }, depmap: { screens: 1258, medianGeneEffect: 0.24, screensAtOrBelowCutoff: 5 }, ...patch });
  const flag = v => buildTakeHome({ designResult: ko(dipk2a, "DIPK2A"), biomniReport: { ...report, viability: v } }).watch.find(w => w.key === "constraint");
  assert.match(flag(viab()).text, /^Constrained gene \(pLI 1, LOEUF 0\.42\); DepMap suggests cells grow faster without it \(\+0\.24\)\. Expect selection against knockout clones\.$/);
  assert.match(flag(viab({ gnomad: { pLI: 0, loeuf: 0.96 }, depmap: { screens: 1258, medianGeneEffect: -0.7, screensAtOrBelowCutoff: 900 } })).text, /essential in most cancer cell lines/i);
  assert.match(flag(viab({ gnomad: { pLI: 0, loeuf: 0.96 }, depmap: { screens: 1258, medianGeneEffect: 0.31, screensAtOrBelowCutoff: 0 } })).text, /grow faster without it.*outgrow/);
  // DIPK2A-like: one screen in 1258 at the cut-off is noise, not a dependency
  assert.equal(flag(viab({ gnomad: { pLI: 0, loeuf: 0.96 }, depmap: { screens: 1258, medianGeneEffect: 0.06, screensAtOrBelowCutoff: 1 } })), undefined);
  assert.match(flag({ ok: false, error: "x" }).text, /could not be retrieved/);
  assert.equal(target.target.approvedSymbol, "TP53");
});

test("a pair whose frameshifts escape decay is not recommended; a hand-chosen pair is named as such", () => {
  const base = ko(dipk2a, "DIPK2A");
  const escape = buildTakeHome({ designResult: { ...base, koAssessment: { ...base.koAssessment, tier: "escape", summary: "Some frameshifts escape nonsense-mediated decay." } }, biomniReport: report });
  assert.match(escape.bottomLine, /^Do not order this pair/);
  assert.equal(escape.watch[0].tone, "bad");
  const chosen = buildTakeHome({ designResult: { ...base, koPairChoice: { source: "user", pair: base.gs.map(g => g.sp), minLofPct: 75.2, recommended: { pair: ["A", "B"], minLofPct: 86.9 } } }, biomniReport: report });
  assert.match(chosen.bottomLine, /^You chose this pair \(weaker guide 75\.2%; the selector's pair 86\.9%\)\. Use this pair\./);
});

test("other edit types get a short generic take-home from their own status and warnings", () => {
  const t = buildTakeHome({ designResult: { type: "pm", gene: "TP53", mutation: "R175H", gs: [{ n: "g1", sp: "ACGTACGTACGTACGTACGT", pm: "TGG", str: "+" }], dl: 120, amp: "WT ~480 bp", procurement: { status: "blocked", blockers: ["No silent blocking mutation is possible."], warnings: ["Check specificity."] } } });
  assert.match(t.headline, /^Point mutation of TP53 \(R175H\): 1 guide and a 120 bp donor\.$/);
  assert.equal(t.status.tone, "bad"); assert.equal(t.watch[0].tone, "bad"); assert.match(t.watch[0].text, /No silent blocking mutation/);
  assert.equal(buildTakeHome({ designResult: { err: "x" } }), null); assert.equal(buildTakeHome({}), null);
});

test("the report opens with the take-home, keeps the guide table the QC importer reads, and shows far less by default", () => {
  const result = ko(dipk2a, "DIPK2A");
  const html = generateReportHtml({ gene: "DIPK2A", editType: "ko", options: {}, biomniReport: report, genbankRaw: dipk2a }, result);
  const home = html.indexOf('<section class="th"'), guides = html.indexOf("<h2>gRNA Sequences</h2>");
  assert.ok(home > 0 && home < guides, "take-home first");
  assert.match(html.slice(home, guides), /Use this pair\./);
  assert.doesNotMatch(html, /<!--TAKEHOME-->|<!--EVIDENCE-->/, "placeholders are always replaced");
  // detail sections are closed folds; only a blocked design opens its review items
  for (const title of ["Release status and summary", "Knockout Design", "Design Readiness", "Review Checkpoints"]) assert.match(html, new RegExp(`<details class="fold"><summary>${title}`), title);
  assert.doesNotMatch(html, /<script>/, "no script in the in-app preview");
  assert.match(withPrintOpeningFolds(html), /beforeprint/);
  // the Studio/QC import reads this report back
  const parsed = parseDesignReport(html);
  assert.equal(parsed.length, 1); assert.deepEqual(parsed[0].guides.map(g => g.sequence), result.gs.map(g => g.sp));
  // visible without opening a fold
  let visible = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ");
  const all = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ");
  assert.ok(words(visible) < 520, `visible by default: ${words(visible)} words`);
  assert.ok(words(all) > 3 * words(visible), "the detail is still in the file, behind the folds");
  // a blocked design opens its release status
  const blocked = generateReportHtml({ gene: "DIPK2A", editType: "ko", options: {}, biomniReport: null, genbankRaw: dipk2a }, { ...result, procurement: { ...result.procurement, status: "blocked", blockers: ["x"] } });
  assert.match(blocked, /<details class="fold" open><summary>Release status and summary/);
});

test("take-home text from data is escaped in the report", () => {
  const html = renderTakeHomeHtml({ status: { tone: "warn", label: "Review <b>", detail: "" }, headline: "<img src=x onerror=1>", bottomLine: "a & b", facts: [{ label: "L", value: "<script>", note: "" }], watch: [{ tone: "warn", text: "\"quoted\"" }], watchMore: 0, nextSteps: ["<i>"] });
  assert.doesNotMatch(html, /<img|<script>|<b>|<i>/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/); assert.match(html, /a &amp; b/);
});
