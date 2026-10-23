// Prepares a control/edited pair for decomposition:
//   1. orient the control read against the design reference (forward or reverse primer);
//   2. map every control base to a reference index and place the cuts on the read;
//   3. find the high-quality stretch upstream of the cuts, offset the edited trace onto the control there;
//   4. patch parental differences from the design reference (control wins, with a limit and a warning);
//   5. compute the discordance profile and choose the inference window.

import { buildComposition } from "./traceModel.js";
import { orientAndAlign, localAlign } from "./align.js";
import { reverseSpec } from "./designSpec.js";
import { reverseComplement } from "./seq.js";
import { describeMixedSignal } from "./diagnose.js";
import { OFFSET_DEFAULTS, refineOffsetAtCut } from "./offset.js";

export const DEFAULTS = {
  qualityCutoff: 30, qualityWindow: 15, minAlignWindow: 40, alignGapBeforeCut: 15,
  maxShift: 12, preCut: 25, postCut: 150, maxPatches: 6, minIdentity: 0.9, minAlignedBases: 150, patchPurity: 0.85,
  ...OFFSET_DEFAULTS,
};

function runningMean(values, window) {
  const out = new Float64Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out[i] = sum / Math.min(window, i + 1);
  }
  return out;
}

/** Longest run of indices in [from, to) whose trailing-window mean quality is at least the cutoff. */
export function longestGoodRun(quality, from, to, cutoff, window) {
  const smoothed = runningMean(quality, window);
  let best = null; let start = null;
  for (let i = from; i <= to; i += 1) {
    const good = i < to && smoothed[i] >= cutoff;
    if (good && start === null) start = i;
    if (!good && start !== null) { if (!best || i - start > best.end - best.start) best = { start, end: i }; start = null; }
  }
  return best;
}

function bestOffset(control, edited, range) {
  // Align the edited calls to the control's high-quality stretch. The offset is the diagonal that most bases near the
  // downstream end of that stretch lie on (base-call insertions or gaps earlier in a noisy read do not matter), and the
  // agreement is the identity over the aligned bases, which tolerates the occasional extra or missing call.
  const piece = control.calls.slice(range.start, range.end);
  const alignment = localAlign(edited.calls, piece);
  const mode = (floor) => {
    const counts = new Map();
    alignment.readToRef.forEach((r, k) => { if (r >= 0 && r + range.start >= floor) { const shift = k - (r + range.start); counts.set(shift, (counts.get(shift) || 0) + 1); } });
    let shift = 0; let top = -1;
    for (const [candidate, count] of counts) if (count > top || (count === top && Math.abs(candidate) < Math.abs(shift))) { shift = candidate; top = count; }
    return top < 0 ? null : shift;
  };
  const shift = mode(range.end - 40) ?? mode(range.start) ?? 0;
  const aligned = alignment.matches + alignment.mismatches;
  // Normally most of the stretch aligns. A read whose first calls are poor aligns only from where it becomes readable; that
  // is accepted when the aligned part is long enough and essentially identical (chance agreement over 30+ bases is negligible).
  const complete = aligned >= 0.6 * piece.length;
  const partial = !complete && aligned >= Math.max(30, 0.4 * piece.length) && alignment.identity >= 0.95;
  return { shift, matches: complete || partial ? alignment.identity : 0, partial, aligned, pieceLength: piece.length };
}

/**
 * @returns {{ ok: boolean, error?: string, warnings: string[], ... }}
 */
export function prepareSample({ control, edited, spec, options = {} }) {
  const opt = { ...DEFAULTS, ...options };
  const warnings = [];
  if (!spec.guides?.length) return { ok: false, error: "The design has no guides, so there is no cut site to analyse around.", warnings };
  const controlModel0 = buildComposition(control);
  const editedModel0 = buildComposition(edited);
  const oriented = orientAndAlign(controlModel0.calls, spec.reference.sequence);
  const al = oriented.alignment;
  const alignedBases = al.matches + al.mismatches;
  if (alignedBases < opt.minAlignedBases || al.identity < opt.minIdentity) {
    if (alignedBases >= opt.minAlignedBases && al.identity >= 0.6) {
      const n = controlModel0.calls.length;
      const purity = new Float64Array(n);
      for (let k = 0; k < n; k += 1) {
        const original = oriented.orientation === "-" ? n - 1 - k : k;
        let top = 0;
        for (let b = 0; b < 4; b += 1) top = Math.max(top, controlModel0.composition[original * 4 + b]);
        purity[k] = controlModel0.valid[original] ? top : NaN;
      }
      const mixed = describeMixedSignal({ purity, readToRef: al.readToRef, readStart: al.readStart, readEnd: al.readEnd, reference: spec.reference.sequence, identity: al.identity, alignedBases });
      if (mixed) return { ok: false, error: mixed, warnings, alignment: al, mixedSignal: true };
    }
    return { ok: false, error: `The control read does not match the design reference (${alignedBases} aligned bases, ${(al.identity * 100).toFixed(0)}% identity). Check that the right design and amplicon were used.`, warnings, alignment: al };
  }
  // A read from the reverse primer matches the reverse complement of the reference. Rather than turning the trace around,
  // the design is turned around (reference, donors, markers, cuts), so that the read runs along increasing indices.
  const reversed = oriented.orientation === "-";
  const designSpec = reversed ? reverseSpec(spec) : spec;
  const controlModel = controlModel0;
  const editedModel = editedModel0;
  const readToRef = localAlign(controlModel.calls, designSpec.reference.sequence).readToRef;
  const refToRead = new Map();
  readToRef.forEach((ref, j) => { if (ref >= 0) refToRead.set(ref, j); });

  // cuts on the read
  const cuts = [];
  for (const guide of designSpec.guides) {
    let j = -1;
    for (let r = guide.cut; r < guide.cut + 200; r += 1) { if (refToRead.has(r)) { j = refToRead.get(r); break; } }
    if (j < 0) return { ok: false, error: `The read does not cover the cut site of ${guide.name}.`, warnings };
    cuts.push({ guide, readIndex: j, refIndex: guide.cut });
  }
  const firstCut = Math.min(...cuts.map((cut) => cut.readIndex));
  const lastCut = Math.max(...cuts.map((cut) => cut.readIndex));

  // alignment window upstream of the first cut
  const upstream = longestGoodRun(controlModel.quality, 0, Math.max(0, firstCut - opt.alignGapBeforeCut), opt.qualityCutoff, opt.qualityWindow);
  if (!upstream || upstream.end - upstream.start < opt.minAlignWindow) {
    return { ok: false, error: "The control trace has no high-quality stretch of at least 40 bases upstream of the cut, so the edited trace cannot be aligned to it.", warnings, alignment: al };
  }
  const offset = bestOffset(controlModel, editedModel, upstream);
  if (offset.matches < 0.9) return { ok: false, error: `The edited trace does not align to the control upstream of the cut (identity ${(offset.matches * 100).toFixed(0)}% over the aligned stretch, or too little of it aligns). Use the same primer and the same amplicon for both.`, warnings, alignment: al };
  // The offset was measured upstream; re-anchor it in the stretch just before the cut when the two reads' base calls have drifted apart in between (offset.js).
  const shiftUp = offset.shift; let shiftPivot = -Infinity; let offsetRefined = null;
  const refined = refineOffsetAtCut({ control: controlModel, edited: editedModel, firstCut, shift: offset.shift, options: opt });
  if (refined) {
    offsetRefined = refined; offset.shift = refined.shift; shiftPivot = refined.pivot;
    const n = Math.abs(refined.delta);
    warnings.push(`Between the stretch used to align the traces and the cut, the edited read has ${n} ${refined.delta < 0 ? "fewer" : "more"} base call${n === 1 ? "" : "s"} than the control (a missed or extra call by the base caller). The offset was re-anchored in the ${opt.refineSpan} bases before the cut (${shiftUp} to ${refined.shift}); without it every size after the cut would be off by ${n} base${n === 1 ? "" : "s"}.`);
  }
  if (offset.partial) warnings.push(`Only ${offset.aligned} of ${offset.pieceLength} bases of the control's upstream stretch align to the edited trace (the start of the edited read is poorly called); the offset was taken from those.`);
  // A start that differs by a few bases is routine (primer position, trimming) and is not a reason for concern.
  if (Math.abs(offset.shift) >= 10) warnings.push(`The edited trace starts ${Math.abs(offset.shift)} base${Math.abs(offset.shift) === 1 ? "" : "s"} ${offset.shift > 0 ? "later" : "earlier"} than the control; it was shifted to match.`);
  if (editedModel.quality.filter((value) => value >= opt.qualityCutoff).length < 0.3 * editedModel.quality.length) warnings.push("The edited trace has low quality scores over much of its length; treat the result with caution.");

  // inference window, in control read indices
  const goodEnd = (() => {
    const smoothed = runningMean(controlModel.quality, opt.qualityWindow);
    let end = controlModel.calls.length - 1;
    for (let i = lastCut; i < controlModel.calls.length; i += 1) if (smoothed[i] < 15) { end = i - 1; break; }
    return end;
  })();
  const windowStart = Math.max(upstream.start, firstCut - opt.preCut);
  const windowEnd = Math.min(goodEnd, lastCut + opt.postCut, editedModel.calls.length - 1 - Math.max(0, offset.shift));
  if (windowEnd - lastCut < 30) warnings.push(`Only ${Math.max(0, windowEnd - lastCut)} readable bases lie downstream of the last cut; large deletions and insertions cannot be resolved.`);
  if (windowEnd <= windowStart + 20) return { ok: false, error: "The readable stretch around the cut is too short to analyse.", warnings };

  // patch parental differences from the design reference (control wins)
  const patches = [];
  const reference = designSpec.reference.sequence;
  for (let j = windowStart - 10; j <= windowEnd; j += 1) {
    const r = readToRef[j];
    if (r === undefined || r < 0) continue;
    const base = controlModel.calls[j];
    if (base === "N" || base === reference[r]) continue;
    const idx = "ACGT".indexOf(base);
    const purity = controlModel.composition[j * 4 + idx];
    if (controlModel.quality[j] >= opt.qualityCutoff && controlModel.valid[j] && purity >= opt.patchPurity) patches.push({ refIndex: r, readIndex: j, reference: reference[r], control: base });
  }
  const gappedInWindow = (() => { let gaps = 0; for (let j = windowStart; j < windowEnd; j += 1) if (readToRef[j] < 0 || (j > windowStart && readToRef[j] !== readToRef[j - 1] + 1 && readToRef[j - 1] >= 0)) gaps += 1; return gaps; })();
  if (gappedInWindow > 0) warnings.push(`The control read has ${gappedInWindow} insertion or deletion position${gappedInWindow === 1 ? "" : "s"} against the design reference within the analysis window (a parental difference, or a basecaller error). Results near it are less reliable.`);
  if (patches.length > opt.maxPatches) return { ok: false, error: `The control differs from the design reference at ${patches.length} positions near the cut (limit ${opt.maxPatches}). The design may not match this cell line or amplicon.`, warnings, patches };
  let patchedSpec = designSpec;
  if (patches.length) {
    const sequence = reference.split("");
    patches.forEach((patch) => { sequence[patch.refIndex] = patch.control; });
    patchedSpec = { ...designSpec, reference: { ...designSpec.reference, sequence: sequence.join("") } };
    warnings.push(`The control differs from the design reference at ${patches.length} position${patches.length === 1 ? "" : "s"} near the cut (${patches.map((patch) => `${patch.reference}>${patch.control} at ${patch.refIndex}`).join(", ")}); the control sequence was used as the wild type.`);
  }

  // discordance profile over the control read
  const n = controlModel.calls.length;
  const discordance = new Float64Array(n).fill(NaN);
  for (let j = 0; j < n; j += 1) {
    const k = j + (j < shiftPivot ? shiftUp : offset.shift);
    if (k < 0 || k >= editedModel.calls.length || !controlModel.valid[j] || !editedModel.valid[k]) continue;
    let sum = 0;
    for (let b = 0; b < 4; b += 1) sum += Math.abs(editedModel.composition[k * 4 + b] - controlModel.composition[j * 4 + b]);
    discordance[j] = sum / 2;
  }
  return {
    ok: true, warnings, orientation: oriented.orientation, spec: patchedSpec, originalSpec: designSpec,
    control: controlModel, edited: editedModel, shift: offset.shift, shiftUp, shiftPivot, offsetRefined, readToRef, cuts, firstCut, lastCut,
    alignmentWindow: upstream, window: { start: windowStart, end: windowEnd }, patches, discordance, alignment: { identity: al.identity, alignedBases },
    reference: patchedSpec.reference.sequence,
  };
}

export function meanDiscordance(prepared, from, to) {
  let sum = 0; let count = 0;
  for (let j = from; j < to; j += 1) if (!Number.isNaN(prepared.discordance[j])) { sum += prepared.discordance[j]; count += 1; }
  return count ? sum / count : NaN;
}

export { reverseComplement };
