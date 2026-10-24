// Which guides to offer for an insertion or point-mutation design.
//
// The engine documents its guide ranking as "blockability first, distance second, within a
// distance window". For a long time the code did not do that: it took the nearest guide and
// one distinct partner by proximity and strand alone, and only then ranked those two by how
// well each could be blocked. A guide that could be blocked better never reached the ranking
// if it sat within 10 bp of the nearest guide's cut - on NR2F2 the 40% GC guide at -14 bp was
// discarded for being 2 bp from a guide at -12 bp that grades one tier lower.
//
// This module holds the pair choice as a pure function of already-scored candidates, so the
// ordering rule can be tested without a reference sequence. It stays free of React and of
// Vite-only globals so `node --test` can load it.

/** Two selected guides must cut at least this far apart to count as independent. */
export const MINIMUM_ALTERNATIVE_CUT_OFFSET = 10;
export const EDIT_SEARCH_WINDOWS = Object.freeze([10, 20, 30]);

/** Spacer composition outside these limits is ranked behind otherwise equal guides. */
export const SEVERE_GC_LOW_PERCENT = 25;
export const SEVERE_GC_HIGH_PERCENT = 75;
export const SEVERE_DOMINANT_BASE_FRACTION = 0.6;

/**
 * Composition of a spacer, and whether it is extreme enough to rank behind an equal guide.
 *
 * This is a tie-break, never a gate: GC alone does not predict whether a guide cuts, and a
 * guide flagged here is still offered when nothing better exists. It exists because the
 * ranking has no other information about a guide that is mostly one base - a spacer such as
 * AATAAATAAATAAAATAAGA matches repeats all over the genome, and nothing in a synonymous-change
 * score would show that.
 */
export function assessSpacerQuality(spacer) {
  const sequence = String(spacer || "").toUpperCase();
  const length = sequence.length;
  if (!length) return { gc: 0, dominantBase: null, dominantBaseFraction: 0, severe: false, reasons: [] };
  const counts = { A: 0, C: 0, G: 0, T: 0 };
  for (const base of sequence) if (base in counts) counts[base] += 1;
  const gc = Math.round(((counts.G + counts.C) / length) * 100);
  const [dominantBase, dominantCount] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0];
  const dominantBaseFraction = dominantCount / length;
  const reasons = [];
  if (gc < SEVERE_GC_LOW_PERCENT) reasons.push(`GC ${gc}% is below ${SEVERE_GC_LOW_PERCENT}%`);
  if (gc > SEVERE_GC_HIGH_PERCENT) reasons.push(`GC ${gc}% is above ${SEVERE_GC_HIGH_PERCENT}%`);
  if (dominantBaseFraction > SEVERE_DOMINANT_BASE_FRACTION) {
    reasons.push(`${Math.round(dominantBaseFraction * 100)}% of the spacer is ${dominantBase}`);
  }
  return { gc, dominantBase, dominantBaseFraction, severe: reasons.length > 0, reasons };
}

/**
 * Order for scored candidates: protection rank, then composition, then distance.
 *
 * `index` is the nearest-first position, so a lower index is a closer guide. Distance only
 * decides between guides that are equal on both of the other criteria.
 */
export function compareScoredGuides(left, right) {
  return (left.rank - right.rank)
    || (Number(left.severe) - Number(right.severe))
    || (left.index - right.index);
}

/**
 * The guides to offer from one distance window.
 *
 * Two guides are offered whenever two with distinct cut sites exist, as the engine has always
 * done; what changed is how the pair is chosen. Every candidate has already been scored, so the
 * pair is the one whose leading guide is best (protection, then composition, then distance),
 * and whose partner is the best guide at least `minimumCutOffset` bp away from it. A guide
 * with no distinct partner does not lead a pair when a lower-ranked guide can.
 *
 * @param {Array<{guide: object, index: number, rank: number}>} entries every candidate in the
 *   window, already scored. `index` is the nearest-first position and `rank` the protection
 *   rank (lower is better protected).
 * @returns {object[]} the lead guide first, then its partner. Among partners of the same
 *   protection and composition class the opposite strand is preferred, then proximity. When no
 *   two candidates are distinct, the single best guide is returned - the best protected, not
 *   merely the nearest.
 */
export function pickGuidePair(entries, { minimumCutOffset = MINIMUM_ALTERNATIVE_CUT_OFFSET } = {}) {
  const scored = (entries || [])
    .map((entry) => ({ ...entry, severe: assessSpacerQuality(entry.guide?.sp).severe }))
    .sort(compareScoredGuides);
  if (!scored.length) return [];
  const isDistinct = (left, right) => Math.abs(left.guide.cut - right.guide.cut) >= minimumCutOffset;
  for (let leadIndex = 0; leadIndex < scored.length; leadIndex += 1) {
    const lead = scored[leadIndex];
    const partners = scored.slice(leadIndex + 1).filter((entry) => isDistinct(lead, entry));
    if (!partners.length) continue;
    const best = partners[0];
    const sameClass = partners.filter((entry) => entry.rank === best.rank && entry.severe === best.severe);
    const partner = sameClass.find((entry) => entry.guide.str !== lead.guide.str) || best;
    return [lead.guide, partner.guide];
  }
  return [scored[0].guide];
}

/**
 * The partner for a lone lead guide, chosen from candidates in a wider distance window.
 *
 * Used when the nearest window held one guide only, or guides whose cuts were all closer than `minimumCutOffset`, so no pair could be offered. The lead
 * stays as it was; the partner is the best-protected candidate whose cut is at least `minimumCutOffset` bp from the lead's cut (then composition, then
 * proximity; among equals the opposite strand is preferred), exactly as pickGuidePair chooses a partner. Returns null when no candidate is distinct.
 *
 * @param {object} lead the guide already selected (needs `cut` and `str`)
 * @param {Array<{guide: object, index: number, rank: number}>} entries scored candidates of one window, nearest first
 */
export function pickPartnerGuide(lead, entries, { minimumCutOffset = MINIMUM_ALTERNATIVE_CUT_OFFSET } = {}) {
  const scored = (entries || [])
    .filter((entry) => entry.guide && entry.guide.sp !== lead.sp && Math.abs(entry.guide.cut - lead.cut) >= minimumCutOffset)
    .map((entry) => ({ ...entry, severe: assessSpacerQuality(entry.guide.sp).severe }))
    .sort(compareScoredGuides);
  if (!scored.length) return null;
  const best = scored[0];
  const sameClass = scored.filter((entry) => entry.rank === best.rank && entry.severe === best.severe);
  return (sameClass.find((entry) => entry.guide.str !== lead.str) || best).guide;
}
