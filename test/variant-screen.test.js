import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesign } from "../src/engine/design/designEngine.js";
import { screenTargetVariants, genomicFrameOfRecord, frequencyOf, parseHgvs, screeningSites } from "../src/services/variantScreen.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, "..", rel), "utf8");
const DIPK2A = read("public/references/dipk2a-region.gb");
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "dbsnp-dipk2a.json"), "utf8"));
const design = runDesign("ko", DIPK2A, "", "", 400, { deliveryMethod: "rnp" });
const replay = (responses = fixture.responses) => async (url) => (url in responses ? { ok: true, status: 200, json: async () => responses[url] } : { ok: false, status: 404, json: async () => ({}) });
// answers any window with the recorded windows in order, and any id list from the recorded documents: for cases where the requested windows differ from the recording
const looseReplay = () => {
  const ordered = Object.entries(fixture.responses); const searches = ordered.filter(([url]) => /esearch/.test(url)).map(([, json]) => json);
  const docs = Object.assign({}, ...ordered.filter(([url]) => /esummary/.test(url)).map(([, json]) => json.result)); let n = 0;
  return async (url) => ({ ok: true, status: 200, json: async () => (/esearch/.test(url) ? searches[n++ % searches.length] : { result: Object.fromEntries((new URL(url).searchParams.get("id") || "").split(",").map((id) => [id, docs[id]])) }) });
};
const NOW = () => new Date("2026-10-26T12:00:00Z");
const screen = (extra = {}) => screenTargetVariants({ gene: "DIPK2A", genbankRaw: DIPK2A, designResult: design, fetchFn: replay(), delayMs: 0, now: NOW, ...extra });

test("the DIPK2A design's gRNA2 is flagged: rs9847681 sits at its PAM-adjacent base, T allele about 5% (the case the curated table missed)", async () => {
  const r = await screen();
  assert.equal(r.status, "flagged");
  const g2 = r.guideChecks.find((g) => g.spacer === "TTTCCATTAATTGCCAAGCG");
  assert.equal(g2.status, "flagged");
  const v = g2.variants.find((x) => x.rsid === "rs9847681");
  assert.ok(v, "rs9847681 is reported"); assert.equal(v.location.label, "spacer position 20 (PAM-adjacent)"); assert.equal(v.class, "common");
  assert.equal(v.study, "ALFA"); assert.ok(v.maf > 0.05 && v.maf < 0.06, String(v.maf)); assert.equal(v.allele, "T");
  assert.match(g2.note, /rs9847681 at spacer position 20 \(PAM-adjacent\), T 5\.2% \(ALFA\)/);
  assert.match(r.summary, /confirm the cell line's genotype/);
});

test("the other guide and the primers are reported as having no common variant, with what that does and does not mean", async () => {
  const r = await screen();
  const g1 = r.guideChecks.find((g) => g.spacer === "GAGTTACTTTAATGCGCCAT");
  assert.equal(g1.status, "none_found"); assert.match(g1.note, /No variant with frequency of 1% or more/);
  assert.equal(r.primerChecks.length, 2); assert.ok(r.primerChecks.every((p) => p.status === "none_found"));
  assert.match(r.scope, /private to the cell line, zygosity and copy number are not assessed/);
  assert.ok(!/clean|shielded|clear of/i.test(JSON.stringify(r)), "no assurance wording");
});

test("indels are placed too: a deletion in the spacer of gRNA2 is listed with its position", async () => {
  const r = await screen(); const g2 = r.guideChecks.find((g) => g.spacer === "TTTCCATTAATTGCCAAGCG");
  const del = g2.variants.find((x) => /^del/.test(x.alleles) || x.type === "del"); assert.ok(del, JSON.stringify(g2.variants.map((x) => [x.rsid, x.type, x.alleles])));
  assert.match(del.location.label, /spacer position \d+/); assert.equal(del.class, "rare");
});

test("provenance: source, retrieval date, queries and the genomic frame are reported", async () => {
  const r = await screen();
  assert.match(r.source, /dbSNP/); assert.equal(r.retrievedAt, "2026-10-26T12:00:00.000Z"); assert.equal(r.genomicFrame.chromosome, "3"); assert.equal(r.genomicFrame.start, 143971198); assert.ok(r.queries >= 4);
});

test("when the query cannot run, the result says not assessed and why; it never says clean", async () => {
  for (const [label, fetchFn, reason] of [["no fetch", null, /no network access/], ["throws", async () => { throw new Error("offline"); }, /query failed \(offline\)/], ["HTTP 500", async () => ({ ok: false, status: 500, json: async () => ({}) }), /HTTP 500/]]) {
    const r = await screen({ fetchFn }); assert.equal(r.status, "not_assessed", label); assert.match(r.summary, reason, label); assert.deepEqual(r.guideChecks, [], label);
  }
});

test("coordinates are verified against dbSNP's reference alleles: a record placed one base off is refused", async () => {
  const shifted = DIPK2A.replace("143971198..143992967", "143971199..143992968");
  const r = await screenTargetVariants({ gene: "DIPK2A", genbankRaw: shifted, designResult: design, fetchFn: looseReplay(), delayMs: 0, now: NOW });
  assert.equal(r.status, "not_assessed"); assert.match(r.reason, /did not agree with the record/);
});

test("records without stated GRCh38 coordinates are not assessed, with the reason", async () => {
  const tp53 = read("public/references/tp53-NG_017013.2.gb");
  const d = runDesign("ko", tp53, "", "", 400, { deliveryMethod: "rnp", expectedGene: "TP53" });
  const r = await screenTargetVariants({ gene: "TP53", genbankRaw: tp53, designResult: d, fetchFn: replay(), delayMs: 0, now: NOW });
  assert.equal(r.status, "not_assessed"); assert.match(r.reason, /RefSeqGene \(NG_\) record carries no chromosome coordinates/);
  assert.match(genomicFrameOfRecord(DIPK2A.replace("(GRCh38)", "(GRCh37)")).reason, /GRCh37/);
  assert.deepEqual(genomicFrameOfRecord("COMMENT Imported from genome: GRCh38 (hg38, Homo sapiens) Gene: APOE\n (ENSG00000130203) Location: chr19 44905754-44909393 Transcript:").orientations, [1, -1]);
  assert.equal(genomicFrameOfRecord("LOCUS x\nCOMMENT Location: chromosome:GRCh38:X:100:900:-1\n").orientations[0], -1);
});

test("a guide or primer that cannot be found in the record is not assessed, and the overall status is partial or flagged", async () => {
  const broken = { ...design, ps: [{ n: "P1", s: "ACGTACGTACGTACGTACGTAGC" }, ...design.ps.slice(1)] };
  const r = await screen({ designResult: broken, fetchFn: looseReplay() });
  assert.equal(r.primerChecks[0].status, "not_assessed"); assert.match(r.primerChecks[0].reason, /not found in the record/);
  assert.ok(["flagged", "partial"].includes(r.status)); assert.ok(screeningSites(broken, "ACGT").every((s) => s.missing));
});

test("frequency: the first large study listed is used, as min(f, 1 - f); HGVS entries of the newest NC_ version are used", () => {
  assert.deepEqual(frequencyOf({ global_mafs: [{ study: "SGDP_PRJ", freq: "C=0.41/58" }, { study: "TOPMED", freq: "T=0.054/14366" }, { study: "ALFA", freq: "T=0.052/12859" }] }), { study: "ALFA", allele: "T", maf: 0.052, n: 12859 });
  assert.equal(frequencyOf({ global_mafs: [{ study: "ALFA", freq: "G=0.7/100" }] }).maf, 0.30000000000000004);
  assert.equal(frequencyOf({ global_mafs: [] }), null);
  const entries = parseHgvs({ docsum: "HGVS=NC_000003.12:g.100C>T,NC_000003.11:g.50C>T,NC_000003.12:g.200_201insA" });
  assert.deepEqual(entries.map((e) => [e.start, e.end, e.kind]), [[100, 100, "snv"], [200, 201, "ins"]]);
});
