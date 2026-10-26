import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as agent from "../src/services/biomniAgent.js";
import { BRUNELLO_SUBSET, BRUNELLO_SOURCE } from "../src/services/data/brunelloSubset.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIPK2A = fs.readFileSync(path.join(HERE, "..", "public", "references", "dipk2a-region.gb"), "utf8");
// responses recorded for the pair the selector recommends with the Lindel model (ATTATGTTGGAGAAGAACTG + TTTCCATTAATTGCCAAGCG)
const dbsnp = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "dbsnp-dipk2a-recommended-pair.json"), "utf8")).responses;
// UniProt as it answers for DIPK2A: a signal peptide and the chain, no domain, region or site features
const uniprotDipk2a = { results: [{ primaryAccession: "Q8NDZ4", proteinDescription: { recommendedName: { fullName: { value: "Divergent protein kinase domain 2A" } } }, sequence: { length: 430 }, comments: [], features: [{ type: "Signal", location: { start: { value: 1 }, end: { value: 35 } } }, { type: "Chain", location: { start: { value: 36 }, end: { value: 430 } } }] }] };

test("the typed-in tables are gone: no curated SNP, Brunello or gene-profile exports, no 'shielding' check", () => {
  for (const name of ["CURATED_COMMON_SNPS", "CURATED_BRUNELLO_LIBRARY", "CURATED_GENE_PROFILES", "verifyCommonVariantShielding"]) assert.equal(agent[name], undefined, name);
});

test("Brunello subset: generated from the library file, with the library's own values (checked against the file during the audit)", () => {
  assert.equal(BRUNELLO_SOURCE.sourceFileSha256, "77001ee17860df41fb5f6df87081379cf5f92e51d88614b9fbe8ccca3367905c"); assert.equal(BRUNELLO_SOURCE.rows, 77441);
  assert.deepEqual(Object.keys(BRUNELLO_SUBSET).sort(), ["APOE", "DIPK2A", "INS", "NR2F2", "SCN5A", "TP53"]);
  for (const [gene, entry] of Object.entries(BRUNELLO_SUBSET)) {
    assert.equal(entry.guides.length, 4, gene);
    assert.deepEqual(entry.guides.map((g) => g.libraryRank), [1, 2, 3, 4]);
    assert.ok(entry.guides.every((g, i, a) => i === 0 || a[i - 1].ruleSet2 >= g.ruleSet2), `${gene} ordered by Rule Set 2`);
  }
  const dipk = BRUNELLO_SUBSET.DIPK2A; assert.equal(dipk.libraryGene, "C3orf58");
  assert.deepEqual([dipk.guides[0].spacer, dipk.guides[0].pam, dipk.guides[0].strand, dipk.guides[0].libraryExon, dipk.guides[0].ruleSet2], ["TTTCCATTAATTGCCAAGCG", "AGG", "-", 2, 0.6416]);
  // APOE keeps the library's exon numbers (4, 3, 4, 4 in score order), not coding-exon indices
  assert.deepEqual(BRUNELLO_SUBSET.APOE.guides.map((g) => g.libraryExon), [4, 3, 4, 4]);
  // SCN5A: the four guides the library lists; the four typed in before were not in it
  assert.equal(BRUNELLO_SUBSET.SCN5A.guides[0].spacer, "AATGCTCAAGAAAGAACACG"); assert.equal(BRUNELLO_SUBSET.SCN5A.guides[0].ruleSet2, 0.7517);
  const typedBefore = ["TGAGTACGCCGACAGCCGCG", "TCTTGCCTATACCCAGGGCC", "CCAGAGTCATGGGGCCAGCC", "CGTCATCAAGCACGCCAAGG"];
  assert.ok(!BRUNELLO_SUBSET.SCN5A.guides.some((g) => typedBefore.includes(g.spacer)));
});

test("UniProt: only what UniProt returns; DIPK2A has no annotated domain, so nothing is called a disrupted domain; no offline fallback; no constraint", async () => {
  const ok = await agent.queryUniprotProtein("DIPK2A", async () => ({ ok: true, json: async () => uniprotDipk2a }));
  assert.equal(ok.ok, true); assert.equal(ok.accession, "Q8NDZ4"); assert.deepEqual(ok.domains, []);
  assert.deepEqual([ok.pLI, ok.loeuf, ok.depmapChronos, ok.constraintSummary], [null, null, null, null]); assert.equal(ok.essentialityTier, "unknown");
  assert.equal((await agent.queryUniprotProtein("DIPK2A", null)).ok, false);
  const down = await agent.queryUniprotProtein("DIPK2A", async () => ({ ok: false, status: 503 })); assert.equal(down.ok, false); assert.match(down.error, /503/); assert.deepEqual(down.domains ?? [], []);
});

test("end to end on DIPK2A: no guide is reported as disrupting a kinase domain, the Brunello table is the library's, and the variant screen flags gRNA2's PAM-adjacent SNP", async () => {
  const route = async (url) => {
    const u = String(url);
    if (u.includes("eutils.ncbi.nlm.nih.gov/entrez/eutils/es")) return u in dbsnp ? { ok: true, status: 200, json: async () => dbsnp[u] } : { ok: false, status: 404 };
    if (u.includes("rest.uniprot.org")) return { ok: true, status: 200, json: async () => uniprotDipk2a };
    return { ok: false, status: 404 };
  };
  const res = await agent.runBiomniCoScientist("Design a biallelic knockout for DIPK2A and rank exon guides with Lindel", { id: "p", gene: "DIPK2A", genbankRaw: DIPK2A, options: { enzyme: "spcas9" } }, { fetchFn: route });
  assert.ok(res.lindelRanking.topGuides.length > 0);
  assert.ok(res.lindelRanking.displayGuides.every((g) => g.disrupted_domain === null), "no domain annotated, none disrupted");
  const first = res.lindelRanking.brunelloComparison[0]; assert.equal(first.spacer, "TTTCCATTAATTGCCAAGCG"); assert.equal(first.ruleSet2, 0.6416); assert.equal(first.exon, 2);
  assert.equal(res.variantScreen.status, "flagged"); assert.match(res.variantScreen.summary, /rs9847681/);
  assert.equal(res.uniprot.pLI, null);
});
