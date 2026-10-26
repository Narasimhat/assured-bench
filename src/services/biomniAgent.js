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
import { rankKoGuides } from "../engine/design/koRank.js";
import { fetchGeneGenbank } from "./ensembl.js";
import { agentRequest, runWorkflowAgent } from "./workflowAgent.js";

async function defaultLindelLoader() {
  const { loadLindel } = await import("../engine/design/lindel/loadLindel.js");
  return loadLindel();
}

export const BIOMNI_AGENT_VERSION = "1.0.0";

export const BIOMNI_PRESET_MISSIONS = Object.freeze([
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
  {
    id: "tp53_ko",
    label: "TP53 Knockout + Lindel & Nuclease Comparison",
    prompt: "Design a knockout for TP53, rank guides with Lindel, and compare all enzymes",
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
 * Query UniProtKB REST API for human protein metadata and domains.
 */
export async function queryUniprotProtein(geneSymbol, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== "function") return { ok: false, error: "Fetch API unavailable" };
  const sym = String(geneSymbol || "").trim().toUpperCase();
  const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(`gene_exact:${sym} AND organism_id:9606 AND reviewed:true`)}&size=1`;
  try {
    const res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(10000) });
    if (!res.ok) return { ok: false, error: `UniProt HTTP ${res.status}` };
    const data = await res.json();
    const entry = data?.results?.[0];
    if (!entry) return { ok: true, found: false, gene: sym };
    const acc = entry.primaryAccession || "";
    const proteinName = entry.proteinDescription?.recommendedName?.fullName?.value || sym;
    const lengthAa = entry.sequence?.length || 0;
    const funcText = (entry.comments || [])
      .filter(c => c.commentType === "FUNCTION")
      .flatMap(c => (c.texts || []).map(t => t.value))
      .join(" ")
      .slice(0, 400);
    const domains = (entry.features || [])
      .filter(f => ["Domain", "Region", "Active site", "Binding site", "DNA binding", "Zinc finger"].includes(f.type))
      .slice(0, 8)
      .map(f => ({
        type: f.type,
        description: f.description || f.type,
        start: f.location?.start?.value,
        end: f.location?.end?.value,
      }));
    return {
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
    };
  } catch (err) {
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
 * Compute binomial clonal screening power (minimum 96-well clones to screen for >=95% probability of >=2 target clones).
 */
export function computeClonalScreeningPower({ editType, lindelTopGuide, deliveryEfficiency = 0.8 }) {
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
  };
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
    geneFetcher = fetchGeneGenbank,
    designRunner = runDesign,
    lindelLoader = defaultLindelLoader,
  } = {}
) {
  const intent = parseBiomniPrompt(prompt, currentProject);
  const plan = buildBiomniPlan(intent);
  const steps = [];

  let genbankRaw = "";
  let geneMeta = null;
  let uniprot = null;
  let clinvar = null;
  let designResult = null;
  let lindelRanking = null;
  let enzymeComparison = null;
  let screeningPower = null;
  let loadedLindel = null;

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
          const fetched = await geneFetcher(intent.gene);
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
      } else if (item.tool === "query_uniprot_protein") {
        uniprot = await queryUniprotProtein(intent.gene, fetchFn);
        output = uniprot;
      } else if (item.tool === "search_clinvar_variants") {
        clinvar = await searchClinvarVariants(intent.gene, intent.mutation, fetchFn);
        output = clinvar;
      } else if (item.tool === "design_crispr_edit") {
        if (intent.editType === "ko" && intent.enzyme === "spcas9") {
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
          ...(loadedLindel ? { lindel: loadedLindel } : {}),
        };
        const armLen = ["ct", "nt"].includes(intent.editType) ? Number(currentProject?.homologyArmLength || 400) : "";
        const res = designRunner(intent.editType, genbankRaw, intent.mutation, intent.tag, armLen, options);
        if (res && !res.err) {
          res.procurement = summarizeProcurementReadiness(res);
          designResult = res;
          output = {
            ok: true,
            enzyme: config.name,
            pam: config.pam_pattern,
            guideCount: (res.gs || []).length,
            donorCount: (res.os || []).length,
            primerCount: (res.ps || []).length,
            releaseStatus: res.procurement?.status || "review",
            topGuides: (res.gs || []).slice(0, 2).map(g => ({ spacer: g.sp, pam: g.pam, strand: g.str, score: g.sc })),
            koTier: res.koAssessment?.tier || null,
            minLofPct: res.koAssessment?.outcomes?.minLofPct ?? null,
          };
        } else {
          output = { ok: false, error: res?.err || "Design returned no candidates." };
        }
      } else if (item.tool === "rank_ko_guides_lindel") {
        if (!loadedLindel) {
          loadedLindel = await lindelLoader();
        }
        const model = normalizeGenBankToTranscriptModel(parseGB(genbankRaw), { expectedGene: intent.gene });
        const rows = rankKoGuides(model, loadedLindel);
        lindelRanking = {
          ok: true,
          totalCandidates: rows.length,
          topGuides: rows.slice(0, 8),
        };
        output = {
          ok: true,
          totalCandidates: rows.length,
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
    uniprot,
    clinvar,
    designResult,
    lindelRanking,
    enzymeComparison,
    screeningPower,
  };
}
