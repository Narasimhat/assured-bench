// Confidence tier of a result. The old rule ("any warning") had no predictive value for the size of the error in development tests
// (AUC 0.51-0.55); the width of the interval did (AUC 0.88 for errors above 5 points). The tier is therefore the interval's width.
// Error figures are from the development loci of the simulated benchmark (bench/, docs/scorecard.md); they describe those traces,
// not every sample, and are re-measured on the held-out set and on the laboratory mixtures.
export const CONFIDENCE_TIERS = [
  { tier: "high", maxWidth: 10, expected: "In development tests, 90% of results at this level were within 1.6 points of the truth (95%: 2.6)." },
  { tier: "moderate", maxWidth: 20, expected: "In development tests, 90% of results at this level were within 4.1 points of the truth (95%: 5.4)." },
  { tier: "low", maxWidth: Infinity, expected: "In development tests, 40% of results at this level were off by more than 5 points (90%: within 10)." },
];

export function confidenceFrom(intervals, hasDonor) {
  if (!intervals) return null;
  const width = (pair) => pair[1] - pair[0];
  const w = Math.max(width(intervals.editedPct), hasDonor ? width(intervals.intendedEditPct) : 0);
  const tier = CONFIDENCE_TIERS.find((t) => w <= t.maxWidth);
  return { tier: tier.tier, width: Math.round(w * 10) / 10, expected: tier.expected };
}
