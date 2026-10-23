// Local (Smith-Waterman) alignment of a read to a reference, both orientations, linear gaps.
// Reads are a few hundred to ~1000 bases and the reference window a few kb, so a plain DP is fast enough
// and keeps the module dependency-free.
import { reverseComplement } from "./seq.js";

const MATCH = 2;
const MISMATCH = -3;
const GAP = -4;

function score(a, b) {
  if (a === "N" || b === "N") return 0;
  return a === b ? MATCH : MISMATCH;
}

export function localAlign(read, reference) {
  const n = read.length;
  const m = reference.length;
  const H = new Int16Array((n + 1) * (m + 1));
  const T = new Uint8Array((n + 1) * (m + 1)); // 1 diag, 2 up (read base vs gap), 3 left (reference base vs gap)
  let best = 0; let bi = 0; let bj = 0;
  const w = m + 1;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diag = H[(i - 1) * w + j - 1] + score(read[i - 1], reference[j - 1]);
      const up = H[(i - 1) * w + j] + GAP;
      const left = H[i * w + j - 1] + GAP;
      let value = 0; let dir = 0;
      if (diag > value) { value = diag; dir = 1; }
      if (up > value) { value = up; dir = 2; }
      if (left > value) { value = left; dir = 3; }
      H[i * w + j] = value; T[i * w + j] = dir;
      if (value > best) { best = value; bi = i; bj = j; }
    }
  }
  const readToRef = new Int32Array(n).fill(-1);
  let i = bi; let j = bj; let matches = 0; let mismatches = 0; let gaps = 0;
  while (i > 0 && j > 0 && H[i * w + j] > 0) {
    const dir = T[i * w + j];
    if (dir === 1) {
      readToRef[i - 1] = j - 1;
      if (read[i - 1] === reference[j - 1]) matches += 1; else if (read[i - 1] !== "N") mismatches += 1;
      i -= 1; j -= 1;
    } else if (dir === 2) { gaps += 1; i -= 1; } else { gaps += 1; j -= 1; }
  }
  const aligned = matches + mismatches;
  return { score: best, readStart: i, readEnd: bi, refStart: j, refEnd: bj, readToRef, matches, mismatches, gaps, identity: aligned ? matches / aligned : 0 };
}

/** Align a read to the reference in both orientations and keep the better one. */
export function orientAndAlign(calls, reference) {
  const forward = localAlign(calls, reference);
  const reverse = localAlign(reverseComplement(calls), reference);
  const useReverse = reverse.score > forward.score;
  const alignment = useReverse ? reverse : forward;
  return { orientation: useReverse ? "-" : "+", alignment, forwardScore: forward.score, reverseScore: reverse.score, calls: useReverse ? reverseComplement(calls) : calls };
}
