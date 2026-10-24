// Interbase cut boundaries. A staggered break is a span, not an experimentally fixed junction.
export function cutBoundaries(guide) {
  return [...new Set([guide.cut, ...Object.values(guide.cuts || {})].filter(Number.isInteger))].sort((a, b) => a - b);
}
export function cutAnchors(guide) {
  const cuts = cutBoundaries(guide);
  if (cuts.length < 2) return cuts;
  const lo = cuts[0], hi = cuts[cuts.length - 1];
  if (hi - lo > 12) throw new Error('Predicted strand cuts span more than 12 bp; verify the nuclease configuration.');
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
export function enzymeAnalysisNotes(spec) {
  return (spec.guides || []).some(g => cutBoundaries(g).length > 1)
    ? ['Staggered-break analysis uses the predicted strand-cut span for indels and paired deletions. Cut positions and repair junctions can vary; fractions and clone decisions need independent validation on real traces for this enzyme.'] : [];
}
