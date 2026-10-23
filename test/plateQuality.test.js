import test from "node:test";
import assert from "node:assert/strict";
import { extractWellId, precheckTraceQuality, buildPlateMap } from "../src/engine/qc/plateQuality.js";

test("extractWellId correctly identifies explicit 96-well identifiers", () => {
  assert.deepEqual(extractWellId("sample_A01_2026.ab1"), { row: "A", col: 1, wellId: "A01", isEstimated: false });
  assert.deepEqual(extractWellId("trace_H12_primer.ab1"), { row: "H", col: 12, wellId: "H12", isEstimated: false });
  assert.deepEqual(extractWellId("B4_edit.ab1"), { row: "B", col: 4, wellId: "B04", isEstimated: false });
});

test("extractWellId converts clone numbers to 96-well coordinates", () => {
  assert.deepEqual(extractWellId("cl1_MYD88_KO.ab1"), { row: "A", col: 1, wellId: "A01", isEstimated: true });
  assert.deepEqual(extractWellId("clone_12_KO.ab1"), { row: "A", col: 12, wellId: "A12", isEstimated: true });
  assert.deepEqual(extractWellId("IHi005-A_APOE_R176C_13_EF74668935.ab1"), { row: "B", col: 1, wellId: "B01", isEstimated: true });
  assert.deepEqual(extractWellId("IHi005-A_APOE_R176C_24_EF74668946.ab1"), { row: "B", col: 12, wellId: "B12", isEstimated: true });
});

test("precheckTraceQuality flags flatline or degraded traces", () => {
  // Flatline trace
  const flatlineTrace = {
    channels: { A: [10, 20, 15], C: [5, 10, 5], G: [8, 12, 9], T: [11, 14, 10] },
    calls: "ACGT",
    hasQuality: false
  };
  const flatCheck = precheckTraceQuality(flatlineTrace);
  assert.equal(flatCheck.status, "FAIL");
  assert.match(flatCheck.reason, /Flatline/);

  // Normal high quality trace
  const normalTrace = {
    channels: { A: [1000, 2000, 1500], C: [100, 200, 100], G: [50, 100, 80], T: [20, 30, 40] },
    calls: "ACGTACGT",
    quality: [40, 40, 38, 35, 42, 40, 39, 41],
    hasQuality: true
  };
  const normalCheck = precheckTraceQuality(normalTrace);
  assert.equal(normalCheck.status, "PASS");
  assert.equal(normalCheck.meanQv >= 35, true);
});

test("buildPlateMap maps traces and results into a full 96-well grid", () => {
  const traces = [
    { name: "sample_A01_wt.ab1", isControl: true },
    { name: "sample_A02_cl1.ab1", isControl: false }
  ];
  const results = [
    { name: "sample_A02_cl1", decision: { decision: "accept" } }
  ];

  const map = buildPlateMap(traces, results);
  assert.equal(map.size, 96);
  assert.equal(map.get("A01").isControl, true);
  assert.equal(map.get("A01").decision, "control");
  assert.equal(map.get("A02").decision, "accept");
  assert.equal(map.get("A03").isEmpty, true);
});
