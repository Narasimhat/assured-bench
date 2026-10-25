import { parseGB, toAA, INTERNAL_TAGS, getCassetteSequenceLength } from "./designEngine.js";
import { normalizeGenBankToTranscriptModel, normalizeRawSequenceToTranscriptModel,
  codingPosToGenomic, getCodonAtAa, getGenomicSequence, getCdsFromModel } from "./transcriptModel.js";
import { designEnzymeGuides } from "./enzymeGuides.js";
import { buildEnzymeDonorDesign } from "./enzymeDonors.js";

/** Modification-aware guide planning, deliberately independent of Cas9 donor/CFD logic. */
export function planEnzymeModification(row, rawReference = null, { model: suppliedModel = null, buildDonors = true } = {}) {
  if (!row.enzyme || row.enzyme === "spcas9") throw new Error("Use the standard donor workflow for SpCas9.");
  const model = suppliedModel || (row.referenceSource === "raw" ? normalizeRawSequenceToTranscriptModel(rawReference)
    : normalizeGenBankToTranscriptModel(parseGB(row.gbRaw), { expectedGene: row.gene }));
  if (!model || !getCdsFromModel(model)) throw new Error("Fetch a gene or upload a GenBank reference with CDS annotation, or provide raw DNA with CDS coordinates.");
  const blockers = (model.referenceIssues || []).filter(issue => issue.severity === "blocker");
  if (blockers.length) throw new Error(blockers.map(issue => issue.message).join(" "));
  const sequence = getGenomicSequence(model);
  const segments = model.cdsSegments;
  const type = row.projectType;
  let target = null;
  let label;
  let koIntervals = null;
  if (type === "pm" || type === "it") {
    const request = String(row.mutation || "").trim().toUpperCase().replace(/^P\./, "");
    const match = type === "pm" ? request.match(/^([ACDEFGHIKLMNPQRSTVWY])(\d+)([ACDEFGHIKLMNPQRSTVWY*])$/)
      : request.match(/^([ACDEFGHIKLMNPQRSTVWY])?(\d+)$/);
    if (!match) throw new Error(type === "pm" ? "Enter a protein change such as R176C." : "Enter an insertion site such as P155.");
    const aaNumber = Number(match[2]);
    if (!Number.isSafeInteger(aaNumber) || aaNumber < 1) throw new Error("Amino acid position must be a positive integer.");
    const codon = getCodonAtAa(model, aaNumber, toAA);
    if (!codon || codon.aa === "*" || codon.aa === "?") throw new Error("Cannot map this amino acid to a complete coding codon.");
    if (match[1] && codon.aa !== match[1]) throw new Error(`Expected ${match[1]} at position ${aaNumber}, found ${codon.aa} (${codon.cod}).`);
    if (type === "pm") {
      if (match[1] === match[3]) throw new Error("Choose a different alternate amino acid.");
      target = codon.g;
      label = `Point mutation ${request}`;
    } else {
      if (!INTERNAL_TAGS[row.tag]) throw new Error("Choose an available internal tag.");
      target = codingPosToGenomic(model, aaNumber * 3);
      if (target === null || getCodonAtAa(model, aaNumber + 1, toAA)?.aa === "*") throw new Error("Internal insertion must precede the final amino acid; use C-terminal tagging at the terminus.");
      label = `Internal ${row.tag} after ${request}`;
    }
  } else if (type === "nt" || type === "ct") {
    if (!getCassetteSequenceLength(row.tag || "", type)) throw new Error("Choose an available terminal cassette.");
    target = type === "nt" ? segments[0][0] : segments.at(-1)[1] - 3;
    const codon = sequence.slice(target, target + 3);
    if (type === "nt" && codon !== "ATG") throw new Error("Expected ATG at the CDS start.");
    if (type === "ct" && !["TAA", "TAG", "TGA"].includes(codon)) throw new Error("Expected a stop codon at the CDS end.");
    label = `${type === "nt" ? "N" : "C"}-terminal ${row.tag}`;
  } else if (type === "ko") {
    // Prefer internal coding segments 2–4, as the existing KO workflow does.
    const internal = segments.slice(1, -1);
    koIntervals = internal.length ? internal.slice(0, 3) : segments;
    label = "Knockout: coding-region guide shortlist";
  } else throw new Error("Unknown modification type.");
  const radius = Number(row.guideSearchRadius ?? 30);
  if (!Number.isInteger(radius) || radius < 1 || radius > 500) throw new Error("Guide search radius must be 1–500 bp.");
  const run = designEnzymeGuides(sequence, {
    enzyme: row.enzyme, spacerLength: Number(row.enzymeSpacerLength || 23),
    delivery: row.deliveryMethod === "u6" ? "poliii" : "rnp",
    directRepeat: row.enzymeDirectRepeat || undefined, repeatSource: row.enzymeRepeatSource,
    repeatVerified: row.enzymeRepeatVerified,
  });
  const allCount = run.candidates.length;
  run.candidates = run.candidates.filter(guide => {
    if (koIntervals) return koIntervals.some(([start, end]) => Object.values(guide.cuts).some(cut => cut >= start && cut < end));
    return Object.values(guide.cuts).some(cut => Math.abs(cut - target) <= radius);
  }).map(guide => ({ ...guide, cut_distance: target === null ? null : Math.min(...Object.values(guide.cuts).map(cut => Math.abs(cut - target))) }));
  const custom = String(row.customGuides || "").trim().split(/[\s,;]+/).filter(Boolean).map(value => value.toUpperCase().replace(/U/g, "T"));
  if (custom.length) {
    if (custom.some(spacer => !/^[ACGT]+$/.test(spacer))) throw new Error("Custom guides must be spacer sequences containing A/C/G/T or U.");
    for (const spacer of custom) if (!run.candidates.some(guide => guide.spacer === spacer)) throw new Error(`Custom guide ${spacer} does not map near the requested modification with this enzyme's PAM.`);
    run.candidates = run.candidates.filter(guide => custom.includes(guide.spacer));
  }
  run.candidates.sort((a, b) => Number(b.qc.passed) - Number(a.qc.passed) || (a.cut_distance ?? 0) - (b.cut_distance ?? 0) || a.start - b.start);
  run.modification = { type, label, mutation: row.mutation || null, tag: ["it", "ct", "nt"].includes(type) ? row.tag : null,
    target_boundary: target, ko_intervals: koIntervals, search_radius: radius,
    distance_basis: "nearest predicted strand cut to the target boundary", total_reference_candidates: allCount,
    donor_status: "pending", note: "Donors are constructed and checked against the requested protein change. Enzyme-specific re-cutting activity is not calibrated, so this is not ordering approval. Knockout mode lists coding-region guides and does not select a deletion pair." };
  run.reference = { gene: model.gene, transcript_id: model.transcriptId, source: row.referenceSource === "raw" ? "raw DNA" : row.fileName || "GenBank",
    requested_gene: row.gene || null, reference_issues: model.referenceIssues || [], orientation: "input record orientation" };
  run.parameters.delivery = row.deliveryMethod === "unknown" || !row.deliveryMethod ? "unknown" : run.parameters.delivery;
  if (run.parameters.delivery === "unknown") run.modification.note += " Delivery is undecided; Pol III terminator screening must be repeated if U6 delivery is selected.";
  run.parameters.donor = { requested_format: row.donorFormat || "auto", requested_arm5: row.homologyArm || null,
    requested_arm3: row.homologyArm3 || null, auto_trim: row.autoTrimArms !== false,
    strand: row.projectType === "pm" ? "opposite matched guide" : row.enzymeDonorStrand || "sense", synonymous_pam_blocking: row.enzymePamBlocking !== false,
    max_blocking_changes_per_guide: Number(row.maxBlockingChanges || 3), co_delivery: row.coDelivery !== false };
  if (buildDonors) {
    run.donor_design = buildEnzymeDonorDesign(model, run, row);
    run.modification.donor_status = run.donor_design.status;
    if (run.donor_design.status === "blocked") run.status = "BLOCKED";
  }
  return run;
}
