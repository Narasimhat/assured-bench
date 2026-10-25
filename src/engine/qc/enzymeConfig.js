// Config versions describe computational assumptions, not experimental validation.
export const ENZYME_CONFIG_VERSION = "1.2.0";
const defaults = { gc_min: 40, gc_max: 60, max_homopolymer: 4, self_complement_length: 6 };
const entries = [
  { id: "spcas9", name: "SpCas9", pam_pattern: "NGG", pam_side: "3prime",
    spacer_len: { default: 20, min: 20, max: 20 }, direct_repeat: null, direct_repeat_position: "3prime",
    cut_offsets: { target: 17, non_target: 17 }, seed_length: 10, scoring_model: "spcas9-external",
    license_note: "", repeat_note: "Requires an sgRNA scaffold or a separate tracrRNA; spacer alone is not a full sgRNA." },
  { id: "spcas9ng", name: "SpCas9-NG", pam_pattern: "NG", pam_side: "3prime",
    spacer_len: { default: 20, min: 20, max: 20 }, direct_repeat: null, direct_repeat_position: "3prime",
    cut_offsets: { target: 17, non_target: 17 }, seed_length: 10, scoring_model: "spcas9ng-external",
    license_note: "", repeat_note: "Requires an SpCas9-compatible sgRNA scaffold or tracrRNA; spacer alone is not a full guide.",
    design_note: "Relaxed NG PAM. Activity and re-cutting scores are not calibrated for SpCas9-NG.",
    source: "https://doi.org/10.1126/science.aas9129" },
  { id: "sacas9", name: "SaCas9", pam_pattern: "NNGRRT", pam_side: "3prime",
    spacer_len: { default: 21, min: 21, max: 21 }, direct_repeat: null, direct_repeat_position: "3prime",
    cut_offsets: { target: 18, non_target: 18 }, seed_length: 10, scoring_model: "sacas9-external",
    license_note: "", repeat_note: "Requires an SaCas9-specific sgRNA scaffold or tracrRNA; do not substitute an SpCas9 scaffold.",
    design_note: "Uses a 21 nt spacer and nominal cut 3 nt before the PAM. Activity and re-cutting scores are not calibrated for SaCas9.",
    source: "https://doi.org/10.1038/nature14299" },
  { id: "spry", name: "SpRY", pam_pattern: "NNN", pam_side: "3prime",
    spacer_len: { default: 20, min: 20, max: 20 }, direct_repeat: null, direct_repeat_position: "3prime",
    cut_offsets: { target: 17, non_target: 17 }, seed_length: 10, scoring_model: "spry-external",
    license_note: "", repeat_note: "Requires an SpCas9-compatible sgRNA scaffold or tracrRNA; spacer alone is not a full guide.",
    design_note: "Near-PAMless search includes NNN sites; NRN and NYN activities differ. A PAM-only mutation is not accepted as re-cutting protection. Seed changes remain unscored and require review.",
    source: "https://doi.org/10.1126/science.aba8853" },
  { id: "ascas12a", name: "AsCas12a", pam_pattern: "TTTV", pam_side: "5prime",
    spacer_len: { default: 23, min: 20, max: 24 }, direct_repeat: "UAAUUUCUACUCUUGUAGAU", direct_repeat_position: "5prime",
    cut_offsets: { target: 23, non_target: 18 }, seed_length: 8, scoring_model: "deepcpf1-external",
    license_note: "", repeat_note: "Mature AsCas12a repeat; verify against the nuclease and delivery reagent documentation before ordering." },
  { id: "lbcas12a", name: "LbCas12a", pam_pattern: "TTTV", pam_side: "5prime",
    spacer_len: { default: 23, min: 20, max: 24 }, direct_repeat: null, direct_repeat_position: "5prime",
    cut_offsets: { target: 23, non_target: 18 }, seed_length: 8, scoring_model: "lbcas12a-external",
    license_note: "", repeat_note: "Supply and verify the LbCas12a direct repeat against your nuclease and delivery reagent documentation. Cut offsets are nominal Cas12a assumptions." },
  { id: "mad7", name: "Mad7", pam_pattern: "YTTN", pam_side: "5prime",
    spacer_len: { default: 23, min: 20, max: 24 }, direct_repeat: null, direct_repeat_position: "5prime",
    cut_offsets: { target: 23, non_target: 18 }, seed_length: 8, scoring_model: "deepcpf1-external",
    license_note: "Mad7 use may be subject to Inscripta license terms. Confirm current terms and the direct repeat against your licensed documentation.",
    repeat_note: "No licensed Mad7 direct repeat has been verified or bundled. Supply the repeat and its documentation reference.",
  },
];
export const ENZYMES = Object.freeze(Object.fromEntries(entries.map(entry => [entry.id, Object.freeze({
  ...entry, spacer_len: Object.freeze(entry.spacer_len), cut_offsets: Object.freeze(entry.cut_offsets),
  filters: Object.freeze({ ...defaults }), version: ENZYME_CONFIG_VERSION,
})])));
export function getEnzyme(id = "spcas9") {
  if (!Object.hasOwn(ENZYMES, id)) throw new Error(`Unknown enzyme: ${id}`);
  return ENZYMES[id];
}
const IUPAC = { A: "A", C: "C", G: "G", T: "T", R: "[AG]", Y: "[CT]", S: "[GC]", W: "[AT]", K: "[GT]", M: "[AC]", B: "[CGT]", D: "[AGT]", H: "[ACT]", V: "[ACG]", N: "[ACGT]" };
export function pamRegex(pattern) {
  if (!pattern || [...pattern].some(base => !IUPAC[base])) throw new Error("Invalid IUPAC PAM pattern.");
  return new RegExp(`^(?:${[...pattern].map(base => IUPAC[base]).join("")})$`);
}
