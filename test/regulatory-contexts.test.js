import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BROAD_CONTEXT_IDS, REGULATORY_CONTEXT_CATALOG as catalog, buildRegulatoryContextPlan, regulatoryContextCoverage, validateRegulatoryContextPlan } from "../src/services/regulatoryContexts.js";
import { createProject, updateProject, parseProject } from "../src/services/projectState.js";
import { runDesign } from "../src/engine/design/designEngine.js";
import { generateReportHtml } from "../src/services/designExport.js";

test("the broad panel covers pluripotent, cardiac, neural, hepatic, pancreatic, vascular, renal, muscle and immune references without claiming exact matches", () => {
  const plan = buildRegulatoryContextPlan({ contextIds: BROAD_CONTEXT_IDS, pscLine: "Our iPSC clone", derivativeNotes: "Maturation stage pending" });
  assert.deepEqual([...new Set(plan.contexts.map(c => c.lineage))].sort(), ["Cardiac", "Hepatic", "Immune", "Muscle", "Neural", "Pancreatic", "Pluripotent", "Renal", "Vascular"]);
  assert.equal(plan.contexts.length, 10);
  assert.ok(plan.contexts.every(c => !c.experimentalMatchVerified));
  assert.equal(plan.experimentalContext.exactModelMatchVerified, false);
  assert.equal(plan.predictionPerformed, false);
  assert.equal(plan.executionReady, false);
  assert.equal(plan.experimentalContext.pscLine, "Our iPSC clone");
  assert.equal(catalog.contexts.length, 18);
  assert.ok(plan.contexts.every(c => c.outputTracks.RNA_SEQ && c.outputTracks.SPLICE_SITE_USAGE));
});

test("cell-specific coverage respects missing assays and does not borrow shared splice-site predictions", () => {
  assert.equal(regulatoryContextCoverage({ outputTracks: { SPLICE_SITES: 4 } }).splicing, false);
  const h1 = catalog.contexts.find(c => c.id === "h1");
  const wtc = catalog.contexts.find(c => c.id === "wtc11");
  const motor = catalog.contexts.find(c => c.id === "motor-neuron");
  assert.ok(!h1.outputTracks.ATAC && h1.outputTracks.DNASE);
  assert.ok(wtc.outputTracks.ATAC && wtc.outputTracks.CONTACT_MAPS);
  assert.deepEqual(wtc.assaySources.RNA_SEQ.biosampleNames, ["WTC11"]);
  assert.deepEqual(wtc.assaySources.CONTACT_MAPS.biosampleNames, ["GM25256"]);
  assert.ok(motor.outputTracks.ATAC && !motor.outputTracks.DNASE);
  assert.equal(regulatoryContextCoverage({ outputTracks: {} }).expression, false);
});

test("plans reject missing baselines, unknown contexts, invented coverage and claims of completed predictions", () => {
  assert.throws(() => buildRegulatoryContextPlan({ contextIds: ["cardiac"] }), /pluripotent/);
  assert.throws(() => buildRegulatoryContextPlan({ contextIds: ["made-up"] }), /Unknown/);
  assert.throws(() => buildRegulatoryContextPlan({ contextIds: ["wtc11", "wtc11"] }), /duplicate/);
  const plan = buildRegulatoryContextPlan({ contextIds: BROAD_CONTEXT_IDS });
  validateRegulatoryContextPlan(JSON.parse(JSON.stringify(plan)));
  const bad = structuredClone(plan);bad.contexts[0].outputTracks.CONTACT_MAPS = 20;
  assert.throws(() => validateRegulatoryContextPlan(bad), /coverage/);
  assert.throws(() => validateRegulatoryContextPlan({ ...plan, predictionPerformed: true }), /unexecuted/);
  const renamed = structuredClone(plan);renamed.contexts[1].label = "Exact match to patient cells";
  assert.throws(() => validateRegulatoryContextPlan(renamed), /coverage/);
});

test("saving a context plan preserves the design, survives project export/import, and reports unexecuted regulatory work honestly", () => {
  const raw = readFileSync(new URL("./fixtures/dipk2a-region.gb", import.meta.url), "utf8");
  const result = runDesign("ko", raw, "", "", "", { enzyme: "spcas9" });
  const project = { ...createProject(), gene: "DIPK2A", editType: "ko", designResult: result, genbankRaw: raw, qcResults: [{ id: "keep" }] };
  const plan = buildRegulatoryContextPlan({ contextIds: BROAD_CONTEXT_IDS, pscLine: "<img src=x onerror=1>" });
  const updated = updateProject(project, { regulatoryContextPlan: plan, regulatoryReview: null });
  assert.strictEqual(updated.designResult, result);
  assert.deepEqual(updated.qcResults, project.qcResults);
  const restored = parseProject(JSON.stringify(updated));
  validateRegulatoryContextPlan(restored.regulatoryContextPlan);
  const html = generateReportHtml(restored, restored.designResult);
  assert.match(html, /Planned regulatory cell-context panel/);
  assert.match(html, /Predictions have not been run/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  const corrupted = structuredClone(restored);corrupted.regulatoryContextPlan.provider.modelVersion = "invented";
  assert.match(generateReportHtml(corrupted, corrupted.designResult), /could not be validated/);
});
