import { findEnzymeGuides } from "./enzymeGuides.js";
import { getEnzyme } from "./enzymeConfig.js";

export function guideGeometry(guide) {
  const config = getEnzyme(guide.enzyme || "spcas9");
  const length = guide.sp?.length || guide.spacer?.length || config.spacer_len.default;
  const pamLength = config.pam_pattern.length;
  const start = guide.ps ?? guide.start ?? (guide.str === "-" ? guide.cut - 6 : guide.cut - 17);
  const plus = (guide.str || guide.strand) !== "-";
  const pamFirst = (config.pam_side === "5prime") === plus;
  return { start, end: start + length + pamLength,
    spacerStart: guide.spacer_start ?? start + (pamFirst ? pamLength : 0),
    spacerEnd: guide.spacer_end ?? start + (pamFirst ? pamLength : 0) + length,
    pamStart: guide.pam_start ?? start + (pamFirst ? 0 : length),
    pamEnd: guide.pam_end ?? start + (pamFirst ? 0 : length) + pamLength };
}

/** Native Cas9 selection policy: composition is a tie-break/observation, not a 40–60% gate. */
export function findConfiguredModelGuides(model, target, range = 50, options = {}) {
  const enzyme = options.enzyme || "spcas9";
  const config = getEnzyme(enzyme);
  const length = options.spacerLength || config.spacer_len.default;
  const seq = model.genomicSequence;
  const span = length + config.pam_pattern.length;
  const start = Math.max(0, target - range - span);
  const end = Math.min(seq.length, target + range + span);
  if (start > end) return [];
  return findEnzymeGuides(seq, { enzyme, spacerLength: length, start, end })
    .filter(guide => !guide.spacer.includes("TTTTT") && !guide.spacer.includes("AAAAA"))
    .map(guide => {
      const signed = Object.values(guide.cuts).map(cut => cut - target).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      return { ...guide, sp: guide.spacer, pam: guide.pam, str: guide.strand, ps: guide.start,
        cut: guide.cuts.target, d: signed, gc: Math.round(guide.gc),
        cutDistanceBasis: "nearest predicted strand cut; cut is the target-strand boundary" };
    }).filter(guide => Math.abs(guide.d) <= range);
}
