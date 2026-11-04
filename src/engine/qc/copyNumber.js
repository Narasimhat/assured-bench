// A locus with one copy per cell (an X-linked gene in a male line, or any hemizygous region): a clone can carry one allele only, so a trace with two real alleles is a
// mixed clone (it grew from more than one cell, or the cell has an extra copy), never a heterozygous one. Set options.copyNumber = 1 (or spec.design.copyNumber = 1).
import { alleleName } from "./genotype.js";

export const copyNumberOf = (options, spec) => (Number(options?.copyNumber ?? spec?.design?.copyNumber ?? 2) === 1 ? 1 : 2);

const ONE_COPY_FLAG = "One copy of this locus per cell, so two alleles in one trace mean the clone grew from more than one cell (or the cell has an extra copy): re-single-cell or re-pick the clone; reading it again will not change this.";
const HETEROZYGOUS_FLAG = /heterozygous call assumes|cannot tell homozygous from hemizygous|Three or more alleles above the floor/;
const percent = (a) => `${Math.round(a.fraction * 100)}%`;

/**
 * The genotype call for a locus with `copyNumber` copies. Two copies (the default) change nothing.
 *  - one allele: hemizygous (the same call, worded for one copy);
 *  - two or more real alleles: a mixed clone, unless every fitted allele is an intended-edit allele and every designed change reads at 90% or more, which is one allele carrying all
 *    the designed changes (the fit splits it between library alleles that differ only in their blocking changes; phase cannot be read from a Sanger trace).
 */
export function withCopyNumber(genotype, { copyNumber = 2, markerReadout = [] } = {}) {
  if (!genotype || copyNumber !== 1) return genotype;
  const original = { category: genotype.category, call: genotype.call, summary: genotype.summary };
  const flags = (genotype.flags || []).filter((f) => !HETEROZYGOUS_FLAG.test(f));
  if (genotype.call === "homozygous") {
    return { ...genotype, copyNumber: 1, original, summary: genotype.summary.replace(/^Homozygous/, "Hemizygous"), flags: [...flags, "One copy of this locus per cell: a single allele is the expected result."] };
  }
  const alleles = genotype.alleles || [];
  if (!alleles.length) return { ...genotype, copyNumber: 1, original };
  const designed = markerReadout.filter((row) => row.covered && row.marker && (row.marker.role === "intended" || row.marker.role === "blocking"));
  if (designed.length && alleles.every((a) => a.kind === "edit") && designed.every((row) => (row.altNet ?? 0) >= 0.9)) {
    return {
      ...genotype, copyNumber: 1, singleAllele: true, original, call: "homozygous", category: "homozygous_edit", alleles: [alleles[0]],
      summary: "Hemizygous for the intended edit, carrying every designed change",
      flags: [...flags, `The fit split the signal between ${alleles.length} library alleles that differ only in which blocking changes they carry, but every designed change reads at 90% or more, so one allele carrying all of them explains the trace. Check the phase by sequencing if it matters.`],
    };
  }
  const names = alleles.slice(0, 3).map(alleleName);
  const distinct = new Set(names).size === names.length; // two indel alleles can share a description: then the library label tells them apart
  const named = alleles.slice(0, 3).map((a, i) => `${distinct ? names[i] : (a.label || names[i])} ${percent(a)}`).join(", ");
  return { ...genotype, copyNumber: 1, mixedClone: true, original, call: "unclear", category: "mixed", summary: `Mixed clone at a one-copy locus: ${named}`, flags: [...flags, ONE_COPY_FLAG] };
}
