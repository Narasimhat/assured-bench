// Report inputs: the provenance, precedent and review-checklist data a report is built
// from. Kept free of React so the CLI and the test suite can build a report without a DOM.
//
// These lived in App.jsx, which meant `buildReportHtml` was importable outside React but
// its three inputs were not - so the only way to produce a report was to run the browser
// app. That is why the CLI could not export the report the app downloads.
//
// Do not import react here, and do not add JSX.
import { HISTORICAL_PROJECTS } from "./data/historicalProjects.js";
import { normalizeGeneToken } from "./reportHtml.js";
import { summarizeGuideBlocking } from "./designEngine.js";


export function buildRowMeta(row, result = null) {
  return {
    irisId: row?.irisId || "",
    clientId: "",
    clientName: row?.clientName || "",
    requester: "",
    gene: row?.gene || result?.gene || "",
    cellLine: row?.cellLine || "",
    editSummary: row?.editSummary || row?.label || "",
    notes: row?.notes || "",
    deliveryMethod: row?.deliveryMethod || result?.deliveryMethod || "unknown",
    projectType: row?.projectType || result?.type || "pm",
    referenceSource: row?.referenceSource || "genbank",
  };
}

const CELL_LINE_ALIAS_GROUPS = [
  ["MDCI053A", "HMGUI001A"],
];

function canonicalizeCellLineBase(value) {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (!normalized) return "";
  const withoutClone = normalized.replace(/-\w+$/g, "").replace(/([A-Z0-9]+A)\w*$/, "$1");
  const base = withoutClone || normalized;
  const aliasGroup = CELL_LINE_ALIAS_GROUPS.find((group) => group.includes(base));
  return aliasGroup ? aliasGroup[0] : base;
}

function normalizeCellLine(value) {
  return canonicalizeCellLineBase(value);
}

function inferCurrentHistoricalSubtype(result, projectType) {
  const kind = result?.type || projectType;
  if (kind === "ko") return "ko";
  if (kind === "pm") return "snp_ki";
  if (kind === "ct") return "ct_ki";
  if (kind === "nt") return "nt_ki";
  return "other";
}

function inferHistoricalSubtype(record) {
  const modClass = String(record.modificationClass || "").toLowerCase();
  const modType = String(record.modificationType || "").toLowerCase();
  const donorType = String(record.donorType || "").toLowerCase();
  const descriptor = `${record.modificationDescription || ""} ${record.donorName || ""} ${record.targetGene || ""}`.toLowerCase();

  if (modClass === "ko" || modType === "ko" || descriptor.includes("knockout")) return "ko";
  if (
    modClass === "pm"
    || modType === "snp"
    || donorType === "ssodn"
    || /\b[a-z]\d+[a-z]\b/i.test(record.modificationDescription || "")
    || descriptor.includes(" snp")
  ) return "snp_ki";

  if (modClass === "ki" || modType === "ki") {
    if (
      descriptor.includes("n-term")
      || descriptor.includes("n term")
      || descriptor.includes("nterminal")
      || descriptor.includes("n-terminal")
      || descriptor.includes("start codon")
      || descriptor.includes(" atg")
      || descriptor.includes("exn1")
      || descriptor.includes("exon1")
      || descriptor.includes("exon 1")
    ) return "nt_ki";
    if (
      descriptor.includes("c-term")
      || descriptor.includes("c term")
      || descriptor.includes("cterminal")
      || descriptor.includes("c-terminal")
      || descriptor.includes("stop codon")
      || descriptor.includes("gfp-tag")
      || descriptor.includes("snap-tag")
      || descriptor.includes("sd40")
      || descriptor.includes("dtag")
      || descriptor.includes("maid")
      || descriptor.includes("2xha")
      || descriptor.includes("egfp")
      || descriptor.includes("mcherry")
      || descriptor.includes("mscarlet")
      || descriptor.includes("luc2")
    ) return "ct_ki";
    return "ki_generic";
  }

  return "other";
}

function simplifyTagName(tag) {
  const raw = String(tag || "").replace(/^N:/, "");
  if (/SD40/i.test(raw)) return "SD40";
  if (/dTAG/i.test(raw)) return "dTAG";
  if (/mAID/i.test(raw)) return "mAID";
  if (/2xHA/i.test(raw) && !/SD40|dTAG|mAID/i.test(raw)) return "2xHA";
  if (/EGFP/i.test(raw)) return "EGFP";
  if (/mScarlet/i.test(raw)) return "mScarlet";
  if (/mCherry/i.test(raw)) return "mCherry";
  return raw;
}

function inferCurrentHistoricalSignature(result) {
  if (!result) return "";
  if (result.type === "pm") return `${result.wA}${result.an}${result.mA}`.toLowerCase();
  if (result.type === "ct" || result.type === "nt") return simplifyTagName(result.tag).toLowerCase();
  return "";
}

function inferRecordSpecificMatch(record, targetSubtype, signature) {
  if (!signature) return false;
  const descriptor = `${record.modificationDescription || ""} ${record.donorName || ""} ${record.targetGene || ""}`.toLowerCase();
  if (targetSubtype === "snp_ki") {
    const normalized = signature.replace(/\s+/g, "");
    return descriptor.includes(normalized) || descriptor.includes(`p.${normalized}`);
  }
  if (targetSubtype === "ct_ki" || targetSubtype === "nt_ki") return descriptor.includes(signature);
  return false;
}

function inferCurrentDonorType(result) {
  if (!result) return "none";
  if (result.type === "pm" || result.type === "it") return "ssODN";
  if (result.type === "ko") return "none";
  return "donor";
}

export function buildHistoricalContext(meta, result, projectType) {
  const targetGene = normalizeGeneToken(meta.gene || result?.gene);
  const targetCellLine = normalizeCellLine(meta.cellLine);
  const targetSubtype = inferCurrentHistoricalSubtype(result, projectType);
  const targetSignature = inferCurrentHistoricalSignature(result);
  const currentGuides = new Set((result?.gs || []).map((guide) => guide.sp));
  const donorType = inferCurrentDonorType(result);

  const scored = HISTORICAL_PROJECTS.map((record) => {
    const recordGene = normalizeGeneToken(record.targetGene);
    const recordCellLine = normalizeCellLine(record.parentalLine);
    const sameGene = Boolean(targetGene && recordGene === targetGene);
    const sameCellLine = Boolean(targetCellLine && recordCellLine === targetCellLine);
    const subtype = inferHistoricalSubtype(record);
    const sameSubtype = subtype === targetSubtype;
    const sameSpecificEdit = sameGene && sameSubtype && inferRecordSpecificMatch(record, targetSubtype, targetSignature);
    const compatibleSubtype = sameSubtype
      || ((targetSubtype === "ct_ki" || targetSubtype === "nt_ki") && subtype === "ki_generic");
    const guideOverlap = (record.guides || []).filter((guide) => currentGuides.has(guide.sequence)).length;
    let score = 0;
    if (sameSpecificEdit) score += 12;
    if (sameGene) score += 6;
    if (sameSubtype) score += 6;
    else if (compatibleSubtype) score += 2;
    if (sameCellLine) score += 3;
    if (record.donorType === donorType) score += 1;
    score += guideOverlap * 5;
    return { ...record, sameGene, sameCellLine, sameSubtype, sameSpecificEdit, compatibleSubtype, subtype, guideOverlap, score };
  }).filter((record) => record.score > 0);

  const matches = scored.sort((left, right) => {
    if (right.sameSpecificEdit !== left.sameSpecificEdit) return right.sameSpecificEdit ? 1 : -1;
    if (right.sameGene !== left.sameGene) return right.sameGene ? 1 : -1;
    if (right.sameSubtype !== left.sameSubtype) return right.sameSubtype ? 1 : -1;
    if (right.compatibleSubtype !== left.compatibleSubtype) return right.compatibleSubtype ? 1 : -1;
    if (right.score !== left.score) return right.score - left.score;
    if (right.guideOverlap !== left.guideOverlap) return right.guideOverlap - left.guideOverlap;
    return (left.projectId || "").localeCompare(right.projectId || "");
  });

  const sameSpecificMatches = matches.filter((record) => record.sameSpecificEdit);
  const sameGeneMatches = matches.filter((record) => record.sameGene);
  const sameGeneAndSubtype = matches.filter((record) => record.sameGene && record.sameSubtype);
  const sameGeneAndCell = matches.filter((record) => record.sameGene && record.sameCellLine);
  const sameSubtypeAndCell = matches.filter((record) => record.sameSubtype && record.sameCellLine);
  const compatibleKiMatches = matches.filter((record) => record.compatibleSubtype && !record.sameSubtype);
  const exactGuideReuse = matches.filter((record) => record.guideOverlap > 0);
  const recommendations = [];
  const recommendedGuides = [];
  const recommendedDonors = [];
  const seenGuideSequences = new Set();
  const seenDonorSequences = new Set();

  if (sameSpecificMatches.length) recommendations.push(`Found ${sameSpecificMatches.length} historical record${sameSpecificMatches.length === 1 ? "" : "s"} that appear to match this exact edit signature.`);
  if (sameGeneAndCell.length) recommendations.push(`Found ${sameGeneAndCell.length} established project${sameGeneAndCell.length === 1 ? "" : "s"} for this gene in the same parental line.`);
  if (!sameGeneAndCell.length && sameGeneAndSubtype.length) recommendations.push(`Found ${sameGeneAndSubtype.length} established project${sameGeneAndSubtype.length === 1 ? "" : "s"} for this gene with the same edit subtype.`);
  if (!sameGeneAndSubtype.length && sameSubtypeAndCell.length) recommendations.push(`No same-gene precedent was found, but ${sameSubtypeAndCell.length} established project${sameSubtypeAndCell.length === 1 ? "" : "s"} exist in the same parental line for this exact design subtype.`);
  if (!sameGeneAndSubtype.length && !sameSubtypeAndCell.length && compatibleKiMatches.length) recommendations.push(`Only generic KI precedent was found for this gene or cell line. Orientation-specific KI precedent is limited, so review insertion context manually.`);
  if (exactGuideReuse.length) recommendations.push(`Exact guide reuse appears in ${exactGuideReuse.length} established record${exactGuideReuse.length === 1 ? "" : "s"}; review those projects before ordering.`);
  if (result?.type === "pm" && sameGeneMatches.some((record) => record.donorType === "ssODN")) recommendations.push("Historical matches for this gene used ssODN donors, which supports the current SNP design strategy.");
  if ((result?.type === "ct" || result?.type === "nt") && !sameGeneAndSubtype.length) recommendations.push("No close orientation-matched KI precedent was found in the imported history; verify donor frame, insertion orientation, and junction-PCR plan manually.");

  let prioritizedMatches = [];
  if (sameSpecificMatches.length) prioritizedMatches = sameSpecificMatches;
  else if (sameGeneAndSubtype.length) prioritizedMatches = sameGeneAndSubtype;
  else if (sameGeneMatches.length) prioritizedMatches = sameGeneMatches;
  else if (exactGuideReuse.length) prioritizedMatches = exactGuideReuse;

  prioritizedMatches.forEach((record) => {
    if ((record.sameSubtype || record.compatibleSubtype || record.sameGene || record.sameCellLine || record.guideOverlap > 0) && recommendedGuides.length < 6) {
      (record.guides || []).forEach((guide) => {
        if (recommendedGuides.length >= 6) return;
        if (!guide.sequence || seenGuideSequences.has(guide.sequence)) return;
        seenGuideSequences.add(guide.sequence);
        recommendedGuides.push({
          name: guide.name || "Historical guide",
          sequence: guide.sequence,
          sourceProject: record.projectId,
          sourceLine: record.parentalLine || "n/a",
          matchLabel: record.guideOverlap > 0 ? "exact guide reuse" : record.sameSpecificEdit ? "same edit" : record.sameSubtype ? "same subtype" : record.compatibleSubtype ? "generic KI fallback" : record.sameGene && record.sameCellLine ? "same gene + same line" : record.sameGene ? "same gene" : "same line",
        });
      });
    }

    if ((record.sameSubtype || record.compatibleSubtype || record.sameGene || record.sameCellLine) && record.donorSequence && recommendedDonors.length < 3 && !seenDonorSequences.has(record.donorSequence)) {
      seenDonorSequences.add(record.donorSequence);
      recommendedDonors.push({
        name: record.donorName || "Historical donor",
        sequence: record.donorSequence,
        donorType: record.donorType || "donor",
        sourceProject: record.projectId,
        sourceLine: record.parentalLine || "n/a",
        matchLabel: record.sameSpecificEdit ? "same edit" : record.sameSubtype ? "same subtype" : record.compatibleSubtype ? "generic KI fallback" : record.sameGene && record.sameCellLine ? "same gene + same line" : record.sameGene ? "same gene" : "same line",
      });
    }
  });

  return {
    targetGene,
    targetSubtype,
    totalMatches: matches.length,
    topMatches: prioritizedMatches.slice(0, 6),
    recommendations: recommendations.slice(0, 4),
    recommendedGuides,
    recommendedDonors,
    stats: {
      sameSpecificEdit: sameSpecificMatches.length,
      sameGene: sameGeneMatches.length,
      sameGeneAndSubtype: sameGeneAndSubtype.length,
      sameGeneAndCell: sameGeneAndCell.length,
      sameSubtypeAndCell: sameSubtypeAndCell.length,
      compatibleKiFallbacks: compatibleKiMatches.length,
      exactGuideReuse: exactGuideReuse.length,
    },
  };
}

export function buildReviewItems(meta, result, fileName) {
  if (!result) return [];
  const items = [];

  if (!fileName && result?.gb?.source !== "raw-sequence" && !result?.referenceOnly) items.push({ level: "warning", text: "Reference sequence filename is missing from the report. Keep the exact GenBank record with the final design package." });
  if (!meta.irisId?.trim()) items.push({ level: "warning", text: "IRIS/internal project ID is missing. Assign it before release so the design can be joined to downstream clone-verification records." });
  if (!meta.clientName?.trim()) items.push({ level: "warning", text: "Requesting group is missing from the provenance metadata." });
  if (!result?.gb?.transcriptId && !result?.referenceOnly) items.push({ level: "warning", text: "Transcript identifier is not recorded. Terminal-tag designs must be checked against the intended transcript before ordering." });
  else if (["ct", "nt"].includes(result.type)) items.push({ level: "check", text: `Confirm transcript ${result.gb.transcriptId} against MANE Select or document why another isoform is intended.` });
  if (!meta.notes.trim()) items.push({ level: "check", text: "Record transcript assumptions, exon numbering assumptions, and delivery method before final sign-off." });

  (result.guideSequenceQc || []).forEach((assessment) => {
    assessment.warnings.forEach((warning) => items.push({ level: "warning", text: `${assessment.guideName}: ${warning}` }));
  });

  const outOfRangeGuides = (result.gs || []).filter((guide) => typeof guide.gc === "number" && (guide.gc < 30 || guide.gc > 80));
  if (outOfRangeGuides.length) items.push({ level: "warning", text: `Guide GC content is atypical for ${outOfRangeGuides.length} guide${outOfRangeGuides.length === 1 ? "" : "s"}; review activity and synthesis risk manually.` });

  if (result.type === "pm") {
    const invalidDonors = (result.os || []).filter((donor) => !donor.proteinValidation?.valid);
    if (invalidDonors.length) items.push({ level: "warning", text: `${invalidDonors.length} donor${invalidDonors.length === 1 ? "" : "s"} failed final translated-product validation and must not be ordered.` });
    if (!result.coDeliverySafe && (result.gs || []).length > 1) items.push({ level: "warning", text: result.guideDonorInstruction || "Alternative guides are not jointly blocked in every donor. Use only the matched guide/ssODN pair and do not co-deliver alternatives." });
    if (result.guideDistinctness?.removedRedundantGuideCount) items.push({ level: "check", text: `${result.guideDistinctness.removedRedundantGuideCount} near-duplicate guide option was removed because its cut was within ${result.guideDistinctness.minimumCutOffset} bp of a higher-ranked guide.` });
    if (result.guideDistinctness?.customGuidesRequireReview) items.push({ level: "warning", text: `Custom guide alternatives cut less than ${result.guideDistinctness.minimumCutOffset} bp apart and are not independent options.` });
    if (!(result.ss || []).length) items.push({ level: "warning", text: "No silent guide-blocking mutation was introduced. Re-cut after HDR may remain possible." });
    if (typeof result.guideWindow === "number" && result.guideWindow > 10) items.push({ level: "warning", text: `No guide was available within 10 bp of the mutation site. This design is using the best available ${result.guideTier || "fallback"} guide set within ${result.guideWindow} bp.` }); if (result.partnerFallback && result.partnerFallback.partnerCutDistance > 10) items.push({ level: "warning", text: `The second guide cuts ${result.partnerFallback.partnerCutDistance} bp from the mutation site (the first is within 10 bp). HDR falls off with cut-to-edit distance, so expect its ssODN to convert less.` }); if (result.partnerSkipped) items.push({ level: "warning", text: "Only one guide is offered: a second guide was found, but its blocking changes could not be combined with the first guide's without changing the protein." });
    items.push({ level: "check", text: "Confirm the desired amino-acid change against the intended transcript and verify that the donor does not create unwanted amino-acid substitutions." });
  }

  if (result.type === "it") {
    if (!result.coDeliverySafe && (result.gs || []).length > 1) items.push({ level: "warning", text: result.guideDonorInstruction || "Use only matched internal-guide/ssODN pairs; do not pool the alternative guides." });
    if (!(result.os || []).length) items.push({ level: "warning", text: "No guide-linked internal ssODN donor could be rendered. Review the insertion-site window and sequence bounds before ordering." });
    if (!(result.ss || []).length) items.push({ level: "warning", text: "No guide-blocking mutation was introduced in the internal ssODN donors. Re-cut after HDR may remain possible." });
    if ((result.os || []).length !== (result.gs || []).length) items.push({ level: "warning", text: "A donor was not generated for every selected guide. Review guide-linked donor coverage before ordering." });
    if (typeof result.guideWindow === "number" && result.guideWindow > 10) items.push({ level: "warning", text: `No guide was available within 10 bp of the internal insertion site. This design is using the best available ${result.guideTier || "fallback"} guide set within ${result.guideWindow} bp.` });
    if (result.insertValidation && !result.insertValidation.matchesPreset) items.push({ level: "warning", text: "The designed internal-tag donor insert does not match the intended tag preset sequence. Review the tag DNA before ordering." });
    if (result.insertValidation && !result.insertValidation.framePreserved) items.push({ level: "warning", text: "The designed internal-tag donor insert is not passing the frame check. Review codon continuity and unexpected stop codons before ordering." });
    (result.insertValidation?.canonicalChecks || []).forEach((check) => {
      if (!check.matches) items.push({ level: "warning", text: `${check.label} does not match the designed internal-tag donor at the protein level. Review the preset sequence before ordering.` });
    });
    items.push({ level: "check", text: "Confirm that the internal tag remains in frame with the surrounding CDS and verify that the inserted peptide does not disrupt known functional motifs." });
  }

  if (result.type === "ko") {
    const guideCount = (result.gs || []).length;
    if (guideCount < 2) items.push({ level: "warning", text: "Knockout design has fewer than two guides. Deletion-based screening will be weaker than expected." });
    if (result.referenceOnly) items.push({ level: "warning", text: "This knockout was generated from gene-name reference guides only. Upload a GenBank file to calculate exact exon geometry, pair spacing, and recommended primers on your target sequence." });
    if (result.deletionOutcome?.spliceDonorRemoved) items.push({ level: "warning", text: `The predicted ${result.deletionOutcome.deletionSize} bp deletion removes the splice donor. Direct deletion is mod 3 = ${result.deletionOutcome.deletionMod3}; possible exon skipping is mod 3 = ${result.deletionOutcome.exonSkippingMod3}. Confirm transcript structure experimentally.` });
    items.push({ level: "check", text: "Validate the expected deletion by junction PCR and confirm frameshift or protein loss in established clones." });
  }

  if (result.type === "ct" || result.type === "nt") {
    const labels = new Set((result.donorAnnotations || []).map((annotation) => annotation.label));
    const blocking = summarizeGuideBlocking(result);
    if (blocking.status !== "pass") items.push({ level: "warning", text: `Guide blocking is ${blocking.tier}, not strong for every selected guide. ${blocking.detail}` });
    if (result.type === "nt" && !labels.has("Start")) items.push({ level: "warning", text: "N-terminal donor annotation does not include a start codon block. Verify start codon replacement before ordering." });
    if (result.type === "ct" && !labels.has("Stop")) items.push({ level: "warning", text: "C-terminal donor annotation does not include a terminal stop codon block. Verify stop codon placement before ordering." });
    if (result.insertValidation && !result.insertValidation.matchesPreset) items.push({ level: "warning", text: "The designed HDR donor insert does not match the intended cassette preset. Review the insert sequence before ordering." });
    if (result.insertValidation && !result.insertValidation.framePreserved) items.push({ level: "warning", text: "The designed HDR donor insert is not passing the frame check. Review codon continuity and unexpected stop codons before ordering." });
    (result.insertValidation?.canonicalChecks || []).forEach((check) => {
      if (!check.matches) items.push({ level: "warning", text: `${check.label} does not match the designed HDR donor at the protein level. Review the cassette preset before ordering.` });
    });
    if (typeof result.guideWindow === "number" && result.guideWindow > 10) items.push({ level: "warning", text: `No guide was available within 10 bp of the insertion site. This design is using the best available ${result.guideTier || "fallback"} guide set within ${result.guideWindow} bp.` });
    if ((result.donor || "").length > 2200) items.push({ level: "warning", text: "HDR donor is long for routine synthesis and cloning. Confirm assembly plan and QC strategy." });
    if (result.primerWarning) items.push({ level: "warning", text: result.primerWarning });
    items.push({ level: "check", text: "Review donor frame across both homology junctions and confirm the expected translated product at the protein level." });
  }

  return items;
}
