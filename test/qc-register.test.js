// Two reads can be out of register by a base before a homopolymer when the base caller counts the run differently in the two (A8 in one read, A7 in the other).
// That is an alignment artefact, not noise: it must not widen the intervals. Everything is simulated (traces built from allele sequences); no laboratory trace is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyseSample } from "../src/engine/qc/batch.js";
import { decide } from "../src/engine/qc/decision.js";
import { inRegisterStart } from "../src/engine/qc/prepare.js";
import { synthTrace } from "./helpers/synthetic-trace.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/qc-clone-flags/apoe_r176c_snp.design.json", import.meta.url), "utf8"));
const reference = spec.reference.sequence.toUpperCase();
const donor = spec.donors[0];
const edited = reference.slice(0, donor.refStart) + donor.sequence.toUpperCase() + reference.slice(donor.refEnd);
const forward = (sequence) => sequence.slice(318, 318 + 560);
const trace = (sequence, extra = {}) => synthTrace([{ sequence: forward(sequence), share: 1 }], { name: "sim-F", ...extra });
// the control's base caller drops one base of a run 40 bases into the read; every control base after it sits one position earlier than in the clone
const dropped = (sequence, at = 358) => sequence.slice(0, at) + sequence.slice(at + 1);
const run = (controlSequence, cloneSequence) => {
  const result = analyseSample({ name: "clone", spec, control: trace(controlSequence), edited: trace(cloneSequence), sampleType: "clone", options: {} });
  assert.ok(result.ok, result.error);
  return { ...result, decision: decide("snp", result, {}) };
};

test("inRegisterStart drops a leading out-of-register stretch, up to the first run of agreeing bases", () => {
  const discordance = new Float64Array(200).fill(0.01); for (let j = 22; j < 38; j += 1) discordance[j] = 1;
  assert.equal(inRegisterStart({ alignmentWindow: { start: 22, end: 184 }, discordance }), 38);
});

test("inRegisterStart leaves a window that starts in register, a noisy one and a short remainder alone", () => {
  const w = { start: 22, end: 184 };
  assert.equal(inRegisterStart({ alignmentWindow: w, discordance: new Float64Array(200).fill(0.02) }), 22);
  assert.equal(inRegisterStart({ alignmentWindow: w, discordance: new Float64Array(200).fill(0.3) }), 22);            // noisy throughout: nothing agrees, so nothing is trimmed
  const mostly = new Float64Array(200).fill(0.01); for (let j = 22; j < 150; j += 1) mostly[j] = 1;                    // more than half the window out of register
  assert.equal(inRegisterStart({ alignmentWindow: w, discordance: mostly }), 22);
  assert.equal(inRegisterStart({ alignmentWindow: { start: 22, end: 60 }, discordance: new Float64Array(200).fill(0.01) }), 22);
});

test("a wild-type clone read against a control with a miscounted run is still called wild type with a narrow interval", () => {
  const same = run(reference, reference); const shifted = run(dropped(reference), reference);
  assert.ok(shifted.warnings.some((w) => /out of register/.test(w)), "the out-of-register stretch is left out of the noise estimate, and the report says so");
  assert.ok(shifted.quality.discordanceBefore < 0.02, `discordance before the cut ${shifted.quality.discordanceBefore}`);
  assert.ok(!same.warnings.some((w) => /out of register/.test(w)));
  assert.ok(shifted.intervals.editedPct[1] <= same.intervals.editedPct[1] + 2, `edited interval ${shifted.intervals.editedPct} against ${same.intervals.editedPct} with a clean control`);
  assert.ok(shifted.intervals.editedPct[1] <= 5);
});

test("an edited clone read against that control keeps a tight interval on the intended edit", () => {
  const same = run(reference, edited); const shifted = run(dropped(reference), edited);
  assert.ok(shifted.intervals.intendedEditPct[0] >= same.intervals.intendedEditPct[0] - 2, `${shifted.intervals.intendedEditPct} against ${same.intervals.intendedEditPct}`);
  assert.equal(shifted.decision.decision, same.decision.decision);
});

test("reads that agree from the start are analysed as before: no stretch is left out and no warning is added", () => {
  const same = run(reference, edited);
  assert.ok(!same.warnings.some((w) => /out of register/.test(w)));
  assert.ok(same.quality.discordanceBefore < 0.02);
});
