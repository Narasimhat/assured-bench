// Clone genotype call from the decomposition. A clone is one genotype, so its trace is a mixture of at most two
// alleles (plus noise); a pool is not called.
//
// Rules (all thresholds are options, shown in the report):
//   one allele >= homozygousMin                 -> homozygous (or hemizygous: Sanger cannot see a large deletion on the other allele)
//   two alleles, each >= minorMin, together >= twoAlleleMin  -> heterozygous / compound heterozygous
//   anything else                               -> mixed or unclear (polyclonal, three alleles, or a poor trace)

export const GENOTYPE_DEFAULTS = { homozygousMin: 0.85, minorMin: 0.25, twoAlleleMin: 0.85, noiseFloor: 0.05 };

const KIND_WORDS = { wt: "wild type", edit: "intended edit", edit_partial: "partial conversion", indel: "indel", deletion_between_cuts: "deletion between the cuts" };

function alleleName(contribution) {
  if (contribution.kind === "wt") return "wild type";
  if (contribution.kind === "edit") return "intended edit";
  if (contribution.kind === "edit_partial") return contribution.label.replace(/^Partial conversion: /, "partial conversion: ");
  if (contribution.kind === "deletion_between_cuts") return contribution.label.toLowerCase();
  if (contribution.kind === "edit_indel") return `intended edit carrying a ${contribution.size > 0 ? "+" : ""}${contribution.size} bp indel`;
  return `${contribution.size > 0 ? "+" : ""}${contribution.size} bp indel`;
}

export function callGenotype(decomposition, options = {}) {
  const opt = { ...GENOTYPE_DEFAULTS, ...options };
  const alleles = decomposition.contributions.filter((c) => c.fraction >= opt.noiseFloor);
  const top = alleles[0];
  const flags = [];
  if (!top) return { call: "unclear", summary: "No allele reaches the detection floor.", alleles: [], flags: ["Nothing above the noise floor."], category: "unclear" };
  const intendedPresent = alleles.some((a) => a.kind === "edit");
  const partialPresent = alleles.some((a) => a.kind === "edit_partial");
  const withIndel = alleles.some((a) => a.kind === "indel" || a.kind === "deletion_between_cuts" || a.kind === "edit_indel");
  if (top.fraction >= opt.homozygousMin) {
    flags.push("Sanger traces cannot tell homozygous from hemizygous: a large deletion on the other allele would not appear.");
    const category = top.kind === "wt" ? "homozygous_wt" : top.kind === "edit" ? "homozygous_edit" : top.kind === "edit_partial" ? "homozygous_partial" : top.kind === "edit_indel" ? "homozygous_edit_indel" : "homozygous_indel";
    const verdict = { homozygous_wt: "Homozygous wild type (no edit detected)", homozygous_edit: "Homozygous for the intended edit", homozygous_partial: "Homozygous for a partial conversion (blocking changes present, intended edit not complete)", homozygous_edit_indel: `Homozygous for ${alleleName(top)}`, homozygous_indel: `Homozygous for ${alleleName(top)}` }[category];
    return { call: "homozygous", category, summary: verdict, alleles: [top], flags };
  }
  const second = alleles[1];
  if (second && top.fraction >= opt.minorMin && second.fraction >= opt.minorMin && top.fraction + second.fraction >= opt.twoAlleleMin) {
    const kinds = new Set([top.kind, second.kind]);
    let category = "compound_heterozygous"; let verdict;
    if (kinds.has("wt") && kinds.has("edit")) { category = "heterozygous_edit"; verdict = "Heterozygous: intended edit on one allele, wild type on the other"; }
    else if (kinds.has("edit") && kinds.has("edit_partial")) { category = "edit_plus_partial"; verdict = "Intended edit on one allele, partial conversion (blocking changes without the full edit) on the other"; }
    else if (kinds.has("edit") && (kinds.has("indel") || kinds.has("deletion_between_cuts") || kinds.has("edit_indel"))) { category = "edit_plus_indel"; verdict = `Intended edit on one allele, ${alleleName(top.kind === "edit" ? second : top)} on the other`; }
    else if (kinds.has("wt")) { category = "heterozygous_indel"; verdict = `Heterozygous: ${alleleName(top.kind === "wt" ? second : top)} and wild type`; }
    else if (top.kind === second.kind && top.kind === "edit_partial") { category = "two_partials"; verdict = "Two different partial conversions"; }
    else verdict = `Compound heterozygous: ${alleleName(top)} and ${alleleName(second)}`;
    flags.push("A heterozygous call assumes the two alleles are the only ones; a large deletion on one allele cannot be excluded from the trace.");
    if (partialPresent && !intendedPresent) flags.push("No allele carries the complete intended edit.");
    return { call: "two alleles", category, summary: verdict, alleles: [top, second], flags };
  }
  if (withIndel || partialPresent) flags.push("Three or more alleles above the floor, or no clear major allele: the sample may be polyclonal (re-streak or re-single-cell) or the trace may be poor.");
  return { call: "unclear", category: "mixed", summary: "Mixed or unclear: more than two alleles, or no clear major allele", alleles: alleles.slice(0, 4), flags };
}
