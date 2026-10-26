// Does each cut lie inside the coding sequence of every annotated protein-coding transcript? Counted per cut, against two annotation sets
// (RefSeq NM_ transcripts, from the isoform analysis; Ensembl protein-coding transcripts), with the transcripts that do not contain the cut named.
//
// This replaces judging an exon by "shared isoforms": an exon can be shared by every transcript while a cut inside it falls upstream of the start codon of a
// shorter protein (TP53 delta-133 isoforms start inside exon 5), and the two annotation sets disagree about how many transcripts exist.

import { cdsToGenomic } from "../engine/design/geneFetch.js";
import { genomicFrameOfRecord } from "./variantScreen.js";

export const ENSEMBL_REST = "https://rest.ensembl.org";

/** Ensembl protein-coding transcripts of a gene with their coding segments: [{ id, name, canonical, segs: [[start, end], ...] }] (GRCh38, 1-based inclusive). */
export async function fetchEnsemblCodingTranscripts(symbol, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== "function") return { ok: false, error: "no network access" };
  try {
    const url = `${ENSEMBL_REST}/lookup/symbol/homo_sapiens/${encodeURIComponent(String(symbol).trim())}?expand=1;content-type=application/json`;
    const response = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(15000) });
    if (!response?.ok) return { ok: false, error: `Ensembl answered HTTP ${response?.status ?? "none"}` };
    const gene = await response.json();
    const transcripts = (gene.Transcript || []).filter((t) => t.biotype === "protein_coding" && t.Translation).map((t) => {
      const { start, end } = t.Translation; const segs = [];
      for (const exon of [...(t.Exon || [])].sort((a, b) => a.start - b.start)) { const a = Math.max(exon.start, start); const b = Math.min(exon.end, end); if (a <= b) segs.push([a, b]); }
      return { id: t.id, name: t.display_name || t.id, canonical: Boolean(t.is_canonical), segs };
    });
    if (!transcripts.length) return { ok: false, error: `Ensembl lists no protein-coding transcript for ${symbol}` };
    return { ok: true, source: "Ensembl REST (GRCh38, protein-coding transcripts with a translation)", ensemblId: gene.id, strand: gene.strand, transcripts };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** The genomic coordinate of a position `offset` bases into coding exon `exonIndex` (0-based) of the analysed reference, or null. Needs the genomic block of an NCBI-based isoform analysis. */
export function genomicPositionOfCut(isoformAnalysis, exonIndex, offset) {
  const g = isoformAnalysis?.genomic; const exon = g?.exons?.[exonIndex];
  if (!exon || !Number.isFinite(offset)) return null;
  return g.strand === -1 ? exon[1] - offset : exon[0] + offset;
}

/** NCBI RefSeq NM_ coding transcripts of a gene with their coding segments (GRCh38, 1-based inclusive): { ok, transcripts: [{ id, name, segs }] }. */
export async function fetchRefseqCodingTranscripts(symbol, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== "function") return { ok: false, error: "no network access" };
  try {
    const url = `https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/${encodeURIComponent(String(symbol).trim())}/taxon/9606/product_report`;
    const response = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(10000) });
    if (!response?.ok) return { ok: false, error: `NCBI Datasets answered HTTP ${response?.status ?? "none"}` };
    const product = (await response.json())?.reports?.[0]?.product;
    const located = (t) => (t.genomic_locations || []).find((l) => /^NC_/.test(l.genomic_accession_version || ""));
    const transcripts = (product?.transcripts || []).filter((t) => t.cds?.range?.length && located(t) && /^NM_/.test(t.accession_version)).map((t) => {
      const loc = located(t); const orient = loc.genomic_range?.orientation === "minus" ? -1 : 1;
      return { id: t.accession_version, name: t.accession_version, segs: cdsToGenomic(loc.exons.map((e) => [Number(e.begin), Number(e.end)]), orient, Number(t.cds.range[0].begin), Number(t.cds.range[t.cds.range.length - 1].end)) };
    });
    return transcripts.length ? { ok: true, source: "NCBI RefSeq (NM_ coding transcripts)", transcripts } : { ok: false, error: `NCBI lists no coding RefSeq transcript for ${symbol}` };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Maps a position of the analysed reference (record index of a cut) to a GRCh38 coordinate. Two bases, in this order:
 *  1. the NCBI-based isoform analysis, which pairs each coding exon of the record with its genomic exon;
 *  2. the coordinates the record states, accepted only when the record's coding segments, placed on the genome that way, coincide with the coding segments of an Ensembl transcript
 *     (that agreement also settles the orientation when the record does not state its strand).
 * Returns { basis, toGenomic(cut) } or { basis: null, reason, toGenomic: () => null }.
 */
export function makeCutMapper({ isoformAnalysis, model, genbankRaw, ensembl }) {
  const segments = model?.cdsSegments || [];
  const g = isoformAnalysis?.genomic;
  if (g && g.exons?.length === segments.length) {
    return { basis: "isoform analysis (NCBI Datasets exon coordinates)", toGenomic(cut) {
      const idx = segments.findIndex(([a, b]) => a < cut && cut < b);
      return idx < 0 ? null : genomicPositionOfCut(isoformAnalysis, idx, cut - segments[idx][0]);
    } };
  }
  const frame = genomicFrameOfRecord(genbankRaw);
  if (frame.reason) return { basis: null, reason: frame.reason, toGenomic: () => null };
  if (!ensembl?.ok) return { basis: null, reason: "the record's coordinates could not be checked without the Ensembl transcripts", toGenomic: () => null };
  const length = (model.genomicSequence || "").length;
  for (const orientation of frame.orientations) {
    const coordOf = (index) => (orientation === 1 ? frame.start + index : (frame.end != null ? frame.end - index : frame.start + length - 1 - index));
    const mapped = segments.map(([s, e]) => { const x = coordOf(s); const y = coordOf(e - 1); return [Math.min(x, y), Math.max(x, y)]; }).sort((p, q) => p[0] - q[0]);
    const agrees = ensembl.transcripts.some((t) => t.segs.length === mapped.length && t.segs.every((seg, i) => Math.abs(seg[0] - mapped[i][0]) <= 1 && Math.abs(seg[1] - mapped[i][1]) <= 1));
    if (agrees) return { basis: `coordinates stated in the record (${frame.basis}), checked against the coding segments of an Ensembl transcript`, toGenomic: (cut) => coordOf(cut) };
  }
  return { basis: null, reason: "the record's stated coordinates do not reproduce the coding segments of any Ensembl transcript", toGenomic: () => null };
}

/** { covered, total, missing: [names] } for one genomic cut against a transcript list. A cut is covered when it lies inside a coding segment. */
export function coverageAtCut(transcripts, position) {
  const missing = transcripts.filter((t) => !t.segs.some(([a, b]) => Math.min(a, b) <= position && position <= Math.max(a, b))).map((t) => t.name || t.id);
  return { covered: transcripts.length - missing.length, total: transcripts.length, missing };
}

/**
 * Cut-level coverage for the guides of a design. `cuts` = [{ label, spacer, genomicCut }]; `refseq` is a transcript list or null; `ensembl` is the result of fetchEnsemblCodingTranscripts or null.
 * Returns { ok, guides: [{ label, spacer, genomicCut, refseq: {covered,total,missing}|null, ensembl: ...|null }], sources, notes }.
 */
export function summariseCutCoverage({ cuts, refseq = null, ensembl = null, basis = null, notes = [] }) {
  const all = [...notes];
  if (!refseq) all.push("RefSeq: coding segments of the NM_ transcripts were not available.");
  if (!ensembl?.ok) all.push(`Ensembl: not retrieved${ensembl?.error ? ` (${ensembl.error})` : ""}.`);
  const guides = (cuts || []).map((c) => ({ label: c.label, spacer: c.spacer, genomicCut: c.genomicCut,
    refseq: refseq && c.genomicCut != null ? coverageAtCut(refseq, c.genomicCut) : null,
    ensembl: ensembl?.ok && c.genomicCut != null ? coverageAtCut(ensembl.transcripts, c.genomicCut) : null }));
  if (guides.some((g) => g.genomicCut == null)) all.push("The genomic position of a cut could not be derived, so it was not checked.");
  return { ok: guides.some((g) => g.refseq || g.ensembl), guides, basis, sources: { refseq: refseq ? `NCBI RefSeq (${refseq.length} NM_ coding transcripts)` : null, ensembl: ensembl?.ok ? `Ensembl (${ensembl.transcripts.length} protein-coding transcripts)` : null }, notes: all };
}

export function describeCutCoverage(coverage) {
  if (!coverage?.ok) return coverage ? [`Isoform coverage of the cuts: not assessed. ${(coverage.notes || []).join(" ")}`.trim()] : [];
  const part = (name, c) => (c ? `${name} ${c.covered}/${c.total}${c.missing.length ? ` (not covered: ${c.missing.join(", ")})` : ""}` : null);
  return [
    ...coverage.guides.map((g) => `${g.label}: cut inside the coding sequence of ${[part("RefSeq", g.refseq), part("Ensembl", g.ensembl)].filter(Boolean).join("; ")} transcripts.`),
    "A transcript that does not contain the cut can still make protein: a frameshift here would not reach it.",
  ];
}
