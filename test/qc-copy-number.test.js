// A locus with one copy per cell (an X-linked gene in a male line): two real alleles in a trace are a mixed clone, never a heterozygous one.
// Everything is simulated (traces built from allele sequences); no laboratory trace is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyseSample } from "../src/engine/qc/batch.js";
import { decide } from "../src/engine/qc/decision.js";
import { withRecommendations } from "../src/engine/qc/recommend.js";
import { buildQcReportHtml } from "../src/engine/qc/report.js";
import { reverseComplement as rc } from "../src/engine/qc/seq.js";
import { synthTrace, substitute } from "./helpers/synthetic-trace.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/qc-clone-flags/apoe_r176c_snp.design.json", import.meta.url), "utf8"));
const reference = spec.reference.sequence.toUpperCase();
const donor = spec.donors[0];
const edited = reference.slice(0, donor.refStart) + donor.sequence.toUpperCase() + reference.slice(donor.refEnd); // the intended allele (ssODN1)
// The forward read starts after the forward primer (318); the reverse read starts at the reverse primer (751) and runs down.
const forward = (sequence) => sequence.slice(318, 318 + 560);
const reverse = (sequence) => rc(sequence.slice(0, 752)).slice(0, 520);
const trace = (alleles, direction, extra = {}) => synthTrace(alleles.map((a) => ({ sequence: (direction === "F" ? forward : reverse)(a.sequence), share: a.share })), { name: `sim-${direction}`, ...extra });
const controlF = trace([{ sequence: reference, share: 1 }], "F");
const controlR = trace([{ sequence: reference, share: 1 }], "R");
const NONSENSE = { position: 503, alt: "T" };   // AAG > TAG, K164* in the design's reading frame, 32 bases upstream of the first cut
const MISSENSE = { position: 471, alt: "A" };   // V153E
const SILENT = { position: 472, alt: "A" };     // V153V

/** A clone: its alleles read from both ends (or from one), analysed and decided as the app does. */
function clone(alleles, { reads = ["F", "R"], noise = 0, workflow = "snp", options = {} } = {}) {
  const controlOf = (d) => (d === "F" ? controlF : controlR);
  const traces = reads.map((d, i) => ({ name: i ? `read ${i + 1}` : "read 1", control: noise ? trace([{ sequence: reference, share: 1 }], d, { noise, seed: 3 }) : controlOf(d), edited: trace(alleles, d, noise ? { noise, seed: 11 } : {}) }));
  const result = analyseSample({ name: "clone", spec, control: traces[0].control, edited: traces[0].edited, extraReads: traces.slice(1), sampleType: "clone", options });
  assert.ok(result.ok, result.error);
  return { ...result, workflow, decision: decide(workflow, result) };
}
const hom = (...changes) => [{ sequence: changes.length ? substitute(edited, changes.map((c) => ({ pos: c.position, alt: c.alt }))) : edited, share: 1 }];
import { withCopyNumber, copyNumberOf } from "../src/engine/qc/copyNumber.js";
import { actionRows } from "../src/engine/qc/actions.js";
import { planTasks } from "../src/engine/qc/quick.js";

/** A clone analysed as the app does, with the locus read as `copyNumber` copies. */
function cloneWith(alleles, copyNumber, { reads = ["F", "R"] } = {}) {
  const controlOf = (d) => (d === "F" ? controlF : controlR);
  const traces = reads.map((d, i) => ({ name: i ? `read ${i + 1}` : "read 1", control: controlOf(d), edited: trace(alleles, d) }));
  const result = analyseSample({ name: "clone", spec, control: traces[0].control, edited: traces[0].edited, extraReads: traces.slice(1), sampleType: "clone", options: copyNumber === 1 ? { copyNumber: 1 } : {} });
  assert.ok(result.ok, result.error);
  return { ...result, workflow: "snp", decision: decide("snp", result) };
}
const half = [{ sequence: edited, share: 0.5 }, { sequence: reference, share: 0.5 }];
const row = (pos, altNet, role = "blocking") => ({ covered: true, marker: { pos, role }, altNet });
const edit = { kind: "edit", fraction: 0.5, label: "Intended edit (ssODN1)", size: 0 };
const compound = { call: "two alleles", category: "compound_heterozygous", summary: "Compound heterozygous: intended edit and intended edit", alleles: [edit, { ...edit, label: "Intended edit (ssODN2)" }], flags: ["A heterozygous call assumes the two alleles are the only ones; a large deletion on one allele cannot be excluded from the trace."] };

test("two copies (the default) leave the genotype call alone", () => {
  assert.equal(copyNumberOf({}, {}), 2);
  assert.equal(withCopyNumber(compound, { copyNumber: 2, markerReadout: [] }), compound);
  const r = cloneWith(half, 2);
  assert.equal(r.genotype.category, "heterozygous_edit");
  assert.equal(r.genotype.copyNumber, undefined);
});

test("one copy: an edit on one allele and wild type on the other is a mixed clone, and the clone is held", () => {
  const r = cloneWith(half, 1);
  assert.equal(r.genotype.copyNumber, 1);
  assert.equal(r.genotype.mixedClone, true);
  assert.equal(r.genotype.category, "mixed");
  assert.match(r.genotype.summary, /^Mixed clone at a one-copy locus: .*intended edit 5\d%/);
  assert.equal(r.genotype.original.category, "heterozygous_edit");
  assert.equal(r.decision.decision, "hold");
  assert.match(r.decision.next, /re-single-cell/);
  // with 'heterozygous edits too' it was accepted before; at a one-copy locus it is not
  assert.equal(decide("snp", { ...cloneWith(half, 2) }, { goal: "any" }).decision, "accept");
  assert.equal(decide("snp", r, { goal: "any" }).decision, "hold");
});

test("one copy: a single allele is hemizygous, worded as such, and accepted", () => {
  const r = cloneWith([{ sequence: edited, share: 1 }], 1);
  assert.equal(r.genotype.summary, "Hemizygous for the intended edit");
  assert.equal(r.genotype.category, "homozygous_edit");
  assert.ok(!r.genotype.flags.some((f) => /cannot tell homozygous from hemizygous/.test(f)));
  assert.equal(r.decision.decision, "accept");
});

test("one copy: two library alleles that differ only in their blocking changes, with every designed change at 90% or more, are one allele", () => {
  const readout = [row(207, 0.996), row(208, 0.99, "intended"), row(209, 0.998, "intended"), row(210, 0.998, "intended"), row(222, 0.996)];
  const g = withCopyNumber(compound, { copyNumber: 1, markerReadout: readout });
  assert.equal(g.singleAllele, true);
  assert.equal(g.category, "homozygous_edit");
  assert.equal(g.summary, "Hemizygous for the intended edit, carrying every designed change");
  assert.equal(g.alleles.length, 1);
  assert.equal(g.original.summary, "Compound heterozygous: intended edit and intended edit");
  // the same two alleles with one blocking change at 50% are a real mixture
  const mixed = withCopyNumber(compound, { copyNumber: 1, markerReadout: [row(207, 0.5), row(208, 0.99, "intended"), row(222, 0.5)] });
  assert.equal(mixed.mixedClone, true);
  assert.equal(mixed.singleAllele, undefined);
});

test("one copy: a knockout with two different frameshift alleles is held, not accepted", () => {
  const g = withCopyNumber({ call: "two alleles", category: "compound_heterozygous", summary: "Compound heterozygous: -4 bp indel and +1 bp indel", alleles: [{ kind: "indel", size: -4, fraction: 0.5 }, { kind: "indel", size: 1, fraction: 0.5 }], flags: [] }, { copyNumber: 1, markerReadout: [] });
  const result = { ok: true, sampleType: "clone", warnings: [], confidence: { tier: "high", width: 2 }, summary: { editedPct: 100, wtPct: 0 }, intervals: { editedPct: [96, 100], wtPct: [0, 2], intendedEditPct: [0, 0] }, genotype: g };
  assert.equal(decide("knockout", result).decision, "hold");
  assert.equal(decide("knockout", { ...result, genotype: { ...g, mixedClone: false, category: "compound_heterozygous", alleles: g.alleles } }).decision, "accept");
});

test("the next action for a mixed clone: re-pick when the trace is precise, repeat the read first when it is not", () => {
  const base = cloneWith(half, 1);
  const precise = { ...base, name: "x_Cl_1_A", confidence: { tier: "high", width: 2 }, decision: { ...base.decision, decision: "re-sequence" }, recommendation: { priority: "resequence" } };
  const noisy = { ...precise, name: "x_Cl_2_A", confidence: { tier: "low", width: 60 }, intervals: { ...precise.intervals, editedPct: [30, 100] } };
  const { rows } = actionRows("snp", [precise, noisy]);
  assert.deepEqual(rows.map((r) => [r.label, r.key]), [["cl1", "repick"], ["cl2", "repeat"]]);
  assert.match(rows.find((r) => r.label === "cl2").why, /one-copy locus two alleles mean a mixed clone/);
});

test("the setting reaches every task, and the report says the locus was read as one copy", () => {
  const pairs = [{ sample: "a", edited: ["a.ab1"], control: ["c.ab1"], type: "clone", confidence: "explicit", reason: "" }];
  const plan = (copyNumber) => planTasks({ pairs, getTrace: () => null, design: { kind: "spec", spec }, copyNumber });
  assert.deepEqual(plan(1).tasks[0].options.copyNumber, 1);
  assert.equal(plan(2).tasks[0].options.copyNumber, undefined);
  const html = buildQcReportHtml({ workflow: "snp", results: withRecommendations([cloneWith(half, 1)], {}) });
  assert.match(html, /One copy of the locus per cell/);
});
