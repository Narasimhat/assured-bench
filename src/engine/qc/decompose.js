// Decomposes the edited trace, over the inference window, into a non-negative mixture of expected alleles.
//
// Model: at each base position the edited sample's channel composition equals the sum, over alleles, of
// (abundance x one-hot of that allele's base at the position). Alleles whose predicted bases are identical
// across the window cannot be told apart by this trace; they are merged into one column and reported together.

import { nnlsGram } from "./nnls.js";
import { shiftAt } from "./offset.js";

// A trace gives the base mixture at each position, not which bases sit together on one allele, so very
// different sets of partial alleles can explain the same marker fractions equally well (50% wild type + 50%
// complete edit looks identical to 50% "first half of the markers" + 50% "second half"). Candidate alleles
// therefore carry a small linear cost that only decides between equally good fits: complete edits and wild
// type are free, partial runs cost more, and a partial set with one marker missing costs most. The cost is a
// tie-breaker, not a threshold: a partial allele that the data need (silent changes copied, SNP not) is
// still reported because leaving it out costs far more than the penalty.
export const DEFAULT_PENALTIES = { noise: 0, wt: 0, edit: 0, edit_partial: 0.02, edit_partial_skip: 0.04, edit_indel: 0.02, indel: 0.002, deletion_between_cuts: 0.002 };

const PRIORITY = { wt: 5, edit: 4, edit_partial: 3, edit_indel: 2.5, deletion_between_cuts: 2, indel: 1, noise: 0 };
const BASE_INDEX = { A: 0, C: 1, G: 2, T: 3 };

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", N: "N" };
const reversedCache = new WeakMap();
// An allele is defined in the orientation of the first read; a read from the other primer sees its reverse complement.
function sequenceFor(allele, reversed) {
  if (!reversed) return allele.sequence;
  let sequence = reversedCache.get(allele);
  if (sequence === undefined) { sequence = ""; for (let i = allele.sequence.length - 1; i >= 0; i -= 1) sequence += COMPLEMENT[allele.sequence[i]] ?? "N"; reversedCache.set(allele, sequence); }
  return sequence;
}

function readPattern(sequence, a0, length) {
  const pattern = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    const base = sequence[a0 + i];
    pattern[i] = base === undefined ? 4 : (BASE_INDEX[base] ?? 4);
  }
  return pattern;
}

// Positions where an allele's local sequence (the base and the three before it) equals the wild type's. There
// the allele produces the same peak shapes as the control does, including its artefacts (shoulders, uneven
// heights), so it inherits the control's observed composition instead of an idealised single peak.
const CONTEXT = 4;

// Key for merging identical columns (no Buffer: this runs in the browser).
function columnKey(pattern, flags) {
  let key = "";
  for (let i = 0; i < pattern.length; i += 1) key += String.fromCharCode(48 + pattern[i] * 2 + flags[i]);
  return key;
}
function contextFlags(sequence, a0, length, reference) {
  const flags = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    let same = true;
    for (let t = 0; t < CONTEXT; t += 1) {
      const x = sequence[a0 + i - t];
      if (x === undefined || x !== reference[a0 + i - t]) { same = false; break; }
    }
    flags[i] = same ? 1 : 0;
  }
  return flags;
}

// One read's observations over its inference window (control composition for the context rule, edited composition to fit).
function buildBlock(prepared, reversed) {
  const { control, edited, shift, readToRef, window } = prepared;
  const len = window.end - window.start;
  let anchor = window.start;
  while (anchor < window.end && (readToRef[anchor] === undefined || readToRef[anchor] < 0)) anchor += 1;
  const a0 = readToRef[anchor] - (anchor - window.start);
  const obs = new Float64Array(len * 4); const use = new Uint8Array(len);
  for (let j = window.start; j < window.end; j += 1) {
    const k = j + shiftAt(prepared, j);
    if (k >= 0 && k < edited.calls.length && control.valid[j] && edited.valid[k]) { const i = j - window.start; use[i] = 1; for (let b = 0; b < 4; b += 1) obs[i * 4 + b] = edited.composition[k * 4 + b]; }
  }
  const cc = new Float64Array(len * 4); const cn = new Float64Array(len); const cs = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const j = window.start + i;
    for (let b = 0; b < 4; b += 1) { const v = control.composition[j * 4 + b]; cc[i * 4 + b] = v; cn[i] += v * v; cs[i] += v; }
  }
  return { len, a0, obs, use, cc, cn, cs, reversed, reference: prepared.spec.reference.sequence, orientation: prepared.orientation };
}

/**
 * @param prepared one prepared read, or an array of reads of the same sample (forward and reverse primer). The reads share one set of
 *   allele abundances: their windows are laid end to end and fitted together, so every column of the fit is one allele seen by every read.
 */
export function decompose({ prepared, alleles, options = {} }) {
  const preparedList = Array.isArray(prepared) ? prepared : [prepared];
  const minFraction = options.minFraction ?? 0.002;
  const blocks = preparedList.map((p, index) => buildBlock(p, index > 0 && p.orientation !== preparedList[0].orientation));
  let len = 0; blocks.forEach((block) => { block.offset = len; len += block.len; });
  const obs = new Float64Array(len * 4); const use = new Uint8Array(len); const cc = new Float64Array(len * 4); const cn = new Float64Array(len); const cs = new Float64Array(len);
  blocks.forEach((block) => { obs.set(block.obs, block.offset * 4); use.set(block.use, block.offset); cc.set(block.cc, block.offset * 4); cn.set(block.cn, block.offset); cs.set(block.cs, block.offset); });
  const a0 = blocks[0].a0;
  const useContext = options.controlContext !== false;
  const columns = [];
  const byKey = new Map();
  for (const allele of alleles) {
    const pattern = new Uint8Array(len); const flags = new Uint8Array(len);
    for (const block of blocks) {
      const sequence = sequenceFor(allele, block.reversed);
      pattern.set(readPattern(sequence, block.a0, block.len), block.offset);
      if (useContext) flags.set(contextFlags(sequence, block.a0, block.len, block.reference), block.offset);
    }
    for (let i = 0; i < len; i += 1) { if (!use[i]) { pattern[i] = 5; flags[i] = 0; } else if (pattern[i] >= 4) flags[i] = 0; }
    const key = columnKey(pattern, flags);
    let column = byKey.get(key);
    if (!column) { column = { pattern, flags, members: [] }; byKey.set(key, column); columns.push(column); }
    column.members.push(allele);
  }
  // Flat background: every real trace carries some signal in the three uncalled channels. A column that is
  // 25% at every base absorbs that, so noise is not spread over dozens of small false alleles.
  const noisePattern = new Uint8Array(len).fill(4);
  for (let i = 0; i < len; i += 1) if (!use[i]) noisePattern[i] = 5;
  const noiseAllele = { id: "noise", kind: "noise", label: "Background signal", sequence: "", size: 0 };
  if (options.background !== false) columns.push({ pattern: noisePattern, flags: new Uint8Array(len), members: [noiseAllele] });
  columns.forEach((column) => {
    column.members.sort((x, y) => (PRIORITY[y.kind] - PRIORITY[x.kind]) || (Math.abs(x.size) - Math.abs(y.size)));
    column.representative = column.members[0];
  });
  const n = columns.length;
  const dot = (A, B, i) => {
    const x = A.pattern[i]; const y = B.pattern[i];
    if (x === 5 || y === 5) return 0;
    const fa = A.flags[i]; const fb = B.flags[i];
    if (fa && fb) return cn[i];
    if (fa) return y === 4 ? 0.25 * cs[i] : cc[i * 4 + y];
    if (fb) return x === 4 ? 0.25 * cs[i] : cc[i * 4 + x];
    if (x === 4 || y === 4) return 0.25;
    return x === y ? 1 : 0;
  };
  const AtA = Array.from({ length: n }, () => new Float64Array(n));
  for (let a = 0; a < n; a += 1) {
    for (let c = a; c < n; c += 1) {
      let sum = 0;
      const A = columns[a]; const B = columns[c];
      for (let i = 0; i < len; i += 1) sum += dot(A, B, i);
      AtA[a][c] = sum; AtA[c][a] = sum;
    }
  }
  const Atb = new Float64Array(n);
  columns.forEach((column, a) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) {
      const x = column.pattern[i]; if (x === 5) continue;
      if (column.flags[i]) { for (let b = 0; b < 4; b += 1) sum += obs[i * 4 + b] * cc[i * 4 + b]; continue; }
      sum += x === 4 ? 0.25 : obs[i * 4 + x];
    }
    Atb[a] = sum;
  });
  let btb = 0;
  for (let i = 0; i < len; i += 1) if (use[i]) for (let b = 0; b < 4; b += 1) btb += obs[i * 4 + b] ** 2;
  const penalties = { ...DEFAULT_PENALTIES, ...(options.penalties || {}) };
  const penaltyOf = (allele) => (allele.kind === "edit_partial" && /^d\d+:run/.test(allele.id) && allele.skipsMarker ? penalties.edit_partial_skip : penalties[allele.kind] ?? 0);
  const tieBreak = Float64Array.from(columns, (column) => penaltyOf(column.representative));
  const wtColumn = columns.findIndex((column) => column.representative.kind === "wt");
  // Only the generic indel family (hundreds of nuisance candidates, each spanning many positions) is shrunk. The
  // few hypothesis alleles (wild type, the donor's complete edit and its partial runs) are not: an edit that
  // differs from wild type at one or two positions would be pulled down by several points by any noise-level penalty.
  const SHRUNK = new Set(["indel", "deletion_between_cuts", "edit_indel"]);
  const isFree = (column) => !SHRUNK.has(column.representative.kind);
  // Distance of each allele's predicted trace from the wild type's: the number of positions (weighted by how
  // different) at which this allele can be told apart. An allele that differs at 5 positions needs less
  // shrinkage than one that differs at 100, because noise can only imitate it over as many positions as it spans.
  const distance = Float64Array.from(columns, (_, a) => (wtColumn < 0 ? Math.sqrt(AtA[a][a]) : Math.sqrt(Math.max(0, AtA[a][a] - 2 * AtA[a][wtColumn] + AtA[wtColumn][wtColumn]))));
  const fit = (scale, sigma) => nnlsGram(AtA, Float64Array.from(Atb, (value, a) => value - tieBreak[a] - (isFree(columns[a]) ? 0 : scale * sigma * distance[a])));
  const residual = (weights) => {
    let cross = 0; let self = 0;
    for (let a = 0; a < n; a += 1) { if (!weights[a]) continue; cross += weights[a] * Atb[a]; for (let c = 0; c < n; c += 1) if (weights[c]) self += weights[a] * weights[c] * AtA[a][c]; }
    return Math.max(0, btb - 2 * cross + self);
  };
  // Pass 1 measures the noise (residual of a fit with only tie-breaking costs); pass 2 charges every non-wild-type
  // allele sigma * sqrt(2 ln n) * its distance from wild type per unit abundance, so that hundreds of candidates
  // cannot each pick up a little of the noise.
  const positionsUsed0 = use.reduce((s, v) => s + v, 0);
  let shrinkage = 0; let sigmaUsed = 0; let debiased = false;
  let w = fit(0, 0);
  if (options.shrink !== false && positionsUsed0 > 0) {
    const sigma = Math.sqrt(residual(w) / Math.max(1, positionsUsed0 * 4)); sigmaUsed = sigma;
    shrinkage = (options.shrinkScale ?? 1) * Math.sqrt(2 * Math.log(Math.max(2, n)));
    w = fit(shrinkage, sigma);
    // The penalty selects which alleles are present but also pulls their abundances down. When the fit is good (enough signal, little
    // unexplained background) the selected alleles are refitted without it, so that their abundances are not biased low. In a poor fit
    // the unpenalised refit would spread the abundances over many look-alike alleles, so the regularised estimate is kept.
    if (options.debias !== false) {
      const noiseColumn = columns.findIndex((column) => column.representative.kind === "noise");
      const total0 = w.reduce((s, v) => s + v, 0); const noise0 = noiseColumn >= 0 ? w[noiseColumn] : 0;
      const ssWt0 = wtColumn >= 0 ? Math.max(0, btb - 2 * Atb[wtColumn] + AtA[wtColumn][wtColumn]) : 0;
      const r2first = ssWt0 > 1e-9 ? 1 - residual(w) / ssWt0 : 0;
      if (r2first >= (options.debiasMinR2 ?? 0.9) && total0 > 0 && noise0 / total0 < (options.debiasMaxNoise ?? 0.15)) {
        const active = []; w.forEach((value, a) => { if (value > 0) active.push(a); });
        if (active.length) {
          const sub = nnlsGram(active.map((a) => Float64Array.from(active, (c) => AtA[a][c])), Float64Array.from(active, (a) => Atb[a] - tieBreak[a]));
          const refit = new Float64Array(n); active.forEach((a, k) => { refit[a] = sub[k]; });
          w = refit; debiased = true;
        }
      }
    }
  }
  const quadratic = (weights) => {
    let cross = 0; let self = 0;
    for (let a = 0; a < n; a += 1) { if (!weights[a]) continue; cross += weights[a] * Atb[a]; for (let c = 0; c < n; c += 1) if (weights[c]) self += weights[a] * weights[c] * AtA[a][c]; }
    return btb - 2 * cross + self;
  };
  const ssRes = Math.max(0, quadratic(w));
  const wtIndex = columns.findIndex((column) => column.members.some((m) => m.kind === "wt"));
  const wtOnly = new Float64Array(n); if (wtIndex >= 0) wtOnly[wtIndex] = 1;
  const ssWt = Math.max(0, quadratic(wtOnly));
  const noiseIndex = columns.findIndex((column) => column.representative.kind === "noise");
  const noiseWeight = noiseIndex >= 0 ? w[noiseIndex] : 0;
  const rawSum = w.reduce((s, v) => s + v, 0);
  const alleleSum = rawSum - noiseWeight;
  const total = alleleSum > 0 ? alleleSum : 1;
  const contributions = columns
    .map((column, a) => ({ column, a, fraction: w[a] / total, raw: w[a] }))
    .filter((entry) => entry.column.representative.kind !== "noise" && entry.fraction >= minFraction)
    .sort((x, y) => y.fraction - x.fraction)
    .map(({ column, fraction, raw }) => ({
      id: column.representative.id, kind: column.representative.kind, label: column.representative.label, size: column.representative.size, sequence: column.representative.sequence,
      fraction, raw, guide: column.representative.guide ?? null, donor: column.representative.donor ?? null,
      carries: column.representative.carries ?? null, intendedPresent: column.representative.intendedPresent ?? null,
      indistinguishable: column.members.length - 1,
      alsoConsistentWith: column.members.slice(1, 4).map((member) => member.label),
    }));
  const positionsUsed = use.reduce((s, v) => s + v, 0);
  // With several reads: each read's own estimate from the same alleles (refitted on that read's positions only), to see whether the reads agree.
  let perRead = null;
  if (blocks.length > 1) {
    const active = []; w.forEach((value, a) => { if (value > 0 && columns[a].representative.kind !== "noise") active.push(a); });
    const noiseCol = columns.findIndex((column) => column.representative.kind === "noise"); if (noiseCol >= 0) active.push(noiseCol);
    perRead = blocks.map((block) => {
      const lo = block.offset; const hi = block.offset + block.len; const m = active.length;
      const G = Array.from({ length: m }, () => new Float64Array(m)); const g = new Float64Array(m); let bb = 0;
      for (let x = 0; x < m; x += 1) {
        for (let y = x; y < m; y += 1) { let sum = 0; for (let i = lo; i < hi; i += 1) sum += dot(columns[active[x]], columns[active[y]], i); G[x][y] = sum; G[y][x] = sum; }
        let sum = 0; const column = columns[active[x]];
        for (let i = lo; i < hi; i += 1) { const p = column.pattern[i]; if (p === 5) continue; if (column.flags[i]) { for (let b = 0; b < 4; b += 1) sum += obs[i * 4 + b] * cc[i * 4 + b]; } else sum += p === 4 ? 0.25 : obs[i * 4 + p]; }
        g[x] = sum - tieBreak[active[x]];
      }
      for (let i = lo; i < hi; i += 1) if (use[i]) for (let b = 0; b < 4; b += 1) bb += obs[i * 4 + b] ** 2;
      const v = nnlsGram(G, g); let all = 0; let wtW = 0; let edit = 0;
      active.forEach((a, x) => { const kind = columns[a].representative.kind; if (kind === "noise") return; all += v[x]; if (kind === "wt") wtW += v[x]; if (kind === "edit") edit += v[x]; });
      let cross = 0; let self = 0; v.forEach((vx, x) => { if (!vx) return; cross += vx * (g[x] + tieBreak[active[x]]); v.forEach((vy, y) => { if (vy) self += vx * vy * G[x][y]; }); });
      return { editedShare: all > 0 ? 1 - wtW / all : null, intendedShare: all > 0 ? edit / all : null, ssRes: Math.max(0, bb - 2 * cross + self), positions: use.slice(lo, hi).reduce((s, x) => s + x, 0) };
    });
  }
  // What the fitted mixture predicts at every position, so that callers can look at the residual (see pursuit.js).
  let internals = null;
  if (options.returnInternals) {
    const fitted = new Float64Array(len * 4);
    columns.forEach((column, a) => {
      const weight = w[a]; if (!weight) return;
      for (let i = 0; i < len; i += 1) {
        const x = column.pattern[i]; if (x === 5) continue;
        if (column.flags[i]) { for (let b = 0; b < 4; b += 1) fitted[i * 4 + b] += weight * cc[i * 4 + b]; } else if (x === 4) { for (let b = 0; b < 4; b += 1) fitted[i * 4 + b] += weight * 0.25; } else fitted[i * 4 + x] += weight;
      }
    });
    const lin = Float64Array.from(tieBreak, (value, a) => value + (debiased || isFree(columns[a]) ? 0 : shrinkage * sigmaUsed * distance[a]));
    internals = { obs, fitted, use, a0, len, blocks: blocks.map((b) => ({ offset: b.offset, len: b.len, a0: b.a0, reversed: b.reversed, reference: b.reference })), sigma2: ssRes / Math.max(1, positionsUsed * 4),
      solver: { AtA, Atb, btb, lin, w, ssRes, positionsUsed, n, kinds: columns.map((c) => c.representative.kind), sizes: columns.map((c) => c.representative.size), alleles: columns.map((c) => c.representative), noiseIndex, wtIndex: columns.findIndex((c) => c.representative.kind === "wt") } };
  }
  return {
    internals, perRead,
    shrinkage, contributions, rawSum, noiseFraction: rawSum > 0 ? noiseWeight / rawSum : 0, ssRes, ssWt, r2: ssWt > 1e-9 ? Math.max(0, 1 - ssRes / ssWt) : null,
    rmse: Math.sqrt(ssRes / Math.max(1, positionsUsed * 4)), positionsUsed, windowLength: len, candidates: alleles.length, columns: n,
  };
}
