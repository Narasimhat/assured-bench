// The order-row model: one flat row per orderable item, shared by the combined order
// preview, the CSV, and the vendor templates.
//
// This is where a design turns into something a supplier could make, so it is the last
// place that may quietly disagree with the release verdict. Every row therefore carries
// reviewStatus and the full reviewNotes, and the "Recommended" wording is derived from the
// status rather than from whether a strand happens to be the recommended one.
//
// It lived in App.jsx, which meant the audit's claim that exports carry the review state
// could not be asserted by any test - `node --test` cannot load JSX. It is pure, so it does
// not belong there. Keep it free of React.
import { collectProcurementReviewNotes, summarizeProcurementReadiness } from "./designEngine.js";
import { getOrderRecommendationLabels } from "./reportModel.js";
import { getDonorReleaseStatus } from "./releaseVerdict.js";
import { getProjectTypeMeta } from "./reportHtml.js";


export function formatBatchDesignLabel(row, result) {
  if (row?.label?.trim()) return row.label.trim();
  if (!result) return `Slot ${row?.slot || "?"}`;
  if (result.type === "pm") return `${result.gene} ${result.wA}${result.an}${result.mA}`;
  if (result.type === "ko") return `${result.gene} knockout`;
  if (result.type === "it") return `${result.gene} internal ${result.tag} after ${result.wA}${result.an}`;
  return `${result.gene} ${result.type === "ct" ? "C-terminal" : "N-terminal"} ${result.tag}`;
}

export function buildSafeToken(value, fallback) {
  const normalized = String(value || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function buildPmDonorOrderName(result, donor, donorIndex) {
  return `${buildSafeToken(result.gene, "GENE")}_${result.wA}${result.an}${result.mA}_${donor.n || `ssODN${donorIndex + 1}`}`;
}

function buildDonorFormatOrderNote(format) {
  if (!format) return "";
  const arms = format.arms.five === format.arms.three ? `${format.arms.five} bp arms` : `${format.arms.five}/${format.arms.three} bp arms`;
  const strand = format.orderStrand ? `, order the ${format.orderStrand} strand` : "";
  const aav = format.format === "aav" ? ", homology cassette to clone" : "";
  return ` (${format.short}, ${arms}${strand}${aav})`;
}

function buildInsertDonorOrderName(result) {
  const side = result.type === "ct" ? "CT" : "NT";
  return `${buildSafeToken(result.gene, "GENE")}_${buildSafeToken(result.tag, "TAG")}_${side}_donor`;
}

// An ssODN is ordered as one strand per PAM-bearing strand of its guide (see donorFormat.js); two
// guides on opposite strands give two ssODNs. Other formats are ordered as the donor was built.
function buildInsertDonorOrderRows(result, common, recommended) {
  const side = result.type === "ct" ? "C-terminal" : "N-terminal";
  const baseName = buildInsertDonorOrderName(result);
  const strands = result.donorFormat?.orderStrands || [];
  if (strands.length > 1) {
    return strands.map((entry, index) => ({
      ...common,
      itemType: "Donor",
      name: `${baseName}_ssODN${index + 1}_${entry.strand}`,
      sequence: entry.sequence,
      spacer: "",
      pam: "",
      strand: "",
      length: entry.sequence.length,
      linkedGuide: entry.guideNames.join(", "),
      recommended,
      notes: `${side} HDR donor (${result.donorFormat.short}, ${entry.strand} strand for ${entry.guideNames.join(" and ")}; same insert and blocking changes as the other ssODN, deliver both)`,
    }));
  }
  return [{
    ...common,
    itemType: "Donor",
    name: baseName,
    sequence: result.donorFormat?.orderSequence || result.donor || "",
    spacer: "",
    pam: "",
    strand: "",
    length: (result.donorFormat?.orderSequence || result.donor)?.length || 0,
    linkedGuide: "",
    recommended,
    notes: `${side} HDR donor${buildDonorFormatOrderNote(result.donorFormat)}`,
  }];
}

function buildInternalDonorOrderName(result, donor, donorIndex) {
  return `${buildSafeToken(result.gene, "GENE")}_${result.wA}${result.an}_${buildSafeToken(result.tag, "TAG")}_${donor.n || `ssODN${donorIndex + 1}`}`;
}

export function buildBatchOrderRows(entries) {
  return entries.flatMap((entry) => {
    if (entry.status !== "success" || !entry.result) return [];
    const { row, result, slot } = entry;
    const designType = getProjectTypeMeta(result.type).label;
    const designLabel = formatBatchDesignLabel({ ...row, slot }, result);
    const procurementReadiness = summarizeProcurementReadiness(result);
    // The exported "Recommended" column must not tell a reader to order a design whose
    // release state forbids it. Vendor templates already drop blocked rows, but the
    // combined order preview/CSV deliberately keeps them so the safety state travels
    // with the sequences - which means the wording has to carry the status too.
    const releaseStatus = procurementReadiness.status;
    const { item: orderRecommendation, donorStrand: donorStrandRecommendation } = getOrderRecommendationLabels(releaseStatus);
    // A donor row states its own pair's release state. With a design-wide answer, an ssODN
    // whose guide is strongly blocked exported the same wording as one whose guide is not,
    // which is the distinction a person reading the CSV most needs.
    const donorRecommendation = (donor) => getOrderRecommendationLabels(
      getDonorReleaseStatus(result, donor.guideName),
    ).donorStrand;
    const common = {
      slot,
      designLabel,
      gene: result.gene,
      designType,
      referenceFile: row.referenceSource === "raw" ? "Raw DNA + CDS coordinates" : (row.fileName || "Uploaded GenBank"),
      reviewStatus: procurementReadiness.status,
      reviewNotes: collectProcurementReviewNotes(procurementReadiness).join(" "),
    };
    const guides = (result.gs || []).map((guide) => ({
      ...common,
      itemType: "gRNA",
      name: guide.n,
      sequence: guide.sp,
      spacer: guide.sp,
      pam: guide.pm,
      strand: guide.str,
      length: guide.sp.length,
      linkedGuide: "",
      recommended: orderRecommendation,
      notes: guide.arm || guide.note || "",
    }));
    const donors = result.type === "pm"
      ? (result.os || []).map((donor, donorIndex) => ({
        ...common,
        itemType: "Donor",
        name: buildPmDonorOrderName(result, donor, donorIndex),
        sequence: donor.od,
        spacer: "",
        pam: "",
        strand: donor.sl || "",
        length: donor.od?.length || 0,
        linkedGuide: donor.guideName || "",
        recommended: donorRecommendation(donor),
        notes: donor.guideName ? `Reverse complement to ${donor.guideName}` : "Recommended donor strand",
      }))
      : result.type === "it"
        ? (result.os || []).map((donor, donorIndex) => ({
          ...common,
          itemType: "Donor",
          name: buildInternalDonorOrderName(result, donor, donorIndex),
          sequence: donor.od,
          spacer: "",
          pam: "",
          strand: donor.sl || "",
          length: donor.od?.length || 0,
          linkedGuide: donor.guideName || "",
          recommended: donorRecommendation(donor),
          notes: donor.guideName ? `Guide-linked internal ssODN, reverse complement to ${donor.guideName}` : "Guide-linked internal ssODN donor",
        }))
      : (result.type === "ct" || result.type === "nt")
        ? buildInsertDonorOrderRows(result, common, orderRecommendation)
        : [];
    const primers = (result.ps || []).map((primer) => ({
      ...common,
      itemType: "Primer",
      name: primer.n,
      sequence: primer.s,
      spacer: "",
      pam: "",
      strand: "",
      length: primer.s?.length || 0,
      linkedGuide: "",
      recommended: orderRecommendation,
      notes: "Recommended primer",
    }));
    return guides.concat(donors, primers);
  });
}
