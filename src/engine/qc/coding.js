// Coding context for a knockout: what an allele does to the protein, not only to the reading frame.
//
// From a GenBank record (genomic sequence, CDS join) and the allele sequences the fit reports, each allele is spliced into the
// coding sequence and translated. Per allele the result is a class and a tri-state loss-of-function call (true / null = uncertain / false):
//   frameshift or nonsense, with the premature stop's position            -> nonsense-mediated decay (NMD) predicted from the exon-junction rules,
//                                                                            or a truncated protein of known length
//   start codon lost                                                      -> translation from the next ATG, if any
//   splice donor/acceptor dinucleotide hit                                -> exon skipping and intron retention are both modelled
//   in-frame deletion or insertion                                        -> residues removed; uncertain unless it hits a region the user marks as essential
//   stop codon lost                                                       -> extended protein (uncertain)
// The NMD call follows the published escape rules (last coding exon; last 55 nt before the last junction; first 150 coding nt;
// exons longer than 407 nt; intronless) (Nagy and Maquat 1998; Lindeboom et al. 2016, 2019). Those rules are not deterministic: at least
// about a third of PTCs that the 50-nt rule calls NMD-triggering still escape. Everything here is a prediction from sequence; a protein
// assay is what confirms a functional knockout, and the report says so.
import { reverseComplement } from "./seq.js";
import { parseGenBank, qualifier } from "./genbank.js";

export const CODING_DEFAULTS = {
  truncationLof: 0.5,        // an NMD-escaping truncation that keeps less than this share of the protein is called loss of function
  truncationUncertain: 0.9,  // between truncationLof and this: uncertain; above: a small C-terminal truncation, also uncertain
  lastJunction: 55, startProximal: 150, longExon: 407,
  reinitMaxPtc: 300, reinitMinRetained: 0.6, // a premature stop within reinitMaxPtc nt with an in-frame ATG downstream that keeps this share
  minAllele: 0.05,           // alleles below this share of the explained signal are not part of the clone call
};

const AA = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const IDX = { T: 0, C: 1, A: 2, G: 3 };
const codonAa = (c) => { const a = IDX[c[0]]; const b = IDX[c[1]]; const d = IDX[c[2]]; return a === undefined || b === undefined || d === undefined ? "X" : AA[a * 16 + b * 4 + d]; };

/** Translate from `from`; stops at the first stop codon. @returns {{ protein: string, stopNt: number }} stopNt = nt index of the stop codon or -1 */
export function translate(seq, from = 0) {
  let protein = "";
  for (let i = from; i + 3 <= seq.length; i += 3) { const aa = codonAa(seq.slice(i, i + 3)); if (aa === "*") return { protein, stopNt: i }; protein += aa; }
  return { protein, stopNt: -1 };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Models: one per annotated CDS, in transcript orientation ("T" coordinates: the gene's strand is the + strand).

export function buildModels(gb, { gene = "", transcript = "" } = {}) {
  const G = gb.sequence; const Lg = G.length; const rc = reverseComplement(G); const warnings = [];
  let cds = gb.features.filter((f) => f.type === "CDS" && f.location);
  if (gene) { const hit = cds.filter((f) => qualifier(f, "gene").toLowerCase() === gene.toLowerCase()); if (hit.length) cds = hit; }
  if (transcript) {
    const t = transcript.toLowerCase();
    const hit = cds.filter((f) => ["transcript_id", "protein_id", "product", "note"].some((q) => qualifier(f, q).toLowerCase().includes(t)));
    if (hit.length) cds = hit; else warnings.push(`No CDS matches "${transcript}"; all CDS features of the record are used.`);
  }
  const models = []; const seen = new Set();
  cds.forEach((f, i) => {
    const strand = f.location.strand; const key = strand + JSON.stringify(f.location.segments); if (seen.has(key)) return; seen.add(key);
    const T = strand === "+" ? G : rc;
    let segs = strand === "+" ? f.location.segments.map(([s, e]) => [s, e]) : f.location.segments.map(([s, e]) => [Lg - e, Lg - s]).reverse();
    const codonStart = Number(qualifier(f, "codon_start") || 1); if (codonStart > 1) segs[0][0] += codonStart - 1;
    const cdsSeq = segs.map(([s, e]) => T.slice(s, e)).join("");
    if (cdsSeq.length % 3 !== 0) warnings.push(`A CDS feature of the record (${qualifier(f, "gene") || qualifier(f, "product") || `CDS ${i + 1}`}) is partial or not a multiple of three nucleotides and was not used.`);
    if (cdsSeq.length % 3 !== 0 || cdsSeq.length < 6) return;
    const { protein } = translate(cdsSeq);
    models.push({
      id: qualifier(f, "transcript_id") || qualifier(f, "protein_id") || `CDS${i + 1}`, protein_id: qualifier(f, "protein_id"), gene: qualifier(f, "gene"), product: qualifier(f, "product"),
      strand, T, Lg, segs, cdsSeq, cdsLen: cdsSeq.length, protein, protLen: protein.length, startsWithAtg: cdsSeq.startsWith("ATG"), endsWithStop: codonAa(cdsSeq.slice(-3)) === "*",
      exonLens: segs.map(([s, e]) => e - s),
    });
  });
  models.sort((a, b) => b.cdsLen - a.cdsLen);
  return { models, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Where the QC reference window lies in the record, and how an edit of the window maps into a model's coordinates.

export function locateWindow(G, W, { k = 24, minIdentity = 0.9 } = {}) {
  const attempt = (seq, strand) => {
    const votes = new Map(); const step = Math.max(8, Math.floor(seq.length / 40));
    for (let i = 0; i + k <= seq.length; i += step) {
      const seed = seq.slice(i, i + k); if (/[^ACGT]/.test(seed)) continue;
      let from = 0;
      for (let guard = 0; guard < 50; guard += 1) { const p = G.indexOf(seed, from); if (p < 0) break; const off = p - i; votes.set(off, (votes.get(off) || 0) + 1); from = p + 1; }
    }
    let best = null;
    for (const [off, v] of votes) if (!best || v > best.v) best = { off, v };
    if (!best) return null;
    let match = 0; let compared = 0;
    for (let j = 0; j < seq.length; j += 1) { const g = G[best.off + j]; if (g === undefined || seq[j] === "N") continue; compared += 1; if (g === seq[j]) match += 1; }
    return compared ? { offset: best.off, strand, identity: match / compared, compared, covered: best.off >= 0 && best.off + seq.length <= G.length } : null;
  };
  const forward = attempt(W, "+"); const reverse = attempt(reverseComplement(W), "-");
  const best = [forward, reverse].filter(Boolean).sort((a, b) => b.identity - a.identity)[0];
  if (!best || best.identity < minIdentity) return null;
  return best;
}

export function windowMapper(location, L, Lg, geneStrand) {
  const flip = location.strand !== geneStrand;
  if (!flip) { const start = geneStrand === "+" ? location.offset : Lg - location.offset - L; return (edit) => ({ s: start + edit.s, e: start + edit.e, ins: edit.ins }); }
  const end = geneStrand === "+" ? location.offset + L : Lg - location.offset;
  return (edit) => ({ s: end - edit.e, e: end - edit.s, ins: reverseComplement(edit.ins) });
}

/** The difference between the reference window and an allele as one replacement: window[s, e) -> ins (null when identical). */
export function diffWindow(W, A) {
  let p = 0; const n = Math.min(W.length, A.length);
  while (p < n && W[p] === A[p]) p += 1;
  let q = 0;
  while (q < n - p && W[W.length - 1 - q] === A[A.length - 1 - q]) q += 1;
  const s = p; const e = W.length - q; const ins = A.slice(p, A.length - q);
  return s === e && ins === "" ? null : { s, e, ins };
}

// ---------------------------------------------------------------------------------------------------------------------------------

const touches = (s, e, a, b) => (s === e ? s > a && s < b : s < b && e > a);
const t2slice = (T, edit, a, b) => {
  const { s, ins } = edit; const delta = ins.length - (edit.e - edit.s); let out = "";
  if (a < s) out += T.slice(a, Math.min(b, s));
  const i0 = Math.max(a, s); const i1 = Math.min(b, s + ins.length); if (i1 > i0) out += ins.slice(i0 - s, i1 - s);
  const t0 = Math.max(a, s + ins.length); if (b > t0) out += T.slice(t0 - delta, b - delta);
  return out;
};

/** The same allele sequence can be written as an indel in several places (a deletion slides along a repeat of its own bases). */
function equivalentEdits(T, edit) {
  const { s, e, ins } = edit; const out = [edit];
  if (ins === "" && e > s) {
    let a = s; let b = e; while (a > 0 && T[a - 1] === T[b - 1] && out.length < 300) { a -= 1; b -= 1; out.push({ s: a, e: b, ins: "" }); }
    a = s; b = e; while (b < T.length && T[a] === T[b] && out.length < 600) { a += 1; b += 1; out.push({ s: a, e: b, ins: "" }); }
  } else if (s === e && ins !== "") {
    let a = s; let x = ins; while (a > 0 && T[a - 1] === x[x.length - 1] && out.length < 300) { x = x[x.length - 1] + x.slice(0, -1); a -= 1; out.push({ s: a, e: a, ins: x }); }
    a = s; x = ins; while (a < T.length && T[a] === x[0] && out.length < 600) { x = x.slice(1) + x[0]; a += 1; out.push({ s: a, e: a, ins: x }); }
  }
  return out;
}

function transformSegments(segs, edit) {
  const { s, e } = edit; const delta = edit.ins.length - (e - s); const pieces = [];
  segs.forEach(([a, b], idx) => {
    if (b <= s) { pieces.push({ a, b, orig: [idx], cutL: false, cutR: false }); return; }
    if (a >= e) { pieces.push({ a: a + delta, b: b + delta, orig: [idx], cutL: false, cutR: false }); return; }
    const left = a < s; const right = b > e;
    if (left && right) pieces.push({ a, b: b + delta, orig: [idx], cutL: false, cutR: false, inside: true });
    else if (left) pieces.push({ a, b: s, orig: [idx], cutL: false, cutR: true });
    else if (right) pieces.push({ a: e + delta, b: b + delta, orig: [idx], cutL: true, cutR: false });
  });
  const merged = [];
  pieces.forEach((p) => {
    const last = merged[merged.length - 1];
    if (last && last.cutR && p.cutL) { last.b = p.b; last.orig = [...last.orig, ...p.orig]; last.cutR = p.cutR; last.merged = true; } else merged.push({ ...p });
  });
  return { pieces: merged, delta };
}

function junctionDamage(segs, edit, pieces) {
  const damaged = [];
  for (let j = 0; j + 1 < segs.length; j += 1) {
    const pj = pieces.findIndex((p) => p.orig.includes(j)); const pk = pieces.findIndex((p) => p.orig.includes(j + 1));
    if (pj < 0 || pk < 0 || pj === pk) continue;
    const donor = touches(edit.s, edit.e, segs[j][1], segs[j][1] + 2); const acceptor = touches(edit.s, edit.e, segs[j + 1][0] - 2, segs[j + 1][0]);
    if (donor || acceptor) damaged.push({ j, donor, acceptor, left: pj, right: pk });
  }
  return damaged;
}

function nmdCall(ptcNt, junctions, pieceLens, opt) {
  if (!junctions.length) return { predicted: false, rule: "single coding exon: no exon junction downstream, NMD not expected" };
  const last = junctions[junctions.length - 1];
  if (ptcNt >= last) return { predicted: false, rule: "stop in the last coding exon: NMD not expected" };
  if (last - ptcNt <= opt.lastJunction) return { predicted: false, rule: `stop ${last - ptcNt} nt before the last exon junction (50-55 nt rule): NMD not expected` };
  if (ptcNt <= opt.startProximal) return { predicted: false, uncertain: true, rule: `stop within ${opt.startProximal} nt of the start codon: NMD is often inefficient (start-proximal rule)` };
  let from = 0; let exonLen = 0;
  for (const len of pieceLens) { if (ptcNt < from + len) { exonLen = len; break; } from += len; }
  if (exonLen > opt.longExon) return { predicted: false, uncertain: true, rule: `stop in a coding exon of ${exonLen} nt (long-exon rule, over ${opt.longExon} nt): NMD partly evaded` };
  return { predicted: true, borderline: last - ptcNt <= opt.lastJunction + 20, rule: `stop ${last - ptcNt} nt upstream of the last exon junction: NMD expected` };
}

const aaRange = (c0, c1) => [Math.floor(c0 / 3) + 1, Math.floor(Math.max(c0, c1 - 1) / 3) + 1];
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;

function evaluatePieces(model, edit, pieces, opt) {
  const T = model.T; const cds2 = pieces.map((p) => t2slice(T, edit, p.a, p.b)).join(""); const pieceLens = pieces.map((p) => p.b - p.a);
  const junctions = []; let run = 0; pieceLens.slice(0, -1).forEach((len) => { run += len; junctions.push(run); });
  const out = { cds2, junctions, pieceLens, delta: cds2.length - model.cdsLen };
  if (!cds2.length) { out.empty = true; return out; }
  let from = 0;
  if (!cds2.startsWith("ATG")) { out.startLoss = true; const i = cds2.indexOf("ATG", 1); if (i < 0) { out.noMet = true; return out; } from = i; out.metNt = i; }
  let { stopNt } = translate(cds2, from);
  if (stopNt < 0) {
    const last = pieces[pieces.length - 1]; const full = cds2 + t2slice(T, edit, last.b, last.b + 3000); out.extended = true;
    stopNt = translate(full, from).stopNt; out.runOn = stopNt < 0;
  }
  out.stopNt = stopNt;
  const endNt = cds2.length - 3;
  out.normalEnd = !out.startLoss && stopNt === endNt && cds2.length % 3 === 0;
  out.premature = stopNt >= 0 && stopNt < cds2.length && !out.normalEnd && !out.extended;
  if (out.startLoss) out.orfAa = stopNt >= 0 ? (stopNt - from) / 3 : null;
  return out;
}

function proteinDiff(a, b) {
  let p = 0; const n = Math.min(a.length, b.length); while (p < n && a[p] === b[p]) p += 1;
  let q = 0; while (q < n - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q += 1;
  return { first: p + 1, removed: a.length - p - q, inserted: b.length - p - q };
}

function overlapsRegion(regions, from, to) { return (regions || []).filter((r) => from <= r.end && to >= r.start); }

function describeExon(model, pieces, idxOrig) { return `exon ${idxOrig + 1} of ${model.segs.length}`; }

function classifyOutcome(model, edit, info, firstOrig, c0, c1, opt, ctx) {
  const delta = info.delta; const frame = delta % 3 === 0;
  const regions = ctx.regions || []; const epitope = ctx.epitope || null;
  const where = firstOrig === null ? "" : ` in ${describeExon(model, null, firstOrig)}`;
  const d = { deltaNt: delta };
  if (info.empty) return { class: "lof_deleted", lof: true, summary: "All coding exons are deleted.", details: d };
  if (info.startLoss) {
    if (info.noMet) return { class: "lof_start_loss", lof: true, summary: `Start codon lost${where} and no downstream ATG: no protein.`, details: d };
    const retained = info.orfAa === null ? null : (info.orfAa + 1) / (model.protLen || 1);
    const nativeEnd = info.stopNt === info.cds2.length - 3 && info.cds2.length % 3 === 0;
    const aaMet = Math.floor(info.metNt / 3) + 1;
    d.reinit = { metNt: info.metNt, retainedPct: retained === null ? null : Math.round(retained * 1000) / 10 };
    if (nativeEnd && retained !== null && retained >= opt.reinitMinRetained) return { class: "start_loss_uncertain", lof: null, summary: `Start codon lost${where}; translation could start at the next ATG (about codon ${aaMet}) and keep ${d.reinit.retainedPct}% of the protein as an N-terminally truncated form.`, details: d };
    return { class: "lof_start_loss", lof: true, summary: `Start codon lost${where}; the next ATG gives ${retained === null ? "an unterminated" : `a ${Math.max(0, Math.round(info.orfAa))}-residue`} product that is not the protein.`, details: d };
  }
  const [aaFrom, aaTo] = aaRange(c0, c1);
  d.firstChangedAa = aaFrom;
  if (epitope) d.epitopeKept = epitope.end < aaFrom;
  if (info.premature) {
    const aaToPtc = info.stopNt / 3; /* a stop past the normal end (an extension) counts as the whole protein */ const retained = model.protLen ? Math.min(1, aaToPtc / model.protLen) : 0; const nmd = nmdCall(info.stopNt, info.junctions, info.pieceLens, opt);
    d.ptcNt = info.stopNt; d.ptcAa = Math.round(aaToPtc); d.retainedPct = Math.round(retained * 1000) / 10; d.nmd = nmd;
    const kind = frame ? "In-frame change creating a stop" : "Frameshift";
    const head = `${kind} (${signed(delta)} nt)${where}; stop at codon ${Math.round(aaToPtc) + 1}, ${Math.round(retained * 100)}% of the protein before it.`;
    // a downstream in-frame ATG can restart translation after an early stop (native frame, past the edit)
    let reinit = null;
    if (info.stopNt <= opt.reinitMaxPtc) {
      for (let o = Math.ceil(c1 / 3) * 3; o + 3 <= model.cdsLen; o += 3) if (model.cdsSeq.startsWith("ATG", o)) { reinit = { metNt: o, aa: o / 3 + 1, retainedPct: Math.round(((model.cdsLen - o) / model.cdsLen) * 1000) / 10 }; break; }
    }
    if (reinit) d.reinit = reinit;
    const reinitRisk = reinit && reinit.retainedPct >= opt.reinitMinRetained * 100;
    if (nmd.predicted && !reinitRisk) return { class: "lof_nmd", lof: true, summary: `${head} ${nmd.rule}.`, details: d };
    if (reinitRisk) return { class: "truncation_reinit_uncertain", lof: null, summary: `${head} ${nmd.rule}. Translation could restart at Met ${reinit.aa}, keeping ${reinit.retainedPct}% of the protein as an N-terminally truncated form.`, details: d };
    if (retained < opt.truncationLof) return { class: "lof_truncation", lof: true, summary: `${head} ${nmd.rule}; the truncated protein lacks more than ${Math.round((1 - opt.truncationLof) * 100)}% of the sequence.`, details: d };
    const hit = overlapsRegion(regions, Math.round(aaToPtc) + 1, Infinity).filter((r) => r.end > aaToPtc);
    if (hit.length) { d.regions = hit.map((r) => r.name); return { class: "lof_truncation", lof: true, summary: `${head} ${nmd.rule}; the truncated protein lacks ${hit.map((r) => r.name).join(", ")}.`, details: d }; }
    return { class: "truncation_uncertain", lof: null, summary: `${head} ${nmd.rule}; the truncated protein keeps ${Math.round(retained * 100)}% and may be partly functional.`, details: d };
  }
  if (info.extended && !frame) return { class: "frameshift_no_stop", lof: null, summary: `Frameshift (${signed(delta)} nt)${where}; no stop codon inside the coding sequence, the new frame reads on into the 3′ UTR. Protein effect uncertain.`, details: d };
  if (info.extended) {
    d.extensionAa = info.stopNt >= 0 ? Math.round((info.stopNt - (info.cds2.length - 3)) / 3) : null;
    return { class: "stop_loss", lof: null, summary: `Stop codon lost${where}; translation runs on into the 3′ UTR${d.extensionAa === null ? " with no stop in the record" : ` for about ${d.extensionAa} residues`}. Protein effect uncertain; non-stop decay is possible.`, details: d };
  }
  // in frame
  const protein2 = translate(info.cds2).protein; const diff = proteinDiff(model.protein, protein2);
  d.diff = diff;
  if (diff.removed === 0 && diff.inserted === 0) return { class: "synonymous", lof: false, summary: `No change to the protein${where}.`, details: d };
  const lo = diff.first; const hi = diff.first + Math.max(diff.removed, 1) - 1; const hit = overlapsRegion(regions, lo, hi);
  if (epitope) d.epitopeKept = !(lo <= epitope.end && hi >= epitope.start);
  const what = diff.removed || diff.inserted ? `${diff.removed ? `${diff.removed} residue${diff.removed === 1 ? "" : "s"} removed` : ""}${diff.removed && diff.inserted ? ", " : ""}${diff.inserted ? `${diff.inserted} inserted` : ""} at residue ${lo}` : "";
  if (hit.length) { d.regions = hit.map((r) => r.name); return { class: "inframe_region_hit", lof: true, summary: `In-frame change${where}: ${what}, inside ${hit.map((r) => r.name).join(", ")}.`, details: d }; }
  if (diff.removed === 0 && diff.inserted === 0) return { class: "synonymous", lof: false, summary: "No protein change.", details: d };
  return { class: "inframe", lof: null, summary: `In-frame change${where}: ${what}. The protein is made; whether it works is not predicted.`, details: d };
}

const joinLines = (parts) => parts.filter(Boolean).join(" ");

/**
 * One model, one edit (T coordinates).
 * @returns {{ class: string, lof: boolean|null, summary: string, details: object }}
 */
export function assessOnModel(model, edit0, options = {}) {
  const opt = { ...CODING_DEFAULTS, ...options }; const ctx = { regions: options.regions || [], epitope: options.epitope || null };
  const { segs } = model;
  // an indel that can be written in several places is read where it leaves the canonical splice dinucleotides intact, when it can be: the sequence of the allele is the same, and a GT or AG re-formed at the junction is a working site
  let edit = edit0; let reformed = false;
  const damageAt = (ed) => junctionDamage(segs, ed, transformSegments(segs, ed).pieces).length;
  if (damageAt(edit0) > 0) { const alt = equivalentEdits(model.T, edit0).find((ed) => damageAt(ed) === 0); if (alt) { edit = alt; reformed = true; } } const touchedCds = segs.some(([a, b]) => touches(edit.s, edit.e, a, b));
  const { pieces, delta } = transformSegments(segs, edit);
  const damaged = junctionDamage(segs, edit, pieces);
  const firstOrig = (() => { const idx = segs.findIndex(([a, b]) => touches(edit.s, edit.e, a, b)); return idx < 0 ? null : idx; })();
  // cds coordinates of the edit in the original CDS (for residue numbering)
  const toCds = (t, atEnd) => { let run = 0; for (const [a, b] of segs) { if (t >= a && t <= b) return run + Math.min(t, b) - a; if (t < a) return run; run += b - a; } return run; };
  const c0 = toCds(edit.s); const c1 = toCds(edit.e);
  const splice = damaged.length > 0;
  const nearSplice = segs.some(([a, b], idx) => (idx > 0 && touches(edit.s, edit.e, a - 20, a + 3)) || (idx + 1 < segs.length && touches(edit.s, edit.e, b - 3, b + 8)));
  const startCodon = touches(edit.s, edit.e, segs[0][0], segs[0][0] + 3);
  const stopCodon = touches(edit.s, edit.e, segs[segs.length - 1][1] - 3, segs[segs.length - 1][1]);
  if (!touchedCds && !splice) {
    const note = nearSplice ? "Near a splice site but not in the canonical GT or AG: effect on splicing is not predicted." : "";
    return { class: "no_coding_effect", lof: false, summary: joinLines(["The edit lies outside the coding sequence and the splice dinucleotides.", note]), details: { nearSplice } };
  }
  if (!splice) {
    const info = evaluatePieces(model, edit, pieces, opt); const out = classifyOutcome(model, edit, info, firstOrig, c0, c1, opt, ctx);
    if (reformed) out.summary += " The deletion removes exon bases up to the splice donor or acceptor; the canonical GT or AG is kept (re-formed at the junction), but the surrounding consensus is changed, so splicing could still be affected.";
    else if (nearSplice) out.summary += " It is close to a splice site, which may also be affected.";
    out.details.nearSplice = nearSplice || reformed; out.details.spliceReformed = reformed; out.details.startCodonHit = startCodon; out.details.stopCodonHit = stopCodon; return out;
  }
  // a splice donor or acceptor is hit: exon skipping and intron retention
  const skipIdx = new Set(); damaged.forEach((x) => { if (x.donor) skipIdx.add(x.left); if (x.acceptor) skipIdx.add(x.right); });
  const skipPieces = pieces.filter((_, i) => !skipIdx.has(i));
  const retainPieces = []; const retainedJ = new Set(damaged.map((x) => x.left));
  pieces.forEach((p, i) => { const last = retainPieces[retainPieces.length - 1]; if (last && retainedJ.has(i - 1)) { last.b = p.b; } else retainPieces.push({ ...p }); });
  const names = [...skipIdx].map((i) => `exon ${pieces[i].orig[0] + 1}`).join(", ");
  const siteWord = damaged.map((x) => `${x.donor ? "donor" : ""}${x.donor && x.acceptor ? " and " : ""}${x.acceptor ? "acceptor" : ""} site of intron ${x.j + 1}`).join("; ");
  const skip = evaluatePieces(model, edit, skipPieces, opt); const retain = evaluatePieces(model, edit, retainPieces, opt);
  const a = classifyOutcome(model, edit, skip, firstOrig, c0, c1, opt, ctx); const b = classifyOutcome(model, edit, retain, firstOrig, c0, c1, opt, ctx);
  // residues of the original protein that exon skipping keeps: those encoded before the first skipped exon (the figure of predicted products draws them)
  if (skipIdx.size) { const firstSkipped = Math.min(...[...skipIdx].map((i) => pieces[i].orig[0])); a.details = { ...(a.details || {}), keptAa: Math.floor(model.exonLens.slice(0, firstSkipped).reduce((s, n) => s + n, 0) / 3) }; }
  const details = { splice: { sites: siteWord, skippedExons: names, skipping: { class: a.class, lof: a.lof, summary: a.summary, details: a.details }, retention: { class: b.class, lof: b.lof, summary: b.summary, details: b.details } } };
  if (a.lof === true && b.lof === true) return { class: "lof_splice", lof: true, summary: `Canonical splice site destroyed (${siteWord}). Exon skipping (${names}): ${a.summary} Intron retention: ${b.summary}`, details };
  return { class: "splice_uncertain", lof: null, summary: `Canonical splice site destroyed (${siteWord}). Exon skipping (${names}): ${a.summary} Intron retention: ${b.summary} The outcome depends on which is used; RT-PCR across the exons shows it.`, details };
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * @param {string|object} genbank GenBank text (or a parsed record)
 * @param {{ reference: string, gene?: string, transcript?: string, regions?: Array, epitope?: object }} input reference = the QC reference window
 * @returns {{ ok: boolean, error?: string, context?: object }}
 */
export function buildCodingContext(genbank, input = {}) {
  const gb = typeof genbank === "string" ? parseGenBank(genbank) : genbank;
  if (!gb.sequence || !gb.features.length) return { ok: false, error: "The gene record has no sequence or no features. Use a GenBank file with a CDS feature." };
  const reference = String(input.reference || "").toUpperCase();
  const { models, warnings } = buildModels(gb, { gene: input.gene || "", transcript: input.transcript || "" });
  if (!models.length) return { ok: false, error: "The gene record has no usable CDS feature." };
  const loc = locateWindow(gb.sequence, reference);
  if (!loc) return { ok: false, error: "The reference sequence of this design was not found in the gene record (it must match the record's genomic sequence to within 10%)." };
  // A genomic record often carries the neighbouring gene as well: keep the coding sequences of the gene the reference window lies in (or, if the window lies in none, leave them all)
  const bodyOverlap = (model) => { const map = windowMapper(loc, reference.length, model.Lg, model.strand); const w = map({ s: 0, e: reference.length, ins: "" }); const lo = Math.min(w.s, w.e); const hi = Math.max(w.s, w.e); return Math.min(hi, model.segs[model.segs.length - 1][1]) - Math.max(lo, model.segs[0][0]); };
  const inside = models.filter((m) => bodyOverlap(m) > 0);
  if (inside.length && inside.length < models.length) {
    const genes = new Set(inside.map((m) => m.gene || m.id)); const keep = models.filter((m) => genes.has(m.gene || m.id));
    if (keep.length < models.length) { warnings.push(`${models.length - keep.length} coding sequence${models.length - keep.length === 1 ? "" : "s"} of other genes in the record ${models.length - keep.length === 1 ? "was" : "were"} ignored.`); models.splice(0, models.length, ...keep); }
  }
  if (!loc.covered) warnings.push("The reference window extends beyond the gene record; edits there are not modelled.");
  const primary = models[0];
  const context = { gb: { locus: gb.locus, accession: gb.accession, definition: gb.definition }, models, location: loc, warnings, referenceLength: reference.length, regions: input.regions || [], epitope: input.epitope || null, reference, geneStrand: primary.strand,
    cache: new Map(), options: { ...(input.options || {}) } };
  return { ok: true, context };
}

/** Assess one allele sequence (the full reference window with the allele's changes). */
export function assessAllele(context, alleleSequence, options = {}) {
  const key = alleleSequence; if (context.cache.has(key)) return context.cache.get(key);
  const edit = diffWindow(context.reference, String(alleleSequence).toUpperCase());
  let result;
  if (!edit) result = { class: "wt", lof: false, summary: "Wild type.", details: {} };
  else {
    const opt = { ...context.options, ...options, regions: context.regions, epitope: context.epitope };
    const perModel = context.models.map((model) => {
      const map = windowMapper(context.location, context.referenceLength, model.Lg, model.strand);
      return { id: model.id, a: assessOnModel(model, map(edit), opt) };
    });
    const primary = perModel[0].a;
    const affected = perModel.filter((m) => m.a.class !== "no_coding_effect");
    result = { ...primary, details: { ...primary.details, isoforms: { evaluated: perModel.length, affected: affected.length, primary: perModel[0].id, lofIn: perModel.filter((m) => m.a.lof === true).length } } };
    if (primary.class !== "no_coding_effect" && affected.length < perModel.length) result.details.isoforms.note = `${perModel.length - affected.length} of ${perModel.length} annotated coding isoforms do not contain the edited sequence.`;
  }
  context.cache.set(key, result); return result;
}

const KO_WORDS = { lof_nmd: "frameshift or nonsense with NMD predicted", lof_truncation: "truncation (NMD escape)", lof_splice: "splice-site loss", lof_start_loss: "start codon lost", lof_deleted: "coding exons deleted", inframe_region_hit: "in-frame change inside an essential region" };

/**
 * Clone or pool level: the allele table, a functional knockout score and call, and what to run to confirm it.
 * @param {Array<{ id: string, kind: string, label: string, size: number, fraction: number, sequence: string }>} contributions explained alleles, fractions summing to one
 */
export function assessFunction(context, contributions, options = {}) {
  const opt = { ...CODING_DEFAULTS, ...(context.options || {}), ...options };
  const rows = contributions.filter((c) => c.sequence).map((c) => ({ id: c.id, kind: c.kind, label: c.label, size: c.size, fraction: c.fraction, ...assessAllele(context, c.sequence, opt) }));
  const total = rows.reduce((s, r) => s + r.fraction, 0) || 1;
  const share = (pred) => rows.filter(pred).reduce((s, r) => s + r.fraction, 0) / total;
  const donorEdits = rows.filter((r) => r.kind === "edit" || r.kind === "edit_partial").length > 0;
  const lofShare = share((r) => r.lof === true); const uncertainShare = share((r) => r.lof === null); const wtShare = share((r) => r.class === "wt");
  const present = rows.filter((r) => r.fraction >= opt.minAllele);
  const reasons = []; let status; let text;
  const caveats = []; const confirm = [];
  const classes = new Set(present.map((r) => r.class));
  if (!present.length) { status = "unclear"; text = "No allele reaches the detection floor."; }
  else if (present.every((r) => r.lof === true)) {
    const risky = present.filter((r) => r.class === "lof_truncation" || r.class === "lof_splice" || r.class === "lof_start_loss" || r.details.nearSplice || (r.details.nmd && (r.details.nmd.uncertain || r.details.nmd.borderline)) || (r.details.isoforms && r.details.isoforms.note));
    status = risky.length ? "predicted_knockout_with_caveats" : "predicted_knockout";
    text = `Predicted functional knockout: every allele (${present.length}) is predicted to lose function (${[...classes].map((c) => KO_WORDS[c] || c).join("; ")}).`;
  } else if (wtShare >= opt.minAllele) { status = "not_knockout"; text = `Not a knockout: ${Math.round(wtShare * 100)}% of the signal is wild type, so at least one allele is intact.`; }
  else if (present.some((r) => r.lof === false && r.class !== "wt")) { status = "not_knockout"; text = "Not predicted a knockout: an allele has no predicted effect on the protein."; }
  else { status = "uncertain"; text = `Uncertain: ${present.filter((r) => r.lof !== true).length} of ${present.length} alleles are not predicted loss of function (${[...new Set(present.filter((r) => r.lof !== true).map((r) => r.class))].join(", ")}). The protein may still be made.`; }
  present.forEach((r) => { const iso = r.details.isoforms; if (iso && iso.note) caveats.push(`${r.label}: ${iso.note}`); });
  present.forEach((r) => { if (r.details.nmd && r.details.nmd.borderline && r.lof === true) caveats.push(`${r.label}: the premature stop lies close to the 55-nt boundary of the NMD rule, so decay is less certain than for a stop further upstream.`); });
  present.forEach((r) => { if (r.details.nearSplice && r.lof === true) caveats.push(`${r.label}: the edit lies next to a splice site${r.details.spliceReformed ? " (the canonical GT or AG is re-formed at the junction)" : ""}; the consensus around it is changed, so splicing could differ from the predicted product.`); });
  present.forEach((r) => { if (r.class === "lof_splice") caveats.push(`${r.label}: the loss of function rests on a predicted splicing outcome (exon skipping or intron retention); a cryptic splice site could give another product.`); if (r.class === "lof_truncation") caveats.push(`${r.label}: the stop escapes NMD, so a truncated protein is expected to be made; its loss of function is inferred from what it lacks.`); });
  // what to run to confirm
  const has = (c) => present.some((r) => r.class === c);
  const anyNmd = has("lof_nmd");
  if (status !== "not_knockout") {
    confirm.push("Protein: Western blot or targeted mass spectrometry with an antibody or peptide outside the edited region. Loss of protein is what confirms a knockout; every call here is a prediction from sequence.");
    if (anyNmd) confirm.push("mRNA: RT-qPCR with primers downstream of the stop codon (and across an exon junction) to see the transcript fall; NMD predictions fail for roughly a third of premature stops, and some knockouts are compensated by related genes at the transcript level.");
    if (has("lof_truncation") || has("truncation_uncertain") || has("truncation_reinit_uncertain")) confirm.push("A truncated protein may be made: use an N-terminal and a C-terminal antibody, or a tagged read-out, and check for a smaller band.");
    if (present.some((r) => r.details.reinit)) confirm.push("An in-frame ATG downstream of the edit could restart translation: test with an antibody against the region after that methionine.");
    if (has("lof_splice") || has("splice_uncertain")) confirm.push("RT-PCR across the flanking exons shows whether the exon is skipped, the intron retained or a cryptic site used.");
    if (has("inframe") || has("inframe_region_hit") || has("stop_loss") || has("start_loss_uncertain")) confirm.push("In-frame, stop-loss and start-loss alleles make a protein: it needs a functional assay or a protein-level readout, not a sequence prediction.");
    if (context.epitope) present.forEach((r) => { if (r.details.epitopeKept === true) caveats.push(`${r.label}: the antibody epitope (residues ${context.epitope.start}-${context.epitope.end}) lies before the edit and is kept, so a Western would still detect the truncated or altered protein.`); });
    confirm.push("Sanger cannot exclude a large deletion on the other allele or an off-target event; check zygosity by out-out PCR when it matters.");
  }
  return { rows, score: { lof: lofShare, uncertain: uncertainShare, lofPct: Math.round(lofShare * 1000) / 10, uncertainPct: Math.round(uncertainShare * 1000) / 10, notLofPct: Math.round((1 - lofShare - uncertainShare) * 1000) / 10 }, call: { status, text }, caveats, confirm, donorEdits,
    context: { transcript: context.models[0].id, gene: context.models[0].gene, proteinLength: context.models[0].protLen, codingExons: context.models[0].segs.length, exonLengths: context.models[0].exonLens, regions: context.regions || [], epitope: context.epitope || null, isoforms: context.models.length, windowIdentity: Math.round(context.location.identity * 1000) / 10, accession: context.gb.accession } };
}

/** The part of the context that is safe to ship to a worker or write to JSON: no sequences. */
export function describeContext(context) {
  const m = context.models[0];
  return { accession: context.gb.accession, locus: context.gb.locus, transcript: m.id, protein: m.protein_id, gene: m.gene, product: m.product, strand: m.strand, proteinLength: m.protLen, codingExons: m.segs.length, exonLengths: m.exonLens, isoforms: context.models.map((x) => ({ id: x.id, proteinLength: x.protLen, codingExons: x.segs.length })), windowIdentity: context.location.identity, warnings: context.warnings,
    startsWithAtg: m.startsWithAtg, endsWithStop: m.endsWithStop };
}

/** "TIR domain:172-314, Death domain:67-122" and "200-250" (residue numbers of the protein in the gene record) into the option objects. */
export function parseCodingFields({ regionsText = "", epitopeText = "", gene = "", transcript = "" } = {}) {
  const range = (text) => { const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(text).trim()); if (!m) return null; const a = Number(m[1]); const b = Number(m[2]); return a >= 1 && b >= a ? { start: a, end: b } : null; };
  const problems = []; const regions = [];
  String(regionsText || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).forEach((item) => {
    const k = item.lastIndexOf(":"); const r = k > 0 ? range(item.slice(k + 1)) : range(item);
    if (r) regions.push({ name: k > 0 ? item.slice(0, k).trim() : `region ${r.start}-${r.end}`, ...r }); else problems.push(`Region not understood: "${item}" (write name:start-end, residue numbers)`);
  });
  let epitope = null; if (String(epitopeText || "").trim()) { epitope = range(epitopeText); if (!epitope) problems.push(`Epitope not understood: "${epitopeText}" (write start-end, residue numbers)`); }
  return { options: { gene, transcript, regions, epitope }, problems };
}

/**
 * The `coding` block of a design file (written by the design app): the gene region of the uploaded record, the coding segments on it and
 * the transcript names. It is turned into GenBank text so that every later step (cache key, provenance hash, worker threads) treats it like an uploaded record.
 * Coordinates are 0-based half-open indices into block.sequence; the segments are on block.strand (the coding strand, "+" for the design app).
 */
export function codingBlockToGenBank(block) {
  const seq = String(block.sequence || "").toLowerCase(); const strand = block.strand === "-" ? "-" : "+";
  const L = seq.length; const segs = (block.segments || []).map(([s, e]) => [s, e]);
  const parts = strand === "+" ? segs.map(([s, e]) => `${s + 1}..${e}`) : segs.map(([s, e]) => `${s + 1}..${e}`).reverse();
  const join = parts.length > 1 ? `join(${parts.join(",")})` : parts[0];
  const loc = strand === "+" ? join : `complement(${join})`;
  const lines = [`LOCUS       ${(block.accession || "DESIGN_REGION").replace(/\s+/g, "_")}   ${L} bp    DNA     linear   UNK`, "DEFINITION  gene region carried in the design file.", `ACCESSION   ${block.accession || "DESIGN_REGION"}`, "FEATURES             Location/Qualifiers", `     CDS             ${loc}`];
  if (block.gene) lines.push(`                     /gene="${block.gene}"`);
  if (block.transcript) lines.push(`                     /transcript_id="${block.transcript}"`);
  lines.push("ORIGIN");
  for (let i = 0; i < L; i += 60) lines.push(String(i + 1).padStart(9) + " " + seq.slice(i, i + 60).replace(/(.{10})/g, "$1 ").trimEnd());
  lines.push("//"); return lines.join("\n");
}
