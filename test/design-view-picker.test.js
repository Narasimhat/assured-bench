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

test("the knockout guide picker is open and placed before the design report", async () => {
  const html = await render(result => result);
  const picker = html.indexOf('id="bench-ko-picker"');
  const report = html.indexOf('title="ASSURED design report"');
  assert.ok(picker > 0 && report > 0, "both sections render");
  assert.ok(picker < report, "picker precedes the report");
  assert.match(html.slice(picker - 20, picker + 120), /<details[^>]*id="bench-ko-picker"[^>]*open/);
  assert.match(html, /Choose the guide pair \(\d+ guides ranked by predicted loss of function\)/);
  assert.ok((html.match(/aria-label="Use this pair|Use this pair/g) || []).length >= 1);
});

test("a knockout design without a guide list says why instead of showing nothing", async () => {
  const noPicker = await render(result => ({ ...result, koPicker: null }));
  assert.match(noPicker, /Guide list not available for this design/);
  assert.match(noPicker, /click Generate design/);
  const failed = await render(result => ({ ...result, koPicker: null, koPickerError: "boom" }));
  assert.match(failed, /could not be built \(boom\)/);
});

test("the Design screen shows how many annotated transcripts contain the cuts, and offers the Cas-OFFinder input", async () => {
  const genbank = fs.readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");
  // a real Co-Scientist report (no network: constraint and coverage come back as not assessed), then given the coverage a connected run would find
  const report = await runBiomniCoScientist("Design a biallelic knockout for DIPK2A", { id: "p", gene: "DIPK2A", genbankRaw: genbank, options: { enzyme: "spcas9" } },
    { fetchFn: async () => ({ ok: false, status: 503 }), preloadedLindel: await loadLindelNative() });
  const guide = { refseq: { covered: 3, total: 3, missing: [] }, ensembl: { covered: 5, total: 6, missing: ["DIPK2A-209"] } };
  const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/isoform-evidence.json", import.meta.url), "utf8")).genes.TP53.openTargets.target;
  const viability = { ok: true, source: "Open Targets Platform", ...summariseViability(fx.target, fx.meta) };
  const html = await render(result => result, { ...report, viability, cutCoverage: { ok: true, guides: [guide, guide], basis: "test" } });
  assert.match(html, /Gene constraint and essentiality/); assert.match(html, /loss-of-function constrained/);
  assert.match(html, /5 of \d+ DepMap screens depend on it/);
  assert.match(html, /Transcripts that contain each cut/); assert.match(html, /not covered: DIPK2A-209/);
  assert.match(html, /Cuts inside 3\/3 RefSeq, 5\/6 Ensembl transcripts/);
  assert.match(html, /Cas-OFFinder input/);
  const none = await render(result => result, report);
  assert.doesNotMatch(none, /Cuts inside/);
  assert.match(none, /Gene constraint and essentiality/); assert.match(none, /not retrieved/);
});
