// How good the Sanger traces are where the call is made: the share of bases with Phred quality of at least 20 (and 30) within `flank` bases of the cut, and within the stretch the
// fit uses (preCut before the first cut to postCut after the last), for the edited trace and for the control. A fixed stretch of the read is the wrong yardstick: the cut sits at
// a different place in every read (forward, reverse, other primers), and the ends of a read are poor in any case.
export const TRACE_QUALITY_DEFAULTS = { flank: 150, poorBelow: 0.9 };

const share = (values, cutoff) => (values.length ? values.filter((v) => v >= cutoff).length / values.length : null);
const stat = (values) => ({ q20: round(share(values, 20)), q30: round(share(values, 30)), n: values.length });
const round = (value) => (value === null || value === undefined ? null : Math.round(value * 1000) / 1000);
const worst = (a, b) => (a === null || a === undefined ? b : b === null || b === undefined ? a : Math.min(a, b));

/** Trace quality of one prepared pair (see prepareSample): the edited read is mapped onto the control's coordinates the way the fit does it. */
export function traceQualityOf(prepared, options = {}) {
  const opt = { ...TRACE_QUALITY_DEFAULTS, ...options };
  const edited = prepared.edited?.quality; const control = prepared.control?.quality;
  if (!edited || !control) return null;
  const toEdited = (j) => j + (j < prepared.shiftPivot ? prepared.shiftUp : prepared.shift);
  const take = (quality, from, to, map) => { const out = []; for (let j = Math.max(0, from); j <= to; j += 1) { const k = map(j); if (k >= 0 && k < quality.length) out.push(quality[k]); } return out; };
  const around = [prepared.firstCut - opt.flank, prepared.lastCut + opt.flank]; const fit = [prepared.window.start, prepared.window.end];
  const e = { cut: stat(take(edited, ...around, toEdited)), fit: stat(take(edited, ...fit, toEdited)) };
  const c = { cut: stat(take(control, ...around, (j) => j)), fit: stat(take(control, ...fit, (j) => j)) };
  const editedQ20 = worst(e.cut.q20, e.fit.q20); const controlQ20 = worst(c.cut.q20, c.fit.q20);
  const why = [];
  if (editedQ20 !== null && editedQ20 < opt.poorBelow) why.push(`only ${Math.round(editedQ20 * 100)}% of the edited trace's bases around the cut are Q20 or better`);
  if (controlQ20 !== null && controlQ20 < opt.poorBelow) why.push(`only ${Math.round(controlQ20 * 100)}% of the control trace's bases around the cut are Q20 or better`);
  return { flank: opt.flank, edited: e, control: c, q20: editedQ20, controlQ20, poor: why.length > 0, why };
}

/** Several reads of one clone: the clone is judged by its best read; each read's own numbers are kept. */
export function traceQualityOfReads(list, options = {}) {
  const reads = list.map((p) => traceQualityOf(p, options)).filter(Boolean);
  if (!reads.length) return null;
  const best = reads.reduce((a, b) => ((b.q20 ?? -1) > (a.q20 ?? -1) ? b : a));
  return reads.length === 1 ? best : { ...best, reads };
}
