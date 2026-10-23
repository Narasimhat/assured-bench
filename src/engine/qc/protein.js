// Protein consequence of the designed changes. A design says which codons its changes fall in ("p.L177L: CTG -> CTA" in a design report, the same
// labels in the design file); from that the strand and reading frame of the control read are found, every designed change gets its amino-acid
// change, and the figures can translate the control and each clone at the designed codons. Nothing here changes an estimate, a call or a decision.

const AA = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const IDX = { T: 0, C: 1, A: 2, G: 3 };
const COMP = { A: "T", C: "G", G: "C", T: "A", N: "N" };

/** One-letter amino acid of a codon (* = stop, X = unknown). */
export function aaOf(codon) {
  if (!codon || codon.length !== 3) return "X";
  const a = IDX[codon[0]]; const b = IDX[codon[1]]; const c = IDX[codon[2]];
  return a === undefined || b === undefined || c === undefined ? "X" : AA[a * 16 + b * 4 + c];
}

const ARROW = "(?:->|-&gt;|=>|\\u2192|>)";
const WITH_P = new RegExp(`p\\.([A-Z*])(\\d+)([A-Z*=])\\s*:?\\s*\\(?\\s*([ACGT]{3})\\s*${ARROW}\\s*([ACGT]{3})`, "g");
const BARE = new RegExp(`\\b([ACDEFGHIKLMNPQRSTVWY])(\\d{1,5})([ACDEFGHIKLMNPQRSTVWY*])\\s*\\(\\s*([ACGT]{3})\\s*${ARROW}\\s*([ACGT]{3})\\s*\\)`, "g");

/**
 * Codon notes found in text: "p.L177L: CTG -> CTA", "p.L173L CTG>CTC", "R176C (CGC>TGC)". @returns {{ residue, from, to, codonFrom, codonTo }[]}
 */
export function parseProteinNotes(texts) {
  const notes = []; const seen = new Set();
  for (const raw of [].concat(texts || [])) {
    const text = String(raw || "");
    for (const re of [WITH_P, BARE]) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(text))) {
        const from = m[1]; const to = m[3] === "=" ? m[1] : m[3]; const key = `${from}${m[2]}${to}${m[4]}${m[5]}`;
        if (seen.has(key)) continue; seen.add(key);
        notes.push({ residue: Number(m[2]), from, to, codonFrom: m[4], codonTo: m[5] });
      }
    }
  }
  return notes;
}

/** The notes a design file carries itself: its label ("R176C (CGC>TGC)") and its marker labels ("p.L173L" with "CTG>CTC"). */
export function notesFromSpec(spec) {
  const texts = [spec.design && spec.design.label, ...((spec.protein && spec.protein.notes) || []).map((n) => `${n.from}${n.residue}${n.to} (${n.codonFrom}>${n.codonTo})`)];
  (spec.markers || []).forEach((m) => texts.push(`${m.label || ""} ${m.change || ""}`));
  return parseProteinNotes(texts);
}

/** The codon of reference position `pos` for a strand and frame: its index along the coding sense and its three reference positions in coding order. */
export function codonPositions(length, pos, strand, frame) {
  if (strand === "+") {
    const c = Math.floor((pos - frame) / 3); const q = 3 * c + frame;
    return q < 0 || q + 2 >= length ? null : { c, cols: [q, q + 1, q + 2] };
  }
  const q0 = length - 1 - pos; const c = Math.floor((q0 - frame) / 3); const q = 3 * c + frame;
  return q < 0 || q + 2 >= length ? null : { c, cols: [length - 1 - q, length - 2 - q, length - 3 - q] };
}

const baseOf = (reference, pos, strand) => (strand === "+" ? reference[pos] : COMP[reference[pos]] || "N");
const codonOf = (reference, cols, strand) => cols.map((p) => baseOf(reference, p, strand)).join("");

/**
 * Strand and frame of the reference from the codon notes: the notes that agree with the designed markers (the codon in the reference, and the codon
 * after the marker's change, are the ones the note names, and the amino acids follow the genetic code) under one strand and frame, with residue
 * numbers that differ by exactly the codon distance. @returns {{ strand, frame, offset } | null} residue = codon index + offset; null when no frame fits or two fit equally
 */
export function inferProtein(spec, notes) {
  const reference = String((spec.reference && spec.reference.sequence) || "").toUpperCase(); const L = reference.length; const markers = spec.markers || [];
  const usable = (notes || []).filter((n) => n.codonFrom && n.codonTo && aaOf(n.codonFrom) === n.from && aaOf(n.codonTo) === n.to);
  if (!usable.length || !markers.length || !L) return null;
  const candidates = [];
  for (const strand of ["+", "-"]) {
    for (let frame = 0; frame < 3; frame += 1) {
      const hits = [];
      for (const n of usable) for (const m of markers) {
        const cp = codonPositions(L, m.pos, strand, frame); if (!cp) continue;
        if (codonOf(reference, cp.cols, strand) !== n.codonFrom) continue;
        const after = cp.cols.map((p) => (p === m.pos ? (strand === "+" ? m.alt : COMP[m.alt] || "N") : baseOf(reference, p, strand))).join("");
        if (after === n.codonTo) hits.push({ note: n, offset: n.residue - cp.c, c: cp.c });
      }
      if (!hits.length) continue;
      const votes = new Map(); hits.forEach((h) => votes.set(h.offset, (votes.get(h.offset) || 0) + 1));
      const [offset, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      candidates.push({ strand, frame, offset, count, conflicting: hits.length - count, anchor: Math.min(...hits.filter((h) => h.offset === offset).map((h) => h.c)) });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.count - b.conflicting) - (a.count - a.conflicting));
  const top = candidates[0]; const rest = candidates.slice(1);
  if (top.count - top.conflicting <= 0 || rest.some((c) => c.count - c.conflicting === top.count - top.conflicting)) return null;
  return { strand: top.strand, frame: top.frame, offset: top.offset, anchor: top.anchor };
}

/** Codon index of the first stop codon of the reference at or after the codon `from` (null when the reference ends first): what lies beyond it is not coding. */
function cdsEndOf(reference, strand, frame, from) {
  const L = reference.length;
  for (let c = from; c < from + 400; c += 1) {
    const q = 3 * c + frame; const cols = strand === "+" ? [q, q + 1, q + 2] : [L - 1 - q, L - 2 - q, L - 3 - q];
    if (cols.some((p) => p < 0 || p >= L)) return null;
    if (aaOf(codonOf(reference, cols, strand)) === "*") return c;
  }
  return null;
}

/**
 * The design with the protein consequence of each marker: marker.protein = { residue, from, to, codonFrom, codonTo, silent, label }, and spec.protein = { strand, frame,
 * offset, notes }. Returns the spec unchanged when the design names no codons or no frame fits; never throws.
 */
export function annotateSpecProtein(spec, extraNotes = []) {
  try {
    if (!spec || !spec.reference || !spec.markers || !spec.markers.length) return spec;
    const known = new Map(); [...extraNotes, ...notesFromSpec(spec)].forEach((n) => known.set(`${n.from}${n.residue}${n.to}${n.codonFrom}${n.codonTo}`, n));
    const notes = [...known.values()]; const found = inferProtein(spec, notes); if (!found) return spec;
    const reference = spec.reference.sequence.toUpperCase(); const L = reference.length; const end = cdsEndOf(reference, found.strand, found.frame, found.anchor);
    const markers = spec.markers.map((m) => {
      if (/non-?coding|intron|utr/i.test(m.label || "")) return m;
      const cp = codonPositions(L, m.pos, found.strand, found.frame); if (!cp || (end !== null && cp.c > end)) return m;
      const codonFrom = codonOf(reference, cp.cols, found.strand);
      const codonTo = cp.cols.map((p) => (p === m.pos ? (found.strand === "+" ? m.alt : COMP[m.alt] || "N") : baseOf(reference, p, found.strand))).join("");
      const from = aaOf(codonFrom); const to = aaOf(codonTo); const residue = cp.c + found.offset;
      return { ...m, protein: { residue, from, to, codonFrom, codonTo, silent: from === to, label: `${from}${residue}${to}` } };
    });
    return { ...spec, markers, protein: { strand: found.strand, frame: found.frame, offset: found.offset, cdsEnd: end, notes } };
  } catch (error) { return spec; }
}

/** The codons of the stretch of the reference read from `first` to `last` (reference positions), each with its reference positions in coding order and its amino acid. */
export function codonsOf(spec, first, last) {
  const p = spec && spec.protein; if (!p) return [];
  const reference = spec.reference.sequence.toUpperCase(); const L = reference.length; const out = []; const seen = new Set();
  for (let pos = Math.max(0, first); pos <= Math.min(L - 1, last); pos += 1) {
    const cp = codonPositions(L, pos, p.strand, p.frame); if (!cp || seen.has(cp.c) || (p.cdsEnd !== null && p.cdsEnd !== undefined && cp.c > p.cdsEnd)) continue; seen.add(cp.c);
    if (cp.cols.some((x) => x < first || x > last)) continue;
    out.push({ c: cp.c, residue: cp.c + p.offset, cols: cp.cols, codon: codonOf(reference, cp.cols, p.strand), aa: aaOf(codonOf(reference, cp.cols, p.strand)) });
  }
  return out;
}
