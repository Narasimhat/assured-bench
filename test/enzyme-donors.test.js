import test from "node:test";
import assert from "node:assert/strict";
import { planEnzymeModification } from "../src/engine/design/enzymeEditPlan.js";
import { parseGB, toAA, getInsertPreset, INTERNAL_TAGS } from "../src/engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel } from "../src/engine/design/transcriptModel.js";
import { applyAlleleEdits, assessEnzymeReCutting } from "../src/engine/design/enzymeDonors.js";
import { reverseComplementDna as rc } from "../src/engine/design/enzymeGuides.js";
import { enzymeDonorCsv, enzymeDonorFasta, enzymeDonorGenbank } from "../src/engine/design/enzymeDonorExport.js";
import { getEnzyme } from "../src/engine/design/enzymeConfig.js";

const site = "TTTAACGTCAGTCAGTACGATCGATCA";
const flank = "GAC".repeat(200);
const cds = "ATG" + site + site.slice(0, -1) + "C" + "GCT".repeat(60) + site + "TAA";
const sequence = flank + cds + flank;
const start = flank.length;
const gb = `LOCUS       DONOR_TEST ${sequence.length} bp DNA\nFEATURES             Location/Qualifiers
     gene            ${start + 1}..${start + cds.length}
                     /gene="TEST"
     CDS             ${start + 1}..${start + cds.length}
                     /gene="TEST"
                     /codon_start=1
ORIGIN
        1 ${sequence.toLowerCase()}
//\n`;
const base = { enzyme: "mad7", projectType: "pm", mutation: "N3K", gene: "TEST", gbRaw: gb,
  fileName: "test.gb", referenceSource: "genbank", enzymeSpacerLength: 23, guideSearchRadius: 60,
  deliveryMethod: "rnp", autoTrimArms: false, coDelivery: false };
const protein = dna => dna.match(/.../g).map(toAA).join("");

for (const enzyme of ["mad7", "ascas12a", "lbcas12a"]) {
  test(`${enzyme}: PM donor reconstructs the repaired allele and makes only the requested protein change`, () => {
    const run = planEnzymeModification({ ...base, enzyme });
    assert.ok(run.donor_design.donors.length, JSON.stringify(run.donor_design));
    const donor = run.donor_design.donors[0];
    const actualAllele = sequence.slice(0, donor.reference_interval.start) + donor.sequence + sequence.slice(donor.reference_interval.end);
    assert.equal(actualAllele, donor.repaired_reference_sequence);
    const actualCds = actualAllele.slice(start, start + cds.length);
    const expected = protein(cds).slice(0, 2) + "K" + protein(cds).slice(3);
    assert.equal(protein(actualCds), expected);
    assert.equal(donor.protein_validation.observed, expected);
    assert.ok(donor.edits.some(edit => edit.kind === "synonymous_pam"));
    assert.ok(donor.guide_protection.filter(check => donor.matched_guide_ids.includes(check.guide_id)).every(check => check.state === "canonical_pam_removed"));
    assert.equal(donor.status, "REVIEW REQUIRED");
    assert.ok(donor.guide_protection.every(check => check.cfd === null && check.residual_activity === null));
  });
}

test("co-delivery checks every matched guide; separate donors identify pairing and alternative re-cutting risks", () => {
  const pairedCds = "ATG" + site + "GCTAACATC" + "GAAAAC" + "GCT".repeat(60) + "TAA";
  const raw = { gene: "TEST", sequence: flank + pairedCds + flank, cdsStart: start + 1, cdsEnd: start + pairedCds.length };
  const joint = planEnzymeModification({ ...base, referenceSource: "raw", mutation: "S5A", coDelivery: true }, raw);
  assert.equal(joint.donor_design.selected_guide_ids.length, 2);
  assert.equal(joint.donor_design.donors.length, 2, JSON.stringify(joint.donor_design));
  assert.equal(joint.donor_design.donors[0].matched_guide_ids.length, 2);
  const separate = planEnzymeModification({ ...base, referenceSource: "raw", mutation: "S5A", coDelivery: false }, raw);
  assert.equal(separate.donor_design.donors.length, 2);
  for (const donor of separate.donor_design.donors) {
    assert.equal(donor.matched_guide_ids.length, 1);
    assert.match(donor.delivery, /do not pool/);
    assert.equal(donor.guide_protection.length, 2);
    assert.ok(donor.guide_protection.some(check => !donor.matched_guide_ids.includes(check.guide_id) && check.residual_activity === null));
  }
});

test("SNP ordering is opposite-guide; CSV/FASTA preserve ordering and GenBank annotates input-sense DNA", () => {
  const run = planEnzymeModification({ ...base, enzymeDonorStrand: "antisense" });
  const donor = run.donor_design.donors[0];
  assert.equal(donor.order_sequence, rc(donor.sequence));
  assert.match(enzymeDonorCsv(run), /antisense/);
  assert.ok(enzymeDonorCsv(run).includes(donor.order_sequence));
  assert.ok(enzymeDonorFasta(run).replace(/\n/g, "").includes(donor.order_sequence));
  const exported = enzymeDonorGenbank(run);
  const parsed = parseGB(exported);
  assert.equal(parsed.seq, donor.sequence);
  assert.ok(parsed.feats.some(feature => feature.type === "misc_difference"));
  assert.ok(parsed.feats.filter(feature => feature.type === "misc_feature").length >= 3);
});

test("internal-tag donor inserts the exact curated sequence in frame and preserves the rest of the protein", () => {
  const run = planEnzymeModification({ ...base, projectType: "it", mutation: "N3", tag: "SPOT" });
  assert.ok(run.donor_design.donors.length, JSON.stringify(run.donor_design));
  const donor = run.donor_design.donors[0];
  assert.ok(donor.sequence.includes(INTERNAL_TAGS.SPOT.seq));
  const repairedCds = donor.repaired_reference_sequence.slice(start, start + cds.length + INTERNAL_TAGS.SPOT.seq.length);
  assert.equal(protein(repairedCds), protein(cds).slice(0, 3) + INTERNAL_TAGS.SPOT.aa + protein(cds).slice(3));
  assert.ok(donor.insert_validation.framePreserved);
});

for (const [type, tag] of [["ct", "SD40-2xHA"], ["nt", "N:EGFP-Linker"]]) {
  test(`${type}: terminal donor uses the curated cassette and correct start/stop replacement`, () => {
    const run = planEnzymeModification({ ...base, projectType: type, tag, guideSearchRadius: 60,
      donorFormat: "block", homologyArm: "200", homologyArm3: "250" });
    assert.ok(run.donor_design.donors.length, JSON.stringify(run.donor_design));
    const donor = run.donor_design.donors[0];
    const preset = getInsertPreset(tag, type);
    const length = cds.length + preset.seq.length - 3;
    const actual = protein(donor.repaired_reference_sequence.slice(start, start + length));
    const expected = type === "ct" ? protein(cds).slice(0, -1) + protein(preset.seq) : protein(preset.seq) + protein(cds).slice(1);
    assert.equal(actual, expected);
    assert.equal(donor.arms.five, 200);
    assert.equal(donor.arms.three, 250);
    assert.ok(donor.insert_validation.framePreserved);
  });
}

test("short reference, impossible format, insufficient arm geometry and missing guides cannot emit invalid donors", () => {
  const limitedReference = planEnzymeModification({ ...base, referenceSource: "raw" }, { gene: "TEST", sequence: cds, cdsStart: 1, cdsEnd: cds.length });
  assert.ok(limitedReference.donor_design.donors.length);
  assert.ok(limitedReference.donor_design.donors.every(donor => donor.order_sequence.length === 127));
  const short = planEnzymeModification({ ...base, donorFormat: "block", homologyArm: "20" });
  assert.ok(short.donor_design.donors.length);
  assert.ok(short.donor_design.donors.every(donor => donor.order_sequence.length === 127));
  const long = planEnzymeModification({ ...base, donorFormat: "ssodn", homologyArm: "200" });
  assert.ok(long.donor_design.donors.length);
  assert.ok(long.donor_design.donors.every(donor => donor.order_sequence.length === 127));
  const noGuides = planEnzymeModification({ ...base, guideSearchRadius: 1 });
  assert.equal(noGuides.donor_design.donors.length, 0);
  assert.match(noGuides.donor_design.errors.join(" "), /No guide passes/);
});

test("internal tags at an annotated splice/start boundary refuse a splice-unchecked donor", () => {
  const run = planEnzymeModification({ ...base, referenceSource: "raw", projectType: "it", mutation: "M1", tag: "SPOT" },
    { gene: "TEST", sequence, cdsStart: start + 1, cdsEnd: start + cds.length });
  assert.equal(run.donor_design.donors.length, 0);
  assert.match(run.donor_design.errors.join(" "), /exon boundary/);
});

test("a retained exact target blocks the matched donor; mismatched targets remain unscored", () => {
  const run = planEnzymeModification({ ...base, mutation: "N12K", enzymePamBlocking: false });
  const donor = run.donor_design.donors[0];
  assert.equal(donor.status, "BLOCKED");
  assert.equal(run.status, "BLOCKED");
  const model = normalizeGenBankToTranscriptModel(parseGB(gb));
  const guide = run.candidates[0];
  const assessment = assessEnzymeReCutting(model, guide, getEnzyme("mad7"), [{ start: guide.spacer_start, end: guide.spacer_start + 1, sequence: "C", kind: "test" }]);
  // Other exact occurrences nearby can conservatively preserve the block.
  assert.ok(["mismatched_target_unscored", "intact_target"].includes(assessment.state));
  assert.equal(assessment.residual_activity, null);
});

test("allele reconstruction rejects overlapping edits and frameshift knockout has no HDR donor", () => {
  assert.throws(() => applyAlleleEdits("ACGT", [{ start: 0, end: 2, sequence: "AA" }, { start: 1, end: 3, sequence: "CC" }]), /overlapping/);
  const ko = planEnzymeModification({ ...base, projectType: "ko" });
  assert.equal(ko.donor_design.status, "not_required");
  assert.deepEqual(ko.donor_design.donors, []);
});

test("minus-strand Cas12-family guides retain input-oriented donor edits and synonymous PAM changes", () => {
  const minusCds = "ATG" + "GCTAACATC".repeat(4) + "TTAAAG" + "GCTAACATC".repeat(10) + "TAA";
  const raw = { gene: "TEST", sequence: flank + minusCds + flank, cdsStart: start + 1, cdsEnd: start + minusCds.length };
  const run = planEnzymeModification({ ...base, referenceSource: "raw", mutation: "I10V", guideSearchRadius: 60 }, raw);
  const guide = run.candidates.find(candidate => candidate.strand === "-" && candidate.qc.passed);
  assert.ok(guide, "Fixture must contain a passing minus-strand guide");
  const matched = planEnzymeModification({ ...base, referenceSource: "raw", mutation: "I10V", customGuides: guide.spacer,
    guideSearchRadius: 60, enzymeDonorStrand: "antisense" }, raw);
  assert.ok(matched.donor_design.donors.length, JSON.stringify(matched.donor_design));
  const donor = matched.donor_design.donors[0];
  assert.equal(donor.order_sequence, donor.sequence);
  assert.equal(donor.strand, "sense");
  const expected = protein(minusCds).slice(0, 9) + "V" + protein(minusCds).slice(10);
  assert.equal(protein(donor.repaired_reference_sequence.slice(start, start + minusCds.length)), expected);
  assert.ok(donor.guide_protection.some(check => check.state === "canonical_pam_removed"));
});
