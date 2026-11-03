// Unplanned base changes: a position where the edited trace carries a second base that the fitted mixture does not predict and the
// control does not have.
//
// The allele library only contains what the design says could happen. A clone that also carries a variant the design did not ask
// for (a second edit from the ssODN, a base-editor bystander, a heterozygous sequence variant, a mixed template) is fitted as well as
// the library allows and the leftover shows up only as a lower R2. This names the position and the base so that it can be checked in the trace.
//
// One position is flagged when, in the edited trace: a base other than the control's carries at least `minFraction` of the signal, the fit
// predicts less than `maxPredicted` of that base there, and the control is clean at that position. Planned markers are skipped. Positions
// upstream of the cut are always scanned (an edit cannot be there); positions after the cut only when every allele in the fit leaves the
// length unchanged. A run of hits means a misfit or a rearranged read, not an isolated base change: the hits are not listed one by one then,
// but the count is returned (`overflow`) so that the read is still flagged.
//
// Every read of a sample is scanned on its own (a clone read from both ends gives two independent looks at the same base): the hits are then
// mapped back to the forward strand of the design and merged. A base seen in two reads read from different directions is `confirmed`; one seen in a
// single read, where another read covers the position and shows the reference base, is `discordant` (a read artefact is more likely); one seen
// in a single read that nothing else covers is a `single read` finding. A poor fit (R2 < unplannedMinR2) no longer switches the scan off, because
// an unplanned base change is itself a reason for a poor fit; it raises the signal needed instead (`unplannedLowFitMinFraction`) and is marked `lowFit`.

import { shiftAt } from "./offset.js";

export const UNPLANNED_DEFAULTS = { unplanned: true, unplannedFlanks: true, unplannedFlankQuality: 30, unplannedFlankGapStop: 12, unplannedTailTrim: 25, unplannedRunGap: 6, unplannedRunMin: 3, unplannedNeighbourhood: 10, unplannedNeighbourConcordance: 0.85, unplannedMinFraction: 0.25, unplannedLowFitMinFraction: 0.35, unplannedMaxPredicted: 0.10, unplannedControlClean: 0.10, unplannedMaxHits: 2, unplannedMinR2: 0.8, unplannedUpstreamEnd: 2, unplannedMinAllele: 0.02 };
const BASES = ["A", "C", "G", "T"];

/**
 * Scan one prepared read. Unlike {@link scanUnplanned} it also returns what it could look at, so that the reads of one sample can be compared.
 * @param prepared one prepared read
 * @param internals decomposition.internals of the fit of THIS read alone (obs, fitted, use, a0, len)
 * @param decomposition that fit (contributions, r2)
 * @returns {{ hits: Array<{ readIndex: number, refIndex: number, relative: number, ref: string, alt: string, fraction: number, lowFit: boolean }>,
 *   covered: Set<number>, lowFit: boolean, overflow: number, runs: Array<{ count: number, refFrom: number, refTo: number, relativeFrom: number, relativeTo: number }> }}
 * refIndex is an index into prepared.spec.reference (mirrored for a read from the reverse primer)
 */
export function scanUnplannedDetailed(prepared, internals, decomposition, options = {}) {
  const o = { ...UNPLANNED_DEFAULTS, ...options };
  const empty = { hits: [], covered: new Set(), lowFit: false, overflow: 0, runs: [] };
  if (!o.unplanned || !internals || !prepared || Array.isArray(prepared)) return empty;
  const lowFit = decomposition.r2 === null || decomposition.r2 === undefined || decomposition.r2 < o.unplannedMinR2;
  const minFraction = lowFit ? Math.max(o.unplannedMinFraction, o.unplannedLowFitMinFraction) : o.unplannedMinFraction;
  const { obs, fitted, use, a0, len } = internals;
  const { control, window, firstCut } = prepared;
  const planned = new Set((prepared.spec.markers || []).map((marker) => marker.pos));
  const sameLength = decomposition.contributions.filter((c) => c.fraction >= o.unplannedMinAllele).every((c) => c.kind === "noise" || ((c.kind === "wt" || c.kind === "edit" || c.kind === "edit_partial") && !c.size));
  const last = sameLength ? len : Math.max(0, Math.min(len, firstCut - o.unplannedUpstreamEnd - window.start));
  const hits = []; const covered = new Set();
  for (let i = 0; i < last; i += 1) {
    if (!use[i]) continue;
    const j = window.start + i;
    if (planned.has(a0 + i)) continue;
    if (Number.isFinite(prepared.shiftPivot) && Math.abs(j - prepared.shiftPivot) <= 3) continue; // where the offset was re-anchored the two reads are compared across a step
    // the control must be a clean single base here
    let c1 = -1; let c1v = 0; let c2v = 0;
    for (let b = 0; b < 4; b += 1) { const v = control.composition[j * 4 + b]; if (v > c1v) { c2v = c1v; c1v = v; c1 = b; } else if (v > c2v) c2v = v; }
    if (c1 < 0 || c2v > o.unplannedControlClean * c1v) continue;
    let rowSum = 0; let fitSum = 0; for (let b = 0; b < 4; b += 1) { rowSum += obs[i * 4 + b]; fitSum += fitted[i * 4 + b]; }
    if (rowSum <= 0 || fitSum <= 0) continue;
    covered.add(a0 + i);
    let alt = -1; let altV = 0;
    for (let b = 0; b < 4; b += 1) if (b !== c1 && obs[i * 4 + b] > altV) { altV = obs[i * 4 + b]; alt = b; }
    if (alt < 0) continue;
    const fraction = altV / rowSum;
    if (fraction >= minFraction && fitted[i * 4 + alt] / fitSum < o.unplannedMaxPredicted) hits.push({ readIndex: j, refIndex: a0 + i, relative: j - firstCut, ref: BASES[c1], alt: BASES[alt], fraction, lowFit });
  }
  // The fit only looks `preCut` bases before the first cut and `postCut` bases after the last. An unwanted change anywhere else on the read (a second edit in
  // the amplicon, a sequence variant) is just as much a reason to doubt the clone, so the stretches either side are compared with the control as well. They carry
  // no designed difference, so every difference there is unplanned. Downstream only when no allele changes the length (past an indel the reads are not comparable).
  let agreeing = () => true;
  if (o.unplannedFlanks) {
    const { edited, readToRef, alignmentWindow } = prepared;
    // the last bases of a Sanger read are unreliable (signal runs off, the polymerase adds a base at the end of the product): they are not compared
    const tailLimit = Math.min(control.calls.length, edited.calls.length - Math.max(0, prepared.shift || 0)) - 1 - o.unplannedTailTrim;
    // An isolated base change sits in a stretch where the two reads otherwise agree. Where they do not (a noisy start of the read, reads out of register), a difference
    // says nothing about the sequence: the flanks are only read where the neighbouring bases agree (planned changes are not counted as disagreement).
    agreeing = (j) => {
      let total = 0; let agree = 0;
      for (let jj = j - o.unplannedNeighbourhood; jj <= j + o.unplannedNeighbourhood; jj += 1) {
        if (jj === j || jj < 0) continue;
        const r = readToRef[jj]; if (r === undefined || r < 0 || planned.has(r)) continue;
        const k = jj + shiftAt(prepared, jj); if (k < 0 || k >= edited.calls.length || !control.valid[jj] || !edited.valid[k]) continue;
        let c = 0; let e = 0; for (let b = 1; b < 4; b += 1) { if (control.composition[jj * 4 + b] > control.composition[jj * 4 + c]) c = b; if (edited.composition[k * 4 + b] > edited.composition[k * 4 + e]) e = b; }
        total += 1; if (c === e) agree += 1; else if (Math.abs(jj - j) <= 2) return false; // a second difference right next to it: a misaligned or noisy stretch, not a base change
      }
      return total >= o.unplannedNeighbourhood + 2 && agree / total >= o.unplannedNeighbourConcordance;
    };
    const flank = (j) => {
      if (j > tailLimit) return null;
      const r = readToRef[j]; if (r === undefined || r < 0 || planned.has(r)) return null;
      const k = j + shiftAt(prepared, j); if (k < 0 || k >= edited.calls.length) return null;
      if (!control.valid[j] || !edited.valid[k] || control.quality[j] < o.unplannedFlankQuality || edited.quality[k] < o.unplannedFlankQuality) return null;
      let c1 = -1; let c1v = 0; let c2v = 0;
      for (let b = 0; b < 4; b += 1) { const v = control.composition[j * 4 + b]; if (v > c1v) { c2v = c1v; c1v = v; c1 = b; } else if (v > c2v) c2v = v; }
      if (c1 < 0 || c2v > o.unplannedControlClean * c1v) return null;
      covered.add(r);
      let alt = -1; let altV = 0; let rowSum = 0;
      for (let b = 0; b < 4; b += 1) { const v = edited.composition[k * 4 + b]; rowSum += v; if (b !== c1 && v > altV) { altV = v; alt = b; } }
      if (alt < 0 || rowSum <= 0) return null;
      const fraction = altV / rowSum;
      return fraction >= minFraction && control.composition[j * 4 + alt] < o.unplannedMaxPredicted ? { readIndex: j, refIndex: r, relative: j - firstCut, ref: BASES[c1], alt: BASES[alt], fraction, lowFit, flank: true } : null;
    };
    for (let j = alignmentWindow ? alignmentWindow.start : window.start; j < window.start; j += 1) { const h = flank(j); if (h) hits.push(h); }
    if (sameLength) {
      let gap = 0;
      for (let j = window.end + 1; j <= tailLimit && gap < o.unplannedFlankGapStop; j += 1) {
        const k = j + shiftAt(prepared, j); const usable = k >= 0 && k < edited.calls.length && control.valid[j] && edited.valid[k] && control.quality[j] >= o.unplannedFlankQuality && edited.quality[k] >= o.unplannedFlankQuality;
        if (!usable) { gap += 1; continue; }
        gap = 0; const h = flank(j); if (h) hits.push(h);
      }
    }
  }
  // Hits that follow one another (three or more within a few bases) are not separate base changes: the two reads are out of register there (a base call missed or added
  // by the base caller, a poor stretch) or the template is mixed. They are returned as `runs`, not as bases.
  hits.sort((a, b) => a.readIndex - b.readIndex);
  const single = []; const runs = []; let cluster = [];
  const flush = () => {
    if (cluster.length >= o.unplannedRunMin) runs.push({ count: cluster.length, readFrom: cluster[0].readIndex, readTo: cluster[cluster.length - 1].readIndex, refFrom: cluster[0].refIndex, refTo: cluster[cluster.length - 1].refIndex, relativeFrom: cluster[0].relative, relativeTo: cluster[cluster.length - 1].relative });
    else single.push(...cluster);
    cluster = [];
  };
  for (const h of hits) { if (cluster.length && h.readIndex - cluster[cluster.length - 1].readIndex > o.unplannedRunGap) flush(); cluster.push(h); }
  flush();
  // a lone difference in the flanks counts only where the reads otherwise agree (see above)
  const isolated = single.filter((h) => !h.flank || agreeing(h.readIndex));
  if (isolated.length > o.unplannedMaxHits) return { hits: [], covered, lowFit, overflow: isolated.length, runs };
  return { hits: isolated, covered, lowFit, overflow: 0, runs };
}

/** The hits of one prepared read (single-read analyses; kept for callers that do not compare reads). */
export function scanUnplanned(prepared, internals, decomposition, options = {}) {
  return scanUnplannedDetailed(prepared, internals, decomposition, options).hits;
}

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A" };

/**
 * Length of the design reference and the forward index of the first cut, from prepared reads (a read from the reverse primer is prepared on the
 * mirrored design: index i there is L - 1 - i on the forward strand, a cut boundary c is L - c).
 */
export function forwardFrame(preparedList) {
  const first = preparedList[0]; const L = first.reference.length;
  const cuts = (first.cuts || []).map((c) => c.refIndex).filter(Number.isFinite);
  const forwardCuts = first.orientation === "-" ? cuts.map((c) => L - c) : cuts;
  return { length: L, cut: forwardCuts.length ? Math.min(...forwardCuts) : 0 };
}

/**
 * Merge the scans of the reads of one sample on the forward strand of the design.
 * @param {Array<{ name: string, orientation: string, scan: ReturnType<typeof scanUnplannedDetailed> }>} entries one per read used
 * @param {{ length: number, cut: number }} frame length of the design reference and the forward index of its first cut (relative = position - cut)
 * @returns {{ changes: Array<object>, overflow: Array<{ name: string, count: number }>, runs: Array<{ name: string, count: number, relativeFrom: number, relativeTo: number }> }}
 *   change = { position, relative, ref, alt, fraction, lowFit, reads: [{ name, fraction }], readsCovering, readsSeen, confirmed, discordant, single }
 */
export function mergeUnplannedReads(entries, frame) {
  const L = frame.length; const cut = frame.cut;
  const forward = (entry) => { const rev = entry.orientation === "-"; return { rev, at: (index) => (rev ? L - 1 - index : index) }; };
  const merged = new Map(); const coverage = entries.map((entry) => { const f = forward(entry); return new Set([...entry.scan.covered].map(f.at)); });
  entries.forEach((entry) => {
    const f = forward(entry);
    entry.scan.hits.forEach((h) => {
      const position = f.at(h.refIndex); const ref = f.rev ? COMPLEMENT[h.ref] : h.ref; const alt = f.rev ? COMPLEMENT[h.alt] : h.alt;
      const key = `${position}:${alt}`;
      if (!merged.has(key)) merged.set(key, { position, relative: position - cut, ref, alt, reads: [], lowFit: true });
      const change = merged.get(key); change.reads.push({ name: entry.name, fraction: h.fraction }); change.lowFit = change.lowFit && Boolean(h.lowFit);
    });
  });
  const changes = [...merged.values()].map((c) => {
    const readsCovering = coverage.filter((set) => set.has(c.position)).length;
    const readsSeen = c.reads.length; const fraction = c.reads.reduce((s, r) => s + r.fraction, 0) / readsSeen;
    return { ...c, fraction, readsCovering: Math.max(readsCovering, readsSeen), readsSeen,
      confirmed: readsSeen >= 2, discordant: readsSeen < readsCovering, single: readsSeen === 1 && readsCovering <= 1 };
  }).sort((a, b) => a.position - b.position);
  const runs = entries.flatMap((entry) => { const f = forward(entry); return (entry.scan.runs || []).map((run) => { const a = f.at(run.refFrom) - cut; const b = f.at(run.refTo) - cut; return { name: entry.name, count: run.count, relativeFrom: Math.min(a, b), relativeTo: Math.max(a, b) }; }); });
  return { changes, overflow: entries.filter((e) => e.scan.overflow > 0).map((e) => ({ name: e.name, count: e.scan.overflow })), runs };
}

export const describeUnplanned = (hits) => hits.map((h) => `${h.relative >= 0 ? "+" : ""}${h.relative}: ${h.ref}>${h.alt} (${Math.round(h.fraction * 100)}%)`).join("; ");
