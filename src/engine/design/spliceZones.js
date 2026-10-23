// Where a genomic index lies relative to the annotated exons, and the splice-site windows around them.
//
// A leaf module (no imports) so that both the design engine and the Genomic SNP blocking code can use the same definition of "inside a splice-site window"
// without a circular import. The windows are this tool's own cut points, not a splice-site model.

export const SPLICE_WINDOWS = Object.freeze({ donorExonBases: 3, donorIntronBases: 6, acceptorIntronBases: 40, acceptorExonBases: 3, exonMargin: 4, crypticReach: 60 });

export function exonList(model) {
  const exons = (model && Array.isArray(model.exons) ? model.exons : []).filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end));
  if (exons.length) return exons.map((e) => ({ start: e.start, end: e.end, label: e.label || `Exon ${e.exonNumber || ''}`.trim() })).sort((a, b) => a.start - b.start);
  return ((model && model.cdsSegments) || []).map(([start, end], i) => ({ start, end, label: `CDS segment ${i + 1}` }));
}

/** Where a genomic index lies relative to the annotated exons: zone is one of donor-critical, acceptor-critical, exon-edge, exon-interior, intron-deep, unknown. */
export function classifyPosition(model, p) {
  const exons = exonList(model); const W = SPLICE_WINDOWS;
  if (!exons.length) return { zone: 'unknown', text: 'no exon annotation in the reference' };
  for (const ex of exons) {
    if (p >= ex.start && p < ex.end) {
      const toStart = p - ex.start, toEnd = ex.end - 1 - p;
      if (toEnd < W.donorExonBases) return { zone: 'donor-critical', exon: ex.label, text: `last ${toEnd + 1} base${toEnd ? 's' : ''} of ${ex.label} (donor site)` };
      if (toStart < W.acceptorExonBases) return { zone: 'acceptor-critical', exon: ex.label, text: `first ${toStart + 1} base${toStart ? 's' : ''} of ${ex.label} (acceptor site)` };
      if (toStart < W.exonMargin || toEnd < W.exonMargin) return { zone: 'exon-edge', exon: ex.label, text: `${Math.min(toStart, toEnd)} bp from an end of ${ex.label}` };
      return { zone: 'exon-interior', exon: ex.label, text: `${ex.label}, ${Math.min(toStart, toEnd) + 1} bp from the nearest end`, distance: Math.min(toStart, toEnd) };
    }
  }
  const prev = [...exons].reverse().find((e) => e.end <= p); const next = exons.find((e) => e.start > p);
  const dDonor = prev ? p - prev.end + 1 : Infinity, dAcc = next ? next.start - p : Infinity;
  if (dDonor <= W.donorIntronBases) return { zone: 'donor-critical', exon: prev.label, text: `intron +${dDonor} after ${prev.label} (donor site)`, offset: `+${dDonor}` };
  if (dAcc <= W.acceptorIntronBases) return { zone: 'acceptor-critical', exon: next.label, text: `intron -${dAcc} before ${next.label} (acceptor site, branch point and pyrimidine tract)`, offset: `-${dAcc}` };
  const near = dDonor <= dAcc ? `+${dDonor} after ${prev.label}` : `-${dAcc} before ${next.label}`;
  return { zone: 'intron-deep', text: `intron ${near}`, offset: dDonor <= dAcc ? `+${dDonor}` : `-${dAcc}`, distance: Math.min(dDonor, dAcc) };
}

/** True when the index lies in a donor or acceptor window of an annotated exon (donor: last 3 exon bases and intron +1..+6; acceptor: intron -40..-1 and first 3 exon bases). */
export function inSpliceWindow(model, p) {
  const zone = classifyPosition(model, p).zone;
  return zone === 'donor-critical' || zone === 'acceptor-critical';
}
