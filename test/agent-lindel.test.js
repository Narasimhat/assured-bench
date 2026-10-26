import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentRequest, runWorkflowAgent, agentAudit, rankAgentCandidates } from "../src/services/workflowAgent.js";
import { runDesign } from "../src/engine/design/designEngine.js";
import { loadLindel } from "../src/engine/design/lindel/loadLindel.js";
import { buildQcDesignSpec } from "../src/engine/design/qcExport.js";
import { validateDesignSpec } from "../src/engine/qc/designSpec.js";
const raw = readFileSync(new URL("./fixtures/dipk2a-region.gb", import.meta.url), "utf8");
const project = { id: "lindel", gene: "DIPK2A", editType: "ko", genbankRaw: raw, mutation: "", tag: "", homologyArmLength: 400,
  options: { deliveryMethod: "rnp", coDeliveryBlocking: false, koLindel: { stale: true }, koOutcomesUnavailable: "old failure" } };

test("agent loads Lindel for SpCas9 and selects exactly the standard outcome-ranked pair", async () => {
  const request = agentRequest(project, ["spcas9"]);
  assert.equal(request.options.koLindel, undefined);
  assert.equal(request.options.koOutcomesUnavailable, undefined);
  const progress = [];
  const report = await runWorkflowAgent(request, { onProgress: value => progress.push(value) });
  const candidate = report.candidates[0];
  assert.equal(candidate.result.err, undefined);
  const standard = runDesign("ko", raw, "", "", 400, { enzyme: "spcas9", koLindel: await loadLindel() });
  assert.deepEqual(candidate.result.gs.map(g => g.sp), standard.gs.map(g => g.sp));
  assert.ok(candidate.result.gs.every(g => g.gc >= 40 && g.gc <= 60));
  assert.equal(candidate.result.koSelection.independentGuides.length, 2);
  assert.ok(Number.isFinite(candidate.result.koAssessment.outcomes.minLofPct));
  assert.equal(candidate.repairOutcomeModel.status, "applied");
  assert.equal(candidate.metrics.knockoutFunctionalTier, candidate.result.koAssessment.tier);
  assert.equal(candidate.metrics.knockoutIsoformGapScore, candidate.result.koAssessment.isoformGapScore);
  assert.equal(candidate.metrics.koMinLofPct, standard.koAssessment.outcomes.minLofPct);
  assert.ok(candidate.reasons.some(reason => reason.includes("not cutting efficiency")));
  assert.ok(progress.some(p => p.phase === "loading_model"));
  assert.equal(agentAudit(report, "spcas9").candidates[0].repairOutcomeModel.status, "applied");
  const checked = validateDesignSpec(buildQcDesignSpec(candidate.result));
  assert.ok(checked.ok, checked.errors.join("; "));
});

test("only a SpCas9 knockout loads or receives the model", async () => {
  let loads = 0;
  const seen = [];
  await runWorkflowAgent(agentRequest(project, ["mad7", "spcas9", "sacas9"]), {
    loadKoModel: async () => { loads++; return { marker: true }; },
    runner: (...args) => { seen.push(args[5]); return { err: "test runner" }; },
  });
  assert.equal(loads, 1);
  assert.equal(seen[0].koLindel, undefined);
  assert.deepEqual(seen[1].koLindel, { marker: true });
  assert.equal(seen[2].koLindel, undefined);
  await runWorkflowAgent(agentRequest({ ...project, editType: "pm", mutation: "A1G" }, ["spcas9"]), {
    loadKoModel: async () => { throw Error("Unexpected load for HDR"); },
    runner: (...args) => { assert.equal(args[5].koLindel, undefined); return { err: "test runner" }; },
  });
});

test("model failure preserves the shared fallback pair, records the gap and can be retried", async () => {
  const request = agentRequest(project, ["spcas9"]);
  const failed = await runWorkflowAgent(request, { loadKoModel: async () => { throw Error("HTTP 404"); } });
  const candidate = failed.candidates[0];
  const fallback = runDesign("ko", raw, "", "", 400, { enzyme: "spcas9" });
  assert.deepEqual(candidate.result.gs.map(g => g.sp), fallback.gs.map(g => g.sp));
  assert.equal(candidate.repairOutcomeModel.status, "unavailable");
  assert.match(candidate.repairOutcomeModel.reason, /HTTP 404/);
  assert.equal(candidate.metrics.koMinLofPct, null);
  assert.ok(candidate.warnings.some(text => text.includes("Repair-outcome ranking was not applied")));
  const retry = await runWorkflowAgent(request);
  assert.equal(retry.candidates[0].repairOutcomeModel.status, "applied");
});

test("Lindel percentages do not break otherwise equal cross-enzyme comparisons", () => {
  const make = (name, pct) => ({ name, enzyme: name, eligible: true, status: "review", result: { type: "ko" },
    metrics: { knockoutPenalty: 0, primersReady: true, koMinLofPct: pct } });
  const ranked = rankAgentCandidates([make("spcas9", 90), make("mad7", null)]);
  assert.ok(ranked.every(c => c.rank === 1 && c.recommended));
});
