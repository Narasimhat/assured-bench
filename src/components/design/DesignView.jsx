import React, { useState } from "react";
import {
  runDesign,
  summarizeProcurementReadiness,
  CASSETTES,
  INTERNAL_TAGS
} from "../../engine/design/designEngine.js";
import {
  buildDesignSchemeSvg,
  buildDesignSchemeCaption
} from "../../engine/design/designScheme.js";
import {
  fetchGeneReference,
  fetchVariantReference,
  searchClinVar,
  SPECIES
} from "../../engine/design/geneFetch.js";
import { DONOR_FORMATS } from "../../engine/design/donorFormat.js";
import GenomicSnpTool from "../../engine/design/GenomicSnpTool.jsx";
import { indexOfGenomic } from "../../engine/design/genomicCoords.js";
import { fetchGeneGenbank } from "../../services/ensembl.js";
import {
  generateReportHtml,
  downloadReportHtml,
  downloadDesignJson,
  downloadSchemeSvg
} from "../../services/designExport.js";
import { GuideAlternatives } from "./GuideAlternatives.jsx";
import {
  Search,
  Play,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Upload,
  Download,
  FileText,
  FlaskConical,
  Sparkles
} from "lucide-react";

export const CONSTRUCT_BUILDER_OPTIONS = {
  nt: [
    {
      id: "fusion",
      label: "Fusion / linker",
      help: "Reporter or tag is fused directly at the N-terminus with the built-in linker.",
      payloads: [
        { cassette: "FLAG", label: "FLAG (DYKDDDDK)", kind: "tag" },
        { cassette: "N:EGFP-Linker", label: "EGFP", kind: "reporter" },
        { cassette: "N:mStayGold2-Linker", label: "mStayGold2", kind: "reporter" },
        { cassette: "N:dTAG-V5", label: "dTAG-V5", kind: "tag" },
        { cassette: "N:dTAG-HA", label: "dTAG-HA", kind: "tag" },
        { cassette: "N:SD40-V5", label: "SD40-V5", kind: "tag" },
        { cassette: "N:SD40-HA", label: "SD40-HA", kind: "tag" },
        { cassette: "N:miniIAA7-V5", label: "miniIAA7-V5", kind: "tag" },
        { cassette: "N:miniIAA7-HA", label: "miniIAA7-HA", kind: "tag" }
      ]
    },
    {
      id: "tag_p2a_selection",
      label: "Tag + P2A selection",
      help: "N-terminal fusion tag followed by a cleavable P2A antibiotic selection cassette.",
      payloads: [
        { cassette: "N:dTAG-V5-P2A-BlastiR", label: "dTAG-V5 + BlastiR", kind: "selection" },
        { cassette: "N:dTAG-V5-P2A-HygroR", label: "dTAG-V5 + HygroR", kind: "selection" },
        { cassette: "N:dTAG-HA-P2A-BlastiR", label: "dTAG-HA + BlastiR", kind: "selection" },
        { cassette: "N:dTAG-HA-P2A-HygroR", label: "dTAG-HA + HygroR", kind: "selection" },
        { cassette: "N:SD40-V5-P2A-BlastiR", label: "SD40-V5 + BlastiR", kind: "selection" },
        { cassette: "N:SD40-V5-P2A-HygroR", label: "SD40-V5 + HygroR", kind: "selection" },
        { cassette: "N:SD40-HA-P2A-BlastiR", label: "SD40-HA + BlastiR", kind: "selection" },
        { cassette: "N:SD40-HA-P2A-HygroR", label: "SD40-HA + HygroR", kind: "selection" },
        { cassette: "N:miniIAA7-V5-P2A-BlastiR", label: "miniIAA7-V5 + BlastiR", kind: "selection" },
        { cassette: "N:miniIAA7-V5-P2A-HygroR", label: "miniIAA7-V5 + HygroR", kind: "selection" },
        { cassette: "N:miniIAA7-HA-P2A-BlastiR", label: "miniIAA7-HA + BlastiR", kind: "selection" },
        { cassette: "N:miniIAA7-HA-P2A-HygroR", label: "miniIAA7-HA + HygroR", kind: "selection" }
      ]
    },
    {
      id: "t2a",
      label: "T2A cleavable",
      help: "Reporter is expressed as a cleavable N-terminal module with T2A.",
      payloads: [
        { cassette: "T2A-EGFP", label: "EGFP", kind: "reporter" },
        { cassette: "T2A-mScarlet_I3", label: "mScarlet-I3", kind: "reporter" },
        { cassette: "T2A-mStayGold2", label: "mStayGold2", kind: "reporter" }
      ]
    },
    {
      id: "p2a",
      label: "P2A cleavable",
      help: "Reporter is expressed as a cleavable N-terminal module with P2A.",
      payloads: [
        { cassette: "P2A-mCherry", label: "mCherry", kind: "reporter" },
        { cassette: "P2A-mScarlet", label: "mScarlet", kind: "reporter" },
        { cassette: "P2A-mStayGold2", label: "mStayGold2", kind: "reporter" }
      ]
    }
  ],
  ct: [
    {
      id: "fusion",
      label: "Fusion / linker",
      help: "Tag is fused directly at the C-terminus with the built-in linker.",
      payloads: [
        { cassette: "FLAG", label: "FLAG (DYKDDDDK)", kind: "tag" },
        { cassette: "dTAG-V5", label: "dTAG-V5", kind: "tag" },
        { cassette: "dTAG-HA", label: "dTAG-HA", kind: "tag" },
        { cassette: "SD40-V5", label: "SD40-V5", kind: "tag" },
        { cassette: "SD40-HA", label: "SD40-HA", kind: "tag" },
        { cassette: "SD40-GGGGS-V5", label: "SD40-GGGGS-V5 (spacer)", kind: "tag" },
        { cassette: "GGGGS3-SD40-GGGGS-V5", label: "(GGGGS)3-SD40-GGGGS-V5 (flexible)", kind: "tag" },
        { cassette: "miniIAA7-V5", label: "miniIAA7-V5", kind: "tag" },
        { cassette: "miniIAA7-HA", label: "miniIAA7-HA", kind: "tag" },
        { cassette: "2xHA-only", label: "2xHA-only", kind: "tag" },
        { cassette: "SD40-2xHA", label: "SD40-2xHA", kind: "tag" },
        { cassette: "dTAG-2xHA", label: "dTAG-2xHA", kind: "tag" },
        { cassette: "mAID-2xHA", label: "mAID-2xHA", kind: "tag" }
      ]
    },
    {
      id: "tag_p2a_selection",
      label: "Tag + P2A selection",
      help: "C-terminal fusion tag followed by a cleavable P2A antibiotic selection cassette.",
      payloads: [
        { cassette: "dTAG-V5-P2A-BlastiR", label: "dTAG-V5 + BlastiR", kind: "selection" },
        { cassette: "dTAG-V5-P2A-HygroR", label: "dTAG-V5 + HygroR", kind: "selection" },
        { cassette: "dTAG-HA-P2A-BlastiR", label: "dTAG-HA + BlastiR", kind: "selection" },
        { cassette: "dTAG-HA-P2A-HygroR", label: "dTAG-HA + HygroR", kind: "selection" },
        { cassette: "SD40-V5-P2A-BlastiR", label: "SD40-V5 + BlastiR", kind: "selection" },
        { cassette: "SD40-V5-P2A-HygroR", label: "SD40-V5 + HygroR", kind: "selection" },
        { cassette: "SD40-HA-P2A-BlastiR", label: "SD40-HA + BlastiR", kind: "selection" },
        { cassette: "SD40-HA-P2A-HygroR", label: "SD40-HA + HygroR", kind: "selection" },
        { cassette: "miniIAA7-V5-P2A-BlastiR", label: "miniIAA7-V5 + BlastiR", kind: "selection" },
        { cassette: "miniIAA7-V5-P2A-HygroR", label: "miniIAA7-V5 + HygroR", kind: "selection" },
        { cassette: "miniIAA7-HA-P2A-BlastiR", label: "miniIAA7-HA + BlastiR", kind: "selection" },
        { cassette: "miniIAA7-HA-P2A-HygroR", label: "miniIAA7-HA + HygroR", kind: "selection" }
      ]
    },
    {
      id: "t2a",
      label: "T2A cleavable",
      help: "Reporter is expressed as a cleavable C-terminal module with T2A.",
      payloads: [
        { cassette: "T2A-EGFP", label: "EGFP", kind: "reporter" },
        { cassette: "T2A-mScarlet_I3", label: "mScarlet-I3", kind: "reporter" },
        { cassette: "T2A-mStayGold2", label: "mStayGold2", kind: "reporter" }
      ]
    },
    {
      id: "p2a",
      label: "P2A cleavable",
      help: "Reporter is expressed as a cleavable C-terminal module with P2A.",
      payloads: [
        { cassette: "P2A-mCherry", label: "mCherry", kind: "reporter" },
        { cassette: "P2A-mScarlet", label: "mScarlet", kind: "reporter" },
        { cassette: "P2A-mStayGold2", label: "mStayGold2", kind: "reporter" }
      ]
    },
    {
      id: "tag_p2a_reporter",
      label: "Tag + P2A reporter",
      help: "C-terminal fusion tag followed by a cleavable P2A reporter.",
      payloads: [
        { cassette: "SD40-2xHA-P2A-mCherry", label: "SD40-2xHA + mCherry", kind: "combo" },
        { cassette: "dTAG-2xHA-P2A-mCherry", label: "dTAG-2xHA + mCherry", kind: "combo" },
        { cassette: "mAID-2xHA-P2A-mCherry", label: "mAID-2xHA + mCherry", kind: "combo" }
      ]
    }
  ]
};

function resolveConstructSelection(tag, editType) {
  const groups = CONSTRUCT_BUILDER_OPTIONS[editType] || [];
  for (const group of groups) {
    const found = group.payloads.find((p) => p.cassette === tag);
    if (found) return { architecture: group.id, cassette: found.cassette, group };
  }
  const fallbackGroup = groups[0];
  return {
    architecture: fallbackGroup?.id || "fusion",
    cassette: fallbackGroup?.payloads?.[0]?.cassette || tag || "FLAG",
    group: fallbackGroup
  };
}

function getCassetteLengthBp(cassetteKey, editType) {
  const entry = CASSETTES[cassetteKey];
  if (!entry) return 0;
  const seq = editType === "nt" ? entry.nt : entry.ct;
  return seq ? seq.length : 0;
}

const THREE_TO_ONE_AA = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C",
  Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
  Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P",
  Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V",
  Ter: "*", Stop: "*"
};

function extractProteinSubstitutionFromText(title) {
  const str = String(title || "");
  // Match e.g. (p.Arg175His) or p.R175H
  const threeMatch = str.match(/p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|\*)/);
  if (threeMatch) {
    const refAa = THREE_TO_ONE_AA[threeMatch[1]];
    const altAa = THREE_TO_ONE_AA[threeMatch[3]];
    if (refAa && altAa && refAa !== "*" && altAa !== "*") {
      return `${refAa}${threeMatch[2]}${altAa}`;
    }
  }
  const oneMatch = str.match(/\b([ACDEFGHIKLMNPQRSTVWY])(\d{1,5})([ACDEFGHIKLMNPQRSTVWY])\b/);
  if (oneMatch) return `${oneMatch[1]}${oneMatch[2]}${oneMatch[3]}`;
  return "";
}

export function DesignView({
  currentProject,
  onUpdateProject,
  onProceedToOrder,
  onProceedToQc,
  onOpenProtocol,
  onLoadPreset
}) {
  const geneInput = currentProject.gene ?? "";
  const editType = currentProject.editType ?? "ko";
  const mutation = currentProject.mutation ?? "";
  const tag = currentProject.tag ?? "FLAG";
  const homologyArmLength = currentProject.homologyArmLength ?? 400;
  const deliveryMethod = currentProject.options?.deliveryMethod ?? "rnp";
  const maxBlockingChanges = currentProject.options?.maxBlockingChanges ?? 3;
  const coDelivery = currentProject.options?.coDeliveryBlocking ?? currentProject.options?.coDelivery ?? false;
  const donorFormat = currentProject.options?.donorFormat ?? "auto";
  const geneMeta = currentProject.geneMeta ?? null;
  const genbankRaw = currentProject.genbankRaw ?? "";

  const [fetchSource, setFetchSource] = useState("ensembl");
  const [fetchSpecies, setFetchSpecies] = useState("human");
  const [clinvarQuery, setClinvarQuery] = useState("");
  const [clinvarState, setClinvarState] = useState({ status: "idle", variants: [], message: "" });
  const [isLoadingGene, setIsLoadingGene] = useState(false);
  const [isDesigning, setIsDesigning] = useState(false);
  const [error, setError] = useState(null);

  const setGeneInput = (gene) => onUpdateProject({ gene, geneMeta: null, genbankRaw: "" });
  const setEditType = (nextType) => {
    const patch = { editType: nextType };
    if (nextType === "it" && !INTERNAL_TAGS[tag]) {
      patch.tag = "SPOT";
    } else if ((nextType === "ct" || nextType === "nt") && !CASSETTES[tag]) {
      const resolved = resolveConstructSelection(tag, nextType);
      patch.tag = resolved.cassette;
    }
    onUpdateProject(patch);
  };
  const setMutation = (mutationVal) => onUpdateProject({ mutation: mutationVal });
  const setTag = (tagVal) => onUpdateProject({ tag: tagVal });
  const setHomologyArmLength = (len) => onUpdateProject({ homologyArmLength: len });
  const setOption = (fields) => onUpdateProject({ options: { ...currentProject.options, ...fields } });

  // Active design result
  const designResult = currentProject?.designResult || null;

  // Gene Fetch via geneFetch.js (Ensembl or NCBI across Human, Mouse, Rat, Zebrafish) with fallback to local TP53 reference
  const handleFetchGene = async () => {
    const query = geneInput.trim();
    if (!query) return;
    setIsLoadingGene(true);
    setError(null);
    try {
      const ref = await fetchGeneReference({
        query,
        source: fetchSource,
        species: fetchSpecies
      });
      onUpdateProject({
        gene: ref.summary.gene || query.toUpperCase(),
        geneMeta: {
          geneSymbol: ref.summary.gene || query.toUpperCase(),
          transcriptId: ref.summary.transcriptId,
          source: ref.summary.source || fetchSource.toUpperCase(),
          summaryText: ref.summary.text,
          warning: ref.summary.warnings?.join(" ") || "",
          fileName: ref.fileName
        },
        genbankRaw: ref.genbank
      });
    } catch (primaryErr) {
      // Fallback to ensembl.js (which also handles bundled TP53 NG_017013.2 during network outages)
      try {
        const speciesCode = SPECIES[fetchSpecies]?.ensembl || "homo_sapiens";
        const meta = await fetchGeneGenbank(query, speciesCode);
        onUpdateProject({
          gene: meta.geneSymbol,
          geneMeta: meta,
          genbankRaw: meta.genbankText
        });
      } catch (fallbackErr) {
        setError(primaryErr.message || fallbackErr.message || "Failed to fetch gene reference.");
      }
    } finally {
      setIsLoadingGene(false);
    }
  };

  // ClinVar search for Point Mutation mode
  const handleClinvarSearch = async () => {
    if (!clinvarQuery.trim() || clinvarState.status === "loading") return;
    setClinvarState({ status: "loading", variants: [], message: "Searching ClinVar…" });
    setError(null);
    try {
      const found = await searchClinVar(clinvarQuery.trim());
      if (found.variants.length === 1 && found.variants[0].supported) {
        await handleApplyClinvarVariant(found.variants[0]);
      } else {
        setClinvarState({
          status: "found",
          variants: found.variants,
          message: found.variants.length ? "" : "No matching single-base ClinVar variants found."
        });
      }
    } catch (err) {
      setClinvarState({
        status: "error",
        variants: [],
        message: err.message || "ClinVar lookup failed."
      });
    }
  };

  const handleApplyClinvarVariant = async (variant) => {
    setClinvarState({ status: "loading", variants: [], message: `Fetching ${variant.gene} MANE Select reference from Ensembl…` });
    try {
      const ref = await fetchVariantReference(variant);
      const proteinMut = extractProteinSubstitutionFromText(variant.title);
      onUpdateProject({
        gene: variant.gene || ref.summary.gene,
        mutation: proteinMut || mutation,
        geneMeta: {
          geneSymbol: variant.gene || ref.summary.gene,
          transcriptId: ref.summary.transcriptId,
          source: `ClinVar ${variant.accession}`,
          summaryText: `${variant.title} (${variant.significance}) · ${ref.summary.text}`,
          warning: ref.summary.warnings?.join(" ") || ""
        },
        genbankRaw: ref.genbank
      });
      setClinvarState({ status: "idle", variants: [], message: "" });
    } catch (err) {
      setClinvarState({
        status: "error",
        variants: [],
        message: err.message || "Could not load variant reference."
      });
    }
  };

  // Upload local GenBank file
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const meta = {
        geneSymbol: file.name.replace(/\.[^/.]+$/, ""),
        source: "Manual file upload",
        fileName: file.name,
        genbankText: text
      };
      onUpdateProject({ gene: meta.geneSymbol, geneMeta: meta, genbankRaw: text });
    };
    reader.readAsText(file);
  };

  // Convert GenomicSnpTool result into a unified Bench designResult so Order, QC, GelSimulator, and Report work seamlessly
  const handleGenomicSnpGenerated = (snpDesign) => {
    if (!snpDesign || snpDesign.err) return;
    const gp = indexOfGenomic(snpDesign.input, snpDesign.input.position);
    const normalizedResult = {
      ...snpDesign,
      type: "genomic-snv",
      gene: snpDesign.input?.gene || "Locus",
      gp,
      deliveryMethod: snpDesign.input?.deliveryMethod || "rnp",
      gs: (snpDesign.candidates || []).map((c) => ({
        ...c,
        n: c.name,
        pm: c.pam,
        note: `chr${snpDesign.input.chromosome}:${c.interval.start}–${c.interval.end}; cut offset ${c.d} bp; ${c.protection.tier} protection`
      })),
      os: (snpDesign.candidates || []).map((c) => ({
        ...c.donor,
        n: `ssODN matched to ${c.name}`,
        guideName: c.name,
        guideStrand: c.str,
        nucleotideValidation: c.nucleotideValidation,
        guideProtection: c.crossProtection || [{ guideName: c.name, ...c.protection }],
        desiredDiffIndexes: Number.isFinite(gp) && Number.isFinite(c.donor?.donorStart) ? [gp - c.donor.donorStart] : []
      })),
      ps: snpDesign.primers?.length ? [snpDesign.primers[0].forward, snpDesign.primers[0].reverse] : [],
      primerCandidates: snpDesign.primers || [],
      amp: snpDesign.primers?.length ? `${snpDesign.primers[0].ampliconLength} bp (WT and edited)` : "",
      primerStrategy: "Genomic PCR; RNA validation must separately establish splice effects.",
      procurement: {
        status: snpDesign.status === "BLOCKED" ? "blocked" : "review",
        blockers: snpDesign.blockers || [],
        warnings: snpDesign.warnings || [],
        standingRequirements: []
      }
    };
    const svgScheme = buildDesignSchemeSvg(normalizedResult);
    const caption = buildDesignSchemeCaption(normalizedResult);
    onUpdateProject({
      gene: normalizedResult.gene,
      editType: "genomic-snv",
      mutation: `chr${snpDesign.input.chromosome}:${snpDesign.input.position} ${snpDesign.input.ref}>${snpDesign.input.alt}`,
      designResult: normalizedResult,
      svgScheme,
      caption,
      status: normalizedResult.procurement.status
    });
  };

  // Generate design (with optional customGuides override)
  const executeDesign = async (customGuidesOverride = null) => {
    if (!genbankRaw) {
      setError("Please fetch a gene from Ensembl/NCBI or upload a GenBank reference file first.");
      return;
    }
    setIsDesigning(true);
    setError(null);
    try {
      const resolvedTag = editType === "it"
        ? (INTERNAL_TAGS[tag] ? tag : "SPOT")
        : (editType === "ct" || editType === "nt")
          ? (CASSETTES[tag] ? tag : resolveConstructSelection(tag, editType).cassette)
          : tag;

      const options = {
        deliveryMethod,
        maxBlockingChanges: Number(maxBlockingChanges),
        coDeliveryBlocking: coDelivery,
        donorFormat: donorFormat || "auto",
        expectedGene: geneMeta?.geneSymbol || geneInput.trim(),
        ensureGuidePair: true,
        allowNonCodingBlockers: true,
        ...(customGuidesOverride?.length ? { customGuides: customGuidesOverride } : {})
      };

      const result = runDesign(
        editType,
        genbankRaw,
        mutation,
        resolvedTag,
        Number(homologyArmLength),
        options
      );

      if (result.err) throw new Error(result.err);
      result.procurement = summarizeProcurementReadiness(result);
      const svgScheme = buildDesignSchemeSvg(result);
      const caption = buildDesignSchemeCaption(result);

      const updated = {
        gene: geneMeta?.geneSymbol || geneInput.trim(),
        editType,
        mutation,
        tag: resolvedTag,
        homologyArmLength,
        options: { ...currentProject.options, ...options },
        genbankRaw,
        designResult: result,
        svgScheme,
        caption,
        status: result.procurement?.status || "review"
      };

      onUpdateProject(updated);
    } catch (err) {
      setError("Design calculation failed: " + (err.message || String(err)));
    } finally {
      setIsDesigning(false);
    }
  };

  const handleRunDesign = () => executeDesign(null);

  const handleSelectAlternativeGuide = (spacer) => {
    if (!spacer) return;
    executeDesign([spacer]);
  };

  const getStatusBadge = (status) => {
    if (status === "ready") {
      return <span className="badge badge-ready"><CheckCircle size={14} /> READY FOR PROCUREMENT</span>;
    } else if (status === "review") {
      return <span className="badge badge-review"><AlertTriangle size={14} /> REVIEW REQUIRED</span>;
    }
    return <span className="badge badge-blocked"><XCircle size={14} /> BLOCKED</span>;
  };

  const constructSelection = (editType === "ct" || editType === "nt")
    ? resolveConstructSelection(tag, editType)
    : null;
  const constructPayloads = constructSelection?.group?.payloads || [];

  return (
    <div>
      {/* Parameter Input Card */}
      <div className="card">
        <div className="card-title" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <span>1. Design your edit</span>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal", marginTop: "0.15rem" }}>
              Choose any of the 6 ASSURED project types, fetch a MANE Select reference from Ensembl/NCBI or ClinVar, or launch a preset.
            </div>
          </div>

          {onLoadPreset && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                <Sparkles size={14} style={{ color: "var(--primary)" }} />
                Instant Presets:
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.65rem", fontSize: "0.78rem" }}
                onClick={() => onLoadPreset("tp53_flag")}
                title="Load TP53 C-terminal FLAG knock-in and auto-compute design"
              >
                TP53 C-term FLAG
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.65rem", fontSize: "0.78rem" }}
                onClick={() => onLoadPreset("tp53_pm")}
                title="Load TP53 R175H point mutation knock-in with silent PAM blocking"
              >
                TP53 R175H (SNP KI)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.65rem", fontSize: "0.78rem" }}
                onClick={() => onLoadPreset("tp53_ko")}
                title="Load TP53 dual-guide constitutive knockout"
              >
                TP53 Dual-Guide KO
              </button>
            </div>
          )}
        </div>

        {/* Project Type Selector (All 6 ASSURED CRISPR Design Project Types) */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 600, fontSize: "0.9rem" }}>
            What do you want to design?
          </label>
          <select
            aria-label="Edit Type"
            value={editType}
            onChange={(e) => setEditType(e.target.value)}
            style={{ width: "100%", fontWeight: 600 }}
          >
            <option value="ko">Knockout (Dual-guide exon deletion / frameshift)</option>
            <option value="pm">Point Mutation (Single amino-acid substitution, e.g. R175H)</option>
            <option value="genomic-snv">Genomic SNP (Exact 1-based nucleotide substitution: intron, splice site, UTR, or coding)</option>
            <option value="ct">C-Terminal Knock-in (Fusion tags, dTAG/IAA7 degrons, T2A/P2A reporters &amp; selection)</option>
            <option value="nt">N-Terminal Knock-in (Fusion tags, reporters, dTAG/IAA7 degrons &amp; P2A selection)</option>
            <option value="it">Internal Tag Knock-in (In-frame SPOT or alphaBtx tag insertion)</option>
          </select>
        </div>

        {editType === "genomic-snv" ? (
          <div style={{ marginTop: "1rem" }}>
            <GenomicSnpTool
              onInvalidate={() => onUpdateProject({ designResult: null, svgScheme: null, status: null })}
              onGenerate={handleGenomicSnpGenerated}
            />
          </div>
        ) : (
          <>
            <div className="grid-2">
              {/* Target Gene Entry with Ensembl/NCBI + Species Selector */}
              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                  Target Gene Symbol, Ensembl ID (ENST…), or RefSeq (NM_…)
                </label>
                <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={geneInput}
                    disabled={isLoadingGene}
                    aria-label="Target gene"
                    onChange={(e) => setGeneInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Enter" && geneInput.trim()) handleFetchGene(); }}
                    placeholder="e.g. SCN5A, APOE, TP53, ENST00000269305"
                    style={{ flex: "1 1 170px" }}
                  />
                  <select
                    aria-label="Reference source"
                    value={fetchSource}
                    onChange={(e) => setFetchSource(e.target.value)}
                    style={{ width: "110px" }}
                  >
                    <option value="ensembl">Ensembl</option>
                    <option value="ncbi">NCBI</option>
                  </select>
                  <select
                    aria-label="Species"
                    value={fetchSpecies}
                    onChange={(e) => setFetchSpecies(e.target.value)}
                    style={{ width: "115px" }}
                  >
                    {Object.entries(SPECIES).map(([key, sp]) => (
                      <option key={key} value={key}>{sp.label}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    onClick={handleFetchGene}
                    disabled={isLoadingGene || !geneInput.trim()}
                  >
                    <Search size={16} />
                    <span>{isLoadingGene ? "Fetching..." : "Fetch Gene"}</span>
                  </button>
                </div>

                {geneMeta && (
                  <p style={{ fontSize: "0.8rem", color: "var(--success)", marginTop: "0.4rem" }}>
                    ✓ Loaded: <strong>{geneMeta.geneSymbol}</strong> ({geneMeta.summaryText || geneMeta.transcriptId || "Custom Reference"})
                  </p>
                )}
              </div>

              {/* Fallback Upload */}
              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                  Or Upload GenBank Record (.gb / .gbk / .genbank)
                </label>
                <label className="btn btn-secondary" style={{ width: "100%", justifyContent: "center", cursor: "pointer" }}>
                  <Upload size={16} />
                  <span>{geneMeta?.fileName || "Browse Local Reference File"}</span>
                  <input type="file" accept=".gb,.gbk,.genbank,.txt" onChange={handleFileUpload} style={{ display: "none" }} />
                </label>
              </div>
            </div>

            {/* Optional ClinVar Variant Lookup for Point Mutation (pm) */}
            {editType === "pm" && (
              <div style={{ marginTop: "1rem", padding: "0.85rem 1rem", borderRadius: "8px", background: "var(--bg-app)", border: "1px solid var(--border-color)" }}>
                <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem" }}>
                  Optional: Find pathogenic variant in ClinVar (auto-loads MANE Select reference &amp; amino acid change)
                </label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={clinvarQuery}
                    onChange={(e) => setClinvarQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && clinvarQuery.trim()) { e.preventDefault(); handleClinvarSearch(); } }}
                    placeholder="Variation ID, VCV accession, rsID, or gene + protein change (e.g. TP53 R175H)"
                    style={{ flex: 1, fontSize: "0.85rem" }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleClinvarSearch}
                    disabled={!clinvarQuery.trim() || clinvarState.status === "loading"}
                    style={{ fontSize: "0.85rem" }}
                  >
                    {clinvarState.status === "loading" ? "Searching ClinVar…" : "Search ClinVar"}
                  </button>
                </div>
                {clinvarState.message && (
                  <p style={{ fontSize: "0.82rem", color: clinvarState.status === "error" ? "var(--danger)" : "var(--text-muted)", marginTop: "0.4rem" }}>
                    {clinvarState.message}
                  </p>
                )}
                {clinvarState.status === "found" && clinvarState.variants.length > 0 && (
                  <div style={{ marginTop: "0.6rem", maxHeight: "180px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "6px", background: "#fff" }}>
                    {clinvarState.variants.map((v) => (
                      <div key={v.id} style={{ padding: "0.45rem 0.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem" }}>
                        <div>
                          <strong>{v.title}</strong>
                          <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                            {v.significance}{v.conditions?.[0] ? ` · ${v.conditions[0]}` : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={!v.supported}
                          onClick={() => handleApplyClinvarVariant(v)}
                          style={{ padding: "0.2rem 0.55rem", fontSize: "0.75rem" }}
                        >
                          {v.supported ? "Use Variant" : v.unsupportedReason || "Unsupported"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {geneMeta?.warning && (
              <p role="status" style={{ marginTop: "0.75rem", color: "var(--warning)", fontSize: "0.85rem" }}>
                {geneMeta.warning}{" "}
                {geneMeta.sourceUrl && <a href={geneMeta.sourceUrl} target="_blank" rel="noreferrer">Reference record</a>}
              </p>
            )}

            {/* Edit Configuration */}
            <div className="grid-3" style={{ marginTop: "1.25rem" }}>
              {editType === "pm" && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                    Amino Acid Substitution
                  </label>
                  <input
                    type="text"
                    value={mutation}
                    onChange={(e) => setMutation(e.target.value.toUpperCase())}
                    placeholder="e.g. R175H, R154S, E342K"
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              {editType === "it" && (
                <>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                      Internal Tag (In-Frame)
                    </label>
                    <select
                      value={INTERNAL_TAGS[tag] ? tag : "SPOT"}
                      onChange={(e) => setTag(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      {Object.keys(INTERNAL_TAGS).map((key) => (
                        <option key={key} value={key}>
                          {key} ({INTERNAL_TAGS[key].seq.length} bp / {INTERNAL_TAGS[key].aa.length} aa)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                      Insert After Amino Acid
                    </label>
                    <input
                      type="text"
                      value={mutation}
                      onChange={(e) => setMutation(e.target.value.toUpperCase())}
                      placeholder="e.g. P155"
                      style={{ width: "100%" }}
                    />
                  </div>
                </>
              )}

              {(editType === "ct" || editType === "nt") && constructSelection && (
                <>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                      Insert Architecture
                    </label>
                    <select
                      aria-label="Insert style"
                      value={constructSelection.architecture}
                      onChange={(e) => {
                        const group = (CONSTRUCT_BUILDER_OPTIONS[editType] || []).find((g) => g.id === e.target.value);
                        if (group?.payloads?.length) {
                          setTag(group.payloads[0].cassette);
                        }
                      }}
                      style={{ width: "100%" }}
                    >
                      {(CONSTRUCT_BUILDER_OPTIONS[editType] || []).map((group) => (
                        <option key={group.id} value={group.id}>{group.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                      Tag / Reporter / Selection Cassette
                    </label>
                    <select
                      aria-label="Tag Cassette"
                      value={constructSelection.cassette}
                      onChange={(e) => setTag(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      {constructPayloads.map((item) => (
                        <option key={item.cassette} value={item.cassette}>
                          {item.label} ({getCassetteLengthBp(item.cassette, editType)} bp)
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                  Delivery Platform
                </label>
                <select value={deliveryMethod} onChange={(e) => setOption({ deliveryMethod: e.target.value })} style={{ width: "100%" }}>
                  <option value="rnp">Synthetic sgRNA + Cas9 RNP (Cleanest)</option>
                  <option value="u6">U6 Plasmid / Lentivirus</option>
                </select>
              </div>
            </div>

            {(editType === "ct" || editType === "nt") && constructSelection?.group?.help && (
              <p style={{ marginTop: "0.55rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                {constructSelection.group.help} Resolved cassette: <code className="mono">{constructSelection.cassette}</code>
              </p>
            )}

            {/* Advanced Options Bar */}
            <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginTop: "1rem", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Max Silent Blocking Changes:</span>
                <select
                  value={maxBlockingChanges}
                  onChange={(e) => setOption({ maxBlockingChanges: Number(e.target.value) })}
                  style={{ padding: "0.3rem 0.5rem", fontSize: "0.85rem" }}
                >
                  <option value={1}>1 mutation</option>
                  <option value={2}>2 mutations</option>
                  <option value={3}>3 mutations (Recommended)</option>
                </select>
              </div>

              {(editType === "ct" || editType === "nt") && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Donor Format:</span>
                    <select
                      aria-label="Donor Format"
                      value={donorFormat}
                      onChange={(e) => setOption({ donorFormat: e.target.value })}
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.85rem" }}
                    >
                      <option value="auto">Auto (by insert length)</option>
                      {Object.values(DONOR_FORMATS).map((df) => (
                        <option key={df.key} value={df.key}>{df.short}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Homology Arm (bp):</span>
                    <select
                      value={homologyArmLength}
                      onChange={(e) => setHomologyArmLength(Number(e.target.value))}
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.85rem" }}
                    >
                      <option value={60}>60 bp (ssODN Ultramer)</option>
                      <option value={200}>200 bp (dsDNA Block)</option>
                      <option value={250}>250 bp (Standard dsDNA Block)</option>
                      <option value={400}>400 bp (Standard HDR Arm)</option>
                      <option value={500}>500 bp (Cloned / AAV Donor)</option>
                    </select>
                  </div>
                </>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={coDelivery}
                  onChange={(e) => setOption({ coDeliveryBlocking: e.target.checked })}
                />
                <span>Co-delivery mode (block all offered guides)</span>
              </label>

              <button
                className="btn btn-primary"
                onClick={handleRunDesign}
                disabled={isDesigning || isLoadingGene || !genbankRaw}
                style={{ marginLeft: "auto" }}
              >
                <Play size={16} />
                <span>{isDesigning ? "Computing Design..." : "Generate design"}</span>
              </button>
            </div>

            {!genbankRaw && (
              <p style={{ marginTop: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                Fetch a gene from Ensembl/NCBI, upload a GenBank reference, or click one of the Instant Presets above to enable design.
              </p>
            )}
            {error && (
              <div role="alert" style={{ marginTop: "1rem", padding: "0.75rem", borderRadius: "8px", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger)", fontSize: "0.9rem", fontWeight: 600 }}>
                {error}
              </div>
            )}
          </>
        )}
      </div>

      {/* Results Display: Single Unified ASSURED Design Report (Zero Duplication) */}
      {designResult && (
        <>
          {/* Compact Action Bar */}
          <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", borderColor: designResult.procurement?.status === "ready" ? "var(--success)" : "var(--warning)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "1.05rem", fontWeight: 700 }}>Design Report:</span>
              {getStatusBadge(designResult.procurement?.status || "review")}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadReportHtml(currentProject, designResult)}
                title="Download standalone HTML report"
              >
                <FileText size={16} />
                <span>Download HTML Report</span>
              </button>

              {currentProject?.svgScheme && (
                <button
                  className="btn btn-secondary"
                  onClick={() => downloadSchemeSvg(currentProject, currentProject.svgScheme)}
                  title="Download standalone SVG vector schematic"
                >
                  <Download size={16} />
                  <span>Download SVG</span>
                </button>
              )}

              <button
                className="btn btn-secondary"
                onClick={() => downloadDesignJson(currentProject, designResult)}
                title="Download machine-readable design specification JSON"
              >
                <Download size={16} />
                <span>Design JSON</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={onOpenProtocol}
                style={{ color: "var(--primary)", borderColor: "rgba(2, 132, 199, 0.4)", fontWeight: 600 }}
                title="View wet-lab bench protocol and pipetting checklist"
              >
                <FlaskConical size={16} />
                <span>Bench Protocol</span>
              </button>

              <button className="btn btn-primary" onClick={onProceedToOrder}>
                <span>Proceed to Order</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          {/* Single Authoritative ASSURED Design Report */}
          <div className="card" style={{ padding: "0.5rem", overflow: "hidden" }}>
            <iframe
              title="ASSURED design report"
              srcDoc={generateReportHtml(currentProject, designResult)}
              sandbox="allow-same-origin"
              style={{
                width: "100%",
                height: "82vh",
                minHeight: "740px",
                border: "none",
                borderRadius: "8px",
                background: "#ffffff"
              }}
            />
          </div>

          {designResult.guideAlternatives?.candidates?.length > 0 && (
            <details className="card" style={{ marginTop: "1rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-main)", userSelect: "none" }}>
                Switch Guide RNA ({designResult.guideAlternatives.candidates.length} nearby candidates)
              </summary>
              <div style={{ marginTop: "1rem" }}>
                <GuideAlternatives
                  result={designResult}
                  onSelectAlternative={handleSelectAlternativeGuide}
                />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
