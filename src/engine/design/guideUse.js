// Guide use for terminal-tag designs: whether the offered guides can be delivered together with the
// one donor, and what two cuts on one allele can do.
//
// Pure function of the guides and the per-guide protection the engine already computed. It states
// what the donor does and does not protect against; it does not choose between one guide and two.
// Two guides with one donor that blocks both is the lab convention for large knock-ins; a single
// guide stays possible (a custom guide, or a window with only one candidate).

import { assessSpacerQuality } from "./guideSelection.js";

const FIVE = "5\u2032";
const THREE = "3\u2032";

function placeOf(guide, anchorWord) {
  if (!Number.isFinite(guide.d)) return "";
  return `${Math.abs(guide.d)} bp ${guide.d < 0 ? FIVE : THREE} of the ${anchorWord}`;
}

/**
 * @param {object} input
 * @param {Array<{name: string, sp: string, str: string, gc: number, d: number, cut: number}>} input.guides
 * @param {Array<{guideIndex: number, tier: string, reason?: string}>} input.protection per guide, 1-based guideIndex
 * @param {string} input.anchorWord "stop codon" or "start codon"
 */
export function describeGuideUse({ guides, protection, anchorWord }) {
  if (!guides?.length) return null;
  const tiers = guides.map((guide, index) => protection?.find((entry) => entry.guideIndex === index + 1)?.tier || "none");
  const strong = tiers.map((tier) => tier === "strong");
  const together = guides.length > 1 && strong.every(Boolean);
  const cuts = guides.map((guide) => guide.cut).filter(Number.isFinite).sort((a, b) => a - b);
  const span = guides.length > 1 && cuts.length > 1 ? cuts[cuts.length - 1] - cuts[0] : null;
  const sentences = [];
  let status = "pass";
  const protectionText = guides.map((guide, index) => `${guide.name}: ${tiers[index]}`).join("; ");
  if (guides.length === 1) {
    sentences.push(`One guide (${guides[0].name}, ${placeOf(guides[0], anchorWord)}). There is no second cut site, so no deletion between cuts is possible.`);
    if (!strong[0]) {
      status = "warn";
      sentences.push(`It is not strongly protected in the donor (${tiers[0]}), so it can re-cut a correctly repaired allele.`);
    }
  } else if (together) {
    sentences.push(`Both guides can be delivered together with this donor: each is strongly protected in it (${protectionText}).`);
  } else {
    status = "warn";
    sentences.push(`Not every guide is strongly protected in this donor (${protectionText}). A surviving guide can re-cut a correctly repaired allele; deliver only the strongly protected guide, or add blocking changes.`);
  }
  if (span !== null) {
    sentences.push(`The cuts are ${span} bp apart (${guides.map((guide) => placeOf(guide, anchorWord)).join(" and ")}); if both cut the same allele, non-homologous repair can delete those ${span} bp, so screen for that product as well as the intended edit.`);
  }
  const flagged = guides
    .map((guide) => ({ name: guide.name, reasons: assessSpacerQuality(guide.sp).reasons }))
    .filter((entry) => entry.reasons.length);
  if (flagged.length) {
    sentences.push(`Spacer composition: ${flagged.map((entry) => `${entry.name} ${entry.reasons.join("; ")}`).join(". ")}. Activity and specificity of such a spacer are less predictable.`);
  }
  return {
    count: guides.length,
    tiers,
    together,
    cutSpan: span,
    flagged,
    status,
    detail: sentences.join(" "),
  };
}
