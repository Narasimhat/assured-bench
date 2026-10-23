// Top-level analysis of one control/edited pair against a design.
import { prepareSample, meanDiscordance } from "./prepare.js";
import { buildExpectedAlleles } from "./alleleLibrary.js";
import { decomposeAdaptive } from "./pursuit.js";
import { computeIntervals, upstreamNoise, upstreamBackground } from "./uncertainty.js";
import { confidenceFrom } from "./reliability.js";
import { callGenotype } from "./genotype.js";
import { shiftAt } from "./offset.js";
import { scanUnplanned, describeUnplanned } from "./unplanned.js";
import { assessFunction, assessAllele } from "./coding.js";

const KO_MIN_SIZE = 21;
export const isKnockoutSize = (size) => size % 3 !== 0 || Math.abs(size) >= KO_MIN_SIZE;

function pct(value) { return Math.round(value * 1000) / 10; }

// Signal that no allele in the library explains (the fit's background term) is not wild type: the wild type is one specific
// pattern that the fit reproduces exactly when it is there. Up to this share is ordinary trace noise and is ignored; above it,
// the excess is reported as unexplained and counted with the edited fraction instead of being renormalised away (a complex pool
// of many rare alleles ends up there, and renormalising the few explained alleles would call it wild type).
export const UNEXPLAINED_BASELINE = 0.10;

export function summarise(decomposition, baseline = UNEXPLAINED_BASELINE) {
  const unexplained = Math.min(1, Math.max(0, (decomposition.noiseFraction || 0) - baseline));
  const explained = 1 - unexplained;
  const sum = (predicate) => explained * decomposition.contributions.filter(predicate).reduce((s, c) => s + c.fraction, 0);
  const wt = sum((c) => c.kind === "wt");
  const indels = sum((c) => c.kind === "indel" || c.kind === "deletion_between_cuts" || c.kind === "edit_indel");
  const between = sum((c) => c.kind === "deletion_between_cuts");
  const edit = sum((c) => c.kind === "edit");
  const partial = sum((c) => c.kind === "edit_partial");
  const partialWithIntended = sum((c) => c.kind === "edit_partial" && c.intendedPresent);
  const koFraction = sum((c) => (c.kind === "indel" || c.kind === "deletion_between_cuts" || c.kind === "edit_indel") && isKnockoutSize(c.size));
  return {
    wtPct: pct(wt), editedPct: pct(1 - wt), indelPct: pct(indels), betweenCutsPct: pct(between),
    intendedEditPct: pct(edit), partialConversionPct: pct(partial), partialWithIntendedPct: pct(partialWithIntended),
    koScorePct: pct(koFraction), unexplainedPct: pct(unexplained),
  };
}

const BASE_ORDER = ["A", "C", "G", "T"];

/**
 * Independent readout of each design marker: the fraction of signal at that base that is the donor's base, in the
 * edited trace and in the control (background). At a SNP this is the allele fraction directly; at blocking changes it
 * shows whether they were copied even when the SNP was not.
 */
export function readMarkers(prepared) {
  const refToRead = new Map();
  prepared.readToRef.forEach((r, j) => { if (r >= 0) refToRead.set(r, j); });
  const rows = [];
  for (const marker of prepared.spec.markers || []) {
    const j = refToRead.get(marker.pos);
    if (j === undefined) { rows.push({ marker, covered: false, reason: "outside the read" }); continue; }
    // Past an insertion the edited allele's bases sit at shifted positions in the trace, so a per-position readout would
    // mix different bases; those markers are read from the allele decomposition instead.
    const shifted = (prepared.spec.donors || []).some((donor) => {
      const hasInsert = (donor.insertBp || 0) > 0 || (donor.replacedBp || 0) > 0;
      const start = Number.isInteger(donor.insertStart) ? donor.insertStart : donor.refStart + (donor.arm5 || 0);
      return hasInsert && (donor.insertBp || 0) !== (donor.replacedBp || 0) && marker.pos >= start + (donor.replacedBp || 0) && marker.pos >= donor.refStart && marker.pos < donor.refEnd;
    });
    if (shifted) { rows.push({ marker, covered: false, reason: "downstream of the insertion (read from the allele decomposition)" }); continue; }
    const k = j + shiftAt(prepared, j);
    if (k < 0 || k >= prepared.edited.calls.length || !prepared.control.valid[j] || !prepared.edited.valid[k]) { rows.push({ marker, covered: false, reason: "low-quality or missing signal" }); continue; }
    const altIndex = BASE_ORDER.indexOf(marker.alt); const refIndex = BASE_ORDER.indexOf(marker.ref);
    const edited = prepared.edited.composition; const control = prepared.control.composition;
    const background = control[j * 4 + altIndex];
    const raw = edited[k * 4 + altIndex];
    rows.push({
      marker, covered: true, readIndex: j,
      altEdited: raw, altControl: background, altNet: Math.max(0, raw - background),
      refEdited: edited[k * 4 + refIndex], quality: prepared.edited.quality[k],
    });
  }
  return rows;
}

// Pre-cut discordance seen on the ICE example traces was 0.03-0.17 (fractions agreed with ICE); synthetic traces with
// noise at 40% of the peak height reached 0.30 and then misread the mixture. Provisional, to be refined on laboratory traces.
export const NOISY_DISCORDANCE = 0.25;
export const NEAR_CUT_BASES = 40;
// The stretch of the read where the control must match the edited trace for the result to be trusted: NEAR_CUT_BASES before the first cut, or further
// upstream when a marker (a base the donor changes) is read there.
function relevantStart(prepared, markerRows) {
  const markerIdx = (markerRows || []).filter((m) => m.covered && Number.isInteger(m.readIndex)).map((m) => m.readIndex);
  const from = Math.min(prepared.firstCut - NEAR_CUT_BASES, ...(markerIdx.length ? [Math.min(...markerIdx) - 10] : []));
  return Math.max(prepared.alignmentWindow.start, from);
}


/**
 * Whether the control and edited traces differ before the cut enough to warn. A knockout or deletion is read from the cut and what lies after it, so only the stretch next
 * to the cut counts: a base-calling shift or a primer-site difference early in the read (where the cut region still matches) is not a reason to distrust it. A design that reads donor
 * markers keeps the whole alignment window, because the bases it reads can sit anywhere in it. On 160 laboratory clones (docs/discordance-warning.md) the whole-window rule did not
 * predict knockout error (AUC 0.49) and fired on 57% of knockout clones, but it did flag all three donor-base overcalls of the SNP sets.
 */
export function discordanceWarns(quality, hasMarkers) {
  const near = quality.discordanceNearCut;
  if (!hasMarkers && Number.isFinite(near)) return near > NOISY_DISCORDANCE;
  return quality.discordanceBefore > NOISY_DISCORDANCE || (Number.isFinite(near) && near > NOISY_DISCORDANCE);
}

export function unexplainedBaselineFor(decomposition, background, options = {}) {
  const goodFit = decomposition.r2 !== null && decomposition.r2 >= (options.adaptiveMinR2 ?? 0.9);
  return options.adaptiveBaseline !== false && goodFit ? Math.max(UNEXPLAINED_BASELINE, Math.min(0.4, background + 0.03)) : UNEXPLAINED_BASELINE;
}


// Functional knockout assessment (coding context supplied): each reported allele is spliced into the coding sequence and translated (src/coding.js).
function functionalFor(coding, decomposition, summary) {
  if (!coding) return null;
  const fn = assessFunction(coding, decomposition.contributions.map((c) => ({ id: c.id, kind: c.kind, label: c.label, size: c.size, fraction: c.fraction, sequence: c.sequence })));
  const explained = 1 - (summary.unexplainedPct || 0) / 100;
  summary.functionalKoPct = pct(explained * fn.score.lof); summary.functionalUncertainPct = pct(explained * fn.score.uncertain);
  return fn;
}
const lofOfFor = (coding) => (coding ? (allele) => allele.sequence !== undefined && assessAllele(coding, allele.sequence).lof === true : undefined);

export function analysePair({ control, edited, spec, options = {} }) {
  const prepared = prepareSample({ control, edited, spec, options });
  if (!prepared.ok) return { ok: false, error: prepared.error, warnings: prepared.warnings, mixedSignal: Boolean(prepared.mixedSignal) };
  const { alleles } = buildExpectedAlleles(prepared.spec, options.library || {});
  const decomposition = decomposeAdaptive({ prepared, alleles, options: { ...options, returnInternals: true } });
  // Up to this share of flat background is ordinary noise. When the fit itself is good (R2 high, so what is left is not a missing allele), the background
  // measured just upstream of the cut, where both traces carry the same sequence, is also treated as noise. In a poor fit the same signal may be a real
  // allele outside the library (as in real clones with R2 < 0.8), so there the constant baseline is kept.
  const background = upstreamBackground(prepared);
  const baseline = unexplainedBaselineFor(decomposition, background, options);
  const summary = summarise(decomposition, baseline);
  const functional = functionalFor(options.coding, decomposition, summary);
  const intervals = options.intervals === false ? null : computeIntervals(decomposition, summary, { noiseFloor: upstreamNoise(prepared), lofOf: lofOfFor(options.coding), ...(options.interval || {}) });
  // a base change the design did not ask for (needs the fit's internals, so it is read before they are dropped)
  const unplanned = scanUnplanned(prepared, decomposition.internals, decomposition, options.unplannedScan || {});
  delete decomposition.internals; // large matrices; not part of a result
  const warnings = [...prepared.warnings];
  if (unplanned.length) warnings.push(`Unplanned base change${unplanned.length > 1 ? "s" : ""} relative to the cut: ${describeUnplanned(unplanned)}. The design does not predict ${unplanned.length > 1 ? "them" : "it"}; check the trace (a second edit, a bystander edit, a sequence variant or mixed template).`);
  if (decomposition.r2 !== null && decomposition.r2 < 0.8) warnings.push(`The fit explains only ${(decomposition.r2 * 100).toFixed(0)}% of the difference from the wild type; the mixture may contain alleles outside the expected library (large deletions, rearrangements) or the traces may be noisy.`);
  if (Math.abs(decomposition.rawSum - 1) > 0.15) warnings.push(`The fitted abundances sum to ${decomposition.rawSum.toFixed(2)} rather than 1, which indicates a poor fit.`);
  if (summary.unexplainedPct >= 15) warnings.push(`${summary.unexplainedPct}% of the signal after the cut is not explained by any allele in the library (a complex mixture, large deletions or noise). It is counted as not wild type; the wild-type share is reliable, but the split among the edited alleles, the KO score and the intended-edit share cover only the explained part.`);
  const noiseUp = upstreamNoise(prepared);
  const quality = { upstreamRms: Math.sqrt(noiseUp), upstreamBackground: background, unexplainedBaseline: baseline, discordanceBefore: meanDiscordance(prepared, prepared.alignmentWindow.start, prepared.alignmentWindow.end), discordanceNearCut: meanDiscordance(prepared, relevantStart(prepared, readMarkers(prepared)), prepared.firstCut), discordanceAfter: meanDiscordance(prepared, prepared.lastCut, prepared.window.end) };
  const hasMarkers = (prepared.spec.markers || []).length > 0;
  if (discordanceWarns(quality, hasMarkers)) warnings.push(`The control and edited traces already differ before the cut (mean discordance ${quality.discordanceBefore.toFixed(2)}${quality.discordanceNearCut !== undefined ? `, ${quality.discordanceNearCut.toFixed(2)} in the stretch next to the cut` : ""}): one of them is noisy or comes from a different template. Treat the fractions as unreliable and consider re-sequencing.`);
  const markerReadout = readMarkers(prepared);
  const genotype = options.sampleType === "clone" ? callGenotype(decomposition, options.genotype || {}) : null;
  return {
    ok: true, warnings, prepared, decomposition, summary, intervals, confidence: confidenceFrom(intervals, (prepared.spec.donors || []).length > 0), markerReadout, genotype, functional,
    quality, unplanned,
  };
}

/**
 * One sample read from both ends (or several times): every read is aligned to its own control, then all reads are fitted together as one
 * mixture of the same alleles. A read that cannot be used is reported and the rest are analysed. Disagreement between the reads (one
 * reads clean, the other mixed) is a result in itself: it points to a PCR or sequencing artefact, not to biology, and is flagged.
 * @param {{ reads: Array<{ name?: string, control: object, edited: object }>, spec: object, options?: object }} input
 */
export function analyseReads({ reads, spec, options = {} }) {
  if (reads.length === 1) return analysePair({ control: reads[0].control, edited: reads[0].edited, spec, options });
  const preps = reads.map((read) => prepareSample({ control: read.control, edited: read.edited, spec, options }));
  const usable = preps.map((p, i) => ({ p, i })).filter((x) => x.p.ok);
  const warnings = [];
  preps.forEach((p, i) => { if (!p.ok) warnings.push(`Read ${reads[i].name || i + 1} was not used: ${p.error}`); else warnings.push(...p.warnings.map((w) => (reads.length > 1 ? `${reads[i].name || `Read ${i + 1}`}: ${w}` : w))); });
  if (!usable.length) return { ok: false, error: preps.map((p, i) => `${reads[i].name || `read ${i + 1}`}: ${p.error}`).join(" | "), warnings };
  const list = usable.map((x) => x.p); const first = list[0];
  const { alleles } = buildExpectedAlleles(first.spec, options.library || {});
  const decomposition = decomposeAdaptive({ prepared: list, alleles, options: { ...options, returnInternals: true } });
  const background = list.reduce((s, p) => s + upstreamBackground(p), 0) / list.length;
  const summary = summarise(decomposition, unexplainedBaselineFor(decomposition, background, options));
  const functional = functionalFor(options.coding, decomposition, summary);
  const noise = list.reduce((s, p) => s + upstreamNoise(p), 0) / list.length;
  const intervals = options.intervals === false ? null : computeIntervals(decomposition, summary, { noiseFloor: noise, lofOf: lofOfFor(options.coding), ...(options.interval || {}) });
  delete decomposition.internals;
  if (decomposition.r2 !== null && decomposition.r2 < 0.8) warnings.push(`The fit explains only ${(decomposition.r2 * 100).toFixed(0)}% of the difference from the wild type; the mixture may contain alleles outside the expected library or the traces may be noisy.`);
  if (summary.unexplainedPct >= 15) warnings.push(`${summary.unexplainedPct}% of the signal after the cut is not explained by any allele in the library. It is counted as not wild type.`);
  const perRead = (decomposition.perRead || []).map((r, k) => ({ name: reads[usable[k].i].name || `read ${usable[k].i + 1}`, orientation: list[k].orientation, editedPct: r.editedShare === null ? null : pct(r.editedShare), intendedEditPct: r.intendedShare === null ? null : pct(r.intendedShare), positions: r.positions }));
  const edited = perRead.map((r) => r.editedPct).filter((v) => v !== null);
  const agreement = edited.length > 1 ? { spread: Math.max(...edited) - Math.min(...edited), agree: Math.max(...edited) - Math.min(...edited) <= (options.maxReadSpread ?? 15) } : null;
  if (agreement && !agreement.agree) warnings.push(`The reads disagree about the edited share (${perRead.map((r) => `${r.name} ${r.editedPct}%`).join(", ")}). A PCR or sequencing artefact, a poor read or mixed template is more likely than biology: re-sequence from both ends.`);
  const quality = { discordanceBefore: Math.max(...list.map((p) => meanDiscordance(p, p.alignmentWindow.start, p.alignmentWindow.end))), upstreamRms: Math.sqrt(noise) };
  const genotype = options.sampleType === "clone" ? callGenotype(decomposition, options.genotype || {}) : null;
  return { ok: true, warnings, prepared: first, preparedReads: list, decomposition, summary, intervals, confidence: confidenceFrom(intervals, (first.spec.donors || []).length > 0), markerReadout: readMarkers(first), genotype, functional, quality, reads: perRead, agreement, readsUsed: usable.length, readsGiven: reads.length };
}
