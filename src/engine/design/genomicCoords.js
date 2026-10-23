// Coordinates of a Genomic SNP reference.
//
// A reference record is read from index 0 along its own sequence. For a forward record that runs along the forward genomic strand, so the genomic
// coordinate of index i is referenceStart + i. A record of a reverse-strand gene is written 5'->3' along the transcript (the Ensembl and Benchling
// convention, "Location: ...:-1"): it is the reverse complement of the interval, so index i is genomic coordinate referenceEnd - i, and an allele
// that reads X on the forward strand reads the complement of X in the record. Everything the designers compute (guides, donors, blocking changes,
// splice windows, primers) is in record space; only what is shown to the user or handed to another tool is converted with these functions.
//
// A leaf module (no imports).

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", N: "N" };

export const isReverse = (frame) => Number(frame?.orientation) === -1;

/** Complement of a base, or of every base of a string (not reversed). */
export const complementBase = (base) => String(base ?? "").toUpperCase().split("").map((b) => COMPLEMENT[b] || "N").join("");

/** 1-based forward-strand genomic coordinate of record index i. `frame` is { referenceStart, referenceEnd, orientation }. */
export const genomicAt = (frame, index) => (isReverse(frame) ? Number(frame.referenceEnd) - index : Number(frame.referenceStart) + index);

/** Record index of a forward-strand genomic coordinate (may lie outside the record). */
export const indexOfGenomic = (frame, position) => (isReverse(frame) ? Number(frame.referenceEnd) - position : position - Number(frame.referenceStart));

/** Ascending [low, high] genomic coordinates covered by the record indices first..last (inclusive). */
export const genomicSpan = (frame, first, last) => {
  const a = genomicAt(frame, first); const b = genomicAt(frame, last);
  return a <= b ? [a, b] : [b, a];
};

/** A base as it reads in the other frame: the forward-strand base for a record base, or the record base for a forward-strand base (the same complement). */
export const otherStrandBase = (frame, base) => (isReverse(frame) ? complementBase(base) : String(base ?? "").toUpperCase());

/** First record index at or after `from` whose genomic coordinate is a multiple of `step`, for axis ticks that run left to right through the record. */
export const firstTickIndex = (frame, from, step) => {
  if (isReverse(frame)) return from + ((((Number(frame.referenceEnd) - from) % step) + step) % step);
  return Math.ceil((from + Number(frame.referenceStart)) / step) * step - Number(frame.referenceStart);
};
