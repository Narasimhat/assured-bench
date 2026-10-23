// Re-anchoring of the read offset at the cut.
//
// The edited read is laid onto the control with ONE offset (prepare.js, bestOffset), measured on the high-quality stretch upstream of the
// cut. That is right when the two base callers made the same calls between that stretch and the cut. When one read has a call more or less
// there (a merged or split peak: seen on a real control read that carried two extra calls 20-60 bases before the cut), every position after
// the step is compared one base out, so a 30-base deletion is reported as 31 and a wild-type clone as a one-base deletion.
//
// The check is local and conservative. In the last `refineSpan` bases before the cut (ending `refineEnd` bases before it, where an edit
// cannot yet have started), the base calls of the two reads must agree under the offset in use. Only when they do not (at most
// `refinePoor` agree) and a shift within `refineMaxDelta` bases makes at least `refineGood` agree is the offset changed. The old offset
// is kept for positions before the point where the new one starts to agree, so everything upstream is compared as before.
// A pair whose offset already fits at the cut is never touched.

export const OFFSET_DEFAULTS = { refineOffset: true, refineSpan: 20, refineEnd: 2, refineMaxDelta: 3, refineGood: 0.85, refinePoor: 0.5, refineMinPositions: 15 };

/** Offset (edited call index minus control call index) to use at control call index j of a prepared pair. */
export function shiftAt(prepared, j) {
  return j < prepared.shiftPivot ? prepared.shiftUp : prepared.shift;
}

function agreement(control, edited, shift, lo, hi) {
  let match = 0; let n = 0;
  for (let j = lo; j < hi; j += 1) {
    const k = j + shift;
    if (k < 0 || k >= edited.calls.length || !control.valid[j] || !edited.valid[k]) continue;
    if (control.calls[j] === "N" || edited.calls[k] === "N") continue;
    n += 1; if (control.calls[j] === edited.calls[k]) match += 1;
  }
  return { match, n };
}

/**
 * @returns {null | { shift: number, from: number, delta: number, pivot: number, matches: number, positions: number, before: { match: number, n: number } }}
 *   null when the offset in use already fits at the cut (or there is not enough signal to judge).
 */
export function refineOffsetAtCut({ control, edited, firstCut, shift, options = {} }) {
  const o = { ...OFFSET_DEFAULTS, ...options };
  if (!o.refineOffset) return null;
  const hi = firstCut - o.refineEnd; const lo = Math.max(0, hi - o.refineSpan);
  const current = agreement(control, edited, shift, lo, hi);
  if (current.n < o.refineMinPositions || current.match / current.n > o.refinePoor) return null;
  let best = null;
  for (let delta = -o.refineMaxDelta; delta <= o.refineMaxDelta; delta += 1) {
    if (!delta) continue;
    const a = agreement(control, edited, shift + delta, lo, hi);
    if (a.n < o.refineMinPositions || a.match / a.n < o.refineGood) continue;
    if (!best || a.match > best.matches || (a.match === best.matches && Math.abs(delta) < Math.abs(best.delta))) best = { delta, matches: a.match, positions: a.n };
  }
  if (!best) return null;
  const next = shift + best.delta;
  // the new offset applies from the first base (going back from the window) at which it agrees and the old one does not
  const agrees = (s, j) => { const k = j + s; return k >= 0 && k < edited.calls.length && control.valid[j] && edited.valid[k] && control.calls[j] !== "N" && control.calls[j] === edited.calls[k]; };
  let pivot = lo;
  while (pivot > lo - 15 && pivot > 0 && agrees(next, pivot - 1) && !agrees(shift, pivot - 1)) pivot -= 1;
  return { shift: next, from: shift, delta: best.delta, pivot, matches: best.matches, positions: best.positions, before: current };
}
