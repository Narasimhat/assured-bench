// The edited trace laid onto the control, base by base, for the figures of the report: where the guides, PAMs, cuts and designed changes lie, the
// base calls of both reads, and the chromatogram curves resampled so that every control base is one unit wide. The edited read is mapped to the
// control with the offset the analysis used; only where a different mapping with gaps explains the edited calls clearly better (a clean deletion or
// insertion on both alleles) are the gaps drawn, so a mixed read is never forced into a tidy picture.
import { shiftAt } from "./offset.js";
import { annotateSpecProtein, codonPositions, codonsOf, aaOf } from "./protein.js";

export const VIEW_POINTS = 6; // curve points per base
const BASES = "ACGT";
const PAD_BEFORE = 18; const PAD_AFTER = 28; const MAX_BASES = 220; const MIN_BASES = 40;
const MATCH = 2; const MISMATCH = -2; const GAP_OPEN = -8; const GAP_EXTEND = -1; const NEG = -1000000;

const score = (a, b) => (a === "N" || b === "N" ? 0 : a === b ? MATCH : MISMATCH);

/**
 * Align the control window (all of it) to a stretch of the edited calls (free ends there), with affine gaps so that one deletion is one gap.
 * Returns, for each control base, the edited index or -1.
 */
export function alignWindow(control, edited, k0, k1) {
  const m = control.length; const lo = Math.max(0, k0); const hi = Math.min(edited.length - 1, k1); const L = hi - lo + 1;
  if (L <= 0 || m === 0) return new Array(m).fill(-1);
  const w = L + 1; const size = (m + 1) * w;
  const M = new Int32Array(size).fill(NEG); const X = new Int32Array(size).fill(NEG); const Y = new Int32Array(size).fill(NEG); // M: both bases, X: control base without an edited base, Y: the reverse
  const tM = new Uint8Array(size); const tX = new Uint8Array(size); const tY = new Uint8Array(size); // state of the cell before: 0 M, 1 X, 2 Y
  for (let j = 0; j <= L; j += 1) M[j] = 0;
  for (let i = 1; i <= m; i += 1) { X[i * w] = GAP_OPEN + (i - 1) * GAP_EXTEND; tX[i * w] = i === 1 ? 0 : 1; }
  const best3 = (a, b, c) => (a >= b && a >= c ? 0 : b >= c ? 1 : 2);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= L; j += 1) {
      const id = i * w + j; const dg = (i - 1) * w + j - 1; const up = (i - 1) * w + j; const lf = i * w + j - 1;
      const sd = best3(M[dg], X[dg], Y[dg]); M[id] = [M[dg], X[dg], Y[dg]][sd] + score(control[i - 1], edited[lo + j - 1]); tM[id] = sd;
      const su = best3(M[up] + GAP_OPEN, X[up] + GAP_EXTEND, Y[up] + GAP_OPEN); X[id] = [M[up] + GAP_OPEN, X[up] + GAP_EXTEND, Y[up] + GAP_OPEN][su]; tX[id] = su;
      const sl = best3(M[lf] + GAP_OPEN, X[lf] + GAP_OPEN, Y[lf] + GAP_EXTEND); Y[id] = [M[lf] + GAP_OPEN, X[lf] + GAP_OPEN, Y[lf] + GAP_EXTEND][sl]; tY[id] = sl;
    }
  }
  let bj = 0; let bs = 0; let top = NEG;
  for (let j = 0; j <= L; j += 1) { if (M[m * w + j] > top) { top = M[m * w + j]; bj = j; bs = 0; } if (X[m * w + j] > top) { top = X[m * w + j]; bj = j; bs = 1; } }
  const map = new Array(m).fill(-1); let i = m; let j = bj; let state = bs;
  while (i > 0) {
    const id = i * w + j;
    if (state === 0) { map[i - 1] = lo + j - 1; state = tM[id]; i -= 1; j -= 1; } else if (state === 1) { state = tX[id]; i -= 1; } else { state = tY[id]; j -= 1; }
  }
  return map;
}

const identity = (control, edited, map) => { let n = 0; let same = 0; map.forEach((k, i) => { if (k < 0 || control[i] === "N" || edited[k] === "N") return; n += 1; if (control[i] === edited[k]) same += 1; }); return n ? same / n : 0; };

function samplePos(loc, idx, u) {
  const here = loc[idx]; const n = loc.length;
  if (u >= 0) { const next = idx + 1 < n ? loc[idx + 1] : here + (here - (idx > 0 ? loc[idx - 1] : here - 10)); return here + u * (next - here); }
  const prev = idx > 0 ? loc[idx - 1] : here - ((idx + 1 < n ? loc[idx + 1] : here + 10) - here); return here + u * (here - prev);
}
const lerp = (arr, pos) => { const p = Math.min(arr.length - 1, Math.max(0, pos)); const a = Math.floor(p); const b = Math.min(arr.length - 1, a + 1); return arr[a] + (arr[b] - arr[a]) * (p - a); };

/** Curves of the bases `indices` (-1 = none), four channels, VIEW_POINTS per base, 0-100 of the tallest peak of the stretch. */
function curves(trace, indices) {
  const raw = { A: [], C: [], G: [], T: [] }; let peak = 1;
  for (const idx of indices) for (let s = 0; s < VIEW_POINTS; s += 1) {
    for (const b of BASES) { const v = idx < 0 ? 0 : Math.max(0, lerp(trace.channels[b], samplePos(trace.peakLocations, idx, (s + 0.5) / VIEW_POINTS - 0.5))); raw[b].push(v); if (v > peak) peak = v; }
  }
  const out = {}; for (const b of BASES) out[b] = raw[b].map((v) => Math.min(100, Math.round((v / peak) * 100)));
  return out;
}

/**
 * @param {{ prepared: object, control: object, edited: object }} input prepared = prepareSample result (ok), control and edited = parsed traces
 * @returns {object|null} a plain, JSON-safe object (indices are relative to `from`, the first control base of the stretch)
 */
export function buildTraceView({ prepared, control, edited }) {
  if (!prepared || !prepared.ok || !control || !edited) return null;
  const n = control.calls.length; const refToRead = new Map(); prepared.readToRef.forEach((r, j) => { if (r >= 0) refToRead.set(r, j); });
  const near = (r) => { for (let d = 0; d <= 3; d += 1) { if (refToRead.has(r + d)) return refToRead.get(r + d) - d; if (refToRead.has(r - d)) return refToRead.get(r - d) + d; } return null; };
  const guides = []; const points = [];
  for (const cut of prepared.cuts) {
    const g = cut.guide; const item = { name: g.name, strand: g.strand, cut: cut.readIndex };
    points.push(cut.readIndex);
    if (g.protospacerStart !== null && g.protospacerStart !== undefined) {
      const a = near(g.protospacerStart); const b = near(g.protospacerEnd - 1);
      if (a !== null && b !== null && b > a) {
        item.spacer = [a, b]; item.pam = g.strand === "-" ? [a - 3, a - 1] : [b + 1, b + 3]; points.push(a, b, item.pam[0], item.pam[1]);
      }
    }
    guides.push(item);
  }
  // protein consequence of the designed changes (re-derived here, because a reverse read is seen through the mirrored design)
  const spec = annotateSpecProtein(prepared.spec); const P = spec.protein || null; const L = spec.reference.sequence.length;
  const markers = []; for (const m of spec.markers || []) {
    const j = refToRead.get(m.pos); if (j === undefined) continue;
    const entry = { at: j, label: m.label || "", change: `${m.ref}>${m.alt}`, role: m.role || "" };
    if (P && m.protein) { const cp = codonPositions(L, m.pos, P.strand, P.frame); const cols = cp ? cp.cols.map((p) => refToRead.get(p)) : []; if (cols.length === 3 && cols.every((x) => x !== undefined)) entry.protein = { ...m.protein, cols }; }
    markers.push(entry); points.push(j);
  }
  let from = Math.max(0, Math.min(...points) - PAD_BEFORE); let to = Math.min(n - 1, Math.max(...points) + PAD_AFTER);
  if (to - from + 1 < MIN_BASES) { const extra = MIN_BASES - (to - from + 1); from = Math.max(0, from - Math.ceil(extra / 2)); to = Math.min(n - 1, to + Math.ceil(extra / 2)); }
  if (to - from + 1 > MAX_BASES) { const mid = Math.round((Math.min(...points) + Math.max(...points)) / 2); from = Math.max(0, mid - MAX_BASES / 2); to = Math.min(n - 1, from + MAX_BASES - 1); }
  const len = to - from + 1; const ctrlCalls = control.calls.slice(from, to + 1);
  // the codons of the stretch, translated from the control read
  const codons = [];
  if (P) {
    const refs = []; for (let j = from; j <= to; j += 1) { const r = prepared.readToRef[j]; if (r >= 0) refs.push(r); }
    if (refs.length) codonsOf(spec, Math.min(...refs), Math.max(...refs)).slice(0, 90).forEach((cd) => {
      const cols = cd.cols.map((p) => refToRead.get(p)); if (cols.some((x) => x === undefined || x < from || x > to)) return;
      const viewCols = cols.map((x) => x - from); const codon = viewCols.map((i) => (P.strand === "-" ? ({ A: "T", C: "G", G: "C", T: "A" }[ctrlCalls[i]] || "N") : ctrlCalls[i])).join("");
      codons.push({ cols: viewCols, residue: cd.residue, aa: aaOf(codon) });
    });
  }
  // the mapping the analysis used (constant offset, re-anchored at the cut when needed), then a gapped mapping that is kept only when it explains the calls clearly better
  const shifted = []; for (let i = 0; i < len; i += 1) { const k = from + i + shiftAt(prepared, from + i); shifted.push(k >= 0 && k < edited.calls.length ? k : -1); }
  let map = shifted; let mode = "offset";
  const k0 = from + shiftAt(prepared, from) - 8; const k1 = to + shiftAt(prepared, to) + 40;
  const gapped = alignWindow(ctrlCalls, edited.calls, k0, k1);
  const runs = (m) => { let r = 0; for (let i = 0; i < m.length; i += 1) { if (m[i] < 0 && (i === 0 || m[i - 1] >= 0)) r += 1; if (i > 0 && m[i] >= 0 && m[i - 1] >= 0 && m[i] - m[i - 1] > 1) r += 1; } return r; };
  const idShift = identity(ctrlCalls, edited.calls, shifted); const idGap = identity(ctrlCalls, edited.calls, gapped);
  if (runs(gapped) > 0 && runs(gapped) <= 3 && idGap >= 0.9 && idGap - idShift >= 0.15) { map = gapped; mode = "gapped"; }
  const editedCalls = map.map((k) => (k < 0 ? "-" : edited.calls[k]));
  // where a second base is at least 20% of the signal (a mixed position), from the composition of the edited read
  const comp = prepared.edited.composition; const valid = prepared.edited.valid; let second = "";
  map.forEach((k) => { let s = " "; if (k >= 0 && comp && valid && valid[k]) { const called = BASES.indexOf(edited.calls[k]); let top = 0.2; for (let b = 0; b < 4; b += 1) if (b !== called && comp[k * 4 + b] >= top) { top = comp[k * 4 + b]; s = BASES[b]; } } second += s; });
  const insertions = []; for (let i = 1; i < len; i += 1) if (map[i] >= 0 && map[i - 1] >= 0 && map[i] - map[i - 1] > 1) insertions.push({ before: i, n: map[i] - map[i - 1] - 1 });
  const ctrlIdx = []; for (let i = 0; i < len; i += 1) ctrlIdx.push(from + i);
  return {
    v: 1, from, length: len, points: VIEW_POINTS, mode, orientation: prepared.orientation,
    guides: guides.map((g) => ({ name: g.name, strand: g.strand, cut: g.cut - from, spacer: g.spacer ? g.spacer.map((x) => x - from) : null, pam: g.pam ? g.pam.map((x) => x - from) : null })),
    markers: markers.map((m) => ({ ...m, at: m.at - from, ...(m.protein ? { protein: { ...m.protein, cols: m.protein.cols.map((x) => x - from) } } : {}) })),
    ...(codons.length ? { protein: { strand: P.strand, codons } } : {}),
    control: { calls: ctrlCalls, curves: curves(control, ctrlIdx) },
    edited: { calls: editedCalls.join(""), second, curves: curves(edited, map), insertions },
  };
}
