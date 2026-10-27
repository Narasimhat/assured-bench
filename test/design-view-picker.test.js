import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { runBiomniCoScientist } from "../src/services/biomniAgent.js";
import { summariseViability } from "../src/services/geneViability.js";
import { loadLindel as loadLindelNative } from "../src/engine/design/lindel/loadLindel.js";

// The guide picker was rendered as a collapsed section after the 740 px report, so it was easy to miss. It now comes before the report and is open.
async function render(designResultFor, biomniReport = null) {
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "error" });
  try {
    const { runDesign } = await vite.ssrLoadModule("/src/engine/design/designEngine.js");
    const { DesignView } = await vite.ssrLoadModule("/src/components/design/DesignView.jsx");
    const { createProject } = await vite.ssrLoadModule("/src/services/projectState.js");
    const { loadLindel } = await vite.ssrLoadModule("/src/engine/design/lindel/loadLindel.js");
    const genbank = fs.readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");
    const koLindel = await loadLindel();
    const result = designResultFor(runDesign("ko", genbank, "", "", "", { enzyme: "spcas9", expectedGene: "DIPK2A", ensureGuidePair: true, allowNonCodingBlockers: true, koLindel }));
    const project = { ...createProject(), gene: "DIPK2A", editType: "ko", genbankRaw: genbank, geneMeta: { geneSymbol: "DIPK2A" }, designResult: result, biomniReport, options: { enzyme: "spcas9" } };
    return renderToStaticMarkup(React.createElement(DesignView, { currentProject: project, onUpdateProject() {}, onProceedToOrder() {}, onProceedToQc() {}, onLoadPreset() {} }));
  } finally { await vite.close(); }
}

test("result mode shows the selected design and reagents, with report and alternatives in dedicated views", async () => {
  const html = await render(result => result);
  assert.match(html, /id="bench-design-result"/);
  assert.match(html, /id="bench-take-home"/);
  assert.match(html, /Selected reagents/);
  assert.match(html, /Open scientific report/);
  assert.match(html, /Alternative guides/);
  assert.match(html, /Analysis &amp; evidence/);
  assert.doesNotMatch(html, /<details|<iframe|1\. Design your edit|aria-label="Enzyme"/);
  assert.match(html, /Edit design/);
  assert.equal((html.match(/Review &amp; export order/g) || []).length, 1, "one primary continuation action");
});

test("saved knockout designs without a guide list still expose the alternative-guide view", async () => {
  const html = await render(result => ({ ...result, koPicker: null }));
  assert.match(html, /Alternative guides/);
  assert.match(html, /Selected reagents/);
});

test("the take-home states the transcripts hit, the watch-points and the next steps; the Cas-OFFinder input is one click away", async () => {
  const genbank = fs.readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");
  // a real Co-Scientist report (no network: constraint and coverage come back as not assessed), then given what a connected run would find
  const report = await runBiomniCoScientist("Design a biallelic knockout for DIPK2A", { id: "p", gene: "DIPK2A", genbankRaw: genbank, options: { enzyme: "spcas9" } },
    { fetchFn: async () => ({ ok: false, status: 503 }), preloadedLindel: await loadLindelNative() });
  const guide = { refseq: { covered: 3, total: 3, missing: [] }, ensembl: { covered: 5, total: 6, missing: ["DIPK2A-209"] } };
  const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/isoform-evidence.json", import.meta.url), "utf8")).genes.TP53.openTargets.target;
  const viability = { ok: true, source: "Open Targets Platform", ...summariseViability(fx.target, fx.meta) };
  const html = await render(result => result, { ...report, viability, cutCoverage: { ok: true, guides: [guide, guide], basis: "test" } });
  const home = html.slice(html.indexOf('id="bench-take-home"'), html.indexOf('class="card design-result-reagents"'));
  assert.match(home, /Review before ordering/);
  assert.match(home, /Two guides cut \d+ bp apart in exon 2 of DIPK2A/);
  assert.match(home, /3\/3 RefSeq/); assert.match(home, /5\/6 Ensembl/);
  assert.match(home, /Constrained gene \(pLI 1/);
  assert.match(home, /DIPK2A-209/);
  assert.match(home, /Off-targets are not checked/);
  assert.match(home, /Review &amp; export order/); assert.match(home, /Cas-OFFinder input/); assert.match(home, /Open scientific report/);
  // The process view is mounted only when requested.
  assert.match(html, /Analysis &amp; evidence/);
  assert.doesNotMatch(html, /Advanced: Co-Scientist/);
  const none = await render(result => result, report);
  assert.match(none.slice(none.indexOf('id="bench-take-home"'), none.indexOf('id="bench-ko-picker"')), /Transcripts hit/);
});

test("the picker does not show 0% for 'other isoforms left intact' when the reference annotates only one coding sequence", async () => {
  const tp53 = fs.readFileSync(new URL("../public/references/tp53-NG_017013.2.gb", import.meta.url), "utf8");
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "error" });
  try {
    const { runDesign } = await vite.ssrLoadModule("/src/engine/design/designEngine.js");
    const { KoGuidePicker } = await vite.ssrLoadModule("/src/components/design/KoGuidePicker.jsx");
    const koLindel = await loadLindelNative();
    const markup = (gene, raw) => {
      const result = runDesign("ko", raw, "", "", "", { enzyme: "spcas9", expectedGene: gene, ensureGuidePair: true, allowNonCodingBlockers: true, koLindel });
      return { result, html: renderToStaticMarkup(React.createElement(KoGuidePicker, { result, genbankRaw: raw, geneSymbol: gene, onUsePair() {}, onUseRecommended() {}, defaultShowDetails: true, defaultShowAll: true })) };
    };
    const one = markup("TP53", tp53);
    assert.equal(one.result.koPicker.isoformsEvaluated, 1);
    assert.match(one.html, /only one coding sequence is annotated, so the column is not computed/);
    assert.equal((one.html.match(/<td[^>]*>\u2014<\/td>/g) || []).length, one.result.koPicker.rows.length, "one dash per guide, in that column only");
    const many = markup("DIPK2A", fs.readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8"));
    assert.equal(many.result.koPicker.isoformsEvaluated, 3);
    assert.doesNotMatch(many.html, /so the column is not computed/);
    assert.doesNotMatch(many.html, /<td[^>]*>\u2014<\/td>/);
    assert.match(many.html, /Share of this guide&#x27;s predicted repair outcomes after which at least one other annotated isoform/);
  } finally { await vite.close(); }
});

test("the picker shows the eight best guides first, the rest on request", async () => {
  const raw = fs.readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "error" });
  try {
    const { runDesign } = await vite.ssrLoadModule("/src/engine/design/designEngine.js");
    const { KoGuidePicker } = await vite.ssrLoadModule("/src/components/design/KoGuidePicker.jsx");
    const result = runDesign("ko", raw, "", "", "", { enzyme: "spcas9", expectedGene: "DIPK2A", ensureGuidePair: true, allowNonCodingBlockers: true, koLindel: await loadLindelNative() });
    const render = props => renderToStaticMarkup(React.createElement(KoGuidePicker, { result, genbankRaw: raw, geneSymbol: "DIPK2A", onUsePair() {}, onUseRecommended() {}, ...props }));
    const rows = html => (html.match(/<tr/g) || []).length - 1;
    const total = result.koPicker.rows.length;
    const short = render({});
    assert.ok(rows(short) >= 8 && rows(short) < total, `first view lists the best few of ${total}, not all (${rows(short)})`);
    assert.match(short, new RegExp(`Show all ${total} guides`));
    assert.doesNotMatch(short, /<th[^>]*>(Frameshift|In-frame|Other isoforms left intact)<\/th>/, "repair-outcome columns are closed");
    assert.match(render({ defaultShowDetails: true }), /<th[^>]*>Frameshift<\/th>/);
    assert.match(short, /Show repair-outcome columns/);
    assert.equal(rows(render({ defaultShowAll: true })), total);
    for (const spacer of result.gs.map(g => g.sp)) assert.ok(short.includes(spacer), "the guides in the design are always listed");
  } finally { await vite.close(); }
});
