import { useCallback, useEffect, useMemo, useState } from "react";
import GenomicSnpTool, { GenomicSnpReport } from "./GenomicSnpTool.jsx";
import { CASSETTES, INTERNAL_TAGS, REPORTERS, buildPrimerRecord, designCenteredPrimerPairs, designDeletionScreenPrimerPairs, designPrimerTool, getCassetteSequenceLength, parseGB, runDesign, collectProcurementReviewNotes, summarizeGuideBlocking, summarizePrimerPairQuality, summarizePrimerReadiness, summarizeProcurementReadiness } from "../engine/design/designEngine.js";
import { getDonorStrandBadge, getDonorStrandBadgeColor, getOrderRecommendationLabels } from "../engine/design/reportModel.js";
import { DNA_COMPLEMENT, PM_EDIT_COLORS, PM_GUIDE_COLORS, buildDesignReadinessChecks,
  buildDesignSummary, buildGeneInfoItems, buildInternalStrandModels, buildKnockinQcChecks, buildLocusMapItems,
  buildLocusStructureItems, buildPmDonorComparison, buildPmStrandModels, buildPrimerCandidateRows,
  buildPrimerSummaryItems, buildReportHtml, buildReportSnapshotItems, buildSsOdnNotes, findPmRegion,
  formatDesignLabel, getBrunelloReferenceGuideSet, getPrimerQualitySummary, getProjectTypeMeta,
  normalizeGeneToken, normalizeLocusWindow } from "../engine/design/reportHtml.js";
import { describeKoGenomicContextFromModel, getGenomicSequence, normalizeGenBankToTranscriptModel, normalizeRawSequenceToTranscriptModel } from "../engine/design/transcriptModel.js";
import { fetchGeneReference, SPECIES } from "../services/geneFetch.js";
import { HISTORICAL_PROJECTS, HISTORICAL_PROJECTS_SUMMARY } from "../engine/design/data/historicalProjects.js";
import { buildHistoricalContext, buildReviewItems, buildRowMeta } from "../engine/design/reportInputs.js";
import { getDonorReleaseStatus, getReleaseVerdict, getReleaseVerdictSections } from "../engine/design/releaseVerdict.js";
import { buildBatchOrderRows, buildSafeToken, formatBatchDesignLabel } from "../engine/design/orderRows.js";
import { APP_CONFIG, PROJECT_TYPES, SAMPLE_REQUEST_TEXT } from "../engine/design/appConfig.js";
import { formatBuildLabel } from "../engine/design/buildInfo.js";
import { buildQcDesignSpec } from "../engine/design/qcExport.js";
import { buildDesignSchemeCaption, buildDesignSchemeFilename, buildDesignSchemeSvg, supportsDesignScheme } from "../engine/design/designScheme.js";
import { DONOR_FORMATS, defaultArms, describeDonorFormat, recommendDonorFormat } from "../engine/design/donorFormat.js";

const COLORS = {
  bg: "#F5F7FB",
  panel: "#FFFFFF",
  panelAlt: "#F8FAFC",
  border: "#D0D5DD",
  borderSoft: "rgba(15, 23, 42, 0.12)",
  accent: "#0F766E",
  accentAlt: "#B45309",
  success: "#15803D",
  danger: "#B42318",
  text: "#0F172A",
  muted: "#475467",
  dim: "#667085",
  paper: "#FFFFFF",
};

const CAS_DATABASE_ORGANISM_OPTIONS = [
  { id: "1", label: "Human (GRCh38/hg38)" },
  { id: "6", label: "Mouse (GRCm38/mm10)" },
  { id: "5", label: "Rat (Rnor 6.0)" },
  { id: "8", label: "Zebrafish (GRCz10)" },
  { id: "12", label: "Pig (Ensembl v10.2)" },
];

const FIELD_STYLE = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${COLORS.borderSoft}`,
  background: "#FFFFFF",
  color: COLORS.text,
  fontSize: 14,
  minHeight: 44,
  lineHeight: 1.35,
  boxSizing: "border-box",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
};

const SELECT_STYLE = {
  ...FIELD_STYLE,
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  paddingRight: 36,
  backgroundImage: 'linear-gradient(45deg, transparent 50%, #93a7bd 50%), linear-gradient(135deg, #93a7bd 50%, transparent 50%)',
  backgroundPosition: "calc(100% - 18px) calc(50% - 2px), calc(100% - 12px) calc(50% - 2px)",
  backgroundSize: "6px 6px, 6px 6px",
  backgroundRepeat: "no-repeat",
};

const CARD_STYLE = {
  background: "linear-gradient(180deg, #FFFFFF, #F8FAFC)",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
  backdropFilter: "blur(8px)",
};

const APP_FOOTER_LABEL = formatBuildLabel();
const REPO_URL = "https://github.com/Narasimhat/Assured_CRISPR_Design";

const CASSETTE_ALIASES = {
  mscarlett2a: "T2A-mScarlet_I3",
  t2amscarlet: "T2A-mScarlet_I3",
  t2amscarleti3: "T2A-mScarlet_I3",
  mstaygold2t2a: "T2A-mStayGold2",
  t2amstaygold2: "T2A-mStayGold2",
  mscarletp2a: "P2A-mScarlet",
  p2amscarlet: "P2A-mScarlet",
  mscarleti3p2a: "P2A-mScarlet",
  mstaygold2p2a: "P2A-mStayGold2",
  p2amstaygold2: "P2A-mStayGold2",
  egfplinker: "N:EGFP-Linker",
  mstaygold2linker: "N:mStayGold2-Linker",
  sd40linker: "N:SD40-Linker",
  dtaglinker: "N:dTAG-Linker",
  maidlinker: "N:mAID-Linker",
  egfpt2a: "T2A-EGFP",
  mscarleti3t2a: "T2A-mScarlet_I3",
  mcherryp2a: "P2A-mCherry",
};

const NT_CASSETTE_OPTIONS = [
  "N:EGFP-Linker",
  "N:mStayGold2-Linker",
  "T2A-EGFP",
  "T2A-mScarlet_I3",
  "T2A-mStayGold2",
  "P2A-mCherry",
  "P2A-mScarlet",
  "P2A-mStayGold2",
  "N:SD40-Linker",
  "N:dTAG-Linker",
  "N:mAID-Linker",
  "N:2xHA-dTAG-Linker",
];

const CT_CASSETTE_OPTIONS = [
  "2xHA-only",
  "SD40-2xHA",
  "dTAG-2xHA",
  "mAID-2xHA",
  "T2A-EGFP",
  "T2A-mScarlet_I3",
  "T2A-mStayGold2",
  "P2A-mCherry",
  "P2A-mScarlet",
  "P2A-mStayGold2",
  "SD40-2xHA-P2A-mCherry",
  "dTAG-2xHA-P2A-mCherry",
  "mAID-2xHA-P2A-mCherry",
];

const CASSETTE_DISPLAY = {
  "N:EGFP-Linker": {
    nt: "EGFP fusion (reporter-linker)",
  },
  "N:mStayGold2-Linker": {
    nt: "mStayGold2 fusion (reporter-linker)",
  },
  "N:SD40-Linker": {
    nt: "SD40 fusion (tag-linker)",
  },
  "N:dTAG-Linker": {
    nt: "dTAG fusion (tag-linker)",
  },
  "N:mAID-Linker": {
    nt: "mAID fusion (tag-linker)",
  },
  "N:2xHA-dTAG-Linker": {
    nt: "2xHA-dTAG fusion (tag-linker)",
  },
  "T2A-EGFP": {
    nt: "EGFP-T2A cleavable",
    ct: "T2A-EGFP cleavable",
  },
  "T2A-mScarlet_I3": {
    nt: "mScarlet-I3-T2A cleavable",
    ct: "T2A-mScarlet-I3 cleavable",
  },
  "T2A-mStayGold2": {
    nt: "mStayGold2-T2A cleavable",
    ct: "T2A-mStayGold2 cleavable",
  },
  "P2A-mCherry": {
    nt: "mCherry-P2A cleavable",
    ct: "P2A-mCherry cleavable",
  },
  "P2A-mScarlet": {
    nt: "mScarlet-P2A cleavable",
    ct: "P2A-mScarlet cleavable",
  },
  "P2A-mStayGold2": {
    nt: "mStayGold2-P2A cleavable",
    ct: "P2A-mStayGold2 cleavable",
  },
  "2xHA-only": {
    ct: "2xHA fusion (linker-tag)",
  },
  "SD40-2xHA": {
    ct: "SD40-2xHA fusion (linker-tag)",
  },
  "dTAG-2xHA": {
    ct: "dTAG-2xHA fusion (linker-tag)",
  },
  "mAID-2xHA": {
    ct: "mAID-2xHA fusion (linker-tag)",
  },
  "SD40-2xHA-P2A-mCherry": {
    ct: "SD40-2xHA-P2A-mCherry cleavable",
  },
  "dTAG-2xHA-P2A-mCherry": {
    ct: "dTAG-2xHA-P2A-mCherry cleavable",
  },
  "mAID-2xHA-P2A-mCherry": {
    ct: "mAID-2xHA-P2A-mCherry cleavable",
  },
};

const CONSTRUCT_BUILDER_OPTIONS = {
  nt: [
    {
      id: "fusion",
      label: "Fusion / linker",
      help: "Reporter or tag is fused directly at the N-terminus with the built-in linker.",
      payloads: [
        { cassette: "N:EGFP-Linker", label: "EGFP", kind: "reporter" },
        { cassette: "N:mStayGold2-Linker", label: "mStayGold2", kind: "reporter" },
        { cassette: "N:dTAG-V5", label: "dTAG-V5", kind: "tag" },
        { cassette: "N:dTAG-HA", label: "dTAG-HA", kind: "tag" },
        { cassette: "N:SD40-V5", label: "SD40-V5", kind: "tag" },
        { cassette: "N:SD40-HA", label: "SD40-HA", kind: "tag" },
        { cassette: "N:miniIAA7-V5", label: "miniIAA7-V5", kind: "tag" },
        { cassette: "N:miniIAA7-HA", label: "miniIAA7-HA", kind: "tag" },
      ],
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
        { cassette: "N:miniIAA7-HA-P2A-HygroR", label: "miniIAA7-HA + HygroR", kind: "selection" },
      ],
    },
    {
      id: "t2a",
      label: "T2A cleavable",
      help: "Reporter is expressed as a cleavable N-terminal module with T2A.",
      payloads: [
        { cassette: "T2A-EGFP", label: "EGFP", kind: "reporter" },
        { cassette: "T2A-mScarlet_I3", label: "mScarlet-I3", kind: "reporter" },
        { cassette: "T2A-mStayGold2", label: "mStayGold2", kind: "reporter" },
      ],
    },
    {
      id: "p2a",
      label: "P2A cleavable",
      help: "Reporter is expressed as a cleavable N-terminal module with P2A.",
      payloads: [
        { cassette: "P2A-mCherry", label: "mCherry", kind: "reporter" },
        { cassette: "P2A-mScarlet", label: "mScarlet", kind: "reporter" },
        { cassette: "P2A-mStayGold2", label: "mStayGold2", kind: "reporter" },
      ],
    },
  ],
  ct: [
    {
      id: "fusion",
      label: "Fusion / linker",
      help: "Tag is fused directly at the C-terminus with the built-in linker.",
      payloads: [
        { cassette: "dTAG-V5", label: "dTAG-V5", kind: "tag" },
        { cassette: "dTAG-HA", label: "dTAG-HA", kind: "tag" },
        { cassette: "SD40-V5", label: "SD40-V5", kind: "tag" },
        { cassette: "SD40-HA", label: "SD40-HA", kind: "tag" },
        { cassette: "SD40-GGGGS-V5", label: "SD40-GGGGS-V5 (spacer)", kind: "tag" },
        { cassette: "GGGGS3-SD40-GGGGS-V5", label: "(GGGGS)3-SD40-GGGGS-V5 (flexible)", kind: "tag" },
        { cassette: "miniIAA7-V5", label: "miniIAA7-V5", kind: "tag" },
        { cassette: "miniIAA7-HA", label: "miniIAA7-HA", kind: "tag" },
      ],
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
        { cassette: "miniIAA7-HA-P2A-HygroR", label: "miniIAA7-HA + HygroR", kind: "selection" },
      ],
    },
    {
      id: "t2a",
      label: "T2A cleavable",
      help: "Reporter is expressed as a cleavable C-terminal module with T2A.",
      payloads: [
        { cassette: "T2A-EGFP", label: "EGFP", kind: "reporter" },
        { cassette: "T2A-mScarlet_I3", label: "mScarlet-I3", kind: "reporter" },
        { cassette: "T2A-mStayGold2", label: "mStayGold2", kind: "reporter" },
      ],
    },
    {
      id: "p2a",
      label: "P2A cleavable",
      help: "Reporter is expressed as a cleavable C-terminal module with P2A.",
      payloads: [
        { cassette: "P2A-mCherry", label: "mCherry", kind: "reporter" },
        { cassette: "P2A-mScarlet", label: "mScarlet", kind: "reporter" },
        { cassette: "P2A-mStayGold2", label: "mStayGold2", kind: "reporter" },
      ],
    },
    {
      id: "tag_p2a_reporter",
      label: "Tag + P2A reporter",
      help: "C-terminal fusion tag followed by a cleavable P2A reporter.",
      payloads: [
        { cassette: "SD40-2xHA-P2A-mCherry", label: "SD40-2xHA + mCherry", kind: "combo" },
        { cassette: "dTAG-2xHA-P2A-mCherry", label: "dTAG-2xHA + mCherry", kind: "combo" },
        { cassette: "mAID-2xHA-P2A-mCherry", label: "mAID-2xHA + mCherry", kind: "combo" },
      ],
    },
  ],
};

const ORDER_READY_REPORTER_CASSETTES = {
  EGFP: {
    nt: ["N:EGFP-Linker", "T2A-EGFP"],
    ct: ["T2A-EGFP"],
  },
  mCherry: {
    nt: ["P2A-mCherry"],
    ct: ["P2A-mCherry"],
  },
  mScarlet: {
    nt: ["P2A-mScarlet"],
    ct: ["P2A-mScarlet"],
  },
  mScarlet_I3: {
    nt: ["T2A-mScarlet_I3"],
    ct: ["T2A-mScarlet_I3"],
  },
  mStayGold2: {
    nt: ["N:mStayGold2-Linker", "T2A-mStayGold2", "P2A-mStayGold2"],
    ct: ["T2A-mStayGold2", "P2A-mStayGold2"],
  },
};

const ORDER_READY_REPORTER_NAME_MAP = {
  egfp: "EGFP",
  mcherry: "mCherry",
  mscarlet: "mScarlet",
  mscarleti3: "mScarlet_I3",
  mstaygold2: "mStayGold2",
};

function sanitizeSegment(value, fallback) {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
  return clean || fallback;
}

function getCassetteDisplayLabel(option, projectType) {
  const display = CASSETTE_DISPLAY[option];
  if (display?.[projectType]) return display[projectType];
  return option.replace(/^N:/, "");
}

function normalizeReporterName(value) {
  return String(value || "").replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
}

function getOrderReadyReporterKey(name) {
  return ORDER_READY_REPORTER_NAME_MAP[normalizeReporterName(name)] || "";
}

function detectReporterMentionKey(text) {
  const normalized = normalizeReporterName(text);
  for (const [alias, key] of Object.entries(ORDER_READY_REPORTER_NAME_MAP)) {
    if (normalized.includes(alias)) return key;
  }
  return "";
}

function detectArchitectureHint(text) {
  const lower = String(text || "").toLowerCase();
  if (/\bp2a\b/.test(lower)) return "p2a";
  if (/\bt2a\b/.test(lower)) return "t2a";
  if (/\bfusion\b|\blink(?:er)?\b|\bdirect\b/.test(lower)) return "fusion";
  return "";
}

function resolveReporterCassette(reporterKey, projectType, architectureHint = "") {
  const options = (ORDER_READY_REPORTER_CASSETTES[reporterKey]?.[projectType] || []).filter((option) => CASSETTES[option]);
  if (!options.length) return "";
  if (!architectureHint) return options.length === 1 ? options[0] : "";
  if (architectureHint === "fusion") return options.find((option) => option.includes("Linker")) || "";
  if (architectureHint === "t2a") return options.find((option) => option.includes("T2A")) || "";
  if (architectureHint === "p2a") return options.find((option) => option.includes("P2A")) || "";
  return "";
}

function getReporterActionOptions(reporterName, projectType) {
  const key = getOrderReadyReporterKey(reporterName);
  if (!key) return [];
  return (ORDER_READY_REPORTER_CASSETTES[key]?.[projectType] || []).filter((option) => CASSETTES[option]);
}

function formatFpbaseReporterSummary(reporter) {
  const parts = [];
  if (reporter?.exMax && reporter?.emMax) parts.push(`Ex/Em ${reporter.exMax}/${reporter.emMax}`);
  if (reporter?.brightness) parts.push(`Brightness ${reporter.brightness}`);
  if (reporter?.agg) parts.push(`Agg ${reporter.agg}`);
  if (reporter?.organism) parts.push(String(reporter.organism));
  return parts.join(" • ");
}

function getConstructBuilderGroups(projectType) {
  return CONSTRUCT_BUILDER_OPTIONS[projectType] || [];
}

function resolveConstructBuilderSelection(tag, projectType) {
  const groups = getConstructBuilderGroups(projectType);
  for (const group of groups) {
    const payload = group.payloads.find((item) => item.cassette === tag);
    if (payload) return { architecture: group.id, cassette: payload.cassette };
  }
  const fallback = groups[0];
  return {
    architecture: fallback?.id || "",
    cassette: fallback?.payloads?.[0]?.cassette || tag || "",
  };
}

function getConstructBuilderPayloads(projectType, architecture) {
  return getConstructBuilderGroups(projectType).find((group) => group.id === architecture)?.payloads || [];
}

function getConstructBuilderHelp(projectType, architecture) {
  return getConstructBuilderGroups(projectType).find((group) => group.id === architecture)?.help || "";
}

function buildProjectFolderName(meta) {
  const gene = sanitizeSegment(meta.gene, "GENE");
  const edit = sanitizeSegment(meta.editSummary, "Genome edit");
  const cellLine = sanitizeSegment(meta.cellLine, "CELL-LINE");
  return `${gene} ${edit} in ${cellLine}`;
}

function buildWorkspaceProjectFolderName(row, result = null) {
  const explicit = sanitizeSegment(String(row?.projectFolderName || ""), "");
  if (explicit) return explicit;
  const irisId = sanitizeSegment(String(row?.irisId || ""), "");
  const parentId = sanitizeSegment(String(row?.clientId || ""), "");
  const requestedEdit = sanitizeSegment(String(row?.editSummary || row?.label || ""), "");
  if (irisId && requestedEdit) return `${irisId}${parentId ? ` (${parentId})` : ""} - ${requestedEdit}`;
  return buildProjectFolderName(buildRowMeta(row, result));
}

function extractIrisIdFromFolderName(name) {
  const match = String(name || "").match(/^(\d{3,})\b/);
  return match ? match[1] : "";
}

function extractParentIdFromFolderName(name) {
  const match = String(name || "").match(/^\d{3,}\s+\((\d{3,})\)/);
  return match ? match[1] : "";
}

function buildGuideRows(result) {
  return (result?.gs || []).map((guide) => [guide.n, `${guide.sp} ${guide.pm}`, `${guide.str} strand`, `${guide.gc}%`, guide.arm || guide.note || ""]);
}

function calculateGcPercent(sequence) {
  const clean = String(sequence || "").toUpperCase();
  if (!clean) return 0;
  const gcCount = [...clean].filter((base) => base === "G" || base === "C").length;
  return Math.round((gcCount / clean.length) * 100);
}

function reverseComplementLocal(sequence) {
  return String(sequence || "").split("").reverse().map((base) => DNA_COMPLEMENT[base] || "N").join("");
}

function parseGuideCutFromNote(note) {
  const match = String(note || "").match(/Cut at\s+(\d+)/i);
  return match ? parseInt(match[1], 10) - 1 : null;
}

function parseGuideExonNumber(note) {
  const match = String(note || "").match(/exon\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function findMatchingGuideCut(model, spacer, pam, preferredExonNumber = null, preferredCut = null) {
  const seq = getGenomicSequence(model);
  const cleanSpacer = String(spacer || "").toUpperCase();
  const cleanPam = String(pam || "").toUpperCase();
  if (!cleanSpacer || cleanSpacer.length !== 20 || !cleanPam || cleanPam.length !== 3) return null;

  const matches = [];
  for (let pos = 0; pos <= seq.length - 23; pos += 1) {
    const plusSpacer = seq.slice(pos, pos + 20).toUpperCase();
    const plusPam = seq.slice(pos + 20, pos + 23).toUpperCase();
    if (plusSpacer === cleanSpacer && plusPam === cleanPam) {
      const cut = pos + 17;
      const context = describeKoGenomicContextFromModel(model, cut);
      const exonMatch = context.label.match(/exon\s+(\d+)/i);
      matches.push({ cut, str: "+", context, exonNumber: exonMatch ? parseInt(exonMatch[1], 10) : null });
    }

    const minusPamWindow = seq.slice(pos, pos + 3).toUpperCase();
    const minusSpacerWindow = seq.slice(pos + 3, pos + 23).toUpperCase();
    if (reverseComplementLocal(minusSpacerWindow) === cleanSpacer && reverseComplementLocal(minusPamWindow) === cleanPam) {
      const cut = pos + 6;
      const context = describeKoGenomicContextFromModel(model, cut);
      const exonMatch = context.label.match(/exon\s+(\d+)/i);
      matches.push({ cut, str: "-", context, exonNumber: exonMatch ? parseInt(exonMatch[1], 10) : null });
    }
  }

  if (!matches.length) return null;
  matches.sort((left, right) => {
    const leftPreferredExon = preferredExonNumber && left.exonNumber === preferredExonNumber ? 0 : 1;
    const rightPreferredExon = preferredExonNumber && right.exonNumber === preferredExonNumber ? 0 : 1;
    if (leftPreferredExon !== rightPreferredExon) return leftPreferredExon - rightPreferredExon;
    const leftPreferredCut = Number.isFinite(preferredCut) ? Math.abs(left.cut - preferredCut) : Number.MAX_SAFE_INTEGER;
    const rightPreferredCut = Number.isFinite(preferredCut) ? Math.abs(right.cut - preferredCut) : Number.MAX_SAFE_INTEGER;
    if (leftPreferredCut !== rightPreferredCut) return leftPreferredCut - rightPreferredCut;
    return left.cut - right.cut;
  });
  return matches[0];
}

function scorePrimerSequenceLocal(primer) {
  const seq = String(primer || "").toUpperCase();
  if (!seq) return Number.MAX_SAFE_INTEGER;
  const gcCount = [...seq].filter((base) => base === "G" || base === "C").length;
  const gcPercent = (gcCount / seq.length) * 100;
  let score = Math.abs(gcPercent - 50);
  if (/(A{5,}|T{5,}|G{5,}|C{5,})/.test(seq)) score += 20;
  if (/AAAA|TTTT/.test(seq)) score += 6;
  const lastBase = seq[seq.length - 1];
  if (lastBase !== "G" && lastBase !== "C") score += 4;
  return score;
}

function pickCenteredPrimerPairLocal(seq, center, minAmpliconLength = 450, maxAmpliconLength = 500, primerLength = 24) {
  const minLength = Math.max(primerLength * 2, minAmpliconLength);
  const maxLength = Math.max(minLength, maxAmpliconLength);
  let best = null;
  for (let ampliconLength = minLength; ampliconLength <= maxLength; ampliconLength += 1) {
    const maxStart = Math.max(0, seq.length - ampliconLength);
    const idealStart = Math.round(center - ampliconLength / 2);
    for (const offset of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5]) {
      const ampliconStart = Math.max(0, Math.min(maxStart, idealStart + offset));
      const ampliconEnd = ampliconStart + ampliconLength;
      const forward = seq.slice(ampliconStart, ampliconStart + primerLength);
      const reverse = reverseComplementLocal(seq.slice(Math.max(0, ampliconEnd - primerLength), ampliconEnd));
      if (forward.length !== primerLength || reverse.length !== primerLength) continue;
      const ampliconCenter = ampliconStart + ampliconLength / 2;
      const centerPenalty = Math.abs(center - ampliconCenter);
      const score = centerPenalty * 3 + scorePrimerSequenceLocal(forward) + scorePrimerSequenceLocal(reverse) + Math.abs(ampliconLength - 475) * 0.2;
      if (!best || score < best.score) {
        best = { forward, reverse, ampliconLength, score };
      }
    }
  }
  if (best) return best;
  const fallbackLength = Math.max(primerLength * 2, Math.min(seq.length, 480));
  const maxStart = Math.max(0, seq.length - fallbackLength);
  const ampliconStart = Math.max(0, Math.min(maxStart, Math.round(center - fallbackLength / 2)));
  const ampliconEnd = Math.min(seq.length, ampliconStart + fallbackLength);
  return {
    forward: seq.slice(ampliconStart, ampliconStart + primerLength),
    reverse: reverseComplementLocal(seq.slice(Math.max(0, ampliconEnd - primerLength), ampliconEnd)),
    ampliconLength: ampliconEnd - ampliconStart,
  };
}

const KO_LONG_DELETION_THRESHOLD = 1000;
const KO_DELETION_SCREEN_FLANK = 250;

function pickDeletionScreenPrimerPairLocal(seq, leftCut, rightCut, flank = KO_DELETION_SCREEN_FLANK, primerLength = 24) {
  const maxStart = Math.max(0, seq.length - primerLength);
  const desiredForwardStart = Math.max(0, Math.min(maxStart, leftCut - flank));
  const desiredReverseStart = Math.max(0, Math.min(maxStart, rightCut + flank - primerLength));
  let best = null;
  for (let forwardOffset = -20; forwardOffset <= 20; forwardOffset += 1) {
    const forwardStart = Math.max(0, Math.min(maxStart, desiredForwardStart + forwardOffset));
    const forward = seq.slice(forwardStart, forwardStart + primerLength);
    if (forward.length !== primerLength) continue;
    for (let reverseOffset = -20; reverseOffset <= 20; reverseOffset += 1) {
      const reverseStart = Math.max(forwardStart + primerLength + 50, Math.min(maxStart, desiredReverseStart + reverseOffset));
      const reverse = reverseComplementLocal(seq.slice(reverseStart, reverseStart + primerLength));
      if (reverse.length !== primerLength) continue;
      const wtAmpliconLength = reverseStart + primerLength - forwardStart;
      const deletionAmpliconLength = Math.max(primerLength * 2, (leftCut - forwardStart) + ((reverseStart + primerLength) - rightCut));
      const leftFlankPenalty = Math.abs((leftCut - forwardStart) - flank);
      const rightFlankPenalty = Math.abs(((reverseStart + primerLength) - rightCut) - flank);
      const score = scorePrimerSequenceLocal(forward)
        + scorePrimerSequenceLocal(reverse)
        + leftFlankPenalty * 0.15
        + rightFlankPenalty * 0.15
        + Math.abs(deletionAmpliconLength - 500) * 0.2;
      if (!best || score < best.score) {
        best = { forward, reverse, wtAmpliconLength, deletionAmpliconLength, score };
      }
    }
  }
  if (best) return best;
  const forwardStart = desiredForwardStart;
  const reverseStart = Math.max(forwardStart + primerLength + 50, desiredReverseStart);
  return {
    forward: seq.slice(forwardStart, forwardStart + primerLength),
    reverse: reverseComplementLocal(seq.slice(reverseStart, reverseStart + primerLength)),
    wtAmpliconLength: reverseStart + primerLength - forwardStart,
    deletionAmpliconLength: Math.max(primerLength * 2, (leftCut - forwardStart) + ((reverseStart + primerLength) - rightCut)),
  };
}

function buildKoGuideDisplayNote(guide, context, pairSpacing, sourceDetail = "") {
  const sourcePrefix = sourceDetail ? `${sourceDetail} | ` : "";
  const spacingText = Number.isFinite(pairSpacing) ? ` | pair spacing ${pairSpacing} bp` : "";
  return `${sourcePrefix}Cut at ${guide.cut + 1}, ${context.label} (${context.detail})${spacingText}`;
}

function finalizeKoResultWithGuides(result, row, guides) {
  if (!result || result.type !== "ko") return result;
  let model = null;
  if (row?.referenceSource === "raw" && hasRawReference(row)) {
    model = normalizeRawSequenceToTranscriptModel({
      gene: row.gene || result.gene || "Unknown",
      sequence: parseRawSequenceInput(row.rawSequence),
      cdsStart: row.cdsStart,
      cdsEnd: row.cdsEnd,
      exons: parseExonCoordinateInput(row.exonCoordinates),
    });
  } else if (row?.gbRaw) {
    model = normalizeGenBankToTranscriptModel(parseGB(row.gbRaw));
  }
  if (!model) return finalizeReferenceOnlyKoResult(result, row, guides);
  const seq = getGenomicSequence(model);
  const currentGuides = [...(guides || [])];
  if (currentGuides.length < 2) return result;

  const mappedGuides = currentGuides.map((guide) => {
    const existingCut = Number.isFinite(guide.cut) ? guide.cut : parseGuideCutFromNote(guide.note || guide.arm);
    const preferredExon = parseGuideExonNumber(guide.note || guide.arm);
    const mapped = findMatchingGuideCut(model, guide.sp, guide.pm, preferredExon, existingCut);
    const cut = mapped?.cut ?? existingCut;
    const context = mapped?.context ?? (Number.isFinite(cut) ? describeKoGenomicContextFromModel(model, cut) : { label: "genomic context unresolved", detail: "position unavailable" });
    return {
      ...guide,
      str: mapped?.str || guide.str,
      cut,
      context,
      exonNumber: mapped?.exonNumber ?? preferredExon ?? null,
    };
  });

  const pairSpacing = mappedGuides.every((guide) => Number.isFinite(guide.cut))
    ? Math.abs(mappedGuides[1].cut - mappedGuides[0].cut)
    : null;

  const updatedGuides = mappedGuides.map((guide) => ({
    ...guide,
    note: buildKoGuideDisplayNote(guide, guide.context, pairSpacing, guide.referenceDetail || ""),
  }));

  const cutCenter = mappedGuides.filter((guide) => Number.isFinite(guide.cut)).length
    ? Math.round(mappedGuides.filter((guide) => Number.isFinite(guide.cut)).reduce((sum, guide) => sum + guide.cut, 0) / mappedGuides.filter((guide) => Number.isFinite(guide.cut)).length)
    : null;
  const sortedCuts = mappedGuides.map((guide) => guide.cut).filter(Number.isFinite).sort((left, right) => left - right);
  const longDeletion = sortedCuts.length === 2 && Number.isFinite(pairSpacing) && pairSpacing > KO_LONG_DELETION_THRESHOLD;
  const primerPairs = longDeletion
    ? designDeletionScreenPrimerPairs(seq, sortedCuts[0], sortedCuts[1], KO_DELETION_SCREEN_FLANK)
    : (Number.isFinite(cutCenter) ? designCenteredPrimerPairs(seq, cutCenter, { minAmp: 450, maxAmp: 500, desiredAmp: 475 }) : []);
  const primerPair = primerPairs[0] || null;

  const exonNumbers = [...new Set(mappedGuides.map((guide) => guide.exonNumber).filter(Number.isFinite))];
  let exonLabel = result.exon;
  if (exonNumbers.length === 1) {
    const exon = (model.exons || []).find((entry) => entry.exonNumber === exonNumbers[0]);
    if (exon) exonLabel = `Exon ${exon.exonNumber} (${exon.start + 1}-${exon.end}, ${exon.end - exon.start} bp)`;
  }

  return {
    ...result,
    exon: exonLabel,
    gs: updatedGuides,
    ps: primerPair ? [
      buildPrimerRecord(result.ps?.[0]?.n || "Fw", primerPair.fw.seq),
      buildPrimerRecord(result.ps?.[1]?.n || "Rev", primerPair.rev.seq),
    ] : result.ps,
    primerCandidates: primerPairs.length ? serializePrimerCandidatesLocal(primerPairs) : (result.primerCandidates || []),
    amp: primerPair
      ? (longDeletion
        ? `WT ~${primerPair.wtAmpliconLength} bp | deletion ~${primerPair.deletionAmpliconLength} bp`
        : `~${primerPair.amp} bp`)
      : result.amp,
    strat: longDeletion
      ? "NHEJ-mediated deletion using dual Cas9 guides. Screen with flanking junction PCR, then confirm the deletion by sequencing."
      : result.strat,
    primerStrategy: longDeletion ? "recommended-deletion-screen" : "recommended-centered",
  };
}

function finalizeReferenceOnlyKoResult(result, row, guides, sourceLabel = "Reference") {
  if (!result || result.type !== "ko") return result;
  const currentGuides = [...(guides || [])].slice(0, 2).map((guide, index) => {
    const exonNumber = parseGuideExonNumber(guide.note || guide.arm);
    const sourceDetail = guide.referenceDetail || `${sourceLabel} guide`;
    const note = `${sourceDetail} | Reference-only KO mode. Upload GenBank to calculate pair spacing and centered primers.`;
    return {
      ...guide,
      n: guide.n || `${buildSafeToken(result.gene || row?.gene || "GENE", "GENE")}_KO_gRNA${index + 1}`,
      gc: Number.isFinite(guide.gc) ? guide.gc : calculateGcPercent(guide.sp),
      exonNumber: Number.isFinite(exonNumber) ? exonNumber : null,
      note,
    };
  });
  const exonNumbers = [...new Set(currentGuides.map((guide) => guide.exonNumber).filter(Number.isFinite))];
  const exonLabel = exonNumbers.length === 1 ? `Reference exon shortlist: exon ${exonNumbers[0]}` : "Reference-only KO shortlist";
  return {
    ...result,
    gene: result.gene || row?.gene || "",
    exon: exonLabel,
    gs: currentGuides,
    ps: [],
    amp: "n/a",
    strat: `${sourceLabel} reference-guide shortlist; upload GenBank to calculate pair spacing and centered primers.`,
    referenceOnly: true,
  };
}

function updateKoResultWithMappedGuides(result, row, slotIndex, guideUpdater) {
  if (!result || result.type !== "ko" || !row?.gbRaw) return result;
  const currentGuides = [...(result.gs || [])];
  if (!currentGuides[slotIndex]) return result;
  const previousGuide = currentGuides[slotIndex];
  const preferredExonNumber = parseGuideExonNumber(previousGuide.note || previousGuide.arm);
  const preferredCut = Number.isFinite(previousGuide.cut) ? previousGuide.cut : parseGuideCutFromNote(previousGuide.note || previousGuide.arm);
  const replacement = guideUpdater(previousGuide, slotIndex, preferredExonNumber, preferredCut);
  if (!replacement) return result;
  currentGuides[slotIndex] = replacement;
  return finalizeKoResultWithGuides(result, row, currentGuides);
}

function buildBrunelloGuideOverride(guide, slotIndex, previousGuide) {
  return {
    ...previousGuide,
    n: previousGuide?.n || `gRNA${slotIndex + 1}`,
    sp: guide.spacer,
    pm: guide.pam || previousGuide?.pm || "",
    str: guide.strand || previousGuide?.str || "n/a",
    gc: calculateGcPercent(guide.spacer),
    d: Number.isFinite(previousGuide?.d) ? previousGuide.d : null,
    cut: Number.isFinite(guide.cutPosition) ? guide.cutPosition - 1 : (Number.isFinite(previousGuide?.cut) ? previousGuide.cut : null),
    referenceDetail: `Brunello reference guide | Rule Set 2 ${guide.ruleSet2}${guide.exon ? ` | Exon ${guide.exon}` : ""}${guide.transcript ? ` | ${guide.transcript}` : ""}`,
    note: `Brunello reference guide | Rule Set 2 ${guide.ruleSet2}${guide.exon ? ` | Exon ${guide.exon}` : ""}${guide.transcript ? ` | ${guide.transcript}` : ""}`,
  };
}

function buildCasDatabaseGuideOverride(target, slotIndex, previousGuide) {
  return {
    ...previousGuide,
    n: previousGuide?.n || `gRNA${slotIndex + 1}`,
    sp: target.spacer,
    pm: target.pam || previousGuide?.pm || "",
    str: target.strand || previousGuide?.str || "n/a",
    gc: calculateGcPercent(target.spacer),
    d: Number.isFinite(previousGuide?.d) ? previousGuide.d : null,
    cut: Number.isFinite(previousGuide?.cut) ? previousGuide.cut : null,
    referenceDetail: `Cas-Database reference guide | OOF ${Number(target.oofScore || 0).toFixed(2)} | off-targets ${Array.isArray(target.offTargetCounts) ? target.offTargetCounts.join("/") : "n/a"}${target.location ? ` | ${target.location}` : ""}`,
    note: `Cas-Database reference guide | OOF ${Number(target.oofScore || 0).toFixed(2)} | off-targets ${Array.isArray(target.offTargetCounts) ? target.offTargetCounts.join("/") : "n/a"}${target.location ? ` | ${target.location}` : ""}`,
  };
}

function buildReferenceOnlyKoDesignFromGuides(row, sourceLabel, guides, extra = {}) {
  if (!row?.gene || !Array.isArray(guides) || guides.length < 2) return { err: `No ${sourceLabel} guide pair was available for ${row?.gene || "this gene"}.` };
  const baseResult = {
    type: "ko",
    gene: normalizeGeneToken(row.gene),
    gs: [],
    ps: [],
    amp: "n/a",
    exon: "Reference-only KO shortlist",
    strat: `${sourceLabel} reference-guide shortlist; upload GenBank to calculate pair spacing and centered primers.`,
    referenceOnly: true,
    gb: { assembly: "" },
    dbg: "",
    ...extra,
  };
  return finalizeReferenceOnlyKoResult(baseResult, row, guides, sourceLabel);
}

async function fetchJsonOrThrow(url, endpointName) {
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${endpointName} endpoint returned HTML instead of JSON. Restart the dev server so the local API route is active.`);
  }
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || payload?.note || `${endpointName} lookup failed.`);
  return payload;
}

function buildKoPairLocationLabel(pairResult, exonNumbers = []) {
  const uniqueExons = [...new Set(exonNumbers.filter(Number.isFinite))];
  if (uniqueExons.length === 1 && pairResult?.exon) return pairResult.exon;
  if (uniqueExons.length >= 2) return `Exon ${uniqueExons[0]} -> Exon ${uniqueExons[uniqueExons.length - 1]}`;
  return pairResult?.exon || "Location unavailable";
}

function buildKoReferencePairDiagnostics(result, row, sourceGuides, overrideBuilder, sourceLabel) {
  if (!result || result.type !== "ko" || !Array.isArray(sourceGuides) || sourceGuides.length < 2) return { included: [], filtered: [] };
  const topGuides = sourceGuides.slice(0, 3);
  const hasLocalReference = hasSequenceBackedReference(row);
  const candidates = [];
  const filtered = [];
  for (let leftIndex = 0; leftIndex < topGuides.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < topGuides.length; rightIndex += 1) {
      const leftGuide = overrideBuilder(topGuides[leftIndex], 0, result.gs?.[0]);
      const rightGuide = overrideBuilder(topGuides[rightIndex], 1, result.gs?.[1]);
      const sourceExonNumbers = [leftGuide, rightGuide].map((guide) => parseGuideExonNumber(guide.note || guide.arm)).filter(Number.isFinite);
      const pairResult = hasLocalReference
        ? finalizeKoResultWithGuides(result, row, [leftGuide, rightGuide])
        : finalizeReferenceOnlyKoResult(result, row, [leftGuide, rightGuide], sourceLabel);
      if (!pairResult) continue;
      const guideCuts = (pairResult.gs || []).map((guide) => guide.cut).filter(Number.isFinite);
      const spacing = guideCuts.length === 2 ? Math.abs(guideCuts[1] - guideCuts[0]) : null;
      const exonNumbers = [...new Set((pairResult.gs || []).map((guide) => parseGuideExonNumber(guide.note || guide.arm)).filter(Number.isFinite))];
      const sameExon = exonNumbers.length === 1;
      const preferredSpacing = Number.isFinite(spacing) && spacing >= 40 && spacing <= 140;
      const candidateMode = !hasLocalReference
        ? "reference-only"
        : sameExon && preferredSpacing
          ? "nearby"
          : sameExon && Number.isFinite(spacing)
            ? "local"
          : Number.isFinite(spacing) && spacing > KO_LONG_DELETION_THRESHOLD
            ? "deletion-screen"
            : Number.isFinite(spacing) && !sameExon
              ? "cross-exon"
            : "unresolved";
      const exonLabel = buildKoPairLocationLabel(pairResult, exonNumbers);
      if (candidateMode === "unresolved") {
        let reason = "This pair did not survive remapping onto the selected reference.";
        if (!Number.isFinite(spacing)) {
          reason = "Could not remap both guides cleanly onto the selected reference.";
        } else if (!sameExon) {
          reason = `Guides remap to ${exonLabel}. Only same-exon local pairs or >${KO_LONG_DELETION_THRESHOLD} bp long-range deletions are shown.`;
        }
        filtered.push({
          id: `${sourceLabel}-${leftIndex + 1}-${rightIndex + 1}`,
          sourceIndexes: [leftIndex + 1, rightIndex + 1],
          spacing,
          exonLabel,
          reason,
        });
        continue;
      }
      candidates.push({
        id: `${sourceLabel}-${leftIndex + 1}-${rightIndex + 1}`,
        source: sourceLabel,
        sourceIndexes: [leftIndex + 1, rightIndex + 1],
        guides: [leftGuide, rightGuide],
        result: pairResult,
        spacing,
        sameExon,
        preferredSpacing,
        candidateMode,
        deletionSize: spacing,
        sourceSameExon: sourceExonNumbers.length === 2 && sourceExonNumbers[0] === sourceExonNumbers[1],
        sourceExonGap: sourceExonNumbers.length === 2 ? Math.abs(sourceExonNumbers[1] - sourceExonNumbers[0]) : Number.MAX_SAFE_INTEGER,
        exonLabel,
      });
    }
  }
  const included = candidates
    .sort((left, right) => {
      const modePriority = { nearby: 0, local: 1, "cross-exon": 2, "deletion-screen": 3, "reference-only": 4 };
      if ((modePriority[left.candidateMode] || 9) !== (modePriority[right.candidateMode] || 9)) return (modePriority[left.candidateMode] || 9) - (modePriority[right.candidateMode] || 9);
      if (left.candidateMode === "reference-only") {
        if (left.sourceSameExon !== right.sourceSameExon) return left.sourceSameExon ? -1 : 1;
        if (left.sourceExonGap !== right.sourceExonGap) return left.sourceExonGap - right.sourceExonGap;
      }
      const leftDistance = Number.isFinite(left.spacing) ? Math.abs(left.spacing - 90) : Number.MAX_SAFE_INTEGER;
      const rightDistance = Number.isFinite(right.spacing) ? Math.abs(right.spacing - 90) : Number.MAX_SAFE_INTEGER;
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return String(left.id).localeCompare(String(right.id));
    })
    .slice(0, 3);
  return { included, filtered };
}

function buildKoReferencePairCandidates(result, row, sourceGuides, overrideBuilder, sourceLabel) {
  return buildKoReferencePairDiagnostics(result, row, sourceGuides, overrideBuilder, sourceLabel).included;
}

// JSX only. The HTML equivalent lives in reportHtml.js, which must stay React-free.
function renderGuideSequence(spacer, pam) {
  return (
    <>
      <span style={{ fontFamily: "Consolas, monospace", fontWeight: 700, color: "#111827" }}>{spacer}</span>{" "}
      <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 999, background: "#FEF3C7", color: "#92400E", fontFamily: "Consolas, monospace", fontWeight: 800 }}>{pam}</span>
    </>
  );
}

function buildPrimerRows(result) {
  return (result?.ps || []).map((primer) => [
    primer.n,
    primer.s,
    primer.len ? `${primer.len} nt` : "n/a",
    Number.isFinite(primer.tm) ? `${primer.tm.toFixed(1)} C` : "n/a",
    Number.isFinite(primer.gc) ? `${primer.gc}%` : "n/a",
    Number.isFinite(primer.clamp) ? `${primer.clamp}/3` : "n/a",
  ]);
}

function PrimerQualityCard({ result }) {
  const summary = getPrimerQualitySummary(result);
  if (!summary) return null;
  const tone = summary.confidence === "high"
    ? { badge: "High confidence", color: COLORS.success, background: "#D1FAE5" }
    : summary.confidence === "medium"
      ? { badge: "Medium confidence", color: "#B54708", background: "#FEF0C7" }
      : { badge: "Needs review", color: "#B42318", background: "#FEE4E2" };
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>Primer QC</div>
        <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: tone.color, background: tone.background }}>
          {tone.badge}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 10 }}>
        <div style={{ padding: "8px 10px", borderRadius: 10, background: "#ffffff", border: "1px solid #E5E7EB" }}>Pair penalty: {summary.penalty}</div>
        <div style={{ padding: "8px 10px", borderRadius: 10, background: "#ffffff", border: "1px solid #E5E7EB" }}>Tm delta: {summary.tmDelta} C</div>
        <div style={{ padding: "8px 10px", borderRadius: 10, background: "#ffffff", border: "1px solid #E5E7EB" }}>Hetero-dimer run: {summary.heteroDimerRun} bp</div>
        <div style={{ padding: "8px 10px", borderRadius: 10, background: "#ffffff", border: "1px solid #E5E7EB" }}>3' hetero-dimer run: {summary.heteroThreePrimeRun} bp</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "#ffffff", border: "1px solid #E5E7EB" }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#111827", marginBottom: 4 }}>Forward primer</div>
          <div style={{ fontSize: 12, color: "#475467" }}>Penalty {summary.forward.penalty} | self-dimer {summary.forward.selfDimerRun} | hairpin {summary.forward.hairpinRun}</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "#ffffff", border: "1px solid #E5E7EB" }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#111827", marginBottom: 4 }}>Reverse primer</div>
          <div style={{ fontSize: 12, color: "#475467" }}>Penalty {summary.reverse.penalty} | self-dimer {summary.reverse.selfDimerRun} | hairpin {summary.reverse.hairpinRun}</div>
        </div>
      </div>
      {!!summary.warnings.length && (
        <div style={{ marginTop: 10, color: "#B42318", fontSize: 12, lineHeight: 1.5 }}>
          Warnings: {summary.warnings.join(" | ")}
        </div>
      )}
    </div>
  );
}

function serializePrimerCandidatesLocal(pairs = []) {
  return pairs.map((pair, index) => ({
    rank: index + 1,
    score: pair.score,
    ampliconLength: pair.amp ?? null,
    wtAmpliconLength: pair.wtAmpliconLength ?? null,
    deletionAmpliconLength: pair.deletionAmpliconLength ?? null,
    forward: buildPrimerRecord("Fw", pair.fw?.seq || pair.forward || ""),
    reverse: buildPrimerRecord("Rev", pair.rev?.seq || pair.reverse || ""),
  }));
}

function createBatchRow(index) {
  return {
    id: `batch-${index + 1}`,
    label: "",
    irisId: "",
    clientId: "",
    clientName: "",
    gene: "",
    cellLine: "",
    editSummary: "",
    projectFolderName: "",
    notes: "",
    deliveryMethod: "unknown",
    // Lab convention: two guides, and every donor carries blocking changes for both.
    coDelivery: true,
    maxBlockingChanges: "3",
    acceptWeakProtection: false,
    weakProtectionReason: "",
    acceptedBy: "",
    projectType: "pm",
    referenceSource: "genbank",
    requestedReporter: "",
    mutation: "",
    tag: APP_CONFIG.defaultTag,
    homologyArm: "",
    homologyArm3: "",
    donorFormat: "auto",
    autoTrimArms: true,
    customGuides: "",
    gbRaw: "",
    fileName: "",
    fetchQuery: "",
    fetchSource: "ensembl",
    fetchSpecies: "human",
    rawSequence: "",
    cdsStart: "",
    cdsEnd: "",
    exonCoordinates: "",
  };
}

function createPrimerToolState() {
  return {
    sourceType: "selected",
    sequenceName: "",
    gbRaw: "",
    fileName: "",
    rawSequence: "",
    primerNamePrefix: "Primer",
    mode: "centered",
    center: "",
    intervalStart: "",
    intervalEnd: "",
    leftCut: "",
    rightCut: "",
    minAmp: "450",
    maxAmp: "500",
    desiredAmp: "475",
    flank: "250",
  };
}

function cleanDnaSequence(value) {
  return String(value || "").toUpperCase().replace(/[^ACGTN]/g, "");
}

function resolvePrimerToolReference(primerTool, selectedEntry) {
  if (primerTool.sourceType === "selected") {
    const model = selectedEntry?.result?.gb || null;
    const sequence = cleanDnaSequence(getGenomicSequence(model));
    if (!sequence) return { err: "Choose a generated design with a loaded reference, or switch the primer tool to raw DNA or GenBank input." };
    return {
      sequence,
      sourceLabel: `Selected design reference${selectedEntry?.result?.gene ? `: ${selectedEntry.result.gene}` : ""}`,
      sequenceName: selectedEntry?.result?.gene || selectedEntry?.row?.gene || "Selected design",
    };
  }
  if (primerTool.sourceType === "genbank") {
    const parsed = parseGB(primerTool.gbRaw || "");
    const sequence = cleanDnaSequence(parsed?.seq || "");
    if (!sequence) return { err: "Upload a GenBank file with a readable DNA sequence first." };
    return {
      sequence,
      sourceLabel: `GenBank reference${primerTool.fileName ? `: ${primerTool.fileName}` : ""}`,
      sequenceName: primerTool.sequenceName || parsed?.gene || primerTool.fileName?.replace(/\.[^.]+$/, "") || "GenBank",
    };
  }
  const sequence = cleanDnaSequence(primerTool.rawSequence);
  if (!sequence) return { err: "Paste a DNA sequence first." };
  return {
    sequence,
    sourceLabel: primerTool.sequenceName ? `Raw DNA: ${primerTool.sequenceName}` : "Raw DNA sequence",
    sequenceName: primerTool.sequenceName || "RawDNA",
  };
}

function applyBatchRowChange(row, key, value, folderLibrary) {
  const nextRow = { ...row, [key]: value };
  if (key === "projectType") {
    if (value === "it") {
      nextRow.tag = INTERNAL_TAGS[row.tag] ? row.tag : "SPOT";
      nextRow.mutation = row.mutation && /^[A-Z]?\d+$/i.test(row.mutation) ? row.mutation : "";
    } else if (value === "ct") {
      nextRow.tag = CASSETTES[row.tag] && !row.tag.startsWith("N:") ? row.tag : "SD40-2xHA";
    } else if (value === "nt") {
      nextRow.tag = CASSETTES[row.tag] ? row.tag : "N:EGFP-Linker";
    } else {
      nextRow.tag = APP_CONFIG.defaultTag;
      if (value === "ko") nextRow.mutation = "";
    }
  }
  if (key === "gene" && nextRow.referenceSource !== "raw" && !nextRow.fileName && folderLibrary.byGene.has(normalizeGeneToken(value))) {
    const match = folderLibrary.byGene.get(normalizeGeneToken(value));
    nextRow.gbRaw = match.gbRaw;
    nextRow.fileName = match.fileName;
  }
  nextRow.parseIssue = summarizeRowParseIssue(nextRow);
  return nextRow;
}

function resizeBatchRows(rows, size) {
  const next = rows.slice(0, size);
  while (next.length < size) next.push(createBatchRow(next.length));
  return next;
}

function escapeDelimitedValue(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\t]/.test(stringValue)) return `"${stringValue.replace(/"/g, "\"\"")}"`;
  return stringValue;
}

function buildBatchOrderDelimited(rows, delimiter = ",") {
  const headers = ["Slot", "Design", "Gene", "Design Type", "Reference File", "Review Status", "Review Notes", "Item Type", "Name", "Sequence To Order", "Spacer", "PAM", "Strand", "Length", "Linked Guide", "Recommended", "Notes"];
  const lines = [headers.join(delimiter)];
  rows.forEach((row) => {
    lines.push([
      row.slot,
      row.designLabel,
      row.gene,
      row.designType,
      row.referenceFile,
      row.reviewStatus,
      row.reviewNotes,
      row.itemType,
      row.name,
      row.sequence,
      row.spacer,
      row.pam,
      row.strand,
      row.length,
      row.linkedGuide,
      row.recommended,
      row.notes,
    ].map(escapeDelimitedValue).join(delimiter));
  });
  return lines.join("\n");
}

function normalizeBatchProjectType(value) {
  const compact = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
  if (compact === "pm" || compact === "snp" || compact === "pointmutation" || compact === "pointmutations") return "pm";
  if (compact === "ko" || compact === "knockout" || compact === "knockouts") return "ko";
  if ((compact === "it" || compact === "internal" || compact === "internaltag" || compact === "internalinframetag" || compact === "inframe" || compact === "inframetag" || compact === "internalknockin")) return "it";
  if ((compact === "ct" || compact === "cterminal" || compact === "ctag" || compact === "cterminaltag")) return "ct";
  if ((compact === "nt" || compact === "nterminal" || compact === "ntag" || compact === "nterminaltag")) return "nt";
  return "";
}

function normalizeFileLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildFolderLibrary(entries) {
  const byName = new Map();
  const byStem = new Map();
  const byGene = new Map();
  entries.forEach((entry) => {
    const fileKey = normalizeFileLookupKey(entry.fileName);
    const stem = entry.fileName.replace(/\.[^.]+$/, "");
    const stemKey = normalizeFileLookupKey(stem);
    const geneKey = normalizeGeneToken(stem);
    if (fileKey && !byName.has(fileKey)) byName.set(fileKey, entry);
    if (stemKey && !byStem.has(stemKey)) byStem.set(stemKey, entry);
    if (geneKey && !byGene.has(geneKey)) byGene.set(geneKey, entry);
  });
  return { byName, byStem, byGene };
}

function detectCellLineToken(text) {
  const match = String(text || "").match(/\b[A-Za-z]{2,10}\d{3}-A(?:-[A-Za-z0-9]+)?\b/);
  return match ? match[0] : "";
}

function detectMutationToken(text) {
  const match = String(text || "").match(/\b([A-Za-z])\s*-?(\d+)\s*-?([A-Za-z])\b/);
  return match ? `${match[1].toUpperCase()}${match[2]}${match[3].toUpperCase()}` : "";
}

function detectInternalSiteToken(text) {
  const raw = String(text || "");
  const afterMatch = raw.match(/\bafter\s+([A-Za-z]\d+|\d+)\b/i);
  if (afterMatch) return afterMatch[1].toUpperCase();
  if (/\b(internal|in-frame|inframe)\b/i.test(raw)) {
    const inlineMatch = raw.match(/\b([A-Za-z]\d+|\d+)\b/i);
    if (inlineMatch) return inlineMatch[1].toUpperCase();
  }
  return "";
}

function detectProjectTypeFromText(text, mutation, internalSite, cassetteKey) {
  const lower = String(text || "").toLowerCase();
  if (/\b(ko|knockout)\b/.test(lower)) return "ko";
  if (/\b(internal|in-frame|inframe)\b/.test(lower)) return "it";
  if (/\b(c[\s-]?(?:term(?:inal|inus)?)|ct)\b/.test(lower)) return "ct";
  if (/\b(n[\s-]?(?:term(?:inal|inus)?)|nt)\b/.test(lower)) return "nt";
  if (internalSite && cassetteKey && INTERNAL_TAGS[cassetteKey]) return "it";
  if (cassetteKey?.startsWith("N:")) return "nt";
  if (cassetteKey) return "ct";
  if (mutation) return "pm";
  if (/^[A-Za-z0-9._-]+$/.test(String(text || "").trim())) return "ko";
  return "pm";
}

function detectCassetteKey(text, targetType = "") {
  const normalizedLine = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliasedKey = CASSETTE_ALIASES[normalizedLine];
  if (aliasedKey) return aliasedKey;
  if (targetType === "nt" || targetType === "ct") {
    const reporterKey = detectReporterMentionKey(text);
    const architectureHint = detectArchitectureHint(text);
    const reporterCassette = resolveReporterCassette(reporterKey, targetType, architectureHint);
    if (reporterCassette) return reporterCassette;
  }
  if (!targetType || targetType === "it") {
    const internalKeys = Object.keys(INTERNAL_TAGS).sort((a, b) => b.length - a.length);
    for (const key of internalKeys) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (normalizedLine.includes(normalizedKey)) return key;
    }
  }
  const keys = Object.keys(CASSETTES).sort((a, b) => b.length - a.length);
  const allowKeyForTarget = (key) => {
    if (!targetType) return true;
    if (targetType === "nt") return NT_CASSETTE_OPTIONS.includes(key);
    if (targetType === "ct") return CT_CASSETTE_OPTIONS.includes(key);
    return true;
  };
  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const bareKey = normalizedKey.replace(/^n/, "");
    if (normalizedLine.includes(normalizedKey)) {
      if (allowKeyForTarget(key)) return key;
    }
    if (targetType === "nt" && key.startsWith("N:") && normalizedLine.includes(bareKey)) return key;
    if (targetType === "ct" && CT_CASSETTE_OPTIONS.includes(key) && normalizedLine.includes(normalizedKey)) return key;
  }
  return "";
}

function detectGeneToken(text, cellLine, mutation, cassetteKey) {
  const raw = String(text || "").replace(/[,;]+/g, " ").trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const stopTokens = new Set([
    "ko", "knockout", "ct", "nt", "cterminal", "nterminal", "cterminus", "nterminus", "c-terminal", "n-terminal", "c-terminus", "n-terminus",
    "c", "n", "term", "terminal", "terminus", "in", "with", "internal", "inframe", "after",
    "make", "design", "create", "add", "insert", "generate", "build", "edit", "tag",
    "please", "help", "want", "need", "show", "draft", "use", "switch", "set",
    "i", "me", "my", "we", "us", "a", "an", "the", "to", "of", "for",
  ]);
  const mutationLower = mutation.toLowerCase();
  const cellLineLower = String(cellLine || "").toLowerCase();
  const cassettePieces = new Set(String(cassetteKey || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const reporterPieces = new Set(
    Object.keys(ORDER_READY_REPORTER_NAME_MAP)
      .concat(Object.values(ORDER_READY_REPORTER_NAME_MAP).map((value) => String(value).toLowerCase()))
      .concat(["egfp", "mcherry", "mscarlet", "mscarleti3", "mstaygold2"])
  );
  const isValidGeneToken = (value) => {
    const lower = value.toLowerCase();
    if (!/[a-z]/i.test(value)) return false;
    if (stopTokens.has(lower)) return false;
    if (cellLineLower && lower === cellLineLower) return false;
    if (mutation && lower === mutationLower) return false;
    if (cassettePieces.has(lower)) return false;
    if (reporterPieces.has(lower.replace(/[^a-z0-9]+/g, ""))) return false;
    return true;
  };
  const ofMatch = raw.match(/\bof\s+([A-Za-z0-9._-]+)\b/i);
  if (ofMatch) {
    const candidate = ofMatch[1];
    if (isValidGeneToken(candidate)) return normalizeGeneToken(candidate);
  }
  const token = tokens.find((value) => isValidGeneToken(value));
  return token ? normalizeGeneToken(token) : "";
}

function parseRequestLine(line, index, folderLibrary) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  const initialCassette = detectCassetteKey(trimmed);
  const mutation = detectMutationToken(trimmed);
  const internalSite = detectInternalSiteToken(trimmed);
  const projectType = detectProjectTypeFromText(trimmed, mutation, internalSite, initialCassette);
  const requestedReporter = (projectType === "ct" || projectType === "nt") ? detectReporterMentionKey(trimmed) : "";
  const cassetteKey = detectCassetteKey(trimmed, projectType) || ((projectType === "ct" || projectType === "nt" || projectType === "it") ? initialCassette : "");
  const cellLine = detectCellLineToken(trimmed);
  const gene = detectGeneToken(trimmed, cellLine, mutation, cassetteKey);
  const geneMatch = folderLibrary.byGene.get(gene);
  const fileEntry = geneMatch || null;
  const row = {
    ...createBatchRow(index),
    label: trimmed,
    editSummary: trimmed,
    gene,
    cellLine,
    projectType,
    requestedReporter,
    mutation: projectType === "pm" ? mutation : projectType === "it" ? internalSite : "",
    tag: projectType === "ct" || projectType === "nt"
      ? (cassetteKey || "")
      : projectType === "it"
        ? (cassetteKey || "SPOT")
        : APP_CONFIG.defaultTag,
    homologyArm: "",
    customGuides: "",
    gbRaw: fileEntry?.gbRaw || "",
    fileName: fileEntry?.fileName || "",
    parseIssue: "",
  };
  row.parseIssue = summarizeRowParseIssue(row, fileEntry);
  return row;
}

function parseRequestText(text, folderLibrary) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line, index) => parseRequestLine(line, index, folderLibrary))
    .filter(Boolean);
}

function formatProjectTypeLabel(projectType) {
  return PROJECT_TYPES.find((entry) => entry.id === projectType)?.label || "Unclassified design";
}
function detectInternalTagKey(text) {
  const lower = String(text || "").toLowerCase();
  return Object.keys(INTERNAL_TAGS).find((key) => lower.includes(key.toLowerCase())) || "";
}

function parseWorkspaceProjectFolderEntries(entries, folderLibrary) {
  return entries.map((entry, index) => {
    const title = String(entry.name || "").replace(/^\d{3,}(?:\s+\(\d{3,}\))?\s*-\s*/, "").trim();
    const parsed = parseRequestLine(title, index, folderLibrary) || createBatchRow(index);
    const nextRow = {
      ...parsed,
      irisId: entry.irisId || parsed.irisId,
      clientId: entry.parentId || parsed.clientId || "",
      label: title || parsed.label,
      editSummary: title || parsed.editSummary,
      projectFolderName: entry.name,
    };
    return {
      ...nextRow,
      parseIssue: summarizeRowParseIssue(nextRow),
    };
  });
}

function parseCustomGuideInput(value) {
  return String(value || "")
    .split(/\r?\n|,|;/)
    .map((entry) => entry.toUpperCase().replace(/[^ACGT]/g, ""))
    .filter(Boolean)
    .slice(0, 2);
}

function getRowSectionIssues(row) {
  const project = [];
  const reference = [];
  const design = [];

  if (!row?.gene) project.push("Enter a gene or locus.");
  if (!row?.cellLine && !(row?.projectType === "ko" && !hasSequenceBackedReference(row))) {
    project.push("Add a cell line for the final report.");
  }

  if (row?.referenceSource === "raw") {
    if (!parseRawSequenceInput(row?.rawSequence)) reference.push("Paste a genomic DNA sequence.");
    if (!row?.cdsStart || !row?.cdsEnd) reference.push("Provide CDS start and end coordinates.");
  } else if (!hasSequenceBackedReference(row) && row?.projectType !== "ko") {
    reference.push("Upload a GenBank file, fetch the gene, or switch to raw DNA input.");
  }

  if (row?.projectType === "ko" && !hasSequenceBackedReference(row) && !parseCustomGuideInput(row?.customGuides).length) {
    reference.push("Gene-only KO mode will suggest reference guides only. Upload a reference to generate recommended primers automatically.");
  }
  if (row?.projectType === "ko" && parseCustomGuideInput(row?.customGuides).length && !hasSequenceBackedReference(row)) {
    reference.push("Upload a reference before using custom knockout guides.");
  }

  if (row?.projectType === "pm" && !row?.mutation) design.push("Enter the requested mutation, for example R175H.");
  if (row?.projectType === "it" && !row?.mutation) design.push("Enter the internal insertion site, for example P155.");
  if (row?.projectType === "it" && !row?.tag) design.push("Choose an internal tag.");
  if ((row?.projectType === "ct" || row?.projectType === "nt") && !row?.tag) design.push("Choose a cassette.");

  return { project, reference, design };
}

function parseRawSequenceInput(value) {
  return String(value || "").toUpperCase().replace(/[^ACGT]/g, "");
}

function parseExonCoordinateInput(value) {
  return String(value || "")
    .split(/\r?\n|,|;/)
    .map((entry, index) => {
      const match = entry.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (!match) return null;
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return {
        start: start - 1,
        end,
        exonNumber: index + 1,
        label: `Exon ${index + 1}`,
      };
    })
    .filter(Boolean);
}

function hasRawReference(row) {
  return Boolean(parseRawSequenceInput(row?.rawSequence) && row?.cdsStart && row?.cdsEnd);
}

function hasSequenceBackedReference(row) {
  return row?.referenceSource === "raw"
    ? hasRawReference(row)
    : Boolean(row?.gbRaw || row?.fileName);
}

function summarizeRowParseIssue(row, fileEntryOverride = null) {
  const issues = [];
  if (!row?.gene) issues.push("gene");
  if (!row?.cellLine && !(row?.projectType === "ko" && !row?.gbRaw && !row?.fileName && !fileEntryOverride)) issues.push("cell line");
  if (row?.projectType === "pm" && !row?.mutation) issues.push("mutation");
  if (row?.projectType === "it" && !row?.mutation) issues.push("in-frame insert site");
  if (row?.projectType === "it" && !row?.tag) issues.push("internal tag");
  if ((row?.projectType === "ct" || row?.projectType === "nt") && !row?.tag) issues.push("cassette");
  const hasFile = Boolean(fileEntryOverride || row?.gbRaw || row?.fileName);
  const hasRawReferenceValue = hasRawReference(row);
  const hasCustomGuides = parseCustomGuideInput(row?.customGuides).length > 0;
  if (row?.referenceSource === "raw") {
    if (!parseRawSequenceInput(row?.rawSequence)) issues.push("DNA sequence");
    if (!row?.cdsStart || !row?.cdsEnd) issues.push("CDS coordinates");
  } else if (!hasFile && (row?.projectType !== "ko" || hasCustomGuides)) {
    issues.push("GenBank");
  }
  if (row?.projectType === "ko" && hasCustomGuides && !(hasFile || hasRawReferenceValue)) issues.push("reference sequence");
  return issues.length ? `Needs ${issues.join(", ")}` : "";
}

function parseInternalDefinitionSpec(value) {
  const text = String(value || "").trim();
  return {
    site: detectInternalSiteToken(text),
    tag: detectCassetteKey(text, "it"),
  };
}

function parseBatchDefinitionText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const definitions = [];
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split(line.includes("\t") ? "\t" : ",").map((cell) => cell.trim());
    const firstCell = cells[0]?.toLowerCase();
    if (index === 0 && (firstCell === "file" || firstCell === "filename" || firstCell === "genbank")) return;
    definitions.push({
      lineNumber: index + 1,
      fileToken: cells[0] || "",
      projectType: normalizeBatchProjectType(cells[1] || ""),
      modification: cells[2] || "",
      homologyArm: cells[3] || "",
      label: cells[4] || "",
    });
  });
  return definitions;
}

function buildIdtTemplateRows(orderRows, defaults) {
  const exportableRows = orderRows.filter((row) => row.reviewStatus !== "blocked");
  return {
    crispr: exportableRows
      .filter((row) => row.itemType === "gRNA")
      .map((row) => ({ Name: row.name, Sequence: row.sequence, Scale: defaults.crisprScale })),
    oligo: exportableRows
      .filter((row) => row.itemType === "Primer")
      .map((row) => ({ Name: row.name, Sequence: row.sequence, Scale: defaults.oligoScale, Purification: defaults.oligoPurification })),
    hdr: exportableRows
      .filter((row) => row.itemType === "Donor")
      .map((row) => ({ Name: row.name, Sequence: row.sequence, Scale: defaults.hdrScale, Modification: defaults.hdrModification })),
  };
}

let xlsxModulePromise = null;

async function loadXlsx() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx");
  }
  return xlsxModulePromise;
}

async function downloadXlsxTemplate(headers, rows, fileName) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, fileName);
}

async function downloadIdtWorkbook(kind, templateRows, filePrefix = "") {
  const config = {
    crispr: {
      headers: ["Name", "Sequence", "Scale"],
      rows: templateRows.crispr,
      fileName: `${filePrefix}template-paste-entry-crispr.xlsx`,
    },
    oligo: {
      headers: ["Name", "Sequence", "Scale", "Purification"],
      rows: templateRows.oligo,
      fileName: `${filePrefix}template-paste-entry.xlsx`,
    },
    hdr: {
      headers: ["Name", "Sequence", "Scale", "Modification"],
      rows: templateRows.hdr,
      fileName: `${filePrefix}template-paste-entry-hdr.xlsx`,
    },
  }[kind];
  if (!config?.rows?.length) return null;
  await downloadXlsxTemplate(config.headers, config.rows, config.fileName);
  return config.fileName;
}

async function buildIdtWorkbookFile(kind, templateRows, filePrefix = "") {
  const config = {
    crispr: {
      headers: ["Name", "Sequence", "Scale"],
      rows: templateRows.crispr,
      fileName: `${filePrefix}template-paste-entry-crispr.xlsx`,
    },
    oligo: {
      headers: ["Name", "Sequence", "Scale", "Purification"],
      rows: templateRows.oligo,
      fileName: `${filePrefix}template-paste-entry.xlsx`,
    },
    hdr: {
      headers: ["Name", "Sequence", "Scale", "Modification"],
      rows: templateRows.hdr,
      fileName: `${filePrefix}template-paste-entry-hdr.xlsx`,
    },
  }[kind];
  if (!config?.rows?.length) return null;
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([config.headers, ...config.rows.map((row) => config.headers.map((header) => row[header] ?? ""))]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  const blob = new Blob(
    [XLSX.write(workbook, { bookType: "xlsx", type: "array" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
  return { fileName: config.fileName, blob };
}

async function writeTextToDirectory(directoryHandle, fileName, content) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function writeBlobToDirectory(directoryHandle, fileName, blob) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function inferCasDatabaseOrganismId(result) {
  const assembly = String(result?.gb?.assembly || "").toLowerCase();
  if (assembly.includes("grcm") || assembly.includes("mm10") || assembly.includes("mouse")) return "6";
  if (assembly.includes("rnor") || assembly.includes("rat")) return "5";
  if (assembly.includes("grcz") || assembly.includes("zebrafish")) return "8";
  if (assembly.includes("sus") || assembly.includes("pig")) return "12";
  return "1";
}

function Badge({ children, color = COLORS.accent }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 9px", borderRadius: 999, fontSize: 13, fontWeight: 700, color, background: `${color}12`, border: `1px solid ${color}33` }}>{children}</span>;
}

function ActionButton({ children, onClick, variant = "secondary", disabled = false, style = {}, ...props }) {
  const variants = {
    primary: {
      background: "linear-gradient(135deg, #2dd4bf, #f59e0b)",
      color: "#07111c",
      border: "none",
      boxShadow: "0 12px 24px rgba(2, 8, 23, 0.16)",
    },
    secondary: {
      background: "#ffffff",
      color: "#111827",
      border: "1px solid #D0D5DD",
    },
    subtle: {
      background: "rgba(7,17,28,0.08)",
      color: "#334155",
      border: "1px solid rgba(148, 163, 184, 0.35)",
    },
    danger: {
      background: "#FEF3F2",
      color: "#B42318",
      border: "1px solid #FECDCA",
    },
    warm: {
      background: "#FFF7ED",
      color: "#9A3412",
      border: "1px solid #FDBA74",
    },
  };
  const resolved = variants[variant] || variants.secondary;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...FIELD_STYLE,
        width: "auto",
        minHeight: 42,
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        ...resolved,
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.2, color: COLORS.accent, marginBottom: 10 }}>{children}</div>;
}

function Grid({ children, style = {} }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, ...style }}>{children}</div>;
}

function QuickMetric({ label, value, tone = "default" }) {
  const toneColor = tone === "accent" ? COLORS.accent : tone === "warm" ? COLORS.accentAlt : tone === "success" ? COLORS.success : COLORS.text;
  return (
    <div
      style={{
        minWidth: 120,
        padding: "12px 14px",
        borderRadius: 14,
        border: `1px solid ${toneColor}33`,
        background: `linear-gradient(180deg, ${toneColor}12, rgba(255,255,255,0.96))`,
      }}
    >
      <div style={{ color: COLORS.muted, fontSize: 13, fontWeight: 700, letterSpacing: 0.1, marginBottom: 4 }}>{label}</div>
      <div style={{ color: toneColor, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function SummaryFieldCard({ label, value, monospace = false }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 14, border: "1px solid #D0D5DD", background: "#FCFCFD" }}>
      <div style={{ color: "#667085", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ color: "#111827", fontSize: 15, fontWeight: 700, lineHeight: 1.4, fontFamily: monospace ? "Consolas, monospace" : "inherit" }}>{value || "n/a"}</div>
    </div>
  );
}

function SummaryFieldGrid({ items, minWidth = 200, style = {} }) {
  if (!items?.length) return null;
  return <Grid style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`, ...style }}>{items.map((item) => <SummaryFieldCard key={item.label} label={item.label} value={item.value} monospace={item.monospace} />)}</Grid>;
}

function ReportSnapshotCard({ result }) {
  const items = buildReportSnapshotItems(result);
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Design snapshot</div>
      <Grid style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {items.map((item) => <QuickMetric key={item.label} label={item.label} value={item.value} tone={item.tone} />)}
      </Grid>
    </div>
  );
}

function GeneInfoCardGrid({ meta, result, fileName }) {
  const items = buildGeneInfoItems(meta, result, fileName);
  if (!items.length) return null;
  return <SummaryFieldGrid items={items} minWidth={210} style={{ marginBottom: 16 }} />;
}

function PrimerSummaryCardGrid({ result }) {
  const primers = buildPrimerSummaryItems(result);
  if (!primers.length) {
    return <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 14, border: "1px solid #D0D5DD", background: "#FCFCFD", color: "#475467", fontSize: 13 }}>No recommended primers were generated for this design.</div>;
  }
  return (
    <Grid style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 12 }}>
      {primers.map((primer) => (
        <div key={primer.name} style={{ padding: 14, borderRadius: 16, border: "1px solid #D0D5DD", background: "#FCFCFD" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{primer.name}</div>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background: "#EEF2FF", color: "#344054", fontSize: 11, fontWeight: 700 }}>{primer.length}</span>
          </div>
          <div style={{ padding: "10px 12px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4E7EC", fontFamily: "Consolas, monospace", fontSize: 13, lineHeight: 1.6, overflowWrap: "anywhere", marginBottom: 10 }}>
            {primer.sequence}
          </div>
          <Grid style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              ["Tm", primer.tm],
              ["GC", primer.gc],
              ["Clamp", primer.clamp],
            ].map(([label, value]) => <SummaryFieldCard key={`${primer.name}-${label}`} label={label} value={value} />)}
          </Grid>
        </div>
      ))}
    </Grid>
  );
}

function FormSection({ title, hint, children, tone = "default" }) {
  const accent = tone === "accent" ? COLORS.accent : tone === "warm" ? COLORS.accentAlt : COLORS.borderSoft;
  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${accent === COLORS.borderSoft ? COLORS.borderSoft : `${accent}44`}`,
        background: tone === "default" ? "#F8FAFC" : `linear-gradient(180deg, ${accent}10, rgba(255,255,255,0.96))`,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: accent === COLORS.borderSoft ? COLORS.text : accent, fontSize: 15, fontWeight: 800 }}>{title}</div>
        {hint && <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.55, marginTop: 4 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function TopLevelTabButton({ active, children, onClick, tone = "default" }) {
  const toneColor = tone === "accent" ? COLORS.accent : tone === "warm" ? COLORS.accentAlt : COLORS.text;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border: active ? `1px solid ${toneColor}66` : `1px solid ${COLORS.borderSoft}`,
        background: active ? `linear-gradient(180deg, ${toneColor}14, rgba(255,255,255,0.98))` : "#FFFFFF",
        color: active ? toneColor : "#344054",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: active ? "0 10px 24px rgba(15,23,42,0.08)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function InlineNotice({ children, tone = "info", style = {} }) {
  const palette = tone === "danger"
    ? { background: "#FEF3F2", border: "#FECDCA", color: "#B42318" }
    : tone === "warning"
      ? { background: "#FFF7ED", border: "#FDBA74", color: "#9A3412" }
      : tone === "success"
        ? { background: "#ECFDF3", border: "#ABEFC6", color: "#067647" }
        : { background: "#F8FAFC", border: "#D7DEE7", color: "#344054" };
  return (
    <div style={{ padding: 12, borderRadius: 12, background: palette.background, border: `1px solid ${palette.border}`, color: palette.color, fontSize: 13, lineHeight: 1.55, ...style }}>
      {children}
    </div>
  );
}

function FloatingNotice({ children, tone = "success" }) {
  const palette = tone === "danger"
    ? { background: "#7F1D1D", border: "#FCA5A5", color: "#FEF2F2" }
    : { background: "#064E3B", border: "#6EE7B7", color: "#ECFDF5" };
  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 1000,
        maxWidth: 420,
        padding: "12px 14px",
        borderRadius: 14,
        background: palette.background,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.5,
        boxShadow: "0 20px 40px rgba(2,8,23,0.28)",
      }}
    >
      {children}
    </div>
  );
}

function CollapsiblePanel({ title, summary, children, defaultOpen = false, tone = "neutral", style = {} }) {
  const palette = tone === "warm"
    ? { background: "#FFF7ED", border: "#FDBA74", color: "#9A3412", summary: "#7C2D12" }
    : { background: "#F8FAFC", border: "#D7DEE7", color: "#111827", summary: "#475467" };
  return (
    <details open={defaultOpen} style={{ marginBottom: 16, border: `1px solid ${palette.border}`, borderRadius: 14, background: palette.background, ...style }}>
      <summary style={{ cursor: "pointer", listStyle: "none", padding: "12px 14px", fontWeight: 800, color: palette.color }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span>{title}</span>
          {summary ? <span style={{ fontSize: 12, fontWeight: 600, color: palette.summary }}>{summary}</span> : null}
        </div>
      </summary>
      <div style={{ padding: "0 14px 14px 14px" }}>
        {children}
      </div>
    </details>
  );
}

function SequenceDiffRow({ label, sequence, diffIndexes, mode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {sequence.split("").map((base, index) => {
          const changed = diffIndexes.includes(index);
          return (
            <span
              key={`${label}-${index}`}
              style={{
                color: changed ? (mode === "wt" ? "#CC0000" : "#111827") : "#111827",
                background: changed && mode === "donor" ? "#FFF59D" : "transparent",
                textDecoration: changed && mode === "wt" ? "line-through" : "none",
                fontWeight: changed ? 800 : 400,
              }}
            >
              {base}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PmAnnotatedSequenceRow({ label, sequence, diffIndexes, mode, regions, guide, desiredIndexes = [], silentIndexes = [] }) {
  const diffSet = new Set(diffIndexes);
  const desiredSet = new Set(desiredIndexes);
  const silentSet = new Set(silentIndexes);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {(sequence || "").split("").map((base, index) => {
          const changed = diffSet.has(index);
          const isDesired = desiredSet.has(index);
          const isSilent = silentSet.has(index);
          const region = findPmRegion(index, regions);
          const inGuide = guide && index >= guide.siteStart && index < guide.siteEnd;
          const inPam = guide && index >= guide.pamStart && index < guide.pamEnd;
          return (
            <span
              key={`${label}-${index}`}
              style={{
                background: inPam ? PM_GUIDE_COLORS.pam : isSilent && mode === "donor" ? PM_EDIT_COLORS.silent : isDesired && mode === "donor" ? PM_EDIT_COLORS.desired : changed && mode === "donor" ? PM_EDIT_COLORS.desired : inGuide ? PM_GUIDE_COLORS.site : (region?.color || "transparent"),
                color: changed && mode === "wt" ? "#CC0000" : "#111827",
                textDecoration: changed && mode === "wt" ? "line-through" : "none",
                fontWeight: inGuide || changed ? 800 : 400,
              }}
            >
              {base}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function InternalSequenceRow({ label, sequence, guideSiteIndexes = [], guidePamIndexes = [], silentIndexes = [], annotations = [], mode = "donor" }) {
  const guideSet = new Set(guideSiteIndexes);
  const pamSet = new Set(guidePamIndexes);
  const silentSet = new Set(silentIndexes);
  const findAnnotation = (index) => annotations.filter((item) => index >= item.start && index < item.end).sort((left, right) => (right.priority || 0) - (left.priority || 0))[0];
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {(sequence || "").split("").map((base, index) => {
          const annotation = mode === "donor" ? findAnnotation(index) : null;
          return (
            <span
              key={`${label}-${index}`}
              title={annotation?.title || annotation?.label || ""}
              style={{
                background: pamSet.has(index) ? PM_GUIDE_COLORS.pam : silentSet.has(index) && mode === "donor" ? PM_EDIT_COLORS.silent : guideSet.has(index) ? PM_GUIDE_COLORS.site : annotation?.priority > 1 ? `${annotation.color}22` : "transparent",
                color: annotation?.color && mode === "donor" && !guideSet.has(index) && !pamSet.has(index) && !silentSet.has(index) ? annotation.color : "#111827",
                fontWeight: guideSet.has(index) || pamSet.has(index) || silentSet.has(index) || annotation ? 800 : 400,
              }}
            >
              {base}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function AlignedTokenRow({ label, prefix = "", tokens = [], suffix = "", diffIndexes = [], mode = "donor", tokenWidth = "4ch" }) {
  const changedSet = new Set(diffIndexes);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {prefix ? <span style={{ color: "#98A2B3" }}>{prefix}</span> : null}
        {tokens.map((token, index) => {
          const changed = changedSet.has(index);
          return (
            <span
              key={`${label}-${token}-${index}`}
              style={{
                display: "inline-block",
                minWidth: tokenWidth,
                marginRight: 6,
                textAlign: "center",
                color: changed ? (mode === "wt" ? "#CC0000" : "#111827") : "#111827",
                background: changed && mode === "donor" ? "#FFF59D" : "transparent",
                textDecoration: changed && mode === "wt" ? "line-through" : "none",
                fontWeight: changed ? 800 : 400,
              }}
            >
              {token}
            </span>
          );
        })}
        {suffix ? <span style={{ color: "#98A2B3" }}>{suffix}</span> : null}
      </div>
    </div>
  );
}

/**
 * The release verdict, at the top of the on-screen report.
 *
 * The report used to state no release status at all - only the downloaded HTML did - so the
 * screen a reviewer actually reads was the one place that never said "BLOCKED". Both
 * surfaces now render the same getReleaseVerdict object.
 */
function ReleaseVerdictPanel({ result }) {
  const verdict = useMemo(() => (result ? getReleaseVerdict(result) : null), [result]);
  if (!verdict) return null;
  const sections = getReleaseVerdictSections(verdict);
  return (
    <div style={{ margin: "0 0 18px 0", padding: "14px 16px", border: `2px solid ${verdict.border}`, borderLeftWidth: 8, borderRadius: 10, background: verdict.bg }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "#667085", textTransform: "uppercase" }}>Release status</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: verdict.fg, margin: "2px 0 6px 0" }}>{verdict.label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: "#344054" }}>{verdict.lead}</div>
      {sections.map((section) => (
        <div key={section.title} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: section.color, marginBottom: 4 }}>{section.title}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {section.items.map((item) => (
              <li key={item} style={{ fontSize: 13, lineHeight: 1.5, color: "#344054" }}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PmDonorPreview({ donor, releaseStatus = "ready" }) {
  const comparison = buildPmDonorComparison(donor);
  const strands = buildPmStrandModels(donor);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: "#2E75B6", marginBottom: 6 }}>{donor.n} ({donor.sl})</div>
      <div style={{ color: "#555", fontSize: 12, marginBottom: 10 }}>Linked guide: {donor.guideName}</div>
      <InlineNotice tone={donor.proteinValidation?.valid ? "success" : "warning"} style={{ marginBottom: 10 }}>
        {donor.proteinValidation?.valid
          ? `Final donor translation preserves the intended amino-acid product (${donor.proteinValidation.observedAa} at residue ${donor.proteinValidation.targetAaNumber}).`
          : `Final donor translation failed: ${(donor.proteinValidation?.errors || ["validation unavailable"]).join("; ")}`}
      </InlineNotice>
      {!!(donor.guideProtection || []).length && (
        <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "#F8FAFC", border: "1px solid #D0D5DD", fontSize: 12 }}>
          <strong>Protection against all offered guides:</strong>{" "}
          {donor.guideProtection.map((entry) => `${entry.guideName}: ${entry.tier} — ${entry.reason}`).join(" | ")}
        </div>
      )}
      {!!(donor.silentMutations || []).length && (
        <div style={{ color: "#7F1D1D", fontSize: 12, marginBottom: 10 }}>
          <strong>Silent mutation:</strong> {(donor.silentMutations || []).map((mutation) => `${mutation.lb}: ${mutation.oc} -> ${mutation.nc} | ${mutation.pur}`).join(" ; ")}
        </div>
      )}
      {strands.map((strand) => {
        const badge = getDonorStrandBadge(strand, releaseStatus);
        return (
        <div key={strand.key} style={{ marginBottom: 12, padding: 12, border: `1px solid ${badge.border}`, borderRadius: 12, background: badge.panel }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: "#1f2937" }}>{strand.title}</div>
            <Badge color={getDonorStrandBadgeColor(badge, COLORS)}>{badge.labelTitle}</Badge>
          </div>
          <div style={{ color: "#555", fontSize: 12, marginBottom: 8 }}>{strand.note}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {strand.regions.map((region) => <span key={`${strand.key}-${region.label}-${region.start}`} style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#1f2937", background: region.color }}>{region.label} ({region.end - region.start} nt)</span>)}
            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#1f2937", background: PM_GUIDE_COLORS.site }}>gRNA site</span>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#92400E", background: PM_GUIDE_COLORS.pam }}>PAM</span>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#92400E", background: PM_EDIT_COLORS.desired }}>Desired edit</span>
            {!!strand.silentIndexes?.length && <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#7F1D1D", background: PM_EDIT_COLORS.silent }}>Silent mutation</span>}
          </div>
          <PmAnnotatedSequenceRow label="WT" sequence={strand.wt} diffIndexes={strand.diffIndexes} mode="wt" regions={strand.regions} guide={strand.guide} desiredIndexes={strand.desiredIndexes} silentIndexes={strand.silentIndexes} />
          <PmAnnotatedSequenceRow label="Donor" sequence={strand.donor} diffIndexes={strand.diffIndexes} mode="donor" regions={strand.regions} guide={strand.guide} desiredIndexes={strand.desiredIndexes} silentIndexes={strand.silentIndexes} />
        </div>
      );
      })}
      <div style={{ marginTop: 10, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
        <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Coding frame view</div>
        <AlignedTokenRow label="WT codons" prefix={comparison.wt.prefix} tokens={comparison.wt.codons} suffix={comparison.wt.suffix} diffIndexes={comparison.diffCodonIndexes} mode="wt" />
        <AlignedTokenRow label="Donor codons" prefix={comparison.donor.prefix} tokens={comparison.donor.codons} suffix={comparison.donor.suffix} diffIndexes={comparison.diffCodonIndexes} mode="donor" />
        <AlignedTokenRow label="WT amino acids" tokens={comparison.wtAa} diffIndexes={comparison.diffAaIndexes} mode="wt" />
        <AlignedTokenRow label="Donor amino acids" tokens={comparison.donorAa} diffIndexes={comparison.diffAaIndexes} mode="donor" />
      </div>
    </div>
  );
}

function InternalProteinPreviewCard({ result }) {
  const preview = result?.codingPreview;
  if (!preview) return null;
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
      <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Coding frame view</div>
      <div style={{ color: "#555", fontSize: 12, marginBottom: 8 }}>Insert {result.tag} after {result.wA}{result.an}, before {result.nextAA}{result.an + 1}.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#92400E", background: "#FDE68A" }}>Inserted tag codons / amino acids</span>
      </div>
      <AlignedTokenRow label="WT codons" tokens={preview.wtCodons} />
      <AlignedTokenRow label="Donor codons" tokens={preview.donorCodons} diffIndexes={Array.from({ length: preview.insertCodonLength }, (_, index) => preview.insertCodonStart + index)} mode="donor" />
      <AlignedTokenRow label="WT amino acids" tokens={preview.wtAas} />
      <AlignedTokenRow label="Donor amino acids" tokens={preview.donorAas} diffIndexes={Array.from({ length: preview.insertAaLength }, (_, index) => preview.insertAaStart + index)} mode="donor" />
    </div>
  );
}

function InsertValidationCard({ validation }) {
  if (!validation) return null;
  const expectedAa = (validation.expectedAas || []).join("");
  const actualAa = (validation.actualAas || []).join("");
  const badges = [
    {
      label: validation.matchesPreset ? "Preset matches donor" : "Preset mismatch",
      color: validation.matchesPreset ? COLORS.success : "#B42318",
      background: validation.matchesPreset ? "#D1FAE5" : "#FEE4E2",
    },
    {
      label: validation.framePreserved ? "Reading frame preserved" : "Frame flagged",
      color: validation.framePreserved ? COLORS.success : "#B42318",
      background: validation.framePreserved ? "#D1FAE5" : "#FEE4E2",
    },
  ];
  if (validation.unexpectedStop || validation.terminalStopPresent) {
    badges.push({
      label: validation.unexpectedStop ? "Unexpected stop detected" : "Terminal stop retained",
      color: validation.unexpectedStop ? "#B42318" : "#92400E",
      background: validation.unexpectedStop ? "#FEE4E2" : "#FEF3C7",
    });
  }
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
      <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Insert identity check</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {badges.map((badge) => (
          <span key={badge.label} style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: badge.color, background: badge.background }}>
            {badge.label}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>Expected insert: {validation.expectedLengthBp} bp | Designed donor insert: {validation.actualLengthBp} bp</div>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>Expected insert DNA</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 8 }}>{validation.expectedSequence || "n/a"}</div>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>Designed donor insert DNA</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 8 }}>{validation.actualSequence || "n/a"}</div>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>Expected insert amino acids</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 8 }}>{expectedAa || "n/a"}</div>
      <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>Designed donor insert amino acids</div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{actualAa || "n/a"}</div>
      {(validation.canonicalChecks || []).map((check) => (
        <div key={check.label} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E5E7EB" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{check.label}</span>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: check.matches ? "#047857" : "#B42318", background: check.matches ? "#D1FAE5" : "#FEE4E2" }}>
              {check.matches ? "Protein matches reference" : "Protein mismatch"}
            </span>
          </div>
          {check.sourceUrl ? <div style={{ color: "#667085", fontSize: 11, marginBottom: 6 }}>Source: <a href={check.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#2E75B6", textDecoration: "none" }}>{check.sourceUrl}</a></div> : null}
          <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>Reference amino acids</div>
          <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 8 }}>{check.expectedAas || "n/a"}</div>
          <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>Designed amino acids</div>
          <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{check.actualAas || "n/a"}</div>
        </div>
      ))}
    </div>
  );
}

function KnockinQcSummaryCard({ result }) {
  const checks = buildKnockinQcChecks(result);
  if (!checks.length) return null;
  const styleFor = (status) => status === "pass"
    ? { color: COLORS.success, background: "#D1FAE5", label: "Pass" }
    : status === "warn"
      ? { color: "#B42318", background: "#FEE4E2", label: "Review" }
      : { color: "#475467", background: "#EAECF0", label: "N/A" };
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
      <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Knock-in QC summary</div>
      {checks.map((check, index) => {
        const badge = styleFor(check.status);
        return (
          <div key={`${check.label}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid #E5E7EB" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{check.label}</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{check.detail}</div>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: badge.color, background: badge.background }}>
              {badge.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DesignReadinessCard({ result }) {
  const checks = buildDesignReadinessChecks(result);
  if (!checks.length) return null;
  const styleFor = (status) => status === "pass"
    ? { color: COLORS.success, background: "#D1FAE5", label: "Pass" }
    : status === "warn"
      ? { color: "#B42318", background: "#FEE4E2", label: "Review" }
      : { color: "#475467", background: "#EAECF0", label: "N/A" };
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
      <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Design readiness</div>
      {checks.map((check, index) => {
        const badge = styleFor(check.status);
        return (
          <div key={`${check.label}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid #E5E7EB" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{check.label}</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{check.detail}</div>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: badge.color, background: badge.background }}>
              {badge.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const ARM_CHOICES = [30, 40, 50, 60, 100, 150, 200, 250, 300, 500, 750, 1000];

// Donor format and per-side arm controls for terminal-tag rows. "Default" follows the format picked
// (or the one recommended for the insert size when the format is Auto).
function DonorFormatControls({ row, onChange }) {
  const insertBp = getCassetteSequenceLength(row.tag, row.projectType);
  const recommended = recommendDonorFormat(insertBp);
  const chosen = !row.donorFormat || row.donorFormat === "auto" ? recommended.format : row.donorFormat;
  const defaults = defaultArms(chosen, insertBp);
  // A value that came from an imported request (for example 400) is kept selectable.
  const armOptionsFor = (current) => [...new Set([...ARM_CHOICES, ...(current && Number(current) > 0 ? [Number(current)] : [])])]
    .sort((a, b) => a - b).map((value) => <option key={value} value={String(value)}>{value} bp</option>);
  const labelStyle = { color: COLORS.muted, fontSize: 13, marginBottom: 6 };
  return (
    <div style={{ marginTop: 10 }}>
      <Grid>
        <label>
          <div style={labelStyle}>Donor format</div>
          <select value={row.donorFormat || "auto"} onChange={(event) => onChange("donorFormat", event.target.value)} style={SELECT_STYLE}>
            <option value="auto">Auto: {DONOR_FORMATS[recommended.format].short}{insertBp ? ` for ${insertBp} bp` : ""}</option>
            <option value="block">{DONOR_FORMATS.block.short}</option>
            <option value="ssodn">{DONOR_FORMATS.ssodn.short}</option>
            <option value="aav">{DONOR_FORMATS.aav.short}</option>
          </select>
        </label>
        <label>
          <div style={labelStyle}>5′ arm</div>
          <select value={row.homologyArm || ""} onChange={(event) => onChange("homologyArm", event.target.value)} style={SELECT_STYLE}>
            <option value="">Default ({defaults.five} bp)</option>
            {armOptionsFor(row.homologyArm)}
          </select>
        </label>
        <label>
          <div style={labelStyle}>3′ arm</div>
          <select value={row.homologyArm3 || ""} onChange={(event) => onChange("homologyArm3", event.target.value)} style={SELECT_STYLE}>
            <option value="">{row.homologyArm ? "Same as 5′ arm" : `Default (${defaults.three} bp)`}</option>
            {armOptionsFor(row.homologyArm3)}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "flex-end", gap: 8, color: COLORS.muted, fontSize: 13, paddingBottom: 8 }}>
          <input type="checkbox" checked={row.autoTrimArms !== false} onChange={(event) => onChange("autoTrimArms", event.target.checked)} />
          Shorten an arm that runs into a hard-to-synthesize stretch
        </label>
      </Grid>
      <div style={{ marginTop: 6, color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>{recommended.reason}</div>
    </div>
  );
}

// Donor format, arms, length limits and the synthesis pre-check for the finished donor.
function DonorFormatCard({ result }) {
  const [note, setNote] = useState("");
  const info = describeDonorFormat(result?.donorFormat);
  if (!info) return null;
  const warn = info.status === "warn";
  const orders = result.donorFormat.orderStrands?.length > 1
    ? result.donorFormat.orderStrands
    : (result.donorFormat.orderSequence ? [{ strand: result.donorFormat.orderStrand, sequence: result.donorFormat.orderSequence, guideNames: [] }] : []);
  const list = (items, color) => (items.length ? <ul style={{ margin: "4px 0 8px 18px", padding: 0, fontSize: 13, lineHeight: 1.5, color }}>{items.map((item) => <li key={item}>{item}</li>)}</ul> : null);
  const copyOrder = async (sequence, label) => {
    try {
      await navigator.clipboard.writeText(sequence);
      setNote(`${label} copied.`);
    } catch (copyError) {
      setNote(`Copy failed: ${copyError.message}`);
    }
  };
  return (
    <div style={{ marginBottom: 14, padding: 12, border: `1px solid ${warn ? "#f5c26b" : "#d7dee7"}`, borderRadius: 12, background: warn ? "#fffaf0" : "#f8fafc" }}>
      <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>{info.heading}</div>
      <table style={{ borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
        <tbody>
          {info.rows.map(([label, value]) => (
            <tr key={label}>
              <td style={{ padding: "3px 12px 3px 0", color: "#667085", whiteSpace: "nowrap", verticalAlign: "top" }}>{label}</td>
              <td style={{ padding: "3px 0" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list(info.problems, "#B42318")}
      {list(info.notes, "#344054")}
      <div style={{ fontSize: 13, color: "#344054" }}><b>Synthesis pre-check</b> <span style={{ color: "#667085" }}>({info.synthesisScope})</span></div>
      {list(info.synthesis, warn ? "#B54708" : "#344054")}
      {orders.map((entry, index) => {
        const label = orders.length > 1 ? `ssODN ${index + 1}` : "Sequence";
        return (
          <div key={entry.strand} style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#344054", marginBottom: 4 }}>
              <b>{orders.length > 1 ? `ssODN ${index + 1} to order` : "Sequence to order"} ({entry.strand} strand{entry.guideNames?.length ? ` for ${entry.guideNames.join(" and ")}` : ""}, 5′-3′, {entry.sequence.length} nt)</b>
              <button type="button" onClick={() => copyOrder(entry.sequence, label)} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700, padding: "4px 8px", fontSize: 12 }}>Copy</button>
              {index === orders.length - 1 && note && <span style={{ color: "#475467" }}>{note}</span>}
            </div>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "Consolas, monospace", fontSize: 12, background: "#ffffff", border: "1px solid #d7dee7", borderRadius: 8, padding: 8, margin: 0 }}>{entry.sequence}</pre>
          </div>
        );
      })}
    </div>
  );
}

// Publication-style design scheme drawn by designScheme.js. The markup comes from that module,
// which escapes every piece of text it emits, so it is safe to inject here.
function DesignSchemeCard({ result }) {
  const [note, setNote] = useState("");
  const inlineSvg = useMemo(() => buildDesignSchemeSvg(result, { responsive: true }), [result]);
  const fileSvg = useMemo(() => buildDesignSchemeSvg(result), [result]);
  const caption = useMemo(() => buildDesignSchemeCaption(result), [result]);
  if (!inlineSvg) return null;
  const fileName = buildDesignSchemeFilename(result);
  const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadSvg = () => {
    saveBlob(new Blob([fileSvg], { type: "image/svg+xml;charset=utf-8" }), fileName);
    setNote("SVG downloaded.");
  };
  const downloadPng = () => {
    const url = URL.createObjectURL(new Blob([fileSvg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const factor = 4;
      const canvas = document.createElement("canvas");
      canvas.width = image.width * factor;
      canvas.height = image.height * factor;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) { saveBlob(blob, fileName.replace(/\.svg$/, ".png")); setNote("PNG downloaded."); }
        else setNote("PNG export failed in this browser; use the SVG.");
      }, "image/png");
    };
    image.onerror = () => { URL.revokeObjectURL(url); setNote("PNG export failed in this browser; use the SVG."); };
    image.src = url;
  };
  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setNote("Figure legend copied.");
    } catch (copyError) {
      setNote(`Copy failed: ${copyError.message}`);
    }
  };
  const buttonStyle = { ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700, padding: "6px 10px", fontSize: 12 };
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#ffffff" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>Design scheme</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {note && <span style={{ fontSize: 12, color: "#475467" }}>{note}</span>}
          <button type="button" onClick={downloadSvg} style={buttonStyle}>Download SVG</button>
          <button type="button" onClick={downloadPng} style={buttonStyle}>Download PNG (4x)</button>
          {caption && <button type="button" onClick={copyCaption} style={buttonStyle}>Copy figure legend</button>}
        </div>
      </div>
      <div dangerouslySetInnerHTML={{ __html: inlineSvg }} />
      {caption && <p style={{ fontSize: 12, lineHeight: 1.5, color: "#344054", margin: "10px 0 0 0" }}><b>Suggested figure legend (draft; complete the bracketed fields):</b> {caption}</p>}
    </div>
  );
}

function LocusMapCard({ result }) {
  const window = normalizeLocusWindow(result);
  if (!window) return null;
  const structure = buildLocusStructureItems(result, window);
  const items = buildLocusMapItems(result, window);
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Target region map</div>
        <div style={{ fontSize: 12, color: "#555" }}>Showing {window.start + 1}-{window.end} on the uploaded reference sequence.</div>
      </div>
      <div style={{ fontSize: 11, color: "#667085", fontWeight: 700, marginBottom: 6 }}>Exon / intron structure</div>
      <div style={{ position: "relative", height: 18, borderRadius: 999, background: "#E5E7EB", overflow: "hidden", marginBottom: 10 }}>
        {structure.introns.map((item, index) => (
          <div
            key={`intron-${item.label}-${index}`}
            title={item.label}
            style={{
              position: "absolute",
              left: `${item.left}%`,
              width: `${item.width}%`,
              top: 7,
              height: 4,
              background: item.color,
              opacity: 0.9,
            }}
          />
        ))}
        {structure.exons.map((item, index) => (
          <div
            key={`exon-${item.label}-${index}`}
            title={item.label}
            style={{
              position: "absolute",
              left: `${item.left}%`,
              width: `${item.width}%`,
              top: 0,
              bottom: 0,
              background: item.color,
              borderRadius: 999,
              opacity: 0.85,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {structure.exons.map((item, index) => (
          <span key={`exon-badge-${item.label}-${index}`} style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: item.color, background: `${item.color}14`, border: `1px solid ${item.color}33` }}>
            {item.label}
          </span>
        ))}
        {structure.introns.map((item, index) => (
          <span key={`intron-badge-${item.label}-${index}`} style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: item.color, background: `${item.color}14`, border: `1px solid ${item.color}33` }}>
            {item.label}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#667085", fontWeight: 700, marginBottom: 6 }}>Guides, edits, donors, and primers</div>
      <div style={{ position: "relative", height: 14, borderRadius: 999, background: "#E5E7EB", overflow: "hidden", marginBottom: 14 }}>
        {items.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            title={`${item.label}${item.detail ? `: ${item.detail}` : ""}`}
            style={{
              position: "absolute",
              left: `${item.left}%`,
              width: `${item.width}%`,
              top: 0,
              bottom: 0,
              background: item.color,
              opacity: item.kind === "cut" ? 0.95 : 0.7,
            }}
          />
        ))}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item, index) => (
          <div key={`${item.label}-legend-${index}`} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#344054" }}>
            <span style={{ display: "inline-flex", width: 10, height: 10, borderRadius: 999, background: item.color, marginTop: 3, flex: "0 0 auto" }} />
            <span><strong>{item.label}</strong>{item.detail ? `: ${item.detail}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InternalDonorPreview({ donor, releaseStatus = "ready" }) {
  const strands = buildInternalStrandModels(donor);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: "#2E75B6", marginBottom: 6 }}>{donor.n} ({donor.sl})</div>
      <div style={{ color: "#555", fontSize: 12, marginBottom: 10 }}>Linked guide: {donor.guideName}</div>
      {!!(donor.guideProtection || []).length && (
        <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "#F8FAFC", border: "1px solid #D0D5DD", fontSize: 12 }}>
          <strong>Protection against all offered guides:</strong>{" "}
          {donor.guideProtection.map((entry) => `${entry.guideName}: ${entry.tier} — ${entry.reason}`).join(" | ")}
        </div>
      )}
      {!!(donor.silentMutations || []).length && (
        <div style={{ color: "#7F1D1D", fontSize: 12, marginBottom: 10 }}>
          <strong>Guide-blocking mutation:</strong> {(donor.silentMutations || []).map((mutation) => `${mutation.lb}: ${mutation.oc} -> ${mutation.nc} | ${mutation.pur}`).join(" ; ")}
        </div>
      )}
      {strands.map((strand) => {
        const badge = getDonorStrandBadge(strand, releaseStatus);
        return (
        <div key={strand.key} style={{ marginBottom: 12, padding: 12, border: `1px solid ${badge.border}`, borderRadius: 12, background: badge.panel }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: "#1f2937" }}>{strand.title}</div>
            <Badge color={getDonorStrandBadgeColor(badge, COLORS)}>{badge.labelTitle}</Badge>
          </div>
          <div style={{ color: "#555", fontSize: 12, marginBottom: 8 }}>{strand.note}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#1f2937", background: PM_GUIDE_COLORS.site }}>gRNA site</span>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#92400E", background: PM_GUIDE_COLORS.pam }}>PAM</span>
            {!!strand.silentIndexes?.length && <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#7F1D1D", background: PM_EDIT_COLORS.silent }}>Silent mutation</span>}
            {[...new Map((strand.annotations || []).map((item) => [`${item.badgeLabel || item.label}|${item.color}`, item])).values()].map((item) => <Badge key={`${item.badgeLabel || item.label}-${item.color}`} color={item.color}>{item.badgeLabel || item.label}</Badge>)}
          </div>
          <InternalSequenceRow label="WT context" sequence={strand.wt} guideSiteIndexes={strand.wtGuideSiteIndexes} guidePamIndexes={strand.wtGuidePamIndexes} mode="wt" />
          <InternalSequenceRow label="Donor ssODN" sequence={strand.donor} guideSiteIndexes={strand.guideSiteIndexes} guidePamIndexes={strand.guidePamIndexes} silentIndexes={strand.silentIndexes} annotations={strand.annotations} mode="donor" />
        </div>
      );
      })}
    </div>
  );
}

function KnockinProteinPreviewCard({ preview }) {
  if (!preview) return null;
  if (preview.wtCodons && preview.donorCodons && preview.wtAas && preview.donorAas) {
    return (
      <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
        <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Coding frame view</div>
        <div style={{ color: "#555", fontSize: 12, marginBottom: 8 }}>{preview.note}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#92400E", background: "#FDE68A" }}>Inserted tag / reporter codons and amino acids</span>
        </div>
        <AlignedTokenRow label="WT codons" tokens={preview.wtCodons} />
        <AlignedTokenRow label="Donor codons" tokens={preview.donorCodons} diffIndexes={Array.from({ length: preview.insertCodonLength }, (_, index) => preview.insertCodonStart + index)} mode="donor" />
        <AlignedTokenRow label="WT amino acids" tokens={preview.wtAas} />
        <AlignedTokenRow label="Donor amino acids" tokens={preview.donorAas} diffIndexes={Array.from({ length: preview.insertAaLength }, (_, index) => preview.insertAaStart + index)} mode="donor" />
      </div>
    );
  }
  const insertEnd = preview.insertStart + preview.insertLength;
  return (
    <div style={{ marginBottom: 14, padding: 12, border: "1px solid #d7dee7", borderRadius: 12, background: "#f8fafc" }}>
      <div style={{ color: "#667085", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Protein translation view</div>
      <div style={{ color: "#555", fontSize: 12, marginBottom: 8 }}>{preview.note}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#92400E", background: "#FDE68A" }}>Inserted tag / reporter</span>
      </div>
      <AlignedTokenRow label={preview.wtLabel} tokens={preview.wtTokens} />
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: "#667085", fontSize: 11, marginBottom: 4 }}>{preview.donorLabel}</div>
        <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {preview.donorTokens.map((token, index) => (
            <span
              key={`${preview.donorLabel}-${token}-${index}`}
              style={{
                display: "inline-block",
                minWidth: token === "Stop" ? "5ch" : "2ch",
                marginRight: 6,
                textAlign: "center",
                color: "#111827",
                background: index >= preview.insertStart && index < insertEnd ? "#FDE68A" : "transparent",
                fontWeight: index >= preview.insertStart && index < insertEnd ? 800 : 400,
                borderRadius: index >= preview.insertStart && index < insertEnd ? 3 : 0,
                padding: index >= preview.insertStart && index < insertEnd ? "0 2px" : 0,
              }}
            >
              {token}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnnotatedDonor({ sequence, annotations = [] }) {
  const findAnnotation = (index) => annotations.filter((item) => index >= item.start && index < item.end).sort((left, right) => (right.priority || 0) - (left.priority || 0))[0];
  const safeSequence = sequence || "";
  const legendItems = [...new Map(annotations.map((item) => [`${item.badgeLabel || item.label}|${item.color}`, item])).values()];
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {legendItems.map((item) => <span key={`${item.badgeLabel || item.label}-${item.color}`} title={item.title || item.label}><Badge color={item.color}>{item.badgeLabel || item.label}</Badge></span>)}
      </div>
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {safeSequence.split("").map((base, index) => {
          const annotation = findAnnotation(index);
          return <span key={`donor-${index}`} title={annotation?.title || annotation?.label || ""} style={{ color: annotation?.color || "#111827", fontWeight: annotation ? 700 : 400, background: annotation?.priority > 1 ? `${annotation.color}22` : "transparent" }}>{base}</span>;
        })}
      </div>
    </div>
  );
}

export default function AssuredDesignApp({
  embedded = false,
  onActiveDesignChange = null,
  hideMarketingHero = false,
} = {}) {
  const [copyState, setCopyState] = useState("");
  const [batchRows, setBatchRows] = useState(() => resizeBatchRows([], 1));
  const [batchResults, setBatchResults] = useState([]);
  const [batchError, setBatchError] = useState("");
  const [batchCopyState, setBatchCopyState] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [workspaceHandle, setWorkspaceHandle] = useState(null);
  const [workspaceFolders, setWorkspaceFolders] = useState([]);
  const [selectedWorkspaceFolders, setSelectedWorkspaceFolders] = useState([]);
  const [showWorkspaceTools, setShowWorkspaceTools] = useState(false);
  const [genomicReport, setGenomicReport] = useState(null);
  const [showGenomicReport, setShowGenomicReport] = useState(false);
  const [activeTab, setActiveTab] = useState("workspace");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [primerTool, setPrimerTool] = useState(() => createPrimerToolState());
  const [primerToolResult, setPrimerToolResult] = useState(null);
  const [primerToolError, setPrimerToolError] = useState("");
  const [batchFolderEntries, setBatchFolderEntries] = useState([]);
  const [requestText, setRequestText] = useState("");
  const [batchDefinitionText, setBatchDefinitionText] = useState("");
  const [idtDefaults, setIdtDefaults] = useState({
    crisprScale: "",
    oligoScale: "",
    oligoPurification: "",
    hdrScale: "",
    hdrModification: "",
  });
  const [batchKoReferenceMap, setBatchKoReferenceMap] = useState({});
  const [casDbOrganismId, setCasDbOrganismId] = useState("1");
  const [casDbLookup, setCasDbLookup] = useState({ status: "idle", gene: "", data: null, error: "" });
  const [brunelloLookup, setBrunelloLookup] = useState({ status: "idle", gene: "", data: null, error: "" });
  const [fpbaseLookup, setFpbaseLookup] = useState({ status: "idle", search: "", data: null, error: "" });
  const [fpbaseSearchInput, setFpbaseSearchInput] = useState("");
  const [fpbaseRowId, setFpbaseRowId] = useState("");

  const ctCassetteOptions = useMemo(() => CT_CASSETTE_OPTIONS.filter((key) => CASSETTES[key]), []);
  const ntCassetteOptions = useMemo(() => NT_CASSETTE_OPTIONS.filter((key) => CASSETTES[key]), []);
  const internalTagOptions = useMemo(() => Object.keys(INTERNAL_TAGS), []);
  const supportsWorkspaceAccess = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
  const batchSuccessfulResults = useMemo(() => batchResults.filter((entry) => entry.status === "success"), [batchResults]);
  const selectedEntry = useMemo(
    () => batchSuccessfulResults.find((entry) => entry.rowId === selectedProjectId) || batchSuccessfulResults[0] || null,
    [batchSuccessfulResults, selectedProjectId],
  );

  // When embedded in ASSURED Bench, keep Order / Trace Analysis / Reports in sync with the active design.
  useEffect(() => {
    if (!onActiveDesignChange) return;
    if (!selectedEntry?.result) {
      onActiveDesignChange(null);
      return;
    }
    onActiveDesignChange({
      result: selectedEntry.result,
      row: selectedEntry.row,
      meta: buildRowMeta(selectedEntry.row, selectedEntry.result),
      procurement: summarizeProcurementReadiness(selectedEntry.result),
    });
  }, [selectedEntry, onActiveDesignChange]);

  const selectedRowMeta = useMemo(() => buildRowMeta(selectedEntry?.row, selectedEntry?.result), [selectedEntry]);
  const folderName = useMemo(() => buildProjectFolderName(selectedRowMeta), [selectedRowMeta]);
  const historicalContext = useMemo(
    () => buildHistoricalContext(selectedRowMeta, selectedEntry?.result, selectedEntry?.row?.projectType),
    [selectedRowMeta, selectedEntry],
  );
  const hasHistoricalMatches = historicalContext.topMatches.length > 0;
  const brunelloReferenceGuideSet = useMemo(
    () => getBrunelloReferenceGuideSet(selectedEntry?.result, brunelloLookup.data),
    [selectedEntry, brunelloLookup.data],
  );
  const brunelloPairDiagnostics = useMemo(
    () => buildKoReferencePairDiagnostics(selectedEntry?.result, selectedEntry?.row, brunelloReferenceGuideSet?.guides, buildBrunelloGuideOverride, "Brunello"),
    [selectedEntry, brunelloReferenceGuideSet],
  );
  const casDatabasePairDiagnostics = useMemo(
    () => buildKoReferencePairDiagnostics(selectedEntry?.result, selectedEntry?.row, casDbLookup.data?.targets, buildCasDatabaseGuideOverride, "Cas-Database"),
    [selectedEntry, casDbLookup.data],
  );
  const brunelloPairCandidates = brunelloPairDiagnostics.included;
  const casDatabasePairCandidates = casDatabasePairDiagnostics.included;
  const brunelloFilteredPairs = brunelloPairDiagnostics.filtered;
  const casDatabaseFilteredPairs = casDatabasePairDiagnostics.filtered;
  const brunelloLocalCandidates = useMemo(() => brunelloPairCandidates.filter((candidate) => candidate.candidateMode === "nearby" || candidate.candidateMode === "local"), [brunelloPairCandidates]);
  const brunelloCrossExonCandidates = useMemo(() => brunelloPairCandidates.filter((candidate) => candidate.candidateMode === "cross-exon"), [brunelloPairCandidates]);
  const brunelloDeletionCandidates = useMemo(() => brunelloPairCandidates.filter((candidate) => candidate.candidateMode === "deletion-screen"), [brunelloPairCandidates]);
  const casDatabaseLocalCandidates = useMemo(() => casDatabasePairCandidates.filter((candidate) => candidate.candidateMode === "nearby" || candidate.candidateMode === "local"), [casDatabasePairCandidates]);
  const casDatabaseCrossExonCandidates = useMemo(() => casDatabasePairCandidates.filter((candidate) => candidate.candidateMode === "cross-exon"), [casDatabasePairCandidates]);
  const casDatabaseDeletionCandidates = useMemo(() => casDatabasePairCandidates.filter((candidate) => candidate.candidateMode === "deletion-screen"), [casDatabasePairCandidates]);
  const brunelloReviewOnlyCount = brunelloDeletionCandidates.length + brunelloCrossExonCandidates.length + brunelloFilteredPairs.length;
  const casDatabaseReviewOnlyCount = casDatabaseDeletionCandidates.length + casDatabaseCrossExonCandidates.length + casDatabaseFilteredPairs.length;
  const reviewSectionNumber = 5 + (hasHistoricalMatches ? 1 : 0);
  const additionalInfoSectionNumber = reviewSectionNumber + 1;
  const reviewItems = useMemo(
    () => buildReviewItems(selectedRowMeta, selectedEntry?.result, selectedEntry?.row?.fileName),
    [selectedRowMeta, selectedEntry],
  );
  const reportHtml = useMemo(
    () => buildReportHtml(selectedRowMeta, selectedEntry?.result, selectedEntry?.row?.fileName, historicalContext, reviewItems, brunelloLookup.data),
    [selectedRowMeta, selectedEntry, historicalContext, reviewItems, brunelloLookup.data],
  );
  const singleOrderRows = useMemo(() => {
    if (!selectedEntry?.result) return [];
    return buildBatchOrderRows([{
      slot: selectedEntry.slot,
      row: selectedEntry.row,
      status: "success",
      result: selectedEntry.result,
    }]);
  }, [selectedEntry]);
  const selectedProcurementReadiness = useMemo(
    () => selectedEntry?.result ? summarizeProcurementReadiness(selectedEntry.result) : null,
    [selectedEntry],
  );
  const batchOrderRows = useMemo(() => buildBatchOrderRows(batchSuccessfulResults), [batchSuccessfulResults]);
  const batchFolderLibrary = useMemo(() => buildFolderLibrary(batchFolderEntries), [batchFolderEntries]);
  const singleIdtTemplateRows = useMemo(() => buildIdtTemplateRows(singleOrderRows, idtDefaults), [singleOrderRows, idtDefaults]);
  const idtTemplateRows = useMemo(() => buildIdtTemplateRows(batchOrderRows, idtDefaults), [batchOrderRows, idtDefaults]);
  const batchDonorRows = useMemo(() => batchOrderRows.filter((row) => row.itemType === "Donor"), [batchOrderRows]);
  const procurementReadiness = useMemo(
    () => batchSuccessfulResults.map((entry) => ({ slot: entry.slot, ...summarizeProcurementReadiness(entry.result) })),
    [batchSuccessfulResults],
  );
  const procurementBlockedCount = procurementReadiness.filter((entry) => entry.status === "blocked").length;
  const procurementReviewCount = procurementReadiness.filter((entry) => entry.status === "review").length;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = APP_CONFIG.browserTitle;
    const updateMeta = (selector, content) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute("content", content);
    };
    updateMeta('meta[name="description"]', APP_CONFIG.metaDescription);
    updateMeta('meta[name="apple-mobile-web-app-title"]', APP_CONFIG.appName);
    updateMeta('meta[name="twitter:title"]', APP_CONFIG.browserTitle);
    updateMeta('meta[name="twitter:description"]', APP_CONFIG.socialDescription);
    updateMeta('meta[property="og:title"]', APP_CONFIG.browserTitle);
    updateMeta('meta[property="og:description"]', APP_CONFIG.socialDescription);
    updateMeta('meta[property="og:url"]', window.location.href);
    const canonicalNode = document.querySelector('link[rel="canonical"]');
    if (canonicalNode) canonicalNode.setAttribute("href", window.location.href);
  }, []);
  const currentHost = typeof window !== "undefined" ? window.location.host : "local";
  const showWorkspaceIntegration = typeof window !== "undefined"
    ? ["localhost", "127.0.0.1"].some((token) => window.location.hostname.includes(token))
    : true;

  const replaceSelectedKoGuide = useCallback((slotIndex, replacementGuide) => {
    if (!selectedEntry?.result || selectedEntry.result.type !== "ko") return;
    setBatchResults((current) => current.map((entry) => {
      if (entry.rowId !== selectedEntry.rowId || entry.status !== "success" || entry.result?.type !== "ko") return entry;
      const nextResult = updateKoResultWithMappedGuides(entry.result, entry.row, slotIndex, replacementGuide);
      if (!nextResult) return entry;
      return {
        ...entry,
        result: nextResult,
      };
    }));
    setCopyState(`Updated ${slotIndex === 0 ? "gRNA1" : "gRNA2"} and recalculated KO spacing and primers.`);
  }, [selectedEntry]);

  const applyBrunelloGuideToSelectedKo = useCallback((slotIndex, guide) => {
    replaceSelectedKoGuide(slotIndex, (previousGuide) => buildBrunelloGuideOverride(guide, slotIndex, previousGuide));
  }, [replaceSelectedKoGuide]);

  const applyCasDatabaseGuideToSelectedKo = useCallback((slotIndex, target) => {
    replaceSelectedKoGuide(slotIndex, (previousGuide) => buildCasDatabaseGuideOverride(target, slotIndex, previousGuide));
  }, [replaceSelectedKoGuide]);

  const applyKoGuidePairToSelected = useCallback((pairCandidate) => {
    if (!selectedEntry?.result || selectedEntry.result.type !== "ko" || !pairCandidate?.guides?.length) return;
    setBatchResults((current) => current.map((entry) => {
      if (entry.rowId !== selectedEntry.rowId || entry.status !== "success" || entry.result?.type !== "ko") return entry;
      const nextResult = finalizeKoResultWithGuides(entry.result, entry.row, pairCandidate.guides);
      if (!nextResult) return entry;
      return {
        ...entry,
        result: nextResult,
      };
    }));
    setCopyState(`Applied ${pairCandidate.source} pair and recalculated KO spacing and primers.`);
  }, [selectedEntry]);

  const applyKoGuidePairToRow = useCallback((rowId, pairCandidate) => {
    if (!pairCandidate?.guides?.length) return;
    setBatchResults((current) => current.map((entry) => {
      if (entry.rowId !== rowId || entry.status !== "success" || entry.result?.type !== "ko") return entry;
      const nextResult = finalizeKoResultWithGuides(entry.result, entry.row, pairCandidate.guides);
      if (!nextResult) return entry;
      return {
        ...entry,
        result: nextResult,
      };
    }));
    setSelectedProjectId(rowId);
    setCopyState(`Applied ${pairCandidate.source} pair and recalculated KO spacing and primers.`);
  }, []);

  const loadFpbaseReporters = useCallback(async (search = "") => {
    setFpbaseLookup({ status: "loading", search, data: null, error: "" });
    try {
      const data = await fetchJsonOrThrow(`/api/fpbase-reporters?search=${encodeURIComponent(search)}&limit=200`, "FPbase");
      setFpbaseLookup({ status: "success", search, data, error: "" });
    } catch (error) {
      setFpbaseLookup({ status: "error", search, data: null, error: error?.message || "FPbase lookup failed." });
    }
  }, []);

  const toggleFpbaseRow = useCallback((rowId) => {
    setFpbaseRowId((current) => current === rowId ? "" : rowId);
  }, []);

  const applyFpbaseReporterToRow = useCallback((rowIndex, cassetteKey) => {
    updateBatchRow(rowIndex, "tag", cassetteKey);
    setCopyState(`Selected ${getCassetteDisplayLabel(cassetteKey, batchRows[rowIndex]?.projectType || "ct")} from the FPbase order-ready reporter library.`);
  }, [batchRows]);

  useEffect(() => {
    if (!fpbaseRowId || fpbaseLookup.status !== "idle") return;
    loadFpbaseReporters("");
  }, [fpbaseRowId, fpbaseLookup.status, loadFpbaseReporters]);

  useEffect(() => {
    if (selectedEntry?.result?.type !== "ko" || !selectedEntry.result.gene) {
      setBrunelloLookup({ status: "idle", gene: selectedEntry?.result?.gene || "", data: null, error: "" });
      return;
    }
    let cancelled = false;
    setBrunelloLookup({ status: "loading", gene: selectedEntry.result.gene, data: null, error: "" });
    fetch(`/api/brunello?gene=${encodeURIComponent(selectedEntry.result.gene)}`)
      .then((response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error("Brunello endpoint returned HTML instead of JSON. Restart the dev server so the local API route is active.");
        }
        return response.json();
      })
      .then((data) => {
        if (!data?.ok) throw new Error(data?.error || data?.note || "Brunello lookup failed.");
        if (!cancelled) setBrunelloLookup({ status: "success", gene: selectedEntry.result.gene, data, error: "" });
      })
      .catch((error) => {
        if (!cancelled) setBrunelloLookup({ status: "error", gene: selectedEntry.result.gene, data: null, error: error?.message || "Brunello lookup failed." });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEntry?.rowId, selectedEntry?.result]);

  useEffect(() => {
    setCasDbOrganismId(inferCasDatabaseOrganismId(selectedEntry?.result));
    setCasDbLookup({ status: "idle", gene: selectedEntry?.result?.gene || "", data: null, error: "" });
  }, [selectedEntry?.rowId, selectedEntry?.result]);

  useEffect(() => {
    if (selectedEntry?.result?.type !== "ko" || !selectedEntry.result.gene) {
      setCasDbLookup({ status: "idle", gene: selectedEntry?.result?.gene || "", data: null, error: "" });
      return;
    }
    let cancelled = false;
    setCasDbLookup({ status: "loading", gene: selectedEntry.result.gene, data: null, error: "" });
    fetch(`/api/cas-database?gene=${encodeURIComponent(selectedEntry.result.gene)}&organism=${encodeURIComponent(casDbOrganismId)}`)
      .then((response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error("Cas-Database endpoint returned HTML instead of JSON. Restart the dev server so the local API route is active.");
        }
        return response.json().then((payload) => ({ response, payload }));
      })
      .then(({ response, payload }) => {
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Cas-Database lookup failed.");
        if (!cancelled) setCasDbLookup({ status: "success", gene: selectedEntry.result.gene, data: payload, error: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          setCasDbLookup({
            status: "error",
            gene: selectedEntry?.result?.gene || "",
            data: null,
            error: error?.message || "Cas-Database lookup failed unexpectedly.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [casDbOrganismId, selectedEntry?.rowId, selectedEntry?.result]);

  useEffect(() => {
    const koEntries = batchSuccessfulResults.filter((entry) => entry.result?.type === "ko" && entry.result?.gene);
    const activeIds = new Set(koEntries.map((entry) => entry.rowId));
    setBatchKoReferenceMap((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([rowId]) => activeIds.has(rowId)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    const entriesToFetch = koEntries.filter((entry) => {
      const cached = batchKoReferenceMap[entry.rowId];
      const organismId = inferCasDatabaseOrganismId(entry.result);
      if (!cached) return true;
      if (cached.status === "loading") return false;
      return cached.gene !== entry.result.gene || cached.organismId !== organismId;
    });
    if (!entriesToFetch.length) return undefined;
    let cancelled = false;
    entriesToFetch.forEach((entry) => {
      const organismId = inferCasDatabaseOrganismId(entry.result);
      setBatchKoReferenceMap((current) => ({
        ...current,
        [entry.rowId]: { status: "loading", gene: entry.result.gene, organismId, brunello: null, casDb: null, error: "" },
      }));
      Promise.allSettled([
        fetch(`/api/brunello?gene=${encodeURIComponent(entry.result.gene)}`).then(async (response) => {
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.toLowerCase().includes("application/json")) throw new Error("Brunello endpoint returned HTML instead of JSON.");
          const payload = await response.json();
          if (!payload?.ok) throw new Error(payload?.error || payload?.note || "Brunello lookup failed.");
          return payload;
        }),
        fetch(`/api/cas-database?gene=${encodeURIComponent(entry.result.gene)}&organism=${encodeURIComponent(organismId)}`).then(async (response) => {
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.toLowerCase().includes("application/json")) throw new Error("Cas-Database endpoint returned HTML instead of JSON.");
          const payload = await response.json();
          if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Cas-Database lookup failed.");
          return payload;
        }),
      ]).then(([brunelloResult, casDbResult]) => {
        if (cancelled) return;
        setBatchKoReferenceMap((current) => ({
          ...current,
          [entry.rowId]: {
            status: "success",
            gene: entry.result.gene,
            organismId,
            brunello: brunelloResult.status === "fulfilled" ? brunelloResult.value : null,
            casDb: casDbResult.status === "fulfilled" ? casDbResult.value : null,
            error: [
              brunelloResult.status === "rejected" ? brunelloResult.reason?.message : "",
              casDbResult.status === "rejected" ? casDbResult.reason?.message : "",
            ].filter(Boolean).join(" | "),
          },
        }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [batchSuccessfulResults, batchKoReferenceMap]);

  useEffect(() => {
    if (!batchSuccessfulResults.length) {
      if (selectedProjectId) setSelectedProjectId("");
      return;
    }
    if (!batchSuccessfulResults.some((entry) => entry.rowId === selectedProjectId)) {
      setSelectedProjectId(batchSuccessfulResults[0].rowId);
    }
  }, [batchSuccessfulResults, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    const loadWorkspaceFolders = async () => {
      if (!workspaceHandle) {
        setWorkspaceFolders([]);
        return;
      }
      try {
        const nextFolders = [];
        for await (const entry of workspaceHandle.values()) {
          if (entry.kind !== "directory") continue;
          if (entry.name === "Template" || entry.name === "Orders") continue;
          nextFolders.push({
            name: entry.name,
            irisId: extractIrisIdFromFolderName(entry.name),
            parentId: extractParentIdFromFolderName(entry.name),
          });
        }
        nextFolders.sort((left, right) => left.name.localeCompare(right.name));
        if (!cancelled) {
          setWorkspaceFolders(nextFolders);
          setSelectedWorkspaceFolders((current) => current.filter((name) => nextFolders.some((entry) => entry.name === name)));
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceFolders([]);
          setSelectedWorkspaceFolders([]);
          setWorkspaceStatus(error?.message || "Failed to read project folders from the selected root.");
        }
      }
    };
    loadWorkspaceFolders();
    return () => {
      cancelled = true;
    };
  }, [workspaceHandle]);

  useEffect(() => {
    if (!batchFolderEntries.length) return;
    setBatchRows((current) => current.map((row) => {
      if (row.referenceSource === "raw") return row;
      if (row.gbRaw && row.fileName) return row;
      const match = batchFolderLibrary.byGene.get(normalizeGeneToken(row.gene));
      if (!match) return row;
      const nextRow = {
        ...row,
        gbRaw: match.gbRaw,
        fileName: match.fileName,
      };
      return {
        ...nextRow,
        parseIssue: summarizeRowParseIssue(nextRow, match),
      };
    }));
  }, [batchFolderEntries, batchFolderLibrary]);

  const updateBatchRow = (index, key, value) => {
    setBatchRows((current) => current.map((row, rowIndex) => (
      rowIndex !== index ? row : applyBatchRowChange(row, key, value, batchFolderLibrary)
    )));
    setBatchResults([]);
    setBatchError("");
    setBatchCopyState("");
  };
  const updatePrimerTool = useCallback((key, value) => {
    setPrimerTool((current) => ({ ...current, [key]: value }));
    setPrimerToolResult(null);
    setPrimerToolError("");
  }, []);
  const setProjectCount = (nextSize) => {
    const parsed = Number(nextSize);
    const safeSize = Number.isFinite(parsed) ? Math.max(1, Math.min(48, Math.floor(parsed))) : 1;
    setBatchRows((current) => resizeBatchRows(current, safeSize));
    setBatchResults((current) => current.filter((entry) => entry.slot <= safeSize));
  };
  const resetWorkspace = useCallback((projectType = "pm") => {
    setRequestText("");
    setBatchRows([{ ...createBatchRow(0), projectType }]);
    setBatchResults([]);
    setBatchError("");
    setBatchCopyState("");
    setSelectedProjectId("");
    setActiveTab("workspace");
  }, []);
  const addProjectRow = () => setBatchRows((current) => resizeBatchRows(current, current.length + 1));
  const removeProjectRow = (index) => {
    setBatchRows((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      return next.map((row, rowIndex) => ({ ...row, id: `batch-${rowIndex + 1}` }));
    });
    setBatchResults([]);
  };
  const duplicateProjectRow = (index) => {
    setBatchRows((current) => {
      const source = current[index];
      if (!source) return current;
      const clone = { ...source, id: `batch-${current.length + 1}` };
      return [...current.slice(0, index + 1), clone, ...current.slice(index + 1)].map((row, rowIndex) => ({ ...row, id: `batch-${rowIndex + 1}` }));
    });
    setBatchResults([]);
  };
  const updateIdtDefault = (key, value) => setIdtDefaults((current) => ({ ...current, [key]: value }));

  const pickWorkspaceFolder = useCallback(async () => {
    if (!supportsWorkspaceAccess) {
      setWorkspaceStatus("This browser does not support direct project-folder access. Use Chrome or Edge.");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      setWorkspaceHandle(handle);
      setWorkspaceStatus(`Project root linked: ${handle.name}`);
    } catch (error) {
      if (error?.name !== "AbortError") setWorkspaceStatus(error?.message || "Failed to open project root picker.");
    }
  }, [supportsWorkspaceAccess]);

  const importWorkspaceProjects = useCallback(() => {
    if (!workspaceFolders.length) {
      setWorkspaceStatus("No project folders were detected in the linked project root.");
      return;
    }
    const targetFolders = selectedWorkspaceFolders.length
      ? workspaceFolders.filter((entry) => selectedWorkspaceFolders.includes(entry.name))
      : workspaceFolders;
    if (!targetFolders.length) {
      setWorkspaceStatus("Select at least one project folder to import.");
      return;
    }
    const importedRows = parseWorkspaceProjectFolderEntries(targetFolders, batchFolderLibrary);
    setBatchRows(resizeBatchRows(importedRows, Math.max(1, importedRows.length)));
    setBatchResults([]);
    setBatchError("");
    setBatchCopyState("");
    setWorkspaceStatus(`Imported ${importedRows.length} project folder${importedRows.length === 1 ? "" : "s"} into design rows.`);
  }, [batchFolderLibrary, selectedWorkspaceFolders, workspaceFolders]);

  const saveEntryToWorkspace = useCallback(async (entry) => {
    if (!workspaceHandle) throw new Error("Choose the project root first.");
    if (!entry?.result) throw new Error("Generate a design first.");
    const folderNameForEntry = buildWorkspaceProjectFolderName(entry.row, entry.result);
    const destinationHandle = await workspaceHandle.getDirectoryHandle(folderNameForEntry, { create: true });
    const projectPlanHandle = await destinationHandle.getDirectoryHandle("Project plan", { create: true });
    const summaryHandle = await destinationHandle.getDirectoryHandle("Summary", { create: true });
    const dataHandle = await destinationHandle.getDirectoryHandle("Data", { create: true });

    const entryMeta = buildRowMeta(entry.row, entry.result);
    const entryHistorical = buildHistoricalContext(entryMeta, entry.result, entry.row?.projectType);
    const entryReview = buildReviewItems(entryMeta, entry.result, entry.row?.fileName);
    const entryHtml = buildReportHtml(entryMeta, entry.result, entry.row?.fileName, entryHistorical, entryReview, brunelloLookup.data);
    const entrySummary = buildDesignSummary(entry.result);
    const entryOrderRows = buildBatchOrderRows([{ slot: entry.slot, row: entry.row, status: "success", result: entry.result }]);
    const entryTemplateRows = buildIdtTemplateRows(entryOrderRows, idtDefaults);
    const filePrefix = `${buildSafeToken(folderNameForEntry, "project")}_`;

    await writeTextToDirectory(projectPlanHandle, `${filePrefix}design_report.html`, entryHtml);
    await writeTextToDirectory(projectPlanHandle, `${filePrefix}design_summary.txt`, entrySummary);
    await writeTextToDirectory(summaryHandle, `${filePrefix}order_preview.csv`, buildBatchOrderDelimited(entryOrderRows));
    if (entry.row?.gbRaw) {
      await writeTextToDirectory(dataHandle, entry.row.fileName || `${filePrefix}reference.gb`, entry.row.gbRaw);
    }
    for (const kind of ["crispr", "oligo", "hdr"]) {
      const workbookFile = await buildIdtWorkbookFile(kind, entryTemplateRows, filePrefix);
      if (workbookFile) await writeBlobToDirectory(summaryHandle, workbookFile.fileName, workbookFile.blob);
    }
    return folderNameForEntry;
  }, [brunelloLookup.data, idtDefaults, workspaceHandle]);

  const saveSelectedToWorkspace = useCallback(async () => {
    try {
      const savedFolder = await saveEntryToWorkspace(selectedEntry);
      setWorkspaceStatus(`Saved the selected report and eligible procurement drafts into ${savedFolder}.`);
    } catch (error) {
      setWorkspaceStatus(error?.message || "Failed to save the selected project files.");
    }
  }, [saveEntryToWorkspace, selectedEntry]);

  const saveAllToWorkspace = useCallback(async () => {
    if (!batchSuccessfulResults.length) {
      setWorkspaceStatus("Generate at least one design first.");
      return;
    }
    try {
      for (const entry of batchSuccessfulResults) await saveEntryToWorkspace(entry);
      setWorkspaceStatus(`Saved ${batchSuccessfulResults.length} project package${batchSuccessfulResults.length === 1 ? "" : "s"} into the linked project folders.`);
    } catch (error) {
      setWorkspaceStatus(error?.message || "Failed to save one or more project packages.");
    }
  }, [batchSuccessfulResults, saveEntryToWorkspace]);

  const onBatchFile = useCallback((index, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBatchResults([]);
    setBatchError("");
    setBatchCopyState("");
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const content = readerEvent.target?.result || "";
      setBatchRows((current) => current.map((row, rowIndex) => (rowIndex === index ? {
        ...row,
        gbRaw: content,
        fileName: file.name,
        label: row.label || file.name.replace(/\.[^.]+$/, ""),
        gene: row.gene || file.name.replace(/\.[^.]+$/, ""),
        parseIssue: summarizeRowParseIssue({
          ...row,
          gbRaw: content,
          fileName: file.name,
          label: row.label || file.name.replace(/\.[^.]+$/, ""),
          gene: row.gene || file.name.replace(/\.[^.]+$/, ""),
        }),
      } : row)));
    };
    reader.onerror = () => setBatchError(`Failed to read ${file.name}.`);
    reader.readAsText(file);
  }, []);

  const [geneFetchState, setGeneFetchState] = useState({});
  const fetchRowGene = useCallback(async (index, query, source, species) => {
    setGeneFetchState((current) => ({ ...current, [index]: { status: "loading" } }));
    try {
      const result = await fetchGeneReference({ query, source, species });
      setBatchResults([]);
      setBatchError("");
      setBatchCopyState("");
      setBatchRows((current) => current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const next = { ...row, gbRaw: result.genbank, fileName: result.fileName, label: row.label || result.summary.gene, gene: row.gene || result.summary.gene };
        return { ...next, parseIssue: summarizeRowParseIssue(next) };
      }));
      setGeneFetchState((current) => ({ ...current, [index]: { status: "ok", summary: result.summary, fileName: result.fileName } }));
    } catch (error) {
      setGeneFetchState((current) => ({ ...current, [index]: { status: "error", message: error?.message || "The gene lookup failed." } }));
    }
  }, []);

  const onPrimerToolFile = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const content = readerEvent.target?.result || "";
      setPrimerTool((current) => ({
        ...current,
        sourceType: "genbank",
        gbRaw: content,
        fileName: file.name,
        sequenceName: current.sequenceName || file.name.replace(/\.[^.]+$/, ""),
      }));
      setPrimerToolResult(null);
      setPrimerToolError("");
    };
    reader.onerror = () => setPrimerToolError(`Failed to read ${file.name}.`);
    reader.readAsText(file);
  }, []);

  const runPrimerToolDesign = useCallback(() => {
    const reference = resolvePrimerToolReference(primerTool, selectedEntry);
    if (reference.err) {
      setPrimerToolError(reference.err);
      setPrimerToolResult(null);
      return;
    }
    const result = designPrimerTool(reference.sequence, {
      mode: primerTool.mode,
      center: primerTool.center,
      intervalStart: primerTool.intervalStart,
      intervalEnd: primerTool.intervalEnd,
      leftCut: primerTool.leftCut,
      rightCut: primerTool.rightCut,
      minAmp: primerTool.minAmp,
      maxAmp: primerTool.maxAmp,
      desiredAmp: primerTool.desiredAmp,
      flank: primerTool.flank,
      primerNamePrefix: (primerTool.primerNamePrefix || reference.sequenceName || "Primer").replace(/\s+/g, "_"),
    });
    if (result.err) {
      setPrimerToolError(result.err);
      setPrimerToolResult(null);
      return;
    }
    setPrimerToolError("");
    setPrimerToolResult({ ...result, sourceLabel: reference.sourceLabel });
  }, [primerTool, selectedEntry]);

  const applyPrimerToolToSelectedDesign = useCallback(() => {
    if (!selectedEntry?.rowId || !primerToolResult?.ps?.length) return;
    setBatchResults((current) => current.map((entry) => {
      if (entry.rowId !== selectedEntry.rowId || entry.status !== "success" || !entry.result) return entry;
      return {
        ...entry,
        result: {
          ...entry.result,
          ps: primerToolResult.ps,
          amp: primerToolResult.amp,
          primerCandidates: primerToolResult.primerCandidates || [],
          primerStrategy: `${primerToolResult.strategy} | ${primerToolResult.targetSummary}`,
        },
      };
    }));
    setBatchCopyState("Primer tool sequences applied to the selected design report and exports.");
    setActiveTab("report");
  }, [primerToolResult, selectedEntry]);

  const onBatchFolder = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
      const entries = await Promise.all(files
        .filter((file) => /\.(gb|gbk|genbank|txt)$/i.test(file.name))
        .map((file) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (readerEvent) => resolve({
            fileName: file.name,
            relativePath: file.webkitRelativePath || file.name,
            gbRaw: readerEvent.target?.result || "",
          });
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
          reader.readAsText(file);
        })));
      setBatchFolderEntries(entries);
      setBatchError("");
      setBatchCopyState("");
    } catch (folderError) {
      setBatchError(folderError?.message || "Folder import failed.");
    }
  }, []);

  const runBatch = async () => {
    setBatchError("");
    setBatchResults([]);
    setBatchCopyState("");
    const activeRows = batchRows.filter((row) => hasSequenceBackedReference(row) || (row.projectType === "ko" && row.gene && !parseCustomGuideInput(row.customGuides).length));
    if (!activeRows.length) {
      setBatchError("Add at least one usable reference sequence, or provide at least one knockout row with a gene name for gene-list KO mode.");
      return;
    }
    const nextResults = await Promise.all(batchRows.map(async (row, index) => {
      const slot = index + 1;
      if (!hasSequenceBackedReference(row) && !(row.projectType === "ko" && row.gene && !parseCustomGuideInput(row.customGuides).length)) return { slot, rowId: row.id, row, status: "empty" };
      try {
        if (row.projectType === "ko" && !hasSequenceBackedReference(row)) {
          if (parseCustomGuideInput(row.customGuides).length) {
            return {
              slot,
              rowId: row.id,
              row,
              status: "error",
              error: "Upload a GenBank file to use pasted custom knockout guides.",
              debug: "",
            };
          }
          const organismId = "1";
          const [brunello, casDb] = await Promise.allSettled([
            fetchJsonOrThrow(`/api/brunello?gene=${encodeURIComponent(row.gene)}`, "Brunello"),
            fetchJsonOrThrow(`/api/cas-database?gene=${encodeURIComponent(row.gene)}&organism=${encodeURIComponent(organismId)}`, "Cas-Database"),
          ]);
          const brunelloGuides = brunello.status === "fulfilled"
            ? brunello.value.guides.slice(0, 3)
            : [];
          const casDbGuides = casDb.status === "fulfilled"
            ? casDb.value.targets.slice(0, 3)
            : [];
          const referenceOnlySeedResult = { type: "ko", gene: normalizeGeneToken(row.gene), gs: [], ps: [], amp: "n/a", exon: "Reference-only KO shortlist", referenceOnly: true };
          const brunelloCandidates = brunelloGuides.length >= 2
            ? buildKoReferencePairCandidates(referenceOnlySeedResult, row, brunelloGuides, buildBrunelloGuideOverride, "Brunello")
            : [];
          const casDbCandidates = casDbGuides.length >= 2
            ? buildKoReferencePairCandidates(referenceOnlySeedResult, row, casDbGuides, buildCasDatabaseGuideOverride, "Cas-Database")
            : [];
          const primaryCandidate = brunelloCandidates[0] || casDbCandidates[0] || null;
          if (!primaryCandidate) {
            const errorParts = [
              brunello.status === "rejected" ? brunello.reason?.message : "",
              casDb.status === "rejected" ? casDb.reason?.message : "",
            ].filter(Boolean);
            return {
              slot,
              rowId: row.id,
              row,
              status: "error",
              error: errorParts[0] || `No Brunello or Cas-Database guide pair was available for ${row.gene}.`,
              debug: "",
            };
          }
          const referenceOnlyDesign = buildReferenceOnlyKoDesignFromGuides(
            row,
            primaryCandidate.source,
            primaryCandidate.guides,
            {
              referenceSources: {
                brunello: brunello.status === "fulfilled" ? brunello.value : null,
                casDb: casDb.status === "fulfilled" ? casDb.value : null,
              },
            },
          );
          if (referenceOnlyDesign.err) return { slot, rowId: row.id, row, status: "error", error: referenceOnlyDesign.err, debug: "" };
          return { slot, rowId: row.id, row, status: "success", result: referenceOnlyDesign, debug: "" };
        }
        const design = runDesign(row.projectType, row.gbRaw, row.mutation, row.tag, row.homologyArm, {
          customGuides: parseCustomGuideInput(row.customGuides),
          // Terminal-tag donors: format (auto picks by insert size), per-side arms and trimming of
          // an arm that runs into a hard-to-synthesize stretch. See donorFormat.js.
          donorFormat: row.donorFormat || "auto",
          arm3Length: row.homologyArm3 ? Number(row.homologyArm3) : undefined,
          autoTrimArms: row.autoTrimArms !== false,
          deliveryMethod: row.deliveryMethod || "unknown",
          // Co-transfecting both guides with both donors changes what a correct design is:
          // every donor has to block every guide, or the surviving guide re-cuts the allele
          // the other donor just repaired.
          coDeliveryBlocking: !!row.coDelivery,
          // A reviewed decision to order a pair whose guide is only weakly blocked. It
          // requires a reason, never overrides a mistranslating donor, and is not
          // honoured under co-delivery.
          // How many synonymous changes a guide may receive. Three is adequate protection
          // where the PAM cannot be destroyed; fewer means less donor editing, which can
          // matter more at a difficult locus.
          maxBlockingChanges: Number(row.maxBlockingChanges || 3),
          acceptWeakProtection: !!row.acceptWeakProtection,
          weakProtectionReason: row.weakProtectionReason || "",
          acceptedBy: row.acceptedBy || "",
          rawReference: row.referenceSource === "raw" ? {
            gene: row.gene,
            sequence: parseRawSequenceInput(row.rawSequence),
            cdsStart: row.cdsStart,
            cdsEnd: row.cdsEnd,
            exons: parseExonCoordinateInput(row.exonCoordinates),
          } : null,
        });
        if (design.err) return { slot, rowId: row.id, row, status: "error", error: design.err, debug: design.dbg || "" };
        return { slot, rowId: row.id, row, status: "success", result: design, debug: design.dbg || "" };
      } catch (runError) {
        return { slot, rowId: row.id, row, status: "error", error: runError?.message || "Design generation failed unexpectedly.", debug: "" };
      }
    }));
    setBatchResults(nextResults);
    if (nextResults.some((entry) => entry.status === "success")) {
      setShowGenomicReport(false);
      setActiveTab("report");
    } else {
      setBatchError("No batch designs were generated successfully.");
    }
  };

  const applyBatchDefinitions = () => {
    setBatchError("");
    setBatchResults([]);
    setBatchCopyState("");
    try {
      const definitions = parseBatchDefinitionText(batchDefinitionText);
      if (!definitions.length) {
        setBatchError("Paste at least one batch definition line.");
        return;
      }
      if (!batchFolderEntries.length) {
        setBatchError("Upload a folder of GenBank files first.");
        return;
      }

      const mappedRows = definitions.map((definition, index) => {
        if (!definition.fileToken) throw new Error(`Line ${definition.lineNumber}: missing file name.`);
        if (!definition.projectType) throw new Error(`Line ${definition.lineNumber}: design type must be ${APP_CONFIG.batchTypeHelp}.`);
        if (definition.projectType === "pm" && !definition.modification) throw new Error(`Line ${definition.lineNumber}: point mutation designs need a mutation such as N32R.`);
        if (definition.projectType === "it" && !definition.modification) throw new Error(`Line ${definition.lineNumber}: internal in-frame tag designs need a site and tag such as "after P155 SPOT".`);
        if ((definition.projectType === "ct" || definition.projectType === "nt") && !definition.modification) throw new Error(`Line ${definition.lineNumber}: insert designs need a cassette name such as SD40-2xHA.`);
        const lookupKey = normalizeFileLookupKey(definition.fileToken);
        const fileEntry = batchFolderLibrary.byName.get(lookupKey) || batchFolderLibrary.byStem.get(lookupKey);
        if (!fileEntry) throw new Error(`Line ${definition.lineNumber}: could not find GenBank file "${definition.fileToken}" in the uploaded folder.`);
        const internalSpec = definition.projectType === "it" ? parseInternalDefinitionSpec(definition.modification) : { site: "", tag: "" };
        if (definition.projectType === "it" && !internalSpec.site) throw new Error(`Line ${definition.lineNumber}: internal in-frame tag designs need a site such as P155.`);
        if (definition.projectType === "it" && !internalSpec.tag) throw new Error(`Line ${definition.lineNumber}: internal in-frame tag designs need a supported tag such as SPOT or alphaBtx.`);
        return {
          ...createBatchRow(index),
          label: definition.label || fileEntry.fileName.replace(/\.[^.]+$/, ""),
          projectType: definition.projectType,
          mutation: definition.projectType === "pm" ? definition.modification : definition.projectType === "it" ? internalSpec.site : "",
          tag: definition.projectType === "ct" || definition.projectType === "nt" ? definition.modification : definition.projectType === "it" ? internalSpec.tag : APP_CONFIG.defaultTag,
          homologyArm: definition.projectType === "ct" || definition.projectType === "nt" ? (definition.homologyArm || "") : "",
          gbRaw: fileEntry.gbRaw,
          fileName: fileEntry.fileName,
        };
      });

      setBatchRows(resizeBatchRows(mappedRows, Math.max(1, mappedRows.length)));
    } catch (definitionError) {
      setBatchError(definitionError?.message || "Failed to apply batch definitions.");
    }
  };

  const parseRequests = () => {
    setBatchError("");
    setBatchResults([]);
    setBatchCopyState("");
    const parsedRows = parseRequestText(requestText, batchFolderLibrary);
    if (!parsedRows.length) {
      setBatchError("Paste at least one request line to parse.");
      return;
    }
    setBatchRows(parsedRows);
  };

  const loadSampleRequests = () => {
    setRequestText(SAMPLE_REQUEST_TEXT);
    setBatchRows(parseRequestText(SAMPLE_REQUEST_TEXT, batchFolderLibrary));
    setBatchResults([]);
    setBatchError("");
    setBatchCopyState("");
  };

  const copyText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(`${label} copied.`);
    } catch (copyError) {
      setCopyState(`Copy failed: ${copyError.message}`);
    }
  };

  const downloadReport = () => {
    if (!reportHtml) return;
    const blob = new Blob([reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${folderName || "crispr_design_report"}.html`;
    link.click();
    URL.revokeObjectURL(url);
    setCopyState("HTML report downloaded.");
  };

  const downloadQcDesign = () => {
    const result = selectedEntry?.result;
    if (!result) return;
    const spec = buildQcDesignSpec(result);
    if (spec.err) {
      setCopyState(`QC design file not created: ${spec.err}`);
      return;
    }
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${folderName || "crispr_design"}.qc-design.json`;
    link.click();
    URL.revokeObjectURL(url);
    setCopyState("QC design file downloaded. Load it in the Assured QC app to check traces against this design.");
  };

  const downloadAllReports = () => {
    if (!batchSuccessfulResults.length) return;
    batchSuccessfulResults.forEach((entry, index) => {
      const entryMeta = buildRowMeta(entry.row, entry.result);
      const entryHistorical = buildHistoricalContext(entryMeta, entry.result, entry.row?.projectType);
      const entryReview = buildReviewItems(entryMeta, entry.result, entry.row?.fileName);
      const entryHtml = buildReportHtml(entryMeta, entry.result, entry.row?.fileName, entryHistorical, entryReview, brunelloLookup.data);
      const blob = new Blob([entryHtml], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${String(entry.slot).padStart(2, "0")}_${buildSafeToken(buildProjectFolderName(entryMeta), `design_${entry.slot}`)}.html`;
      window.setTimeout(() => {
        link.click();
        URL.revokeObjectURL(url);
      }, index * 150);
    });
    setCopyState(`Started download for ${batchSuccessfulResults.length} HTML reports.`);
  };

  const downloadIdtTemplate = async (kind) => {
    const fileName = await downloadIdtWorkbook(kind, idtTemplateRows);
    if (!fileName) return;
    setBatchCopyState(`Downloaded ${fileName}.`);
  };

  const downloadSingleIdtTemplate = async (kind) => {
    const filePrefix = `${buildSafeToken(selectedEntry?.result?.gene, "GENE")}_`;
    const fileName = await downloadIdtWorkbook(kind, singleIdtTemplateRows, filePrefix);
    if (!fileName) return;
    setCopyState(`Downloaded ${fileName}.`);
  };

  const readyRowCount = batchRows.filter((row) => !row.parseIssue && (row.projectType === "ko" ? (!!row.gene || hasSequenceBackedReference(row)) : hasSequenceBackedReference(row))).length;
  const reviewRowCount = Math.max(0, batchRows.length - readyRowCount);

  const showMarketingHero = !(hideMarketingHero || embedded);

  return (
    <div style={{ minHeight: embedded ? undefined : "100vh", background: `radial-gradient(circle at top left, rgba(15,118,110,0.08), transparent 24%), radial-gradient(circle at top right, rgba(180,83,9,0.08), transparent 22%), linear-gradient(180deg, #FDFEFE 0%, ${COLORS.bg} 38%)`, color: COLORS.text, fontFamily: '"Segoe UI", "Helvetica Neue", sans-serif' }}>
      <div style={{ width: embedded ? "100%" : "min(1560px, calc(100vw - 32px))", margin: "0 auto", padding: embedded ? "0 0 24px" : "20px 16px 40px" }}>
        {embedded && (
          <div style={{ ...CARD_STYLE, marginBottom: 14, padding: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", borderColor: selectedEntry?.result ? "#86EFAC" : COLORS.border }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{APP_CONFIG.appName} inside ASSURED Bench</div>
              <div style={{ color: COLORS.muted, fontSize: 13, marginTop: 4 }}>
                {selectedEntry?.result
                  ? `Active design ready for Bench Order / Trace Analysis: ${selectedEntry.result.gene || selectedEntry.row?.gene || "design"} (${selectedEntry.result.type}).`
                  : "Generate a design below. The selected successful result is handed to Bench Order and Trace Analysis automatically."}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <ActionButton variant="secondary" onClick={loadSampleRequests}>Load demo requests</ActionButton>
              <ActionButton variant="subtle" onClick={() => resetWorkspace("pm")}>Start blank workspace</ActionButton>
            </div>
          </div>
        )}
        {showMarketingHero ? (
        <div style={{ ...CARD_STYLE, marginBottom: 14, background: "linear-gradient(180deg, #F8FBFD, #EEF4F8)", border: "1px solid #D7DEE7", padding: 20, boxShadow: "0 24px 48px rgba(2, 8, 23, 0.12)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, alignItems: "stretch" }}>
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg, #2dd4bf, #f59e0b)", color: "#07111c", display: "grid", placeItems: "center", fontWeight: 900, boxShadow: "0 10px 22px rgba(0,0,0,0.18)" }}>AC</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.05, color: "#0F172A" }}>{APP_CONFIG.appName}</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 6, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(15, 23, 42, 0.08)", background: "#ffffff" }}>
                    <span style={{ color: "#0F766E", fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Created by</span>
                    <span style={{ width: 1, alignSelf: "stretch", background: "rgba(148,163,184,0.28)" }} />
                    <span style={{ color: "#0F172A", fontSize: 14, fontWeight: 700 }}>Narasimha Telugu</span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.08, maxWidth: 880, marginBottom: 10, color: "#0F172A" }}>
                {APP_CONFIG.heroHeadline}
              </div>
              <div style={{ color: "#475467", fontSize: 14, lineHeight: 1.6, maxWidth: 920, marginBottom: 14 }}>
                {APP_CONFIG.heroDescription}
              </div>
              <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                {[
                  "1. Start with one request or open a demo.",
                  "2. Add a gene and optional reference sequence.",
                  "3. Generate guides, primers, and the final report.",
                ].map((step) => (
                  <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, color: "#334155", fontSize: 13, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "#14B8A6", flex: "0 0 auto" }} />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {APP_CONFIG.heroBadges.map((item) => (
                  <div key={item} style={{ padding: "7px 11px", borderRadius: 999, border: "1px solid #D7DEE7", background: "#ffffff", color: "#334155", fontSize: 12, fontWeight: 700 }}>
                    {item}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <ActionButton variant="primary" onClick={() => resetWorkspace("pm")}>
                  Start blank workspace
                </ActionButton>
                <ActionButton variant="secondary" onClick={loadSampleRequests}>
                  Load demo requests
                </ActionButton>
                <ActionButton variant="subtle" onClick={() => document.getElementById("design-requests")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  Jump to design requests
                </ActionButton>
              </div>
            </div>
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <div style={{ padding: 16, borderRadius: 16, background: "#ffffff", border: "1px solid #D7DEE7" }}>
                <div style={{ color: "#111827", fontSize: 14, fontWeight: 800, lineHeight: 1.4, marginBottom: 6 }}>
                  What this tool is best at
                </div>
                <div style={{ color: "#475467", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                  {APP_CONFIG.valueBlurb}
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    "Use one row per edit request.",
                    "Upload a reference only when you want sequence-backed design and primers.",
                    "Review one final report at a time after generation.",
                  ].map((item) => (
                    <div key={item} style={{ padding: "10px 12px", borderRadius: 12, background: "#F8FAFC", border: "1px solid #E4E7EC", color: "#344054", fontSize: 13, lineHeight: 1.5 }}>
                      {item}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  <a
                    href={REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", background: "#ffffff", color: "#111827", borderColor: "#D0D5DD" }}
                  >
                    View repository
                  </a>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <QuickMetric label="Design rows" value={batchRows.length} tone="accent" />
                <QuickMetric label="Ready now" value={readyRowCount} tone="success" />
                <QuickMetric label="GenBank files" value={batchFolderEntries.length} tone="warm" />
              </div>
            </div>
          </div>
        </div>
        ) : null}
        {showWorkspaceIntegration && (
        <div style={{ ...CARD_STYLE, marginTop: 8, marginBottom: 14, padding: 12, background: "linear-gradient(180deg, #FFFFFF, #F8FAFC)", border: `1px solid ${COLORS.borderSoft}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Advanced: workspace integration</div>
              <div style={{ color: COLORS.muted, fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>
                Use this only if you want to import local project folders and save generated files back into those folders.
              </div>
            </div>
            <button type="button" onClick={() => setShowWorkspaceTools((current) => !current)} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700 }}>
              {showWorkspaceTools ? "Hide workspace tools" : "Show workspace tools"}
            </button>
          </div>
          {showWorkspaceTools && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14, marginBottom: 12 }}>
                <button type="button" onClick={pickWorkspaceFolder} disabled={!supportsWorkspaceAccess} style={{ ...FIELD_STYLE, width: "auto", cursor: supportsWorkspaceAccess ? "pointer" : "not-allowed", fontWeight: 700 }}>
                  Choose project root
                </button>
                <button type="button" onClick={importWorkspaceProjects} disabled={!workspaceFolders.length} style={{ ...FIELD_STYLE, width: "auto", cursor: workspaceFolders.length ? "pointer" : "not-allowed", fontWeight: 700 }}>
                  Import project folders as rows
                </button>
                <button
                  type="button"
                  onClick={saveSelectedToWorkspace}
                  disabled={!workspaceHandle || !selectedEntry?.result}
                  style={{ ...FIELD_STYLE, width: "auto", cursor: workspaceHandle && selectedEntry?.result ? "pointer" : "not-allowed", fontWeight: 700 }}
                >
                  Save selected report + order files to project folder
                </button>
                <button
                  type="button"
                  onClick={saveAllToWorkspace}
                  disabled={!workspaceHandle || !batchSuccessfulResults.length}
                  style={{ ...FIELD_STYLE, width: "auto", cursor: workspaceHandle && batchSuccessfulResults.length ? "pointer" : "not-allowed", fontWeight: 700 }}
                >
                  Save all reports + order files to project folders
                </button>
              </div>
              {workspaceFolders.length > 0 && (
                <div style={{ marginBottom: 12, maxWidth: 860 }}>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Project folders to import</div>
                  <div style={{ ...FIELD_STYLE, background: COLORS.panelAlt, padding: 12, maxHeight: 220, overflowY: "auto" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                      <button type="button" onClick={() => setSelectedWorkspaceFolders(workspaceFolders.map((entry) => entry.name))} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700 }}>
                        Select all
                      </button>
                      <button type="button" onClick={() => setSelectedWorkspaceFolders([])} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700 }}>
                        Clear selection
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {workspaceFolders.map((entry) => (
                        <label key={entry.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={selectedWorkspaceFolders.includes(entry.name)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setSelectedWorkspaceFolders((current) => checked ? [...current, entry.name] : current.filter((name) => name !== entry.name));
                            }}
                            style={{ marginTop: 2 }}
                          />
                          <span style={{ color: COLORS.text, fontSize: 13, lineHeight: 1.4 }}>{entry.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ color: COLORS.dim, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                    If nothing is checked, all detected project folders will be imported.
                  </div>
                </div>
              )}
              <div style={{ color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>
                Linked root: {workspaceHandle?.name || "none"}
                {!supportsWorkspaceAccess && " | Direct project-folder access is unavailable in this browser."}
              </div>
              {workspaceStatus && <div style={{ marginTop: 12, color: COLORS.success, fontSize: 13 }}>{workspaceStatus}</div>}
            </>
          )}
        </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <TopLevelTabButton active={activeTab === "workspace"} onClick={() => setActiveTab("workspace")} tone="accent">
            Workspace
          </TopLevelTabButton>
          <TopLevelTabButton active={activeTab === "report"} onClick={() => setActiveTab("report")} tone="warm">
            Report
          </TopLevelTabButton>
          <TopLevelTabButton active={activeTab === "primers"} onClick={() => setActiveTab("primers")} tone="accent">
            Primer Tool
          </TopLevelTabButton>
          <TopLevelTabButton active={activeTab === "genomic-snp"} onClick={() => setActiveTab("genomic-snp")} tone="accent">
            Genomic SNP
          </TopLevelTabButton>
          <TopLevelTabButton active={activeTab === "exports"} onClick={() => setActiveTab("exports")}>
            Exports
          </TopLevelTabButton>
        </div>

        <div hidden={activeTab !== "genomic-snp"}><GenomicSnpTool onInvalidate={() => {setGenomicReport(null);setShowGenomicReport(false);}} onGenerate={result => {setGenomicReport(result);setShowGenomicReport(true);setActiveTab("report");}} /></div>

        {activeTab === "workspace" && (
        <div id="design-requests" style={{ ...CARD_STYLE, marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <SectionTitle>1. Design Requests</SectionTitle>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Build the project workspace</div>
              <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.55, maxWidth: 760 }}>
                Start from a batch list or create rows manually. Each card below is organized into project setup, reference sequence, edit design, and optional notes.
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Badge color={COLORS.accent}>{batchRows.length} rows</Badge>
              <Badge color={readyRowCount ? COLORS.success : COLORS.muted}>{readyRowCount} ready</Badge>
              <Badge color={reviewRowCount ? COLORS.accentAlt : COLORS.muted}>{reviewRowCount} need review</Badge>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 }}>
            <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${COLORS.borderSoft}`, background: "#FFFFFF" }}>
              <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Batch input</div>
              <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}>
                Paste one request per line if you want to generate rows quickly, or skip this and build rows manually.
              </div>
              <InlineNotice tone="info" style={{ marginBottom: 10 }}>
                Start with one simple line such as <strong>TP53 knockout</strong> or <strong>APOE R176C SNP knockin</strong>, then click <strong>Parse requests</strong>.
              </InlineNotice>
              <label style={{ display: "block" }}>
                <textarea
                  value={requestText}
                  onChange={(event) => setRequestText(event.target.value)}
                  style={{ ...FIELD_STYLE, minHeight: 146, resize: "vertical", fontFamily: 'Consolas, "Courier New", monospace' }}
                  placeholder={SAMPLE_REQUEST_TEXT}
                />
              </label>
            </div>
            <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${COLORS.borderSoft}`, background: "#FCFCFD" }}>
              <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Actions</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12, alignItems: "center" }}>
                <label style={{ ...FIELD_STYLE, width: "auto", display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", fontWeight: 700 }}>
                  <span style={{ color: COLORS.accent }}>Upload GenBank folder</span>
                  <input type="file" accept=".gb,.gbk,.genbank,.txt" multiple webkitdirectory="" directory="" onChange={onBatchFolder} style={{ display: "none" }} />
                </label>
                <ActionButton variant="secondary" onClick={parseRequests}>Parse requests</ActionButton>
                <ActionButton variant="secondary" onClick={addProjectRow}>Add design</ActionButton>
                <ActionButton variant="subtle" onClick={loadSampleRequests}>Load demo requests</ActionButton>
                <ActionButton variant="danger" onClick={() => resetWorkspace("pm")}>Clear workspace</ActionButton>
              </div>
              {batchError && <InlineNotice tone="danger" style={{ marginBottom: 12 }}>{batchError}</InlineNotice>}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ padding: "10px 12px", borderRadius: 12, background: "#F8FAFC", border: `1px solid ${COLORS.borderSoft}` }}>
                  <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>Current workspace</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{batchRows.length} design row{batchRows.length === 1 ? "" : "s"}</div>
                </div>
                {batchFolderEntries.length > 0 ? (
                  <div style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.22)", color: COLORS.success, fontSize: 13, lineHeight: 1.55 }}>
                    Folder ready: {batchFolderEntries.length} GenBank file{batchFolderEntries.length === 1 ? "" : "s"} loaded for automatic matching.
                  </div>
                ) : (
                  <div style={{ padding: "10px 12px", borderRadius: 12, background: "#F8FAFC", border: `1px solid ${COLORS.borderSoft}`, color: COLORS.muted, fontSize: 13, lineHeight: 1.55 }}>
                    {APP_CONFIG.emptyFolderNotice}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {batchRows.map((row, index) => {
              const slot = index + 1;
              const batchStatus = batchResults.find((entry) => entry.rowId === row.id);
              const koRowReferences = batchKoReferenceMap[row.id];
              const koRowBrunelloGuideSet = batchStatus?.status === "success" && batchStatus.result?.type === "ko"
                ? getBrunelloReferenceGuideSet(batchStatus.result, koRowReferences?.brunello)
                : null;
              const koRowBrunelloPairs = batchStatus?.status === "success" && batchStatus.result?.type === "ko"
                ? buildKoReferencePairCandidates(batchStatus.result, row, koRowBrunelloGuideSet?.guides, buildBrunelloGuideOverride, "Brunello")
                : [];
              const koRowCasPairs = batchStatus?.status === "success" && batchStatus.result?.type === "ko"
                ? buildKoReferencePairCandidates(batchStatus.result, row, koRowReferences?.casDb?.targets, buildCasDatabaseGuideOverride, "Cas-Database")
                : [];
              const koRowTopBrunelloPair = koRowBrunelloPairs.find((candidate) => candidate.candidateMode === "nearby") || koRowBrunelloPairs.find((candidate) => candidate.candidateMode === "local") || koRowBrunelloPairs.find((candidate) => candidate.candidateMode === "cross-exon") || koRowBrunelloPairs.find((candidate) => candidate.candidateMode === "deletion-screen") || null;
              const koRowTopCasPair = koRowCasPairs.find((candidate) => candidate.candidateMode === "nearby") || koRowCasPairs.find((candidate) => candidate.candidateMode === "local") || koRowCasPairs.find((candidate) => candidate.candidateMode === "cross-exon") || koRowCasPairs.find((candidate) => candidate.candidateMode === "deletion-screen") || null;
              const constructSelection = (row.projectType === "ct" || row.projectType === "nt")
                ? resolveConstructBuilderSelection(row.tag, row.projectType)
                : null;
              const constructPayloads = constructSelection
                ? getConstructBuilderPayloads(row.projectType, constructSelection.architecture)
                : [];
              const constructHelp = constructSelection
                ? getConstructBuilderHelp(row.projectType, constructSelection.architecture)
                : "";
              const rowReady = !row.parseIssue && (row.projectType === "ko" ? (!!row.gene || hasSequenceBackedReference(row)) : hasSequenceBackedReference(row));
              const rowIssues = getRowSectionIssues(row);
              const fetchQuery = row.fetchQuery || "";
              const fetchSource = row.fetchSource || "ensembl";
              const fetchSpecies = row.fetchSpecies || "human";
              const fetchState = geneFetchState[index];
              return (
                <div key={row.id} style={{ padding: 16, borderRadius: 18, border: `1px solid ${COLORS.borderSoft}`, background: "linear-gradient(180deg, #FFFFFF, #F8FAFC)", boxShadow: "0 14px 28px rgba(15, 23, 42, 0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800, fontSize: 17 }}>Design {slot}</div>
                        <Badge color={getProjectTypeMeta(row.projectType)?.id === "ko" ? COLORS.accentAlt : COLORS.accent}>{getProjectTypeMeta(row.projectType)?.label}</Badge>
                      </div>
                      <div style={{ color: COLORS.muted, fontSize: 13, marginTop: 5, lineHeight: 1.5 }}>
                        {row.gene || "Gene needed"}{row.cellLine ? ` • ${row.cellLine}` : " • Cell line needed"}{row.label ? ` • ${row.label}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {row.referenceSource === "raw" && hasRawReference(row) && <Badge color={COLORS.success}>Raw DNA reference</Badge>}
                      {row.referenceSource !== "raw" && row.fileName && <Badge color={COLORS.success}>{row.fileName}</Badge>}
                      {row.parseIssue && <Badge color={COLORS.accentAlt}>{row.parseIssue}</Badge>}
                      {!row.parseIssue && rowReady && !batchStatus && <Badge color={COLORS.accent}>Ready to generate</Badge>}
                      {batchStatus?.status === "success" && <Badge color={COLORS.success}>{formatBatchDesignLabel({ ...row, slot }, batchStatus.result)}</Badge>}
                      {batchStatus?.status === "error" && <Badge color={COLORS.danger}>Error</Badge>}
                      {batchSuccessfulResults.length > 1 && batchStatus?.status === "success" && (
                        <ActionButton variant="secondary" onClick={() => setSelectedProjectId(row.id)}>
                          {selectedEntry?.rowId === row.id ? "Shown below" : "Show report"}
                        </ActionButton>
                      )}
                      <ActionButton variant="subtle" onClick={() => duplicateProjectRow(index)}>Duplicate</ActionButton>
                      <ActionButton variant="danger" onClick={() => removeProjectRow(index)} disabled={batchRows.length <= 1}>Remove</ActionButton>
                    </div>
                  </div>

                  <FormSection title="Basic details" hint="Start with the gene, the edit type, and any project identifiers you already know.">
                    {!!rowIssues.project.length && <InlineNotice tone="warning" style={{ marginBottom: 12 }}>{rowIssues.project.join(" ")}</InlineNotice>}
                    <Grid>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Internal ID</div><input value={row.irisId} onChange={(event) => updateBatchRow(index, "irisId", event.target.value)} style={FIELD_STYLE} placeholder="72860" /></label>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Team or client</div><input value={row.clientName} onChange={(event) => updateBatchRow(index, "clientName", event.target.value)} style={FIELD_STYLE} placeholder="Internal program or sponsor" /></label>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Gene</div><input value={row.gene} onChange={(event) => updateBatchRow(index, "gene", event.target.value)} style={FIELD_STYLE} placeholder="APOE" /></label>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Cell line</div><input value={row.cellLine} onChange={(event) => updateBatchRow(index, "cellLine", event.target.value)} style={FIELD_STYLE} placeholder="Optional, for example BIHi005-A" /></label>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Guide delivery</div><select value={row.deliveryMethod || "unknown"} onChange={(event) => updateBatchRow(index, "deliveryMethod", event.target.value)} style={SELECT_STYLE}><option value="unknown">Not decided</option><option value="rnp">Synthetic guide + Cas RNP</option><option value="u6">U6 / Pol III expression plasmid</option></select></label>
                        <label style={{ display: "block" }}><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Guide-blocking changes per guide</div><select value={row.maxBlockingChanges || "3"} onChange={(event) => updateBatchRow(index, "maxBlockingChanges", event.target.value)} style={SELECT_STYLE}><option value="3">Up to 3 - stop when protection is strong (default)</option><option value="2">Up to 2</option><option value="1">1 only - fewest donor edits</option></select><div style={{ color: COLORS.muted, fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>Where a synonymous PAM change is available it is used alone. Otherwise synonymous seed mismatches are stacked from the PAM-proximal end. More changes protect better against re-cutting; fewer keep HDR efficiency higher and the edited allele easier to read.</div></label>
                        <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><input type="checkbox" checked={!!row.coDelivery} onChange={(event) => updateBatchRow(index, "coDelivery", event.target.checked)} style={{ marginTop: 3 }} /><span><div style={{ color: COLORS.text, fontSize: 13, fontWeight: 600 }}>Co-transfect both guides and both ssODNs</div><div style={{ color: COLORS.muted, fontSize: 12, lineHeight: 1.45 }}>Builds every donor to block every offered guide, and prefers guides whose targets can both be silently destroyed. On by default (two guides, each ssODN blocking both). Turn it off only when you deliver one matched guide/ssODN pair at a time.</div></span></label>
                        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, opacity: row.coDelivery ? 0.5 : 1 }}><input type="checkbox" disabled={!!row.coDelivery} checked={!!row.acceptWeakProtection} onChange={(event) => updateBatchRow(index, "acceptWeakProtection", event.target.checked)} style={{ marginTop: 3 }} /><span><div style={{ color: COLORS.text, fontSize: 13, fontWeight: 600 }}>Accept weak guide protection and order anyway</div><div style={{ color: COLORS.muted, fontSize: 12, lineHeight: 1.45 }}>{row.coDelivery ? "Not available with co-delivery: there a weakly blocked guide re-cuts the allele the other donor just repaired. Order the pairs separately instead." : "Records a reviewed decision to order a pair whose guide is only weakly blocked. The advice stays in the report and the design never reads as ready. It never overrides a donor that fails its protein assertion."}</div></span></label>
                        {!!row.acceptWeakProtection && !row.coDelivery && (
                          <div style={{ display: "grid", gap: 8, padding: "10px 12px", borderRadius: 10, background: "#FFFAEB", border: "1px solid #F7900955" }}>
                            <label style={{ display: "block" }}><div style={{ color: COLORS.muted, fontSize: 12, marginBottom: 4 }}>Why is this acceptable? (required)</div><input value={row.weakProtectionReason || ""} onChange={(event) => updateBatchRow(index, "weakProtectionReason", event.target.value)} style={FIELD_STYLE} placeholder="RNP, short exposure; screening 48 clones with full-amplicon sequencing" /></label>
                            <label style={{ display: "block" }}><div style={{ color: COLORS.muted, fontSize: 12, marginBottom: 4 }}>Accepted by (optional)</div><input value={row.acceptedBy || ""} onChange={(event) => updateBatchRow(index, "acceptedBy", event.target.value)} style={FIELD_STYLE} placeholder="Name" /></label>
                            {!String(row.weakProtectionReason || "").trim() && (
                              <div style={{ color: "#B54708", fontSize: 12, lineHeight: 1.45 }}>Without a reason the acceptance is ignored. An unexplained override cannot be told apart from a mis-click later.</div>
                            )}
                          </div>
                        )}
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Project name</div><input value={row.label} onChange={(event) => updateBatchRow(index, "label", event.target.value)} style={FIELD_STYLE} placeholder={`Design ${slot}`} /></label>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>What do you want to design?</div><select value={row.projectType} onChange={(event) => updateBatchRow(index, "projectType", event.target.value)} style={SELECT_STYLE}>{PROJECT_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    </Grid>
                  </FormSection>

                  <FormSection title="Sequence input" hint="Use a GenBank file for the easiest path. Paste raw DNA only if you also know the CDS coordinates." tone="accent">
                    {!!rowIssues.reference.length && <InlineNotice tone="warning" style={{ marginBottom: 12 }}>{rowIssues.reference.join(" ")}</InlineNotice>}
                    <label style={{ display: "block", marginBottom: 12 }}>
                      <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>How are you providing sequence?</div>
                      <select value={row.referenceSource} onChange={(event) => updateBatchRow(index, "referenceSource", event.target.value)} style={SELECT_STYLE}>
                        <option value="genbank">GenBank file</option>
                        <option value="raw">Raw DNA + CDS coordinates</option>
                      </select>
                    </label>

                    {row.referenceSource === "raw" ? (
                      <>
                        <label style={{ display: "block", marginBottom: 12 }}>
                          <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>DNA sequence</div>
                          <textarea value={row.rawSequence} onChange={(event) => updateBatchRow(index, "rawSequence", event.target.value)} style={{ ...FIELD_STYLE, minHeight: 120, resize: "vertical", fontFamily: "Consolas, monospace" }} placeholder="Paste genomic DNA using A, C, G, and T only" />
                        </label>
                        <Grid>
                          <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Coding region start (1-based)</div><input value={row.cdsStart} onChange={(event) => updateBatchRow(index, "cdsStart", event.target.value)} style={FIELD_STYLE} placeholder="101" /></label>
                          <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Coding region end (1-based)</div><input value={row.cdsEnd} onChange={(event) => updateBatchRow(index, "cdsEnd", event.target.value)} style={FIELD_STYLE} placeholder="1452" /></label>
                        </Grid>
                        <label style={{ display: "block", marginTop: 12 }}>
                          <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Exon coordinates (optional)</div>
                          <textarea value={row.exonCoordinates} onChange={(event) => updateBatchRow(index, "exonCoordinates", event.target.value)} style={{ ...FIELD_STYLE, minHeight: 72, resize: "vertical", fontFamily: "Consolas, monospace" }} placeholder={"One exon per line, 1-based inclusive\n101-240\n301-512"} />
                        </label>
                      </>
                    ) : (
                      <label style={{ display: "block" }}>
                        <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>GenBank file {row.projectType === "ko" ? "(optional for gene-only KO mode)" : ""}</div>
                        <label style={{ ...FIELD_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                          <span style={{ color: row.fileName ? COLORS.success : COLORS.muted }}>{row.fileName || "Upload .gb / .gbk / .genbank"}</span>
                          <span style={{ color: COLORS.accent, fontWeight: 700 }}>Browse</span>
                          <input type="file" accept=".gb,.gbk,.genbank,.txt" onChange={(event) => onBatchFile(index, event)} style={{ display: "none" }} />
                        </label>
                      </label>
                    )}
                    {row.referenceSource !== "raw" && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Or fetch the gene (MANE Select transcript, gene span plus 1 kb)</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <input
                            value={fetchQuery}
                            onChange={(event) => updateBatchRow(index, "fetchQuery", event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter" && fetchQuery.trim()) { event.preventDefault(); fetchRowGene(index, fetchQuery, fetchSource, fetchSpecies); } }}
                            placeholder="Gene symbol, ENST… or NM_…"
                            style={{ ...FIELD_STYLE, flex: "1 1 220px", width: "auto" }}
                          />
                          <select value={fetchSource} onChange={(event) => updateBatchRow(index, "fetchSource", event.target.value)} style={{ ...SELECT_STYLE, width: 120 }} aria-label="Source">
                            <option value="ensembl">Ensembl</option>
                            <option value="ncbi">NCBI</option>
                          </select>
                          <select value={fetchSpecies} onChange={(event) => updateBatchRow(index, "fetchSpecies", event.target.value)} style={{ ...SELECT_STYLE, width: 130 }} aria-label="Species">
                            {Object.entries(SPECIES).map(([key, species]) => <option key={key} value={key}>{species.label}</option>)}
                          </select>
                          <ActionButton onClick={() => fetchRowGene(index, fetchQuery, fetchSource, fetchSpecies)} disabled={!fetchQuery.trim() || fetchState?.status === "loading"}>
                            {fetchState?.status === "loading" ? "Fetching…" : "Fetch"}
                          </ActionButton>
                        </div>
                        {fetchState?.status === "error" && <InlineNotice tone="danger" style={{ marginTop: 8 }}>{fetchState.message}</InlineNotice>}
                        {fetchState?.status === "ok" && row.fileName === fetchState.fileName && (
                          <InlineNotice tone={fetchState.summary.warnings.length ? "warning" : "success"} style={{ marginTop: 8 }}>
                            {fetchState.summary.text}
                            {fetchState.summary.warnings.map((text, warningIndex) => <div key={warningIndex}>{text}</div>)}
                          </InlineNotice>
                        )}
                      </div>
                    )}

                    <label style={{ display: "block", marginTop: 12 }}>
                      <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Use your own gRNAs (optional)</div>
                      <textarea
                        value={row.customGuides}
                        onChange={(event) => updateBatchRow(index, "customGuides", event.target.value)}
                        style={{ ...FIELD_STYLE, minHeight: 72, resize: "vertical", fontFamily: "Consolas, monospace" }}
                        placeholder={"Paste one or two 20 nt spacers, one per line\nGGACTGTTGCTGTTCTGCCC\nATGGCAGATCCACTGTGGGT"}
                      />
                      <div style={{ marginTop: 6, color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>
                        If you paste guides here, the app will map them onto the uploaded sequence and use them for donor and primer design. For knockout, paste two guides. For SNP and knock-ins, paste one or two guides near the edit site.
                      </div>
                    </label>
                  </FormSection>

                  <FormSection title="What should be designed?" hint={APP_CONFIG.designDetailsHint} tone="warm">
                    {!!rowIssues.design.length && <InlineNotice tone="warning" style={{ marginBottom: 12 }}>{rowIssues.design.join(" ")}</InlineNotice>}
                    <label style={{ display: "block", marginBottom: 12 }}><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Short edit summary</div><input value={row.editSummary} onChange={(event) => updateBatchRow(index, "editSummary", event.target.value)} style={FIELD_STYLE} placeholder="APOE p.Arg176Cys SNP knock-in" /></label>

                  {row.projectType === "pm" && <label style={{ display: "block", marginTop: 12 }}><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Protein change</div><input value={row.mutation} onChange={(event) => updateBatchRow(index, "mutation", event.target.value)} style={FIELD_STYLE} placeholder="R176C" /></label>}
                  {row.projectType === "it" && (
                    <Grid>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Internal tag</div><select value={INTERNAL_TAGS[row.tag] ? row.tag : "SPOT"} onChange={(event) => updateBatchRow(index, "tag", event.target.value)} style={SELECT_STYLE}>{internalTagOptions.map((option) => <option key={option} value={option}>{option} ({INTERNAL_TAGS[option].seq.length} bp)</option>)}</select></label>
                      <label><div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Insert after amino acid</div><input value={row.mutation} onChange={(event) => updateBatchRow(index, "mutation", event.target.value)} style={FIELD_STYLE} placeholder="P155" /></label>
                    </Grid>
                  )}
                  {(row.projectType === "ct" || row.projectType === "nt") && (
                    <>
                      <Grid>
                        <label>
                          <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Insert style</div>
                          <select
                            value={constructSelection?.architecture || ""}
                            onChange={(event) => {
                              const payloads = getConstructBuilderPayloads(row.projectType, event.target.value);
                              if (payloads.length) updateBatchRow(index, "tag", payloads[0].cassette);
                            }}
                            style={SELECT_STYLE}
                          >
                            {getConstructBuilderGroups(row.projectType).map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                          </select>
                        </label>
                        <label>
                          <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>
                            {constructSelection?.architecture === "fusion"
                              ? "Reporter / tag"
                              : constructSelection?.architecture === "tag_p2a_reporter"
                                ? "Tag + reporter"
                                : constructSelection?.architecture === "tag_p2a_selection"
                                  ? "Tag + selection"
                                  : "Reporter"}
                          </div>
                          <select value={row.tag} onChange={(event) => updateBatchRow(index, "tag", event.target.value)} style={SELECT_STYLE}>
                            {constructPayloads.map((option) => <option key={option.cassette} value={option.cassette}>{option.label} ({getCassetteSequenceLength(option.cassette, row.projectType)} bp)</option>)}
                          </select>
                        </label>
                      </Grid>
                      <DonorFormatControls row={row} onChange={(field, value) => updateBatchRow(index, field, value)} />
                      <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 13, lineHeight: 1.55 }}>
                        {row.projectType === "nt"
                          ? "N-terminal convention: fusion designs use reporter-linker or tag-linker. Cleavable designs use reporter-T2A or reporter-P2A."
                          : "C-terminal convention: fusion designs use linker-tag. Cleavable designs use T2A-reporter or P2A-reporter."}
                      </div>
                      {constructHelp && (
                        <div style={{ marginTop: 6, color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>
                          {constructHelp}
                        </div>
                      )}
                      <div style={{ marginTop: 6, color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>
                        Resolved cassette: <span style={{ fontFamily: "Consolas, monospace", color: COLORS.text }}>{row.tag}</span>
                      </div>
                      <div style={{ marginTop: 6, color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>
                        Reporter inserts come from the built-in FPbase-backed reporter library, so you do not need to paste reporter DNA manually.
                      </div>
                      <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #D7DEE7", background: "#F8FAFC" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>FPbase reporter catalog</div>
                            <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55 }}>Search all FPbase reporters, then apply curated order-ready reporters directly into this {row.projectType === "nt" ? "N-terminal" : "C-terminal"} design.</div>
                          </div>
                          <button type="button" onClick={() => toggleFpbaseRow(row.id)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #D0D5DD", background: "#fff", color: "#111827", fontWeight: 700, cursor: "pointer" }}>
                            {fpbaseRowId === row.id ? "Hide FPbase reporters" : "Browse FPbase reporters"}
                          </button>
                        </div>
                        {fpbaseRowId === row.id && (
                          <>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                              <input
                                value={fpbaseSearchInput}
                                onChange={(event) => setFpbaseSearchInput(event.target.value)}
                                placeholder="Search FPbase, for example mNeonGreen or tdTomato"
                                style={{ ...FIELD_STYLE, flex: "1 1 260px", background: "#fff", color: "#111827" }}
                              />
                              <button type="button" onClick={() => loadFpbaseReporters(fpbaseSearchInput.trim())} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #D0D5DD", background: "#fff", color: "#111827", fontWeight: 700, cursor: "pointer" }}>
                                Search FPbase
                              </button>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                              <Badge color="#D1FAE5">Order-ready: built-in donor DNA available</Badge>
                              <Badge color="#EAECF0">Reference only: visible from FPbase, not yet curated for donor design</Badge>
                            </div>
                            {fpbaseLookup.status === "loading" && (
                              <div style={{ color: "#667085", fontSize: 13 }}>Loading FPbase reporters...</div>
                            )}
                            {fpbaseLookup.status === "error" && (
                              <div style={{ padding: 10, borderRadius: 10, background: "#FEE4E2", color: "#B42318", fontSize: 13 }}>{fpbaseLookup.error}</div>
                            )}
                            {fpbaseLookup.status === "success" && (
                              <div style={{ display: "grid", gap: 10 }}>
                                <div style={{ color: "#667085", fontSize: 13 }}>
                                  {fpbaseLookup.data?.count || fpbaseLookup.data?.reporters?.length || 0} FPbase reporters found.
                                  {fpbaseLookup.data?.sourceUrl ? <> Source: <a href={fpbaseLookup.data.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#2E75B6", textDecoration: "none" }}>{fpbaseLookup.data.sourceUrl}</a></> : null}
                                </div>
                                {(fpbaseLookup.data?.reporters || []).slice(0, 24).map((reporter) => {
                                  const actionOptions = getReporterActionOptions(reporter.name, row.projectType);
                                  const orderReadyKey = getOrderReadyReporterKey(reporter.name);
                                  const builtInReporter = orderReadyKey ? REPORTERS[orderReadyKey] : null;
                                  return (
                                    <div key={reporter.id || reporter.name} style={{ padding: 12, borderRadius: 12, border: "1px solid #D7DEE7", background: "#fff" }}>
                                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
                                        <div style={{ fontWeight: 700, color: "#111827" }}>{reporter.name}</div>
                                        <Badge color={actionOptions.length ? "#D1FAE5" : "#EAECF0"}>{actionOptions.length ? "Order-ready" : "Reference only"}</Badge>
                                      </div>
                                      <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55, marginBottom: 6 }}>
                                        {formatFpbaseReporterSummary(reporter) || "FPbase reporter entry"}
                                      </div>
                                      <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                                        {reporter.aaLength ? `${reporter.aaLength} aa` : "AA length n/a"}
                                        {reporter.genbank ? ` • GenBank ${reporter.genbank}` : ""}
                                        {builtInReporter?.sourceUrl ? <> • <a href={builtInReporter.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#2E75B6", textDecoration: "none" }}>FPbase entry</a></> : reporter.url ? <> • <a href={reporter.url} target="_blank" rel="noreferrer" style={{ color: "#2E75B6", textDecoration: "none" }}>FPbase entry</a></> : null}
                                      </div>
                                      {!!actionOptions.length && (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                          {actionOptions.map((option) => (
                                            <button
                                              key={option}
                                              type="button"
                                              onClick={() => applyFpbaseReporterToRow(index, option)}
                                              style={{
                                                padding: "8px 12px",
                                                borderRadius: 10,
                                                border: row.tag === option ? "1px solid #10B981" : "1px solid #D0D5DD",
                                                background: row.tag === option ? "#ECFDF5" : "#fff",
                                                color: "#111827",
                                                fontWeight: 700,
                                                cursor: "pointer",
                                              }}
                                            >
                                              Use {getCassetteDisplayLabel(option, row.projectType)}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                  {row.projectType === "ko" && <div style={{ marginTop: 12, color: COLORS.muted, fontSize: 13, lineHeight: 1.55 }}>Knockout can run from the gene name alone for a quick guide shortlist. Upload a GenBank file if you want sequence-backed guide spacing and automatic primer recommendations. If you paste your own guides, a GenBank file is required.</div>}
                  </FormSection>

                  <FormSection title="Optional notes" hint="Add anything a reviewer should keep in mind, such as transcript choice or delivery plan.">
                    <label style={{ display: "block" }}>
                      <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Notes</div>
                      <textarea value={row.notes} onChange={(event) => updateBatchRow(index, "notes", event.target.value)} style={{ ...FIELD_STYLE, minHeight: 84, resize: "vertical" }} placeholder="Transcript choice, delivery mode, cloning preference, or other review notes..." />
                    </label>
                  </FormSection>

                  {batchStatus?.status === "error" && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "rgba(251,113,133,0.10)", border: `1px solid ${COLORS.danger}55`, color: COLORS.danger }}>
                      {batchStatus.error}
                    </div>
                  )}
                  {batchStatus?.status === "success" && (
                    <div style={{ marginTop: 10, color: COLORS.muted, fontSize: 13, lineHeight: 1.55 }}>
                      {batchStatus.result.gs?.length || 0} gRNAs | {(batchStatus.result.type === "pm" || batchStatus.result.type === "it" ? batchStatus.result.os?.length : batchStatus.result.donor ? 1 : 0) || 0} donor entries | {batchStatus.result.ps?.length || 0} primers
                    </div>
                  )}
                  {batchStatus?.status === "success" && batchStatus.result?.type === "ko" && (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "#F8FAFC", border: "1px solid #D7DEE7" }}>
                      <div style={{ color: "#111827", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>High-throughput KO pair suggestions</div>
                      <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}>
                        For KO rows, the app can suggest nearby pairs from the top 3 Brunello and Cas-Database guides, then center recommended primers automatically.
                      </div>
                      {koRowReferences?.status === "loading" && (
                        <div style={{ color: "#667085", fontSize: 13 }}>Loading KO reference pairs...</div>
                      )}
                      {koRowReferences?.error && (
                        <div style={{ color: "#B42318", fontSize: 12, marginBottom: 8 }}>{koRowReferences.error}</div>
                      )}
                      {koRowTopBrunelloPair && (
                        <div style={{ marginBottom: 8, padding: 10, borderRadius: 10, background: "#FFF7ED", border: "1px solid #FED7AA" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ color: "#9A3412", fontWeight: 700, fontSize: 13 }}>{koRowTopBrunelloPair.candidateMode === "deletion-screen" ? "Top Brunello deletion-screen pair" : koRowTopBrunelloPair.candidateMode === "cross-exon" ? "Top Brunello cross-exon pair" : "Top Brunello local pair"}</div>
                              <div style={{ color: "#7C2D12", fontSize: 12, marginTop: 4 }}>
                                {koRowTopBrunelloPair.exonLabel} | {Number.isFinite(koRowTopBrunelloPair.spacing) ? `${koRowTopBrunelloPair.spacing} bp ${koRowTopBrunelloPair.candidateMode === "deletion-screen" ? "deletion" : "spacing"}` : "spacing n/a"} | {koRowTopBrunelloPair.result.amp || "amplicon n/a"}
                              </div>
                            </div>
                            <ActionButton variant="warm" onClick={() => applyKoGuidePairToRow(row.id, koRowTopBrunelloPair)} style={{ padding: "6px 8px", fontSize: 12 }}>
                              Apply Brunello pair
                            </ActionButton>
                          </div>
                        </div>
                      )}
                      {koRowTopCasPair && (
                        <div style={{ padding: 10, borderRadius: 10, background: "#ffffff", border: "1px solid #D0D5DD" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ color: "#111827", fontWeight: 700, fontSize: 13 }}>{koRowTopCasPair.candidateMode === "deletion-screen" ? "Top Cas-Database deletion-screen pair" : koRowTopCasPair.candidateMode === "cross-exon" ? "Top Cas-Database cross-exon pair" : "Top Cas-Database local pair"}</div>
                              <div style={{ color: "#475467", fontSize: 12, marginTop: 4 }}>
                                {koRowTopCasPair.exonLabel} | {Number.isFinite(koRowTopCasPair.spacing) ? `${koRowTopCasPair.spacing} bp ${koRowTopCasPair.candidateMode === "deletion-screen" ? "deletion" : "spacing"}` : "spacing n/a"} | {koRowTopCasPair.result.amp || "amplicon n/a"}
                              </div>
                            </div>
                            <ActionButton variant="secondary" onClick={() => applyKoGuidePairToRow(row.id, koRowTopCasPair)} style={{ padding: "6px 8px", fontSize: 12 }}>
                              Apply Cas-Database pair
                            </ActionButton>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
            <ActionButton variant="primary" onClick={runBatch}>
              Generate designs
            </ActionButton>
            {batchCopyState && <Badge color={COLORS.success}>{batchCopyState}</Badge>}
          </div>
        </div>
        )}

        {activeTab === "report" && showGenomicReport && genomicReport && (
          <GenomicSnpReport result={genomicReport} onEdit={() => setActiveTab("genomic-snp")} onOtherReports={() => setShowGenomicReport(false)} />
        )}
        {activeTab === "report" && !showGenomicReport && (
        <div style={{ ...CARD_STYLE, marginTop: 18, background: "linear-gradient(180deg, rgba(240,228,204,0.12), rgba(16,34,52,0.90))", border: `1px solid ${COLORS.borderSoft}` }}>
          <SectionTitle>2. Final Report</SectionTitle>
          <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
            Review the selected design, then either save it into the linked project folder or download the HTML/browser export fallback.
          </div>
          {workspaceHandle && selectedEntry?.result && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: "#f6efe2", border: "1px solid #dec8a5" }}>
              <div style={{ color: "#8a5a12", fontSize: 12, fontWeight: 800, letterSpacing: 0.3, marginBottom: 6 }}>Recommended Save Path</div>
              <div style={{ color: "#111827", fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>
                Save the selected report and order files into the linked project folder. The HTML report is the editable version; open it in Word if you want to revise it, then export PDF from Word only for a final fixed copy.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button type="button" onClick={saveSelectedToWorkspace} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700, background: "#f1debb", border: "1px solid #cfb07a", color: "#7a4d10" }}>
                  Save selected report + order files to project folder
                </button>
                <button
                  type="button"
                  onClick={saveAllToWorkspace}
                  disabled={!batchSuccessfulResults.length}
                  style={{ ...FIELD_STYLE, width: "auto", cursor: batchSuccessfulResults.length ? "pointer" : "not-allowed", fontWeight: 700, background: "#fffdf8", border: "1px solid #cfb07a", color: "#7a4d10" }}
                >
                  Save all reports + order files to project folders
                </button>
              </div>
            </div>
          )}
          <div style={{ color: COLORS.dim, fontSize: 13, marginBottom: 10, lineHeight: 1.55 }}>
            Browser download fallback
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <button type="button" disabled={!reportHtml} onClick={downloadReport} style={{ ...FIELD_STYLE, width: "auto", cursor: reportHtml ? "pointer" : "not-allowed", fontWeight: 700 }}>Download HTML report to browser Downloads</button>
            <button type="button" disabled={!selectedEntry?.result} onClick={downloadQcDesign} style={{ ...FIELD_STYLE, width: "auto", cursor: selectedEntry?.result ? "pointer" : "not-allowed", fontWeight: 700 }}>Download QC design file (JSON) for trace analysis</button>
            <button type="button" disabled={batchSuccessfulResults.length < 2} onClick={downloadAllReports} style={{ ...FIELD_STYLE, width: "auto", cursor: batchSuccessfulResults.length >= 2 ? "pointer" : "not-allowed", fontWeight: 700 }}>Download all HTML reports to browser Downloads</button>
            <button type="button" disabled={!selectedEntry?.result} onClick={() => copyText(buildDesignSummary(selectedEntry.result), "Design summary")} style={{ ...FIELD_STYLE, width: "auto", cursor: selectedEntry?.result ? "pointer" : "not-allowed", fontWeight: 700 }}>Copy design summary</button>
            {copyState && <Badge color={COLORS.success}>{copyState}</Badge>}
          </div>

          {selectedEntry?.result && (
            <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: "linear-gradient(180deg, rgba(240, 228, 204, 0.10), rgba(16,34,52,0.70))", border: `1px solid ${COLORS.borderSoft}` }}>
              <div style={{ color: COLORS.text, fontWeight: 700, marginBottom: 8 }}>Selected Design Order Export</div>
              <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>
                Export the currently selected project into spreadsheet templates for CRISPR reagents, primers, and HDR donors. Blocked designs cannot produce vendor templates; review-required designs remain procurement drafts until the listed checks are resolved.
              </div>
              {selectedProcurementReadiness && (
                <div title={collectProcurementReviewNotes(selectedProcurementReadiness).join(" ")} style={{ marginBottom: 10 }}>
                  <Badge color={selectedProcurementReadiness.status === "blocked" ? COLORS.danger : selectedProcurementReadiness.status === "review" ? "#B45309" : COLORS.success}>
                    Procurement: {selectedProcurementReadiness.status}
                  </Badge>
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button type="button" disabled={!singleIdtTemplateRows.crispr.length} onClick={() => downloadSingleIdtTemplate("crispr")} style={{ ...FIELD_STYLE, width: "auto", cursor: singleIdtTemplateRows.crispr.length ? "pointer" : "not-allowed", fontWeight: 700 }}>
                  Download single CRISPR template
                </button>
                <button type="button" disabled={!singleIdtTemplateRows.oligo.length} onClick={() => downloadSingleIdtTemplate("oligo")} style={{ ...FIELD_STYLE, width: "auto", cursor: singleIdtTemplateRows.oligo.length ? "pointer" : "not-allowed", fontWeight: 700 }}>
                  Download single primer template
                </button>
                <button type="button" disabled={!singleIdtTemplateRows.hdr.length} onClick={() => downloadSingleIdtTemplate("hdr")} style={{ ...FIELD_STYLE, width: "auto", cursor: singleIdtTemplateRows.hdr.length ? "pointer" : "not-allowed", fontWeight: 700 }}>
                  Download single HDR template
                </button>
              </div>
            </div>
          )}

          <div style={{ padding: 14, borderRadius: 12, background: "linear-gradient(180deg, #fbf8f1, #f4efe4)", color: "#2c3340", border: "1px solid #d8cfbf", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)", minHeight: 380 }}>
            {!selectedEntry?.result && (
              <div style={{ color: "#6b7280", maxWidth: 640 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#2c3340", marginBottom: 8 }}>No design report yet</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 10 }}>
                  Use the Design Requests section to upload GenBank files, paste request lines, and generate designs. Once at least one design succeeds, the full report preview will appear here.
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  Quick start: upload a GenBank folder, click <strong>Load sample requests</strong>, then click <strong>Generate designs</strong>.
                </div>
              </div>
            )}
            {selectedEntry?.result && (
              <>
                {copyState && <InlineNotice tone="success" style={{ marginBottom: 16 }}>{copyState}</InlineNotice>}
                {batchSuccessfulResults.length > 1 && (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Generated Projects</div>
                    <div style={{ color: "#667085", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
                      {batchSuccessfulResults.length} designs were generated successfully. The detailed report below shows one selected design at a time.
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                      <thead>
                        <tr>{["Design", "IRIS ID", "Gene", "Cell line", "Edit", "Status"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#5D7288", color: "#ffffff", textAlign: "left" }}>{label}</th>)}</tr>
                      </thead>
                      <tbody>
                        {batchSuccessfulResults.map((entry) => (
                          <tr key={entry.rowId} onClick={() => setSelectedProjectId(entry.rowId)} style={{ cursor: "pointer" }}>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{entry.slot}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{entry.row.irisId || "n/a"}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{entry.result.gene || entry.row.gene || "n/a"}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{entry.row.cellLine || "n/a"}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{formatBatchDesignLabel({ ...entry.row, slot: entry.slot }, entry.result)}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: entry.rowId === selectedEntry.rowId ? "#f6efe2" : "#ffffff", fontWeight: 700 }}>
                              {entry.rowId === selectedEntry.rowId ? "Shown below" : "Also generated"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {batchSuccessfulResults.length > 1 && (
                  <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#f6efe2", border: "1px solid #dec8a5" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div>
                        <div style={{ color: "#8a5a12", fontSize: 12, fontWeight: 800, letterSpacing: 0.2, marginBottom: 4 }}>Detailed Report</div>
                        <div style={{ color: "#111827", fontSize: 14, fontWeight: 700 }}>Choose which generated design is shown in full below</div>
                      </div>
                      <div style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 999, background: "#f1debb", color: "#7a4d10", fontSize: 12, fontWeight: 700 }}>
                        Showing: {formatBatchDesignLabel({ ...selectedEntry.row, slot: selectedEntry.slot }, selectedEntry.result)}
                      </div>
                    </div>
                    <select value={selectedEntry.rowId} onChange={(event) => setSelectedProjectId(event.target.value)} style={{ ...SELECT_STYLE, backgroundColor: "#fffdf8", color: "#2c3340", borderColor: "#cfb07a", fontWeight: 700, backgroundImage: "linear-gradient(45deg, transparent 50%, #8a5a12 50%), linear-gradient(135deg, #8a5a12 50%, transparent 50%)" }}>
                      {batchSuccessfulResults.map((entry) => (
                        <option key={entry.rowId} value={entry.rowId}>{formatBatchDesignLabel({ ...entry.row, slot: entry.slot }, entry.result)}</option>
                      ))}
                    </select>
                  </div>
                )}
                <ReleaseVerdictPanel result={selectedEntry.result} />

                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                  <tbody>
                    {[
                      ["Group", selectedRowMeta.clientName || "n/a"],
                      ["IRIS ID", selectedRowMeta.irisId || "[to be assigned]"],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td style={{ width: 180, padding: "8px 10px", border: "1px solid #cfc5b4", background: "#F4EFE4", fontWeight: 700 }}>{label}</td>
                        <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Design: {formatDesignLabel(selectedRowMeta, selectedEntry.result)}</div>
                <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>{selectedRowMeta.notes || "Final strategy report preview."}</div>
                <ReportSnapshotCard result={selectedEntry.result} />

                <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 8px 0" }}>1. Gene Information</div>
                <GeneInfoCardGrid meta={selectedRowMeta} result={selectedEntry.result} fileName={selectedEntry.row?.fileName} />

                <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 8px 0" }}>2. gRNA Sequences</div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                  <thead>
                    <tr>{["Name", "Sequence", "Strand", "GC", "Notes"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#5D7288", color: "#ffffff", textAlign: "left" }}>{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(selectedEntry.result?.gs || []).map((guide, rowIndex) => (
                      <tr key={rowIndex}>
                        <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{guide.n}</td>
                        <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{renderGuideSequence(guide.sp, guide.pm)}</td>
                        <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{guide.str} strand</td>
                        <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{guide.gc}%</td>
                        <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{guide.arm || guide.note || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 8px 0" }}>3. Recommended Primers</div>
                {selectedEntry.result.type === "ko" && selectedEntry.result.referenceOnly && (
                  <InlineNotice tone="warning" style={{ marginBottom: 12 }}>
                    This knockout was generated in gene-only shortlist mode. Upload a GenBank or raw reference sequence for this row if you want automatic primer recommendations around the selected local cut sites.
                  </InlineNotice>
                )}
                <PrimerSummaryCardGrid result={selectedEntry.result} />
                <PrimerQualityCard result={selectedEntry.result} />
                <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>Expected amplicon: {selectedEntry.result.amp || "n/a"}</div>
                {!!selectedEntry.result?.primerStrategy && <div style={{ color: "#555", fontSize: 13, marginBottom: 12 }}>Primer strategy: {selectedEntry.result.primerStrategy}</div>}
                {!!buildPrimerCandidateRows(selectedEntry.result).length && (
                  <CollapsiblePanel
                    title="Alternative validated primer pairs"
                    summary={`${buildPrimerCandidateRows(selectedEntry.result).length} backup pair${buildPrimerCandidateRows(selectedEntry.result).length === 1 ? "" : "s"}`}
                  >
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 0 }}>
                      <thead>
                        <tr>{["Rank", "Forward", "Fw Tm", "Fw GC", "Fw Clamp", "Reverse", "Rev Tm", "Rev GC", "Rev Clamp", "Amplicon"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #bbbbbb", background: "#E2E8F0", color: "#111827", textAlign: "left", fontSize: 12 }}>{label}</th>)}</tr>
                      </thead>
                      <tbody>
                        {buildPrimerCandidateRows(selectedEntry.result).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} style={{ padding: "8px 10px", border: "1px solid #bbbbbb", background: "#ffffff", fontFamily: cellIndex === 1 || cellIndex === 5 ? "Consolas, monospace" : "inherit", fontSize: 12 }}>{cell}</td>)}</tr>)}
                      </tbody>
                    </table>
                  </CollapsiblePanel>
                )}

                <DesignReadinessCard result={selectedEntry.result} />
                <DesignSchemeCard result={selectedEntry.result} />
                {!supportsDesignScheme(selectedEntry.result) && <LocusMapCard result={selectedEntry.result} />}

                <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 8px 0" }}>4. {selectedEntry.result.type === "pm" ? "ssODN Donor Templates" : selectedEntry.result.type === "ko" ? "Knockout Design" : selectedEntry.result.type === "it" ? "Internal ssODN Donor Templates" : "Donor Design"}</div>
                {selectedEntry.result.type === "pm" && (selectedEntry.result.os || []).map((donor) => <PmDonorPreview key={donor.n} donor={donor} releaseStatus={getDonorReleaseStatus(selectedEntry.result, donor.guideName)} />)}
                {selectedEntry.result.type === "ko" && (
                  <>
                    <div style={{ color: "#555", fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                      {selectedEntry.result.referenceOnly
                        ? "No donor is required for knockout design. This report is in gene-list KO mode, so the paired gRNAs above are reference guides and exact spacing/primer geometry still need a GenBank-backed follow-up."
                        : "No donor is required for knockout design. Use the paired gRNAs above for deletion/NHEJ-based disruption."}
                    </div>
                    <InlineNotice style={{ marginBottom: 12 }}>
                      The primary recommended knockout pair is already summarized above. The reference-library sections below are optional if you want backup guides or alternative local pairs.
                    </InlineNotice>
                    {brunelloLookup.status === "loading" && (
                      <div style={{ marginBottom: 12, color: "#9A3412", fontSize: 13 }}>
                        Loading Brunello CRISPRko reference guides...
                      </div>
                    )}
                    {brunelloLookup.status === "error" && (
                      <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#FEF3F2", border: "1px solid #FECDCA", color: "#B42318", fontSize: 13 }}>
                        {brunelloLookup.error}
                      </div>
                    )}
                    {brunelloReferenceGuideSet && (
                      <CollapsiblePanel
                        title="Backup KO guides: Brunello"
                        summary={`${brunelloLocalCandidates.length} same-exon alternative${brunelloLocalCandidates.length === 1 ? "" : "s"}${brunelloReviewOnlyCount ? ` · ${brunelloReviewOnlyCount} review-only` : ""}`}
                        tone="warm"
                      >
                        <div style={{ color: "#7C2D12", fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                          Optional backup guides from the Brunello library. Use these only if you want alternatives to the primary pair shown above.
                        </div>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>{["Spacer", "PAM", "Exon", "Rule Set 2", "Transcript", "Strand", "Use"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#FFEDD5", color: "#7C2D12", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                          </thead>
                          <tbody>
                            {brunelloReferenceGuideSet.guides.map((guide) => (
                              <tr key={guide.spacer}>
                                <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontFamily: "Consolas, monospace", fontSize: 13 }}>{guide.spacer}</td>
                                <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontFamily: "Consolas, monospace", fontSize: 13 }}>{guide.pam}</td>
                                <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>Exon {guide.exon}</td>
                                <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{guide.ruleSet2}</td>
                                <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{guide.transcript}</td>
                                <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{guide.strand}</td>
                                <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    <ActionButton variant="warm" onClick={() => applyBrunelloGuideToSelectedKo(0, guide)} style={{ padding: "6px 8px", fontSize: 12 }}>
                                      Use as gRNA1
                                    </ActionButton>
                                    <ActionButton variant="warm" onClick={() => applyBrunelloGuideToSelectedKo(1, guide)} style={{ padding: "6px 8px", fontSize: 12 }}>
                                      Use as gRNA2
                                    </ActionButton>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!!brunelloLocalCandidates.length && (
                          <div style={{ marginTop: 14 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#9A3412" }}>Local pair designs from the top 3 Brunello guides</div>
                            <div style={{ color: "#7C2D12", fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                              These pairs are remapped onto your selected reference. Preferred same-exon pairs in the 40-140 bp window are listed first, and other local same-exon pairs are kept for manual review with recalculated primers.
                            </div>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead>
                                <tr>{["Pair", "Exon", "Spacing", "Amplicon", "Primers", "Apply"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#FFEDD5", color: "#7C2D12", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                              </thead>
                              <tbody>
                                {brunelloLocalCandidates.map((candidate) => (
                                  <tr key={candidate.id}>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                      <div style={{ fontWeight: 700 }}>{candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}</div>
                                      <div style={{ fontFamily: "Consolas, monospace", color: "#7C2D12", fontSize: 11 }}>{candidate.result.gs?.[0]?.sp}</div>
                                      <div style={{ fontFamily: "Consolas, monospace", color: "#7C2D12", fontSize: 11 }}>{candidate.result.gs?.[1]?.sp}</div>
                                    </td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{candidate.exonLabel}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                      {Number.isFinite(candidate.spacing) ? `${candidate.spacing} bp${candidate.candidateMode === "local" ? " (review)" : ""}` : "n/a"}
                                    </td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{candidate.result.amp || "n/a"}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 11, fontFamily: "Consolas, monospace" }}>
                                      <div>Fw: {candidate.result.ps?.[0]?.s || "n/a"}</div>
                                      <div>Rev: {candidate.result.ps?.[1]?.s || "n/a"}</div>
                                    </td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                      <ActionButton variant="warm" onClick={() => applyKoGuidePairToSelected(candidate)} style={{ padding: "6px 8px", fontSize: 12 }}>
                                        Use pair
                                      </ActionButton>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!!brunelloReviewOnlyCount && (
                          <CollapsiblePanel
                            title="Review-only alternative pairs"
                            summary={`${brunelloReviewOnlyCount} edge-case candidate${brunelloReviewOnlyCount === 1 ? "" : "s"}`}
                            tone="warm"
                            style={{ marginTop: 14, marginBottom: 0 }}
                          >
                        {!!brunelloDeletionCandidates.length && (
                          <div style={{ marginTop: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#9A3412" }}>Long-range deletion-screen pairs from the top 3 Brunello guides</div>
                            <div style={{ color: "#7C2D12", fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                              These guide pairs are far apart on your selected reference, so the app designs flanking junction-PCR primers to amplify the deletion band and reports the expected deletion size.
                            </div>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead>
                                <tr>{["Pair", "Exon location", "Deletion size", "Amplicon", "Primers", "Apply"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#FFEDD5", color: "#7C2D12", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                              </thead>
                              <tbody>
                                {brunelloDeletionCandidates.map((candidate) => (
                                  <tr key={candidate.id}>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                      <div style={{ fontWeight: 700 }}>{candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}</div>
                                      <div style={{ fontFamily: "Consolas, monospace", color: "#7C2D12", fontSize: 11 }}>{candidate.result.gs?.[0]?.sp}</div>
                                      <div style={{ fontFamily: "Consolas, monospace", color: "#7C2D12", fontSize: 11 }}>{candidate.result.gs?.[1]?.sp}</div>
                                    </td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{candidate.exonLabel}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{Number.isFinite(candidate.deletionSize) ? `~${candidate.deletionSize} bp` : "n/a"}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{candidate.result.amp || "n/a"}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 11, fontFamily: "Consolas, monospace" }}>
                                      <div>Fw: {candidate.result.ps?.[0]?.s || "n/a"}</div>
                                      <div>Rev: {candidate.result.ps?.[1]?.s || "n/a"}</div>
                                    </td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                      <button type="button" onClick={() => applyKoGuidePairToSelected(candidate)} style={{ ...FIELD_STYLE, width: "auto", padding: "6px 8px", background: "#ffffff", color: "#9A3412", borderColor: "#FDBA74", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                        Use pair
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!!brunelloCrossExonCandidates.length && (
                          <div style={{ marginTop: 14 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#9A3412" }}>Cross-exon review pairs from the top 3 Brunello guides</div>
                            <div style={{ color: "#7C2D12", fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                              These pairs remap across different local exons. They are kept for manual review, with recalculated spacing and recommended primers, but are not preferred default KO pairs.
                            </div>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead>
                                <tr>{["Pair", "Exon location", "Spacing", "Amplicon", "Primers", "Apply"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#FFEDD5", color: "#7C2D12", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                              </thead>
                              <tbody>
                                {brunelloCrossExonCandidates.map((candidate) => (
                                  <tr key={candidate.id}>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                      <div style={{ fontWeight: 700 }}>{candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}</div>
                                      <div style={{ fontFamily: "Consolas, monospace", color: "#7C2D12", fontSize: 11 }}>{candidate.result.gs?.[0]?.sp}</div>
                                      <div style={{ fontFamily: "Consolas, monospace", color: "#7C2D12", fontSize: 11 }}>{candidate.result.gs?.[1]?.sp}</div>
                                    </td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{candidate.exonLabel}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{Number.isFinite(candidate.spacing) ? `${candidate.spacing} bp (review)` : "n/a"}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>{candidate.result.amp || "n/a"}</td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 11, fontFamily: "Consolas, monospace" }}>
                                      <div>Fw: {candidate.result.ps?.[0]?.s || "n/a"}</div>
                                      <div>Rev: {candidate.result.ps?.[1]?.s || "n/a"}</div>
                                    </td>
                                    <td style={{ padding: "8px 10px", border: "1px solid #FDBA74", background: "#ffffff", fontSize: 13 }}>
                                      <button type="button" onClick={() => applyKoGuidePairToSelected(candidate)} style={{ ...FIELD_STYLE, width: "auto", padding: "6px 8px", background: "#ffffff", color: "#9A3412", borderColor: "#FDBA74", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                        Use pair
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!!brunelloFilteredPairs.length && (
                          <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "#FFF7ED", border: "1px solid #FDBA74", color: "#7C2D12", fontSize: 12, lineHeight: 1.6 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>Filtered Brunello pairs</div>
                            {brunelloFilteredPairs.map((candidate) => (
                              <div key={candidate.id}>
                                {candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}: {candidate.reason}
                              </div>
                            ))}
                          </div>
                        )}
                          </CollapsiblePanel>
                        )}
                        {!brunelloLocalCandidates.length && !brunelloDeletionCandidates.length && hasSequenceBackedReference(selectedEntry.row) && (
                          <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "#FFF7ED", border: "1px solid #FDBA74", color: "#7C2D12", fontSize: 13, lineHeight: 1.55 }}>
                            No same-exon local Brunello guide pairs within 40-140 bp were found after remapping onto your selected reference.
                          </div>
                        )}
                      </CollapsiblePanel>
                    )}
                    <CollapsiblePanel
                      title="Backup KO guides: Cas-Database"
                      summary={`${casDatabaseLocalCandidates.length} same-exon alternative${casDatabaseLocalCandidates.length === 1 ? "" : "s"}${casDatabaseReviewOnlyCount ? ` · ${casDatabaseReviewOnlyCount} review-only` : ""}`}
                    >
                      <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                        Optional backup guides from Cas-Database. Use these if you want additional alternatives to the primary pair shown above.
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 10 }}>
                        <label>
                          <div style={{ color: "#667085", fontSize: 13, marginBottom: 6 }}>Cas-Database organism</div>
                          <select value={casDbOrganismId} onChange={(event) => setCasDbOrganismId(event.target.value)} style={{ ...SELECT_STYLE, width: 240, backgroundColor: "#ffffff", color: "#111827", borderColor: "#d7dee7", backgroundImage: "linear-gradient(45deg, transparent 50%, #667085 50%), linear-gradient(135deg, #667085 50%, transparent 50%)" }}>
                            {CAS_DATABASE_ORGANISM_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        <Badge>{selectedEntry.result.gene}</Badge>
                        {casDbLookup.status === "success" && casDbLookup.data?.tierLabel && <Badge color={COLORS.success}>{casDbLookup.data.tierLabel}</Badge>}
                      </div>
                      {casDbLookup.status === "loading" && (
                        <div style={{ marginBottom: 10, color: "#667085", fontSize: 13 }}>
                          Loading Cas-Database reference guides...
                        </div>
                      )}
                      {casDbLookup.status === "error" && (
                        <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "#FEF3F2", border: "1px solid #FECDCA", color: "#B42318", fontSize: 13 }}>
                          {casDbLookup.error}
                        </div>
                      )}
                      {casDbLookup.status === "success" && (
                        <>
                          <div style={{ color: "#475467", fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                            {casDbLookup.data.note}
                            {casDbLookup.data.matchedGene?.ensembl_id ? ` Gene match: ${casDbLookup.data.matchedGene.symbol} (${casDbLookup.data.matchedGene.ensembl_id}).` : ""}
                          </div>
                          {!casDbLookup.data.targets?.length && (
                            <div style={{ color: "#667085", fontSize: 13 }}>No reference guides were returned for the selected filter tiers.</div>
                          )}
                              {!!casDbLookup.data.targets?.length && (
                                <>
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr>{["Spacer", "PAM", "Location", "Strand", "Off-targets (0/1/2)", "OOF", "Coverage", "Best CDS %", "Use"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#E2E8F0", color: "#111827", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                                </thead>
                                <tbody>
                                  {casDbLookup.data.targets.map((target) => (
                                    <tr key={target.id}>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontFamily: "Consolas, monospace", fontSize: 13 }}>{target.spacer}</td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontFamily: "Consolas, monospace", fontSize: 13 }}>{target.pam || "n/a"}</td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                        {target.location || "n/a"}
                                      </td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{target.strand || "n/a"}</td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{target.offTargetCounts.join("/")}</td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{target.oofScore.toFixed(2)}</td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{target.coverage}</td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{target.bestCdsPercentage === null ? "n/a" : `${target.bestCdsPercentage.toFixed(2)}%`}</td>
                                      <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                          <ActionButton variant="secondary" onClick={() => applyCasDatabaseGuideToSelectedKo(0, target)} style={{ padding: "6px 8px", fontSize: 12 }}>
                                            Use as gRNA1
                                          </ActionButton>
                                          <ActionButton variant="secondary" onClick={() => applyCasDatabaseGuideToSelectedKo(1, target)} style={{ padding: "6px 8px", fontSize: 12 }}>
                                            Use as gRNA2
                                          </ActionButton>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {!!casDatabaseLocalCandidates.length && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#111827" }}>Local pair designs from the top 3 Cas-Database guides</div>
                                  <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                                    These pairs are remapped onto your selected reference. Preferred same-exon pairs in the 40-140 bp window are listed first, and other local same-exon pairs are kept for manual review with recalculated primers.
                                  </div>
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                      <tr>{["Pair", "Exon", "Spacing", "Amplicon", "Primers", "Apply"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#E2E8F0", color: "#111827", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                      {casDatabaseLocalCandidates.map((candidate) => (
                                        <tr key={candidate.id}>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                            <div style={{ fontWeight: 700 }}>{candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}</div>
                                            <div style={{ fontFamily: "Consolas, monospace", color: "#334155", fontSize: 11 }}>{candidate.result.gs?.[0]?.sp}</div>
                                            <div style={{ fontFamily: "Consolas, monospace", color: "#334155", fontSize: 11 }}>{candidate.result.gs?.[1]?.sp}</div>
                                          </td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{candidate.exonLabel}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                            {Number.isFinite(candidate.spacing) ? `${candidate.spacing} bp${candidate.candidateMode === "local" ? " (review)" : ""}` : "n/a"}
                                          </td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{candidate.result.amp || "n/a"}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 11, fontFamily: "Consolas, monospace" }}>
                                            <div>Fw: {candidate.result.ps?.[0]?.s || "n/a"}</div>
                                            <div>Rev: {candidate.result.ps?.[1]?.s || "n/a"}</div>
                                          </td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                            <ActionButton variant="secondary" onClick={() => applyKoGuidePairToSelected(candidate)} style={{ padding: "6px 8px", fontSize: 12 }}>
                                              Use pair
                                            </ActionButton>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {!!casDatabaseReviewOnlyCount && (
                                <CollapsiblePanel
                                  title="Review-only alternative pairs"
                                  summary={`${casDatabaseReviewOnlyCount} edge-case candidate${casDatabaseReviewOnlyCount === 1 ? "" : "s"}`}
                                  style={{ marginTop: 14, marginBottom: 0 }}
                                >
                              {!!casDatabaseDeletionCandidates.length && (
                                <div style={{ marginTop: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#111827" }}>Long-range deletion-screen pairs from the top 3 Cas-Database guides</div>
                                  <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                                    These guide pairs are far apart on your selected reference, so the app designs flanking junction-PCR primers to amplify the deletion band and reports the expected deletion size.
                                  </div>
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                      <tr>{["Pair", "Exon location", "Deletion size", "Amplicon", "Primers", "Apply"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#E2E8F0", color: "#111827", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                      {casDatabaseDeletionCandidates.map((candidate) => (
                                        <tr key={candidate.id}>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                            <div style={{ fontWeight: 700 }}>{candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}</div>
                                            <div style={{ fontFamily: "Consolas, monospace", color: "#334155", fontSize: 11 }}>{candidate.result.gs?.[0]?.sp}</div>
                                            <div style={{ fontFamily: "Consolas, monospace", color: "#334155", fontSize: 11 }}>{candidate.result.gs?.[1]?.sp}</div>
                                          </td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{candidate.exonLabel}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{Number.isFinite(candidate.deletionSize) ? `~${candidate.deletionSize} bp` : "n/a"}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{candidate.result.amp || "n/a"}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 11, fontFamily: "Consolas, monospace" }}>
                                            <div>Fw: {candidate.result.ps?.[0]?.s || "n/a"}</div>
                                            <div>Rev: {candidate.result.ps?.[1]?.s || "n/a"}</div>
                                          </td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                            <button type="button" onClick={() => applyKoGuidePairToSelected(candidate)} style={{ ...FIELD_STYLE, width: "auto", padding: "6px 8px", background: "#ffffff", color: "#111827", borderColor: "#D0D5DD", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                              Use pair
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {!!casDatabaseCrossExonCandidates.length && (
                                <div style={{ marginTop: 14 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#111827" }}>Cross-exon review pairs from the top 3 Cas-Database guides</div>
                                  <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                                    These pairs remap across different local exons. They are kept for manual review, with recalculated spacing and recommended primers, but are not preferred default KO pairs.
                                  </div>
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                      <tr>{["Pair", "Exon location", "Spacing", "Amplicon", "Primers", "Apply"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#E2E8F0", color: "#111827", textAlign: "left", fontSize: 13 }}>{label}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                      {casDatabaseCrossExonCandidates.map((candidate) => (
                                        <tr key={candidate.id}>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                            <div style={{ fontWeight: 700 }}>{candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}</div>
                                            <div style={{ fontFamily: "Consolas, monospace", color: "#334155", fontSize: 11 }}>{candidate.result.gs?.[0]?.sp}</div>
                                            <div style={{ fontFamily: "Consolas, monospace", color: "#334155", fontSize: 11 }}>{candidate.result.gs?.[1]?.sp}</div>
                                          </td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{candidate.exonLabel}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{Number.isFinite(candidate.spacing) ? `${candidate.spacing} bp (review)` : "n/a"}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>{candidate.result.amp || "n/a"}</td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 11, fontFamily: "Consolas, monospace" }}>
                                            <div>Fw: {candidate.result.ps?.[0]?.s || "n/a"}</div>
                                            <div>Rev: {candidate.result.ps?.[1]?.s || "n/a"}</div>
                                          </td>
                                          <td style={{ padding: "8px 10px", border: "1px solid #D0D5DD", background: "#ffffff", fontSize: 13 }}>
                                            <button type="button" onClick={() => applyKoGuidePairToSelected(candidate)} style={{ ...FIELD_STYLE, width: "auto", padding: "6px 8px", background: "#ffffff", color: "#111827", borderColor: "#D0D5DD", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                              Use pair
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {!!casDatabaseFilteredPairs.length && (
                                <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "#F8FAFC", border: "1px solid #D0D5DD", color: "#475467", fontSize: 12, lineHeight: 1.6 }}>
                                  <div style={{ fontWeight: 700, marginBottom: 6, color: "#111827" }}>Filtered Cas-Database pairs</div>
                                  {casDatabaseFilteredPairs.map((candidate) => (
                                    <div key={candidate.id}>
                                      {candidate.sourceIndexes[0]} + {candidate.sourceIndexes[1]}: {candidate.reason}
                                    </div>
                                  ))}
                                </div>
                              )}
                                </CollapsiblePanel>
                              )}
                              {!casDatabaseLocalCandidates.length && !casDatabaseDeletionCandidates.length && hasSequenceBackedReference(selectedEntry.row) && (
                                <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "#F8FAFC", border: "1px solid #D0D5DD", color: "#475467", fontSize: 13, lineHeight: 1.55 }}>
                                  No same-exon local Cas-Database guide pairs within 40-140 bp were found after remapping onto your selected reference.
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </CollapsiblePanel>
                  </>
                )}
                {selectedEntry.result.type === "it" && (
                  <>
                    <InternalProteinPreviewCard result={selectedEntry.result} />
                    <InsertValidationCard validation={selectedEntry.result.insertValidation} />
                    {(selectedEntry.result.os || []).map((donor) => <InternalDonorPreview key={donor.n} donor={donor} releaseStatus={getDonorReleaseStatus(selectedEntry.result, donor.guideName)} />)}
                  </>
                )}
                {(selectedEntry.result.type === "ct" || selectedEntry.result.type === "nt") && (
                  <>
                    <KnockinProteinPreviewCard preview={selectedEntry.result.proteinPreview} />
                    <InsertValidationCard validation={selectedEntry.result.insertValidation} />
                    <DonorFormatCard result={selectedEntry.result} />
                    <AnnotatedDonor sequence={selectedEntry.result.donor} annotations={selectedEntry.result.donorAnnotations} />
                  </>
                )}
                {buildSsOdnNotes(selectedEntry.result).map((line) => <div key={line} style={{ color: "#CC0000", fontWeight: 700, marginTop: 6 }}>{line}</div>)}

                {hasHistoricalMatches && (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 8px 0" }}>5. Matched Historical Records</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                      <thead>
                        <tr>{["Gene", "Parental line", "Established line", "Used gRNAs", "Used donor", "Guide overlap"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#5D7288", color: "#ffffff", textAlign: "left" }}>{label}</th>)}</tr>
                      </thead>
                      <tbody>
                        {historicalContext.topMatches.map((record) => (
                          <tr key={record.projectId}>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{record.targetGene || "n/a"}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{record.parentalLine || "n/a"}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{record.establishedLine || "n/a"}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff", fontFamily: "Consolas, monospace", fontSize: 12, wordBreak: "break-all" }}>
                              {(record.guides || []).map((guide) => guide.sequence).filter(Boolean).join(" | ") || "n/a"}
                            </td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff", fontFamily: "Consolas, monospace", fontSize: 12, wordBreak: "break-all" }}>
                              {record.donorSequence || "N/A"}
                            </td>
                            <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{record.guideOverlap ? `${record.guideOverlap} exact` : "none"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 8px 0" }}>{reviewSectionNumber}. Review Checkpoints</div>
                {!reviewItems.length && <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>No automated warnings were triggered. Manual review is still required before synthesis or ordering.</div>}
                {reviewItems.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {reviewItems.map((item, index) => (
                      <div key={`${item.level}-${index}`} style={{ color: item.level === "warning" ? "#B42318" : "#344054", fontSize: 13, lineHeight: 1.5, marginBottom: 6 }}>
                        - <strong>{item.level === "warning" ? "Warning" : "Check"}:</strong> {item.text}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 8px 0" }}>{additionalInfoSectionNumber}. Additional Info</div>
                <div style={{ fontSize: 13, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{buildDesignSummary(selectedEntry.result)}</div>
              </>
            )}
          </div>
        </div>
        )}

        {activeTab === "primers" && (
        <div style={{ ...CARD_STYLE, marginTop: 18, background: "linear-gradient(180deg, rgba(14,42,46,0.96), rgba(12,23,38,0.96))" }}>
          <SectionTitle>3. Primer Tool</SectionTitle>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Standalone PCR primer design</div>
              <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.55, maxWidth: 780 }}>
                Design assay primers directly from the selected design reference, a GenBank upload, or pasted raw DNA. The same validated primer rules used in the CRISPR design engine are reused here.
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {selectedEntry?.result?.gb && (
                <button type="button" onClick={() => updatePrimerTool("sourceType", "selected")} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700 }}>
                  Use selected design reference
                </button>
              )}
              <button type="button" onClick={runPrimerToolDesign} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700, background: "rgba(89,199,189,0.18)", borderColor: "rgba(89,199,189,0.45)" }}>
                Design primers
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 }}>
            <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${COLORS.borderSoft}`, background: "rgba(8,18,32,0.30)" }}>
              <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Reference source</div>
              <Grid>
                <label>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Input type</div>
                  <select value={primerTool.sourceType} onChange={(event) => updatePrimerTool("sourceType", event.target.value)} style={SELECT_STYLE}>
                    <option value="selected">Selected design reference</option>
                    <option value="genbank">GenBank file</option>
                    <option value="raw">Raw DNA</option>
                  </select>
                </label>
                <label>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Primer name prefix</div>
                  <input value={primerTool.primerNamePrefix} onChange={(event) => updatePrimerTool("primerNamePrefix", event.target.value)} style={FIELD_STYLE} placeholder="Primer" />
                </label>
                <label>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Sequence label</div>
                  <input value={primerTool.sequenceName} onChange={(event) => updatePrimerTool("sequenceName", event.target.value)} style={FIELD_STYLE} placeholder="APOE exon assay" />
                </label>
              </Grid>

              {primerTool.sourceType === "selected" && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(7,17,28,0.24)", border: `1px solid ${COLORS.borderSoft}`, color: COLORS.muted, fontSize: 13, lineHeight: 1.55 }}>
                  {selectedEntry?.result?.gb
                    ? `Using the currently selected design reference${selectedEntry?.result?.gene ? ` for ${selectedEntry.result.gene}` : ""}.`
                    : "No generated design is selected yet. Generate a design first or switch to GenBank/raw DNA input."}
                </div>
              )}

              {primerTool.sourceType === "genbank" && (
                <label style={{ display: "block", marginTop: 12 }}>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>GenBank upload</div>
                  <label style={{ ...FIELD_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                    <span style={{ color: primerTool.fileName ? COLORS.success : COLORS.muted }}>{primerTool.fileName || "Upload .gb / .gbk / .genbank"}</span>
                    <span style={{ color: COLORS.accent, fontWeight: 700 }}>Browse</span>
                    <input type="file" accept=".gb,.gbk,.genbank,.txt" onChange={onPrimerToolFile} style={{ display: "none" }} />
                  </label>
                </label>
              )}

              {primerTool.sourceType === "raw" && (
                <label style={{ display: "block", marginTop: 12 }}>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Raw DNA sequence</div>
                  <textarea value={primerTool.rawSequence} onChange={(event) => updatePrimerTool("rawSequence", event.target.value)} style={{ ...FIELD_STYLE, minHeight: 160, resize: "vertical", fontFamily: "Consolas, monospace" }} placeholder="Paste DNA sequence using A/C/G/T/N" />
                </label>
              )}
            </div>

            <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${COLORS.borderSoft}`, background: "rgba(8,18,32,0.24)" }}>
              <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Assay configuration</div>
              <Grid>
                <label>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Mode</div>
                  <select value={primerTool.mode} onChange={(event) => updatePrimerTool("mode", event.target.value)} style={SELECT_STYLE}>
                    <option value="centered">Centered assay</option>
                    <option value="flanking">Flanking interval</option>
                    <option value="deletion">Deletion screen</option>
                  </select>
                </label>
                <label>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Min amplicon</div>
                  <input value={primerTool.minAmp} onChange={(event) => updatePrimerTool("minAmp", event.target.value)} style={FIELD_STYLE} placeholder="450" />
                </label>
                <label>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Max amplicon</div>
                  <input value={primerTool.maxAmp} onChange={(event) => updatePrimerTool("maxAmp", event.target.value)} style={FIELD_STYLE} placeholder="500" />
                </label>
                <label>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Target amplicon</div>
                  <input value={primerTool.desiredAmp} onChange={(event) => updatePrimerTool("desiredAmp", event.target.value)} style={FIELD_STYLE} placeholder="475" />
                </label>
              </Grid>

              {primerTool.mode === "centered" && (
                <label style={{ display: "block", marginTop: 12 }}>
                  <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Target position (1-based)</div>
                  <input value={primerTool.center} onChange={(event) => updatePrimerTool("center", event.target.value)} style={FIELD_STYLE} placeholder="742" />
                </label>
              )}

              {primerTool.mode === "flanking" && (
                <Grid style={{ marginTop: 12 }}>
                  <label>
                    <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Interval start (1-based)</div>
                    <input value={primerTool.intervalStart} onChange={(event) => updatePrimerTool("intervalStart", event.target.value)} style={FIELD_STYLE} placeholder="701" />
                  </label>
                  <label>
                    <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Interval end (1-based)</div>
                    <input value={primerTool.intervalEnd} onChange={(event) => updatePrimerTool("intervalEnd", event.target.value)} style={FIELD_STYLE} placeholder="760" />
                  </label>
                </Grid>
              )}

              {primerTool.mode === "deletion" && (
                <>
                  <Grid style={{ marginTop: 12 }}>
                    <label>
                      <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Left cut (1-based)</div>
                      <input value={primerTool.leftCut} onChange={(event) => updatePrimerTool("leftCut", event.target.value)} style={FIELD_STYLE} placeholder="820" />
                    </label>
                    <label>
                      <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Right cut (1-based)</div>
                      <input value={primerTool.rightCut} onChange={(event) => updatePrimerTool("rightCut", event.target.value)} style={FIELD_STYLE} placeholder="1240" />
                    </label>
                    <label>
                      <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>Target flank</div>
                      <input value={primerTool.flank} onChange={(event) => updatePrimerTool("flank", event.target.value)} style={FIELD_STYLE} placeholder="250" />
                    </label>
                  </Grid>
                  <div style={{ marginTop: 8, color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>
                    Deletion-screen mode reports both the WT and expected deletion-band amplicon sizes.
                  </div>
                </>
              )}
            </div>
          </div>

          {primerToolError && <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: "rgba(251,113,133,0.10)", border: `1px solid ${COLORS.danger}55`, color: COLORS.danger }}>{primerToolError}</div>}

          {primerToolResult && (
            <div style={{ marginTop: 10, padding: 14, borderRadius: 14, background: "linear-gradient(180deg, #fbf8f1, #f4efe4)", color: "#2c3340", border: "1px solid #d8cfbf", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Primer set ready</div>
                  <div style={{ color: "#667085", fontSize: 13, lineHeight: 1.55 }}>
                    {primerToolResult.sourceLabel} | {primerToolResult.targetSummary} | {primerToolResult.amp}
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Badge color={COLORS.success}>{primerToolResult.ps?.length || 0} primers</Badge>
                  <Badge>{primerToolResult.strategy}</Badge>
                  <Badge>{primerToolResult.sequenceLength} bp reference</Badge>
                  {primerTool.sourceType === "selected" && selectedEntry?.rowId && (
                    <button type="button" onClick={applyPrimerToolToSelectedDesign} style={{ ...FIELD_STYLE, width: "auto", cursor: "pointer", fontWeight: 700, minHeight: 34, padding: "6px 10px", background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }}>
                      Use in selected design report
                    </button>
                  )}
                </div>
              </div>

              <div style={{ fontSize: 15, fontWeight: 700, margin: "6px 0 8px 0" }}>Primary primer pair</div>
              <PrimerQualityCard result={primerToolResult} />
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
                <thead>
                  <tr>{["Name", "Sequence", "Length", "Tm", "GC", "3' clamp"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#5D7288", color: "#ffffff", textAlign: "left" }}>{label}</th>)}</tr>
                </thead>
                <tbody>
                  {buildPrimerRows(primerToolResult).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff", fontFamily: cellIndex === 1 ? "Consolas, monospace" : "inherit" }}>{cell}</td>)}</tr>)}
                </tbody>
              </table>

              {!!buildPrimerCandidateRows(primerToolResult).length && (
                <>
                  <div style={{ fontSize: 15, fontWeight: 700, margin: "6px 0 8px 0" }}>Alternative validated pairs</div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{["Rank", "Fw", "Fw Tm", "Fw GC", "Fw clamp", "Rev", "Rev Tm", "Rev GC", "Rev clamp", "Amplicon"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #bbbbbb", background: "#E5E7EB", color: "#111827", textAlign: "left", fontSize: 12 }}>{label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {buildPrimerCandidateRows(primerToolResult).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} style={{ padding: "8px 10px", border: "1px solid #bbbbbb", background: "#ffffff", fontFamily: cellIndex === 1 || cellIndex === 5 ? "Consolas, monospace" : "inherit", fontSize: 12 }}>{cell}</td>)}</tr>)}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
        )}

        {activeTab === "exports" && (
        <div style={{ ...CARD_STYLE, marginTop: 18 }}>
          <SectionTitle>4. Order Exports</SectionTitle>
          <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
            Successful designs are flattened into procurement-draft spreadsheets for gRNAs, primers, and donors. A successful computation is not the same as an order-ready design; resolve the review status shown below before uploading a template to a vendor.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <Badge color={COLORS.success}>{batchSuccessfulResults.length} successful designs</Badge>
            <Badge>{batchOrderRows.length} order lines</Badge>
            {!!procurementBlockedCount && <Badge color={COLORS.danger}>{procurementBlockedCount} procurement blocked</Badge>}
            {!!procurementReviewCount && <Badge color="#B45309">{procurementReviewCount} require review</Badge>}
            {batchCopyState && <Badge color={COLORS.success}>{batchCopyState}</Badge>}
          </div>
          {batchError && <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: "rgba(251,113,133,0.10)", border: `1px solid ${COLORS.danger}55`, color: COLORS.danger }}>{batchError}</div>}

          {batchSuccessfulResults.length > 0 && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "linear-gradient(180deg, #fbf8f1, #f4efe4)", color: "#2c3340", border: "1px solid #d8cfbf", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)", overflowX: "auto" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Spreadsheet Template Export</div>
              <div style={{ color: "#667085", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
                These downloads match the headers in your current upload templates:
                `template-paste-entry-crispr.xlsx`, `template-paste-entry.xlsx`, and `template-paste-entry-hdr.xlsx`. Designs with blocked procurement status are excluded. The vendor-format sheets cannot carry the full safety review, so retain the combined preview or saved `order_preview.csv` with them.
              </div>
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                <Grid>
                  <label>
                    <div style={{ color: "#667085", fontSize: 13, marginBottom: 6 }}>CRISPR scale</div>
                    <input value={idtDefaults.crisprScale} onChange={(event) => updateIdtDefault("crisprScale", event.target.value)} style={{ ...FIELD_STYLE, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }} placeholder="25nm" />
                  </label>
                  <label>
                    <div style={{ color: "#667085", fontSize: 13, marginBottom: 6 }}>Primer scale</div>
                    <input value={idtDefaults.oligoScale} onChange={(event) => updateIdtDefault("oligoScale", event.target.value)} style={{ ...FIELD_STYLE, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }} placeholder="25nm" />
                  </label>
                  <label>
                    <div style={{ color: "#667085", fontSize: 13, marginBottom: 6 }}>Primer purification</div>
                    <input value={idtDefaults.oligoPurification} onChange={(event) => updateIdtDefault("oligoPurification", event.target.value)} style={{ ...FIELD_STYLE, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }} placeholder="STD" />
                  </label>
                  <label>
                    <div style={{ color: "#667085", fontSize: 13, marginBottom: 6 }}>HDR scale</div>
                    <input value={idtDefaults.hdrScale} onChange={(event) => updateIdtDefault("hdrScale", event.target.value)} style={{ ...FIELD_STYLE, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }} placeholder="4nmU" />
                  </label>
                  <label>
                    <div style={{ color: "#667085", fontSize: 13, marginBottom: 6 }}>HDR modification</div>
                    <input value={idtDefaults.hdrModification} onChange={(event) => updateIdtDefault("hdrModification", event.target.value)} style={{ ...FIELD_STYLE, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }} placeholder="None or phosphorothioate format" />
                  </label>
                </Grid>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <button type="button" disabled={!idtTemplateRows.crispr.length} onClick={() => downloadIdtTemplate("crispr")} style={{ ...FIELD_STYLE, width: "auto", cursor: idtTemplateRows.crispr.length ? "pointer" : "not-allowed", fontWeight: 700, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }}>
                    Download CRISPR template
                  </button>
                  <button type="button" disabled={!idtTemplateRows.oligo.length} onClick={() => downloadIdtTemplate("oligo")} style={{ ...FIELD_STYLE, width: "auto", cursor: idtTemplateRows.oligo.length ? "pointer" : "not-allowed", fontWeight: 700, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }}>
                    Download primer template
                  </button>
                  <button type="button" disabled={!idtTemplateRows.hdr.length} onClick={() => downloadIdtTemplate("hdr")} style={{ ...FIELD_STYLE, width: "auto", cursor: idtTemplateRows.hdr.length ? "pointer" : "not-allowed", fontWeight: 700, background: "#ffffff", color: "#111827", borderColor: "#d7dee7" }}>
                    Download HDR template
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Combined Order Preview</div>
              <div style={{ color: "#667085", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
                This preview carries the procurement status that vendor templates cannot. For gRNAs, the exported sequence is the spacer without PAM. For SNP donors, the exported donor is the recommended order strand.
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1280 }}>
                <thead>
                  {/* Same safety-relevant columns as order_preview.csv. "Recommended" was in the
                      CSV and not on screen, which is the screen-versus-download divergence this
                      app keeps removing: the file said do-not-order and the preview did not. */}
                  <tr>{["Slot", "Design", "Review Status", "Item", "Name", "Sequence To Order", "PAM", "Strand", "Length", "Linked Guide", "Recommended", "Notes"].map((label) => <th key={label} style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#5D7288", color: "#ffffff", textAlign: "left" }}>{label}</th>)}</tr>
                </thead>
                <tbody>
                  {batchOrderRows.map((row, rowIndex) => (
                    <tr key={`${row.slot}-${row.itemType}-${row.name}-${rowIndex}`}>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.slot}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.designLabel}</td>
                      <td title={row.reviewNotes || ""} style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: row.reviewStatus === "blocked" ? "#FEE2E2" : row.reviewStatus === "review" ? "#FEF3C7" : "#DCFCE7", fontWeight: 700 }}>{row.reviewStatus}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.itemType}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.name}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff", fontFamily: "Consolas, monospace", wordBreak: "break-all" }}>{row.sequence}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff", fontFamily: "Consolas, monospace" }}>{row.pam || "n/a"}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.strand || "n/a"}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.length}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.linkedGuide || "n/a"}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: /do not order|^No\b/i.test(row.recommended || "") ? "#FEE2E2" : /accepted/i.test(row.recommended || "") ? "#FEF0C7" : "#ffffff", fontWeight: 600 }}>{row.recommended || ""}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #cfc5b4", background: "#ffffff" }}>{row.notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        <div style={{ color: COLORS.dim, fontSize: 12, marginTop: 18, textAlign: "center", lineHeight: 1.6 }}>
          <div>{APP_FOOTER_LABEL}</div>
          <div>Current host: {currentHost}</div>
        </div>
      </div>
      {copyState && <FloatingNotice tone="success">{copyState}</FloatingNotice>}
      {!copyState && batchCopyState && <FloatingNotice tone="success">{batchCopyState}</FloatingNotice>}
      {!copyState && !batchCopyState && batchError && <FloatingNotice tone="danger">{batchError}</FloatingNotice>}
    </div>
  );
}
