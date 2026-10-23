// Why a control read that lines up with the design still fails the identity gate: mixed signal in the control itself.
// Typical cause: a homopolymer run (PCR and sequencing slippage), after which every peak is a blend of neighbouring bases,
// so the base calls disagree with the design although the read is the right locus.

const RUN_MIN = 10;

function rollingMedian(values, window) {
  const out = new Float64Array(values.length).fill(NaN);
  const half = window >> 1;
  for (let i = half; i < values.length - half; i += 1) {
    const slice = Array.from(values.slice(i - half, i + half + 1)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (slice.length) out[i] = slice[slice.length >> 1];
  }
  return out;
}

/** Longest homopolymer of at least RUN_MIN bases in reference[from, to). */
export function findHomopolymer(reference, from, to) {
  let best = null;
  let i = Math.max(0, from);
  const end = Math.min(reference.length, to);
  while (i < end) {
    let j = i;
    while (j < reference.length && reference[j] === reference[i]) j += 1;
    if (j - i >= RUN_MIN && (!best || j - i > best.length)) best = { base: reference[i], length: j - i, start: i, end: j };
    i = j;
  }
  return best;
}

/**
 * @param {{ purity: ArrayLike<number>, readToRef: ArrayLike<number>, readStart: number, readEnd: number, reference: string, identity: number, alignedBases: number }} input
 *   purity[k] = share of the called peak in the total signal for the k-th base of the (oriented) read, NaN where there is no signal.
 * @returns {string|null} an explanation, or null when the signal is not mixed.
 */
export function describeMixedSignal({ purity, readToRef, readStart, readEnd, reference, identity, alignedBases }) {
  const finite = Array.from(purity.slice(readStart, readEnd)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length < 50) return null;
  const median = finite[finite.length >> 1];
  if (median >= 0.7) return null;
  const smooth = rollingMedian(purity, 21);
  let onset = null;
  for (let k = readStart + 30; k < readEnd; k += 1) {
    if (smooth[k] < 0.7 && smooth.slice(Math.max(readStart, k - 25), k).some((v) => v >= 0.8)) { onset = k; break; }
  }
  let sentence = ` The control trace itself is mixed, so this is not a wrong-design problem.`;
  if (onset !== null) {
    const refIndex = readToRef[onset] >= 0 ? readToRef[onset] : null;
    const run = refIndex === null ? null : findHomopolymer(reference, refIndex - 90, refIndex + 5);
    sentence += ` The signal turns mixed from base ${onset + 1} of the read${run ? `, right after a ${run.length} bp ${run.base} run in the design (a typical slippage site)` : ""}.`;
  }
  sentence += ` Sequence from a primer on the far side of the run, or from the other direction, and repeat.`;
  return `The control read lines up with the design (${alignedBases} aligned bases), but its base calls agree at only ${(identity * 100).toFixed(0)}% of positions and the called peak carries a median ${median.toFixed(2)} of the signal (a clean read stays above 0.8).${sentence}`;
}
