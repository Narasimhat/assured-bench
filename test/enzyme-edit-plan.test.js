import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchGeneReference } from "../src/engine/design/geneFetch.js";
import { planEnzymeModification } from "../src/engine/design/enzymeEditPlan.js";
import { enzymeGuideCsv, enzymeGuideGenbank } from "../src/engine/design/enzymeGuideExport.js";

const site = "CTTAACGTCAGTCAGTACGATCGATCA";
const flank = "GAC".repeat(20);
const cds = "ATG" + site + "GCT".repeat(30) + site + "TAA";
const sequence = flank + cds + flank;
const gb = `LOCUS       TEST ${sequence.length} bp DNA\nFEATURES             Location/Qualifiers
     gene            61..${60 + cds.length}
                     /gene="TEST"
     CDS             61..${60 + cds.length}
                     /gene="TEST"
                     /codon_start=1
ORIGIN
        1 ${sequence.toLowerCase()}
//\n`;
const base = { enzyme: "mad7", projectType: "pm", mutation: "N3K", gene: "TEST", gbRaw: gb,
  fileName: "synthetic.gb", referenceSource: "genbank", enzymeSpacerLength: 23, guideSearchRadius: 30, deliveryMethod: "rnp" };

test("uploaded GenBank and fetched GenBank use the same modification-aware guide planning", () => {
  const run = planEnzymeModification(base);
  assert.equal(run.reference.gene, "TEST");
  assert.equal(run.modification.label, "Point mutation N3K");
  assert.equal(run.modification.target_boundary, 66);
  assert.ok(run.candidates.length > 0);
  assert.ok(run.candidates.every(guide => guide.cut_distance <= 30));
  assert.ok(["review_required", "blocked"].includes(run.modification.donor_status));
  assert.equal(run.status, "REVIEW REQUIRED");
  assert.equal(run.parameters.delivery, "rnp");
  const fetched = planEnzymeModification({ ...base, fileName: "TEST_Ensembl.gb" });
  assert.deepEqual(fetched.candidates, run.candidates);
  assert.match(enzymeGuideCsv(run), /Point mutation N3K/);
  assert.match(enzymeGuideGenbank(run), /target_boundary/);
});
test("raw DNA/CDS inputs map to the same edit boundary and candidates", () => {
  const raw = planEnzymeModification({ ...base, referenceSource: "raw" }, {
    gene: "TEST", sequence, cdsStart: 61, cdsEnd: 60 + cds.length,
  });
  const uploaded = planEnzymeModification(base);
  assert.equal(raw.modification.target_boundary, uploaded.modification.target_boundary);
  assert.deepEqual(raw.candidates, uploaded.candidates);
});
test("mutation identity and reference gene are checked before searching", () => {
  assert.throws(() => planEnzymeModification({ ...base, mutation: "R3K" }), /Expected R.*found N/);
  assert.throws(() => planEnzymeModification({ ...base, mutation: "N3N" }), /different alternate/);
  assert.throws(() => planEnzymeModification({ ...base, gene: "WRONG" }), /no CDS for WRONG/);
  assert.throws(() => planEnzymeModification({ ...base, gbRaw: "" }), /CDS annotation/);
});
test("all modification types select their own target region", () => {
  const internal = planEnzymeModification({ ...base, projectType: "it", mutation: "N3", tag: "SPOT" });
  assert.equal(internal.modification.target_boundary, 69);
  const nt = planEnzymeModification({ ...base, projectType: "nt", tag: "N:EGFP-Linker" });
  assert.equal(nt.modification.target_boundary, 60);
  const ct = planEnzymeModification({ ...base, projectType: "ct", tag: "SD40-2xHA" });
  assert.equal(ct.modification.target_boundary, 60 + cds.length - 3);
  assert.ok(ct.candidates.length > 0);
  const ko = planEnzymeModification({ ...base, projectType: "ko" });
  assert.equal(ko.modification.target_boundary, null);
  assert.ok(ko.candidates.length > 0);
  assert.ok(ko.candidates.every(guide => Object.values(guide.cuts).some(cut => cut >= 60 && cut < 60 + cds.length)));
});
test("custom spacers cannot map to unrelated sites or bypass enzyme PAM and region checks", () => {
  const run = planEnzymeModification(base);
  const custom = planEnzymeModification({ ...base, customGuides: run.candidates[0].spacer });
  assert.ok(custom.candidates.every(guide => guide.spacer === run.candidates[0].spacer));
  assert.throws(() => planEnzymeModification({ ...base, customGuides: "A".repeat(23) }), /does not map/);
  assert.throws(() => planEnzymeModification({ ...base, guideSearchRadius: 0 }), /1–500/);
});

test("actual recorded Ensembl fetches feed Mad7 modification planning for forward and reverse genes", async () => {
  const replies = JSON.parse(await readFile(new URL("./fixtures/gene-fetch/responses.json", import.meta.url), "utf8"));
  const fetchImpl = async url => {
    const hit = replies[url];
    if (!hit) throw new Error(`No recorded response for ${url}`);
    return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, headers: { get: () => null },
      json: async () => JSON.parse(hit.body), text: async () => hit.body };
  };
  for (const [gene, mutation] of [["MYD88", "P265L"], ["HBB", "E7V"]]) {
    const reference = await fetchGeneReference({ query: gene, source: "ensembl", fetchImpl, sleep: async () => {} });
    const run = planEnzymeModification({ ...base, gene, mutation, gbRaw: reference.genbank, fileName: reference.fileName });
    assert.equal(run.reference.gene, gene);
    assert.equal(run.modification.label, `Point mutation ${mutation}`);
    assert.ok(run.modification.target_boundary > 0);
    assert.ok(run.candidates.every(guide => guide.cut_distance <= 30));
  }
});
