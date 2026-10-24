// Config versions describe computational assumptions, not experimental validation.
export const ENZYME_CONFIG_VERSION = "1.1.0";
const defaults = { gc_min: 40, gc_max: 60, max_homopolymer: 4, self_complement_length: 6 };
const entries = [
  { id: "spcas9", name: "SpCas9", pam_pattern: "NGG", pam_side: "3prime",
    spacer_len: { default: 20, min: 20, max: 20 }, direct_repeat: null, direct_repeat_position: "3prime",
    cut_offsets: { target: 17, non_target: 17 }, seed_length: 10, scoring_model: "spcas9-external",
    license_note: "", repeat_note: "Requires an sgRNA scaffold or a separate tracrRNA; spacer alone is not a full sgRNA." },
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
