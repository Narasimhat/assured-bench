// Enzyme-specific computation in the application's canonical result/report contract.
// Selection, primer search, presentation and release/export gates are shared with Cas9.
import { getEnzyme } from "./enzymeConfig.js";
import { findConfiguredModelGuides, guideGeometry } from "./enzymeModelGuides.js";
import { planEnzymeModification } from "./enzymeEditPlan.js";
import { buildEnzymeDonorDesign } from "./enzymeDonors.js";
import { reverseComplementDna } from "./enzymeGuides.js";
import { EDIT_SEARCH_WINDOWS, pickGuidePair, pickPartnerGuide } from "./guideSelection.js";
import { describeGuideUse } from "./guideUse.js";
import { getCodonAtAa, extractCodingDonorWindowFromModel } from "./transcriptModel.js";
import { buildDonorFormatReport, recommendDonorFormat } from "./donorFormat.js";
import { designKO, toAA, makeGuideName, makePrimerName, buildPrimerRecord, designCenteredPrimerPairs,
  designOutsideHomologyArmPrimerPairs, serializePrimerCandidates, getOutsideHomologyPrimerStrategy,
  buildOutsideHomologyPrimerWarning, buildInternalProteinPreview, buildInternalCodingPreview,
  buildKnockinProteinPreview, getInsertPreset, INTERNAL_TAGS, assessGuideSequence, validatePointMutationPayload } from "./designEngine.js";

const tierFor = state => ["canonical_pam_removed", "target_interrupted"].includes(state) ? "strong" : state === "intact_target" ? "none" : "weak";
const rankFor = tier => ({ strong: 0, moderate: 1, weak: 2, none: 3 })[tier] ?? 3;
const windowTier = window => window === 10 ? "preferred" : window === 20 ? "fallback" : "distant fallback";
function addGuideChemistry(guide, config, options) {
  const repeat = String(options.directRepeat ?? config.direct_repeat ?? "").toUpperCase().replace(/\s/g, "").replace(/T/g, "U");
  return { ...guide, enzyme: config.id, full_crrna: options.repeatVerified && options.repeatSource && /^[ACGU]+$/.test(repeat)
    ? repeat + guide.sp.replace(/T/g, "U") : null };
}

export function selectConfiguredEditGuides(candidates, evaluate, { type = "pm", customGuides = [], ensureGuidePair = true } = {}) {
  if (customGuides.length) {
    const seen = new Set();
    const guides = customGuides.map(spacer => {
      const hits = candidates.filter(guide => guide.sp === spacer.toUpperCase().replace(/U/g, "T"));
      const hit = hits.find(guide => !seen.has(guide.id)) || hits[0];
      if (!hit) throw new Error(`Custom guide ${spacer} does not map within 30 bp with this enzyme's PAM.`);
      seen.add(hit.id); return hit;
    }).slice(0, 2);
    return { guides, window: Math.max(...guides.map(guide => Math.abs(guide.d))), tier: "custom" };
  }
  const entriesFor = window => candidates.filter(guide => Math.abs(guide.d) <= window)
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.cut - b.cut)
    .map((guide, index) => ({ guide, index, rank: evaluate(guide) }));
  for (const window of EDIT_SEARCH_WINDOWS) {
    const guides = pickGuidePair(entriesFor(window));
    if (!guides.length) continue;
    const selection = { guides, window, tier: windowTier(window) };
    // Identical to the Cas9 point-mutation partner rule: keep the near lead and search
    // wider windows only for a distinct second cut. Do not replace it with a distant lead.
    if (type === "pm" && ensureGuidePair && guides.length === 1) {
      for (const wider of EDIT_SEARCH_WINDOWS.filter(value => value > window)) {
        const partner = pickPartnerGuide(guides[0], entriesFor(wider));
        if (partner) return { ...selection, guides: [guides[0], partner],
          partnerFallback: { partnerWindow: wider, partnerCutDistance: Math.abs(partner.d) } };
      }
    }
    return selection;
  }
  return null;
}

function canonicalDonor(model, donor, guide, guideIndex, guides, result, type) {
  const start = donor.reference_interval.start, end = donor.reference_interval.end;
  const reverse = donor.strand === "antisense";
  const length = donor.sequence.length;
  const project = pos => {
    const delta = donor.edits.filter(edit => edit.end <= pos).reduce((sum, edit) => sum + edit.sequence.length - (edit.end - edit.start), 0);
    const index = pos - start + delta;
    return index < 0 || index >= length ? null : reverse ? length - 1 - index : index;
  };
  const changes = donor.edits.filter(edit => edit.kind === "synonymous_pam");
  const desired = donor.edits.filter(edit => edit.kind === "desired");
  const wt = model.genomicSequence.slice(start, end);
  const bounds = guideGeometry(guide);
  const protection = guides.map((other, index) => {
    const assessment = donor.guide_protection.find(check => check.guide_id === other.id);
    const tier = tierFor(assessment?.state);
    return { ...assessment, guideIndex: index + 1, guideName: result.gs[index].n, tier,
      protected: tier === "strong", byInsertion: assessment?.state === "target_interrupted", cfd: null };
  });
  const annotations = donor.annotations.map(annotation => ({ ...annotation, color: annotation.label.includes("homology") ? "#93C5FD" : "#FBBF24", priority: 1 }));
  const core = donor.annotations[1];
  const coding = type === "pm" ? extractCodingDonorWindowFromModel(model, start, end, donor.sequence.split("")) : {};
  return { ...donor, enzyme: result.enzyme.id, n: `${type === "pm" || type === "it" ? "ssODN" : "Donor"}${guideIndex + 1} (matched to ${result.gs[guideIndex].n})`,
    gi: guideIndex, guideName: result.gs[guideIndex].n, guideStrand: guide.str,
    orderStrand: donor.strand, od: donor.order_sequence, wo: reverse ? reverseComplementDna(wt) : wt,
    df: [...donor.order_sequence].flatMap((base, index) => base !== (reverse ? reverseComplementDna(wt) : wt)[index] ? [index] : []),
    sl: `${reverse ? "-" : "+"} strand donor (input reference)`, donorStart: start, donorEnd: end,
    genomicDonor: donor.sequence, donorSense: donor.sequence,
    guideSiteStart: bounds.start - start, guideSiteEnd: bounds.end - start,
    guidePamStart: bounds.pamStart - start, guidePamEnd: bounds.pamEnd - start,
    desiredDiffIndexes: desired.map(edit => project(edit.start)).filter(index => index !== null),
    silentDiffIndexes: changes.map(edit => project(edit.start)).filter(index => index !== null),
    silentIndexes: changes.map(edit => project(edit.start)).filter(index => index !== null),
    guideSiteIndexes: Array.from({ length: bounds.end - bounds.start }, (_, i) => project(bounds.start + i)).filter(index => index !== null),
    guidePamIndexes: Array.from({ length: bounds.pamEnd - bounds.pamStart }, (_, i) => project(bounds.pamStart + i)).filter(index => index !== null),
    ...coding, proteinValidation: type === "pm" ? validatePointMutationPayload(model, start, donor.sequence.split(""), result.an, result.mA) : donor.protein_validation,
    guideProtection: protection,
    insertionPos: result.gp, insertSequence: type === "it" ? INTERNAL_TAGS[result.tag].seq : "",
    senseInsertStart: core.start, senseInsertEnd: core.end,
    insertStart: reverse ? length - core.end : core.start, insertEnd: reverse ? length - core.start : core.end,
    donorAnnotations: reverse ? annotations.map(item => ({ ...item, start: length - item.end, end: length - item.start })) : annotations,
    armRegions: annotations.map(item => ({ ...item })),
  };
}

function completeMetadata(result, model, config, options) {
  result.enzyme = config;
  result.enzymeParameters = { spacerLength: options.spacerLength || config.spacer_len.default,
    directRepeat: options.directRepeat || config.direct_repeat, repeatVerified: !!options.repeatVerified,
    repeatSource: options.repeatSource || null, configVersion: config.version,
    cutDistanceBasis: "nearest predicted strand cut; nominal cut/KO deletion use target-strand boundaries" };
  result.gb = model; result.cds = model.cdsSequence; result.deliveryMethod = options.deliveryMethod || "unknown";
  result.gs = result.gs.map(guide => {
    const enriched = addGuideChemistry(guide, config, options);
    const details = ` Predicted target/non-target cut boundaries ${guide.cuts.target}/${guide.cuts.non_target}.${enriched.full_crrna ? ` Full crRNA (RNA, 5′→3′): ${enriched.full_crrna}.` : ""}`;
    return { ...enriched, ...(guide.arm ? { arm: guide.arm + details } : {}), note: (guide.note || "") + details };
  });
  result.guideSequenceQc = result.gs.map((guide, index) => ({ guideIndex: index + 1, guideName: guide.n,
    ...assessGuideSequence(guide.sp, result.deliveryMethod, config.id) }));
  result.enzymeWarnings = [`${config.name} uses the shared design rules, reports and primer workflow. Activity/specificity and noncanonical-PAM/mismatch tolerance require enzyme-specific validation; no SpCas9 CFD is applied.`,
    ...(config.id === "mad7" ? [config.license_note] : [])];
  result.dbg = `Parsed ${model.genomicSequence.length} bp. ${config.name} config ${config.version}; ${model.gene}, ${model.cdsSegments.length} CDS segments, ${model.proteinLength} aa.`;
  return result;
}

export function runConfiguredEnzymeDesign(type, model, mutation, tag, homologyArmLength, options = {}) {
  try {
    if (!model?.genomicSequence || !model.cdsSegments?.length) return { err: "A genomic reference with CDS annotation is required." };
    const config = getEnzyme(options.enzyme);
    if (type === "ko") {
      const result = designKO(model, options);
      if (result.err) return result;
      const cuts = result.gs.map(guide => guide.cuts);
      const possible = cuts[0] && cuts[1] ? Object.values(cuts[1]).flatMap(right => Object.values(cuts[0]).map(left => Math.abs(right - left))) : [];
      result.deletionOutcome.cutBoundaryRange = possible.length ? [Math.min(...possible), Math.max(...possible)] : null;
      result.deletionOutcome.staggeredEnds = true;
      return completeMetadata(result, model, config, options);
    }
    const row = { enzyme: config.id, projectType: type, gene: model.gene, mutation, tag,
      enzymeSpacerLength: options.spacerLength || config.spacer_len.default, guideSearchRadius: 30,
      deliveryMethod: options.deliveryMethod || "unknown", enzymeDirectRepeat: options.directRepeat,
      enzymeRepeatSource: options.repeatSource, enzymeRepeatVerified: options.repeatVerified,
      coDelivery: !!options.coDeliveryBlocking, maxBlockingChanges: options.maxBlockingChanges || 3,
      homologyArm: homologyArmLength || "", homologyArm3: options.arm3Length || "",
      autoTrimArms: options.autoTrimArms, donorFormat: options.donorFormat || "auto",
      enzymeDonorStrand: options.donorStrand || "sense", enzymePamBlocking: options.pamBlocking !== false,
      nativeDonorWindows: true };
    const run = planEnzymeModification(row, null, { model, buildDonors: false });
    const target = run.modification.target_boundary;
    const candidates = findConfiguredModelGuides(model, target, 30, { enzyme: config.id, spacerLength: row.enzymeSpacerLength })
      .map(guide => ({ ...guide, qc: { passed: true, reasons: [], policy: "shared native composition tie-break" },
        cut_distance: Math.abs(guide.d), score: { value: null, approximate: config.id === "mad7", status: "unavailable" } }));
    run.candidates = candidates;
    const evaluated = new Map();
    const evaluate = guide => {
      if (!evaluated.has(guide.id)) {
        const design = buildEnzymeDonorDesign(model, run, { ...row, selectedGuideIds: [guide.id], coDelivery: false });
        const check = design.donors[0]?.guide_protection.find(entry => entry.guide_id === guide.id);
        evaluated.set(guide.id, rankFor(tierFor(check?.state)));
      }
      return evaluated.get(guide.id);
    };
    let selection = selectConfiguredEditGuides(candidates, evaluate, { type, customGuides: options.customGuides || [], ensureGuidePair: options.ensureGuidePair !== false });
    if (!selection) return { err: `No ${config.name} guides found with cut sites within 30 bp of the requested edit.` };
    let donorDesign = buildEnzymeDonorDesign(model, run, { ...row, selectedGuideIds: selection.guides.map(guide => guide.id) });
    if (!donorDesign.donors.length && selection.guides.length > 1 && options.coDeliveryBlocking && !options.customGuides?.length) {
      const lead = selection.guides.find(guide => evaluate(guide) === 0);
      if (lead) {
        const single = buildEnzymeDonorDesign(model, run, { ...row, selectedGuideIds: [lead.id] });
        if (single.donors.length) { donorDesign = single; selection = { ...selection, guides: [lead], partnerSkipped: true }; }
      }
    }
    if (!donorDesign.donors.length) return { err: donorDesign.errors?.join(" ") || "No validated donor could be constructed." };
    const selected = selection.guides;
    run.donor_design = donorDesign;
    const result = { type, gene: model.gene, prot: model.proteinLength, tag, gp: target,
      guideWindow: selection.window, guideTier: selection.tier, partnerFallback: selection.partnerFallback,
      partnerSkipped: selection.partnerSkipped, enzyme: config, enzymeRun: run,
      coDeliveryBlockingRequested: !!options.coDeliveryBlocking,
      guideDistinctness: { minimumCutOffset: 10, customGuidesRequireReview: !!options.customGuides?.length && selected.length > 1 && Math.abs(selected[0].cut - selected[1].cut) < 10 },
      gs: selected.map((guide, index) => ({ ...guide, n: makeGuideName(model.gene, type, index, mutation, tag), pm: guide.pam,
        arm: `Nearest strand cut ${Math.abs(guide.d)} bp from edit | ${selection.tier} window ≤${selection.window} bp`,
        note: `Target/non-target cut boundaries ${guide.cuts.target}/${guide.cuts.non_target}; input-reference coordinates.` })), os: [], ss: [] };
    if (["pm", "it"].includes(type)) {
      result.an = Number(String(mutation).match(/\d+/)[0]);
      const codon = getCodonAtAa(model, result.an, toAA);
      result.wA = codon.aa;
      if (type === "pm") { result.mA = String(mutation).trim().toUpperCase().at(-1); result.wC = codon.cod; }
      else { result.nextAA = getCodonAtAa(model, result.an + 1, toAA)?.aa || "?"; }
    }
    // The same report contract carries one explicitly matched ssODN per guide, even
    // when the core edit/blocking substitutions are shared for co-delivery.
    result.os = ["pm", "it"].includes(type) ? selected.map((guide, index) => {
      const donor = donorDesign.donors.find(entry => entry.primary_guide_id === guide.id) || donorDesign.donors.find(entry => entry.matched_guide_ids.includes(guide.id));
      return canonicalDonor(model, donor, guide, index, selected, result, type);
    }) : [];
    const allDonors = donorDesign.donors;
    result.guideProtection = selected.map((guide, index) => {
      const relevant = options.coDeliveryBlocking ? allDonors : allDonors.filter(donor => donor.matched_guide_ids.includes(guide.id));
      const checks = relevant.flatMap(donor => donor.guide_protection.filter(check => check.guide_id === guide.id));
      checks.sort((a, b) => rankFor(tierFor(b.state)) - rankFor(tierFor(a.state)));
      const check = checks[0]; const tier = tierFor(check?.state);
      return { ...check, guideIndex: index + 1, tier, protected: tier === "strong", cfd: null,
        byInsertion: check?.state === "target_interrupted", reason: check?.reason || "Protection unassessed." };
    });
    result.coDeliverySafe = result.guideProtection.every(check => check.tier === "strong");
    result.guideDonorInstruction = options.coDeliveryBlocking
      ? "Co-delivery requested: review every guide against every donor. Canonical-PAM removal or target interruption is a sequence finding, not a calibrated no-cleavage guarantee."
      : "Use one explicitly matched guide/ssODN pair at a time; do not pool alternatives. Review enzyme-specific re-cutting before ordering.";
    const uniqueEdits = new Map(allDonors.flatMap(donor => donor.edits.filter(edit => edit.kind === "synonymous_pam").map(edit => [edit.start, edit])));
    result.ss = [...uniqueEdits.values()].map(edit => {
      const index = selected.findIndex(guide => edit.start >= guide.pam_start && edit.start < guide.pam_end);
      const info = getCodonAtAa(model, edit.aa_number, toAA);
      return { gp: edit.start, nb: edit.sequence, lb: `p.${info.aa}${edit.aa_number}${info.aa}`, oc: info.cod,
        nc: info.genomicPositions.map(pos => uniqueEdits.get(pos)?.sequence || model.genomicSequence[pos]).join(""),
        pur: `${config.name} synonymous canonical-PAM disruption`, mt: "silent", gi: Math.max(index, 0) + 1,
        blockingTier: "strong", blockingReason: "Canonical enzyme PAM removed; noncanonical activity remains uncalibrated." };
    });
    if (type === "pm") {
      const desired = allDonors[0].edits.filter(edit => edit.kind === "desired");
      result.ch = desired.map(edit => ({ p: edit.start, w: model.genomicSequence[edit.start], m: edit.sequence }));
      const info = getCodonAtAa(model, result.an, toAA);
      result.mC = info.genomicPositions.map(pos => desired.find(edit => edit.start === pos)?.sequence || model.genomicSequence[pos]).join("");
    } else {
      const preset = type === "it" ? INTERNAL_TAGS[tag] : getInsertPreset(tag, type);
      result.il = preset.seq.length; result.td = `${tag} (${preset.seq.length} bp)`;
      result.insertValidation = allDonors[0].insert_validation;
      if (type === "it") {
        result.proteinPreview = buildInternalProteinPreview(model, result.an, preset.aa);
        result.codingPreview = buildInternalCodingPreview(model, result.an, preset.seq, preset.aa);
      } else {
        const donor = allDonors[0];
        result.donor = donor.sequence; result.dl = donor.sequence.length; result.donorReferenceInterval = donor.reference_interval;
        result.hl = donor.arms.five; result.h5l = donor.arms.five; result.h3l = donor.arms.three;
        result.sp = target + 1; result.stop = model.genomicSequence.slice(target, target + 3);
        const last = getCodonAtAa(model, model.proteinLength, toAA); result.lastAA = `${last.aa}${model.proteinLength}`;
        result.donorAnnotations = donor.annotations.map(annotation => ({ ...annotation, color: annotation.label.includes("homology") ? "#93C5FD" : "#FBBF24", priority: 1 }));
        result.proteinPreview = buildKnockinProteinPreview(model, type, preset);
        result.guideUse = describeGuideUse({ guides: result.gs.map(guide => ({ ...guide, name: guide.n })), protection: result.guideProtection, anchorWord: type === "ct" ? "stop codon" : "start codon" });
        const format = buildDonorFormatReport({ plan: { format: donor.format, requestedFormat: row.donorFormat, arms: donor.arms,
          defaults: { feasible: true }, recommended: recommendDonorFormat(preset.seq.length) }, donor: donor.sequence, insertBp: preset.seq.length,
          firstGuideStrand: selected[0].str, guides: result.gs.map(guide => ({ str: guide.str, name: guide.n })) });
        result.donorFormat = { ...format, orderStrand: donor.format === "ssodn" ? donor.strand : null,
          orderSequence: donor.order_sequence, orderStrands: [{ strand: donor.strand, sequence: donor.order_sequence, guideNames: result.gs.map(guide => guide.n) }],
          notes: [...format.notes, donor.strand_note] };
      }
    }
    if (options.coDeliveryBlocking && selected.length > 1) {
      const cuts = selected.map(guide => guide.cut).sort((a, b) => a - b);
      result.dualCutDeletionRisk = { cutSites: cuts, spans: [cuts[1] - cuts[0]], note: `Co-delivery can delete the nominal ${cuts[1] - cuts[0]} bp between target-strand boundaries. Staggered-end processing can change the junction; screen for deletion as well as the intended edit.` };
    }
    const terminal = ["ct", "nt"].includes(type);
    const interval = allDonors[0].reference_interval;
    const primers = terminal ? designOutsideHomologyArmPrimerPairs(model.genomicSequence, interval.start, interval.end)
      : designCenteredPrimerPairs(model.genomicSequence, target);
    result.ps = primers[0] ? [buildPrimerRecord(makePrimerName(model.gene, type, "Fw", mutation, tag), primers[0].fw.seq), buildPrimerRecord(makePrimerName(model.gene, type, "Rev", mutation, tag), primers[0].rev.seq)] : [];
    result.primerCandidates = serializePrimerCandidates(primers);
    result.primerStrategy = terminal ? getOutsideHomologyPrimerStrategy(primers) : "recommended-centered";
    result.primerWarning = terminal ? buildOutsideHomologyPrimerWarning(model.genomicSequence, interval.start, interval.end, primers) : "";
    const delta = type === "pm" ? 0 : result.il - (type === "it" ? 0 : 3);
    result.amp = primers[0] ? delta ? `WT ~${primers[0].amp} bp | KI ~${primers[0].amp + delta} bp` : `~${primers[0].amp} bp` : "";
    return completeMetadata(result, model, config, options);
  } catch (error) { return { err: error.message }; }
}
