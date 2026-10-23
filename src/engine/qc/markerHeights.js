// Peak heights depend on the base and its neighbourhood: the same share of an allele gives a taller or shorter peak for one base than for another
// (dye-terminator chemistry), so the composition at a marker is not the share of molecules. At a marker the new base is expected to give the
// height that the same base gives elsewhere in this read (median of its called peaks within `span` bases of the control), while the old base's
// height is observed in the control at the same position. The composition's new-base channel is divided by the ratio of the two, so that a
// 50:50 mixture reads as 50:50. The ratio is returned as the factor by which the new-base channel is multiplied (old height / expected new height).
const BASE_INDEX = { A: 0, C: 1, G: 2, T: 3 };
const median = (values) => { const v = [...values].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

/**
 * @param {object} control trace model of the control read (composition, total, calls, quality, valid)
 * @param {number} j index of the marker in the control read
 * @returns {number|null} factor for the new-base channel, or null when the neighbourhood has too few peaks of the new base
 */
export function markerGain(control, j, refBase, altBase, { span = 30, minPeaks = 3, minQuality = 30, limit = 3 } = {}) {
  const ref = BASE_INDEX[refBase]; const alt = BASE_INDEX[altBase]; if (ref === undefined || alt === undefined) return null;
  const expected = [];
  for (let m = Math.max(0, j - span); m <= Math.min(control.calls.length - 1, j + span); m += 1) {
    if (m !== j && control.calls[m] === altBase && control.quality[m] >= minQuality && control.valid[m]) expected.push(control.composition[m * 4 + alt] * control.total[m]);
  }
  const hc = control.composition[j * 4 + ref] * control.total[j];
  if (expected.length < minPeaks || !(hc > 0)) return null;
  const hn = median(expected); if (!(hn > 0)) return null;
  const factor = hc / hn;
  return Math.min(limit, Math.max(1 / limit, factor));
}

/** Share of the new base after the correction: a is the composition's new-base share (0..1), g the factor from markerGain. */
export function correctedShare(a, g) { return g === null ? a : (a * g) / ((1 - a) + a * g); }
