import { toAA, getInsertPreset, INTERNAL_TAGS, buildInsertValidation } from "./designEngine.js";
import { codingPosToGenomic, getCodonAtAa, genomicPosToAa } from "./transcriptModel.js";
import { planDonorArms, DONOR_FORMATS, scanSynthesisRisks } from "./donorFormat.js";
import { inSpliceWindow } from "./spliceZones.js";
import { findEnzymeGuides, reverseComplementDna } from "./enzymeGuides.js";
import { pamRegex } from "./enzymeConfig.js";

const translate = dna => {
  if (!dna.length || dna.length % 3 || !/^[ACGT]+$/.test(dna)) throw new Error("Cannot translate an incomplete or ambiguous coding sequence.");
  return dna.match(/.../g).map(toAA).join("");
};
const codons = Array.from({ length: 64 }, (_, index) => "ACGT"[index >> 4] + "ACGT"[(index >> 2) & 3] + "ACGT"[index & 3]);

export function applyAlleleEdits(reference, edits) {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0, output = "";
  for (const edit of ordered) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < cursor || edit.end < edit.start || edit.end > reference.length
      || !/^[ACGT]*$/.test(edit.sequence)) throw new Error("Invalid or overlapping allele edits.");
    output += reference.slice(cursor, edit.start) + edit.sequence;
    cursor = edit.end;
  }
  return output + reference.slice(cursor);
}

function codingProjection(model, edits) {
  const positions = model.cdsSegments.flatMap(([start, end]) => Array.from({ length: end - start }, (_, i) => start + i));
  const lookup = new Map(positions.map((pos, index) => [pos, index]));
  const projected = edits.map(edit => {
    const start = lookup.get(edit.start);
    const covered = positions.filter(pos => pos >= edit.start && pos < edit.end);
    if (start === undefined || covered.length !== edit.end - edit.start) throw new Error("An edit cannot be mapped continuously into the coding sequence.");
    return { ...edit, start, end: start + covered.length };
  });
  const codingSequence = model.cdsSegments.map(([start, end]) => model.genomicSequence.slice(start, end)).join("");
  return applyAlleleEdits(codingSequence, projected);
}

/** Assemble the intended edit using the same curated insert presets as Cas9. */
function requestedEdit(model, run) {
  const { type, mutation, tag, target_boundary: target } = run.modification;
  const wtProtein = translate(model.cdsSequence);
  if (type === "pm") {
    const match = mutation.trim().toUpperCase().replace(/^P\./, "").match(/^([A-Z])(\d+)([A-Z*])$/);
    const number = Number(match[2]), wanted = match[3];
    const info = getCodonAtAa(model, number, toAA);
    const choices = codons.filter(codon => toAA(codon) === wanted).map(codon => ({ codon,
      changes: [...codon].flatMap((base, index) => base === info.cod[index] ? [] : [{ start: info.genomicPositions[index], end: info.genomicPositions[index] + 1, sequence: base, kind: "desired" }]) }));
    choices.sort((a, b) => a.changes.length - b.changes.length || a.codon.localeCompare(b.codon));
    if (!choices.length) throw new Error("No codon encodes the requested amino acid.");
    const edits = choices[0].changes;
    return { edits, coreStart: Math.min(...edits.map(edit => edit.start)), coreEnd: Math.max(...edits.map(edit => edit.end)),
      expectedProtein: wtProtein.slice(0, number - 1) + wanted + wtProtein.slice(number), targetAa: number,
      insertValidation: null, note: "The alternate codon minimizes nucleotide substitutions; ties use lexical order. No species-specific codon-usage preference is assumed." };
  }
  const preset = type === "it" ? INTERNAL_TAGS[tag] : getInsertPreset(tag, type);
  if (!preset?.seq) throw new Error("Insert sequence is unavailable.");
  const insertValidation = buildInsertValidation(preset.seq, preset.seq, { allowTerminalStop: type === "ct", segments: preset.segments });
  if (!insertValidation.matchesPreset || !insertValidation.framePreserved || insertValidation.canonicalChecks.some(check => !check.matches)) throw new Error("Insert failed its frame, stop-codon or curated protein checks.");
  const insertProtein = translate(preset.seq);
  let expectedProtein;
  if (type === "it") {
    const number = Number(mutation.match(/\d+/)[0]);
    const prior = codingPosToGenomic(model, number * 3 - 1);
    if (prior + 1 !== target || inSpliceWindow(model, target) || inSpliceWindow(model, prior)) throw new Error("The internal insertion lies at or near an annotated exon boundary; a splice-aware donor is required.");
    if (insertProtein !== preset.aa) throw new Error("Internal tag does not match its documented amino-acid sequence.");
    expectedProtein = wtProtein.slice(0, number) + insertProtein + wtProtein.slice(number);
  } else expectedProtein = type === "ct" ? wtProtein.slice(0, -1) + insertProtein : insertProtein + wtProtein.slice(1);
  return { edits: [{ start: target, end: target + (type === "it" ? 0 : 3), sequence: preset.seq, kind: "insert" }],
    coreStart: target, coreEnd: target + (type === "it" ? 0 : 3), expectedProtein, insertValidation, insertSequence: preset.seq,
    note: type === "it" ? "Tag inserted in frame after the requested residue." : "Terminal cassette replaces the native start/stop codon using the curated cassette convention." };
}

function mappedBoundary(pos, edits) {
  return pos + edits.filter(edit => edit.end <= pos).reduce((sum, edit) => sum + edit.sequence.length - (edit.end - edit.start), 0);
}

function editedPam(model, guide, edits) {
  const allele = applyAlleleEdits(model.genomicSequence, edits);
  const raw = allele.slice(mappedBoundary(guide.pam_start, edits), mappedBoundary(guide.pam_end, edits));
  return guide.strand === "+" ? raw : reverseComplementDna(raw);
}

/** This is a canonical-PAM and sequence check, never a cleavage probability.
 * Look for intact sites near the repaired locus and in the assembled donor. */
export function assessEnzymeReCutting(model, guide, config, edits, donorSequence = "") {
  const allele = applyAlleleEdits(model.genomicSequence, edits);
  const center = mappedBoundary(guide.start, edits);
  const reach = Math.max(guide.end - guide.start, 50);
  const maxInsert = edits.reduce((sum, edit) => sum + Math.max(0, edit.sequence.length - (edit.end - edit.start)), 0);
  const start = Math.max(0, center - reach), end = Math.min(allele.length, center + reach + maxInsert);
  const intact = findEnzymeGuides(allele.slice(start, end), { enzyme: config.id, spacerLength: guide.spacer.length }).some(hit => hit.spacer === guide.spacer);
  const donorIntact = donorSequence.length ? findEnzymeGuides(donorSequence, { enzyme: config.id, spacerLength: guide.spacer.length }).some(hit => hit.spacer === guide.spacer) : false;
  if (intact || donorIntact) return { guide_id: guide.id, state: "intact_target", cfd: null, residual_activity: null,
    repaired_locus_intact: intact, donor_intact: donorIntact, reason: "An exact spacer with a canonical enzyme PAM remains at the repaired locus or within the donor. Re-cutting risk is unresolved." };
  const structural = edits.some(edit => edit.sequence.length !== edit.end - edit.start && edit.start < guide.end && edit.end > guide.start
    || edit.start === edit.end && edit.start > guide.start && edit.start < guide.end);
  if (structural) return { guide_id: guide.id, state: "target_interrupted", cfd: null, residual_activity: null,
    reason: "The edit interrupts the original target and no intact canonical-PAM target was found in the local repaired sequence or donor. Mismatched/noncanonical targets are not scored." };
  const pamStart = mappedBoundary(guide.pam_start, edits), pamEnd = mappedBoundary(guide.pam_end, edits);
  const rawPam = allele.slice(pamStart, pamEnd);
  const pam = guide.strand === "+" ? rawPam : reverseComplementDna(rawPam);
  const removed = !pamRegex(config.pam_pattern).test(pam);
  return { guide_id: guide.id, state: removed ? "canonical_pam_removed" : "mismatched_target_unscored", pam_after: pam,
    cfd: null, residual_activity: null, reason: removed
      ? "The original PAM no longer matches this enzyme's configured canonical motif. Noncanonical-PAM cleavage is not modeled."
      : "The spacer was changed but a canonical PAM remains. Cas12a/Mad7 mismatch tolerance is not calibrated; protection needs review." };
}

export function findSynonymousPamEdits(model, guide, config, edits, interval, maxChanges, excludedAa, allowed = () => true) {
  const pamMatches = pamRegex(config.pam_pattern);
  if (!pamMatches.test(editedPam(model, guide, edits))) return [];
  const touchedAa = [...new Set(Array.from({ length: guide.pam_end - guide.pam_start }, (_, i) => genomicPosToAa(model, guide.pam_start + i)).filter(Boolean))];
  const options = [];
  for (const aa of touchedAa) {
    if (aa === excludedAa) continue;
    const info = getCodonAtAa(model, aa, toAA);
    if (!info || info.aa === "*" || info.aa === "?") continue;
    // Do not combine independent changes in the same codon or rewrite inserted/replaced bases.
    if (edits.some(edit => info.genomicPositions.some(pos => pos >= edit.start && pos < edit.end))) continue;
    for (const codon of codons.filter(value => value !== info.cod && toAA(value) === info.aa)) {
      const changes = [...codon].flatMap((base, i) => base === info.cod[i] ? [] : [{ start: info.genomicPositions[i], end: info.genomicPositions[i] + 1, sequence: base, kind: "synonymous_pam", aa_number: aa }]);
      if (changes.length > maxChanges || changes.some(edit => edit.start < interval.start || edit.end > interval.end || inSpliceWindow(model, edit.start) || !allowed(edit.start))) continue;
      const candidate = [...edits, ...changes];
      if (translate(codingProjection(model, candidate)) !== translate(codingProjection(model, edits))) continue;
      if (!pamMatches.test(editedPam(model, guide, candidate))) options.push(changes);
    }
  }
  options.sort((a, b) => a.length - b.length || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // Never add mismatches under an uncalibrated seed-weight model.
  return options[0] || [];
}

export function buildEnzymeDonorDesign(model, run, row = {}) {
  if (run.modification.type === "ko") return { status: "not_required", donors: [], selected_guide_ids: [],
    note: "Frameshift knockout uses end joining; no HDR donor is required. A defined HDR deletion or replacement is a separate design." };
  const selected = [];
  const supplied = row.selectedGuideIds?.length ? row.selectedGuideIds.map(id => run.candidates.find(guide => guide.id === id)).filter(Boolean) : null;
  for (const guide of supplied || run.candidates.filter(candidate => candidate.qc.passed)) {
    if (supplied || !selected.length || selected.every(other => Math.abs(other.cuts.target - guide.cuts.target) >= 10)) selected.push(guide);
    if (selected.length === 2) break;
  }
  if (!selected.length) return { status: "blocked", donors: [], selected_guide_ids: [], errors: ["No guide passes the configured filters near this edit. Adjust the reference, search radius or enzyme before constructing a matched donor."] };
  try {
    const request = requestedEdit(model, run);
    if (translate(codingProjection(model, request.edits)) !== request.expectedProtein) throw new Error("The requested edit does not produce the asserted protein.");
    const coreLength = request.coreEnd - request.coreStart + request.edits.reduce((sum, edit) => sum + edit.sequence.length - (edit.end - edit.start), 0);
    const desiredFormat = row.donorFormat || "auto";
    if (!["auto", ...Object.keys(DONOR_FORMATS)].includes(desiredFormat)) throw new Error("Unknown donor format.");
    for (const value of [row.homologyArm, row.homologyArm3]) if (value !== undefined && value !== "" && (!Number.isInteger(Number(value)) || Number(value) <= 0)) throw new Error("Homology arm lengths must be positive whole numbers.");
    const plan = planDonorArms({ insertBp: coreLength, genome: model.genomicSequence, leftEdge: request.coreStart,
      rightEdge: request.coreEnd, requestedArm: row.homologyArm, options: { donorFormat: desiredFormat,
        arm3Length: row.homologyArm3, autoTrimArms: row.autoTrimArms !== false } });
    const spec = DONOR_FORMATS[plan.format];
    if (plan.arms.five < spec.minArm || plan.arms.three < spec.minArm) throw new Error(`Insufficient reference or homology: ${plan.arms.five}/${plan.arms.three} bp arms; ${spec.minArm} bp minimum per arm for ${spec.short}. Fetch more flanking sequence or change the donor format/arms.`);
    const interval = { start: request.coreStart - plan.arms.five, end: request.coreEnd + plan.arms.three };
    const coDelivery = row.coDelivery !== false;
    const asymmetric = row.nativeDonorWindows && ["pm", "it"].includes(run.modification.type) && (!row.donorFormat || row.donorFormat === "auto" || row.donorFormat === "ssodn") && !row.homologyArm && !row.homologyArm3;
    const windows = asymmetric ? selected.map(guide => {
      let start = guide.cuts.target - (guide.strand === "+" ? 36 : 91);
      let end = start + 127;
      if (start < 0) { end -= start; start = 0; }
      if (end > model.genomicSequence.length) { start -= end - model.genomicSequence.length; end = model.genomicSequence.length; }
      if (start < 0 || end - start !== 127) throw new Error("Supply enough flanking reference for a complete 127-base donor window.");
      return { start, end };
    }) : selected.map(() => interval);
    const commonWindow = coDelivery ? { start: Math.max(...windows.map(window => window.start)), end: Math.min(...windows.map(window => window.end)) } : null;
    const groups = asymmetric ? selected.map(guide => coDelivery ? selected : [guide]) : coDelivery ? [selected] : selected.map(guide => [guide]);
    const donors = groups.map((guides, index) => {
      const donorWindow = asymmetric ? windows[index] : interval;
      const blockingWindow = commonWindow || donorWindow;
      if (guides.some(guide => Object.values(guide.cuts).some(cut => cut < donorWindow.start || cut > donorWindow.end))) throw new Error("A predicted strand cut lies outside the donor-covered interval. Lengthen homology arms or choose a closer guide.");
      let edits = [...request.edits];
      const maxChanges = Number(row.maxBlockingChanges || 3);
      if (!Number.isInteger(maxChanges) || maxChanges < 1 || maxChanges > 3) throw new Error("Choose 1–3 synonymous PAM-blocking substitutions per guide.");
      if (row.enzymePamBlocking !== false) for (const guide of guides) {
        const state = assessEnzymeReCutting(model, guide, run.enzyme, edits).state;
        if (["intact_target", "mismatched_target_unscored"].includes(state)) edits = [...edits,
          ...findSynonymousPamEdits(model, guide, run.enzyme, edits, blockingWindow, maxChanges, request.targetAa)];
      }
      if (edits.some(edit => edit.start < donorWindow.start || edit.end > donorWindow.end)) throw new Error("The donor does not cover every requested and blocking change.");
      const local = edits.map(edit => ({ ...edit, start: edit.start - donorWindow.start, end: edit.end - donorWindow.start }));
      const sense = applyAlleleEdits(model.genomicSequence.slice(donorWindow.start, donorWindow.end), local);
      const repaired = applyAlleleEdits(model.genomicSequence, edits);
      const reconstructed = model.genomicSequence.slice(0, donorWindow.start) + sense + model.genomicSequence.slice(donorWindow.end);
      if (reconstructed !== repaired) throw new Error("Donor-to-repaired-allele reconstruction failed.");
      const actualProtein = translate(codingProjection(model, edits));
      if (actualProtein !== request.expectedProtein) throw new Error("Final donor changes the protein beyond the requested modification.");
      const proteinValidation = { valid: true, expected: request.expectedProtein, observed: actualProtein,
        frame_preserved: true, scope: "full spliced coding sequence after all desired and blocking edits" };
      if (spec.maxLength && sense.length > spec.maxLength || spec.minLength && sense.length < spec.minLength) throw new Error(`The ${sense.length}-base donor is outside the ${spec.short} synthesis length limits. Change format or homology arms.`);
      const strand = plan.format === "ssodn" ? row.enzymeDonorStrand || "sense" : "sense";
      if (!["sense", "antisense"].includes(strand)) throw new Error("Unknown donor strand.");
      const protection = selected.map(guide => assessEnzymeReCutting(model, guide, run.enzyme, edits, sense));
      const matchedProtection = protection.filter(check => guides.some(guide => guide.id === check.guide_id));
      const intact = matchedProtection.some(check => check.state === "intact_target");
      const synthesis = scanSynthesisRisks(sense);
      const warnings = ["No calibrated Cas12a/Mad7 residual-activity or genome-wide specificity model has been applied. Review the complete design before ordering.",
        "Homology-arm and synthesis defaults are general HDR heuristics, not enzyme- or cell-type-specific validation."];
      if (edits.some(edit => inSpliceWindow(model, edit.start))) warnings.push("A desired edit overlaps an annotated splice window; splice effects require independent review.");
      if (guides.some(guide => Object.values(guide.cuts).some(cut => cut < interval.start || cut > interval.end))) warnings.push("A predicted strand cut is outside the donor-covered reference interval; review repair geometry.");
      if (synthesis.length) warnings.push("The donor contains synthesis-complexity flags; review the vendor's synthesis screen.");
      if (plan.arms.limited.five || plan.arms.limited.three) warnings.push("Homology arms were limited by the supplied reference.");
      const coreStart = request.coreStart - donorWindow.start;
      return { id: `${run.enzyme.id}-donor-${index + 1}`, enzyme: run.enzyme.id, config_version: run.enzyme.version,
        status: intact ? "BLOCKED" : "REVIEW REQUIRED", matched_guide_ids: guides.map(guide => guide.id),
        delivery: coDelivery ? "co-delivery of matched guides" : "one matched guide/donor pair at a time; do not pool alternatives",
        format: plan.format, format_label: spec.label, reference_interval: donorWindow, coordinate_system: run.coordinate_system,
        primary_guide_id: asymmetric ? selected[index].id : guides[0].id,
        sequence: sense, reverse_complement: reverseComplementDna(sense), strand, order_sequence: strand === "antisense" ? reverseComplementDna(sense) : sense,
        strand_note: plan.format === "ssodn" ? "Strand is a user choice relative to the input record, not a Cas9-derived recommendation. Optimize experimentally for this nuclease." : "Double-stranded homology cassette shown in input orientation; vector backbone is not included.",
        arms: { ...plan.arms, five: coreStart, three: donorWindow.end - request.coreEnd }, annotations: [{ label: "5prime homology", start: 0, end: coreStart },
          { label: run.modification.label, start: coreStart, end: coreStart + coreLength },
          { label: "3prime homology", start: coreStart + coreLength, end: sense.length }],
        edits, protein_validation: proteinValidation, insert_validation: request.insertValidation,
        guide_protection: protection, synthesis_flags: synthesis, warnings, construction_note: request.note,
        repaired_reference_sequence: repaired };
    });
    return { status: donors.some(donor => donor.status === "BLOCKED") ? "blocked" : "review_required", donors,
      selected_guide_ids: selected.map(guide => guide.id), co_delivery: coDelivery,
      parameters: { format: plan.format, arm5_requested: plan.arms.requestedFive, arm3_requested: plan.arms.requestedThree,
        auto_trim: row.autoTrimArms !== false, synonymous_pam_blocking: row.enzymePamBlocking !== false,
        max_blocking_changes_per_guide: Number(row.maxBlockingChanges || 3) },
      note: "Donors are sequence- and protein-checked; re-cutting, specificity, splice effects, delivery and empirical HDR efficiency require review. Primer design is available separately in Primer Tool." };
  } catch (error) { return { status: "blocked", donors: [], selected_guide_ids: selected.map(guide => guide.id), errors: [error.message] }; }
}
