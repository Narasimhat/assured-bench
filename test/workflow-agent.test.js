import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentRequest, rankAgentCandidates, runWorkflowAgent, agentAudit, isAgentAudit, summarizeAgentCandidate, workflowNextSteps, qcNextAction } from "../src/services/workflowAgent.js";
import { updateProject } from "../src/services/projectState.js";
import { appendWorkflowRecommendation } from "../src/services/designExport.js";
import { buildQcDesignSpec } from "../src/engine/design/qcExport.js";
import { validateDesignSpec } from "../src/engine/qc/designSpec.js";
const raw = readFileSync(new URL("../public/references/tp53-NG_017013.2.gb", import.meta.url), "utf8");
const project = { id: "test", gene: "TP53", genbankRaw: raw, editType: "pm", mutation: "R175H", tag: "FLAG", homologyArmLength: 400,
  options: { enzyme: "mad7", spacerLength: 23, directRepeat: "ACGU", repeatVerified: true, repeatSource: "another reagent", customGuides: ["ACGT"], acceptWeakProtection: true, weakProtectionReason: "old", coDeliveryBlocking: false, maxBlockingChanges: 3, deliveryMethod: "rnp" } };
const candidate = (enzyme, overrides = {}) => ({ enzyme, name: enzyme, eligible: true, status: "review", result: { type: "pm" },
  metrics: { distance: 5, protectionPenalty: 0, extraChanges: 2, primersReady: true }, ...overrides });

test("reject missing reference, absent mutation, unknown enzyme/priority and unsupported workflow", () => {
  assert.throws(() => agentRequest({ ...project, genbankRaw: "" }, ["spcas9"]));
  assert.throws(() => agentRequest({ ...project, mutation: "" }, ["spcas9"]));
  assert.throws(() => agentRequest(project, []));
  assert.throws(() => agentRequest(project, ["invented"]));
  assert.throws(() => agentRequest(project, ["spcas9"], "efficiency"));
  assert.throws(() => agentRequest({ ...project, editType: "genomic-snv" }, ["spcas9"]));
});
test("enzyme-specific sequences and previous risk acknowledgements cannot leak into another enzyme", async () => {
  const req = agentRequest(project, ["sacas9", "mad7"]);
  for (const key of ["customGuides", "repeatVerified", "acceptWeakProtection", "weakProtectionReason", "spacerLength"]) assert.equal(req.options[key], undefined);
  const calls = [];
  const report = await runWorkflowAgent(req, { runner: (...args) => { calls.push(args); return { err: "No eligible guide" }; } });
  assert.equal(calls[0][5].spacerLength, 21);
  assert.equal(calls[1][5].spacerLength, 23);
  assert.equal(calls[0][5].repeatVerified, false);
  assert.equal(report.candidates.filter(c => c.recommended).length, 0);
});
test("blocked designs never outrank eligible designs, even with a closer cut", () => {
  const good = candidate("good");
  const blocked = candidate("blocked", { eligible: false, status: "blocked", metrics: { ...good.metrics, distance: 0 } });
  assert.equal(rankAgentCandidates([blocked, good], "closest")[0].enzyme, "good");
});
test("priorities change the decision and exact ties remain joint recommendations", () => {
  const protectedGuide = candidate("protected");
  const close = candidate("close", { metrics: { distance: 0, protectionPenalty: 1, extraChanges: 0, primersReady: true } });
  assert.equal(rankAgentCandidates([close, protectedGuide], "balanced")[0].enzyme, "protected");
  assert.equal(rankAgentCandidates([close, protectedGuide], "closest")[0].enzyme, "close");
  assert.equal(rankAgentCandidates([close, protectedGuide], "minimalChanges")[0].enzyme, "close");
  const ties = rankAgentCandidates([protectedGuide, candidate("equal")]);
  assert.ok(ties.every(c => c.rank === 1 && c.recommended));
});
test("a failed tool does not stop the next enzyme and yields no invented activity score", async () => {
  let calls = 0;
  const report = await runWorkflowAgent(agentRequest(project, ["spcas9", "mad7"]), { runner: () => { calls++; throw Error("Reference unsuitable"); } });
  assert.equal(calls, 2);
  assert.ok(report.candidates.every(c => !c.recommended && c.status === "unavailable"));
  assert.ok(report.limitations.some(t => t.includes("No cross-enzyme")));
});
test("incomplete or protein-invalid results cannot be recommended", () => {
  const result = { type: "pm", gs: [{ sp: "ACGT".repeat(5) }], os: [{ od: "A".repeat(127), proteinValidation: { valid: false } }], ss: [] };
  assert.equal(summarizeAgentCandidate("spcas9", result, "pm").eligible, false);
});
test("changing inputs or replacing a design clears agent provenance and previous QC", () => {
  const previous = { ...project, designResult: {}, workflowRecommendation: { selectedEnzyme: "mad7" }, qcResults: [{ ok: true }] };
  const next = updateProject(previous, { mutation: "R248Q" });
  assert.equal(next.workflowRecommendation, null);
  assert.deepEqual(next.qcResults, []);
  const applied = updateProject(previous, { options: { enzyme: "sacas9" }, designResult: { type: "pm" }, workflowRecommendation: { selectedEnzyme: "sacas9" } });
  assert.equal(applied.workflowRecommendation.selectedEnzyme, "sacas9");
  assert.deepEqual(applied.qcResults, []);
});
test("real enzyme comparison supplies complete QC handoffs and portable, escaped audit evidence", async () => {
  const report = await runWorkflowAgent(agentRequest(project, ["spcas9", "sacas9", "mad7"]));
  assert.equal(report.candidates.length, 3);
  assert.ok(report.candidates.some(c => c.eligible));
  for (const c of report.candidates.filter(c => c.result)) {
    assert.equal(c.result.gs.length > 0, true);
    const qc = buildQcDesignSpec(c.result);
    assert.ok(!qc.err, qc.err);
    const checked = validateDesignSpec(qc);
    assert.ok(checked.ok, checked.errors.join("; "));
  }
  const selected = report.candidates.find(c => c.recommended);
  assert.ok(selected);
  const audit = agentAudit(report, selected.enzyme);
  assert.ok(isAgentAudit(audit));
  assert.ok(audit.candidates.every(c => !("result" in c)));
  audit.candidates.find(c => c.enzyme === selected.enzyme).reasons.push("<script>alert(1)</script>");
  const html = appendWorkflowRecommendation("<html><body>report</body></html>", audit);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.equal(isAgentAudit({ schema: audit.schema, candidates: [{}] }), false);
  assert.ok(workflowNextSteps(selected.result).some(t => t.includes("QC")));
});
test("uploaded gene identity comes from CDS annotations, not the filename", async () => {
  const { uploadedReferenceGene } = await import("../src/services/referenceGene.js");
  const fixture = 'LOCUS TEST\nFEATURES             Location/Qualifiers\n     CDS             1..9\n                     /gene="GENE1"\nORIGIN\n 1 atggcttaa\n//';
  assert.equal(uploadedReferenceGene(fixture, "", "anything.gb"), "GENE1");
  const multiple = fixture.replace("ORIGIN", '     CDS             1..9\n                     /gene="GENE2"\nORIGIN');
  assert.throws(() => uploadedReferenceGene(multiple, "", "anything.gb"), /several genes/);
  assert.equal(uploadedReferenceGene(multiple, "gene2", "anything.gb"), "GENE2");
});

test("downstream advice uses QC acceptance and ranking without inventing a clone winner", () => {
  const failed = { name: "bad", ok: false, decision: { decision: "accept" }, recommendation: { rank: 1 } };
  const held = { name: "held", ok: true, decision: { decision: "hold" }, recommendation: { rank: 1 } };
  const clone = { name: "A02", ok: true, decision: { decision: "accept" }, recommendation: { rank: 2 } };
  assert.match(qcNextAction([failed, held, clone]), /A02/);
  assert.ok(!qcNextAction([failed, held, clone]).includes("bad"));
  assert.match(qcNextAction([held]), /No sample is accepted/);
  assert.match(qcNextAction([{ ...clone, recommendation: {} }]), /no ranked winner/);
});

test("knockout ranking uses nominal effect evidence without inventing efficiency", () => {
  const inframe = candidate("inframe", { result: { type: "ko" }, metrics: { knockoutPenalty: 2, primersReady: true } });
  const frameshift = candidate("frameshift", { result: { type: "ko" }, metrics: { knockoutPenalty: 0, primersReady: true } });
  assert.equal(rankAgentCandidates([inframe, frameshift])[0].enzyme, "frameshift");
});
