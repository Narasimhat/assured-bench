// One way of naming an exon everywhere in Bench: the exon number of the annotated transcript first (the number used in papers, ClinVar and the Brunello library),
// the coding-exon index (counted from the first exon that has coding sequence) in brackets. Without the annotated number, the coding exon alone.
// A gene whose first exon is untranslated has annotated number = coding index + 1 (SCN5A coding exon 2 is exon 3; TP53 coding exon 4 is exon 5).

/** annotated exon number minus coding-exon index for a design result (null when either is unknown) */
export const exonOffset = (design) => (Number.isFinite(design?.transcriptExon) && Number.isFinite(design?.codingExon) ? design.transcriptExon - design.codingExon : null);

/** "exon 3 (coding exon 2)" or, without an offset, "coding exon 2" */
export function exonLabel(codingExon, offset) {
  if (!Number.isFinite(codingExon)) return "";
  return Number.isFinite(offset) ? `exon ${codingExon + offset} (coding exon ${codingExon})` : `coding exon ${codingExon}`;
}

/** "exons 3, 4, 5 (coding exons 2, 3, 4)" or "coding exons 2, 3, 4" */
export function exonListLabel(codingExons, offset) {
  const list = (codingExons || []).filter(Number.isFinite);
  if (!list.length) return "";
  const coding = `coding exon${list.length === 1 ? "" : "s"} ${list.join(", ")}`;
  return Number.isFinite(offset) ? `exon${list.length === 1 ? "" : "s"} ${list.map(n => n + offset).join(", ")} (${coding})` : coding;
}
