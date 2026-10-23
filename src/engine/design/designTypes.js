// The one list of design types the tool supports.
//
// This used to exist twice: once in editionConfig.js, edition-filtered, driving the UI, and
// once privately in reportHtml.js. The report needed its own copy because a filtered list
// made it fall back to entry [0] and label a tagging design "SNP knock-in". Deleting the
// community edition removes the reason for the split, so the two lists become one and can
// no longer drift.
//
// Keep this module free of Vite-only globals (import.meta.env) so it stays loadable under
// `node --test`.
export const DESIGN_TYPES = Object.freeze([
  { id: "pm", label: "Point mutation", short: "SNP / amino-acid change" },
  { id: "ko", label: "Knockout", short: "Frameshift knockout" },
  { id: "it", label: "Internal in-frame tag", short: "ssODN insert within CDS" },
  { id: "ct", label: "C-terminal tag / reporter", short: "HDR insert at stop" },
  { id: "nt", label: "N-terminal tag / reporter", short: "HDR insert at ATG" },
].map(Object.freeze));

export const DESIGN_TYPE_IDS = Object.freeze(DESIGN_TYPES.map((entry) => entry.id));
