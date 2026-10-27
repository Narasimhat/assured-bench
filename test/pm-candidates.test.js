import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesign, parseGB } from "../src/engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel, getCodonAtAa, findSpCas9Guides } from "../src/engine/design/transcriptModel.js";
import { toAA } from "../src/engine/design/designEngine.js";
import { reverseComplementDna } from "../src/engine/design/enzymeGuides.js";
import { buildPmCandidateSet, designWithCandidates, evaluateRow, candidateDesignOptions, PM_CANDIDATE_RULE, PM_CANDIDATE_SCHEMA } from "../src/engine/design/pmCandidates.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ref = (name) => fs.readFileSync(path.join(HERE, "..", "public", "references", name), "utf8");
const APOE = ref("apoe-ensg00000130203.gb");
const TP53 = ref("tp53-NG_017013.2.gb");
const APOE_OPTIONS = { deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: "APOE" };

// An oracle that does not use the module under test: its own codon table and reverse complement.
const AAS = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const CODONS = (() => { const m = {}; let i = 0; for (const a of "TCAG") for (const b of "TCAG") for (const c of "TCAG") m[a + b + c] = AAS[i++]; return m; })();
const protein = (model, genomic) => { const cds = model.cdsSegments.map(([s, e]) => genomic.slice(s, e)).join(""); let out = ""; for (let i = 0; i + 3 <= cds.length; i += 3) out += CODONS[cds.slice(i, i + 3)] || "?"; return out; };
const rc = (s) => [...s].reverse().map((b) => ({ A: "T", C: "G", G: "C", T: "A" })[b]).join("");
const modelOf = (raw, gene) => normalizeGenBankToTranscriptModel(parseGB(raw), { expectedGene: gene });

test("designWithCandidates leaves the design exactly as runDesign returns it", () => {
  const withSet = designWithCandidates(APOE, "R176C", APOE_OPTIONS);
  const { pmCandidates, ...design } = withSet;
  const plain = runDesign("pm", APOE, "R176C", "", 400, APOE_OPTIONS);
  assert.equal(JSON.stringify(design), JSON.stringify(plain));
  assert.equal(pmCandidates.schema, PM_CANDIDATE_SCHEMA);
});

test("APOE R176C: counts, order and verified protection of the candidate set", () => {
  const set = designWithCandidates(APOE, "R176C", APOE_OPTIONS).pmCandidates;
  assert.deepEqual(set.counts, { guides: 14, rows: 28, passing: 4, candidates: 4 });
  assert.deepEqual(set.candidates.map((c) => [c.id, c.guide.sp, c.donorVersion, c.stage1.tier]), [
    ["+3052.v0", "CGATGACCTGCAGAAGCGCC", 0, 1],
    ["-3070.v1", "CCCCGGCCTGGTACACTGCC", 1, 1],
    ["-3058.v0", "ACACTGCCAGGCGCTTCTGC", 0, 2],
    ["-3070.v0", "CCCCGGCCTGGTACACTGCC", 0, 3],
  ]);
  const by = Object.fromEntries(set.candidates.map((c) => [c.id, c]));
  assert.deepEqual(by["+3052.v0"].blockers.map((b) => b.lb), ["p.L177L", "p.L173L"]);
  assert.deepEqual(by["-3070.v1"].blockers.map((b) => b.lb), ["p.L177L", "p.A178A"]);
  assert.deepEqual(by["-3058.v0"].blockers.map((b) => b.lb), ["p.L173L", "p.Q174Q", "p.A178A"]);
  assert.deepEqual(by["-3070.v0"].blockers.map((b) => b.lb), ["p.V179V"]);
  const cfd = (id) => by[id].protection.repairedAlleleCfd;
  assert.equal(cfd("+3052.v0").toFixed(4), "0.0073");
  assert.equal(cfd("-3070.v1").toFixed(4), "0.0069");
  assert.equal(cfd("-3058.v0").toFixed(4), "0.0127");
  assert.equal(cfd("-3070.v0"), 0);
  // If only the intended base converts: the edit sits inside the +strand guide's protospacer but outside the others.
  assert.equal(by["+3052.v0"].protection.editOnlyCfd.toFixed(3), "0.467");
  assert.equal(by["-3070.v1"].protection.editOnlyCfd, 1);
  // The engine's own CFD agrees with the independent derivation for every candidate.
  for (const c of set.candidates) assert.equal(c.flags.engineCfdDisagrees, false, c.id);
  assert.equal(by["-3070.v0"].flags.singleMismatchIntactPam, true);
  assert.equal(by["+3052.v0"].flags.pamDisrupted, true);
  for (const c of set.candidates) assert.equal(c.specificity.status, "not-assessed");
});

test("every candidate changes the protein only by the requested substitution, checked with an independent translation", () => {
  for (const [raw, gene, mutation, aa, from, to] of [[APOE, "APOE", "R176C", 176, "R", "C"], [TP53, "TP53", "R175H", 175, "R", "H"]]) {
    const model = modelOf(raw, gene);
    const set = buildPmCandidateSet(model, mutation, { maxBlockingChanges: 3 });
    assert.ok(set.candidates.length >= 3, `${gene}: ${set.candidates.length} candidates`);
    const genomic = model.genomicSequence.toUpperCase();
    const reference = protein(model, genomic);
    assert.equal(reference[aa - 1], from);
    for (const c of set.candidates) {
      const { start, end, genomicDonor } = c.donor;
      assert.equal(genomicDonor.length, end - start);
      const repaired = genomic.slice(0, start) + genomicDonor.toUpperCase() + genomic.slice(end);
      const edited = protein(model, repaired);
      const changes = [...edited].map((a, i) => (a === reference[i] ? null : `${reference[i]}${i + 1}${a}`)).filter(Boolean);
      assert.deepEqual(changes, [`${from}${aa}${to}`], `${gene} ${c.id}`);
      // The recorded substitutions are exactly the differences from the reference.
      const diffs = [...genomicDonor.toUpperCase()].map((b, i) => (b === genomic[start + i] ? null : start + i)).filter((i) => i !== null);
      assert.deepEqual(c.substitutions.map((s) => s.index), diffs);
      assert.equal(c.substitutions.length, 1 + c.blockers.length, `${gene} ${c.id}: one intended base plus the blockers`);
    }
  }
});

test("ssODN orientation: plus-strand guides get the reverse complement of the plus-strand allele", () => {
  const set = designWithCandidates(APOE, "R176C", APOE_OPTIONS).pmCandidates;
  for (const c of set.candidates) {
    if (c.guide.str === "-") { assert.equal(c.donor.orientation, "plus"); assert.equal(c.donor.ssodn.toUpperCase(), c.donor.genomicDonor.toUpperCase()); }
    else { assert.equal(c.donor.orientation, "reverse-complement"); assert.equal(c.donor.ssodn.toUpperCase(), rc(c.donor.genomicDonor.toUpperCase())); }
  }
  assert.ok(set.candidates.some((c) => c.guide.str === "+") && set.candidates.some((c) => c.guide.str === "-"));
});

test("gates: every excluded row names the gate it failed and every kept row passes all of them", () => {
  const set = designWithCandidates(APOE, "R176C", APOE_OPTIONS).pmCandidates;
  for (const c of set.candidates) assert.deepEqual(Object.values(c.gates), [true, true, true, true, true, true], c.id);
  assert.equal(set.excluded.length, set.counts.rows - set.counts.passing);
  for (const e of set.excluded) assert.ok(e.failedGates.length > 0, e.id);
  // Arm gate: rows excluded only for G4 have a short arm; rows excluded for G6 have a GC outside 30-80.
  for (const e of set.excluded.filter((x) => x.failedGates.join() === "G4")) assert.ok(Math.min(e.arms.five, e.arms.three) < PM_CANDIDATE_RULE.thresholds.minArm, e.id);
  for (const e of set.excluded.filter((x) => x.failedGates.includes("G6"))) assert.ok(e.guide.gc < 30 || e.guide.gc > 80, e.id);
  for (const e of set.excluded.filter((x) => x.failedGates.includes("G3"))) assert.ok(e.cutToEditBp > PM_CANDIDATE_RULE.thresholds.maxCutDistance, e.id);
});

test("candidates that share a substitution set are reported as one allele", () => {
  const model = modelOf(APOE, "APOE");
  const loose = buildPmCandidateSet(model, "R176C", { maxBlockingChanges: 3, rule: { ...PM_CANDIDATE_RULE, thresholds: { ...PM_CANDIDATE_RULE.thresholds, minArm: 20 } } });
  const shared = loose.alleles.filter((a) => a.candidateIds.length > 1);
  assert.ok(shared.length >= 1, "a shorter arm threshold admits a second guide carrying the V179V-only allele");
  assert.ok(loose.notes.some((n) => /same substitution set/.test(n)));
  const strict = designWithCandidates(APOE, "R176C", APOE_OPTIONS).pmCandidates;
  assert.equal(strict.alleles.filter((a) => a.candidateIds.length > 1).length, 0);
});

test("the set is deterministic, capped, and refuses input it cannot honour", () => {
  const a = designWithCandidates(APOE, "R176C", APOE_OPTIONS).pmCandidates;
  const b = designWithCandidates(APOE, "R176C", APOE_OPTIONS).pmCandidates;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.candidates.length <= PM_CANDIDATE_RULE.maxCandidates);
  const perGuide = {}; for (const c of a.candidates) perGuide[`${c.guide.str}${c.guide.ps}`] = (perGuide[`${c.guide.str}${c.guide.ps}`] || 0) + 1;
  assert.ok(Object.values(perGuide).every((n) => n <= PM_CANDIDATE_RULE.maxCandidatesPerGuide));
  const model = modelOf(APOE, "APOE");
  assert.match(buildPmCandidateSet(model, "K176C", {}).err, /Expected K at position 176 but found R/);
  assert.match(buildPmCandidateSet(model, "not a change", {}).err, /protein change/);
  const mad7 = designWithCandidates(APOE, "R176C", { ...APOE_OPTIONS, enzyme: "mad7" });
  assert.match(mad7.pmCandidates.err, /SpCas9/);
});

test("negative control: the gates reject a donor with an extra amino-acid change, a missing intended base, or the wrong length", () => {
  const model = modelOf(APOE, "APOE");
  const lead = buildPmCandidateSet(model, "R176C", {}).candidates[0];
  const codon = getCodonAtAa(model, 176, toAA);
  const guide = findSpCas9Guides(model, reverseComplementDna, codon.g, 30).find((g) => g.sp === lead.guide.sp && g.str === lead.guide.str);
  const edit = { aaNumber: 176, wtAA: "R", mutAA: "C", positions: [codon.g], bases: ["T"] };
  const base = { genomicDonor: lead.donor.genomicDonor, donorStart: lead.donor.start, donorEnd: lead.donor.end };
  const gates = (donor) => evaluateRow(model, edit, guide, donor, lead.blockers, { cfd: lead.protection.engineCfd }).gates;
  assert.deepEqual(Object.values(gates(base)), [true, true, true, true, true, true]);
  const extra = base.genomicDonor.split(""); const at = codon.g + 3 - base.donorStart; extra[at] = extra[at] === "C" ? "G" : "C";
  assert.equal(gates({ ...base, genomicDonor: extra.join("") }).G1, false);
  const missing = base.genomicDonor.split(""); missing[codon.g - base.donorStart] = "C";
  assert.equal(gates({ ...base, genomicDonor: missing.join("") }).G1, false);
  const short = gates({ ...base, genomicDonor: base.genomicDonor.slice(0, 100) });
  assert.equal(short.G1, false); assert.equal(short.G4, false);
});

test("applying a candidate reproduces its guide and ssODN exactly, including later donor versions", () => {
  for (const [raw, gene, mutation] of [[APOE, "APOE", "R176C"], [TP53, "TP53", "R175H"]]) {
    const options = { deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: gene };
    const set = designWithCandidates(raw, mutation, options).pmCandidates;
    assert.ok(set.candidates.length >= 3);
    for (const c of set.candidates) {
      const applied = runDesign("pm", raw, mutation, "", 400, candidateDesignOptions(options, c));
      assert.equal(applied.err, undefined, `${gene} ${c.id}: ${applied.err}`);
      assert.equal(applied.gs.length, 1, `${gene} ${c.id}: one guide`);
      assert.equal(applied.gs[0].sp, c.guide.sp);
      assert.equal(applied.os[0].genomicDonor, c.donor.genomicDonor, `${gene} ${c.id}: plus-strand donor`);
      assert.equal(applied.os[0].od, c.donor.ssodn, `${gene} ${c.id}: ssODN as ordered`);
    }
  }
  // A second donor version really differs from the first for the same guide, and carries disjoint blockers.
  const apoe = designWithCandidates(APOE, "R176C", APOE_OPTIONS).pmCandidates;
  const sameGuide = apoe.candidates.filter((c) => c.guide.sp === "CCCCGGCCTGGTACACTGCC");
  assert.equal(sameGuide.length, 2);
  const [v0, v1] = [...sameGuide].sort((a, b) => a.donorVersion - b.donorVersion);
  assert.notEqual(v0.donor.genomicDonor, v1.donor.genomicDonor);
  assert.equal(v0.blockers.filter((b) => v1.blockers.some((x) => x.gp === b.gp)).length, 0);
  assert.deepEqual(v1.avoidBlockerPositions, v0.blockers.map((b) => b.gp));
});

test("the avoid-positions option leaves ordinary designs untouched", () => {
  const withEmpty = runDesign("pm", APOE, "R176C", "", 400, { ...APOE_OPTIONS, avoidBlockerPositions: [] });
  const plain = runDesign("pm", APOE, "R176C", "", 400, APOE_OPTIONS);
  assert.equal(JSON.stringify(withEmpty), JSON.stringify(plain));
});
