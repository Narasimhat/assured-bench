import test from "node:test";
import assert from "node:assert/strict";
import { GeneFetchError, searchClinVar } from "../src/engine/design/geneFetch.js";

const noWait = async () => {};

/** Minimal NCBI E-utilities replay: match by db + path, not full query string order. */
function eutilsReplay(handlers) {
  return async (url) => {
    const u = new URL(url);
    const key = `${u.pathname}?db=${u.searchParams.get("db")}`;
    const body = handlers[key];
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => (typeof body === "function" ? body(u) : body) };
  };
}

/** Recorded shape of NCBI dbSNP esummary for rs6415084 (LPA intron T>C on GRCh38). */
const RS6415084 = {
  uid: "59475151",
  snp_id: 6415084,
  snp_class: "snv",
  chr: "6",
  chrpos: "6:160559298",
  spdi: "NC_000006.12:160559297:T:C",
  fxn_class: "intron_variant",
  clinical_significance: "",
  genes: [{ name: "LPA", gene_id: "4018" }],
  global_mafs: [
    { study: "1000Genomes", freq: "T=0.31849/1595" },
    { study: "GnomAD_genomes", freq: "T=0.423831/63189" },
    { study: "ALFA", freq: "T=0.47008/80881" },
  ],
};

test("rs6415084 has no ClinVar entry and falls back to a designable dbSNP LPA SNV", async () => {
  const fetchImpl = eutilsReplay({
    "/entrez/eutils/esearch.fcgi?db=clinvar": { esearchresult: { count: "0", idlist: [] } },
    "/entrez/eutils/esearch.fcgi?db=snp": { esearchresult: { count: "1", idlist: ["59475151"] } },
    "/entrez/eutils/esummary.fcgi?db=snp": { result: { uids: ["59475151"], "59475151": RS6415084 } },
  });
  const found = await searchClinVar("rs6415084", { fetchImpl, sleep: noWait });
  assert.equal(found.total, 1);
  const v = found.variants[0];
  assert.equal(v.source, "dbsnp");
  assert.equal(v.accession, "rs6415084");
  assert.equal(v.gene, "LPA");
  assert.equal(v.supported, true);
  assert.equal(v.significance, "No ClinVar clinical assertion");
  assert.match(v.conditions[0], /GnomAD_genomes/);
  assert.deepEqual(v.variant, { assembly: "GRCh38", chromosome: "6", position: 160559298, ref: "T", alt: "C" });
});

test("ClinVar hits still win over dbSNP when both exist", async () => {
  const clinvarRecord = {
    uid: "12345",
    accession: "VCV000012345",
    accession_version: "VCV000012345.1",
    title: "NM_000546.6(TP53):c.524G>A (p.Arg175His)",
    obj_type: "single nucleotide variant",
    genes: [{ symbol: "TP53", geneid: "7157", strand: "-" }],
    germline_classification: { description: "Pathogenic", review_status: "reviewed by expert panel", trait_set: [{ trait_name: "Li-Fraumeni syndrome" }] },
    protein_change: "R175H",
    variation_set: [{
      variant_type: "single nucleotide variant",
      cdna_change: "NM_000546.6:c.524G>A",
      canonical_spdi: "NC_000017.11:7675087:C:T",
      variation_loc: [{ status: "current", assembly_name: "GRCh38", chr: "17", start: "7675088", stop: "7675088" }],
    }],
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.includes("esearch") && u.searchParams.get("db") === "clinvar") {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ esearchresult: { count: "1", idlist: ["12345"] } }) };
    }
    if (u.pathname.includes("esummary") && u.searchParams.get("db") === "clinvar") {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ result: { uids: ["12345"], "12345": clinvarRecord } }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  const found = await searchClinVar("rs28934576", { fetchImpl, sleep: noWait });
  assert.equal(found.variants[0].gene, "TP53");
  assert.equal(found.variants[0].source, undefined);
  assert.ok(!calls.some((u) => /db=snp/.test(u)), "dbSNP must not be queried when ClinVar returns a hit");
});

test("an unknown rsID fails after both ClinVar and dbSNP miss", async () => {
  const fetchImpl = eutilsReplay({
    "/entrez/eutils/esearch.fcgi?db=clinvar": { esearchresult: { count: "0", idlist: [] } },
    "/entrez/eutils/esearch.fcgi?db=snp": { esearchresult: { count: "0", idlist: [] } },
  });
  await assert.rejects(
    () => searchClinVar("rs999999999999", { fetchImpl, sleep: noWait }),
    (err) => err instanceof GeneFetchError && /Neither ClinVar nor dbSNP/.test(err.message),
  );
});

test("dbSNP array SPDI values are accepted", async () => {
  const fetchImpl = eutilsReplay({
    "/entrez/eutils/esearch.fcgi?db=clinvar": { esearchresult: { count: "0", idlist: [] } },
    "/entrez/eutils/esearch.fcgi?db=snp": { esearchresult: { count: "1", idlist: ["59475151"] } },
    "/entrez/eutils/esummary.fcgi?db=snp": {
      result: { uids: ["59475151"], "59475151": { ...RS6415084, spdi: ["NC_000006.12:160559297:T:C"] } },
    },
  });
  const found = await searchClinVar("rs6415084", { fetchImpl, sleep: noWait });
  assert.equal(found.variants[0].variant.ref, "T");
  assert.equal(found.variants[0].variant.alt, "C");
});
