import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { runDesign } from "../src/engine/design/designEngine.js";
import { buildDesignSchemeSvg } from "../src/engine/design/designScheme.js";
import { buildQcDesignSpec } from "../src/engine/design/qcExport.js";

const DEMO_GB = `LOCUS       DEMO_GENE               1000 bp    DNA     linear   SYN 14-OCT-2026
DEFINITION  Demo Gene for integration testing.
ACCESSION   DEMO_001
VERSION     DEMO_001.1
FEATURES             Location/Qualifiers
     source          1..1000
                     /organism="Homo sapiens"
                     /gene="DEMO1"
     exon            100..400
                     /gene="DEMO1"
                     /number="1"
     exon            500..800
                     /gene="DEMO1"
                     /number="2"
     CDS             join(150..400,500..750)
                     /gene="DEMO1"
                     /translation="MVKTLVTGAAGQIGYSLLFRIASTGKLV"
ORIGIN
        1 ccctcagccc caggactagg ttaaggcccc ttggcacaga tgggaaggct ttttaaggca
       61 gtggcaggag gggtctggaa gagggcggtg agaatgggcc atgaaggtca cgctggtcac
      121 cggtgccgct ggccagatcg gctactcgct gctgttccgc atcgccagca ccggcaagct
      181 ggtccagggc ctgcacctgc tgctgctgga catggagcag cccggcgtgg ctgccagcac
      241 cgacctggtg cagttcctgg cccaggccgg cctggccaac gtgctggtgt gcaccctgtc
      301 cgagctgcag gccaagcagc aggcccagct ggccgccgag ctgggcgtgt ccatcctgcg
      361 cgccagctcc gacaagctga gccagagccg ggtgggtgag gccggccctg gggaggggct
      421 gggtggctcc cggggcttgg ggcccgtgtg tggtcccagg ccgtgcaggt gtgtgttctc
      481 cccgtcccca ggtgaccctg cacaacgtgc tgctgccctc cgccgccatc ctcgacaagg
      541 cccacgagga gctggccaag ctgaacccca agaccgtggt ggtggtgacc aaccccatca
      601 acgccaccac catcatgacc aaggccctgg agcaggtgaa gggcgtccag aacttcgacc
      661 acatcctggc cgtgctgggc gtgcccttcc gctccttcaa gcgcaccatc accctggact
      721 tccacgccat gaaggtgctc aagcactgag cccagcccgg cctccttgtt atgctaccta
      781 cagcccaggg tagctcagga ccataggtct ccataccctg gacccttccc caccacccca
      841 ccacccccac ccccactgtg cctctttctc ctctccctgt ctcctccctc cctgcctgcc
      901 tcttccttcc tctctccacc ccagcttcct cttccttcct gctgcccctc ctgtcccttc
      961 cttcctccct ctctcccacc ccagcttcct cttccttcct
//
`;

test("Assured Studio: In-silico dual-guide knockout design", () => {
  const result = runDesign("ko", DEMO_GB, "", "", 400, {
    deliveryMethod: "rnp",
    expectedGene: "DEMO1"
  });

  assert.ok(result, "Design result must be returned");
  assert.ok((result.gs?.length || 0) >= 1, "At least one guide should be selected");
  assert.strictEqual(result.type, "ko");

  // Verify SVG generation
  const svg = buildDesignSchemeSvg(result);
  assert.ok(svg.startsWith("<svg"), "Must generate valid SVG schematic");
  assert.ok(svg.includes("</svg>"), "SVG must close correctly");

  // Verify QC handoff spec
  const qcSpec = buildQcDesignSpec(result);
  assert.strictEqual(qcSpec.schema, "assured-qc-design/1", "Schema version must match");
  assert.ok(qcSpec.guides?.length >= 1, "QC spec must carry guides");
});

import { fileURLToPath } from "node:url";

test("Assured Studio: In-silico point mutation design with CFD blocking", () => {
  const apoeGbPath = fileURLToPath(new URL("./fixtures/apoe-r154s.gb", import.meta.url));
  const apoeGb = fs.readFileSync(apoeGbPath, "utf8");

  const result = runDesign("pm", apoeGb, "R154S", "", 400, {
    deliveryMethod: "rnp",
    maxBlockingChanges: 3,
    expectedGene: "APOE"
  });

  assert.ok(result, "Point mutation design result must be returned");
  assert.ok((result.gs?.length || 0) >= 1, "Guides must be found near edit");
  assert.ok((result.os?.length || 0) >= 1, "Donor repair template must be generated");

  // Verify QC handoff spec
  const qcSpec = buildQcDesignSpec(result);
  assert.strictEqual(qcSpec.schema, "assured-qc-design/1");
  assert.ok(qcSpec.markers?.length >= 1, "Must carry target and synonymous markers");
});

import {
  generateIdtOrderRows,
  generateSynthegoOrderRows,
  formatBulkPasteTsv,
  formatOligosFasta
} from "../src/services/vendorExport.js";

test("Assured Bench: Vendor ordering exports complete guides, donors, primers, TSV, and FASTA", () => {
  const apoeGbPath = fileURLToPath(new URL("./fixtures/apoe-r154s.gb", import.meta.url));
  const apoeGb = fs.readFileSync(apoeGbPath, "utf8");

  const result = runDesign("pm", apoeGb, "R154S", "", 400, {
    deliveryMethod: "rnp",
    maxBlockingChanges: 3,
    expectedGene: "APOE"
  });

  const payload = { input: { gene: "APOE" }, result };
  const idtRows = generateIdtOrderRows(payload);
  const synthegoRows = generateSynthegoOrderRows(payload);

  assert.ok(idtRows.some(r => r.itemType === "crRNA"), "IDT rows must include crRNA");
  assert.ok(idtRows.some(r => r.itemType === "Donor (ssODN)"), "IDT rows must include ssODN donor");
  assert.ok(idtRows.some(r => r.itemType.includes("Primer")), "IDT rows must include flanking PCR primers");

  assert.ok(synthegoRows.some(r => r.itemType === "sgRNA"), "Synthego rows must include modified sgRNA");
  assert.ok(synthegoRows.some(r => r.itemType === "Donor (ssODN)"), "Synthego rows must include ssODN donor");
  assert.ok(synthegoRows.some(r => r.itemType.includes("Primer")), "Synthego rows must include flanking PCR primers");

  const tsv = formatBulkPasteTsv(idtRows);
  assert.ok(tsv.includes("\t"), "Bulk TSV must be tab-delimited");
  assert.strictEqual(tsv.split("\n").length, idtRows.length, "Bulk TSV must have one line per reagent");

  const fasta = formatOligosFasta(idtRows);
  assert.ok(fasta.startsWith(">"), "FASTA export must start with header");
});

import { designGenomicSnp, buildGenomicSnpReport } from "../src/engine/design/genomicSnp.js";
import { parseGeneQuery, SPECIES } from "../src/engine/design/geneFetch.js";
import { INTERNAL_TAGS, CASSETTES } from "../src/engine/design/designEngine.js";

test("Assured Bench: Full parity with Assured_CRISPR_Design (Genomic SNP, Internal Tag SPOT/alphaBtx, Construct Builder Cassettes, and geneFetch)", () => {
  // 1. Verify geneFetch query parser & species support
  assert.deepStrictEqual(Object.keys(SPECIES), ["human", "mouse", "rat", "zebrafish"]);
  assert.strictEqual(parseGeneQuery("ENST00000269305.9").kind, "ensembl-transcript");
  assert.strictEqual(parseGeneQuery("NM_000546.6").kind, "refseq-transcript");
  assert.strictEqual(parseGeneQuery("TP53").kind, "symbol");

  // 2. Verify Internal Tag (it) with SPOT and alphaBtx on APOE fixture
  const apoeGbPath = fileURLToPath(new URL("./fixtures/apoe-r154s.gb", import.meta.url));
  const apoeGb = fs.readFileSync(apoeGbPath, "utf8");
  assert.ok(INTERNAL_TAGS.SPOT, "SPOT internal tag must be available");
  assert.ok(INTERNAL_TAGS.alphaBtx, "alphaBtx internal tag must be available");
  const itResult = runDesign("it", apoeGb, "R154", "SPOT", 400, {
    deliveryMethod: "rnp",
    expectedGene: "APOE"
  });
  assert.strictEqual(itResult.err, undefined);
  assert.strictEqual(itResult.type, "it");
  assert.strictEqual(itResult.tag, "SPOT");
  assert.ok(itResult.os?.length >= 1, "Internal tag design must produce ssODN donor(s)");

  // 3. Verify C-terminal Construct Builder cassette (e.g. dTAG-V5 and T2A-EGFP)
  assert.ok(CASSETTES["dTAG-V5"], "dTAG-V5 cassette must exist");
  assert.ok(CASSETTES["T2A-EGFP"], "T2A-EGFP cassette must exist");
  assert.ok(CASSETTES["FLAG"], "FLAG cassette must exist");
  const ctResult = runDesign("ct", apoeGb, "", "dTAG-V5", 250, {
    deliveryMethod: "rnp",
    donorFormat: "block",
    expectedGene: "APOE"
  });
  assert.strictEqual(ctResult.err, undefined);
  assert.strictEqual(ctResult.type, "ct");
  assert.ok(ctResult.donor?.length > 200, "dTAG-V5 C-terminal donor must be generated");

  // 4. Verify Genomic SNP (genomic-snv) design, report HTML, and QC handoff
  const snpResult = designGenomicSnp(apoeGb, {
    gene: "APOE",
    assembly: "GRCh38",
    chromosome: "19",
    referenceStart: 44905791,
    position: 44907290, // 0-based index 1499 in apoeGb ('T')
    ref: "T",
    alt: "C",
    forwardConfirmed: true,
    blockingPolicy: "pair",
    deliveryMethod: "rnp"
  });
  assert.strictEqual(snpResult.err, undefined);
  assert.strictEqual(snpResult.type, "genomic-snv");
  assert.ok(snpResult.candidates?.length >= 1, "Genomic SNP must produce candidate guide/donor pairs");
  const reportHtml = buildGenomicSnpReport(snpResult);
  assert.ok(reportHtml.includes("Genomic SNP"), "Genomic SNP report HTML must render");
  const qcSpec = buildQcDesignSpec({
    ...snpResult,
    gene: "APOE",
    gp: 1499,
    gs: snpResult.candidates.map(c => ({ ...c, n: c.name, pm: c.pam })),
    os: snpResult.candidates.map(c => ({ ...c.donor, n: c.name, desiredDiffIndexes: [1499 - c.donor.donorStart] })),
    ps: snpResult.primers.length ? [snpResult.primers[0].forward, snpResult.primers[0].reverse] : []
  });
  assert.strictEqual(qcSpec.schema, "assured-qc-design/1");
  assert.strictEqual(qcSpec.design.editKind, "snp");
});

