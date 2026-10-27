import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designWithCandidates } from "../src/engine/design/pmCandidates.js";
import { readGenomicReferenceMetadata } from "../src/engine/design/genomicSnp.js";
import { ANCHOR_LENGTH, MAX_GENE_SPAN, anchorStarts, describeMapping, resolveReferenceMapping } from "../src/services/referenceMapping.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APOE = fs.readFileSync(path.join(ROOT, "public", "references", "apoe-ensg00000130203.gb"), "utf8");
const design = designWithCandidates(APOE, "R176C", { deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: "APOE" });
const REFERENCE = design.gb.genomicSequence; const EDIT = design.pmCandidates.edit.positions[0];
// Ground truth that does not come from the code under test: the bundled record states where it sits ("Location: chr19 44905754-44909393").
const TRUE_START = Number(/Location:\s*chr19\s+(\d+)-(\d+)/.exec(APOE)[1]);

/**
 * A stand-in for Ensembl REST whose "genome" is the bundled APOE reference placed at its true position. Outside it, region requests fail like
 * Ensembl does for coordinates it cannot serve. The gene is reported narrower than the reference so the flank-comparison path is used.
 */
function fakeEnsembl({ genome = REFERENCE, origin = TRUE_START, gene = {}, lookupStatus = 200, regionStatus = null, log = [] } = {}) {
  const span = { start: origin + 700, end: origin + genome.length - 500 };
  const body = { object_type: "Gene", id: "ENSG00000130203", display_name: "APOE", seq_region_name: "19", assembly_name: "GRCh38", strand: 1, ...span, ...gene };
  const fetchImpl = async (url) => {
    log.push(url);
    const reply = (status, payload, text) => ({ status, ok: status >= 200 && status < 300, json: async () => payload, text: async () => text });
    if (url.includes("/lookup/symbol/homo_sapiens/")) return lookupStatus === 200 ? reply(200, body) : reply(lookupStatus, {});
    const m = /sequence\/region\/homo_sapiens\/([^:]+):(\d+)\.\.(\d+):1/.exec(url);
    if (!m) return reply(404, {});
    if (regionStatus) return reply(regionStatus, {});
    const [a, b] = [Number(m[2]), Number(m[3])];
    if (a < origin || b >= origin + genome.length) return reply(400, { error: "region outside the fake genome" });
    return reply(200, null, genome.slice(a - origin, b - origin + 1));
  };
  return { fetchImpl, log, body };
}
const noWait = async () => {};
const run = (extra = {}, ens = fakeEnsembl()) => resolveReferenceMapping({ gene: "APOE", sequence: REFERENCE, editIndex: EDIT, fetchImpl: ens.fetchImpl, sleep: noWait, ...extra });
// Small deterministic generator so the synthetic cases are the same on every run.
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const randomDna = (n, seed) => { const r = lcg(seed); return Array.from({ length: n }, () => "ACGT"[Math.floor(r() * 4)]).join(""); };
const substitute = (seq, positions) => { const a = [...seq]; for (const i of positions) a[i] = a[i] === "A" ? "C" : "A"; return a.join(""); };

test("the position of the bundled APOE reference is recovered from the design alone and equals the position the record states", async () => {
  assert.equal(TRUE_START, 44905754); assert.equal(EDIT, 3068);
  const ens = fakeEnsembl();
  const out = await run({}, ens);
  assert.equal(out.ok, true);
  assert.deepEqual([out.chromosome, out.referenceStart, out.referenceEnd, out.assembly], ["19", TRUE_START, TRUE_START + REFERENCE.length - 1, "GRCh38"]);
  assert.deepEqual(out.comparison, { length: REFERENCE.length, compared: REFERENCE.length, mismatches: 0, identity: 1 });
  assert.equal(out.anchor.length, ANCHOR_LENGTH); assert.equal(out.anchor.index, EDIT - ANCHOR_LENGTH, "the stretch just before the edit was used first");
  assert.equal(readGenomicReferenceMetadata("Location: chromosome:GRCh38:19:44905754:44909393:1").start, out.referenceStart, "same number the Genomic SNP tool reads from a stated location");
  assert.equal(ens.log.filter((u) => u.includes("/lookup/")).length, 1);
  assert.equal(ens.log.filter((u) => u.includes("/sequence/region/")).length, 2, "gene sequence, then the flank region the gene does not cover");
  assert.match(describeMapping(out), /^Filled from Ensembl: APOE is on chromosome 19 \(GRCh38\) and the uploaded sequence starts at 44,905,754; it matches GRCh38 at all 3,640 bases\. Check the numbers, then tick the box\.$/);
  assert.ok(ens.log.every((u) => u.startsWith("https://rest.ensembl.org/")), "only Ensembl is contacted");
  assert.ok(ens.log.every((u) => !u.includes(REFERENCE.slice(EDIT - 20, EDIT + 20))), "the reference sequence is never sent");
});

test("a reference cut at either end, and one longer than the gene, are placed by the same rule", async () => {
  const left = await run({ sequence: REFERENCE.slice(1000), editIndex: EDIT - 1000 });
  assert.equal(left.referenceStart, TRUE_START + 1000); assert.equal(left.comparison.mismatches, 0);
  const right = await run({ sequence: REFERENCE.slice(0, 3300), editIndex: EDIT });
  assert.equal(right.referenceStart, TRUE_START); assert.equal(right.referenceEnd, TRUE_START + 3299);
  // gene covering the whole reference: no flank request is needed
  const wide = fakeEnsembl({ gene: { start: TRUE_START, end: TRUE_START + REFERENCE.length - 1 } });
  const inside = await run({}, wide);
  assert.equal(inside.referenceStart, TRUE_START);
  assert.equal(wide.log.filter((u) => u.includes("/sequence/region/")).length, 1, "the gene sequence already covers the reference: no second request");
});

test("differences from GRCh38 are counted: a few far from the edit are reported, many are refused", async () => {
  const few = await run({ sequence: substitute(REFERENCE, [100, 900, 1500]) });
  assert.equal(few.ok, true); assert.equal(few.comparison.mismatches, 3);
  assert.match(describeMapping(few), /matches GRCh38 at 3,637 of 3,640 bases \(3 differ\)/);
  const spread = Array.from({ length: 80 }, (_, i) => 20 + i * 44).filter((i) => Math.abs(i - EDIT) > 300);
  const many = await run({ sequence: substitute(REFERENCE, spread) });
  assert.equal(many.ok, false); assert.equal(many.reason, "mismatch"); assert.match(many.message, /differs from GRCh38 at \d+ of 3,640 bases/);
});

test("a sequence that is not in the gene, or is repeated there, is not placed", async () => {
  const other = await run({ sequence: randomDna(3640, 7) });
  assert.equal(other.ok, false); assert.equal(other.reason, "not-found-in-gene"); assert.match(other.message, /different gene or assembly/);
  // A 400-base block that occurs twice in the gene, with the reference being just that block: every stretch near the edit is ambiguous.
  const block = randomDna(400, 11);
  const genome = randomDna(600, 12) + block + randomDna(500, 13) + block + randomDna(600, 14);
  const ens = fakeEnsembl({ genome, origin: 1000, gene: { start: 1000, end: 1000 + genome.length - 1 } });
  const repeated = await resolveReferenceMapping({ gene: "APOE", sequence: block, editIndex: 200, fetchImpl: ens.fetchImpl, sleep: noWait });
  assert.equal(repeated.reason, "not-found-in-gene");
  // The same block with different sequence on either side is placed through a stretch that reaches beyond the repeat.
  const unique = randomDna(600, 15) + block + randomDna(500, 16) + block + randomDna(600, 17);
  const ens2 = fakeEnsembl({ genome: unique, origin: 1000, gene: { start: 1000, end: 1000 + unique.length - 1 } });
  // edit 10 bases before the end of the first copy: the stretch before it lies inside the repeat (ambiguous), the stretch after it runs on into unique sequence
  const flanked = await resolveReferenceMapping({ gene: "APOE", sequence: unique.slice(560, 1040), editIndex: 600 + 390 - 560, fetchImpl: ens2.fetchImpl, sleep: noWait });
  assert.equal(flanked.ok, true); assert.equal(flanked.referenceStart, 1000 + 560);
});

test("what Ensembl says about the gene is respected: unknown symbol, other assembly, other strand, too large, other chromosome naming", async () => {
  assert.equal((await run({}, fakeEnsembl({ lookupStatus: 404 }))).reason, "not-found");
  assert.equal((await run({}, fakeEnsembl({ lookupStatus: 400 }))).reason, "not-found");
  const grch37 = await run({}, fakeEnsembl({ gene: { assembly_name: "GRCh37" } }));
  assert.deepEqual([grch37.ok, grch37.reason], [false, "assembly"]);
  const minus = await run({}, fakeEnsembl({ gene: { strand: -1 } }));
  assert.deepEqual([minus.ok, minus.reason], [false, "minus-strand"]); assert.match(minus.message, /reverse strand/);
  const big = await run({}, fakeEnsembl({ gene: { start: 1, end: MAX_GENE_SPAN + 5 } }));
  assert.equal(big.reason, "too-large");
  const scaffold = await run({}, fakeEnsembl({ gene: { seq_region_name: "HSCHR6_MHC_COX_CTG1" } }));
  assert.equal(scaffold.reason, "not-found");
  const prefixed = await run({}, fakeEnsembl({ gene: { seq_region_name: "chr19" } }));
  assert.equal(prefixed.chromosome, "19");
});

test("network trouble is retried, then reported as a reason to enter the position by hand", async () => {
  let calls = 0; const sleeps = [];
  const down = async () => { calls += 1; throw new TypeError("Failed to fetch"); };
  const out = await resolveReferenceMapping({ gene: "APOE", sequence: REFERENCE, editIndex: EDIT, fetchImpl: down, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual([out.ok, out.reason], [false, "network"]); assert.equal(calls, 3); assert.equal(sleeps.length, 2); assert.match(out.message, /enter the position by hand/);
  const busy = fakeEnsembl({ regionStatus: 503 });
  const overloaded = await run({}, busy);
  assert.equal(overloaded.reason, "network"); assert.equal(busy.log.filter((u) => u.includes("/sequence/")).length, 3, "retried before giving up");
  const noSequence = await run({}, fakeEnsembl({ regionStatus: 500 }));
  assert.equal(noSequence.ok, false);
});

test("inputs that cannot be looked up are refused before anything is sent", async () => {
  const ens = fakeEnsembl();
  for (const bad of [{ gene: "" }, { gene: "A/B" }, { gene: "x".repeat(40) }, { sequence: "ACGTX" }, { sequence: "" }, { editIndex: -1 }, { editIndex: REFERENCE.length }, { editIndex: 1.5 }]) {
    const out = await resolveReferenceMapping({ gene: "APOE", sequence: REFERENCE, editIndex: EDIT, ...bad, fetchImpl: ens.fetchImpl, sleep: noWait });
    assert.equal(out.ok, false, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(ens.log.length, 0);
});

test("anchor choice: the stretch before the edit first, then after, then further out, always inside the sequence", () => {
  const starts = anchorStarts(3640, 3068);
  assert.deepEqual(starts.slice(0, 4), [3028, 3069, 2908, 3189]);
  assert.ok(starts.every((s) => s >= 0 && s + ANCHOR_LENGTH <= 3640));
  assert.deepEqual(anchorStarts(100, 10), [11], "an edit near the start has only the stretch after it");
  assert.deepEqual(anchorStarts(30, 10), [], "a sequence shorter than the stretch has none");
});

const rc = (seq) => [...seq].reverse().map((b) => ({ A: "T", C: "G", G: "C", T: "A", N: "N" }[b])).join("");

test("a reference written along a reverse-strand gene is placed after reverse-complementing it, when the caller can use that", async () => {
  const origin = 50000; const genome = randomDna(6000, 21);
  const gene = { strand: -1, start: origin + 500, end: origin + 5499, seq_region_name: "17", display_name: "REV1" };
  const ens = () => fakeEnsembl({ genome, origin, gene });
  // the record starts 300 bases into the genome and ends at 5800; written along the gene, so it is the reverse complement of the chromosome there
  const record = rc(genome.slice(300, 5800));
  const genomeEdit = 3000; const editIndex = record.length - 1 - (genomeEdit - 300);
  const out = await resolveReferenceMapping({ gene: "REV1", sequence: record, editIndex, orientations: [1, -1], fetchImpl: ens().fetchImpl, sleep: noWait });
  assert.equal(out.ok, true);
  assert.deepEqual([out.chromosome, out.orientation, out.referenceStart, out.referenceEnd], ["17", -1, origin + 300, origin + 5799], "start is the lowest chromosome coordinate the record covers");
  assert.deepEqual(out.comparison, { length: 5500, compared: 5500, mismatches: 0, identity: 1 });
  assert.match(describeMapping(out), /^Filled from Ensembl: REV1 is on chromosome 17 \(GRCh38\) and the uploaded sequence is written on the opposite strand \(reverse complement of the chromosome\) and covers chromosome positions from 50,300; it matches GRCh38 at all 5,500 bases\./);
  // the position convention is the one the review tool uses: index i of the record is chromosome position start + length - 1 - i
  assert.equal(out.referenceStart + record.length - 1 - editIndex, origin + genomeEdit);
  // a caller that only handles plus-strand references is told, and nothing but the lookup is requested
  const plusOnly = ens();
  const refused = await resolveReferenceMapping({ gene: "REV1", sequence: record, editIndex, fetchImpl: plusOnly.fetchImpl, sleep: noWait });
  assert.deepEqual([refused.ok, refused.reason], [false, "minus-strand"]); assert.equal(plusOnly.log.length, 1);
  // a plus-strand gene whose record happens to be written the other way round is recognised too, not silently misplaced
  const plusGene = { strand: 1, start: origin + 500, end: origin + 5499, seq_region_name: "17", display_name: "FWD1" };
  const backwards = await resolveReferenceMapping({ gene: "FWD1", sequence: record, editIndex, orientations: [1, -1], fetchImpl: fakeEnsembl({ genome, origin, gene: plusGene }).fetchImpl, sleep: noWait });
  assert.deepEqual([backwards.ok, backwards.orientation], [true, -1]);
  const notThere = await resolveReferenceMapping({ gene: "FWD1", sequence: randomDna(5500, 22), editIndex: 2700, orientations: [1, -1], fetchImpl: fakeEnsembl({ genome, origin, gene: plusGene }).fetchImpl, sleep: noWait });
  assert.equal(notThere.reason, "not-found-in-gene"); assert.match(notThere.message, /in either orientation/);
});
