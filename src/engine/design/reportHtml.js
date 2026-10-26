import { describeKoSelection } from "./koSelection.js";
// Report and export rendering, extracted from App.jsx.
//
// Everything here is a pure function of a design result: no React, no hooks, no DOM. That
// is the point - App.jsx is JSX and cannot be imported by `node --test`, so for as long as
// report rendering lived inside it the entire reporting layer was untestable. A defect
// could sit in four separate render paths unnoticed, and one did.
//
// Keeping this module free of React is what makes golden-report tests possible. Do not
// import react here, and do not add JSX.


import { summarizeGuideBlocking, summarizePrimerPairQuality, summarizePrimerReadiness } from "./designEngine.js";
import { getDonorStrandBadge } from "./reportModel.js";
import { DESIGN_TYPES } from "./designTypes.js";
import { getDonorReleaseStatus, getReleaseVerdict, getReleaseVerdictSections } from "./releaseVerdict.js";
import { describeDonorFormat } from "./donorFormat.js";
import { buildDesignSchemeCaption, buildDesignSchemeFilename, buildDesignSchemeSvg, supportsDesignScheme } from "./designScheme.js";
import { complementBase, genomicAt, isReverse } from "./genomicCoords.js";

const CODON_TABLE = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGA: "*", TGT: "C", TGC: "C", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

export const DNA_COMPLEMENT = { A: "T", T: "A", G: "C", C: "G" };

const PM_REGION_COLORS = {
  longArm: "#DBEAFE",
  shortArm: "#DCFCE7",
};

export const PM_GUIDE_COLORS = {
  site: "#E9D5FF",
  pam: "#FDE68A",
};

export const PM_EDIT_COLORS = {
  desired: "#FDE68A",
  silent: "#FCA5A5",
};

/** HTML rendering of a spacer + PAM. App.jsx keeps the JSX equivalent for on-screen use. */
function renderGuideSequenceHtml(spacer, pam, enzyme = null) {
  if (enzyme?.pam_side === "5prime") return `<span style="background:#FEF3C7;color:#92400E;font-family:Consolas,monospace;font-weight:800;">${pam}</span> <span style="font-family:Consolas,monospace;font-weight:700;">${spacer}</span>`;
  return `<span style="font-family:Consolas,monospace;font-weight:700;color:#111827;">${spacer}</span> <span style="display:inline-block;padding:1px 6px;border-radius:999px;background:#FEF3C7;color:#92400E;font-family:Consolas,monospace;font-weight:800;">${pam}</span>`;
}

export function getProjectTypeMeta(projectType) {
  return DESIGN_TYPES.find((item) => item.id === projectType) || DESIGN_TYPES[0];
}

export function formatDesignLabel(meta, result) {
  if (!result) return "";
  if (result.type === "genomic-snv") return `${result.gene} ${result.input.assembly} chr${String(result.input.chromosome).replace(/^chr/i, "")}:${result.input.position} ${result.input.ref}→${result.input.alt}`;
  if (result.type === "pm") return `${result.gene} p.${result.wA}${result.an}${result.mA}`;
  if (result.type === "ko") return `${result.gene} knockout`;
  if (result.type === "it") return `${result.gene} internal ${result.tag} after ${result.wA}${result.an}`;
  return `${result.gene} ${result.type === "ct" ? "C-terminal" : "N-terminal"} ${result.tag}`;
}

function buildDisplayedEditLabel(meta, result) {
  if (!result) return meta.editSummary || "";
  const canonical = formatDesignLabel(meta, result);
  const requested = String(meta.editSummary || "").trim();
  if (result.type === "pm") {
    if (!requested) return canonical;
    return requested === canonical ? canonical : `${canonical} | requested: ${requested}`;
  }
  return requested || canonical;
}

export function buildDesignSummary(result) {
  if (!result) return "";
  const lines = [];
  const getGuideName = (guideIndex) => result.gs?.[guideIndex - 1]?.n || `gRNA${guideIndex}`;
  lines.push(`Design: ${result.type === "pm" ? `${result.gene} p.${result.wA}${result.an}${result.mA}` : formatDesignLabel({ projectType: result.type }, result)}`);
  if (result.type === "pm") lines.push(`Codon: ${result.wC} -> ${result.mC}`);
  if (result.type === "ko") {
    lines.push(`Target exon: ${result.exon}`);
    if (result.gs?.length >= 2 && Number.isFinite(result.gs[0]?.d) && Number.isFinite(result.gs[1]?.d)) {
      lines.push(`Pair spacing: ${Math.abs(result.gs[1].d - result.gs[0].d)} bp`);
    }
    if (result.deletionOutcome) {
      lines.push(`Expected deletion: ${result.deletionOutcome.deletionSize} bp (mod 3 = ${result.deletionOutcome.deletionMod3}; ${result.deletionOutcome.frameshiftPredicted ? "frameshift predicted" : "in-frame"})`);
      if (result.deletionOutcome.spliceDonorRemoved) lines.push(`Splice donor removed: exon skipping is plausible; exon length ${result.deletionOutcome.exonLength} bp (mod 3 = ${result.deletionOutcome.exonSkippingMod3}).`);
    }
    if (result.koAssessment) {
      lines.push(`Knockout confidence: ${result.koAssessment.tier.toUpperCase()}. ${result.koAssessment.summary}`);
      result.koAssessment.reasons.forEach((reason) => lines.push(`  ${reason}`));
      if (result.koAssessment.isoformNote) lines.push(`  ${result.koAssessment.isoformNote}`);
      const outcomes = result.koAssessment.outcomes;
      if (outcomes) outcomes.guides.forEach((g, index) => lines.push(`  Guide ${index + 1} predicted repair outcomes: ${g.lofPct}% loss-of-function alleles (${g.plus1Pct}% +1 insertions, ${g.frameshiftPct}% frameshifts, ${g.inframePct}% in-frame).`));
      else if (result.koAssessment.outcomesUnavailable) lines.push(`  Repair-outcome ranking not applied: ${result.koAssessment.outcomesUnavailable}`);
    }
    describeKoSelection(result.koSelection).forEach(line => lines.push(line));
    if (result.strat) lines.push(`Strategy: ${result.strat}`);
    return lines.join("\n");
  }
  if (result.type === "it") lines.push(`Insert after ${result.wA}${result.an}, before ${result.nextAA}${result.an + 1}`);
  if (result.type === "ct" || result.type === "nt") lines.push(`Donor length: ${result.dl} bp`);
  if (result.type === "it") lines.push(`Insert length: ${result.il} bp`);
  if (result.type === "pm" && result.guideDonorInstruction) lines.push(`Guide/donor use: ${result.guideDonorInstruction}`);
  lines.push("");
  lines.push("gRNAs:");
  result.gs.forEach((guide) => lines.push(`- ${guide.n}: ${guide.sp} ${guide.pm} | ${guide.str} strand | GC ${guide.gc}%`));
  if (result.ss?.length) {
    lines.push("");
    lines.push(result.type === "pm" ? "Silent mutations:" : "Guide-blocking mutations:");
    result.ss.forEach((mutation) => lines.push(`- ${getGuideName(mutation.gi)}: ${mutation.lb} (${mutation.oc} -> ${mutation.nc}) | ${mutation.pur}`));
  }
  lines.push("");
  lines.push("Recommended primers:");
  (result.ps || []).forEach((primer) => lines.push(`- ${primer.n}: ${primer.s}`));
  if (result.amp) lines.push(`Expected amplicon: ${result.amp}`);
  if (result.primerWarning) lines.push(`Primer warning: ${result.primerWarning}`);
  const primerQuality = getPrimerQualitySummary(result);
  if (primerQuality) lines.push(`Primer QC: ${primerQuality.confidence} confidence | pair penalty ${primerQuality.penalty} | Tm delta ${primerQuality.tmDelta} C`);
  return lines.join("\n");
}

function buildGeneInfoRows(meta, result, fileName) {
  const referenceLabel = result?.gb?.source === "raw-sequence"
    ? "Raw DNA + CDS coordinates"
    : fileName || (result.referenceOnly ? "Gene-list KO mode (no GenBank uploaded)" : "Uploaded GenBank");
  if (!result) return [];
  return [
    ["Gene", meta.gene || result.gene],
    ...(result.enzyme ? [["Enzyme", `${result.enzyme.name} · ${result.enzyme.pam_pattern} (${result.enzyme.pam_side === "5prime" ? "5′" : "3′"} PAM) · config ${result.enzyme.version}`]] : []),
    ["Design class", result.type === "genomic-snv" ? "Genomic SNP" : getProjectTypeMeta(meta.projectType).label],
    ["Target", buildDisplayedEditLabel(meta, result)],
    ["Cell line", meta.cellLine || "n/a"],
    ["Delivery", meta.deliveryMethod === "u6" ? "U6 / Pol III expression" : meta.deliveryMethod === "rnp" ? "Synthetic guide / Cas RNP" : "not specified"],
    ["Transcript", result?.gb?.transcriptId || "not recorded"],
    ["Protein / CDS", result.prot ? `${result.prot} aa` : "n/a"],
    ["Reference", referenceLabel],
  ];
}

export function buildGeneInfoItems(meta, result, fileName) {
  return buildGeneInfoRows(meta, result, fileName).map(([label, value]) => ({ label, value }));
}

export function buildPrimerSummaryItems(result) {
  return (result?.ps || []).map((primer) => ({
    name: primer.n,
    sequence: primer.s || "n/a",
    length: primer.len ? `${primer.len} nt` : "n/a",
    tm: Number.isFinite(primer.tm) ? `${primer.tm.toFixed(1)} C` : "n/a",
    gc: Number.isFinite(primer.gc) ? `${primer.gc}%` : "n/a",
    clamp: Number.isFinite(primer.clamp) ? `${primer.clamp}/3` : "n/a",
  }));
}

function buildPrimerSummaryHtml(result) {
  const primers = buildPrimerSummaryItems(result);
  if (!primers.length) return `<p class="sub">No recommended primers were generated for this design.</p>`;
  return `<table>${tableHtml([["Primer", "Sequence (5'-3')", "Length", "Tm", "GC", "Clamp"]], true)}${tableHtml(primers.map((primer) => [primer.name, `<span class="mono">${primer.sequence}</span>`, primer.length, primer.tm, primer.gc, primer.clamp]))}</table>`;
}

export function buildPrimerCandidateRows(result) {
  return (result?.primerCandidates || []).slice(1).map((candidate) => [
    `#${candidate.rank}`,
    candidate.forward?.s || "n/a",
    Number.isFinite(candidate.forward?.tm) ? `${candidate.forward.tm.toFixed(1)} C` : "n/a",
    Number.isFinite(candidate.forward?.gc) ? `${candidate.forward.gc}%` : "n/a",
    Number.isFinite(candidate.forward?.clamp) ? `${candidate.forward.clamp}/3` : "n/a",
    candidate.reverse?.s || "n/a",
    Number.isFinite(candidate.reverse?.tm) ? `${candidate.reverse.tm.toFixed(1)} C` : "n/a",
    Number.isFinite(candidate.reverse?.gc) ? `${candidate.reverse.gc}%` : "n/a",
    Number.isFinite(candidate.reverse?.clamp) ? `${candidate.reverse.clamp}/3` : "n/a",
    Number.isFinite(candidate.ampliconLength) ? `${candidate.ampliconLength} bp` : (Number.isFinite(candidate.deletionAmpliconLength) ? `del ~${candidate.deletionAmpliconLength} bp` : "n/a"),
  ]);
}

export function getPrimerQualitySummary(result) {
  const forward = result?.ps?.[0]?.s || "";
  const reverse = result?.ps?.[1]?.s || "";
  if (!forward || !reverse) return null;
  return summarizePrimerPairQuality(forward, reverse);
}

export function buildSsOdnNotes(result) {
  if (!result || result.type !== "pm") return [];
  const getGuideName = (guideIndex) => result.gs?.[guideIndex - 1]?.n || `gRNA${guideIndex}`;
  const desired = result.ch.map((change, index) => `Desired edit ${index + 1}: genomic position ${change.p + 1}, ${change.w}->${change.m}`);
  const silent = (result.ss || []).map((entry) => `${getGuideName(entry.gi)}: ${entry.lb} (${entry.oc} -> ${entry.nc}) | ${entry.pur}`);
  return desired.concat(silent);
}

export function normalizeGeneToken(value) {
  const upper = String(value || "").toUpperCase().trim();
  const withoutIds = upper.replace(/[-_\s]*(ENSG|NM_|NCBI)\S*/g, " ");
  const compact = withoutIds.replace(/[^A-Z0-9]+/g, " ").trim();
  return compact.split(/\s+/)[0] || "";
}

export function getBrunelloReferenceGuideSet(result, brunelloLookup) {
  if (result?.enzyme && result.enzyme.id !== "spcas9") return null;
  if (!brunelloLookup?.guides?.length) return null;
  return {
    requestedGene: brunelloLookup.requestedGene || normalizeGeneToken(result?.gene),
    libraryGene: brunelloLookup.libraryGene || normalizeGeneToken(result?.gene),
    source: brunelloLookup.source || "Broad GPP Brunello human CRISPRko library",
    summary: brunelloLookup.summary || "Reference sgRNAs ranked by Rule Set 2 on-target score from the Addgene Brunello library contents table.",
    guides: brunelloLookup.guides,
  };
}

function translateCodon(codon) {
  const aa = CODON_TABLE[codon] || "?";
  return aa === "*" ? "Stop" : aa;
}

function reverseComplement(sequence) {
  return (sequence || "").split("").reverse().map((base) => DNA_COMPLEMENT[base] || "N").join("");
}

function buildPmArmRegions(sequenceLength, longArmFirst = true) {
  if (!sequenceLength) return [];
  const longArmLength = Math.min(91, sequenceLength);
  const shortArmStart = longArmFirst ? longArmLength : Math.min(36, sequenceLength);
  const firstArmLength = longArmFirst ? longArmLength : Math.min(36, sequenceLength);
  return [
    {
      label: `${longArmFirst ? "91 bp arm" : "36 bp arm"}`,
      start: 0,
      end: firstArmLength,
      color: longArmFirst ? PM_REGION_COLORS.longArm : PM_REGION_COLORS.shortArm,
    },
    {
      label: `${longArmFirst ? "36 bp arm" : "91 bp arm"}`,
      start: shortArmStart,
      end: sequenceLength,
      color: longArmFirst ? PM_REGION_COLORS.shortArm : PM_REGION_COLORS.longArm,
    },
  ].filter((region) => region.end > region.start);
}

export function findPmRegion(index, regions) {
  return regions.find((region) => index >= region.start && index < region.end) || null;
}

export function buildPmStrandModels(donor) {
  const length = donor.od?.length || 0;
  const orderedDiff = [...(donor.df || [])].sort((left, right) => left - right);
  const oppositeDiff = orderedDiff.map((index) => length - 1 - index).sort((left, right) => left - right);
  const orderedDesired = [...(donor.desiredDiffIndexes || [])].sort((left, right) => left - right);
  const oppositeDesired = orderedDesired.map((index) => length - 1 - index).sort((left, right) => left - right);
  const orderedSilent = [...(donor.silentDiffIndexes || [])].sort((left, right) => left - right);
  const oppositeSilent = orderedSilent.map((index) => length - 1 - index).sort((left, right) => left - right);
  const orderedLabel = donor.guideStrand === "+" ? "- strand donor" : "+ strand donor";
  const oppositeLabel = donor.guideStrand === "+" ? "+ strand donor" : "- strand donor";
  const genomicGuide = {
    siteStart: donor.guideSiteStart,
    siteEnd: donor.guideSiteEnd,
    pamStart: donor.guidePamStart,
    pamEnd: donor.guidePamEnd,
  };
  const mapGuide = (reversed) => {
    if (!reversed) return genomicGuide;
    return {
      siteStart: length - genomicGuide.siteEnd,
      siteEnd: length - genomicGuide.siteStart,
      pamStart: length - genomicGuide.pamEnd,
      pamEnd: length - genomicGuide.pamStart,
    };
  };
  const strands = [
    {
      key: "ordered",
      title: orderedLabel,
      recommended: true,
      note: `Recommended to order. This strand is reverse complement to ${donor.guideName}. Cut site lies between the 91 bp and 36 bp arms.`,
      wt: donor.wo,
      donor: donor.od,
      diffIndexes: orderedDiff,
      desiredIndexes: orderedDesired,
      silentIndexes: orderedSilent,
      regions: buildPmArmRegions(length, true),
      guide: mapGuide(donor.guideStrand === "+"),
    },
    {
      key: "opposite",
      title: oppositeLabel,
      recommended: false,
      note: "Opposite donor strand for reference. Cut site lies between the 36 bp and 91 bp arms on this view.",
      wt: reverseComplement(donor.wo),
      donor: reverseComplement(donor.od),
      diffIndexes: oppositeDiff,
      desiredIndexes: oppositeDesired,
      silentIndexes: oppositeSilent,
      regions: buildPmArmRegions(length, false),
      guide: mapGuide(donor.guideStrand !== "+"),
    },
  ];
  if (donor.enzyme && donor.enzyme !== "spcas9") {
    const reversed = donor.orderStrand === "antisense";
    strands[0].title = `${reversed ? "-" : "+"} strand donor (input reference)`;
    strands[1].title = `${reversed ? "+" : "-"} strand donor (input reference)`;
    strands[0].note = donor.strand_note || "Selected donor strand; validate enzyme-specific delivery experimentally.";
    strands[1].note = "Opposite strand for reference.";
    strands[0].guide = mapGuide(reversed); strands[1].guide = mapGuide(!reversed);
    const region = reversed ? donor.armRegions.map(item => ({ ...item, start: length - item.end, end: length - item.start })) : donor.armRegions;
    strands[0].regions = region;
    strands[1].regions = region.map(item => ({ ...item, start: length - item.end, end: length - item.start }));
  }
  return strands;
}

function splitFramedSequence(sequence) {
  const safeSequence = sequence || "";
  const codonLength = Math.floor(safeSequence.length / 3) * 3;
  const codingRegion = safeSequence.slice(0, codonLength);
  const codons = [];
  for (let index = 0; index < codingRegion.length; index += 3) codons.push(codingRegion.slice(index, index + 3));
  return { prefix: "", codons, suffix: "" };
}

export function buildPmDonorComparison(donor) {
  const wt = splitFramedSequence(donor.codingWt);
  const edited = splitFramedSequence(donor.codingDonor);
  const diffCodonIndexes = edited.codons.reduce((indexes, codon, index) => {
    if (codon !== wt.codons[index]) indexes.push(index);
    return indexes;
  }, []);
  const wtAa = wt.codons.map(translateCodon);
  const donorAa = edited.codons.map(translateCodon);
  const diffAaIndexes = donorAa.reduce((indexes, aa, index) => {
    if (aa !== wtAa[index]) indexes.push(index);
    return indexes;
  }, []);
  return { wt, donor: edited, wtAa, donorAa, diffCodonIndexes, diffAaIndexes };
}

function tableHtml(rows, header = false) {
  return rows.map((row) => `<tr>${row.map((cell, index) => header
    ? `<th style="padding:6px 8px;border:1px solid #e5e7eb;background:#f1f5f9;color:#344054;text-align:left;font-weight:700;">${cell}</th>`
    : `<td style="padding:5px 8px;border:1px solid #e5e7eb;vertical-align:top;${index === 0 ? "background:#f8fafc;font-weight:700;" : ""}">${cell}</td>`).join("")}</tr>`).join("");
}

// Label/value pairs laid out `pairsPerRow` to a row: the compact replacement for a card per item.
function buildKeyValueTableHtml(items, pairsPerRow = 2) {
  if (!items?.length) return "";
  const rows = [];
  for (let i = 0; i < items.length; i += pairsPerRow) rows.push(items.slice(i, i + pairsPerRow));
  return `<table class="kv">${rows.map((row) => `<tr>${row.map((item) => `<th>${item.label}</th><td${item.monospace ? ' class="mono"' : ""}>${item.value || "n/a"}</td>`).join("")}${"<th></th><td></td>".repeat(pairsPerRow - row.length)}</tr>`).join("")}</table>`;
}

function buildAlignedRowHtml(label, { prefix = "", tokens = [], suffix = "" }, diffIndexes = [], mode = "donor", tokenWidth = "4ch") {
  const changedSet = new Set(diffIndexes);
  const prefixHtml = prefix ? `<span style="color:#98A2B3;">${prefix}</span>` : "";
  const suffixHtml = suffix ? `<span style="color:#98A2B3;">${suffix}</span>` : "";
  const tokensHtml = tokens.map((token, index) => {
    const changed = changedSet.has(index);
    const styles = [
      "display:inline-block",
      `min-width:${tokenWidth}`,
      "margin-right:6px",
      "text-align:center",
      changed ? `color:${mode === "wt" ? "#CC0000" : "#111827"}` : "color:#111827",
      changed && mode === "donor" ? "background:#FFF59D" : "background:transparent",
      changed && mode === "wt" ? "text-decoration:line-through" : "text-decoration:none",
      `font-weight:${changed ? 800 : 400}`,
    ].join(";");
    return `<span style="${styles}">${token}</span>`;
  }).join("");
  return `
    <div style="margin:0 0 8px 0;">
      <div style="color:#667085;font-size:11px;margin-bottom:4px;">${label}</div>
      <div style="font-family:Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;">${prefixHtml}${tokensHtml}${suffixHtml}</div>
    </div>
  `;
}

function buildPmAnnotatedSequenceHtml(label, sequence, diffIndexes, mode, regions, guide, desiredIndexes = [], silentIndexes = []) {
  const diffSet = new Set(diffIndexes);
  const desiredSet = new Set(desiredIndexes);
  const silentSet = new Set(silentIndexes);
  const sequenceHtml = (sequence || "").split("").map((base, index) => {
    const changed = diffSet.has(index);
    const isDesired = desiredSet.has(index);
    const isSilent = silentSet.has(index);
    const region = findPmRegion(index, regions);
    const inGuide = guide && index >= guide.siteStart && index < guide.siteEnd;
    const inPam = guide && index >= guide.pamStart && index < guide.pamEnd;
    const styles = [
      `background:${inPam ? PM_GUIDE_COLORS.pam : isSilent && mode === "donor" ? PM_EDIT_COLORS.silent : isDesired && mode === "donor" ? PM_EDIT_COLORS.desired : changed && mode === "donor" ? PM_EDIT_COLORS.desired : inGuide ? PM_GUIDE_COLORS.site : (region?.color || "transparent")}`,
      `color:${changed && mode === "wt" ? "#CC0000" : "#111827"}`,
      `text-decoration:${changed && mode === "wt" ? "line-through" : "none"}`,
      `font-weight:${inGuide || changed ? 800 : 400}`,
    ].join(";");
    return `<span style="${styles}">${base}</span>`;
  }).join("");
  return `
    <div style="margin:0 0 8px 0;">
      <div style="color:#667085;font-size:11px;margin-bottom:4px;">${label}</div>
      <div style="font-family:Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;">${sequenceHtml}</div>
    </div>
  `;
}

function buildPmStrandCardHtml(strand, releaseStatus = "ready") {
  const badge = getDonorStrandBadge(strand, releaseStatus);
  return `
    <div style="margin:0 0 12px 0;padding:12px;border:1px solid ${badge.border};border-radius:12px;background:${badge.panel};">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
        <span style="font-weight:700;color:#1f2937;">${strand.title}</span>
        <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${badge.fg};background:${badge.bg};">${badge.label}</span>
      </div>
      <p style="font-size:12px;color:#555;margin:0 0 8px 0;">${strand.note}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        ${strand.regions.map((region) => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#1f2937;background:${region.color};">${region.label} (${region.end - region.start} nt)</span>`).join("")}
        <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#1f2937;background:${PM_GUIDE_COLORS.site};">gRNA site</span>
        <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#92400E;background:${PM_GUIDE_COLORS.pam};">PAM</span>
        <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#92400E;background:${PM_EDIT_COLORS.desired};">Desired edit</span>
        ${strand.silentIndexes?.length ? `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#7F1D1D;background:${PM_EDIT_COLORS.silent};">${strand.blockingLabel || "Silent mutation"}</span>` : ""}
      </div>
      ${buildPmAnnotatedSequenceHtml("WT", strand.wt, strand.diffIndexes, "wt", strand.regions, strand.guide, strand.desiredIndexes, strand.silentIndexes)}
      ${buildPmAnnotatedSequenceHtml("Donor", strand.donor, strand.diffIndexes, "donor", strand.regions, strand.guide, strand.desiredIndexes, strand.silentIndexes)}
    </div>
  `;
}

// The strand to order is shown; the opposite strand is for reference only and sits behind a fold.
function renderStrandCards(strands, renderCard) {
  const ordered = strands.filter((strand) => strand.recommended);
  const reference = strands.filter((strand) => !strand.recommended);
  return `${ordered.map(renderCard).join("")}${reference.length ? `<details class="fold"><summary>Opposite strand (reference only, not for ordering)</summary><div class="body">${reference.map(renderCard).join("")}</div></details>` : ""}`;
}

function buildPmDonorHtml(donor, releaseStatus = "ready") {
  const comparison = donor.nucleotideValidation ? null : buildPmDonorComparison(donor);
  const strands = buildPmStrandModels(donor).map(strand => donor.nucleotideValidation ? {...strand,blockingLabel:"Additional blocking change",note:strand.note.replace("Recommended to order.", "Candidate strand for review.")} : strand);
  const silentSummary = (donor.silentMutations || []).map((mutation) => `${mutation.lb}: ${mutation.oc} -> ${mutation.nc} | ${mutation.pur}`).join("<br/>");
  const proteinValidation = donor.proteinValidation?.valid
    ? `Pass: final donor encodes ${donor.proteinValidation.observedAa} at residue ${donor.proteinValidation.targetAaNumber} with no unintended coding changes.`
    : `FAIL: ${(donor.proteinValidation?.errors || ["final translated-product validation unavailable"]).join("; ")}`;
  const crossGuideSummary = (donor.guideProtection || []).map((entry) => `${entry.guideName}: ${entry.tier} — ${entry.reason}`).join("<br/>");
  return `
    <h3 style="color:#2E75B6;margin:18px 0 8px 0;">${donor.n} (${donor.sl})</h3>
    <p style="font-size:12px;color:#555;margin:0 0 10px 0;">Linked guide: ${donor.guideName}</p>
    <p style="font-size:12px;color:${(donor.nucleotideValidation?.valid || donor.proteinValidation?.valid) ? "#047857" : "#B42318"};margin:0 0 10px 0;"><strong>${donor.nucleotideValidation ? "Final donor nucleotide assertion:" : "Final donor protein assertion:"}</strong> ${donor.nucleotideValidation ? `Pass: requested substitution plus ${donor.nucleotideValidation.additionalChanges || 0} documented blocking changes. Splicing and protein outcomes are not validated.` : proteinValidation}</p>
    ${crossGuideSummary ? `<p style="font-size:12px;color:#344054;margin:0 0 10px 0;"><strong>${donor.nucleotideValidation ? ((donor.guideProtection || []).length > 1 ? "Protection against both guides:" : "Protection against the matched guide:") : "Protection against all offered guides:"}</strong><br/>${crossGuideSummary}</p>` : ""}
    ${silentSummary ? `<p style="font-size:12px;color:#7F1D1D;margin:0 0 10px 0;"><strong>${donor.nucleotideValidation ? "Additional blocking changes (noncoding is not silent):" : "Silent mutation:"}</strong><br/>${silentSummary}</p>` : ""}
    ${renderStrandCards(strands, (strand) => buildPmStrandCardHtml(strand, releaseStatus))}
    ${comparison ? `<details class="fold"><summary>Coding frame view (WT and donor codons and amino acids)</summary><div class="body">
      ${buildAlignedRowHtml("WT codons", { prefix: comparison.wt.prefix, tokens: comparison.wt.codons, suffix: comparison.wt.suffix }, comparison.diffCodonIndexes, "wt")}
      ${buildAlignedRowHtml("Donor codons", { prefix: comparison.donor.prefix, tokens: comparison.donor.codons, suffix: comparison.donor.suffix }, comparison.diffCodonIndexes, "donor")}
      ${buildAlignedRowHtml("WT amino acids", { tokens: comparison.wtAa }, comparison.diffAaIndexes, "wt")}
      ${buildAlignedRowHtml("Donor amino acids", { tokens: comparison.donorAa }, comparison.diffAaIndexes, "donor")}
    </div></details>` : ""}
  `;
}

function buildKnockinProteinRowHtml(label, tokens = [], insertStart = 0, insertLength = 0, highlightInsert = false) {
  const insertEnd = insertStart + insertLength;
  return `
    <div style="margin:0 0 8px 0;">
      <div style="color:#667085;font-size:11px;margin-bottom:4px;">${label}</div>
      <div style="font-family:Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;">
        ${tokens.map((token, index) => `<span style="display:inline-block;min-width:${token === "Stop" ? "5ch" : "2ch"};margin-right:6px;text-align:center;color:#111827;${highlightInsert && index >= insertStart && index < insertEnd ? "background:#FDE68A;font-weight:800;border-radius:3px;padding:0 2px;" : ""}">${token}</span>`).join("")}
      </div>
    </div>
  `;
}

function buildKnockinProteinHtml(preview, title = "Protein Translation View") {
  if (!preview) return "";
  if (preview.wtCodons && preview.donorCodons && preview.wtAas && preview.donorAas) {
    return `
      <div style="margin:0 0 14px 0;padding:12px;border:1px solid #d7dee7;border-radius:12px;background:#f8fafc;">
        <div style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Coding Frame View</div>
        <p style="font-size:12px;color:#555;margin:0 0 10px 0;">${preview.note}</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#92400E;background:#FDE68A;">Inserted tag / reporter codons and amino acids</span>
        </div>
        ${buildAlignedRowHtml("WT codons", { tokens: preview.wtCodons }, [], "wt")}
        ${buildAlignedRowHtml("Donor codons", { tokens: preview.donorCodons }, Array.from({ length: preview.insertCodonLength }, (_, index) => preview.insertCodonStart + index), "donor")}
        ${buildAlignedRowHtml("WT amino acids", { tokens: preview.wtAas }, [], "wt")}
        ${buildAlignedRowHtml("Donor amino acids", { tokens: preview.donorAas }, Array.from({ length: preview.insertAaLength }, (_, index) => preview.insertAaStart + index), "donor")}
      </div>
    `;
  }
  return `
    <div style="margin:0 0 14px 0;padding:12px;border:1px solid #d7dee7;border-radius:12px;background:#f8fafc;">
      <div style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">${title}</div>
      <p style="font-size:12px;color:#555;margin:0 0 10px 0;">${preview.note}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#92400E;background:#FDE68A;">Inserted tag / reporter</span>
      </div>
      ${buildKnockinProteinRowHtml(preview.wtLabel, preview.wtTokens)}
      ${buildKnockinProteinRowHtml(preview.donorLabel, preview.donorTokens, preview.insertStart, preview.insertLength, true)}
    </div>
  `;
}

function insertValidationBadges(validation) {
  const badges = [
    {
      label: validation.matchesPreset ? "Preset matches donor" : "Preset mismatch",
      color: validation.matchesPreset ? "#047857" : "#B42318",
      background: validation.matchesPreset ? "#D1FAE5" : "#FEE4E2",
    },
    {
      label: validation.framePreserved ? "Reading frame preserved" : "Frame flagged",
      color: validation.framePreserved ? "#047857" : "#B42318",
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
  return badges;
}

// `bare` drops the title and badges (the caller shows them); identical expected and designed
// sequences are printed once, and both are printed whenever they differ.
function buildInsertValidationHtml(validation, { bare = false } = {}) {
  if (!validation) return "";
  const expectedAa = (validation.expectedAas || []).join("");
  const actualAa = (validation.actualAas || []).join("");
  const badges = insertValidationBadges(validation);
  const mono = "font-family:Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;";
  const label = (text) => `<div style="color:#667085;font-size:11px;margin:8px 0 3px 0;">${text}</div>`;
  const identical = validation.matchesPreset && (validation.expectedSequence || "") === (validation.actualSequence || "") && expectedAa === actualAa;
  const sequences = identical
    ? `${label("Insert DNA (identical to the preset)")}<div style="${mono}">${validation.actualSequence || "n/a"}</div>${label("Insert amino acids (identical to the preset)")}<div style="${mono}">${actualAa || "n/a"}</div>`
    : `${label("Expected insert DNA")}<div style="${mono}">${validation.expectedSequence || "n/a"}</div>${label("Designed donor insert DNA")}<div style="${mono}">${validation.actualSequence || "n/a"}</div>${label("Expected insert amino acids")}<div style="${mono}">${expectedAa || "n/a"}</div>${label("Designed donor insert amino acids")}<div style="${mono}">${actualAa || "n/a"}</div>`;
  const canonical = (validation.canonicalChecks || []).map((check) => `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #E5E7EB;">
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:700;color:#111827;">${check.label}</span>
            <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${check.matches ? "#047857" : "#B42318"};background:${check.matches ? "#D1FAE5" : "#FEE4E2"};">${check.matches ? "Protein matches reference" : "Protein mismatch"}</span>
          </div>
          ${check.sourceUrl ? `<div style="color:#667085;font-size:11px;margin-bottom:6px;">Source: <a href="${check.sourceUrl}" target="_blank" rel="noreferrer" style="color:#2E75B6;text-decoration:none;">${check.sourceUrl}</a></div>` : ""}
          ${label("Reference amino acids")}<div style="${mono}">${check.expectedAas || "n/a"}</div>
          ${label("Designed amino acids")}<div style="${mono}">${check.actualAas || "n/a"}</div>
        </div>
      `).join("");
  const head = bare ? "" : `
      <div style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Insert Identity Check</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        ${badges.map((badge) => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${badge.color};background:${badge.background};">${badge.label}</span>`).join("")}
      </div>`;
  return `
    <div style="margin:${bare ? "10px 0 0 0" : "0 0 14px 0;padding:12px;border:1px solid #d7dee7;border-radius:12px;background:#f8fafc"};">
      ${head}
      <div style="font-size:12px;color:#555;">Expected insert: ${validation.expectedLengthBp} bp | Designed donor insert: ${validation.actualLengthBp} bp</div>
      ${sequences}
      ${canonical}
    </div>
  `;
}

// The donor-section summary of what was inserted: the verdict badges stay visible, the sequences
// and codon-by-codon views (long, and repeated in the donor listing) sit one click away.
function buildInsertVerificationHtml(result) {
  const validation = result.insertValidation;
  const protein = result.type === "it" ? buildInternalProteinHtml(result) : buildKnockinProteinHtml(result.proteinPreview);
  if (!validation && !protein) return "";
  const chips = validation ? insertValidationBadges(validation).map((badge) => `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${badge.color};background:${badge.background};">${badge.label}</span>`).join("") : "";
  const lengths = validation ? `<span class="sub">Expected insert ${validation.expectedLengthBp} bp, designed ${validation.actualLengthBp} bp.</span>` : "";
  return `
    <div style="margin:8px 0 12px 0;">
      <div>${chips}${lengths}</div>
      <details class="fold"><summary>Coding frame, insert sequence and translation</summary><div class="body">${protein}${validation ? buildInsertValidationHtml(validation, { bare: true }) : ""}</div></details>
    </div>
  `;
}

export function buildKnockinQcChecks(result) {
  if (!result || !["it", "ct", "nt"].includes(result.type)) return [];
  const canonicalChecks = result.insertValidation?.canonicalChecks || [];
  const blocking = summarizeGuideBlocking(result);
  const primerReadiness = summarizePrimerReadiness(result);
  const checks = [
    {
      label: "Insert matches preset",
      status: result.insertValidation ? (result.insertValidation.matchesPreset ? "pass" : "warn") : "na",
      detail: result.insertValidation ? (result.insertValidation.matchesPreset ? "Designed donor insert matches the intended preset." : "Designed donor insert differs from the intended preset.") : "Insert identity check unavailable.",
    },
    {
      label: "Frame preserved",
      status: result.insertValidation ? (result.insertValidation.framePreserved ? "pass" : "warn") : "na",
      detail: result.insertValidation ? (result.insertValidation.framePreserved ? "Insert passes the codon/frame check." : "Insert failed the codon/frame check.") : "Frame check unavailable.",
    },
    {
      label: "Reporter sequence verified",
      status: canonicalChecks.length ? (canonicalChecks.every((check) => check.matches) ? "pass" : "warn") : "na",
      detail: canonicalChecks.length
        ? (canonicalChecks.every((check) => check.matches)
          ? canonicalChecks.map((check) => `${check.label} matches canonical FPbase reference.`).join(" ")
          : canonicalChecks.filter((check) => !check.matches).map((check) => `${check.label} does not match canonical FPbase reference.`).join(" "))
        : "No external canonical protein reference attached to this cassette.",
    },
    {
      label: "Guide blocking strength",
      status: blocking.status,
      detail: blocking.detail,
    },
    {
      label: "Primer thermodynamics",
      status: primerReadiness.status,
      detail: primerReadiness.detail,
    },
    {
      label: "Primer genome specificity",
      status: "na",
      detail: "Genome-wide primer specificity is not automatic; run the specificity check before ordering.",
    },
  ];
  return checks;
}

function describeDonorFormatSummary(format) {
  const arms = format.arms.five === format.arms.three ? `${format.arms.five} bp arms` : `${format.arms.five}/${format.arms.three} bp arms`;
  const head = `${format.short}, ${arms}, ${format.totalLength} bp.`;
  const problems = [...format.limits.problems, ...(format.synthesis.relevant ? format.synthesis.issues.map((item) => `${item.region}: ${item.detail}`) : [])];
  return problems.length ? `${head} Review: ${problems.join("; ")}.` : `${head} No length limit or synthesis flag.`;
}

export function buildDesignReadinessChecks(result) {
  if (!result) return [];
  if (result.type === "genomic-snv") return [
    {label:"Reference allele",status:"pass",detail:`${result.input.assembly} chr${result.input.chromosome}:${result.input.position} ${result.input.ref}→${result.input.alt}${isReverse(result.input) ? ` (forward strand; ${complementBase(result.input.ref)}→${complementBase(result.input.alt)} on the transcript)` : ""}; reference base verified.`},
    {label:"Exact nucleotide change",status:result.os.length ? "pass" : "warn",detail:"Each emitted donor contains the requested substitution and only its documented, policy-permitted blocking changes."},
    {label:"Re-cutting protection",status:"warn",detail:result.blockers.join(' ') || "Review matched guide/donor protection before ordering."},
    ...result.candidates.map(c=>({label:`${c.name} sequence QC`,status:c.qc.warnings.length ? "warn" : "pass",detail:c.qc.warnings.join(' ') || "No local guide-sequence warnings; specificity untested."})),
    ...result.primers.map(p=>({label:`Primer pair ${p.rank} QC`,status:[...(p.forward.qc?.warnings||[]),...(p.reverse.qc?.warnings||[]),...(p.quality?.warnings||[])].length ? "warn" : "pass",detail:[...(p.forward.qc?.warnings||[]),...(p.reverse.qc?.warnings||[]),...(p.quality?.warnings||[])].join(' ') || "No local primer QC warnings; specificity untested."})),
    {label:"Genome-wide specificity",status:"warn",detail:"Genome-wide guide and primer specificity are not checked."},
    {label:"Splicing / protein",status:"warn",detail:"Splicing and protein outcomes are not predicted. RNA validation is required."},
  ];
  const referenceAvailable = Boolean(result.gb?.genomicSequence || result.gbRaw || result.gene);
  const guideCount = (result.gs || []).length;
  const primerReadiness = summarizePrimerReadiness(result);
  const checks = [
    {
      label: "Reference anchored",
      status: referenceAvailable ? "pass" : "warn",
      detail: result.referenceOnly
        ? "Guide shortlist is gene-level only. Upload GenBank for exact locus geometry."
        : referenceAvailable
          ? "Design is anchored to a concrete reference sequence or validated lookup."
          : "Reference sequence is missing.",
    },
  ];
  const guideQc = result.guideSequenceQc || [];
  if (guideQc.length) checks.push({
    label: "Guide expression compatibility",
    status: guideQc.every((entry) => entry.status === "pass") ? "pass" : "warn",
    detail: guideQc.every((entry) => entry.status === "pass")
      ? `Guide sequence checks pass for ${result.deliveryMethod === "rnp" ? "synthetic-guide RNP" : result.deliveryMethod === "u6" ? "U6/Pol III expression" : "the current delivery setting"}.`
      : guideQc.flatMap((entry) => entry.warnings.map((warning) => `${entry.guideName}: ${warning}`)).join(" "),
  });

  if (result.type === "pm") {
    const donorProteinValid = (result.os || []).length > 0 && (result.os || []).every((donor) => donor.proteinValidation?.valid);
    checks.push(
      {
        label: "Requested edit validated",
        status: result.wA && result.mA && result.gp !== undefined ? "pass" : "warn",
        detail: result.wA && result.mA
          ? `${result.wA}${result.an}${result.mA} was mapped onto the coding sequence.`
          : "Mutation could not be validated against the coding sequence.",
      },
      {
        label: "Guide geometry acceptable",
        status: typeof result.guideWindow === "number" && result.guideWindow <= 30 && guideCount > 0 ? (result.guideWindow <= 10 ? "pass" : "warn") : "warn",
        detail: guideCount
          ? `Selected ${guideCount} guide${guideCount === 1 ? "" : "s"} with best cut distance ${result.guideWindow || "n/a"} bp from the edit.`
          : "No usable guide was found near the mutation.",
      },
      {
        label: "Guide blocking strength",
        status: summarizeGuideBlocking(result).status,
        detail: summarizeGuideBlocking(result).detail,
      },
      {
        label: "Final donor protein",
        status: donorProteinValid ? "pass" : "warn",
        detail: donorProteinValid
          ? `Every emitted donor translates to the intended ${result.wA}${result.an}${result.mA} product without additional amino-acid changes.`
          : "One or more donors failed the final assembled-protein assertion.",
      },
      {
        label: "Guide/donor pairing",
        status: (result.gs || []).length <= 1 || result.coDeliverySafe ? "pass" : "warn",
        detail: result.guideDonorInstruction || "Use each guide only with its matched donor.",
      },
      {
        label: "Primer thermodynamics",
        status: primerReadiness.status,
        detail: primerReadiness.detail,
      },
      {
        label: "Primer genome specificity",
        status: "na",
        detail: "Genome-wide primer specificity is not automatic; run the specificity check before ordering.",
      },
    );
    return checks;
  }

  if (result.type === "ko") {
    checks.push(
      {
        label: "Guide pair ready",
        status: guideCount >= 2 && !result.referenceOnly ? "pass" : "warn",
        detail: guideCount >= 2
          ? result.referenceOnly
            ? "Two reference knockout guides are selected. Sequence-backed spacing still needs GenBank."
            : "Two knockout guides are selected with local spacing and primer design."
          : "A full knockout guide pair is not available.",
      },
      {
        label: "Sequence-backed geometry",
        status: result.referenceOnly ? "warn" : "pass",
        detail: result.referenceOnly
          ? "This is a high-throughput reference-only KO design."
          : "Cut spacing and exon context were calculated on the uploaded reference.",
      },
      {
        label: "Primer thermodynamics",
        status: result.referenceOnly ? "na" : primerReadiness.status,
        detail: result.referenceOnly ? "Primer design is deferred until a GenBank reference is uploaded." : primerReadiness.detail,
      },
    );
    return checks;
  }

  if (["it", "ct", "nt"].includes(result.type)) {
    const canonicalChecks = result.insertValidation?.canonicalChecks || [];
    const blocking = summarizeGuideBlocking(result);
    checks.push(
      {
        label: "Insert matches preset",
        status: result.insertValidation ? (result.insertValidation.matchesPreset ? "pass" : "warn") : "na",
        detail: result.insertValidation ? (result.insertValidation.matchesPreset ? "Designed insert matches the intended preset." : "Designed insert differs from the intended preset.") : "Insert identity check unavailable.",
      },
      {
        label: "Frame preserved",
        status: result.insertValidation ? (result.insertValidation.framePreserved ? "pass" : "warn") : "na",
        detail: result.insertValidation ? (result.insertValidation.framePreserved ? "Insert passes the frame check." : "Insert fails the frame check.") : "Frame check unavailable.",
      },
      {
        label: "Reporter or tag verified",
        status: canonicalChecks.length ? (canonicalChecks.every((check) => check.matches) ? "pass" : "warn") : "na",
        detail: canonicalChecks.length
          ? (canonicalChecks.every((check) => check.matches) ? "Canonical FPbase protein check passed." : "Canonical FPbase protein check failed.")
          : "No canonical reporter check attached to this construct.",
      },
      {
        label: "Guide blocking strength",
        status: blocking.status,
        detail: blocking.detail,
      },
      ...(result.type === "it" ? [{
        label: "Guide/donor pairing",
        status: (result.gs || []).length <= 1 || result.coDeliverySafe ? "pass" : "warn",
        detail: result.guideDonorInstruction || "Use each guide only with its matched donor.",
      }] : []),
      ...(result.guideUse ? [{
        label: "Guide use",
        status: result.guideUse.status,
        detail: result.guideUse.detail,
      }] : []),
      ...(result.donorFormat ? [{
        label: "Donor format and synthesis",
        status: result.donorFormat.status,
        detail: describeDonorFormatSummary(result.donorFormat),
      }] : []),
      {
        label: "Primer thermodynamics",
        status: primerReadiness.status,
        detail: primerReadiness.detail,
      },
      {
        label: "Primer genome specificity",
        status: "na",
        detail: "Genome-wide primer specificity is not automatic; run the specificity check before ordering.",
      },
    );
    return checks;
  }

  return checks;
}

export function buildReportSnapshotItems(result) {
  if (!result) return [];
  if (result.type === "genomic-snv") return [
    {label:"Edit class",value:"Genomic SNP",tone:"accent"},
    {label:"Target",value:`${result.input.position} ${result.input.ref}→${result.input.alt}${isReverse(result.input) ? " (reverse-strand gene)" : ""}`,tone:"default"},
    {label:"Guides",value:String(result.gs.length),tone:"default"},
    {label:"Primers",value:result.amp || "Pending",tone:"warm"},
  ];
  const guideCount = (result.gs || []).length;
  const pairSpacing = result.type === "ko" && result.gs?.length >= 2 && Number.isFinite(result.gs[0]?.d) && Number.isFinite(result.gs[1]?.d)
    ? `${Math.abs(result.gs[1].d - result.gs[0].d)} bp`
    : null;
  if (result.type === "ko") {
    return [
      { label: "Edit class", value: "Knockout", tone: "accent" },
      { label: "Primary target", value: result.exon || "Coding region", tone: "default" },
      { label: "Guide pair", value: pairSpacing ? `${guideCount} guides · ${pairSpacing}` : `${guideCount} guides`, tone: guideCount >= 2 ? "success" : "warm" },
      { label: "Primers", value: result.amp || (result.referenceOnly ? "Needs reference" : "Pending"), tone: result.amp ? "success" : "warm" },
    ];
  }
  if (result.type === "pm") {
    return [
      { label: "Edit class", value: "SNP knock-in", tone: "accent" },
      { label: "Target", value: `${result.wA}${result.an}${result.mA}`, tone: "default" },
      { label: "Guides", value: `${guideCount}`, tone: guideCount ? "success" : "warm" },
      { label: "Primers", value: result.amp || "Pending", tone: result.amp ? "success" : "warm" },
    ];
  }
  if (result.type === "it") {
    return [
      { label: "Edit class", value: "Internal tag", tone: "accent" },
      { label: "Insert", value: result.tag || "Tag", tone: "default" },
      { label: "Donors", value: `${(result.os || []).length}`, tone: (result.os || []).length ? "success" : "warm" },
      { label: "Primers", value: result.amp || "Pending", tone: result.amp ? "success" : "warm" },
    ];
  }
  if (result.type === "ct" || result.type === "nt") {
    return [
      { label: "Edit class", value: result.type === "ct" ? "C-terminal KI" : "N-terminal KI", tone: "accent" },
      { label: "Insert", value: result.tag || "Tag", tone: "default" },
      { label: "Donor", value: result.dl ? `${result.dl} bp` : "Ready", tone: "success" },
      { label: "Primers", value: result.amp || "Pending", tone: result.amp ? "success" : "warm" },
    ];
  }
  return [];
}

function buildReportSnapshotHtml(result) {
  const items = buildReportSnapshotItems(result);
  if (!items.length) return "";
  const toneColor = (tone) => tone === "accent" ? "#2E75B6" : tone === "warm" ? "#B54708" : tone === "success" ? "#067647" : "#111827";
  const format = result.donorFormat;
  const subline = (item) => {
    if (item.label !== "Donor" || !format) return "";
    const arms = format.arms.five === format.arms.three ? `${format.arms.five}` : `${format.arms.five}/${format.arms.three}`;
    return `<div style="font-size:12px;color:#667085;margin-top:2px;">${format.short}, arms ${arms}</div>`;
  };
  return `
    <table class="strip"><tr>${items.map((item) => `<td><div style="font-size:11px;font-weight:700;color:#667085;text-transform:uppercase;letter-spacing:0.4px;">${item.label}</div><div style="font-size:16px;font-weight:800;color:${toneColor(item.tone)};margin-top:2px;">${item.value}</div>${subline(item)}</td>`).join("")}</tr></table>
  `;
}

function buildDesignReadinessHtml(result) {
  const checks = buildDesignReadinessChecks(result);
  if (!checks.length) return "";
  const pill = (status) => status === "pass"
    ? { color: "#067647", background: "#D1FAE5", label: "Pass" }
    : status === "warn"
      ? { color: "#B42318", background: "#FEE4E2", label: "Review" }
      : { color: "#475467", background: "#EAECF0", label: "N/A" };
  // Items that need a decision come first; passes are last and kept to one line of small text.
  const rank = (status) => (status === "warn" ? 0 : status === "pass" ? 2 : 1);
  const ordered = checks.map((check, index) => ({ check, index }))
    .sort((a, b) => rank(a.check.status) - rank(b.check.status) || a.index - b.index).map((entry) => entry.check);
  const count = (status) => checks.filter((check) => check.status === status).length;
  const others = checks.length - count("warn") - count("pass");
  return `
    <p class="sub">${checks.length} checks: <b style="color:#B42318;">${count("warn")} to review</b>, ${others} not applicable or not automated, <b style="color:#067647;">${count("pass")} pass</b>.</p>
    <table class="checks">${ordered.map((check) => {
      const badge = pill(check.status);
      const muted = check.status === "pass";
      return `<tr><td style="width:62px;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${badge.color};background:${badge.background};">${badge.label}</span></td><td style="width:210px;font-weight:700;color:#111827;">${check.label}</td><td style="color:${muted ? "#667085" : "#344054"};font-size:${muted ? 12 : 12.5}px;">${check.detail}</td></tr>`;
    }).join("")}</table>
  `;
}

export function normalizeLocusWindow(result) {
  const genomicLength = result?.gb?.genomicSequence?.length || 0;
  if (!genomicLength) return null;
  const positions = [];
  (result.gs || []).forEach((guide) => {
    if (Number.isFinite(guide.cut)) positions.push(guide.cut);
    const noteCut = String(guide.note || guide.arm || "").match(/Cut at (\d+)/i);
    if (noteCut) positions.push(parseInt(noteCut[1], 10) - 1);
  });
  if (["pm", "genomic-snv"].includes(result.type) && Number.isFinite(result.gp)) positions.push(result.gp);
  if (result.type === "it" && Number.isFinite(result.gp)) positions.push(result.gp);
  if (result.type === "ct" && Number.isFinite(result.sp)) positions.push(result.sp - 1);
  if (result.type === "nt" && Array.isArray(result.gb?.cdsSegments) && result.gb.cdsSegments.length) positions.push(result.gb.cdsSegments[0][0]);
  if (!positions.length) return null;
  const center = Math.round(positions.reduce((sum, value) => sum + value, 0) / positions.length);
  const span = 520;
  const start = Math.max(0, center - Math.floor(span / 2));
  const end = Math.min(genomicLength, Math.max(start + 1, start + span));
  return { start, end, length: end - start, genomicLength };
}

function primerWindowMatches(seq, primer, reverse = false) {
  const target = String(primer || "").toUpperCase();
  if (!target) return null;
  const search = reverse ? reverseComplement(target) : target;
  const index = seq.indexOf(search);
  if (index < 0) return null;
  return { start: index, end: index + search.length, reverse };
}

export function buildLocusStructureItems(result, window) {
  if (!window) return { exons: [], introns: [] };
  const exons = Array.isArray(result?.gb?.exons) && result.gb.exons.length
    ? result.gb.exons
    : (Array.isArray(result?.gb?.cdsSegments)
      ? result.gb.cdsSegments.map(([start, end], index) => ({ start, end, exonNumber: index + 1, label: `Exon ${index + 1}` }))
      : []);
  const normalizeItem = (item, kind, label, color) => {
    if (item.end <= window.start || item.start >= window.end) return null;
    return {
      kind,
      label,
      color,
      start: item.start,
      end: item.end,
      left: ((Math.max(item.start, window.start) - window.start) / window.length) * 100,
      width: Math.max(1, ((Math.min(item.end, window.end) - Math.max(item.start, window.start)) / window.length) * 100),
    };
  };
  const exonItems = exons
    .map((exon) => normalizeItem(exon, "exon", exon.label || `Exon ${exon.exonNumber}`, "#2563EB"))
    .filter(Boolean);
  const intronItems = [];
  for (let index = 0; index < exons.length - 1; index += 1) {
    const left = exons[index];
    const right = exons[index + 1];
    if (right.start <= left.end) continue;
    const intron = normalizeItem(
      { start: left.end, end: right.start },
      "intron",
      `Intron ${left.exonNumber}-${right.exonNumber}`,
      "#94A3B8",
    );
    if (intron) intronItems.push(intron);
  }
  return { exons: exonItems, introns: intronItems };
}

export function buildLocusMapItems(result, window) {
  if (!window) return [];
  const items = [];
  const pushItem = (item) => {
    if (item.end <= window.start || item.start >= window.end) return;
    items.push({
      ...item,
      left: ((Math.max(item.start, window.start) - window.start) / window.length) * 100,
      width: (Math.max(2, (Math.min(item.end, window.end) - Math.max(item.start, window.start)) / window.length * 100)),
    });
  };
  (result.gs || []).forEach((guide, index) => {
    if (Number.isFinite(guide.cut)) {
      pushItem({
        label: `gRNA${index + 1}`,
        detail: `${guide.sp}${guide.note || guide.arm ? ` | ${guide.note || guide.arm}` : ""}`,
        start: guide.cut,
        end: guide.cut + 1,
        color: "#7C3AED",
        kind: "cut",
      });
    }
  });
  if (result.type === "genomic-snv" && Number.isFinite(result.gp)) pushItem({ label:"Edit", detail:isReverse(result.input) ? `${complementBase(result.input.ref)}→${complementBase(result.input.alt)}` : `${result.input.ref}→${result.input.alt}`, start:result.gp, end:result.gp+1, color:"#D97706", kind:"target" });
  if (result.type === "pm" && Number.isFinite(result.gp)) {
    pushItem({ label: "Edit", detail: `${result.wA}${result.an}${result.mA}`, start: result.gp, end: result.gp + 3, color: "#D97706", kind: "target" });
  }
  if (result.type === "it" && Number.isFinite(result.gp)) {
    pushItem({ label: "Insert", detail: result.tag, start: result.gp, end: result.gp + 3, color: "#D97706", kind: "target" });
  }
  if (result.type === "ct" && Number.isFinite(result.sp)) {
    const start = result.sp - 1;
    pushItem({ label: "Stop junction", detail: result.tag, start, end: start + 3, color: "#D97706", kind: "target" });
    pushItem({ label: "HDR donor", detail: `${result.il || 0} bp insert`, start: Math.max(0, start - (result.h5l || 0)), end: start + 3 + (result.h3l || 0), color: "#0EA5E9", kind: "donor" });
  }
  if (result.type === "nt" && Array.isArray(result.gb?.cdsSegments) && result.gb.cdsSegments.length) {
    const start = result.gb.cdsSegments[0][0];
    pushItem({ label: "Start junction", detail: result.tag, start, end: start + 3, color: "#D97706", kind: "target" });
    pushItem({ label: "HDR donor", detail: `${result.il || 0} bp insert`, start: Math.max(0, start - (result.h5l || 0)), end: start + 3 + (result.h3l || 0), color: "#0EA5E9", kind: "donor" });
  }
  const seq = result.gb?.genomicSequence || "";
  const forwardPrimer = result.ps?.[0]?.s;
  const reversePrimer = result.ps?.[1]?.s;
  const forwardRange = seq ? primerWindowMatches(seq, forwardPrimer, false) : null;
  const reverseRange = seq ? primerWindowMatches(seq, reversePrimer, true) : null;
  if (forwardRange) pushItem({ label: "Fw primer", detail: forwardPrimer, start: forwardRange.start, end: forwardRange.end, color: "#059669", kind: "primer" });
  if (reverseRange) pushItem({ label: "Rev primer", detail: reversePrimer, start: reverseRange.start, end: reverseRange.end, color: "#DC2626", kind: "primer" });
  return items;
}

const escapeSchemeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Publication-style design scheme (see designScheme.js): inline SVG, a one-click SVG download and a
// draft figure legend. Empty string when the design type or result cannot be drawn.
export function buildDesignSchemeHtml(result) {
  if (!supportsDesignScheme(result)) return "";
  const svg = buildDesignSchemeSvg(result, { responsive: true });
  if (!svg) return "";
  const standalone = buildDesignSchemeSvg(result);
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standalone)}`;
  const caption = buildDesignSchemeCaption(result);
  return `
    <div style="margin:14px 0 16px 0;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:8px;">
        <span style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Design Scheme</span>
        <a download="${escapeSchemeHtml(buildDesignSchemeFilename(result))}" href="${href}" style="font-size:12px;color:#0F766E;">Download SVG</a>
      </div>
      ${svg}
      ${caption ? `<details class="fold"><summary>Suggested figure legend (draft; complete the bracketed fields)</summary><div class="body"><p style="margin:0;font-size:12px;line-height:1.5;color:#344054;">${escapeSchemeHtml(caption)}</p></div></details>` : ""}
    </div>
  `;
}

// Donor format, arms and synthesis pre-check for terminal-tag designs (see donorFormat.js).
export function buildDonorFormatHtml(result) {
  const info = describeDonorFormat(result?.donorFormat);
  if (!info) return "";
  const warn = info.status === "warn";
  const list = (items, color) => (items.length ? `<ul style="margin:2px 0 6px 18px;padding:0;font-size:12px;line-height:1.5;color:${color};">${items.map((item) => `<li>${escapeSchemeHtml(item)}</li>`).join("")}</ul>` : "");
  const orderEntries = result.donorFormat.orderStrands?.length > 1
    ? result.donorFormat.orderStrands
    : (result.donorFormat.orderSequence ? [{ strand: result.donorFormat.orderStrand, sequence: result.donorFormat.orderSequence, guideNames: [] }] : []);
  const order = orderEntries.map((entry, index) => {
    const title = orderEntries.length > 1 ? `ssODN ${index + 1} to order` : "Sequence to order";
    const forGuides = entry.guideNames?.length ? ` for ${entry.guideNames.join(" and ")}` : "";
    return `<div style="font-size:12px;color:#344054;margin:8px 0 4px 0;"><b>${escapeSchemeHtml(title)} (${escapeSchemeHtml(entry.strand)} strand${escapeSchemeHtml(forGuides)}, 5'-3', ${entry.sequence.length} nt)</b></div><div class="mono" style="word-break:break-all;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px;">${escapeSchemeHtml(entry.sequence)}</div>`;
  }).join("");
  return `
    <div style="margin:0 0 12px 0;padding:2px 0 2px 12px;border-left:4px solid ${warn ? "#f59e0b" : "#d0d5dd"};">
      <div style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:2px;">${escapeSchemeHtml(info.heading)}</div>
      ${buildKeyValueTableHtml(info.rows.map(([label, value]) => ({ label: escapeSchemeHtml(label), value: escapeSchemeHtml(value) })), 1)}
      ${list(info.problems, "#B42318")}
      ${list(info.notes, "#344054")}
      <div style="font-size:12px;color:#344054;"><b>Synthesis pre-check</b> <span style="color:#667085;">(${escapeSchemeHtml(info.synthesisScope)})</span></div>
      ${list(info.synthesis, warn ? "#B54708" : "#344054")}
      ${order}
    </div>
  `;
}

// Compact, scannable KO summary table with collapsible deep-dive rationale.
function buildKnockoutFactsHtml(result) {
  const summaryRows = [];
  const detailRows = [];
  if (result.exon) summaryRows.push({ label: "Target exon", value: result.exon });
  const spacingBp = (result.gs?.length >= 2 && Number.isFinite(result.gs[0]?.d) && Number.isFinite(result.gs[1]?.d))
    ? `${Math.abs(result.gs[1].d - result.gs[0].d)} bp`
    : null;
  const outcome = result.deletionOutcome;
  if (outcome) {
    summaryRows.push({
      label: "Expected excision",
      value: `${outcome.deletionSize} bp${spacingBp ? ` (cut spacing ${spacingBp})` : ""} · mod 3 = ${outcome.deletionMod3} (${outcome.frameshiftPredicted ? "frameshift" : "in-frame"})`,
    });
    if (outcome.cutBoundaryRange) {
      detailRows.push({ label: "Staggered cut boundaries", value: `${outcome.cutBoundaryRange[0]}–${outcome.cutBoundaryRange[1]} bp between strand-cut combinations.` });
    }
    if (outcome.spliceDonorRemoved) {
      summaryRows.push({ label: "Splice donor", value: `Removed (exon skipping plausible; exon ${outcome.exonLength} bp, mod 3 = ${outcome.exonSkippingMod3})` });
    }
  } else if (spacingBp) {
    summaryRows.push({ label: "Pair spacing", value: spacingBp });
  }

  const ko = result.koAssessment;
  if (ko) {
    summaryRows.push({ label: "KO confidence tier", value: `${ko.tier.toUpperCase()} — ${ko.summary}` });
    summaryRows.push({ label: "Inter-cut deletion", value: `${ko.between.sizeBp} bp (${ko.between.nmd || ko.between.class})` });
    if (ko.outcomes?.guides?.length) {
      const lofSummary = ko.outcomes.guides
        .map((g, i) => `gRNA${i + 1}: ${g.lofPct}% LoF (${g.frameshiftPct}% FS, ${g.biallelicPct}% biallelic)`)
        .join(" · ");
      summaryRows.push({ label: "Single-cut Lindel LoF", value: lofSummary });
    }
    if (ko.isoformNote) {
      summaryRows.push({ label: "Isoform coverage", value: ko.isoformNote.replace(/^Isoform coverage:\s*/, "") });
    }
    ko.reasons.forEach((reason) => detailRows.push({ label: "Tier note", value: reason }));
    ko.guides.forEach((guide, index) => {
      detailRows.push({
        label: `gRNA${index + 1} NMD margin`,
        value: `${guide.robustPct}% robust NMD, ${guide.marginalPct}% borderline, ${guide.escapePct}% NMD-escape (nearest PTC ${guide.minMarginNt} nt upstream of last EJC across ${guide.outcomes} simulated indels).`,
      });
    });
    if (ko.outcomes) {
      detailRows.push({ label: "Outcome model", value: `${ko.outcomes.model} (single-cut repair prior; confirm protein loss by Western blot or MS).` });
    } else if (ko.outcomesUnavailable) {
      detailRows.push({ label: "Outcome model", value: `Not applied: ${ko.outcomesUnavailable}` });
    }
  }
  describeKoSelection(result.koSelection).forEach((value) => detailRows.push({ label: "Guide selection filter", value }));
  if (result.strat) detailRows.push({ label: "Strategy", value: result.strat });

  const mainTable = buildKeyValueTableHtml(summaryRows, 2);
  const foldBlock = detailRows.length
    ? `<details class="fold"><summary>Detailed candidate selection &amp; repair simulation rationale (${detailRows.length})</summary><div class="body">${buildKeyValueTableHtml(detailRows, 1)}</div></details>`
    : "";
  return `${mainTable}${foldBlock}`;
}

function buildBlockingChangesHtml(result) {
  if (!result.ss?.length) return "";
  const guideName = (index) => result.gs?.[index - 1]?.n || `gRNA${index}`;
  return `
    <div style="margin:0 0 12px 0;">
      <div style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:2px;">Guide-blocking changes in the donor</div>
      <ul style="margin:2px 0 0 18px;padding:0;font-size:12.5px;line-height:1.5;color:#7F1D1D;">${result.ss.map((mutation) => `<li>${guideName(mutation.gi)}: ${mutation.lb} (${mutation.oc} -> ${mutation.nc}) | ${mutation.pur}</li>`).join("")}</ul>
    </div>
  `;
}

function buildLocusMapHtml(result) {
  const window = normalizeLocusWindow(result);
  if (!window) return "";
  const structure = buildLocusStructureItems(result, window);
  const items = buildLocusMapItems(result, window);
  if (!items.length) return "";
  return `
    <div style="margin:0 0 14px 0;padding:12px;border:1px solid #d7dee7;border-radius:12px;background:#f8fafc;">
      <div style="margin-bottom:8px;">
        <div style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">Target Region Map</div>
        <div style="font-size:12px;color:#555;">Showing ${window.start + 1}-${window.end} on the uploaded reference sequence.</div>
      </div>
      <div style="font-size:11px;color:#667085;font-weight:700;margin-bottom:6px;">Exon / intron structure</div>
      <div style="position:relative;height:18px;border-radius:999px;background:#E5E7EB;overflow:hidden;margin-bottom:10px;">
        ${structure.introns.map((item) => `<div title="${item.label}" style="position:absolute;left:${item.left}%;width:${item.width}%;top:7px;height:4px;background:${item.color};opacity:0.9;"></div>`).join("")}
        ${structure.exons.map((item) => `<div title="${item.label}" style="position:absolute;left:${item.left}%;width:${item.width}%;top:0;bottom:0;background:${item.color};border-radius:999px;opacity:0.85;"></div>`).join("")}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        ${structure.exons.map((item) => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${item.color};background:${item.color}14;border:1px solid ${item.color}33;">${item.label}</span>`).join("")}
        ${structure.introns.map((item) => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${item.color};background:${item.color}14;border:1px solid ${item.color}33;">${item.label}</span>`).join("")}
      </div>
      <div style="font-size:11px;color:#667085;font-weight:700;margin-bottom:6px;">Guides, edits, donors, and primers</div>
      <div style="position:relative;height:14px;border-radius:999px;background:#E5E7EB;overflow:hidden;margin-bottom:14px;">
        ${items.map((item) => `<div title="${item.label}: ${item.detail || ""}" style="position:absolute;left:${item.left}%;width:${item.width}%;top:0;bottom:0;background:${item.color};opacity:${item.kind === "cut" ? 0.95 : 0.7};"></div>`).join("")}
      </div>
      <div style="display:grid;gap:8px;">
        ${items.map((item) => `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#344054;"><span style="display:inline-flex;width:10px;height:10px;border-radius:999px;background:${item.color};margin-top:3px;flex:0 0 auto;"></span><span><strong>${item.label}</strong>${item.detail ? `: ${item.detail}` : ""}</span></div>`).join("")}
      </div>
    </div>
  `;
}

function buildInternalProteinHtml(result) {
  const preview = result?.codingPreview;
  if (!preview) return "";
  return `
    <div style="margin:0 0 14px 0;padding:12px;border:1px solid #d7dee7;border-radius:12px;background:#f8fafc;">
      <div style="color:#667085;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Coding Frame View</div>
      <p style="font-size:12px;color:#555;margin:0 0 10px 0;">Insert ${result.tag} after ${result.wA}${result.an}, before ${result.nextAA}${result.an + 1}.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#92400E;background:#FDE68A;">Inserted tag codons / amino acids</span>
      </div>
      ${buildAlignedRowHtml("WT codons", { tokens: preview.wtCodons }, [], "wt")}
      ${buildAlignedRowHtml("Donor codons", { tokens: preview.donorCodons }, Array.from({ length: preview.insertCodonLength }, (_, index) => preview.insertCodonStart + index), "donor")}
      ${buildAlignedRowHtml("WT amino acids", { tokens: preview.wtAas }, [], "wt")}
      ${buildAlignedRowHtml("Donor amino acids", { tokens: preview.donorAas }, Array.from({ length: preview.insertAaLength }, (_, index) => preview.insertAaStart + index), "donor")}
    </div>
  `;
}

function mirrorAnnotations(annotations = [], sequenceLength = 0) {
  return (annotations || []).map((item) => ({
    ...item,
    start: Math.max(0, sequenceLength - item.end),
    end: Math.max(0, sequenceLength - item.start),
  }));
}

export function buildInternalStrandModels(donor) {
  const ordered = donor.od || "";
  const opposite = reverseComplement(ordered);
  const insertLength = Math.max(0, (donor.insertEnd || 0) - (donor.insertStart || 0));
  const orderedGuideSite = donor.guideSiteIndexes || [];
  const orderedGuidePam = donor.guidePamIndexes || [];
  const orderedSilent = donor.silentIndexes || [];
  const projectWtIndexes = (indexes, wtLength) => indexes
    .map((index) => {
      if (index < (donor.insertStart || 0)) return index;
      if (index >= (donor.insertEnd || 0)) return index - insertLength;
      return null;
    })
    .filter((index) => index !== null && index >= 0 && index < wtLength);
  const orderedWt = donor.wo || "";
  const oppositeWt = reverseComplement(orderedWt);
  const reverseIndexes = (indexes, length) => (indexes || []).map((index) => length - 1 - index).sort((left, right) => left - right);
  const orderedLabel = donor.guideStrand === "+" ? "- strand donor" : "+ strand donor";
  const oppositeLabel = donor.guideStrand === "+" ? "+ strand donor" : "- strand donor";
  const strands = [
    {
      key: "ordered",
      title: orderedLabel,
      recommended: true,
      note: `Recommended to order. This strand is reverse complement to ${donor.guideName}. Cut site lies between the 91 bp and 36 bp arms.`,
      wt: orderedWt,
      donor: ordered,
      annotations: donor.donorAnnotations || [],
      guideSiteIndexes: orderedGuideSite,
      guidePamIndexes: orderedGuidePam,
      silentIndexes: orderedSilent,
      wtGuideSiteIndexes: projectWtIndexes(orderedGuideSite, orderedWt.length),
      wtGuidePamIndexes: projectWtIndexes(orderedGuidePam, orderedWt.length),
    },
    {
      key: "opposite",
      title: oppositeLabel,
      recommended: false,
      note: "Opposite donor strand for reference. Cut site lies between the 36 bp and 91 bp arms on this view.",
      wt: oppositeWt,
      donor: opposite,
      annotations: mirrorAnnotations(donor.donorAnnotations || [], ordered.length),
      guideSiteIndexes: reverseIndexes(orderedGuideSite, ordered.length),
      guidePamIndexes: reverseIndexes(orderedGuidePam, ordered.length),
      silentIndexes: reverseIndexes(orderedSilent, ordered.length),
      wtGuideSiteIndexes: reverseIndexes(projectWtIndexes(orderedGuideSite, orderedWt.length), orderedWt.length),
      wtGuidePamIndexes: reverseIndexes(projectWtIndexes(orderedGuidePam, orderedWt.length), orderedWt.length),
    },
  ];
  if (donor.enzyme && donor.enzyme !== "spcas9") {
    const reversed = donor.orderStrand === "antisense";
    strands[0].title = `${reversed ? "-" : "+"} strand donor (input reference)`;
    strands[1].title = `${reversed ? "+" : "-"} strand donor (input reference)`;
    strands[0].note = donor.strand_note; strands[1].note = "Opposite strand for reference.";
  }
  return strands;
}

function buildInternalSequenceHtml(label, sequence, guideSiteIndexes = [], guidePamIndexes = [], silentIndexes = [], annotations = [], mode = "donor") {
  const guideSet = new Set(guideSiteIndexes);
  const pamSet = new Set(guidePamIndexes);
  const silentSet = new Set(silentIndexes);
  const findAnnotation = (index) => annotations.filter((item) => index >= item.start && index < item.end).sort((left, right) => (right.priority || 0) - (left.priority || 0))[0];
  const sequenceHtml = (sequence || "").split("").map((base, index) => {
    const annotation = mode === "donor" ? findAnnotation(index) : null;
    const styles = [
      `background:${pamSet.has(index) ? PM_GUIDE_COLORS.pam : silentSet.has(index) && mode === "donor" ? PM_EDIT_COLORS.silent : guideSet.has(index) ? PM_GUIDE_COLORS.site : annotation?.priority > 1 ? `${annotation.color}22` : "transparent"}`,
      `color:${annotation?.color && mode === "donor" && !guideSet.has(index) && !pamSet.has(index) && !silentSet.has(index) ? annotation.color : "#111827"}`,
      `font-weight:${guideSet.has(index) || pamSet.has(index) || silentSet.has(index) || annotation ? 800 : 400}`,
    ].join(";");
    return `<span title="${annotation?.title || annotation?.label || ""}" style="${styles}">${base}</span>`;
  }).join("");
  return `
    <div style="margin:0 0 8px 0;">
      <div style="color:#667085;font-size:11px;margin-bottom:4px;">${label}</div>
      <div style="font-family:Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;">${sequenceHtml}</div>
    </div>
  `;
}

function buildInternalDonorHtml(donor, releaseStatus = "ready") {
  const blockingSummary = (donor.silentMutations || []).map((mutation) => `${mutation.lb}: ${mutation.oc} -> ${mutation.nc} | ${mutation.pur}`).join("<br/>");
  const crossGuideSummary = (donor.guideProtection || []).map((entry) => `${entry.guideName}: ${entry.tier} — ${entry.reason}`).join("<br/>");
  const strands = buildInternalStrandModels(donor);
  return `
    <h3 style="color:#2E75B6;margin:18px 0 8px 0;">${donor.n} (${donor.sl})</h3>
    <p style="font-size:12px;color:#555;margin:0 0 10px 0;">Linked guide: ${donor.guideName}</p>
    ${crossGuideSummary ? `<p style="font-size:12px;color:#344054;margin:0 0 10px 0;"><strong>Protection against all offered guides:</strong><br/>${crossGuideSummary}</p>` : ""}
    ${blockingSummary ? `<p style="font-size:12px;color:#7F1D1D;margin:0 0 10px 0;"><strong>Guide-blocking mutation:</strong><br/>${blockingSummary}</p>` : ""}
    ${renderStrandCards(strands, (strand) => {
      const badge = getDonorStrandBadge(strand, releaseStatus);
      return `
      <div style="margin:0 0 12px 0;padding:12px;border:1px solid ${badge.border};border-radius:12px;background:${badge.panel};">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;color:#1f2937;">${strand.title}</span>
          <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${badge.fg};background:${badge.bg};">${badge.label}</span>
        </div>
        <p style="font-size:12px;color:#555;margin:0 0 10px 0;">${strand.note}</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#1f2937;background:${PM_GUIDE_COLORS.site};">gRNA site</span>
          <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#92400E;background:${PM_GUIDE_COLORS.pam};">PAM</span>
          ${strand.silentIndexes?.length ? `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#7F1D1D;background:${PM_EDIT_COLORS.silent};">${strand.blockingLabel || "Silent mutation"}</span>` : ""}
          ${[...new Map((strand.annotations || []).map((item) => [`${item.badgeLabel || item.label}|${item.color}`, item])).values()].map((item) => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${item.color};background:${item.color}14;border:1px solid ${item.color}33;">${item.badgeLabel || item.label}</span>`).join("")}
        </div>
        ${buildInternalSequenceHtml("WT context", strand.wt, strand.wtGuideSiteIndexes, strand.wtGuidePamIndexes, [], [], "wt")}
        ${buildInternalSequenceHtml("Donor ssODN", strand.donor, strand.guideSiteIndexes, strand.guidePamIndexes, strand.silentIndexes, strand.annotations, "donor")}
      </div>
    `;
    })}
  `;
}

function buildAnnotatedDonorHtml(sequence, annotations = []) {
  const findAnnotation = (index) => annotations.filter((item) => index >= item.start && index < item.end).sort((left, right) => (right.priority || 0) - (left.priority || 0))[0];
  const legendItems = [...new Map(annotations.map((item) => [`${item.badgeLabel || item.label}|${item.color}`, item])).values()];
  const legend = legendItems.map((item) => `<span title="${item.title || item.label}" style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${item.color};background:${item.color}14;border:1px solid ${item.color}33;">${item.badgeLabel || item.label}</span>`).join("");
  const sequenceHtml = (sequence || "").split("").map((base, index) => {
    const annotation = findAnnotation(index);
    return `<span title="${annotation?.title || annotation?.label || ""}" style="color:${annotation?.color || "#111827"};font-weight:${annotation ? 800 : 400};background:${annotation?.priority > 1 ? `${annotation.color}22` : "transparent"};">${base}</span>`;
  }).join("");
  return `
    <div style="margin:0 0 14px 0;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">${legend}</div>
      <div style="font-family:Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;">${sequenceHtml}</div>
    </div>
  `;
}

function buildReviewListHtml(items) {
  if (!items.length) return "<p style=\"font-size:13px;line-height:1.45;\">No automated warnings were triggered. Manual review is still required before synthesis or ordering.</p>";
  return `<ul style="padding-left:18px;">${items.map((item) => `<li style="margin:0 0 8px 0;color:${item.level === "warning" ? "#B42318" : "#344054"};"><strong>${item.level === "warning" ? "Warning" : "Check"}:</strong> ${item.text}</li>`).join("")}</ul>`;
}

function buildHistoricalRowsHtml(matches) {
  if (!matches.length) return "";
  const rows = matches.map((record) => [
    record.targetGene || "n/a",
    record.parentalLine || "n/a",
    record.establishedLine || "n/a",
    (record.guides || []).map((guide) => guide.sequence).filter(Boolean).join("<br/>") || "n/a",
    record.donorSequence || "N/A",
    record.guideOverlap ? `${record.guideOverlap} exact` : "none",
  ]);
  return `<table>${tableHtml([["Gene", "Parental line", "Established line", "Used gRNAs", "Used donor", "Guide overlap"]], true)}${tableHtml(rows)}</table>`;
}


/** Co-delivery findings: only rendered when the design was built for co-transfection. */
function buildCoDeliveryHtml(result) {
  if (!result.coDeliveryBlockingRequested) return "";
  const selection = result.coDeliverySelection;
  const risk = result.dualCutDeletionRisk;
  const rows = [`<li style="font-size:13px;line-height:1.5;">${result.guideDonorInstruction || ""}</li>`];
  if (selection) {
    rows.push(`<li style="font-size:13px;line-height:1.5;">Searched ${selection.searched} candidate guide${selection.searched === 1 ? "" : "s"} in the window; ${selection.stronglyBlockableSelected} of the selected guides can be destroyed by a synonymous PAM change.</li>`);
  }
  if (result.coDeliveryOutOfWindow) {
    rows.push('<li style="font-size:13px;line-height:1.5;">At least one guide target lies outside the other donor window, so no additional blocking change can cover it. Co-delivery needs guides whose targets both fall inside a single ssODN.</li>');
  }
  if (risk) {
    rows.push(`<li style="font-size:13px;line-height:1.5;"><strong>Screen for the deletion product.</strong> ${risk.note}</li>`);
  }
  return `
    <div style="margin:0 0 18px 0;padding:12px 14px;border:1px solid #B45309;border-left-width:6px;border-radius:10px;background:#FFFAEB;">
      <div style="font-size:12px;font-weight:800;letter-spacing:0.6px;color:#B45309;text-transform:uppercase;">Co-delivery of two guides and two ssODNs</div>
      <ul style="margin:8px 0 0 0;padding-left:18px;">${rows.join("")}</ul>
    </div>
  `;
}

/**
 * The authoritative release verdict, rendered at the top of the report.
 *
 * The report previously carried only its own nine-row readiness checklist, which graded a
 * hard blocker as "warn" and never stated the release status at all - so a design the
 * engine had BLOCKED read as a mostly-green checklist with no instruction not to order it.
 * The verdict now comes from releaseVerdict.js, which the on-screen panel renders too.
 */
function buildReleaseVerdictHtml(result) {
  // Same verdict object the on-screen panel renders, so the two cannot word it differently.
  const verdict = getReleaseVerdict(result);
  const sections = getReleaseVerdictSections(verdict).map((section) => (
    `<div style="margin-top:10px;"><div style="font-size:12px;font-weight:800;letter-spacing:0.4px;text-transform:uppercase;color:${section.color};margin-bottom:4px;">${section.title}</div><ul style="margin:0;padding-left:18px;">${section.items.map((item) => `<li style="font-size:13px;line-height:1.5;color:#344054;">${item}</li>`).join("")}</ul></div>`
  )).join("");
  return `
    <div style="margin:14px 0 18px 0;padding:14px 16px;border:2px solid ${verdict.border};border-left-width:8px;border-radius:10px;background:${verdict.bg};">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:#667085;text-transform:uppercase;">Release status</div>
      <div style="font-size:22px;font-weight:800;color:${verdict.fg};margin:2px 0 6px 0;">${verdict.label}</div>
      <div style="font-size:13px;line-height:1.5;color:#344054;">${verdict.lead}</div>
      ${sections}
    </div>
  `;
}

function buildGenomicBlockingComparisonHtml(result) {
  const at=p=>genomicAt(result.input,p);
  const screen=s=>!s?'unassessed':`${s.risk}; ${s.junctionChanges.length} junction changes, ${s.nearby.length} proximity flags, ${s.motifChanges.length} GT/AG motif changes${s.motifChanges.length ? ' ('+s.motifChanges.map(m=>at(m.gp)+': '+m.before+' to '+m.after).join('; ')+')' : ''}. Splice-strength prediction: unassessed.`;
  return `<h2>Blocking alternatives and splice screen</h2><p>Policy: ${result.input.blockingPolicy || 'none'}. Synonymous coding changes preserve amino acids relative to the requested-edit allele; noncoding changes are not silent.</p><p>Compare the intended effect (WT to requested edit) separately from added effects (requested edit to final donor). This is a local sequence screen, not a prediction of exon skipping, intron retention or cryptic-site use.</p>${result.candidates.map(c=>{
    const comp=c.comparison;
    if(!comp)return '';
    const intended=comp.requestedSplice;
    return `<h3>${c.name}</h3><p>${comp.recommendation}</p><p><strong>Requested edit vs WT:</strong> ${screen(intended)} ${intended.junctionChanges.map(j=>`${j.kind} ${at(j.start)}: ${j.before} to ${j.after}`).join('; ')}</p><table>${tableHtml([['Alternative','Added changes (1-based genomic)','Protection / residual CFD','Added splice-screen signals','Selected']],true)}${tableHtml(comp.variants.map(v=>[v.id,v.changes.map(m=>`${at(m.gp)} ${result.gb.genomicSequence[m.gp]}>${m.nb} (${m.mt==='silent'?'synonymous coding':'noncoding'})`).join('; ')||'None',`${v.protection.tier} / ${Number.isFinite(v.protection.cfd)?v.protection.cfd.toFixed(4):'unscored'}`,screen(v.splice),v.id===comp.selected.id?'Yes':'No']))}</table>`;
  }).join('')}<p>Local screening uses annotated junction dinucleotides, a conservative 20-bp proximity flag and GT/AG motif changes. No local flags does not establish splice safety. Branch points, enhancers, silencers and alternative transcripts remain unassessed.</p>`;
}

export function buildGuideAlternativesHtml(result) {
  const search = result?.guideAlternatives;
  if (!search) return "";
  const esc = value => escapeSchemeHtml(String(value));
  const rows = (search.candidates || []).map(g => `<tr>
    <td class="mono">${esc(g.sp)}</td><td>${esc(g.pm)}</td><td>${esc(g.str)}</td>
    <td>${Math.abs(g.d)} bp ${g.d < 0 ? "upstream" : g.d > 0 ? "downstream" : "at insertion"}</td>
    <td><b>${esc(g.protection)}</b><br>${esc(g.reason)}</td>
    <td>${g.byInsertion ? "Target disrupted by insertion" : Number.isFinite(g.cfd) ? g.cfd.toFixed(4) : "Not assessed"}</td>
  </tr>`).join("");
  return `<h3>Alternative gRNAs within ±${search.radius} bp</h3>
    <p>${result.gs.length} selected guide(s) from the ${search.selectedWindow} bp search window. ${esc(search.note)}</p>
    ${rows ? `<table><thead><tr><th>Spacer (5′ → 3′)</th><th>PAM</th><th>Strand</th><th>Cut distance</th><th>Protection with current donor</th><th>CFD residual</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p>No additional candidates passed the existing PAM and spacer filters within ±${search.radius} bp.</p>`}`;
}

export function buildReportHtml(meta, result, fileName, historicalContext, reviewItems, brunelloLibrary = null) {
  if (!result) return "";
  const headerRows = [
    ["Group", meta.clientName || "n/a"],
    ["IRIS ID", meta.irisId || "[to be assigned]"],
  ];
  const geneInfoItems = buildGeneInfoItems(meta, result, fileName);
  const guideRows = (result?.gs || []).map((guide) => [guide.n, renderGuideSequenceHtml(guide.sp, guide.pm, result.enzyme), `${guide.str} strand`, `${guide.gc}%`, [guide.arm || guide.note || "", ...(guide.cuts ? [`Predicted target/non-target cut boundaries: ${guide.cuts.target}/${guide.cuts.non_target}.`] : [])].join(" ")]);
  const primerCandidateRows = buildPrimerCandidateRows(result);
  const ssOdnNotes = buildSsOdnNotes(result);
  const sectionTitle = ["pm", "genomic-snv"].includes(result.type) ? "ssODN Donor Templates" : result.type === "ko" ? "Knockout Design" : "Donor Design";
  const hasHistoricalMatches = Boolean(historicalContext?.topMatches?.length);
  const brunelloReferenceGuideSet = getBrunelloReferenceGuideSet(result, brunelloLibrary);
  const releaseVerdictBlock = buildReleaseVerdictHtml(result);
  const coDeliveryBlock = buildCoDeliveryHtml(result);
  const readinessBlock = buildDesignReadinessHtml(result);
  const designSchemeBlock = buildDesignSchemeHtml(result);
  const locusMapBlock = buildLocusMapHtml(result);
  const snapshotBlock = buildReportSnapshotHtml(result);
  // Per donor, not per design: the guide+donor pair is the orderable unit.
  const donorStatus = (donor) => getDonorReleaseStatus(result, donor.guideName);
  const donorBlock = ["pm", "genomic-snv"].includes(result.type)
    ? ((result.os || []).length
      ? (result.os || []).map((donor) => buildPmDonorHtml(donor, donorStatus(donor))).join("")
      : `<p style="font-size:13px;line-height:1.45;color:#B42318;">No ssODN donor could be rendered for this SNP design. This usually means the asymmetric donor window ran outside the uploaded sequence bounds.</p>`)
      : result.type === "ko"
      ? `${result.referenceOnly ? `<p class="sub">Gene-list reference mode: exact cut spacing and primer geometry require a GenBank-backed locus run.</p>` : ""}${buildKnockoutFactsHtml(result)}`
      : result.type === "it"
        ? `${buildInsertVerificationHtml(result)}${(result.os || []).map((donor) => buildInternalDonorHtml(donor, donorStatus(donor))).join("") || `<p style="font-size:13px;line-height:1.45;color:#B42318;">No internal ssODN donor could be rendered for this in-frame tag design.</p>`}`
      : `${buildDonorFormatHtml(result)}${buildBlockingChangesHtml(result)}${buildInsertVerificationHtml(result)}${buildAnnotatedDonorHtml(result.donor || "", result.donorAnnotations || [])}`;
  const resolvedSectionTitle = result.type === "it" ? "Internal ssODN Donor Templates" : sectionTitle;
  // Section numbers follow what is present: the matched-records section only exists with matches.
  let nextSection = 5;
  const historicalNumber = hasHistoricalMatches ? nextSection++ : null;
  const readinessNumber = nextSection++;
  const reviewNumber = nextSection++;
  const alternativePrimers = primerCandidateRows.length
    ? `<details class="fold"><summary>Alternative primer pairs (${primerCandidateRows.length})</summary><div class="body"><table>${tableHtml([["Rank", "Forward", "Fw Tm", "Fw GC", "Fw Clamp", "Reverse", "Rev Tm", "Rev GC", "Rev Clamp", "Amplicon"]], true)}${tableHtml(primerCandidateRows)}</table></div></details>`
    : "";
  // A warning already printed word for word in the release status or the readiness table is not
  // listed a third time here.
  const alreadyShown = new Set([
    ...getReleaseVerdictSections(getReleaseVerdict(result)).flatMap((section) => section.items),
    ...buildDesignReadinessChecks(result).map((check) => check.detail),
  ]);
  const remainingReviewItems = (reviewItems || []).filter((item) => !alreadyShown.has(item.text));
  const omittedReviewItems = (reviewItems || []).length - remainingReviewItems.length;
  const reviewNote = omittedReviewItems
    ? `<p class="sub">${omittedReviewItems} item${omittedReviewItems === 1 ? " is" : "s are"} already shown above under Release status or Design Readiness and ${omittedReviewItems === 1 ? "is" : "are"} not repeated.</p>`
    : "";
  const primerQuality = getPrimerQualitySummary(result);
  const primerMeta = [
    result.amp ? `Expected amplicon: ${result.amp}` : "Expected amplicon: n/a",
    result.primerStrategy ? `Primer strategy: ${result.primerStrategy}` : "",
    primerQuality ? `Primer QC: ${primerQuality.confidence} confidence, pair penalty ${primerQuality.penalty}, Tm delta ${primerQuality.tmDelta} C` : "",
  ].filter(Boolean).join(" &middot; ");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${formatDesignLabel(meta, result)}</title>
<style>
*{box-sizing:border-box}
body{font-family:Calibri,Arial,sans-serif;margin:0;color:#1f2937;background:#ffffff;font-size:14px}
.wrap{max-width:980px;margin:0 auto;padding:18px 24px 40px 24px}
h1{font-size:22px;margin:6px 0 2px 0;color:#111827}
h2{font-size:16px;margin:26px 0 8px 0;padding-bottom:5px;border-bottom:2px solid #e5e7eb;color:#111827}
h3{font-size:14px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px 0;font-size:12.5px}
p{font-size:13px;line-height:1.45;margin:6px 0}
.sub{color:#667085;font-size:13px}
.note{color:#667085;font-style:italic}
.meta{color:#667085;font-size:12px}
.mono{font-family:Consolas,'DejaVu Sans Mono',monospace;font-size:12.5px;overflow-wrap:anywhere}
table.kv th{width:15%;text-align:left;font-weight:600;color:#667085;font-size:12px;padding:4px 8px;border-bottom:1px solid #eef2f6;vertical-align:top}
table.kv td{padding:4px 8px;border-bottom:1px solid #eef2f6;font-size:13px;font-weight:500;color:#111827;vertical-align:top}
table.strip td{border:1px solid #e5e7eb;padding:8px 12px;vertical-align:top;background:#f8fafc}
table.checks td{padding:5px 8px;border-bottom:1px solid #eef2f6;vertical-align:top;font-size:12.5px}
details.fold{border:1px solid #e5e7eb;border-radius:8px;margin:10px 0}
details.fold>summary{cursor:pointer;padding:7px 12px;font-weight:700;font-size:13px;color:#344054;background:#f8fafc;border-radius:8px}
details.fold[open]>summary{border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0}
details.fold>.body{padding:8px 12px 10px 12px}
@media print{.wrap{max-width:none;padding:0}details.fold{break-inside:avoid}h2{break-after:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <div class="meta">${headerRows.map(([label, value]) => `${label}: ${value}`).join(" &middot; ")}</div>
  <h1>Design: ${formatDesignLabel(meta, result)}</h1>
  <p class="sub">${meta.notes || "Strategy document generated by ASSURED CRISPR Designer."}</p>
  ${releaseVerdictBlock}
  ${coDeliveryBlock}
  ${snapshotBlock}
  ${result.type === "genomic-snv" ? (result.extraSectionHtml || buildGenomicBlockingComparisonHtml(result)) : ""}
  ${designSchemeBlock}
  <h2>1. Gene Information</h2>
  ${buildKeyValueTableHtml(geneInfoItems, 2)}
  ${result.type === "genomic-snv" ? `<p class="mono">${result.context.before}[${result.input.ref}→${result.input.alt}]${result.context.after}</p><p>${result.context.nearestExonBoundary ? `Nearest annotated boundary: ${result.context.nearestExonBoundary.label}, ${result.context.nearestExonBoundary.edge}; offset ${result.context.nearestExonBoundary.distance} bp.` : "Exon boundary context unavailable."}</p>` : ""}
  <h2>2. gRNA Sequences</h2>
  <table>${tableHtml([["Name", "Sequence", "Strand", "GC", "Notes"]], true)}${tableHtml(guideRows)}</table>
  ${buildGuideAlternativesHtml(result)}
  <h2>3. Recommended Primers</h2>
  ${buildPrimerSummaryHtml(result)}
  <p class="sub">${primerMeta}</p>
  ${alternativePrimers}
  <h2>4. ${resolvedSectionTitle}</h2>
  <p class="note">${["pm", "genomic-snv"].includes(result.type) ? "WT and donor templates are listed together for review." : result.type === "ko" ? "Knockout designs use paired gRNAs and do not require an HDR donor." : result.type === "it" ? "Guide-linked internal ssODN donors are listed with protein-frame review." : "HDR donor sequence is listed in full below."}</p>
  ${donorBlock}
  ${result.type === "ko" && brunelloReferenceGuideSet ? `<details style="margin:0 0 14px 0;padding:12px;border:1px solid #FDBA74;border-radius:12px;background:#FFF7ED;"><summary style="cursor:pointer;font-weight:700;color:#9A3412;">Brunello CRISPRko Reference Guides (${brunelloReferenceGuideSet.guides.length})</summary><div style="margin-top:10px;"><p>${brunelloReferenceGuideSet.source}. ${brunelloReferenceGuideSet.summary}${brunelloReferenceGuideSet.requestedGene !== brunelloReferenceGuideSet.libraryGene ? ` Library symbol: ${brunelloReferenceGuideSet.libraryGene}.` : ""}</p><table>${tableHtml([["Spacer", "PAM", "Exon", "Rule Set 2", "Transcript", "Strand"]], true)}${tableHtml(brunelloReferenceGuideSet.guides.map((guide) => [guide.spacer, guide.pam, `Exon ${guide.exon}`, String(guide.ruleSet2), guide.transcript, guide.strand]))}</table></div></details>` : ""}
  ${ssOdnNotes.length ? `<div>${ssOdnNotes.map((line) => `<p style="color:#CC0000;font-weight:700;margin:6px 0;">${line}</p>`).join("")}</div>` : ""}
  ${hasHistoricalMatches ? `<h2>${historicalNumber}. Matched Historical Records</h2>${buildHistoricalRowsHtml(historicalContext.topMatches)}` : ""}
  <h2>${readinessNumber}. Design Readiness</h2>
  ${readinessBlock}
  ${locusMapBlock && !designSchemeBlock ? `<details class="fold"><summary>Target region map</summary><div class="body">${locusMapBlock}</div></details>` : ""}
  <h2>${reviewNumber}. Review Checkpoints</h2>
  ${reviewNote}
  ${remainingReviewItems.length || !omittedReviewItems ? buildReviewListHtml(remainingReviewItems) : '<p class="sub">See the release status and readiness checks above for all review items.</p>'}
</div>
</body>
</html>`;
}
