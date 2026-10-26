import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// The guide picker was rendered as a collapsed section after the 740 px report, so it was easy to miss. It now comes before the report and is open.
async function render(designResultFor) {
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "error" });
  try {
    const { runDesign } = await vite.ssrLoadModule("/src/engine/design/designEngine.js");
    const { DesignView } = await vite.ssrLoadModule("/src/components/design/DesignView.jsx");
    const { createProject } = await vite.ssrLoadModule("/src/services/projectState.js");
    const { loadLindel } = await vite.ssrLoadModule("/src/engine/design/lindel/loadLindel.js");
    const genbank = fs.readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");
    const koLindel = await loadLindel();
    const result = designResultFor(runDesign("ko", genbank, "", "", "", { enzyme: "spcas9", expectedGene: "DIPK2A", ensureGuidePair: true, allowNonCodingBlockers: true, koLindel }));
    const project = { ...createProject(), gene: "DIPK2A", editType: "ko", genbankRaw: genbank, geneMeta: { geneSymbol: "DIPK2A" }, designResult: result, options: { enzyme: "spcas9" } };
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
