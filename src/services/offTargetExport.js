/**
 * Cas-OFFinder input for the guides of a design.
 *
 * Bench does not search a genome for off-targets: that needs the genome and a search that runs for minutes. This builds the input file for Cas-OFFinder
 * (Bae et al. 2014, https://github.com/snugel/cas-offinder) so the search can be run against the genome of the cell line. Format: line 1 the genome
 * (directory of chromosome FASTA files or a FASTA file), line 2 the target pattern (N for the spacer, then the PAM), then one line per guide with the
 * spacer, N for each PAM position, and the largest number of mismatches to report.
 */
import { getEnzyme } from "../engine/design/enzymeConfig.js";

export const CAS_OFFINDER_GENOME_PLACEHOLDER = "/path/to/genome_fasta_directory";

export function buildCasOffinderInput(designResult, { mismatches = 3, genomePath = CAS_OFFINDER_GENOME_PLACEHOLDER } = {}) {
  const guides = (designResult?.gs || []).filter(g => /^[ACGT]+$/i.test(String(g.sp || "")));
  if (!guides.length) return { ok: false, error: "The design has no guides." };
  let enzyme;
  try { enzyme = getEnzyme(designResult.enzyme || "spcas9"); } catch (error) { return { ok: false, error: error.message }; }
  if (enzyme.pam_side !== "3prime") return { ok: false, error: `${enzyme.name} has its PAM on the 5′ side; Cas-OFFinder input for it is not generated here.` };
  const pam = enzyme.pam_pattern;
  const spacerLength = guides[0].sp.length;
  if (guides.some(g => g.sp.length !== spacerLength)) return { ok: false, error: "The guides have different spacer lengths." };
  const lines = [genomePath, `${"N".repeat(spacerLength)}${pam}`, ...guides.map(g => `${g.sp.toUpperCase()}${"N".repeat(pam.length)} ${mismatches}`)];
  const names = guides.map((g, i) => `${g.sp.toUpperCase()}\t${designResult.gene ? `${designResult.gene}_gRNA${i + 1}` : `gRNA${i + 1}`}`);
  return {
    ok: true,
    text: `${lines.join("\n")}\n`,
    guideNames: names,
    mismatches,
    enzyme: enzyme.name,
    run: "cas-offinder input.txt C output.txt   (C = CPU, G = GPU); edit line 1 to the genome of your line first.",
    notes: [
      "Search the genome of the cell line used, not only the reference: private variants can create or remove off-target sites.",
      "Report the number of sites at 0, 1, 2 and 3 mismatches per guide, and which fall in exons or in regulatory sequence of genes that matter for the model.",
      "Bench did not run this search. Until it is run, off-target specificity is not assessed.",
    ],
  };
}
