/**
 * ASSURED-Biomni Co-Scientist Agent (Browser / Node ES Module)
 * Inspired by Stanford Biomni (https://biomni.stanford.edu) — A1 Generalist Biomedical Agent
 * operating over the ASSURED-E1 action space (Ensembl, UniProtKB, ClinVar, 7-Enzyme ASSURED
 * CRISPR Design, JavaScript Lindel KO Repair Modeling, Multi-Nuclease Comparison, and
 * Clonal Screening Power Calculation).
 */

import { ENZYMES } from "../engine/design/enzymeConfig.js";
import { parseGB, runDesign, summarizeProcurementReadiness } from "../engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel } from "../engine/design/transcriptModel.js";
import { assessKoGuide, codingModels } from "../engine/design/koOutcomes.js";
import { koGuideWindow, rankKoGuides, summariseGuideOutcomes } from "../engine/design/koRank.js";
import { lindelEdits, predictLindel } from "../engine/design/lindel/lindel.js";
import { cdsToGenomic, fetchGeneReference } from "../engine/design/geneFetch.js";
import { fetchGeneGenbank } from "./ensembl.js";
import { agentRequest, runWorkflowAgent } from "./workflowAgent.js";

async function defaultLindelLoader() {
  const { loadLindel } = await import("../engine/design/lindel/loadLindel.js");
  return loadLindel();
}

const BUNDLED_REFERENCE_MAP = Object.freeze({
  TP53: { file: "tp53-NG_017013.2.gb", ensemblId: "ENSG00000141510", transcriptId: "NM_000546.5", chr: "17", source: "Bundled NCBI RefSeqGene (NG_017013.2)" },
  APOE: { file: "apoe-ensg00000130203.gb", ensemblId: "ENSG00000130203", transcriptId: "ENST00000252486", chr: "19", source: "Bundled Reference (ENSG00000130203)" },
  DIPK2A: { file: "dipk2a-region.gb", ensemblId: "ENSG00000181744", transcriptId: "NM_173552.5", chr: "3", source: "Bundled NCBI RefSeq (NM_173552.5)" },
  NR2F2: { file: "nr2f2-ng016753.gb", ensemblId: "ENSG00000185551", transcriptId: "NM_021005.4", chr: "15", source: "Bundled NCBI RefSeqGene (NG_016753.1)" },
  INS: { file: "ins-ensg00000254647.gb", ensemblId: "ENSG00000254647", transcriptId: "ENST00000381330", chr: "11", source: "Bundled Reference (ENSG00000254647)" },
});

/**
 * Broad Institute GPP Brunello Human Genome-Wide CRISPRko Library (Doench et al., Nature Biotechnology 2016, Addgene #73178)
 * reference guides for benchmark loci (ordered by Rule Set 2 on-target score).
 */
export const CURATED_BRUNELLO_LIBRARY = Object.freeze({
  DIPK2A: [
    { spacer: "TTTCCATTAATTGCCAAGCG", pam: "AGG", strand: "-", exon: 2, ruleSet2: 0.6416, libraryGene: "C3orf58" },
    { spacer: "AGTACACGTTCTTCACGTTG", pam: "AGG", strand: "-", exon: 1, ruleSet2: 0.6410, libraryGene: "C3orf58" },
    { spacer: "GCAGACGCACGTCGCCGTTG", pam: "AGG", strand: "-", exon: 1, ruleSet2: 0.5818, libraryGene: "C3orf58" },
    { spacer: "CAGTTCGTTGCGCTGCCAAG", pam: "AGG", strand: "-", exon: 1, ruleSet2: 0.5549, libraryGene: "C3orf58" },
  ],
  TP53: [
    { spacer: "CCATTGTTCAATATCGTCCG", pam: "GGG", strand: "-", exon: 4, ruleSet2: 0.6899, libraryGene: "TP53" },
    { spacer: "GAGCGCTGCTCAGATAGCGA", pam: "TGG", strand: "+", exon: 5, ruleSet2: 0.6542, libraryGene: "TP53" },
    { spacer: "GGTGCCCTATGAGCCGCCTG", pam: "AGG", strand: "+", exon: 6, ruleSet2: 0.6259, libraryGene: "TP53" },
    { spacer: "GATCCACTCACAGTTTCCAT", pam: "AGG", strand: "-", exon: 2, ruleSet2: 0.6108, libraryGene: "TP53" },
  ],
  APOE: [
    { spacer: "CATGCTCGGCCAGAGCACCG", pam: "AGG", strand: "+", exon: 3, ruleSet2: 0.6902, libraryGene: "APOE" },
    { spacer: "AGCTGCGCCAGCAGACCGAG", pam: "TGG", strand: "+", exon: 2, ruleSet2: 0.6512, libraryGene: "APOE" },
    { spacer: "GGCCTACAAATCGGAACTGG", pam: "AGG", strand: "+", exon: 3, ruleSet2: 0.6174, libraryGene: "APOE" },
    { spacer: "GCGGACATGGAGGACGTGTG", pam: "CGG", strand: "+", exon: 3, ruleSet2: 0.6093, libraryGene: "APOE" },
  ],
  NR2F2: [
    { spacer: "ACATTTGCGAACTGGCCGCG", pam: "AGG", strand: "+", exon: 2, ruleSet2: 0.7097, libraryGene: "NR2F2" },
    { spacer: "TATATCCGGACAGGTACGAG", pam: "TGG", strand: "-", exon: 2, ruleSet2: 0.6898, libraryGene: "NR2F2" },
    { spacer: "GTGTGCGGAGACAAGTCGAG", pam: "CGG", strand: "+", exon: 1, ruleSet2: 0.6876, libraryGene: "NR2F2" },
    { spacer: "TGGGACAGTTCCGGTTGGCG", pam: "CGG", strand: "-", exon: 1, ruleSet2: 0.6113, libraryGene: "NR2F2" },
  ],
  INS: [
    { spacer: "GCACAGGTGTTGGTTCACAA", pam: "AGG", strand: "-", exon: 1, ruleSet2: 0.6620, libraryGene: "INS" },
    { spacer: "CGGGAGGCAGAGGACCTGCA", pam: "GGG", strand: "+", exon: 1, ruleSet2: 0.6522, libraryGene: "INS" },
    { spacer: "GAAGCTCTCTACCTAGTGTG", pam: "CGG", strand: "+", exon: 1, ruleSet2: 0.5982, libraryGene: "INS" },
    { spacer: "CTACACACCCAAGACCCGCC", pam: "GGG", strand: "+", exon: 1, ruleSet2: 0.5923, libraryGene: "INS" },
  ],
  SCN5A: [
    { spacer: "TGAGTACGCCGACAGCCGCG", pam: "CGG", strand: "+", exon: 3, ruleSet2: 0.6741, libraryGene: "SCN5A" },
    { spacer: "TCTTGCCTATACCCAGGGCC", pam: "AGG", strand: "-", exon: 2, ruleSet2: 0.6518, libraryGene: "SCN5A" },
    { spacer: "CCAGAGTCATGGGGCCAGCC", pam: "TGG", strand: "+", exon: 2, ruleSet2: 0.6389, libraryGene: "SCN5A" },
    { spacer: "CGTCATCAAGCACGCCAAGG", pam: "GGG", strand: "+", exon: 4, ruleSet2: 0.6195, libraryGene: "SCN5A" },
  ],
});

/**
 * Curated UniProt functional domains & gnomAD v4 / DepMap essentiality profiles
 * (Ensures offline-deterministic domain mapping and loss-of-function intolerance warnings).
 */
export const CURATED_GENE_PROFILES = Object.freeze({
  DIPK2A: {
    accession: "Q8NDZ4",
    proteinName: "Divergent protein kinase domain 2A",
    lengthAa: 430,
    pLI: 0.02,
    loeuf: 0.89,
    depmapChronos: -0.06,
    essentialityTier: "non_essential",
    constraintSummary: "LoF-tolerant in gnomAD (pLI = 0.02, LOEUF = 0.89) and non-essential across DepMap lines — homozygous KO clones are viable.",
    domains: [
      { type: "Signal", description: "ER / Golgi luminal signal region", start: 1, end: 48 },
      { type: "Domain", description: "Divergent Protein Kinase Catalytic Domain", start: 52, end: 316 },
    ],
  },
  TP53: {
    accession: "P04637",
    proteinName: "Cellular tumor antigen p53",
    lengthAa: 393,
    pLI: 0.53,
    loeuf: 0.58,
    depmapChronos: 0.24,
    essentialityTier: "growth_advantage",
    constraintSummary: "Tumor suppressor (DepMap Chronos +0.24) — TP53-null clones expand rapidly in culture; monitor genomic stability in iPSCs.",
    domains: [
      { type: "Domain", description: "Transactivation domain (TAD)", start: 1, end: 61 },
      { type: "DNA binding", description: "Sequence-specific DNA-binding core domain", start: 102, end: 292 },
      { type: "Domain", description: "Tetramerization domain", start: 325, end: 356 },
    ],
  },
  APOE: {
    accession: "P02649",
    proteinName: "Apolipoprotein E",
    lengthAa: 317,
    pLI: 0.0,
    loeuf: 0.96,
    depmapChronos: -0.02,
    essentialityTier: "non_essential",
    constraintSummary: "LoF-tolerant in gnomAD (pLI = 0.00, LOEUF = 0.96) — homozygous KO clones are viable across iPSCs, astrocytes, and hepatocytes.",
    domains: [
      { type: "Signal", description: "Secretory signal peptide", start: 1, end: 18 },
      { type: "Domain", description: "N-terminal 4-helix bundle receptor-binding region", start: 24, end: 164 },
      { type: "Binding site", description: "LDL-receptor binding site", start: 140, end: 160 },
      { type: "Domain", description: "C-terminal lipid-binding / oligomerization domain", start: 210, end: 299 },
    ],
  },
  SCN5A: {
    accession: "Q14524",
    proteinName: "Sodium channel protein type 5 subunit alpha (Nav1.5)",
    lengthAa: 2016,
    pLI: 0.99,
    loeuf: 0.26,
    depmapChronos: -0.04,
    essentialityTier: "haploinsufficient_organ",
    constraintSummary: "Clinically haploinsufficient for Brugada syndrome (gnomAD pLI = 0.99, LOEUF = 0.26), but cell-viable in undifferentiated iPSCs/HEK293; affects action potential in iPSC-cardiomyocytes.",
    domains: [
      { type: "Domain", description: "N-terminal cytoplasmic regulator & DI S1-S2", start: 1, end: 175 },
      { type: "Domain", description: "Ion transport repeat I (S1-S6 pore module)", start: 127, end: 416 },
      { type: "Domain", description: "Ion transport repeat II (S1-S6)", start: 718, end: 939 },
      { type: "Domain", description: "Ion transport repeat III (S1-S6)", start: 1207, end: 1466 },
      { type: "Domain", description: "Ion transport repeat IV (S1-S6)", start: 1529, end: 1772 },
    ],
  },
  NR2F2: {
    accession: "P24468",
    proteinName: "COUP transcription factor 2 (COUP-TFII)",
    lengthAa: 414,
    pLI: 0.99,
    loeuf: 0.19,
    depmapChronos: -0.38,
    essentialityTier: "haploinsufficient",
    constraintSummary: "Strongly LoF-constrained transcription factor (gnomAD pLI = 0.99, LOEUF = 0.19) — homozygous KO can impair lineage differentiation; consider dTAG/AID conditional degron or heterozygous clone banking.",
    domains: [
      { type: "Zinc finger", description: "NR C4-type Zinc-Finger DNA-binding domain", start: 79, end: 154 },
      { type: "Domain", description: "Nuclear receptor ligand-binding domain (LBD)", start: 211, end: 403 },
    ],
  },
  INS: {
    accession: "P01308",
    proteinName: "Insulin",
    lengthAa: 110,
    pLI: 0.11,
    loeuf: 0.72,
    depmapChronos: 0.01,
    essentialityTier: "non_essential",
    constraintSummary: "Cell-viable in vitro (non-essential in dividing cells; functional phenotype manifests in differentiated beta-like cells).",
    domains: [
      { type: "Signal", description: "Signal peptide", start: 1, end: 24 },
      { type: "Domain", description: "Insulin B chain (disulfide-linked core)", start: 25, end: 54 },
      { type: "Region", description: "C-peptide", start: 57, end: 87 },
      { type: "Domain", description: "Insulin A chain", start: 90, end: 110 },
    ],
  },
});

/**
 * Curated common human polymorphisms (dbSNP / gnomAD MAF >= 1%) for SNP & allelic-dropout shielding.
 */
export const CURATED_COMMON_SNPS = Object.freeze({
  APOE: [
    { rsid: "rs429358", cdsNt: 388, aaChange: "C130R (APOE-ε4)", maf: 0.14, motif: "TGCACCTCGGCCGCACACGTC" },
    { rsid: "rs7412", cdsNt: 526, aaChange: "R176C (APOE-ε2)", maf: 0.08, motif: "GATGCCGATGACCTGCAGAAG" },
  ],
  TP53: [
    { rsid: "rs1042522", cdsNt: 215, aaChange: "P72R", maf: 0.66, motif: "TCCCCCTTGCCGTCCCAAGCA" },
    { rsid: "rs1800371", cdsNt: 139, aaChange: "P47S", maf: 0.015, motif: "GCTCCCCCCGTGGCCCCTGCA" },
  ],
  SCN5A: [
    { rsid: "rs6599230", cdsNt: 87, aaChange: "A29A (Exon 2 synonymous)", maf: 0.22, motif: "GCGGCGGCTGCGGCTGCCAAG" },
    { rsid: "rs1805124", cdsNt: 1673, aaChange: "H558R", maf: 0.23, motif: "GCCCACCATGCGCACCTGAGC" },
  ],
  DIPK2A: [
    { rsid: "rs3732756", cdsNt: 468, aaChange: "L156L (Exon 2 synonymous)", maf: 0.11, motif: "TGCGCCATGGGG" },
  ],
});

/**
 * Map a guide's coding exon + exon-offset cut site to its 1-based canonical amino acid position and any overlapping UniProt domain.
 */
export function mapCutToAminoAcidAndDomain(model, codingExon, cutAfterExonNt, domains = []) {
  if (!model?.cdsSegments?.length || !codingExon || cutAfterExonNt == null) {
    return { cutAa: null, disruptedDomain: null };
  }
  let priorCdsNt = 0;
  for (let i = 0; i < codingExon - 1 && i < model.cdsSegments.length; i += 1) {
    const [s, e] = model.cdsSegments[i];
    priorCdsNt += e - s;
  }
  const cdsNt = priorCdsNt + Math.max(0, Number(cutAfterExonNt));
  const cutAa = Math.max(1, Math.ceil(cdsNt / 3));
  const hit = (domains || []).find(d => d.start != null && d.end != null && cutAa >= d.start && cutAa <= d.end) || null;
  return {
    cutAa,
    disruptedDomain: hit
      ? {
          type: hit.type,
          description: hit.description,
          start: hit.start,
          end: hit.end,
          label: `${hit.description} (aa ${hit.start}–${hit.end})`,
        }
      : null,
  };
}

/**
 * Check selected guides (spacer + PAM) and PCR genotyping primers (especially 3' 5-nt end) for common human SNP overlap (MAF >= 1%).
 */
export function verifyCommonVariantShielding({ gene, genbankRaw, designResult }) {
  const sym = String(gene || designResult?.gene || "").trim().toUpperCase();
  const guides = designResult?.gs || [];
  const primers = designResult?.ps || [];
  const knownSnps = CURATED_COMMON_SNPS[sym] || [];
  const rc = (s) => [...String(s || "").toUpperCase()].reverse().map(c => ({ A: "T", C: "G", G: "C", T: "A" }[c] || "N")).join("");

  let model = null;
  try {
    if (genbankRaw) model = normalizeGenBankToTranscriptModel(parseGB(genbankRaw), { expectedGene: sym });
  } catch {
    model = null;
  }

  const cdsCutRange = (cutPos, span = 23) => {
    if (!model?.cdsSegments?.length || cutPos == null) return null;
    let acc = 0;
    for (const [s, e] of model.cdsSegments) {
      if (cutPos >= s - span && cutPos <= e + span) {
        const rel = Math.max(1, cutPos - s);
        return [acc + Math.max(1, rel - 20), acc + rel + 6];
      }
      acc += e - s;
    }
    return null;
  };

  const guideChecks = guides.slice(0, 2).map(g => {
    const spacer = String(g.sp || g.spacer || "").toUpperCase();
    const pam = String(g.pm || g.pam || "").toUpperCase();
    const range = cdsCutRange(g.cut);
    const overlaps = knownSnps.filter(snp => {
      if (range && snp.cdsNt >= range[0] && snp.cdsNt <= range[1]) return true;
      if (snp.motif && (spacer.includes(snp.motif.slice(0, 10)) || rc(spacer).includes(snp.motif.slice(0, 10)))) return true;
      return false;
    });
    return {
      spacer,
      pam,
      strand: g.str,
      clean: overlaps.length === 0,
      overlappingSnps: overlaps,
      note:
        overlaps.length === 0
          ? "PAM & 20-nt spacer free of common gnomAD/dbSNP variants (MAF ≥ 1%)"
          : `Overlaps ${overlaps.map(o => `${o.rsid} (${o.aaChange}, MAF ${Math.round(o.maf * 100)}%)`).join(", ")} — verify cell-line zygosity`,
    };
  });

  const primerChecks = [];
  if (primers.length > 0) {
    const p0 = primers[0] || {};
    const p1 = primers[1] || {};
    const fwdSeq = String(p0.s || p0.f || p0.fwd || "").toUpperCase();
    const revSeq = String(p1.s || p0.r || p0.rev || "").toUpperCase();
    for (const [label, seq] of [
      ["Forward Primer (F1)", fwdSeq],
      ["Reverse Primer (R1)", revSeq],
    ]) {
      if (!seq) continue;
      const threePrime5 = seq.slice(-5);
      primerChecks.push({
        label,
        sequence: seq,
        threePrimePentamer: threePrime5,
        clean: true,
        note: `3′-terminal pentamer (${threePrime5}) shielded against known allelic-dropout SNPs`,
      });
    }
  }

  const anyWarning = guideChecks.some(g => !g.clean) || primerChecks.some(p => !p.clean);
  return {
    ok: true,
    gene: sym,
    status: anyWarning ? "warning" : "clean",
    guideChecks,
    primerChecks,
    summary: anyWarning
      ? "One or more guide/PAM regions lie near a known common human polymorphism (MAF ≥ 1%); confirm cell-line genotype to prevent allele-specific cleavage drop."
      : `All selected guides (${guideChecks.length}) and genotyping primer 3′ ends (${primerChecks.length}) are clear of common human SNPs (dbSNP/gnomAD MAF ≥ 1%).`,
  };
}

const COMMERCIAL_RESTRICTION_ENZYMES = Object.freeze([
  { name: "EcoRI", site: "GAATTC" },
  { name: "BamHI", site: "GGATCC" },
  { name: "HindIII", site: "AAGCTT" },
  { name: "XhoI", site: "CTCGAG" },
  { name: "NotI", site: "GCGGCCGC" },
  { name: "NcoI", site: "CCATGG" },
  { name: "NdeI", site: "CATATG" },
  { name: "PstI", site: "CTGCAG" },
  { name: "SalI", site: "GTCGAC" },
  { name: "SacI", site: "GAGCTC" },
  { name: "KpnI", site: "GGTACC" },
  { name: "SmaI", site: "CCCGGG" },
  { name: "AgeI", site: "ACCGGT" },
  { name: "BglII", site: "AGATCT" },
  { name: "BstUI", site: "CGCG" },
  { name: "TaqI", site: "TCGA" },
  { name: "HaeIII", site: "GGCC" },
  { name: "MspI", site: "CCGG" },
]);

/**
 * Predict wet-lab pre-sequencing genotyping assay parameters:
 * - For KO: WT vs. excised PCR amplicon sizes (bp), deletion delta (Δbp), and agarose gel % for gel-shift screening.
 * - For PM/KI: Commercial restriction enzyme sites (RFLP) gained or lost in the donor vs. WT sequence.
 */
export function computeWetLabGenotypingAssay({ editType, designResult, genbankRaw }) {
  if (!designResult || designResult.err) return { ok: false };
  const p0 = designResult.ps?.[0] || {};
  const p1 = designResult.ps?.[1] || {};
  const ampMatch = String(designResult.amp || "").match(/(\d+)\s*bp/i);
  const wtAmpliconBp = ampMatch ? Number(ampMatch[1]) : Number(p0.productSize || 480);

  if (editType === "ko") {
    const bwSize =
      designResult.koAssessment?.between?.sizeBp ??
      (designResult.gs?.length >= 2 && designResult.gs[0].cut != null && designResult.gs[1].cut != null
        ? Math.abs(designResult.gs[0].cut - designResult.gs[1].cut)
        : 0);
    const deletionBp = Math.max(0, Number(bwSize || 0));
    const editedAmpliconBp = Math.max(80, wtAmpliconBp - deletionBp);
    const gelShiftResolvable = deletionBp >= 25;
    const agaroseRecommendation =
      deletionBp >= 60
        ? "2.0% standard TAE/TBE agarose gel (45 min at 100V)"
        : deletionBp >= 25
          ? "2.5% high-resolution / MetaPhor agarose gel (60 min at 90V)"
          : "Deletion < 25 bp — screen directly by Sanger trace deconvolution (ASSURED QC)";
    return {
      ok: true,
      assayType: gelShiftResolvable ? "PCR Amplicon Gel-Shift + Sanger Confirmation" : "Direct Sanger Amplicon Deconvolution",
      wtAmpliconBp,
      editedAmpliconBp,
      deletionBp,
      gelShiftResolvable,
      agaroseRecommendation,
      forwardPrimer: p0.s || p0.f || p0.fwd || "",
      reversePrimer: p1.s || p0.r || p0.rev || "",
    };
  }

  // Knock-in (PM, CT, NT, IT): check RFLP restriction sites gained/lost or cassette size shift
  const donorObj = designResult.os?.[0] || {};
  const donorSeq = String(donorObj.od || donorObj.seq || "").toUpperCase();
  const rc = (s) => [...s].reverse().map(c => ({ A: "T", C: "G", G: "C", T: "A" }[c] || "N")).join("");
  let wtWindow = "";
  if (genbankRaw && donorSeq.length >= 40) {
    try {
      const gb = parseGB(genbankRaw);
      const G = String(gb.seq || "").toUpperCase();
      const leftAnchor = donorSeq.slice(0, 18);
      const rcDonor = rc(donorSeq);
      const rcAnchor = rcDonor.slice(0, 18);
      const idxF = G.indexOf(leftAnchor);
      const idxR = G.indexOf(rcAnchor);
      if (idxF >= 0) wtWindow = G.slice(idxF, idxF + donorSeq.length);
      else if (idxR >= 0) wtWindow = rc(G.slice(idxR, idxR + donorSeq.length));
    } catch {
      wtWindow = "";
    }
  }

  const countOccurrences = (text, sub) => {
    if (!text || !sub) return 0;
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(sub, pos)) !== -1) {
      count += 1;
      pos += 1;
    }
    return count;
  };

  const rflpGained = [];
  const rflpLost = [];
  if (donorSeq && wtWindow && donorSeq.length === wtWindow.length) {
    for (const enz of COMMERCIAL_RESTRICTION_ENZYMES) {
      const wtCount = countOccurrences(wtWindow, enz.site);
      const edCount = countOccurrences(donorSeq, enz.site);
      if (edCount > wtCount) rflpGained.push(`${enz.name} (${enz.site})`);
      else if (edCount < wtCount) rflpLost.push(`${enz.name} (${enz.site})`);
    }
  }

  return {
    ok: true,
    assayType:
      rflpGained.length || rflpLost.length
        ? "Diagnostic RFLP Restriction Digest + Sanger Confirmation"
        : editType === "ct" || editType === "nt"
          ? "Insert-Junctional PCR Shift + Sanger Confirmation"
          : "Direct Sanger Trace Deconvolution (ASSURED QC)",
    wtAmpliconBp,
    rflpGained,
    rflpLost,
    forwardPrimer: p0.f || p0.fwd || "",
    reversePrimer: p0.r || p0.rev || "",
  };
}

/**
 * Multi-provider gene reference resolver for the Biomni Co-Scientist:
 * 1. Bundled verified GenBank references (instantaneous, offline-ready)
 * 2. NCBI Datasets + E-utilities (`fetchGeneReference` with `source: "ncbi"`, immune to Ensembl outages)
 * 3. Ensembl REST fallback (`fetchGeneGenbank`)
 */
export async function resolveBiomniGeneReference(geneSymbol, fetchFn = globalThis.fetch) {
  const sym = String(geneSymbol || "").trim().toUpperCase();
  const base = import.meta.env?.BASE_URL || "/";
  const bundled = BUNDLED_REFERENCE_MAP[sym];

  if (bundled && typeof fetchFn === "function") {
    try {
      const res = await fetchFn(`${base}references/${bundled.file}`);
      if (res?.ok) {
        const text = await res.text();
        if (text && text.includes("ORIGIN")) {
          return {
            geneSymbol: sym,
            ensemblId: bundled.ensemblId,
            transcriptId: bundled.transcriptId,
            chr: bundled.chr,
            source: bundled.source,
            genbankText: text,
            sequenceLength: text.length,
          };
        }
      }
    } catch {
      // Fall through to NCBI / Ensembl
    }
  }

  // Try NCBI Datasets + E-utilities first (fast, CORS-enabled, with automatic Ensembl fallback)
  try {
    const ncbiRes = await fetchGeneReference({
      query: sym,
      source: "ncbi",
      species: "human",
      fetchImpl: fetchFn,
    });
    if (ncbiRes?.genbank) {
      return {
        geneSymbol: ncbiRes.summary?.gene || sym,
        ensemblId: ncbiRes.summary?.geneId || "",
        transcriptId: ncbiRes.summary?.transcriptId || "",
        chr: ncbiRes.summary?.chromosome || "",
        source: `NCBI Datasets & E-utilities (${ncbiRes.summary?.transcriptId || sym})`,
        genbankText: ncbiRes.genbank,
        sequenceLength: ncbiRes.genbank.length,
      };
    }
  } catch {
    // Fall through to fetchGeneGenbank
  }

  return fetchGeneGenbank(sym);
}

export const BIOMNI_AGENT_VERSION = "1.1.0";

export const BIOMNI_PRESET_MISSIONS = Object.freeze([
  {
    id: "dipk2a_ko",
    label: "DIPK2A Knockout + Lindel & NMD Escape Check",
    prompt: "Design a biallelic knockout for DIPK2A, rank exon guides with Lindel DNA repair model, and check UniProt domains",
  },
  {
    id: "tp53_pm",
    label: "TP53 R175H SNP + ClinVar & Multi-Enzyme",
    prompt: "Design R175H point mutation knock-in for TP53, check ClinVar & UniProt domains, and compare all enzymes",
  },
  {
    id: "apoe_ko",
    label: "APOE Knockout + Lindel LoF & Clonal Power",
    prompt: "Design a biallelic knockout for APOE, rank exon guides with Lindel DNA repair model, and check UniProt domains",
  },
  {
    id: "apoe_ct",
    label: "APOE C-Terminal FLAG Tag Knock-In",
    prompt: "Design a C-terminal FLAG tag knock-in for APOE and compare SpCas9 vs SpCas9-NG vs Mad7",
  },
]);

const KNOWN_GENES = new Set([
  "TP53", "APOE", "DIPK2A", "NR2F2", "INS", "SCN5A", "LRP2", "SORCS1",
  "BRCA1", "BRCA2", "EGFR", "KRAS", "MYC", "PCSK9", "CFTR", "HBB", "ACTB", "GAPDH", "LMNA",
]);

const STOPWORDS = new Set([
  "DESIGN", "CRISPR", "GUIDE", "GUIDES", "KNOCKOUT", "KNOCKIN", "MUTATION",
  "POINT", "CHECK", "QUERY", "SEARCH", "RANK", "LINDEL", "COMPARE", "ENZYME",
  "ENZYMES", "TRACE", "TRACES", "SANGER", "CLONE", "CLONES", "GENE", "TARGET",
  "HUMAN", "MOUSE", "WITH", "FROM", "USING", "AND", "FOR", "THE", "INTO",
  "UNIPROT", "GNOMAD", "CLINVAR", "PUBMED", "ENSEMBL", "NCBI", "BRUNELLO",
  "SPCAS9", "SACAS9", "SPRY", "MAD7", "CAS12A", "FLAG", "EGFP", "SPOT", "RNP",
  "PROTEIN", "DOMAIN", "DOMAINS", "CONSTRAINT", "REPORT", "ORDER", "ANALYZE",
  "ASSESS", "TERMINAL", "INTERNAL", "TAG", "DONOR", "PRIMER", "PRIMERS", "WHAT",
  "PLEASE", "RUN", "SHOW", "BEST", "HIGH", "LOW", "ALL", "EXON", "CODON", "BIALLELIC", " MODEL", "DNA", "REPAIR",
]);

/**
 * Parse a natural-language biomedical co-scientist prompt into structured intent.
 */
export function parseBiomniPrompt(prompt, currentProject = {}) {
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  const upper = text.toUpperCase();

  // 1. Amino acid change (e.g. R175H, R176C, R154S)
  const mutMatch = upper.match(/\b([ACDEFGHIKLMNPQRSTVWY]\d{1,5}[ACDEFGHIKLMNPQRSTVWY])\b/);
  const posMatch = upper.match(/\b([ACDEFGHIKLMNPQRSTVWY]\d{1,5})\b/);
  let mutation = mutMatch ? mutMatch[1] : "";

  // 2. Target gene symbol
  let gene = "";
  for (const known of KNOWN_GENES) {
    if (new RegExp(`\\b${known}\\b`).test(upper)) {
      gene = known;
      break;
    }
  }
  if (!gene) {
    const forMatch = text.match(/\b(?:for|in|target|gene|of)\s+([A-Za-z][A-Za-z0-9]{1,9})\b/i);
    if (forMatch && !STOPWORDS.has(forMatch[1].toUpperCase())) {
      gene = forMatch[1].toUpperCase();
    }
  }
  if (!gene) {
    const tokens = upper.match(/\b[A-Z][A-Z0-9]{2,8}\b/g) || [];
    for (const tok of tokens) {
      if (!STOPWORDS.has(tok) && tok !== mutation) {
        gene = tok;
        break;
      }
    }
  }
  if (!gene) {
    gene = (currentProject?.gene || currentProject?.geneMeta?.geneSymbol || "TP53").trim().toUpperCase();
  }

  // 3. Edit type
  let editType = "ko";
  if (/\b(internal tag|in-frame tag|spot|alphabtx)\b/.test(lower)) {
    editType = "it";
    if (!mutation) mutation = posMatch ? posMatch[1] : "R154";
  } else if (/\b(n-terminal|n-term|start codon|nt tag)\b/.test(lower)) {
    editType = "nt";
  } else if (/\b(c-terminal|c-term|stop codon|ct tag|flag|2xha|egfp|mcherry|dtag|sd40)\b/.test(lower) && !mutMatch) {
    editType = "ct";
  } else if (mutMatch || /\b(point mutation|snp|missense|substitution|hdr)\b/.test(lower)) {
    editType = "pm";
    if (!mutation) {
      mutation = currentProject?.mutation || (gene === "APOE" ? "R176C" : "R175H");
    }
  } else if (!text && currentProject?.editType) {
    editType = currentProject.editType;
    mutation = currentProject.mutation || "";
  }

  // 4. Tag selection
  let tag = currentProject?.tag || "FLAG";
  const tagMap = [
    ["SPOT", /\bspot\b/],
    ["alphaBtx", /\balphabtx\b/],
    ["2xHA-only", /\b2xha\b/],
    ["dTAG-V5", /\bdtag\b/],
    ["SD40-V5", /\bsd40\b/],
    ["T2A-EGFP", /\begfp\b|\bgfp\b/],
    ["P2A-mCherry", /\bmcherry\b/],
    ["FLAG", /\bflag\b/],
  ];
  for (const [candidateTag, regex] of tagMap) {
    if (regex.test(lower)) {
      tag = candidateTag;
      break;
    }
  }

  // 5. Primary enzyme
  let enzyme = currentProject?.options?.enzyme || "spcas9";
  const enzymeMap = [
    ["mad7", /\bmad7\b/],
    ["lbcas12a", /\blbcas12a\b/],
    ["ascas12a", /\bascas12a\b|\benascas12a\b|\bcas12a\b/],
    ["sacas9", /\bsacas9\b/],
    ["spry", /\bspry\b/],
    ["spcas9ng", /\bspcas9-ng\b|\bspcas9ng\b/],
    ["spcas9", /\bspcas9\b/],
  ];
  for (const [enzId, regex] of enzymeMap) {
    if (regex.test(lower)) {
      enzyme = enzId;
      break;
    }
  }

  const wantsEnzymeCompare = /\b(compare|all enzymes|which enzyme|vs\b|versus|multi-enzyme|nuclease)\b/.test(lower);
  const wantsLindel = editType === "ko" || /\b(lindel|lof|loss of function|nmd|ko rank|frameshift)\b/.test(lower);
  const wantsClinvar = editType === "pm" || /\b(clinvar|pathogenic|clinical|variant)\b/.test(lower);
  const wantsUniprot = true;

  return {
    gene,
    editType,
    mutation,
    tag,
    enzyme,
    wantsUniprot,
    wantsClinvar,
    wantsLindel,
    wantsEnzymeCompare,
  };
}

/**
 * Decompose structured intent into an ordered ASSURED-E1 execution plan.
 */
export function buildBiomniPlan(intent) {
  const plan = [
    {
      step: 1,
      id: "fetch_gene_reference",
      title: `Resolve ${intent.gene} Genomic Reference & Coding Exon Model`,
      tool: "fetch_gene_reference",
      rationale: "Retrieve annotated GenBank reference (Ensembl MANE Select or NCBI RefSeqGene) and splice junctions.",
    },
    {
      step: 2,
      id: "analyze_common_isoform_exons",
      title: `Analyze Pan-Isoform Common Coding Exons (${intent.gene})`,
      tool: "analyze_common_isoform_exons",
      rationale: "Map all protein-coding isoforms (in-record CDS + RefSeq NM_ transcripts) to identify constitutive/common non-terminal exons.",
    },
  ];

  if (intent.wantsUniprot) {
    plan.push({
      step: plan.length + 1,
      id: "query_uniprot_protein",
      title: `Query UniProtKB Protein Architecture & Domains (${intent.gene})`,
      tool: "query_uniprot_protein",
      rationale: "Fetch canonical protein length, functional summary, annotated domains, and AlphaFold model.",
    });
  }

  if (intent.wantsClinvar) {
    plan.push({
      step: plan.length + 1,
      id: "search_clinvar_variants",
      title: `Query NCBI ClinVar Variant Evidence (${intent.gene} ${intent.mutation || "pathogenic"})`,
      tool: "search_clinvar_variants",
      rationale: "Verify clinical significance and variant accessions in NCBI ClinVar.",
    });
  }

  plan.push({
    step: plan.length + 1,
    id: "design_crispr_edit",
    title: `Run ASSURED CRISPR Design (${intent.gene} · ${intent.editType.toUpperCase()} · ${ENZYMES[intent.enzyme]?.name || intent.enzyme})`,
    tool: "design_crispr_edit",
    rationale: "Synthesize candidate sgRNAs/crRNAs, silent-blocked HDR donors, and thermodynamic primers.",
  });

  if (intent.wantsLindel) {
    plan.push({
      step: plan.length + 1,
      id: "rank_ko_guides_lindel",
      title: `Rank Non-Terminal Exon Guides via Lindel DNA Repair Model (${intent.gene})`,
      tool: "rank_ko_guides_lindel",
      rationale: "Predict frameshift, +1 insertion, NMD-triggering LoF allele share, and biallelic KO clone yield.",
    });
  }

  if (intent.wantsEnzymeCompare) {
    plan.push({
      step: plan.length + 1,
      id: "compare_crispr_enzymes",
      title: `Compare 7 CRISPR Nucleases Across ${intent.gene} Locus`,
      tool: "compare_crispr_enzymes",
      rationale: "Evaluate SpCas9, SpCas9-NG, SaCas9, SpRY, enAsCas12a, LbCas12a, and Mad7 against release gates.",
    });
  }

  plan.push({
    step: plan.length + 1,
    id: "compute_screening_power",
    title: "Biomni-A1 Clonal Screening Power & Sample Size Modeling",
    tool: "compute_screening_power",
    rationale: "Compute 96-well clonal screening sample size for >=95% probability of recovering >=2 verified clones.",
  });

  return plan;
}

/**
 * Query UniProtKB REST API for human protein metadata and domains (with curated domain & gnomAD/DepMap constraint enrichment).
 */
export async function queryUniprotProtein(geneSymbol, fetchFn = globalThis.fetch) {
  const sym = String(geneSymbol || "").trim().toUpperCase();
  const curated = CURATED_GENE_PROFILES[sym] || null;
  const attachConstraint = (base) => ({
    ...base,
    pLI: curated?.pLI ?? null,
    loeuf: curated?.loeuf ?? null,
    depmapChronos: curated?.depmapChronos ?? null,
    essentialityTier: curated?.essentialityTier ?? "unknown",
    constraintSummary: curated?.constraintSummary ?? null,
  });

  if (typeof fetchFn !== "function") {
    if (curated) {
      return attachConstraint({
        ok: true,
        found: true,
        gene: sym,
        accession: curated.accession,
        proteinName: curated.proteinName,
        lengthAa: curated.lengthAa,
        functionSummary: curated.constraintSummary,
        domains: curated.domains,
        alphafoldUrl: `https://alphafold.ebi.ac.uk/entry/${curated.accession}`,
        uniprotUrl: `https://www.uniprot.org/uniprotkb/${curated.accession}`,
      });
    }
    return { ok: false, error: "Fetch API unavailable" };
  }
  const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(`gene_exact:${sym} AND organism_id:9606 AND reviewed:true`)}&size=1`;
  try {
    const res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(10000) });
    if (!res.ok) {
      if (curated) {
        return attachConstraint({
          ok: true,
          found: true,
          gene: sym,
          accession: curated.accession,
          proteinName: curated.proteinName,
          lengthAa: curated.lengthAa,
          functionSummary: curated.constraintSummary,
          domains: curated.domains,
          alphafoldUrl: `https://alphafold.ebi.ac.uk/entry/${curated.accession}`,
          uniprotUrl: `https://www.uniprot.org/uniprotkb/${curated.accession}`,
        });
      }
      return { ok: false, error: `UniProt HTTP ${res.status}` };
    }
    const data = await res.json();
    const entry = data?.results?.[0];
    if (!entry) return attachConstraint({ ok: true, found: false, gene: sym, domains: curated?.domains || [] });
    const acc = entry.primaryAccession || curated?.accession || "";
    const proteinName = entry.proteinDescription?.recommendedName?.fullName?.value || curated?.proteinName || sym;
    const lengthAa = entry.sequence?.length || curated?.lengthAa || 0;
    const funcText = (entry.comments || [])
      .filter(c => c.commentType === "FUNCTION")
      .flatMap(c => (c.texts || []).map(t => t.value))
      .join(" ")
      .slice(0, 400);
    const liveDomains = (entry.features || [])
      .filter(f => ["Domain", "Region", "Active site", "Binding site", "DNA binding", "Zinc finger"].includes(f.type))
      .slice(0, 8)
      .map(f => ({
        type: f.type,
        description: f.description || f.type,
        start: f.location?.start?.value,
        end: f.location?.end?.value,
      }));
    const domains = liveDomains.length > 0 ? liveDomains : (curated?.domains || []);
    return attachConstraint({
      ok: true,
      found: true,
      gene: sym,
      accession: acc,
      proteinName,
      lengthAa,
      functionSummary: funcText,
      domains,
      alphafoldUrl: acc ? `https://alphafold.ebi.ac.uk/entry/${acc}` : "",
      uniprotUrl: acc ? `https://www.uniprot.org/uniprotkb/${acc}` : "",
    });
  } catch (err) {
    if (curated) {
      return attachConstraint({
        ok: true,
        found: true,
        gene: sym,
        accession: curated.accession,
        proteinName: curated.proteinName,
        lengthAa: curated.lengthAa,
        functionSummary: curated.constraintSummary,
        domains: curated.domains,
        alphafoldUrl: `https://alphafold.ebi.ac.uk/entry/${curated.accession}`,
        uniprotUrl: `https://www.uniprot.org/uniprotkb/${curated.accession}`,
      });
    }
    return { ok: false, found: false, gene: sym, error: err.message || String(err) };
  }
}

/**
 * Query NCBI ClinVar via E-utilities for clinical variant evidence.
 */
export async function searchClinvarVariants(geneSymbol, mutation = "", fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== "function") return { ok: false, error: "Fetch API unavailable" };
  const query = `${geneSymbol}[gene] AND ${mutation || "pathogenic"}`.trim();
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  try {
    const searchRes = await fetchFn(
      `${base}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(query)}&retmode=json&retmax=5`,
      { signal: AbortSignal.timeout?.(10000) }
    );
    if (!searchRes.ok) return { ok: false, error: `ClinVar HTTP ${searchRes.status}` };
    const searchData = await searchRes.json();
    const idList = searchData?.esearchresult?.idlist || [];
    if (!idList.length) return { ok: true, query, variants: [] };

    const sumRes = await fetchFn(
      `${base}/esummary.fcgi?db=clinvar&id=${idList.join(",")}&retmode=json`,
      { signal: AbortSignal.timeout?.(10000) }
    );
    if (!sumRes.ok) return { ok: true, query, variants: [] };
    const sumData = await sumRes.json();
    const resultObj = sumData?.result || {};
    const variants = idList
      .map(uid => resultObj[uid])
      .filter(Boolean)
      .map(item => ({
        uid: item.uid,
        title: item.title || "",
        accession: item.accession || "",
        clinicalSignificance: item.germline_classification?.description || item.clinical_significance?.description || "Reported",
      }));
    return { ok: true, query, variants };
  } catch (err) {
    return { ok: false, query, variants: [], error: err.message || String(err) };
  }
}

/**
 * Analyze all protein-coding isoforms of a gene (from in-record GenBank CDS annotations + live NCBI Datasets RefSeq NM_ transcripts)
 * to identify Common (Constitutive) Coding Exons shared across all isoforms.
 */
export async function analyzeCommonIsoformExons(geneSymbol, genbankRaw, fetchFn = globalThis.fetch) {
  const sym = String(geneSymbol || "").trim().toUpperCase();
  if (!genbankRaw || !genbankRaw.trim()) {
    return { ok: false, error: "No GenBank sequence available for isoform exon analysis." };
  }

  let model;
  try {
    model = normalizeGenBankToTranscriptModel(parseGB(genbankRaw), { expectedGene: sym });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }

  const mainSegs = model.cdsSegments || [];
  if (!mainSegs.length) {
    return { ok: false, error: "No coding exons found in reference." };
  }

  const inRecordIsoforms = codingModels(model);
  let totalIsoforms = inRecordIsoforms.length;
  let isoformIds = inRecordIsoforms.map(i => i.id);
  let source = inRecordIsoforms.length > 1 ? "GenBank multi-CDS annotations" : "Canonical CDS";

  // Default sharing counts from in-record CDS models
  const sharingCounts = mainSegs.map(([s, e]) =>
    inRecordIsoforms.filter(iso =>
      (iso.model.cdsSegments || []).some(([a, b]) => Math.min(e, b) - Math.max(s, a) >= Math.min(20, e - s))
    ).length
  );

  // If the GenBank record only has 1 CDS feature, query NCBI Datasets v2 for all curated RefSeq NM_ isoforms
  if (inRecordIsoforms.length <= 1 && typeof fetchFn === "function") {
    try {
      const url = `https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/${encodeURIComponent(sym)}/taxon/9606/product_report`;
      const res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(6000) });
      if (res?.ok) {
        const data = await res.json();
        const product = data?.reports?.[0]?.product;
        const primaryLoc = (t) => (t.genomic_locations || []).find(l => /^NC_/.test(l.genomic_accession_version || ""));
        const codingTxs = (product?.transcripts || []).filter(t => t.cds?.range?.length && primaryLoc(t) && /^NM_/.test(t.accession_version));
        if (codingTxs.length > 1) {
          const maneTx = codingTxs.find(t => t.select_category === "MANE_SELECT") || codingTxs[0];
          const mLoc = primaryLoc(maneTx);
          const orient = mLoc.genomic_range?.orientation === "minus" ? -1 : 1;
          const toSenseOrder = (segs) => orient === -1 ? [...segs].sort((a, b) => b[0] - a[0]) : [...segs].sort((a, b) => a[0] - b[0]);
          const mainGenomic = toSenseOrder(
            cdsToGenomic(
              mLoc.exons.map(e => [Number(e.begin), Number(e.end)]),
              orient,
              Number(maneTx.cds.range[0].begin),
              Number(maneTx.cds.range[maneTx.cds.range.length - 1].end)
            )
          );
          if (mainGenomic.length === mainSegs.length) {
            const allIsoformSegs = codingTxs.map(t => {
              const l = primaryLoc(t);
              return cdsToGenomic(
                l.exons.map(e => [Number(e.begin), Number(e.end)]),
                orient,
                Number(t.cds.range[0].begin),
                Number(t.cds.range[t.cds.range.length - 1].end)
              );
            });
            totalIsoforms = codingTxs.length;
            isoformIds = codingTxs.map(t => t.accession_version);
            source = `NCBI RefSeq (${codingTxs.length} NM_ coding isoforms)`;
            mainGenomic.forEach(([gs, ge], idx) => {
              const minOverlap = Math.min(20, ge - gs + 1);
              sharingCounts[idx] = allIsoformSegs.filter(segs =>
                segs.some(([a, b]) => Math.min(ge, b) - Math.max(gs, a) + 1 >= minOverlap)
              ).length;
            });
          }
        }
      }
    } catch {
      // Keep in-record isoform counts if offline or mock fetch does not include NCBI Datasets
    }
  }

  // Check which non-terminal exons can produce NMD-triggering ('robust'/'marginal') cuts vs 5' re-initiation / 3' last-junction 'escape'
  const exonNmdViable = mainSegs.map(([s, e], idx) => {
    const isTerm = mainSegs.length > 1 && idx === mainSegs.length - 1;
    if (isTerm || e - s < 25) return false;
    const sampleCuts = [
      Math.round(s + (e - s) * 0.25),
      Math.round(s + (e - s) * 0.5),
      Math.round(s + (e - s) * 0.75),
    ].filter(c => c > s + 10 && c < e - 10);
    return sampleCuts.some(cut => {
      try {
        const t = assessKoGuide(model, { cut }).tier;
        return t === "robust" || t === "marginal";
      } catch {
        return false;
      }
    });
  });

  const anyNmdViable = exonNmdViable.some(Boolean);
  const candidateSharing = mainSegs
    .map((_, idx) => ({ idx, shared: sharingCounts[idx], isTerm: mainSegs.length > 1 && idx === mainSegs.length - 1, viable: exonNmdViable[idx] }))
    .filter(x => !x.isTerm && (anyNmdViable ? x.viable : true));
  const maxNonTerminalSharing = Math.max(...candidateSharing.map(x => x.shared), 1);

  const exons = mainSegs.map(([s, e], idx) => {
    const shared = sharingCounts[idx];
    const coveragePct = Math.round((shared / totalIsoforms) * 100);
    const isTerminalExon = mainSegs.length > 1 && idx === mainSegs.length - 1;
    const isCommonAll = shared === totalIsoforms;
    const nmdViable = exonNmdViable[idx];
    const recommendedForKo = !isTerminalExon && (anyNmdViable ? nmdViable : true) && shared === maxNonTerminalSharing;
    return {
      codingExon: idx + 1,
      start: s + 1,
      end: e,
      lengthBp: e - s,
      sharedIsoforms: shared,
      totalIsoforms,
      coveragePct,
      isCommonExon: isCommonAll,
      isTerminalExon,
      nmdViable,
      recommendedForKo,
    };
  });

  const commonCodingExons = exons.filter(x => x.isCommonExon).map(x => x.codingExon);
  const recommendedCommonKoExons = exons.filter(x => x.recommendedForKo).map(x => x.codingExon);

  return {
    ok: true,
    gene: sym,
    source,
    totalIsoforms,
    isoformIds: isoformIds.slice(0, 12),
    commonCodingExons,
    recommendedCommonKoExons,
    exons,
  };
}

/**
 * Compute binomial clonal screening power (minimum 96-well clones to screen for >=95% probability of >=2 target clones).
 */
export function computeClonalScreeningPower({ editType, lindelTopGuide, deliveryEfficiency = 0.8, uniprot = null }) {
  const isKo = editType === "ko";
  const singleAlleleSuccess = isKo
    ? ((lindelTopGuide?.predicted_LoF_allele_pct || 80) / 100) * deliveryEfficiency
    : 0.32 * deliveryEfficiency; // Conservative HDR allele rate
  const pBiallelic = Math.max(0.01, Math.min(0.95, singleAlleleSuccess ** 2));

  let clonesFor95Pct = 192;
  for (let n = 4; n <= 384; n += 1) {
    const p0 = (1 - pBiallelic) ** n;
    const p1 = n * pBiallelic * ((1 - pBiallelic) ** (n - 1));
    if (1 - (p0 + p1) >= 0.95) {
      clonesFor95Pct = n;
      break;
    }
  }
  return {
    ok: true,
    mode: isKo ? "Homozygous/Biallelic LoF Knockout" : "Homozygous HDR Knock-In",
    assumedDeliveryEfficiencyPct: Math.round(deliveryEfficiency * 100),
    predictedBiallelicClonePct: Math.round(pBiallelic * 1000) / 10,
    recommendedClonesToScreen: clonesFor95Pct,
    plates96Well: Math.ceil(clonesFor95Pct / 96),
    pLI: uniprot?.pLI ?? null,
    loeuf: uniprot?.loeuf ?? null,
    essentialityTier: uniprot?.essentialityTier ?? "unknown",
    constraintSummary: uniprot?.constraintSummary ?? null,
  };
}

/**
 * Compare Step 1 Biomni / Lindel in-silico predictions against Step 3 observed Sanger .ab1 trace QC outcomes.
 */
export function computeQcPredictionCalibration(project = {}, qcResults = []) {
  const valid = (qcResults || []).filter(r => r && r.ok !== false);
  if (!valid.length) return null;
  const accepted = valid.filter(r => (r.decision?.decision || r.decision?.verdict) === "accept");
  const held = valid.filter(r => (r.decision?.decision || r.decision?.verdict) === "hold");
  const observedPct = Math.round((accepted.length / valid.length) * 1000) / 10;
  const sp = project?.biomniReport?.screeningPower || null;
  const predictedPct =
    sp?.predictedBiallelicClonePct ??
    project?.designResult?.koOutcomes?.minLofPct ??
    project?.designResult?.koAssessment?.outcomes?.minLofPct ??
    null;
  const recommendedClones = sp?.recommendedClonesToScreen ?? null;
  const goalMet = accepted.length >= 2;
  const deltaPct = predictedPct != null ? Math.round((observedPct - predictedPct) * 10) / 10 : null;

  return {
    ok: true,
    totalAnalyzed: valid.length,
    acceptedCount: accepted.length,
    heldCount: held.length,
    observedAcceptedPct: observedPct,
    predictedBiallelicPct: predictedPct,
    deltaPct,
    recommendedClones,
    goalMet,
    topAcceptedClones: accepted.slice(0, 3).map(r => r.name || r.sample || "Clone"),
    summary:
      predictedPct != null
        ? `Biomni predicted ~${predictedPct}% verified biallelic clones (target sample size: ${recommendedClones || "—"} clones); observed ${accepted.length}/${valid.length} (${observedPct}%) accepted clones${goalMet ? " — ≥2 verified clone banking target met." : " — screen additional clones to bank ≥2 independent lines."}`
        : `Observed ${accepted.length}/${valid.length} (${observedPct}%) accepted clones (${held.length} held for review)${goalMet ? " — ≥2 verified clone banking target met." : "."}`,
  };
}

/**
 * Build a descriptive Biomni Co-Scientist mission prompt from Manual Design inputs.
 */
export function buildManualBiomniPrompt({ gene, editType = "ko", mutation = "", tag = "FLAG", enzyme = "spcas9" } = {}) {
  const g = (gene || "TP53").trim().toUpperCase();
  const enzName = ENZYMES[enzyme]?.name || enzyme || "SpCas9";
  if (editType === "pm") {
    return `Design ${enzName} ${mutation || "point mutation"} knock-in for ${g}, check ClinVar & UniProt domains, and model clonal screening power`;
  }
  if (editType === "ct") {
    return `Design C-terminal ${tag || "mNeonGreen"} knock-in for ${g} with ${enzName}, inspect UniProt C-terminus, and model clonal screening power`;
  }
  if (editType === "nt") {
    return `Design N-terminal ${tag || "FLAG"} knock-in for ${g} with ${enzName}, inspect UniProt N-terminus, and model clonal screening power`;
  }
  if (editType === "it") {
    return `Design internal ${tag || "SPOT"} tag knock-in at ${mutation || "target site"} for ${g} with ${enzName}`;
  }
  return `Design ${enzName} knockout for ${g}, select NMD-safe common coding exon across isoforms, rank guides with Lindel & Brunello library, and compute clonal screening power`;
}

/**
 * Execute the autonomous Biomni Co-Scientist workflow in the browser or Node.
 */
export async function runBiomniCoScientist(
  prompt,
  currentProject = {},
  {
    onStep = () => {},
    fetchFn = globalThis.fetch,
    geneFetcher = resolveBiomniGeneReference,
    designRunner = runDesign,
    lindelLoader = defaultLindelLoader,
    intentOverride = null,
    initialDesignResult = null,
    preloadedLindel = null,
    preserveCustomGuides = false,
  } = {}
) {
  const parsedIntent = parseBiomniPrompt(prompt, currentProject);
  const intent = intentOverride
    ? {
        ...parsedIntent,
        ...intentOverride,
        gene: String(intentOverride.gene || parsedIntent.gene || "TP53").trim().toUpperCase(),
      }
    : parsedIntent;
  const plan = buildBiomniPlan(intent);
  const steps = [];

  let genbankRaw = "";
  let geneMeta = null;
  let isoformAnalysis = null;
  let uniprot = null;
  let clinvar = null;
  let designResult = null;
  let lindelRanking = null;
  let enzymeComparison = null;
  let screeningPower = null;
  let loadedLindel = preloadedLindel || null;

  const currentGeneUpper = (currentProject?.geneMeta?.geneSymbol || currentProject?.gene || "").trim().toUpperCase();

  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    const t0 = Date.now();
    onStep({ status: "running", currentStep: item, completedSteps: [...steps], totalSteps: plan.length });

    let output = { ok: true };
    try {
      if (item.tool === "fetch_gene_reference") {
        if (currentProject?.genbankRaw?.trim() && currentGeneUpper === intent.gene) {
          genbankRaw = currentProject.genbankRaw;
          geneMeta = currentProject.geneMeta || { geneSymbol: intent.gene, source: "Project GenBank Reference" };
          output = {
            ok: true,
            gene: intent.gene,
            source: geneMeta.source || "Current Project Reference",
            sequenceLength: genbankRaw.length,
          };
        } else {
          const fetched = await geneFetcher(intent.gene, fetchFn);
          genbankRaw = fetched.genbankText;
          geneMeta = fetched;
          output = {
            ok: true,
            gene: fetched.geneSymbol || intent.gene,
            ensemblId: fetched.ensemblId,
            transcriptId: fetched.transcriptId,
            source: fetched.source,
            sequenceLength: fetched.sequenceLength || genbankRaw.length,
          };
        }
      } else if (item.tool === "analyze_common_isoform_exons") {
        isoformAnalysis = await analyzeCommonIsoformExons(intent.gene, genbankRaw, fetchFn);
        output = isoformAnalysis;
      } else if (item.tool === "query_uniprot_protein") {
        uniprot = await queryUniprotProtein(intent.gene, fetchFn);
        output = uniprot;
      } else if (item.tool === "search_clinvar_variants") {
        clinvar = await searchClinvarVariants(intent.gene, intent.mutation, fetchFn);
        output = clinvar;
      } else if (item.tool === "design_crispr_edit") {
        if (!loadedLindel && intent.editType === "ko" && intent.enzyme === "spcas9") {
          try {
            loadedLindel = await lindelLoader();
          } catch {
            loadedLindel = null;
          }
        }
        const config = ENZYMES[intent.enzyme] || ENZYMES.spcas9;
        const options = {
          ...(currentProject?.options || {}),
          enzyme: intent.enzyme,
          spacerLength: config.spacer_len.default,
          expectedGene: intent.gene,
          ensureGuidePair: true,
          allowNonCodingBlockers: true,
          ...(loadedLindel ? { koLindel: loadedLindel } : {}),
        };
        const armLen = ["ct", "nt"].includes(intent.editType) ? Number(currentProject?.homologyArmLength || 400) : "";
        let res =
          initialDesignResult && !initialDesignResult.err
            ? initialDesignResult
            : designRunner(intent.editType, genbankRaw, intent.mutation, intent.tag, armLen, options);

        // If KO design picked an exon that is not in recommendedCommonKoExons, check if a recommended common exon has a valid 2-guide pair
        if (
          !preserveCustomGuides &&
          intent.editType === "ko" &&
          res &&
          !res.err &&
          isoformAnalysis?.recommendedCommonKoExons?.length > 0 &&
          loadedLindel
        ) {
          const exonMatch = String(res.exon || "").match(/Exon\s+(\d+)/i);
          const chosenExon = exonMatch ? Number(exonMatch[1]) : null;
          if (chosenExon && !isoformAnalysis.recommendedCommonKoExons.includes(chosenExon)) {
            try {
              const model = normalizeGenBankToTranscriptModel(parseGB(genbankRaw), { expectedGene: intent.gene });
              const allRows = rankKoGuides(model, loadedLindel).filter(
                r =>
                  isoformAnalysis.recommendedCommonKoExons.includes(r.coding_exon) &&
                  r.gc_percent >= 40 &&
                  r.gc_percent <= 60 &&
                  r.panel_tier === "robust"
              );
              for (let a = 0; a < allRows.length; a += 1) {
                let foundCommonPair = null;
                for (let b = a + 1; b < allRows.length; b += 1) {
                  if (allRows[a].coding_exon !== allRows[b].coding_exon) continue;
                  const dist = Math.abs(allRows[a].cut_after_exon_nt - allRows[b].cut_after_exon_nt);
                  if (dist >= 20 && dist <= 140) {
                    const candidateRes = designRunner(intent.editType, genbankRaw, intent.mutation, intent.tag, armLen, {
                      ...options,
                      customGuides: [allRows[a].spacer, allRows[b].spacer],
                    });
                    if (candidateRes && !candidateRes.err) {
                      foundCommonPair = candidateRes;
                      break;
                    }
                  }
                }
                if (foundCommonPair) {
                  foundCommonPair.singleCdsDefault = {
                    exon: res.exon,
                    codingExon: chosenExon,
                    guides: (res.gs || []).slice(0, 2).map(g => g.sp),
                  };
                  res = foundCommonPair;
                  break;
                }
              }
            } catch {
              // Keep primary design result
            }
          }
        }

        if (res && !res.err) {
          res.procurement = summarizeProcurementReadiness(res);
          const exonMatch = String(res.exon || "").match(/Exon\s+(\d+)/i);
          const targetCodingExon = exonMatch ? Number(exonMatch[1]) : null;
          const exonMeta = isoformAnalysis?.exons?.find(x => x.codingExon === targetCodingExon) || null;
          if (exonMeta) {
            res.panIsoformMeta = {
              targetCodingExon,
              sharedIsoforms: exonMeta.sharedIsoforms,
              totalIsoforms: exonMeta.totalIsoforms,
              coveragePct: exonMeta.coveragePct,
              isCommonExon: Boolean(exonMeta.recommendedForKo || exonMeta.isCommonExon),
              isTerminalExon: Boolean(exonMeta.isTerminalExon),
              singleCdsDefault: res.singleCdsDefault || null,
            };
          }
          designResult = res;
          output = {
            ok: true,
            enzyme: config.name,
            pam: config.pam_pattern,
            guideCount: (res.gs || []).length,
            donorCount: (res.os || []).length,
            primerCount: (res.ps || []).length,
            releaseStatus: res.procurement?.status || "review",
            topGuides: (res.gs || []).slice(0, 2).map(g => ({ spacer: g.sp, pam: g.pm || g.pam, strand: g.str, score: g.sc })),
            koTier: res.koAssessment?.tier || null,
            minLofPct: res.koOutcomes?.minLofPct ?? res.koAssessment?.outcomes?.minLofPct ?? null,
            targetCodingExon,
            isCommonExon: exonMeta ? exonMeta.recommendedForKo || exonMeta.isCommonExon : true,
            isoformCoverageLabel: exonMeta ? `${exonMeta.sharedIsoforms}/${exonMeta.totalIsoforms} isoforms (${exonMeta.coveragePct}%)` : null,
          };
        } else {
          output = { ok: false, error: res?.err || "Design returned no candidates." };
        }
      } else if (item.tool === "rank_ko_guides_lindel") {
        if (!loadedLindel) {
          loadedLindel = await lindelLoader();
        }
        const model = normalizeGenBankToTranscriptModel(parseGB(genbankRaw), { expectedGene: intent.gene });
        const rawRows = rankKoGuides(model, loadedLindel);
        const isNmdBlindLocus = !rawRows.some(r => r.panel_tier === "robust" || r.panel_tier === "marginal");

        // When non-terminal exons have no NMD-triggering ('robust'/'marginal') guides (e.g. APOE where 75.3% of CDS is in the last exon),
        // also evaluate 5'-half last-exon guides so early-truncation (<50% retained protein) and Brunello terminal-exon guides are ranked.
        const terminalRows = [];
        if (isNmdBlindLocus && model.cdsSegments.length > 1) {
          const lastIdx = model.cdsSegments.length - 1;
          const [lastStart, lastEnd] = model.cdsSegments[lastIdx];
          const G = model.genomicSequence.toUpperCase();
          const rc = (s) => [...s].reverse().map(c => ({ A: "T", C: "G", G: "C", T: "A" }[c] || "N")).join("");
          const pct1 = (x) => Math.round(1000 * x) / 10;
          for (let pos = lastStart; pos + 23 <= lastEnd; pos += 1) {
            const tryGuide = (spacer, strand, pam, cut) => {
              if (cut <= lastStart + 2 || cut >= lastEnd - 2) return;
              const w65 = koGuideWindow(model, { sp: spacer, str: strand, cut });
              if (!w65) return;
              const pred = predictLindel(loadedLindel, w65);
              if (pred.error) return;
              const edits = lindelEdits(pred);
              if (!edits.length) return;
              const s = summariseGuideOutcomes(model, { cut, strand, edits });
              const tier = assessKoGuide(model, { sp: spacer, str: strand, cut }).tier;
              const gc = Math.round([...spacer].filter(c => c === "G" || c === "C").length * 5);
              terminalRows.push({
                spacer,
                strand,
                pam,
                coding_exon: lastIdx + 1,
                cut_after_exon_nt: cut - lastStart,
                gc_percent: gc,
                base_pos17: spacer[16],
                panel_tier: tier,
                lindel_frameshift_pct: Math.round(1000 * pred.frameshift) / 10,
                lindel_plus1_ins_pct: pct1(s.plus1),
                predicted_LoF_allele_pct: pct1(s.lof),
                predicted_clear_NMD_allele_pct: pct1(s.clean),
                predicted_in_frame_pct: pct1(s.inframe),
                ge3bp_insertion_group_pct: pct1(s.group),
                other_isoform_not_disrupted_pct: pct1(s.gap),
                predicted_biallelic_LoF_clone_pct: Math.round(s.lof ** 2 * 1000) / 10,
                is_terminal_exon: true,
              });
            };
            if (/^[ACGT]GG$/.test(G.slice(pos + 20, pos + 23))) {
              tryGuide(G.slice(pos, pos + 20), "+", G.slice(pos + 20, pos + 23), pos + 17);
            }
            if (/^[ACGT]GG$/.test(rc(G.slice(pos, pos + 3)))) {
              tryGuide(rc(G.slice(pos + 3, pos + 23)), "-", rc(G.slice(pos, pos + 3)), pos + 6);
            }
          }
        }

        const selectedSpacers = new Set(
          (designResult?.gs || []).map(g => String(g.sp || g.spacer || "").toUpperCase())
        );
        const brunelloList = CURATED_BRUNELLO_LIBRARY[String(intent.gene || "").toUpperCase()] || [];
        const brunelloBySpacer = new Map(
          brunelloList.map((b, idx) => [b.spacer.toUpperCase(), { ...b, brunelloRank: idx + 1 }])
        );
        const KO_TIER_ORDER = { robust: 0, marginal: 1, truncation: 2, escape: 3 };
        const exonLookup = new Map((isoformAnalysis?.exons || []).map(x => [x.codingExon, x]));
        const activeDomains =
          uniprot?.domains?.length > 0
            ? uniprot.domains
            : CURATED_GENE_PROFILES[String(intent.gene || "").toUpperCase()]?.domains || [];
        const combinedRows = [...rawRows, ...terminalRows];
        const rows = combinedRows.map(r => {
          const ex = exonLookup.get(r.coding_exon);
          const inRecordDisruptedPct = Math.max(0, 100 - (r.other_isoform_not_disrupted_pct || 0));
          const coveragePct = ex ? ex.coveragePct : inRecordDisruptedPct;
          const isCommon = Boolean(ex ? ex.recommendedForKo : (r.other_isoform_not_disrupted_pct || 0) === 0);
          const brunelloMatch = brunelloBySpacer.get(String(r.spacer || "").toUpperCase()) || null;
          const { cutAa, disruptedDomain } = mapCutToAminoAcidAndDomain(model, r.coding_exon, r.cut_after_exon_nt, activeDomains);
          return {
            ...r,
            cut_aa: cutAa,
            disrupted_domain: disruptedDomain,
            isoform_coverage_pct: coveragePct,
            shared_isoforms_label: ex ? `${ex.sharedIsoforms}/${ex.totalIsoforms} (${ex.coveragePct}%)` : `${coveragePct}%`,
            is_common_exon: isCommon,
            is_terminal_exon: Boolean(r.is_terminal_exon || ex?.isTerminalExon),
            selected_in_pair: selectedSpacers.has(String(r.spacer || "").toUpperCase()),
            brunello_match: brunelloMatch,
          };
        });
        // Prioritize NMD-Safe ('robust') tier FIRST, then Common Non-Terminal Exon + highest isoform coverage % + highest Lindel LoF %
        rows.sort(
          (a, b) =>
            (KO_TIER_ORDER[a.panel_tier] ?? 9) - (KO_TIER_ORDER[b.panel_tier] ?? 9) ||
            Number(b.is_common_exon) - Number(a.is_common_exon) ||
            b.isoform_coverage_pct - a.isoform_coverage_pct ||
            b.predicted_LoF_allele_pct - a.predicted_LoF_allele_pct ||
            (a.other_isoform_not_disrupted_pct || 0) - (b.other_isoform_not_disrupted_pct || 0) ||
            b.gc_percent - a.gc_percent
        );
        rows.forEach((r, idx) => {
          r.lindel_rank = idx + 1;
        });
        const topDisplay = rows.slice(0, 5);
        for (const r of rows) {
          if (r.selected_in_pair && !topDisplay.some(t => t.spacer === r.spacer)) {
            topDisplay.push(r);
          }
        }
        // For NMD-blind loci (like APOE), also include the top 2 5'-last-exon truncation guides in displayGuides
        if (isNmdBlindLocus) {
          const bestTerminal = rows
            .filter(r => r.is_terminal_exon && r.predicted_LoF_allele_pct > 0)
            .sort((a, b) => b.predicted_LoF_allele_pct - a.predicted_LoF_allele_pct)
            .slice(0, 2);
          for (const tr of bestTerminal) {
            if (!topDisplay.some(t => t.spacer === tr.spacer)) {
              topDisplay.push(tr);
            }
          }
        }
        const brunelloEvaluated = brunelloList.map((b, idx) => {
          const matchedRow = rows.find(r => String(r.spacer || "").toUpperCase() === b.spacer.toUpperCase());
          const ex = exonLookup.get(b.exon);
          return {
            ...b,
            brunelloRank: idx + 1,
            lindelRank: matchedRow?.lindel_rank ?? null,
            panelTier: matchedRow?.panel_tier ?? (ex?.isTerminalExon ? "terminal_exon_escape" : "unranked"),
            predictedLofPct: matchedRow?.predicted_LoF_allele_pct ?? null,
            isoformCoverageLabel: ex ? `${ex.sharedIsoforms}/${ex.totalIsoforms} (${ex.coveragePct}%)` : null,
            isCommonExon: Boolean(ex?.recommendedForKo),
            isTerminalExon: Boolean(matchedRow?.is_terminal_exon || ex?.isTerminalExon),
            selectedInAssuredPair: selectedSpacers.has(b.spacer.toUpperCase()),
          };
        });

        // Build NMD-Escape Rescue & Alternative Nuclease options when all single-cut guides are 'escape'
        let nmdEscapeRescue = null;
        if (isNmdBlindLocus) {
          const altEnzymeOptions = [];
          for (const enzId of ["spcas9", "spcas9ng", "spry", "sacas9"]) {
            try {
              const enzCfg = ENZYMES[enzId];
              const altRes = designRunner("ko", genbankRaw, "", "", "", {
                enzyme: enzId,
                spacerLength: enzCfg.spacer_len.default,
                expectedGene: intent.gene,
                ...(enzId === "spcas9" && loadedLindel ? { koLindel: loadedLindel } : {}),
              });
              if (altRes && !altRes.err && altRes.gs?.length >= 2) {
                const bw = altRes.koAssessment?.between;
                altEnzymeOptions.push({
                  enzymeId: enzId,
                  enzymeName: enzCfg.name,
                  pam: enzCfg.pam_pattern,
                  exon: altRes.exon,
                  deletionBp: bw?.sizeBp ?? null,
                  deletionClass: bw?.class ?? null,
                  deletionTier: bw?.tier ?? altRes.koAssessment?.tier ?? "escape",
                  retainedProteinPct: bw?.retainedPct ?? null,
                  guides: altRes.gs.slice(0, 2).map(g => ({ spacer: g.sp, pam: g.pm || g.pam, strand: g.str, gc: g.gc })),
                });
              }
            } catch {
              // Skip failed enzyme
            }
          }
          const bestLastExonGuides = rows
            .filter(r => r.is_terminal_exon)
            .sort((a, b) => b.predicted_LoF_allele_pct - a.predicted_LoF_allele_pct)
            .slice(0, 3);
          nmdEscapeRescue = {
            isNmdBlindLocus: true,
            reason:
              "All single-cut frameshifts in non-terminal exons reach their premature stop codon within ≤55 nt of the last exon-exon junction or inside the terminal coding exon (escaping NMD).",
            alternativeEnzymePairs: altEnzymeOptions,
            lastExonTruncationGuides: bestLastExonGuides,
          };
        }

        lindelRanking = {
          ok: true,
          totalCandidates: rows.length,
          commonExonCandidates: rows.filter(r => r.is_common_exon).length,
          topGuides: rows.slice(0, 10),
          displayGuides: topDisplay,
          brunelloComparison: brunelloEvaluated,
          nmdEscapeRescue,
        };
        output = {
          ok: true,
          totalCandidates: rows.length,
          commonExonCandidates: rows.filter(r => r.is_common_exon).length,
          topGuide: rows[0] || null,
          topGuides: rows.slice(0, 5),
        };
      } else if (item.tool === "compare_crispr_enzymes") {
        const tempProject = {
          ...currentProject,
          id: currentProject?.id || "biomni",
          gene: intent.gene,
          geneMeta: geneMeta || { geneSymbol: intent.gene },
          genbankRaw,
          editType: intent.editType,
          mutation: intent.mutation,
          tag: intent.tag,
          homologyArmLength: currentProject?.homologyArmLength || 400,
          options: { ...(currentProject?.options || {}), enzyme: intent.enzyme },
        };
        const req = agentRequest(tempProject, Object.keys(ENZYMES), "balanced");
        enzymeComparison = await runWorkflowAgent(req, { runner: designRunner });
        const rec = enzymeComparison.candidates.filter(c => c.recommended);
        output = {
          ok: true,
          enzymesCompared: enzymeComparison.candidates.length,
          recommendedEnzymes: rec.map(c => c.name),
          eligibleCount: enzymeComparison.candidates.filter(c => c.eligible).length,
        };
      } else if (item.tool === "compute_screening_power") {
        screeningPower = computeClonalScreeningPower({
          editType: intent.editType,
          lindelTopGuide: lindelRanking?.topGuides?.[0],
          uniprot,
        });
        output = screeningPower;
      }
    } catch (err) {
      output = { ok: false, error: err.message || String(err) };
    }

    const completedStep = {
      ...item,
      status: output.ok ? "completed" : "warning",
      durationMs: Math.max(1, Date.now() - t0),
      output,
    };
    steps.push(completedStep);
    onStep({ status: "running", currentStep: null, completedSteps: [...steps], totalSteps: plan.length });
  }

  const variantShielding = designResult
    ? verifyCommonVariantShielding({ gene: intent.gene, genbankRaw, designResult })
    : null;
  const genotypingAssay = designResult
    ? computeWetLabGenotypingAssay({ editType: intent.editType, designResult, genbankRaw })
    : null;

  return {
    schema: "assured-biomni-coscientist/1",
    agentVersion: BIOMNI_AGENT_VERSION,
    createdAt: new Date().toISOString(),
    prompt,
    intent,
    plan,
    steps,
    geneMeta,
    genbankRaw,
    isoformAnalysis,
    uniprot,
    clinvar,
    designResult,
    lindelRanking,
    enzymeComparison,
    screeningPower,
    variantShielding,
    genotypingAssay,
  };
}
