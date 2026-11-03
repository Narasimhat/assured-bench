// Unwanted changes in a clone: every read is scanned for base changes the design did not ask for, each change gets its protein effect, and the decision follows.
// Everything here is simulated (traces built from allele sequences, test/helpers/synthetic-trace.js); no laboratory trace is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyseSample } from "../src/engine/qc/batch.js";
import { decide } from "../src/engine/qc/decision.js";
import { withRecommendations } from "../src/engine/qc/recommend.js";
import { buildQcReportHtml, buildResultsCsv, buildTakeHomeMessage, unwantedRows } from "../src/engine/qc/report.js";
import { mergeUnplannedReads, scanUnplannedDetailed, UNPLANNED_DEFAULTS } from "../src/engine/qc/unplanned.js";
import { consequenceOf, buildUnwanted, flagsFor } from "../src/engine/qc/unwanted.js";
import { annotateSpecProtein } from "../src/engine/qc/protein.js";
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

test("a clean homozygous clone carries no flag and is accepted", () => {
  const r = clone(hom());
  assert.deepEqual(r.unplanned, []);
  assert.deepEqual(r.unwanted.flags, []);
  assert.equal(r.unwanted.worst, null);
  assert.equal(r.decision.decision, "accept");
});

test("a stop codon seen in both reads is named, with its codon, and the clone is rejected", () => {
  const r = clone(hom(NONSENSE));
  assert.equal(r.unplanned.length, 1);
  const u = r.unplanned[0];
  assert.deepEqual([u.position, u.ref, u.alt, u.confirmed, u.readsSeen, u.readsCovering], [503, "A", "T", true, 2, 2]);
  assert.equal(u.relative, -32);
  const effect = r.unwanted.changes[0].consequence;
  assert.deepEqual([effect.class, effect.label, effect.damaging], ["nonsense", "K164*", true]);
  assert.equal(r.unwanted.worst, "block");
  assert.equal(r.unwanted.confirmedProteinChange, true);
  assert.equal(r.decision.decision, "reject");
  assert.equal(r.decision.unwanted, "block");
  assert.match(r.decision.reasons[0], /K164\*, nonsense/);
  assert.match(r.decision.reasons[0], /seen in 2 reads/);
});

test("a missense change seen in both reads is rejected too; a silent one only holds the clone", () => {
  const missense = clone(hom(MISSENSE));
  assert.equal(missense.unwanted.changes[0].consequence.class, "missense");
  assert.equal(missense.decision.decision, "reject");
  const silent = clone(hom(SILENT));
  assert.equal(silent.unwanted.changes[0].consequence.class, "synonymous");
  assert.equal(silent.unwanted.changes[0].severity, "review");
  assert.equal(silent.decision.decision, "hold");
  assert.equal(silent.decision.unwanted, "review");
});

test("a base seen in one read while the other read covers it and shows the reference is discordant: sequence again, not reject", () => {
  const withBase = trace(hom(NONSENSE), "F"); const clean = trace(hom(), "R");
  const result = analyseSample({ name: "clone", spec, control: controlF, edited: withBase, extraReads: [{ name: "read 2", control: controlR, edited: clean }], sampleType: "clone", options: {} });
  assert.ok(result.ok, result.error);
  const u = result.unplanned[0];
  assert.deepEqual([u.readsSeen, u.readsCovering, u.confirmed, u.discordant], [1, 2, false, true]);
  const decision = decide("snp", { ...result, workflow: "snp" });
  assert.equal(decision.decision, "re-sequence");
  assert.match(decision.next, /other direction/);
});

test("a protein-changing base in a single read (nothing covers it) asks for the other direction", () => {
  const r = clone(hom(NONSENSE), { reads: ["F"] });
  assert.equal(r.unplanned.length, 1);
  assert.equal(r.unplanned[0].single, true);
  assert.equal(r.decision.decision, "re-sequence");
});

test("the base is found whichever read comes first (a reverse read is mirrored back to the forward strand)", () => {
  const a = clone(hom(NONSENSE), { reads: ["F", "R"] }); const b = clone(hom(NONSENSE), { reads: ["R", "F"] });
  for (const r of [a, b]) assert.deepEqual([r.unplanned[0].position, r.unplanned[0].ref, r.unplanned[0].alt], [503, "A", "T"]);
  assert.deepEqual(a.alleles.map((x) => x.edits.map((e) => [e.start, e.ref, e.inserted, e.role])), b.alleles.map((x) => x.edits.map((e) => [e.start, e.ref, e.inserted, e.role])));
  const rev = clone(hom(NONSENSE), { reads: ["R"] });
  assert.deepEqual([rev.unplanned[0].position, rev.unplanned[0].ref, rev.unplanned[0].alt], [503, "A", "T"]);
});

test("a change in the amplicon far from the cut is seen too (the fit window is only 25 bases before and 150 after the cut)", () => {
  const downstream = clone(hom({ position: 720, alt: "A" }));
  assert.equal(downstream.unplanned.length, 1);
  assert.equal(downstream.unplanned[0].position, 720);
  assert.ok(downstream.unplanned[0].relative > 150);
});

test("ordinary background noise (a weak second base at every position) is not reported", () => {
  const r = clone(hom(), { noise: 0.12 });
  assert.deepEqual(r.unplanned, []);
  assert.ok(!r.unwanted.flags.some((f) => f.code === "unplanned-base"));
});

test("a read with many differences from the control is flagged as a misfit, not listed base by base", () => {
  const many = hom({ position: 490, alt: "T" }, { position: 494, alt: "T" }, { position: 503, alt: "T" }, { position: 480, alt: "C" });
  const r = clone(many);
  assert.deepEqual(r.unplanned, []);
  assert.ok(r.unwanted.flags.some((f) => f.code === "many-differences"));
  assert.notEqual(r.decision.decision, "accept");
});

test("switching the rule off, and results from before the report existed", () => {
  const r = clone(hom(NONSENSE));
  assert.equal(decide("snp", r, { holdOnUnplanned: false }).decision, "accept");
  const { unwanted, ...old } = r;
  const legacy = decide("snp", { ...old, unplanned: old.unplanned.map((h) => ({ relative: h.relative, change: h.change, fraction: h.fraction })) });
  assert.equal(legacy.decision, "hold", "the earlier rule: hold an accepted clone with an unplanned base");
});

test("unplanned scan: a poor fit lowers confidence instead of switching the scan off", () => {
  const len = 30; const a0 = 100;
  const obs = new Float64Array(len * 4); const fitted = new Float64Array(len * 4); const use = new Uint8Array(len).fill(1);
  const control = { composition: new Float64Array(len * 4) };
  for (let i = 0; i < len; i += 1) { obs[i * 4] = 1; fitted[i * 4] = 1; control.composition[i * 4] = 1; }
  const setAlt = (i, share) => { obs[i * 4] = 1 - share; obs[i * 4 + 3] = share; };
  setAlt(10, 0.30); setAlt(20, 0.5);
  const prepared = { control, window: { start: 0, end: len }, firstCut: 25, spec: { markers: [] } };
  const run = (r2) => scanUnplannedDetailed(prepared, { obs, fitted, use, a0, len }, { r2, contributions: [{ kind: "wt", fraction: 1 }] }, { unplannedFlanks: false });
  const good = run(0.95); const poor = run(0.5);
  assert.deepEqual(good.hits.map((h) => h.refIndex), [110, 120]);
  assert.equal(good.lowFit, false);
  assert.deepEqual(poor.hits.map((h) => h.refIndex), [120], "a 30% signal is below the 35% needed in a poor fit");
  assert.equal(poor.hits[0].lowFit, true);
  assert.ok(UNPLANNED_DEFAULTS.unplannedLowFitMinFraction > UNPLANNED_DEFAULTS.unplannedMinFraction);
});

test("merging reads: a reverse read's hit is complemented and mirrored onto the forward strand and confirms the forward hit", () => {
  const L = 100; const scan = (hits, covered) => ({ hits, covered: new Set(covered), lowFit: false, overflow: 0 });
  const merged = mergeUnplannedReads([
    { name: "F", orientation: "+", scan: scan([{ refIndex: 40, relative: 0, ref: "A", alt: "T", fraction: 0.9 }], [39, 40, 41]) },
    { name: "R", orientation: "-", scan: scan([{ refIndex: L - 1 - 40, relative: 0, ref: "T", alt: "A", fraction: 0.7 }], [L - 1 - 41, L - 1 - 40]) },
  ], { length: L, cut: 50 });
  assert.equal(merged.changes.length, 1);
  const c = merged.changes[0];
  assert.deepEqual([c.position, c.relative, c.ref, c.alt, c.readsSeen, c.confirmed, c.discordant], [40, -10, "A", "T", 2, true, false]);
  assert.ok(Math.abs(c.fraction - 0.8) < 1e-9);
});

test("protein effect of a base: from the design's codon frame", () => {
  const annotated = annotateSpecProtein(spec);
  const nonsense = consequenceOf(annotated, null, { position: 503, ref: "A", alt: "T" });
  assert.deepEqual([nonsense.class, nonsense.label, nonsense.codonFrom, nonsense.codonTo, nonsense.basis], ["nonsense", "K164*", "AAG", "TAG", "design codon frame"]);
  assert.equal(consequenceOf(annotated, null, { position: 471, ref: "T", alt: "A" }).class, "missense");
  assert.equal(consequenceOf(annotated, null, { position: 472, ref: "G", alt: "A" }).class, "synonymous");
  assert.equal(consequenceOf(spec, null, { position: 503, ref: "A", alt: "T" }).class, "unknown", "no codon frame known: not guessed");
  assert.equal(consequenceOf(annotated, null, { position: 503, ref: "C", alt: "T" }).class, "unknown", "the base does not match the reference: not assessed");
});

test("a flagged clone ranks behind a clean one and the flag is listed with it", () => {
  const cleanClone = { ...clone(hom()), name: "clean" };
  const flagged = { ...clone(hom(SILENT)), name: "flagged" };
  const ranked = withRecommendations([flagged, cleanClone]);
  const byName = Object.fromEntries(ranked.map((r) => [r.name, r.recommendation]));
  assert.equal(byName.clean.rank, 1);
  assert.equal(byName.flagged.rank, 2);
  assert.ok(byName.flagged.flags.some((f) => /unwanted change/.test(f)));
  const rejected = withRecommendations([{ ...clone(hom(NONSENSE)), name: "stop" }, cleanClone]);
  assert.equal(rejected[0].recommendation.priority, "discard");
  assert.equal(rejected[0].recommendation.rank, null);
});

test("the alleles of a clone are reported as edits on the forward strand, with the role of each base", () => {
  const r = clone(hom(), { reads: ["R"] });
  assert.equal(r.alleles.length, 1);
  assert.deepEqual(r.alleles[0].edits.map((e) => [e.start, e.ref, e.inserted, e.role]), [[532, "G", "C", "blocking"], [535, "G", "A", "blocking"], [539, "C", "T", "intended"], [547, "A", "T", "blocking"], [550, "G", "C", "blocking"]]);
  const deletion = reference.slice(0, 535) + reference.slice(540);
  const d = clone([{ sequence: deletion, share: 1 }], { reads: ["F"] });
  const del = d.alleles.find((a) => a.size === -5);
  assert.ok(del, JSON.stringify(d.alleles.map((a) => a.label)));
  assert.equal(del.edits.length, 1);
  assert.equal(del.edits[0].inserted, "");
  assert.equal(del.edits[0].end - del.edits[0].start, 5);
});

test("an indel allele next to the intended edit is flagged in a knock-in and is not a flag in a knockout run", () => {
  const deletion = reference.slice(0, 535) + reference.slice(540);
  const r = clone([{ sequence: edited, share: 0.5 }, { sequence: deletion, share: 0.5 }], { reads: ["F"] });
  const codes = r.unwanted.flags.map((f) => f.code);
  assert.ok(codes.includes("indel-at-cut"), codes.join());
  assert.ok(r.unwanted.flags.find((f) => f.code === "indel-at-cut").knockInOnly);
  assert.ok(flagsFor({ ...r, workflow: "snp" }).some((f) => f.code === "indel-at-cut"));
  assert.ok(!flagsFor({ ...r, workflow: "knockout" }).some((f) => f.code === "indel-at-cut"), "an indel is the wanted outcome of a knockout (the workflow of the run decides, not the design file)");
  assert.ok(!flagsFor({ ...r, workflow: "knockout" }).some((f) => f.code === "blocking-only"));
});

test("a stretch where the edited read is out of register with the control is reported as a stretch, not as base changes", () => {
  // the edited read lacks one base call 60 bases after its start: everything before it is shifted against the control
  const sequence = (direction) => (direction === "F" ? forward : reverse)(edited);
  const read = sequence("F"); const dropped = read.slice(0, 60) + read.slice(61);
  const shifted = synthTrace([{ sequence: dropped, share: 1 }], { name: "dropped" });
  const result = analyseSample({ name: "clone", spec, control: controlF, edited: shifted, sampleType: "clone", options: {} });
  assert.ok(result.ok, result.error);
  assert.deepEqual(result.unplanned, [], "no isolated base change is reported");
  assert.ok(result.unwanted.flags.some((f) => f.code === "misaligned-stretch"), JSON.stringify(result.unwanted.flags.map((f) => f.code)));
  assert.notEqual(decide("snp", { ...result, workflow: "snp" }).decision, "reject");
});

test("the take-home message, the report and the CSV carry the flags", () => {
  const good = { ...clone(hom()), name: "clean" };
  const bad = { ...clone(hom(NONSENSE)), name: "stop" };
  const results = [good, bad];
  const note = buildTakeHomeMessage("snp", results).summary;
  assert.match(note, /Unwanted changes: 1 clone rejected for a protein-changing base the design did not plan \(stop\)/);
  const html = buildQcReportHtml({ workflow: "snp", results });
  assert.match(html, /<h2>Unwanted changes<\/h2>/);
  assert.ok(html.includes("K164*"));
  const legacy = buildResultsCsv("snp", results).split("\n")[0].split(",");
  assert.deepEqual(legacy.slice(-3), ["knockout_support", "priority_rank", "recommendation"], "the default layout is unchanged");
  const csv = buildResultsCsv("snp", results, { flags: true }).split("\n");
  const header = csv[0].split(",");
  assert.deepEqual(header.slice(-5), ["unwanted_flags", "unwanted_changes", "splice_verdict", "splice_effect", "alphagenome_splice_score"]);
  assert.ok(csv[2].includes("unplanned-base:block"));
  assert.ok(csv[2].includes("-32 A>T K164* confirmed"));
  assert.ok(!csv[1].includes("unplanned-base"));
  assert.deepEqual(unwantedRows("snp", [good]).length, 0);
  const withReview = unwantedRows("snp", [good], { splice: { clones: { clean: { verdict: "review", effect: 0.12, basis: "unwanted edits on top of the intended allele", label: "x" } } } });
  assert.equal(withReview[0].source, "SpliceAI");
  assert.equal(withReview[0].severity, "review");
  const clean = buildQcReportHtml({ workflow: "snp", results: [good] });
  assert.match(clean, /No base change the design did not ask for was found/);
});

test("a pool is a mixture of edits: a protein-changing base in it never rejects it", () => {
  const r = clone(hom(NONSENSE));
  const pool = { ...r, sampleType: "pool" };
  assert.notEqual(decide("snp", pool).decision, "reject");
  assert.notEqual(decide("snp", pool).decision, "re-sequence");
});
