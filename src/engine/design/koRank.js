// Outcome-based ranking of knockout guides: how often each repair outcome happens (Lindel, src/lindel) times what each outcome does to the protein
// (koOutcomes.js, the Assured QC engine's NMD and truncation rules).
//
// predicted_LoF_allele_pct is the Lindel-weighted share of outcomes that are a predicted loss of function. A clone needs both alleles to be one, so
// predicted_biallelic_LoF_clone_pct is its square (alleles treated as independent). Insertions over 2 bp are a single Lindel class that is not resolved,
// and count as not loss of function. SpCas9 (NGG) only. On-target efficiency is not modelled: a guide that does not cut makes no alleles at all.
import { classifyEditAcrossIsoforms, assessKoGuide } from "./koOutcomes.js";
import { predictLindel, lindelEdits } from "./lindel/lindel.js";

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A" };
const rc = (s) => [...s].reverse().map((c) => COMPLEMENT[c] || "N").join("");

/** Every SpCas9 (NGG) guide whose cut lies in a non-terminal coding exon of the model, with the 65-nt window Lindel needs (cut at index 30, guide on the + strand of the window). */
export function listKoCandidates(model) {
  const G = model.genomicSequence.toUpperCase(); const L = G.length; const segs = model.cdsSegments;
  const where = (cut) => { for (let i = 0; i < segs.length - 1; i += 1) { const [a, b] = segs[i]; if (cut > a + 2 && cut < b - 2) return { exonIndex: i + 1, offset: cut - a }; } return null; };
  const guides = [];
  const push = (spacer, strand, pam, cut) => {
    const place = where(cut); if (!place) return;
    const window65 = strand === "+" ? G.slice(cut - 30, cut + 35) : rc(G.slice(cut - 35, cut + 30));
    if (window65.length !== 65 || !/^[ACGT]+$/.test(window65)) return;
    if (window65.slice(13, 33) !== spacer) return;
    const gc = Math.round([...spacer].filter((c) => c === "G" || c === "C").length * 5);
    guides.push({ spacer, strand, pam, cut, exonIndex: place.exonIndex, offset: place.offset, gc, window65 });
  };
  for (let i = 0; i + 23 <= L; i += 1) {
    const pamP = G.slice(i + 20, i + 23); if (/^[ACGT]GG$/.test(pamP)) push(G.slice(i, i + 20), "+", pamP, i + 17);
    const pamM = rc(G.slice(i, i + 3)); if (/^[ACGT]GG$/.test(pamM)) push(rc(G.slice(i + 3, i + 23)), "-", pamM, i + 6);
  }
  return guides;
}

/** The Lindel window of one guide of the engine (`{ sp, str, cut }`), or null when the guide is too close to the end of the sequence or has no NGG PAM. */
export function koGuideWindow(model, guide) {
  const G = model.genomicSequence.toUpperCase(); const { cut } = guide; const strand = guide.str || guide.strand;
  const window65 = strand === "-" ? rc(G.slice(cut - 35, cut + 30)) : G.slice(cut - 30, cut + 35);
  const spacer = String(guide.sp || guide.spacer || "").toUpperCase();
  if (window65.length !== 65 || !/^[ACGT]+$/.test(window65) || window65.slice(13, 33) !== spacer || !/^[ACGT]GG$/.test(window65.slice(33, 36))) return null;
  return window65;
}

/** A Lindel class (relative to the cut, in input orientation) as an edit of the record's + strand. */
export function toGenomicEdit(guide, edit) {
  const { cut, strand } = guide;
  if (edit.kind === "ins") return { s: cut, e: cut, ins: strand === "+" ? edit.bases : rc(edit.bases) };
  if (strand === "+") return { s: cut + edit.start, e: cut + edit.start + edit.length, ins: "" };
  const e = cut - edit.start; return { s: e - edit.length, e, ins: "" };
}

/** Fractions of a guide's predicted alleles by consequence. `guide` = { cut, strand, edits: [{ f, kind, ... }] }. Shares are of the outcome mass the edit list retains. */
export function summariseGuideOutcomes(model, guide) {
  let total = 0; let lof = 0; let clean = 0; let inframe = 0; let group = 0; let gap = 0; let plus1 = 0;
  for (const edit of guide.edits) {
    total += edit.f;
    if (edit.kind === "ins" && edit.bases.length === 1) plus1 += edit.f;
    if (edit.kind === "ins_group") { group += edit.f; continue; }
    const r = classifyEditAcrossIsoforms(model, toGenomicEdit(guide, edit));
    if (r.lof === true) lof += edit.f;
    if (r.class === "lof_nmd" && !(r.nmd && r.nmd.borderline)) clean += edit.f;
    if (r.class === "inframe" || r.class === "no_coding_effect") inframe += edit.f;
    if (r.gaps && r.gaps.length) gap += edit.f;
  }
  return { total, lof: lof / total, clean: clean / total, inframe: inframe / total, group: group / total, gap: gap / total, plus1: plus1 / total };
}

const pct1 = (x) => Math.round(1000 * x) / 10;

/** The ranking rows (one per guide with predicted outcomes), best predicted loss-of-function share first. */
export function rankFromEdits(model, payload) {
  const rows = payload.guides.filter((g) => g.edits && g.edits.length).map((guide) => {
    const s = summariseGuideOutcomes(model, guide);
    const tier = assessKoGuide(model, guide).tier;
    return {
      spacer: guide.spacer, strand: guide.strand, pam: guide.pam, coding_exon: guide.exonIndex, cut_after_exon_nt: guide.offset, gc_percent: guide.gc,
      base_pos17: guide.spacer[16], panel_tier: tier,
      lindel_frameshift_pct: Math.round(1000 * guide.lindelFrameshift) / 10, lindel_plus1_ins_pct: pct1(s.plus1),
      predicted_LoF_allele_pct: pct1(s.lof), predicted_clear_NMD_allele_pct: pct1(s.clean), predicted_in_frame_pct: pct1(s.inframe), ge3bp_insertion_group_pct: pct1(s.group),
      other_isoform_not_disrupted_pct: pct1(s.gap), predicted_biallelic_LoF_clone_pct: Math.round(s.lof ** 2 * 1000) / 10,
    };
  });
  rows.sort((a, b) => b.predicted_LoF_allele_pct - a.predicted_LoF_allele_pct || b.gc_percent - a.gc_percent);
  return rows;
}

export const toCsv = (rows) => { const head = Object.keys(rows[0] || {}); return [head.join(","), ...rows.map((r) => head.map((h) => r[h]).join(","))].join("\n") + "\n"; };

/** Candidates with Lindel's predicted outcomes attached, in the payload shape rankFromEdits reads (and tools/ko-rank/lindel_outcomes.py writes). */
export function predictKoCandidates(model, lindel, options = {}) {
  const guides = listKoCandidates(model).map((guide) => {
    const prediction = predictLindel(lindel, guide.window65);
    return prediction.error ? { ...guide, edits: [] } : { ...guide, lindelFrameshift: prediction.frameshift, edits: lindelEdits(prediction, options.minFreq) };
  });
  return { gene: model.gene, proteinLength: model.proteinLength, guides, lindel: { source: lindel.header.source, paper: lindel.header.paper } };
}

/** Rank every candidate guide of a model with the JavaScript Lindel (same output as tools/ko-rank/run.sh, without Python). */
export function rankKoGuides(model, lindel, options = {}) { return rankFromEdits(model, predictKoCandidates(model, lindel, options)); }

/**
 * A scorer for the design engine: `score(guide)` takes a guide as findSpCas9Guides returns it and gives
 * { lofPct, biallelicPct, frameshiftPct, plus1Pct, inframePct, gapPct } or null when the guide cannot be scored. Results are cached per cut and strand.
 * The engine never waits on this: load the weights first (loadLindel), build the scorer, and pass it to the design as `koOutcomes`.
 */
export function createKoOutcomeScorer(model, lindel, options = {}) {
  const cache = new Map();
  return function score(guide) {
    const strand = guide.str === "-" || guide.strand === "-" ? "-" : "+"; const key = `${strand}:${guide.cut}`;
    if (cache.has(key)) return cache.get(key);
    let result = null;
    const window65 = koGuideWindow(model, { ...guide, str: strand });
    if (window65) {
      const prediction = predictLindel(lindel, window65);
      if (!prediction.error) {
        const edits = lindelEdits(prediction, options.minFreq);
        const s = summariseGuideOutcomes(model, { cut: guide.cut, strand, edits });
        result = { lofPct: pct1(s.lof), biallelicPct: Math.round(s.lof ** 2 * 1000) / 10, frameshiftPct: pct1(prediction.frameshift), plus1Pct: pct1(s.plus1), inframePct: pct1(s.inframe), gapPct: pct1(s.gap) };
      }
    }
    cache.set(key, result);
    return result;
  };
}
