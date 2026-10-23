// Turns a parsed trace into per-base signal compositions.
//
// At each base call the four channel heights are read at the peak location, divided by the channel's own
// typical peak height (dyes differ), and normalised to sum to 1. An edited sample that is a mixture of
// alleles has a composition equal to the mix of the alleles' bases at that position.

const BASES = ["A", "C", "G", "T"];

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function peakHeights(trace, halfWidth = 1) {
  const n = trace.calls.length;
  const out = new Float64Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const centre = trace.peakLocations[i];
    BASES.forEach((base, b) => {
      const channel = trace.channels[base];
      let best = 0;
      for (let s = Math.max(0, centre - halfWidth); s <= Math.min(channel.length - 1, centre + halfWidth); s += 1) if (channel[s] > best) best = channel[s];
      out[i * 4 + b] = best;
    });
  }
  return out;
}

// Rough Phred-like score for traces whose basecaller left quality at zero.
export function estimateQuality(heights) {
  const n = heights.length / 4;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0; let max = 0;
    for (let b = 0; b < 4; b += 1) { const v = Math.max(0, heights[i * 4 + b]); sum += v; if (v > max) max = v; }
    if (sum < 100 || sum > 20000) { out[i] = 0; continue; }
    out[i] = Math.max(0, Math.min(60, Math.round(3 * (max / sum) * 100 - 240)));
  }
  return out;
}

export function channelScales(trace, heights, quality) {
  const buckets = { A: [], C: [], G: [], T: [] };
  const n = trace.calls.length;
  for (let i = 0; i < n; i += 1) {
    const base = trace.calls[i];
    if (!buckets[base] || quality[i] < 30) continue;
    buckets[base].push(heights[i * 4 + BASES.indexOf(base)]);
  }
  const medians = BASES.map((base) => median(buckets[base]));
  const usable = medians.filter((value) => value > 0);
  const mean = usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : 1;
  return medians.map((value) => (value > 0 ? value / mean : 1));
}

/**
 * @returns {{ composition: Float64Array, total: Float64Array, valid: Uint8Array, quality: Uint8Array, scales: number[], calls: string }}
 */
export function buildComposition(trace, { scales = null, halfWidth = 1 } = {}) {
  const heights = peakHeights(trace, halfWidth);
  const quality = trace.hasQuality ? trace.quality : estimateQuality(heights);
  const useScales = scales || channelScales(trace, heights, quality);
  const n = trace.calls.length;
  const composition = new Float64Array(n * 4);
  const total = new Float64Array(n);
  const valid = new Uint8Array(n);
  const totals = [];
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let b = 0; b < 4; b += 1) { const v = Math.max(0, heights[i * 4 + b]) / useScales[b]; composition[i * 4 + b] = v; sum += v; }
    total[i] = sum;
    totals.push(sum);
  }
  const typical = median(totals.filter((value) => value > 0));
  for (let i = 0; i < n; i += 1) {
    if (total[i] >= 0.05 * typical && total[i] > 0) {
      for (let b = 0; b < 4; b += 1) composition[i * 4 + b] /= total[i];
      valid[i] = 1;
    } else for (let b = 0; b < 4; b += 1) composition[i * 4 + b] = 0.25;
  }
  return { composition, total, valid, quality, scales: useScales, calls: trace.calls };
}

const COMPLEMENT_INDEX = [3, 2, 1, 0]; // A<->T, C<->G in A,C,G,T order

/** The trace read the other way: base order reversed, calls and channels complemented. */
export function reverseModel(model) {
  const n = model.calls.length;
  const composition = new Float64Array(n * 4);
  const total = new Float64Array(n);
  const valid = new Uint8Array(n);
  const quality = new Uint8Array(n);
  const complement = { A: "T", C: "G", G: "C", T: "A", N: "N" };
  let calls = "";
  for (let i = 0; i < n; i += 1) {
    const from = n - 1 - i;
    for (let b = 0; b < 4; b += 1) composition[i * 4 + b] = model.composition[from * 4 + COMPLEMENT_INDEX[b]];
    total[i] = model.total[from]; valid[i] = model.valid[from]; quality[i] = model.quality[from];
    calls += complement[model.calls[from]] || "N";
  }
  return { ...model, composition, total, valid, quality, calls, scales: COMPLEMENT_INDEX.map((index) => model.scales[index]) };
}
