// Adaptive library growth ("pursuit"). The base library lists every small indel exhaustively; larger events cannot be listed
// (a deletion of up to 250 bases anchored at either side of each cut is tens of thousands of alleles). After the first fit,
// every large candidate is scored by how much of the remaining residual it would explain, and only candidates that clear a
// significance threshold, corrected for the number tried, are added for a second fit. Wild-type and small-indel traces
// leave no residual to explain, so they gain nothing; the threshold is checked on wild-type replicates (bench/).
import { decompose } from "./decompose.js";

export const PURSUIT_DEFAULTS = { maxLargeDeletion: 250, minLargeDeletion: 31, spanExtension: 60, topK: 8, extraThreshold: 12, };
const IDX = { A: 0, C: 1, G: 2, T: 3 };
const indexed = (sequence) => Int8Array.from(sequence, (base) => IDX[base] ?? -1);

function residualOf(internals) {
  const { obs, fitted, len } = internals; const r = new Float64Array(len * 4);
  for (let i = 0; i < len * 4; i += 1) r[i] = obs[i] - fitted[i];
  return r;
}

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", N: "N" };
const reverseComplement = (sequence) => { let out = ""; for (let i = sequence.length - 1; i >= 0; i -= 1) out += COMPLEMENT[sequence[i]] ?? "N"; return out; };

// Gain of replacing part of the wild type by a candidate: (a_c - a_wt).r squared over |a_c - a_wt|^2, summed over every read's window.
// A candidate is given in the first read's orientation; a read from the other primer sees it (and the reference) reversed.
function candidateGain(blocks, internals, resid, candidate) {
  const { use } = internals; let dot = 0; let norm = 0;
  for (const block of blocks) {
    const n = block.refIdx.length;
    if (candidate.deletion) {
      const { s, e } = candidate.deletion; const shift = e - s;
      const sb = block.reversed ? n - e : s; // start of the deleted stretch in this read's coordinates
      for (let i = Math.max(0, sb - block.a0); i < block.len; i += 1) {
        if (!use[block.offset + i]) continue;
        const q = block.a0 + i; const p2 = q + shift; if (q >= n || p2 >= n) continue;
        const pw = block.refIdx[q]; const pc = block.refIdx[p2];
        if (pw < 0 || pc < 0 || pw === pc) continue;
        const r = (block.offset + i) * 4; dot += resid[r + pc] - resid[r + pw]; norm += 2;
      }
    } else {
      const sequence = block.reversed ? candidate.reversedSequence : candidate.sequence;
      for (let i = 0; i < block.len; i += 1) {
        if (!use[block.offset + i]) continue;
        const q = block.a0 + i; const pw = block.refIdx[q]; const pc = IDX[sequence[q]];
        if (pw === undefined || pw < 0 || pc === undefined || pw === pc) continue;
        const r = (block.offset + i) * 4; dot += resid[r + pc] - resid[r + pw]; norm += 2;
      }
    }
  }
  return dot > 0 && norm > 0 ? (dot * dot) / norm : 0;
}

export function proposeAlleles({ prepared, internals, alleles, options = {} }) {
  const opt = { ...PURSUIT_DEFAULTS, ...(options.pursuit || {}) };
  const first = Array.isArray(prepared) ? prepared[0] : prepared;
  const spec = first.spec; const reference = spec.reference.sequence.toUpperCase(); const guides = spec.guides || [];
  const resid = residualOf(internals); const found = []; let tried = 0;
  const blocks = internals.blocks.map((block) => ({ ...block, refIdx: indexed(block.reference.toUpperCase()) }));
  const lo = internals.a0; // deletions must start inside the aligned window of the first read
  const addDeletion = (s, e, guide, between) => {
    if (s < lo || s < 1 || e > reference.length - 20 || e <= s) return;
    tried += 1;
    const gain = candidateGain(blocks, internals, resid, { deletion: { s, e } });
    if (gain > 0) found.push({ gain, s, e, guide, between });
  };
  guides.forEach((guide, g) => {
    for (let size = opt.minLargeDeletion; size <= opt.maxLargeDeletion; size += 1) for (let left = 0; left <= size; left += 1) addDeletion(guide.cut - left, guide.cut - left + size, g, false);
  });
  for (let i = 0; i < guides.length; i += 1) for (let j = i + 1; j < guides.length; j += 1) {
    const a = Math.min(guides[i].cut, guides[j].cut); const b = Math.max(guides[i].cut, guides[j].cut);
    for (let s = a - opt.spanExtension; s <= a + 3; s += 1) for (let e = b - 3; e <= b + opt.spanExtension; e += 1) if (e - s > 33) addDeletion(s, e, i, true);
  }
  const sequenceCandidates = []; // a two-cut deletion with a few extra bases at its junction
  for (let i = 0; i < guides.length; i += 1) for (let j = i + 1; j < guides.length; j += 1) {
    const a = Math.min(guides[i].cut, guides[j].cut); const b = Math.max(guides[i].cut, guides[j].cut);
    for (let da = -3; da <= 3; da += 1) for (let db = -3; db <= 3; db += 1) for (let n = 1; n <= 2; n += 1) {
      const s = a + da; const e = b + db; if (e <= s + 2) continue;
      sequenceCandidates.push({ sequence: reference.slice(0, s) + "N".repeat(n) + reference.slice(e), kind: "deletion_between_cuts", label: `Deletion between cuts (${e - s} bp) with +${n} at the junction`, size: n - (e - s), guide: i + 1, between: true });
    }
  }
  sequenceCandidates.forEach((candidate) => {
    tried += 1;
    candidate.reversedSequence = reverseComplement(candidate.sequence);
    const gain = candidateGain(blocks, internals, resid, candidate);
    if (gain > 0) found.push({ gain, candidate });
  });
  const threshold = internals.sigma2 * (2 * Math.log(Math.max(2, tried)) + opt.extraThreshold);
  const chosen = found.filter((entry) => entry.gain >= threshold).sort((x, y) => y.gain - x.gain).slice(0, opt.topK);
  const known = new Set(alleles.map((a) => a.sequence));
  const out = [];
  chosen.forEach((entry) => {
    if (entry.candidate) { if (!known.has(entry.candidate.sequence)) { known.add(entry.candidate.sequence); const { reversedSequence, ...rest } = entry.candidate; out.push({ id: `pursuit:${out.length}`, ...rest, proposed: true }); } return; }
    const { s, e, guide, between } = entry; const size = e - s; const sequence = reference.slice(0, s) + reference.slice(e);
    if (known.has(sequence)) return; known.add(sequence);
    out.push({ id: `pursuit:del${size}@${s}`, kind: between ? "deletion_between_cuts" : "indel", label: between ? `Deletion spanning both cuts (${size} bp)` : `${guides[guide].name}: -${size}`, sequence, size: -size, guide: guide + 1, proposed: true });
  });
  return out;
}

/** Fit with the base library; if the residual holds a significant large event, add it and fit again (kept only if it explains more). */
export function decomposeAdaptive({ prepared, alleles, options = {} }) {
  const first = decompose({ prepared, alleles, options: { ...options, returnInternals: true } });
  if (options.pursuit === false || !first.internals) return first;
  const extra = proposeAlleles({ prepared, internals: first.internals, alleles, options });
  if (!extra.length) return first;
  const second = decompose({ prepared, alleles: [...alleles, ...extra], options: { ...options, returnInternals: true } });
  if (second.ssRes < 0.9 * first.ssRes) { second.pursuit = { proposed: extra.map((a) => a.label), firstR2: first.r2 }; return second; }
  return first;
}
