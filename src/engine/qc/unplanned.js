// Unplanned base changes: a position where the edited trace carries a second base that the fitted mixture does not predict and the
// control does not have.
//
// The allele library only contains what the design says could happen. A clone that also carries a variant the design did not ask
// for (a second edit from the ssODN, a base-editor bystander, a heterozygous sequence variant, a mixed template) is fitted as well as
// the library allows and the leftover shows up only as a lower R2. This names the position and the base so that it can be checked in the trace.
//
// One position is flagged when, in the edited trace: a base other than the control's carries at least `minFraction` of the signal, the fit
// predicts less than `maxPredicted` of that base there, and the control is clean at that position. Planned markers are skipped. Positions
// upstream of the cut are always scanned (an edit cannot be there); positions after the cut only when every allele in the fit leaves the
// length unchanged. A run of hits means a misfit or a rearranged read, not an isolated base change, and nothing is reported then.

export const UNPLANNED_DEFAULTS = { unplanned: true, unplannedMinFraction: 0.25, unplannedMaxPredicted: 0.10, unplannedControlClean: 0.10, unplannedMaxHits: 2, unplannedMinR2: 0.8, unplannedUpstreamEnd: 2, unplannedMinAllele: 0.02 };
const BASES = ["A", "C", "G", "T"];

/**
 * @param prepared one prepared read (single-read analyses only)
 * @param internals decomposition.internals (obs, fitted, use, a0, len)
 * @param decomposition the fit (contributions, r2)
 * @returns {Array<{ readIndex: number, refIndex: number, relative: number, ref: string, alt: string, fraction: number }>}
 */
export function scanUnplanned(prepared, internals, decomposition, options = {}) {
  const o = { ...UNPLANNED_DEFAULTS, ...options };
  if (!o.unplanned || !internals || Array.isArray(prepared)) return [];
  if (decomposition.r2 === null || decomposition.r2 < o.unplannedMinR2) return [];
  const { obs, fitted, use, a0, len } = internals;
  const { control, window, firstCut } = prepared;
  const planned = new Set((prepared.spec.markers || []).map((marker) => marker.pos));
  const sameLength = decomposition.contributions.filter((c) => c.fraction >= o.unplannedMinAllele).every((c) => c.kind === "noise" || ((c.kind === "wt" || c.kind === "edit" || c.kind === "edit_partial") && !c.size));
  const last = sameLength ? len : Math.max(0, Math.min(len, firstCut - o.unplannedUpstreamEnd - window.start));
  const hits = [];
  for (let i = 0; i < last; i += 1) {
    if (!use[i]) continue;
    const j = window.start + i;
    if (planned.has(a0 + i)) continue;
    if (Number.isFinite(prepared.shiftPivot) && Math.abs(j - prepared.shiftPivot) <= 3) continue; // where the offset was re-anchored the two reads are compared across a step
    // the control must be a clean single base here
    let c1 = -1; let c1v = 0; let c2v = 0;
    for (let b = 0; b < 4; b += 1) { const v = control.composition[j * 4 + b]; if (v > c1v) { c2v = c1v; c1v = v; c1 = b; } else if (v > c2v) c2v = v; }
    if (c1 < 0 || c2v > o.unplannedControlClean * c1v) continue;
    let rowSum = 0; let fitSum = 0; for (let b = 0; b < 4; b += 1) { rowSum += obs[i * 4 + b]; fitSum += fitted[i * 4 + b]; }
    if (rowSum <= 0 || fitSum <= 0) continue;
    let alt = -1; let altV = 0;
    for (let b = 0; b < 4; b += 1) if (b !== c1 && obs[i * 4 + b] > altV) { altV = obs[i * 4 + b]; alt = b; }
    if (alt < 0) continue;
    const fraction = altV / rowSum;
    if (fraction >= o.unplannedMinFraction && fitted[i * 4 + alt] / fitSum < o.unplannedMaxPredicted) hits.push({ readIndex: j, refIndex: a0 + i, relative: j - firstCut, ref: BASES[c1], alt: BASES[alt], fraction });
  }
  return hits.length > o.unplannedMaxHits ? [] : hits;
}

export const describeUnplanned = (hits) => hits.map((h) => `${h.relative >= 0 ? "+" : ""}${h.relative}: ${h.ref}>${h.alt} (${Math.round(h.fraction * 100)}%)`).join("; ");
