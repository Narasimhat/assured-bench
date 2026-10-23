// Intervals for the numbers a lab acts on (edited share, wild-type share, intended-edit share, KO score).
//
// The fit gives one best mixture; many other mixtures explain the trace almost as well, either because of noise (a few points
// either way) or because the trace cannot tell them apart ("wild type + edit-with-indel" and "edit + indel" are the same bases in a
// different phase). The interval is the profile of the fit: for each target share t, the best mixture that is forced to have
// that share is fitted, and the interval is the set of shares whose residual exceeds the best residual by no more than the
// tolerance. The tolerance is kappa x 3.84 x the residual variance per value, so a poor fit gives a wide interval. kappa corrects for
// residuals that are correlated across positions and channels; it was set on the development loci only (bench/, docs/scorecard.md).
import { nnlsGram } from "./nnls.js";
import { isKnockoutSize } from "./analyze.js";
import { shiftAt } from "./offset.js";

// margin: systematic error that the profile cannot see (peak-height variation at the few discriminating positions, model mismatch). Half-width in
// points = c * 100 * sqrt(p (1 - p)) for a share p, with c rising with the background-signal share of the fit. c0, c1, cmax were chosen on the
// development loci so that 95% of truths fall inside (docs/scorecard.md); the test-locus coverage is reported separately.
export const INTERVAL_DEFAULTS = { margin: { c0: 0.10, c1: 1.5, cmax: 0.32 }, kappa: 2, grid: 41, extraColumns: 40, penalty: 200 };

function subsetOf(solver, extra) {
  const { AtA, Atb, lin, w, n, kinds, noiseIndex } = solver;
  const keep = new Set();
  for (let a = 0; a < n; a += 1) if (w[a] > 1e-9 || kinds[a] === "wt" || kinds[a] === "edit" || a === noiseIndex) keep.add(a);
  const gradient = new Float64Array(n);
  for (let a = 0; a < n; a += 1) { let sum = Atb[a] - lin[a]; const row = AtA[a]; for (let k = 0; k < n; k += 1) if (w[k]) sum -= row[k] * w[k]; gradient[a] = sum; }
  const rest = Array.from({ length: n }, (_, a) => a).filter((a) => !keep.has(a)).sort((x, y) => gradient[y] - gradient[x]);
  // the donor's partial conversions and its edit-with-indel alleles are the alternative readings of a clone, so the best of each class is always kept
  rest.filter((a) => kinds[a] === "edit_partial" || kinds[a] === "edit_indel").slice(0, 16).forEach((a) => keep.add(a));
  // The gradient at the best fit cannot see an alternative that explains the trace as well as the best fit does (the best fit already uses the
  // signal it would explain). The other reading of "edit + indel" is "wild type + edit-with-indel" (the same bases in a different phase), so
  // the edit-with-indel alleles that fit best together with the wild type and the background alone are kept. Partial conversions are not
  // treated this way: combinations of them can imitate nearly any mixture at the marker positions, and the donor's partial-conversion prior
  // (the tie-break cost) is what keeps them out of the point estimate.
  const { btb, wtIndex } = solver;
  if (wtIndex != null && wtIndex >= 0) {
    const pair = (columns) => {
      const G = columns.map((i) => Float64Array.from(columns, (k) => AtA[i][k])); const x = nnlsGram(G, Float64Array.from(columns, (i) => Atb[i] - lin[i]));
      let cross = 0; let self = 0; columns.forEach((i, p) => { cross += x[p] * Atb[i]; columns.forEach((k, q) => { self += x[p] * x[q] * AtA[i][k]; }); });
      return btb - 2 * cross + self;
    };
    const head = [wtIndex, noiseIndex].filter((value) => value >= 0);
    rest.filter((a) => kinds[a] === "edit_indel" && !keep.has(a)).map((a) => [a, pair([...head, a])]).sort((x, y) => x[1] - y[1]).slice(0, 6).forEach(([a]) => keep.add(a));
  }
  rest.filter((a) => !keep.has(a)).slice(0, extra).forEach((a) => keep.add(a));
  return [...keep];
}

/**
 * @param {object} solver from decompose({ options: { returnInternals: true } }).internals.solver
 * @param {(kind, size) => boolean} counted which columns count towards the share
 * @returns {{ lo: number, hi: number, point: number }} shares of the explained alleles (0..1)
 */
export function profileShare(solver, counted, options = {}) {
  const opt = { ...INTERVAL_DEFAULTS, ...options };
  const { AtA, Atb, btb, lin, ssRes, positionsUsed, kinds, sizes, noiseIndex, alleles } = solver;
  const S = subsetOf(solver, opt.extraColumns); const m = S.length;
  const G = S.map((i) => Float64Array.from(S, (k) => AtA[i][k])); const b = Float64Array.from(S, (i) => Atb[i] - lin[i]); const raw = Float64Array.from(S, (i) => Atb[i]);
  const isAllele = S.map((i) => i !== noiseIndex); const ind = S.map((i, s) => (isAllele[s] && counted(kinds[i], sizes[i], alleles ? alleles[i] : undefined) ? 1 : 0));
  const scale = G.reduce((sum, row, i) => sum + row[i], 0) / m; const mu = opt.penalty * scale;
  const ss = (v) => { let cross = 0; let self = 0; for (let i = 0; i < m; i += 1) { if (!v[i]) continue; cross += v[i] * raw[i]; for (let k = 0; k < m; k += 1) if (v[k]) self += v[i] * v[k] * G[i][k]; } return Math.max(0, btb - 2 * cross + self); };
  const share = (v) => { let top = 0; let all = 0; for (let i = 0; i < m; i += 1) if (isAllele[i]) { all += v[i]; top += ind[i] * v[i]; } return all > 0 ? top / all : 0; };
  const best = nnlsGram(G, b); const ssBest = Math.min(ss(best), ssRes); const point = share(best);
  const sigma2 = Math.max(ssRes / Math.max(1, positionsUsed * 4), opt.noiseFloor || 0); const tolerance = opt.kappa * 3.84 * sigma2;
  let lo = point; let hi = point;
  for (let g = 0; g < opt.grid; g += 1) {
    const t = g / (opt.grid - 1); const u = Float64Array.from(ind, (v, i) => (isAllele[i] ? v - t : 0));
    const H = G.map((row, i) => Float64Array.from(row, (value, k) => value + mu * u[i] * u[k]));
    const v = nnlsGram(H, b); if (ss(v) - ssBest > tolerance) continue;
    const s = share(v); if (s < lo) lo = s; if (s > hi) hi = s;
  }
  return { lo, hi, point };
}

const pct = (value) => Math.round(value * 1000) / 10;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Intervals on the reported percentages (the same unexplained-signal bookkeeping as summarise()). */
/** Per-value noise measured where the two traces must agree: upstream of the cut, edited minus control (it includes peak-height variation, dye bias and basecalling). */
export function upstreamNoise(prepared) {
  const { control, edited, shift, alignmentWindow } = prepared; let sum = 0; let count = 0;
  for (let j = alignmentWindow.start; j < alignmentWindow.end; j += 1) {
    const k = j + shiftAt(prepared, j); if (k < 0 || k >= edited.calls.length || !control.valid[j] || !edited.valid[k]) continue;
    for (let b = 0; b < 4; b += 1) { const d = edited.composition[k * 4 + b] - control.composition[j * 4 + b]; sum += d * d; count += 1; }
  }
  return count ? sum / count : 0;
}

/** Excess flat background in the edited trace relative to the control, measured upstream of the cut where both are the same sequence: e - c = b (uniform - c). */
export function upstreamBackground(prepared, span = 50) {
  const { control, edited, shift, alignmentWindow, firstCut } = prepared; let num = 0; let den = 0;
  // only the stretch just before the first cut: the quality of a read changes along its length, so the start of the read says little about the cut region
  for (let j = Math.max(alignmentWindow.start, firstCut - span); j < Math.min(alignmentWindow.end, firstCut - 2); j += 1) {
    const k = j + shiftAt(prepared, j); if (k < 0 || k >= edited.calls.length || !control.valid[j] || !edited.valid[k]) continue;
    for (let b = 0; b < 4; b += 1) { const c = control.composition[j * 4 + b]; const g = 0.25 - c; num += (edited.composition[k * 4 + b] - c) * g; den += g * g; }
  }
  return den > 0 ? Math.min(1, Math.max(0, num / den)) : 0;
}

export function computeIntervals(decomposition, summary, options = {}) {
  const solver = decomposition.internals?.solver; if (!solver) return null;
  const explained = 1 - (summary.unexplainedPct || 0) / 100;
  const m = { ...INTERVAL_DEFAULTS.margin, ...(options.margin || {}) };
  const c = Math.min(m.cmax, Math.max(m.c0, m.c0 + m.c1 * Math.max(0, (decomposition.noiseFraction || 0) - 0.05)));
  // interval on a reported share (0..1), widened by the margin around the reported point
  const widen = (lo, hi, point) => { const q = Math.max(0.01, c * Math.sqrt(Math.max(0, point * (1 - point)))); return [clamp01(lo - q), clamp01(hi + q)]; };
  const wt = profileShare(solver, (kind) => kind === "wt", options);
  const intended = profileShare(solver, (kind) => kind === "edit", options);
  const ko = profileShare(solver, (kind, size) => (kind === "indel" || kind === "deletion_between_cuts" || kind === "edit_indel") && isKnockoutSize(size), options);
  const wtI = widen(explained * wt.lo, explained * wt.hi, summary.wtPct / 100);
  const edI = widen(1 - explained * wt.hi, 1 - explained * wt.lo, summary.editedPct / 100);
  const inI = widen(explained * intended.lo, explained * intended.hi, summary.intendedEditPct / 100);
  const koI = widen(explained * ko.lo, explained * ko.hi, summary.koScorePct / 100);
  const out = { wtPct: wtI.map(pct), editedPct: edI.map(pct), intendedEditPct: inI.map(pct), koScorePct: koI.map(pct) };
  // functional knockout score: the share of alleles predicted to lose function (coding context supplied); same profile, another predicate
  if (options.lofOf && summary.functionalKoPct !== undefined) {
    const fk = profileShare(solver, (kind, size, allele) => Boolean(allele && options.lofOf(allele)), options);
    out.functionalKoPct = widen(explained * fk.lo, explained * fk.hi, summary.functionalKoPct / 100).map(pct);
  }
  out.detected = out.editedPct[0] >= 1; out.hiddenUpToPct = out.editedPct[1];
  return out;
}
