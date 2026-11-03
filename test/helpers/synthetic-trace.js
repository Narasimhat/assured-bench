// Synthetic Sanger traces for the clone-flag tests. No laboratory data: a trace is built from the base sequences of the alleles of a clone,
// each base a Gaussian peak in its own channel, scaled by the share of the alleles that carry it at that position.
import { reverseComplement } from "../../src/engine/qc/seq.js";

const BASES = ["A", "C", "G", "T"];
const COMP = { A: "T", C: "G", G: "C", T: "A", N: "N" };

/** Small seeded generator so that a test is repeatable. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * @param {Array<{ sequence: string, share: number }>} alleles sequences read from the same primer (the first base of each is the first base read)
 * @param {{ length?: number, spacing?: number, height?: number, noise?: number, seed?: number, name?: string }} options noise = share of a second, random base added at every position
 */
export function synthTrace(alleles, { length, spacing = 12, height = 1000, noise = 0, seed = 7, name = "synthetic" } = {}) {
  const n = length || Math.max(...alleles.map((a) => a.sequence.length));
  const samples = spacing * (n + 2);
  const channels = Object.fromEntries(BASES.map((b) => [b, new Int16Array(samples)]));
  const random = rng(seed);
  const calls = []; const peakLocations = []; const quality = [];
  for (let i = 0; i < n; i += 1) {
    const share = { A: 0, C: 0, G: 0, T: 0 };
    for (const a of alleles) { const base = a.sequence[i]; if (share[base] !== undefined) share[base] += a.share; }
    if (noise > 0) { const b = BASES[Math.floor(random() * 4)]; share[b] += noise * (0.5 + random()); }
    const at = spacing * (i + 1);
    for (const b of BASES) {
      if (share[b] <= 0) continue;
      for (let d = -6; d <= 6; d += 1) channels[b][at + d] += Math.round(height * share[b] * Math.exp(-(d * d) / 8));
    }
    calls.push(BASES.reduce((best, b) => (share[b] > share[best] ? b : best), "A"));
    peakLocations.push(at); quality.push(60);
  }
  return { name, samples, channels, calls: calls.join(""), peakLocations: Int32Array.from(peakLocations), quality: Uint8Array.from(quality), hasQuality: true };
}

/** The same trace as if it had been read from the opposite primer: samples, calls, quality and channels reversed and complemented. */
export function reverseTrace(trace) {
  const channels = {};
  for (const b of BASES) channels[b] = Int16Array.from(trace.channels[COMP[b]]).reverse();
  const last = trace.samples - 1;
  return { ...trace, name: `${trace.name}.rev`, channels, calls: reverseComplement(trace.calls), peakLocations: Int32Array.from(Array.from(trace.peakLocations, (p) => last - p).reverse()), quality: Uint8Array.from(trace.quality).reverse() };
}

/** Apply substitutions [{ pos, alt }] (and nothing else) to a sequence. */
export function substitute(sequence, changes) {
  const s = sequence.split("");
  for (const c of changes) s[c.pos] = c.alt;
  return s.join("");
}
