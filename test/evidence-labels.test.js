import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { queryUniprotProtein, resolveBiomniGeneReference, buildBiomniPlan } from "../src/services/biomniAgent.js";
import { parseGB } from "../src/engine/design/designEngine.js";
import { appendBiomniSummary } from "../src/services/designExport.js";

test("live protein evidence does not imply available domains or population constraint", async () => {
  const live = await queryUniprotProtein("TP53", async () => ({ ok: true, json: async () => ({ results: [{ primaryAccession: "P04637", sequence: { length: 393 }, features: [] }] }) }));
  assert.equal(live.evidence.protein.type, "live");
  assert.equal(live.evidence.domains.type, "missing");
  assert.equal(live.pLI, null);
  const unavailable = await queryUniprotProtein("TP53", async () => { throw new Error("Offline"); });
  assert.equal(unavailable.evidence.protein.type, "missing");
  assert.equal(unavailable.ok, false);
});

test("bundled reference evidence reports base count rather than GenBank file length", async () => {
  const raw = readFileSync(new URL("../public/references/apoe-ensg00000130203.gb", import.meta.url), "utf8");
  const ref = await resolveBiomniGeneReference("APOE", async () => ({ ok: true, text: async () => raw }));
  assert.equal(ref.evidenceType, "bundled");
  assert.equal(ref.sequenceLength, parseGB(raw).seq.length);
  assert.notEqual(ref.sequenceLength, raw.length);
});

test("non-SpCas9 workflows do not receive SpCas9-only Lindel ranking", () => {
  const plan = buildBiomniPlan({ gene: "TP53", editType: "ko", enzyme: "mad7", wantsLindel: true });
  assert.equal(plan.some(p => p.tool === "rank_ko_guides_lindel"), false);
});

test("HTML evidence export escapes source text and keeps unknown evidence explicit", () => {
  const html = appendBiomniSummary("<body><!--EVIDENCE--></body>", {
    evidence: [{ topic: "Reference", type: "user-provided", source: "<script>bad()</script>" }, { topic: "Protein domains", type: "missing", source: "No live annotation" }],
  });
  assert.match(html, /Evidence sources and limitations/);
  assert.match(html, /Protein domains: missing/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
