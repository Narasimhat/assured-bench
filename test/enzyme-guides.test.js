import test from "node:test";
import assert from "node:assert/strict";
import { getEnzyme, pamRegex } from "../src/engine/design/enzymeConfig.js";
import { findEnzymeGuides, reverseComplementDna as rc, designEnzymeGuides, assessEnzymeGuide } from "../src/engine/design/enzymeGuides.js";
import { findSpCas9Guides } from "../src/engine/design/transcriptModel.js";
import { runDesignFromTranscriptModel } from "../src/engine/design/designEngine.js";
import { casOffinderInput, parseCasOffinder, summarizeOffTargets } from "../src/engine/design/enzymeOffTargets.js";
import { enzymeGuideCsv, enzymeGuideGenbank } from "../src/engine/design/enzymeGuideExport.js";
const spacer = "ACGTCAGTCAGTACGATCGATCA";
const permissive = { gc_min: 0, gc_max: 100, max_homopolymer: 0, self_complement_length: 0 };

test("enzyme records are versioned, immutable and reject unknown enzymes/PAM codes", () => {
  assert.equal(getEnzyme().pam_side, "3prime");
  assert.equal(getEnzyme("mad7").direct_repeat, null);
  assert.throws(() => { getEnzyme("mad7").cut_offsets.target = 1; }, TypeError);
  assert.throws(() => getEnzyme("unknown"));
  assert.throws(() => pamRegex("ZGG"));
  assert.ok(pamRegex("YTTN").test("CTTA"));
  assert.ok(!pamRegex("TTTV").test("TTTT"));
});
for (const [enzyme, pam] of [["mad7", "CTTA"], ["ascas12a", "TTTG"], ["lbcas12a", "TTTG"]]) {
  test(`${enzyme}: exact PAM/spacer and staggered interbase cuts on both strands`, () => {
    const site = pam + spacer;
    const plus = findEnzymeGuides(site, { enzyme }).find(guide => guide.start === 0 && guide.strand === "+");
    assert.equal(plus.spacer, spacer);
    assert.equal(plus.pam, pam);
    assert.deepEqual(plus.cuts, { target: 27, non_target: 22 });
    assert.deepEqual([plus.pam_start, plus.pam_end, plus.spacer_start, plus.spacer_end], [0, 4, 4, 27]);
    const minus = findEnzymeGuides(rc(site), { enzyme }).find(guide => guide.start === 0 && guide.strand === "-");
    assert.equal(minus.spacer, spacer);
    assert.equal(minus.pam, pam);
    assert.deepEqual(minus.cuts, { target: 0, non_target: 5 });
    assert.deepEqual([minus.spacer_start, minus.spacer_end, minus.pam_start, minus.pam_end], [0, 23, 23, 27]);
  });
}
test("SpCas9 retains 3-prime PAM and plus/minus cut conventions", () => {
  const site = spacer.slice(0, 20) + "AGG";
  const plus = findEnzymeGuides(site).find(guide => guide.strand === "+");
  const minus = findEnzymeGuides(rc(site)).find(guide => guide.strand === "-");
  assert.deepEqual(plus.cuts, { target: 17, non_target: 17 });
  assert.deepEqual(minus.cuts, { target: 6, non_target: 6 });
  assert.equal(plus.spacer, minus.spacer);
});
test("overlapping PAMs survive, incomplete and ambiguous sites do not", () => {
  const guides = findEnzymeGuides("CTTTTA" + spacer, { enzyme: "mad7" });
  assert.ok(guides.some(guide => guide.start === 0 && guide.strand === "+"));
  assert.ok(guides.some(guide => guide.start === 1 && guide.strand === "+"));
  assert.deepEqual(findEnzymeGuides("CTTA" + spacer.slice(0, 22), { enzyme: "mad7" }), []);
  assert.deepEqual(findEnzymeGuides("CTTA" + "N".repeat(23), { enzyme: "mad7" }), []);
  assert.throws(() => findEnzymeGuides("CTTA" + spacer, { enzyme: "mad7", spacerLength: 19 }));
  assert.throws(() => designEnzymeGuides(">a\nACGT\n>b\nACGT"));
});
test("filters distinguish RNP/Pol III, homopolymers, hairpins, and half-open exclusions", () => {
  const config = getEnzyme("mad7");
  const guide = { spacer: "ACGTTTTACG", gc: 50, start: 5, end: 15 };
  assert.ok(assessEnzymeGuide(guide, config, { filters: permissive }).passed);
  assert.ok(assessEnzymeGuide(guide, config, { filters: permissive, delivery: "poliii" }).reasons.includes("poliii_terminator"));
  assert.ok(assessEnzymeGuide({ ...guide, spacer: "AAAAA" }, config).reasons.includes("homopolymer"));
  assert.ok(assessEnzymeGuide({ ...guide, spacer: "ACGTACGGGGTACGT" }, config, { filters: { self_complement_length: 5 } }).reasons.includes("self_complementarity"));
  assert.ok(assessEnzymeGuide(guide, config, { filters: permissive, exclusions: [{ start: 0, end: 5 }] }).passed);
  assert.ok(!assessEnzymeGuide(guide, config, { filters: permissive, exclusions: [{ start: 14, end: 16 }] }).passed);
  assert.throws(() => designEnzymeGuides("AAAA", { filters: { gc_min: 80, gc_max: 20 } }));
});
test("Mad7 repeat is never guessed and full RNA records user verification and model provenance", () => {
  const options = { enzyme: "mad7", filters: permissive };
  const run = designEnzymeGuides("CTTA" + spacer, options);
  assert.equal(run.candidates[0].full_crrna, null);
  assert.equal(run.candidates[0].score.value, null);
  const verified = designEnzymeGuides("CTTA" + spacer, { ...options, directRepeat: "ACGT", repeatVerified: true,
    repeatSource: "synthetic test fixture, not a licensed repeat", scorer: () => ({ value: 72, model: "test-proxy", version: "fixture-v1" }) });
  assert.equal(verified.candidates[0].full_crrna, "ACGU" + spacer.replace(/T/g, "U"));
  assert.equal(verified.candidates[0].score.approximate, true);
  assert.equal(verified.candidates[0].score.version, "fixture-v1");
  assert.equal(verified.status, "REVIEW REQUIRED");
  assert.throws(() => designEnzymeGuides("CTTA" + spacer, { ...options, scorer: () => ({ value: NaN }) }));
});
test("CSV/GenBank carry enzyme, full parameters, filters and input-oriented minus annotations", () => {
  const run = designEnzymeGuides(rc("CTTA" + spacer), { enzyme: "mad7", filters: permissive });
  const csv = enzymeGuideCsv(run);
  assert.match(csv, /config_version/);
  assert.match(csv, /self_complement_length/);
  assert.match(csv, /mad7/);
  assert.ok(csv.includes(',"-",'));
  const gb = enzymeGuideGenbank(run);
  assert.match(gb, /complement\(1\.\.23\)/);
  assert.match(gb, /complement\(24\.\.27\)/);
  assert.match(gb, /REVIEW REQUIRED/);
});
test("Cas-OFFinder uses a 5-prime PAM, validates output, and weights the PAM-proximal seed", () => {
  const run = designEnzymeGuides("CTTA" + spacer, { enzyme: "mad7", filters: permissive });
  const input = casOffinderInput(run, "/genome.fa");
  assert.equal(input.split("\n")[1], "YTTN" + "N".repeat(23));
  const query = "NNNN" + spacer;
  const proximal = "T" + spacer.slice(1);
  const distal = spacer.slice(0, -1) + "T";
  const rows = [`${query}\tchr1\t100\tCTTA${spacer}\t+\t0`,
    `${query}\tchr1\t200\tCTTA${proximal}\t-\t1`, `${query}\tchr1\t300\tCTTA${distal}\t+\t1`];
  const hits = parseCasOffinder(rows.join("\n"), run);
  assert.equal(hits.length, 3);
  assert.ok(hits.find(hit => hit.start === 200).risk < hits.find(hit => hit.start === 300).risk);
  assert.equal(summarizeOffTargets(hits, { complete: true }).specificity, null);
  const summary = summarizeOffTargets(hits, { complete: true, intendedTarget: { chromosome: "chr1", start: 100, strand: "+" } });
  assert.ok(summary.specificity > 0 && summary.specificity < 100);
  assert.equal(summary.off_target_count, 2);
  assert.equal(summary.approximate, true);
  assert.throws(() => parseCasOffinder(rows[0].replace(/\t0$/, "\t1"), run));
  assert.throws(() => parseCasOffinder(rows[0].replace("CTTA", "AAAA"), run));
  assert.throws(() => casOffinderInput(run, "/genome.fa\ninjected"));
});
test("legacy Cas9 adapter preserves exhaustive ordering, fields, windows and homopolymer policy", () => {
  let seed = 11;
  const sequence = Array.from({ length: 4000 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return "ACGT"[(seed >>> 16) % 4]; }).join("")
    + ("ACGTCAGTAGCTACGATCGAAGGCCATGCATGCATGCATGCATG".repeat(20)) + "ARNGTCAGTAGCTACGATCGAAGG";
  for (const [target, range] of [[0, 100], [4020, 50], [sequence.length, 100], [4200, 5000]]) {
    const expected = [];
    for (let pos = Math.max(0, target - range - 23); pos <= Math.min(sequence.length - 23, target + range); pos++) {
      const raw = sequence.slice(pos, pos + 23);
      for (const strand of ["+", "-"]) {
        const site = strand === "+" ? raw : rc(raw);
        const sp = site.slice(0, 20), pam = site.slice(20), cut = pos + (strand === "+" ? 17 : 6);
        if (/^[ACGT]GG$/.test(pam) && !sp.includes("AAAAA") && !sp.includes("TTTTT") && Math.abs(cut - target) <= range)
          expected.push({ sp, pam, str: strand, cut, d: cut - target, gc: Math.round([...sp].filter(b => /[GC]/.test(b)).length / 20 * 100), ps: pos });
      }
    }
    assert.deepEqual(findSpCas9Guides({ genomicSequence: sequence }, rc, target, range), expected);
  }
});
test("Enzyme design validates its reference before entering the shared workflow", () => {
  assert.match(runDesignFromTranscriptModel("pm", null, "A1G", null, 100, { enzyme: "mad7" }).err, /missing genomic sequence/);
});
