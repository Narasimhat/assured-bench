import test from "node:test";
import assert from "node:assert/strict";
import { createProject, updateProject, parseProject } from "../src/services/projectState.js";

test("new experiments start without a preselected example and have unique identities", () => {
  const a = createProject();
  assert.equal(a.gene, "");
  assert.equal(a.mutation, "");
  assert.notEqual(a.id, createProject().id);
});

const completed = () => ({ ...createProject(), gene: "APOE", designResult: { type: "ko" },
  svgScheme: "<svg/>", caption: "old target", status: "ready", qcResults: [{ name: "clone1" }] });

test("changing every design input clears stale design and screening output", () => {
  for (const fields of [{ gene: "TP53" }, { editType: "pm" }, { mutation: "R154S" },
    { tag: "HA" }, { homologyArmLength: 300 }, { options: { deliveryMethod: "u6" } },
    { genbankRaw: "new reference" }]) {
    const next = updateProject(completed(), fields);
    assert.equal(next.designResult, null);
    assert.equal(next.svgScheme, null);
    assert.equal(next.status, null);
    assert.deepEqual(next.qcResults, []);
  }
});

test("renaming and unchanged inputs preserve analysis; a new design clears old QC", () => {
  const project = completed();
  assert.equal(updateProject(project, { name: "Renamed" }).designResult, project.designResult);
  assert.equal(updateProject(project, { gene: "APOE" }).qcResults, project.qcResults);
  const result = { type: "pm" };
  const next = updateProject(project, { editType: "pm", designResult: result, svgScheme: "new" });
  assert.equal(next.designResult, result);
  assert.equal(next.svgScheme, "new");
  assert.deepEqual(next.qcResults, []);
});

test("project export round-trips and old co-delivery settings migrate", () => {
  const project = completed();
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
  const legacy = parseProject(JSON.stringify({ gene: "APOE", editType: "pm", options: { coDelivery: true } }));
  assert.ok(legacy.id);
  assert.equal(legacy.options.coDeliveryBlocking, true);
  assert.deepEqual(legacy.qcResults, []);
});

test("import rejects unrelated JSON and malformed experiment fields", () => {
  for (const value of [null, [], { qcResults: [] }, { gene: "APOE", editType: "unknown" },
    { gene: "APOE", editType: "ko", qcResults: {} }, { gene: "APOE", editType: "ko", designResult: [] },
    { gene: "APOE", editType: "ko", name: {} }]) {
    assert.throws(() => parseProject(JSON.stringify(value)));
  }
});
