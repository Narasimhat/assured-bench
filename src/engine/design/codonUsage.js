// Human codon usage, used to choose *which* synonymous codon a blocking mutation installs.
//
// The engine previously took the first synonymous base in ["A","C","G","T"] order, which is
// arbitrary: it could swap a common codon for a rare one for no reason. A silent change is
// silent at the protein level, not at the translation level - a rare codon can slow or stall
// the ribosome, and stacking two or three of them (which multi-mutation blocking now does)
// compounds it.
//
// Fractions are per amino acid and sum to 1 within each family. Source: Kazusa Homo sapiens
// codon usage table (GenBank-derived), the values in common use by IDT, Benchling and GenScript.
// They are a guide, not a hard constraint - see RARE_CODON_FLOOR.

export const HUMAN_CODON_FRACTION = Object.freeze({
  // Phe            Leu
  TTT: 0.45, TTC: 0.55, TTA: 0.07, TTG: 0.13,
  CTT: 0.13, CTC: 0.20, CTA: 0.07, CTG: 0.41,
  // Ile                          Met
  ATT: 0.36, ATC: 0.48, ATA: 0.16, ATG: 1.00,
  // Val
  GTT: 0.18, GTC: 0.24, GTA: 0.11, GTG: 0.47,
  // Ser (six-fold, split across TCN and AGY)
  TCT: 0.18, TCC: 0.22, TCA: 0.15, TCG: 0.06, AGT: 0.15, AGC: 0.24,
  // Pro
  CCT: 0.28, CCC: 0.33, CCA: 0.27, CCG: 0.11,
  // Thr
  ACT: 0.24, ACC: 0.36, ACA: 0.28, ACG: 0.12,
  // Ala
  GCT: 0.26, GCC: 0.40, GCA: 0.23, GCG: 0.11,
  // Tyr                Stop
  TAT: 0.43, TAC: 0.57, TAA: 0.30, TAG: 0.24, TGA: 0.47,
  // His                Gln
  CAT: 0.41, CAC: 0.59, CAA: 0.25, CAG: 0.75,
  // Asn                Lys
  AAT: 0.46, AAC: 0.54, AAA: 0.42, AAG: 0.58,
  // Asp                Glu
  GAT: 0.46, GAC: 0.54, GAA: 0.42, GAG: 0.58,
  // Cys                Trp
  TGT: 0.45, TGC: 0.55, TGG: 1.00,
  // Arg (six-fold, split across CGN and AGR)
  CGT: 0.08, CGC: 0.19, CGA: 0.11, CGG: 0.21, AGA: 0.20, AGG: 0.20,
  // Gly
  GGT: 0.16, GGC: 0.34, GGA: 0.25, GGG: 0.25,
});

/**
 * Do not install a synonymous codon used less than this often within its family.
 *
 * 0.10 excludes the genuinely rare human codons (CGT 0.08, TTA 0.07, CTA 0.07, TCG 0.06)
 * while leaving every family at least one alternative. It is a floor, not a preference: the
 * chooser still ranks by usage above it.
 */
export const RARE_CODON_FLOOR = 0.10;

export function getCodonFraction(codon) {
  const key = String(codon || "").toUpperCase();
  return Object.prototype.hasOwnProperty.call(HUMAN_CODON_FRACTION, key)
    ? HUMAN_CODON_FRACTION[key]
    : 0;
}

/** True when swapping `fromCodon` for `toCodon` moves into a rare codon it did not start in. */
export function introducesRareCodon(fromCodon, toCodon) {
  const to = getCodonFraction(toCodon);
  if (to >= RARE_CODON_FLOOR) return false;
  // Already rare and not getting worse is not a new problem this change introduced.
  return to < getCodonFraction(fromCodon);
}

/**
 * Rank synonymous candidates: preferred codons first, and never reorder into a rare one.
 * Returns a copy sorted best-first.
 */
export function rankByCodonUsage(candidates, getCodon) {
  return [...candidates].sort((left, right) => getCodonFraction(getCodon(right)) - getCodonFraction(getCodon(left)));
}
