// Two-guide blocking (PAM / seed) changes shared by both ssODNs, a rule-based splice screen and an optional splice-predictor check for genomic SNP designs.
//
// The Genomic SNP mode installs one requested substitution. When the substitution does not stop the guides re-cutting the repaired allele,
// this module can add up to MAX_BLOCKING_CHANGES further substitutions that do, shared by the ssODNs of a two-guide pair, and screen them.
// Every choice is made with the engine's own residual-activity score (CFD) and checked against the reference.
//
// Where a change may go (the screen is positional and rule-based; it is NOT a splice-site predictor):
//  - never inside a splice-site window of an annotated exon: donor = last 3 exon bases and intron +1..+6, acceptor = intron -40..-1 and
//    first 3 exon bases (SPLICE_WINDOWS; these are this tool's cut points, stated as such);
//  - inside an exon only if it is synonymous in the coding sequence and at least 4 bases from both exon ends;
//  - otherwise (deeper intron) any base, preferring changes that do not create a new GT or AG within 60 bp of an exon.
// Splicing outcomes are still unvalidated: the optional SpliceAI check (scripts/splice_check.py) can be attached to the design.
import { scoreResidualActivity, CFD_PROTECTION_THRESHOLDS, normalizeMaxBlockingChanges, mkODN, assessGuideAgainstPointMutationDonor } from './designEngine.js';
import { complementBase, genomicAt, isReverse } from './genomicCoords.js';
import { screenSpliceChanges } from './genomicBlocking.js';
import { SPLICE_WINDOWS, exonList, classifyPosition } from './spliceZones.js';

export { SPLICE_WINDOWS, classifyPosition };

export const MAX_GUIDE_CUT_DISTANCE = 15;   // bp from the edit; HDR falls off beyond about 10
export const MIN_PAIR_CUT_SEPARATION = 10;  // the engine's own spacing for a second guide; closer cuts can excise the bases between them
export const SPLICE_CHECK_THRESHOLDS = Object.freeze({ pass: 0.05, review: 0.2 }); // SpliceAI delta score cut-offs for the effect of the blocking changes (SpliceAI itself uses 0.2 / 0.5 / 0.8 for calls)

const COMP = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const rc = (s) => String(s).split('').reverse().map((b) => COMP[b] || 'N').join('');
const AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const CODON = (() => { const t = {}; let n = 0; for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG') t[a + b + c] = AA[n++]; return t; })();
const aaOf = (codon) => CODON[codon] || 'X';

function codingMap(model) {
  const segs = (model && model.cdsSegments) || [];
  if (!segs.length || model.strand === -1) return null;
  const positions = []; for (const [s, e] of segs) for (let p = s; p < e; p += 1) positions.push(p);
  return { positions, index: new Map(positions.map((p, i) => [p, i])) };
}

function codonWith(ctx, seq, muts, codonIndex) {
  const bases = [0, 1, 2].map((k) => { const p = ctx.positions[codonIndex * 3 + k]; return muts.has(p) ? muts.get(p) : seq[p]; });
  return bases.join('');
}

/** True if every codon touched by `set` keeps the amino acid it has with the requested edit alone. */
function synonymousGivenEdit(ctx, seq, edit, set) {
  if (!ctx) return false;
  const withEdit = new Map([[edit.gp, edit.nb]]); const withAll = new Map(withEdit); set.forEach((c) => withAll.set(c.gp, c.nb));
  const codons = new Set(set.map((c) => ctx.index.has(c.gp) ? Math.floor(ctx.index.get(c.gp) / 3) : -1));
  if (codons.has(-1)) return false;
  for (const ci of codons) { if (ci * 3 + 2 >= ctx.positions.length) return false; if (aaOf(codonWith(ctx, seq, withEdit, ci)) !== aaOf(codonWith(ctx, seq, withAll, ci))) return false; }
  return true;
}

const SPLICE_DINUC = new Set(['GT', 'AG']);
/** GT or AG dinucleotides that the set creates within SPLICE_WINDOWS.crypticReach bp of an annotated exon. */
export function createdSpliceDinucleotides(model, seq, set) {
  const exons = exonList(model); if (!exons.length) return [];
  const edited = seq.split(''); set.forEach((c) => { edited[c.gp] = c.nb; });
  const near = (p) => exons.some((e) => p >= e.start - SPLICE_WINDOWS.crypticReach && p < e.end + SPLICE_WINDOWS.crypticReach);
  const out = [];
  for (const start of new Set(set.flatMap((c) => [c.gp - 1, c.gp]))) {
    if (start < 0 || start + 1 >= seq.length || !near(start)) continue;
    const before = seq[start] + seq[start + 1], after = edited[start] + edited[start + 1];
    if (SPLICE_DINUC.has(after) && !SPLICE_DINUC.has(before)) out.push({ gp: start, dinucleotide: after });
  }
  return out;
}

/** The role of a genomic index for a guide: PAM base or a protospacer position (1 = PAM-distal, 20 = PAM-proximal). */
export function guideRole(guide, p) {
  const off = p - guide.ps; if (off < 0 || off >= 23) return null;
  if (guide.str === '+') return off >= 20 ? { kind: 'pam', index: off - 20 } : { kind: 'spacer', index: off + 1 };
  return off < 3 ? { kind: 'pam', index: 2 - off } : { kind: 'spacer', index: 20 - (off - 3) };
}

function enumerateCandidates(model, seq, guides, edit, ctx) {
  const sites = new Set(); guides.forEach((g) => { for (let p = g.ps; p < g.ps + 23; p += 1) sites.add(p); }); sites.delete(edit.gp);
  const out = [];
  for (const p of sites) {
    if (!'ACGT'.includes(seq[p])) continue;
    const cls = classifyPosition(model, p);
    if (!['intron-deep', 'unknown', 'exon-interior'].includes(cls.zone)) continue;
    if (cls.zone === 'exon-interior' && !(ctx && ctx.index.has(p))) continue; // an exon base outside the CDS is not changed
    for (const nb of 'ACGT') {
      if (nb === seq[p]) continue;
      const c = { gp: p, nb, ref: seq[p], cls };
      if (cls.zone === 'exon-interior' && !synonymousGivenEdit(ctx, seq, edit, [c])) continue;
      out.push(c);
    }
  }
  return out;
}

const cfdOf = (model, guide, muts) => { const s = scoreResidualActivity(model, guide, muts); return s && Number.isFinite(s.score) ? s.score : null; };

/**
 * Smallest set of extra substitutions that makes every guide of `guides` strongly protected on the repaired allele (CFD <= 0.023, the engine's cut point).
 * Returns { feasible, changes, cfdBefore, cfdAfter, alternatives, considered, reason }.
 */
export function planBlockingSet({ model, guides, gp, alt, maxChanges }) {
  const seq = String(model.genomicSequence || ''); const edit = { gp, nb: alt }; const ctx = codingMap(model);
  const cap = normalizeMaxBlockingChanges(maxChanges); const strong = CFD_PROTECTION_THRESHOLDS.strong;
  const cfds = (set) => guides.map((g) => cfdOf(model, g, [edit, ...set]));
  const isStrong = (cf) => cf.every((c) => c !== null && c <= strong);
  const before = cfds([]);
  const done = (set, cf) => ({ set, cf });
  if (isStrong(before)) return { feasible: true, changes: [], cfdBefore: before, cfdAfter: before, alternatives: [], considered: 0 };
  const cands = enumerateCandidates(model, seq, guides, edit, ctx);
  const rankOf = (e) => { const created = createdSpliceDinucleotides(model, seq, e.set).length; const exonic = e.set.filter((c) => c.cls.zone === 'exon-interior').length; const reach = Math.min(...e.set.map((c) => c.cls.distance ?? 1e6)); return [exonic, created ? 1 : 0, Math.max(...e.cf), -Math.min(reach, 1e5)]; };
  const cmp = (a, b) => { for (let i = 0; i < a.rank.length; i += 1) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i]; return 0; };
  const valid = (set) => !set.some((c) => c.cls.zone === 'exon-interior') || synonymousGivenEdit(ctx, seq, edit, set.filter((c) => c.cls.zone === 'exon-interior'));
  let considered = 0;
  for (let size = 1; size <= cap; size += 1) {
    const found = [];
    const visit = (set) => { considered += 1; if (!valid(set)) return; const cf = cfds(set); if (isStrong(cf)) found.push(done(set, cf)); };
    if (size === 1) cands.forEach((c) => visit([c]));
    else if (size === 2) { for (let i = 0; i < cands.length; i += 1) for (let j = i + 1; j < cands.length; j += 1) if (cands[i].gp !== cands[j].gp) visit([cands[i], cands[j]]); }
    else {
      // three changes: only from the candidates that help most on their own, to keep the search small
      const gain = cands.map((c) => ({ c, g: Math.min(...cfds([c]).map((x) => (x === null ? 1 : x))) })).sort((a, b) => a.g - b.g).slice(0, 30).map((x) => x.c);
      for (let i = 0; i < gain.length; i += 1) for (let j = i + 1; j < gain.length; j += 1) for (let k = j + 1; k < gain.length; k += 1) if (new Set([gain[i].gp, gain[j].gp, gain[k].gp]).size === 3) visit([gain[i], gain[j], gain[k]]);
    }
    if (found.length) {
      found.forEach((f) => { f.rank = rankOf(f); });
      found.sort(cmp);
      const seen = new Set(); const distinct = found.filter((f) => { const key = f.set.map((c) => c.gp).sort().join(','); if (seen.has(key)) return false; seen.add(key); return true; });
      return { feasible: true, changes: distinct[0].set, cfdBefore: before, cfdAfter: distinct[0].cf, alternatives: distinct.slice(1, 4).map((f) => ({ changes: f.set, cfdAfter: f.cf })), considered };
    }
  }
  return { feasible: false, changes: [], cfdBefore: before, cfdAfter: before, alternatives: [], considered, reason: cands.length ? `No set of up to ${cap} allowed substitutions makes every guide strongly protected.` : 'No allowed position (outside the splice-site windows, synonymous inside exons) lies in the guide sites.' };
}

/**
 * The two-guide pair and the blocking set it shares. Pairs are ranked: feasible, fewest exonic changes (an exonic change near an exon is the larger splicing risk), cuts at least
 * MIN_PAIR_CUT_SEPARATION bp apart, fewest changes, fewest guide-sequence warnings, nearest cuts.
 * `candidates` are guide objects with sp, pam, str, ps, cut, d and qc; `pinned` optionally names two spacers to use.
 */
export function planGuidePair({ model, candidates, gp, alt, maxChanges, pinned = null }) {
  const eligible = candidates.filter((g) => Math.abs(g.d) <= MAX_GUIDE_CUT_DISTANCE);
  const pool = (eligible.length >= 2 ? eligible : candidates).slice(0, 6);
  const pairs = [];
  const pins = pinned && pinned.length === 2 ? candidates.filter((g) => pinned.includes(g.sp)) : [];
  if (pins.length === 2) pairs.push(pins);
  else for (let i = 0; i < pool.length; i += 1) for (let j = i + 1; j < pool.length; j += 1) pairs.push([pool[i], pool[j]]);
  const plans = pairs.map((guides) => {
    const plan = planBlockingSet({ model, guides, gp, alt, maxChanges });
    const exonic = plan.changes.filter((c) => c.cls.zone === 'exon-interior').length;
    const separation = Math.abs(guides[0].cut - guides[1].cut);
    const warns = guides.reduce((n, g) => n + ((g.qc && g.qc.warnings && g.qc.warnings.length) || 0), 0);
    return { guides, plan, exonic, separation, warns, sumD: guides.reduce((n, g) => n + Math.abs(g.d), 0) };
  });
  const key = (p) => [p.plan.feasible ? 0 : 1, p.exonic, p.separation >= MIN_PAIR_CUT_SEPARATION ? 0 : 1, p.plan.changes.length, p.warns, p.sumD];
  plans.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
  return { best: plans[0] || null, others: plans.slice(1, 4).filter((p) => p.plan.feasible), maxChanges: normalizeMaxBlockingChanges(maxChanges), triedPairs: plans.length };
}

/**
 * Delivered separately (no co-transfection): each guide gets the smallest set of its own that stops it re-cutting its repaired allele, and its own ssODN carries only that set.
 * Pairs are ranked like planGuidePair, except that the cut separation does not matter because the guides are never in the same well.
 */
export function planIndependentPair({ model, candidates, gp, alt, maxChanges, pinned = null }) {
  const eligible = candidates.filter((g) => Math.abs(g.d) <= MAX_GUIDE_CUT_DISTANCE);
  const pool = (eligible.length >= 2 ? eligible : candidates).slice(0, 6);
  const pins = pinned && pinned.length === 2 ? candidates.filter((g) => pinned.includes(g.sp)) : [];
  const memo = new Map();
  const planOf = (g) => { if (!memo.has(g.name)) memo.set(g.name, planBlockingSet({ model, guides: [g], gp, alt, maxChanges })); return memo.get(g.name); };
  const pairs = [];
  if (pins.length === 2) pairs.push(pins);
  else for (let i = 0; i < pool.length; i += 1) for (let j = i + 1; j < pool.length; j += 1) pairs.push([pool[i], pool[j]]);
  const plans = pairs.map((guides) => {
    const each = guides.map(planOf);
    const feasible = each.every((p) => p.feasible);
    const exonic = each.reduce((n, p) => n + p.changes.filter((c) => c.cls.zone === 'exon-interior').length, 0);
    const warns = guides.reduce((n, g) => n + ((g.qc && g.qc.warnings && g.qc.warnings.length) || 0), 0);
    return { guides, plans: each, feasible, reason: each.find((p) => !p.feasible)?.reason || '', exonic, changeCount: each.reduce((n, p) => n + p.changes.length, 0), separation: Math.abs(guides[0].cut - guides[1].cut), warns, sumD: guides.reduce((n, g) => n + Math.abs(g.d), 0) };
  });
  const key = (p) => [p.feasible ? 0 : 1, p.exonic, p.changeCount, p.warns, p.sumD];
  plans.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
  return { best: plans[0] || null, others: plans.slice(1, 4).filter((p) => p.feasible), maxChanges: normalizeMaxBlockingChanges(maxChanges), triedPairs: plans.length };
}

/** An engine-style mutation record (gp, nb, lb, oc, nc, pur, mt) for each change, with the purpose written from the guides it serves. */
export function describeChanges(model, changes, guides, edit) {
  const seq = String(model.genomicSequence || ''); const ctx = codingMap(model);
  return changes.map((c) => {
    const roles = guides.map((g) => { const r = guideRole(g, c.gp); if (!r) return null; if (r.kind === 'pam') { const site = seq.slice(g.ps, g.ps + 23).split(''); site[c.gp - g.ps] = c.nb; const raw = site.join(''); const pam = g.str === '+' ? raw.slice(20) : rc(raw.slice(0, 3)); return `PAM ${g.pam}→${pam} of ${g.name}`; } return `${r.index > 10 ? 'seed ' : ''}position ${r.index}/20 of ${g.name}`; }).filter(Boolean);
    const purpose = roles.join('; ') || 'blocking change';
    if (c.cls.zone === 'exon-interior' && ctx) {
      const ci = Math.floor(ctx.index.get(c.gp) / 3); const withEdit = new Map([[edit.gp, edit.nb]]); const withBoth = new Map(withEdit).set(c.gp, c.nb);
      const oc = codonWith(ctx, seq, withEdit, ci), nc = codonWith(ctx, seq, withBoth, ci);
      return { gp: c.gp, nb: c.nb, lb: `p.${aaOf(oc)}${ci + 1}${aaOf(nc)}`, oc, nc, pur: purpose, mt: 'silent', zone: c.cls.zone, location: c.cls.text };
    }
    return { gp: c.gp, nb: c.nb, lb: c.cls.zone === 'intron-deep' ? `intron ${c.cls.offset}` : 'noncoding', oc: c.ref, nc: c.nb, pur: purpose, mt: 'noncoding', zone: c.cls.zone, location: c.cls.text };
  });
}

/** Rule-based screen of the edit and the blocking changes. Not a splice-site prediction. */
export function screenSplice({ model, gp, ref, alt, changes }) {
  const seq = String(model.genomicSequence || '');
  const editClass = classifyPosition(model, gp);
  const editNote = editClass.zone === 'donor-critical' || editClass.zone === 'acceptor-critical'
    ? `The requested change lies in a splice-site window (${editClass.text}); it is expected to change splicing of that exon.`
    : editClass.zone === 'unknown' ? 'No exon annotation: the splice context of the requested change is unknown.' : `The requested change lies at ${editClass.text}.`;
  const created = createdSpliceDinucleotides(model, seq, changes.map((c) => ({ gp: c.gp, nb: c.nb })));
  const items = changes.map((c) => {
    const make = created.some((d) => Math.abs(d.gp - c.gp) <= 1);
    let risk = 'low', reason;
    if (c.zone === 'intron-deep') reason = `${c.location}; outside the splice-site windows (donor -3..+6, acceptor -40..+2).`;
    else if (c.zone === 'exon-interior') { risk = 'review'; reason = `Synonymous, ${c.location}; exonic splicing enhancers and silencers are not modelled.`; }
    else { risk = 'review'; reason = 'No exon annotation near this position; splice context unknown.'; }
    if (make) { risk = 'review'; reason += ' It creates a new GT or AG dinucleotide within 60 bp of an exon.'; }
    return { gp: c.gp, label: c.lb, change: `${c.oc}→${c.nc}`, zone: c.zone, risk, reason };
  });
  const overall = !changes.length ? 'not-applicable' : items.some((i) => i.risk === 'review') ? 'review' : 'pass';
  return { method: 'rule-based positional screen (no sequence-based splice predictor was run)', edit: { zone: editClass.zone, note: editNote }, items, overall, windows: SPLICE_WINDOWS };
}

/** What to give a splice predictor: the edit alone and the edit with each donor's blocking changes, as allele definitions on the reference. */
export function buildSpliceCheckRequest(result) {
  const inp = result.input; const b = result.blocking || {};
  // Forward genomic positions and alleles, whichever way the reference record is written; a reverse-oriented record is flagged so the script can read it.
  const refOf = (c) => forwardOf(inp, c.oc.length === 1 ? c.oc : seqRef(result, c.gp));
  const listOf = (changes) => changes.map((c) => ({ position: genomicAt(inp, c.gp), ref: refOf(c), alt: forwardOf(inp, c.nb) }));
  return {
    schema: 'assured-splice-check-request/1', assembly: inp.assembly, chromosome: String(inp.chromosome).replace(/^chr/i, ''), referenceStart: inp.referenceStart, ...(isReverse(inp) ? { orientation: -1 } : {}), referenceFile: inp.fileName || '',
    edit: { position: inp.position, ref: inp.ref, alt: inp.alt }, blocking: listOf(b.changes || []), donors: (b.donors || []).map((d) => ({ name: d.name, blocking: listOf(d.changes) })),
  };
}
const seqRef = (result, gp) => String((result.gb && result.gb.genomicSequence) || '')[gp] || 'N';
const forwardOf = (inp, base) => (isReverse(inp) ? complementBase(base) : base);

/**
 * Add the scores of scripts/splice_check.py to a design. The recommendation follows the largest score change that the blocking changes cause on the edited allele
 * (acceptor or donor, gain or loss; the worst of the ssODN alleles): <= 0.05 supports them, up to 0.2 asks for review, above 0.2 advises against them.
 */
export function applySpliceCheck(result, check) {
  if (!result || result.err || !result.blocking || !result.blocking.changes.length) throw Error('This design has no blocking changes to check.');
  if (!check || check.schema !== 'assured-splice-check-result/1') throw Error('This is not a splice check result file (schema assured-splice-check-result/1).');
  const req = buildSpliceCheckRequest(result);
  const sig = (r) => JSON.stringify([r.edit && [r.edit.position, r.edit.alt], ((r && r.donors) || []).map((d) => [d.name, (d.blocking || []).map((c) => [c.position, c.alt])])]);
  if (!check.request || sig(check.request) !== sig(req)) throw Error('The splice check was made for a different edit or different blocking changes.');
  const effect = Number(check.summary && check.summary.blockingEffectMax);
  if (!Number.isFinite(effect)) throw Error('The splice check has no summary.blockingEffectMax.');
  const verdict = effect <= SPLICE_CHECK_THRESHOLDS.pass ? 'pass' : effect <= SPLICE_CHECK_THRESHOLDS.review ? 'review' : 'fail';
  const text = { pass: `${check.tool || 'The splice predictor'} puts the largest change caused by the blocking changes at ${effect.toFixed(3)} (<= ${SPLICE_CHECK_THRESHOLDS.pass}) on the edited allele: they are supported.`,
    review: `${check.tool || 'The splice predictor'} puts the largest change caused by the blocking changes at ${effect.toFixed(3)} (between ${SPLICE_CHECK_THRESHOLDS.pass} and ${SPLICE_CHECK_THRESHOLDS.review}): review before ordering.`,
    fail: `${check.tool || 'The splice predictor'} puts the largest change caused by the blocking changes at ${effect.toFixed(3)} (> ${SPLICE_CHECK_THRESHOLDS.review}): do not use them; use another set or the exact edit.` }[verdict];
  const splice = { ...result.splice, external: { tool: check.tool || '', version: check.version || '', summary: check.summary, verdict, scores: check.scores || [] } };
  const use = verdict === 'pass' ? (splice.overall === 'review' ? 'review' : 'blockers') : verdict === 'review' ? 'review' : 'exact';
  return { ...result, splice, recommendation: { use, text: `${text}${verdict === 'pass' && splice.overall === 'review' ? ' The positional screen still lists items to review.' : ''}`, basis: 'splice predictor and positional screen' } };
}

/** The recommendation before any splice predictor result: from the positional screen. */
export function initialRecommendation(blocking, splice) {
  if (!blocking.feasible) return { use: 'exact', basis: 'positional rules', text: `${blocking.reason || 'No blocking set was found.'} Use the exact edit only and accept the re-cutting risk, or choose other guides.` };
  if (!blocking.changes.length) return { use: 'exact', basis: 'engine protection grade', text: 'The requested edit already protects both guides strongly; no blocking changes are needed.' };
  return splice.overall === 'pass'
    ? { use: 'blockers', basis: 'positional screen', text: 'Recommended: use the blocking changes. They lie outside the splice-site windows of every annotated exon and none lies in coding sequence. This is a positional screen; confirm with the splice predictor check (scripts/splice_check.py) and by RNA analysis of the edited clones.' }
    : { use: 'review', basis: 'positional screen', text: 'Review before use: the screen lists items that it cannot clear by position alone (see the table), for example silent changes inside coding sequence. Run the splice predictor check, or use the exact edit.' };
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dedupe = (changes) => { const seen = new Set(); return changes.filter((c) => { const k = `${c.gp}:${c.nb}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

/**
 * The two-guide design, as in the protein SNP knock-in tool: always two guides and two ssODNs.
 * shared = true (co-transfection): one blocking set that both guides need, carried by both ssODNs.
 * shared = false (delivered separately): each ssODN carries only the set for its own guide.
 * Every change avoids the splice-site windows and is silent inside coding sequence (see the header). The guide candidates returned are the two of the pair
 * (engine-shaped, with blockingChanges and spliceAssessment as the other policies provide). If no pair is feasible the exact-edit candidates come back unchanged with the reason.
 */
export function buildPairDesign({ model, seq, exactCandidates, gp, ref, alt, start, frame = null, shared = true, maxChanges, pinned = null }) {
  // Positions and alleles are shown on the forward genomic strand; a reverse-strand record is written along the transcript (see genomicCoords.js).
  const where = frame || { referenceStart: start, referenceEnd: start + seq.length - 1, orientation: 1 };
  const forward = (b) => (isReverse(where) ? complementBase(b) : b);
  const blocking = { mode: shared ? 'pair' : 'independent', coDelivery: shared, feasible: false, pair: [], changes: [], donors: [], reason: '', otherPairs: [], alternatives: [] };
  let candidates = exactCandidates; let splice = null;
  const note = (changeList) => changeList.map((c) => (isReverse(where) ? `${genomicAt(where, c.gp)}: ${forward(seq[c.gp])}→${forward(c.nb)} on the forward strand, ${c.oc}→${c.nc} on the transcript (${c.location})` : `${genomicAt(where, c.gp)}: ${c.oc}→${c.nc} (${c.location})`));
  const edited = seq.slice(0, gp) + alt + seq.slice(gp + 1);
  if (exactCandidates.length < 2) blocking.reason = 'Fewer than two SpCas9 guides were found within 30 bp, so a two-guide design is not possible.';
  else {
    const planned = shared ? planGuidePair({ model, candidates: exactCandidates, gp, alt, maxChanges, pinned }) : planIndependentPair({ model, candidates: exactCandidates, gp, alt, maxChanges, pinned });
    const best = planned.best;
    const feasible = best && (shared ? best.plan.feasible : best.feasible);
    if (!feasible) blocking.reason = best ? (shared ? best.plan.reason : best.reason) : 'No guide pair could be evaluated.';
    else {
      const index = (g) => exactCandidates.findIndex((c) => c.name === g.name);
      const perGuideChanges = shared
        ? best.guides.map(() => describeChanges(model, best.plan.changes, best.guides, { gp, nb: alt }))
        : best.guides.map((g, at) => describeChanges(model, best.plans[at].changes, [g], { gp, nb: alt }));
      const donors = best.guides.map((g, at) => mkODN(model, g, [gp], [alt], perGuideChanges[at], null));
      const exactBases = donors.every((donor, at) => {
        if (!donor) return false;
        const expected = new Map([[gp, alt], ...perGuideChanges[at].map((c) => [c.gp, c.nb])]);
        const wt = seq.slice(donor.donorStart, donor.donorEnd);
        const diff = [...wt].flatMap((b, i) => (b !== donor.genomicDonor[i] ? [donor.donorStart + i] : []));
        return diff.length === expected.size && diff.every((p) => expected.has(p) && donor.genomicDonor[p - donor.donorStart] === expected.get(p))
          && donor.od === (donor.sl === '- strand target' ? rc(donor.genomicDonor) : donor.genomicDonor);
      });
      if (!exactBases) blocking.reason = 'A blocking change falls outside the ssODN window of one guide, or a donor failed validation; no blocking set is offered.';
      else {
        const order = (list) => list.map((g) => g.name).join(' + ');
        candidates = best.guides.map((g, at) => {
          const c = exactCandidates[index(g)]; const donor = donors[at]; const changes = perGuideChanges[at];
          const own = { ...c, donor, inPair: true, protection: assessGuideAgainstPointMutationDonor(c, donor), blockingChanges: changes, comparison: null, spliceAssessment: screenSpliceChanges(model, edited, changes),
            nucleotideValidation: { valid: true, differences: 1 + changes.length, additionalChanges: changes.length, blockingPositions: changes.map((x) => genomicAt(where, x.gp)) } };
          return shared ? { ...own, crossProtection: best.guides.map((x) => ({ guideName: x.name, ...assessGuideAgainstPointMutationDonor(x, donor) })) } : own;
        }).sort((a, b) => index(a) - index(b));
        const union = dedupe(candidates.flatMap((c) => c.blockingChanges));
        const cfd = shared ? { cfdBefore: best.plan.cfdBefore, cfdAfter: best.plan.cfdAfter } : { cfdBefore: best.plans.map((p) => p.cfdBefore[0]), cfdAfter: best.plans.map((p) => p.cfdAfter[0]) };
        const guideOrder = best.guides.map((g) => g.name);
        const reorder = (arr) => candidates.map((c) => arr[guideOrder.indexOf(c.name)]);
        Object.assign(blocking, { feasible: true, pair: candidates.map((c) => c.name), separation: best.separation, minSeparation: shared ? MIN_PAIR_CUT_SEPARATION : 0, changes: union,
          donors: candidates.map((c) => ({ name: c.name, changes: c.blockingChanges })), cfdBefore: reorder(cfd.cfdBefore), cfdAfter: reorder(cfd.cfdAfter), maxChanges: planned.maxChanges, reason: '',
          alternatives: shared ? best.plan.alternatives.map((a) => ({ changes: note(describeChanges(model, a.changes, best.guides, { gp, nb: alt })), cfdAfter: a.cfdAfter })) : [],
          otherPairs: planned.others.map((o) => ({ pair: order(o.guides), separation: o.separation, changes: shared ? note(describeChanges(model, o.plan.changes, o.guides, { gp, nb: alt }))
            : o.guides.map((g, at) => `${g.name}: ${note(describeChanges(model, o.plans[at].changes, [g], { gp, nb: alt })).join(', ') || 'none'}`) })) });
      }
    }
  }
  if (blocking.feasible) splice = screenSplice({ model, gp, ref, alt, changes: blocking.changes });
  const recommendation = initialRecommendation(blocking, splice || { overall: 'not-applicable' });
  const added = blocking.feasible ? blocking.changes.length : 0;
  const sep = blocking.feasible && shared && blocking.separation < MIN_PAIR_CUT_SEPARATION;
  const warnings = {
    lead: [blocking.feasible ? (added ? `${added} blocking substitution${added === 1 ? '' : 's'} added (${shared ? 'the same on both ssODNs' : 'each ssODN carries those of its own guide'}; see Blocking changes). Review each guide against the repaired allele.` : 'The requested edit already protects both guides strongly; no blocking substitutions were added.') : `No blocking set was added: ${blocking.reason}`,
      blocking.feasible && added ? 'Splice effects were screened by position only; no splice predictor was run. Splicing and protein outcomes are not validated.' : 'Splicing and protein outcomes are not predicted. An unchanged annotated CDS does not validate mature RNA or protein.'],
    trail: [blocking.feasible ? (shared ? 'Co-delivery: both guides and both ssODNs go into the same electroporation; each ssODN carries the changes for both guides.' : 'Delivered separately: electroporate each guide with its own ssODN; do not pool the two pairs.') : 'Alternative guides and donors are separate candidates; do not pool them.',
      ...(sep ? [`The two cuts are ${blocking.separation} bp apart (below ${MIN_PAIR_CUT_SEPARATION}); with both guides active the bases between them can be excised. Screen for it.`] : [])],
  };
  const pairStrong = blocking.feasible && (shared ? candidates.every((c) => c.crossProtection.every((p) => p.tier === 'strong')) : candidates.every((c) => c.protection.tier === 'strong'));
  return { candidates, blocking, splice, recommendation, warnings, feasible: blocking.feasible, pairStrong };
}

/** The report block for a two-guide design: recommendation, the changes with the ssODNs that carry them and their splice screen, the guide pair, and how to run the optional splice check. */
export function pairSectionHtml(r) {
  const b = r && r.blocking; if (!b) return '';
  const e = escapeHtml; const rec = r.recommendation; const reverse = isReverse(r.input);
  const label = { blockers: 'Use the blocking changes', review: 'Review before use', exact: 'Use the exact edit only' };
  const parts = [`<h2>Blocking changes and splice screen</h2>`];
  if (rec) parts.push(`<p><strong>${e(label[rec.use] || rec.use)}.</strong> ${e(rec.text)} <span class="sub">(basis: ${e(rec.basis)})</span></p>`);
  if (b.feasible) {
    const fmt = (arr) => arr.map((x) => (x === null || x === undefined ? 'n/a' : x.toFixed(3))).join(', ');
    parts.push(`<p>Guide pair: ${e(b.pair.join(' + '))}; ${b.coDelivery ? `co-delivered, both ssODNs carry the same changes; cuts ${b.separation} bp apart${b.separation < b.minSeparation ? ` (below ${b.minSeparation}: the bases between the cuts can be excised)` : ''}` : 'delivered separately, each ssODN carries only the changes for its own guide'}. Residual CFD on the repaired allele, ${e(b.pair.join(', '))}: ${fmt(b.cfdBefore)} with the requested edit alone, ${fmt(b.cfdAfter)} with the blocking changes.</p>`);
    if (b.changes.length) {
      const screen = new Map((r.splice ? r.splice.items : []).map((i) => [i.gp, i]));
      const carriedBy = (c) => { const n = (b.donors || []).filter((d) => d.changes.some((x) => x.gp === c.gp && x.nb === c.nb)).map((d) => d.name); return n.length === (b.donors || []).length && n.length > 1 ? 'both ssODNs' : n.join(', '); };
      const head = `<tr><th>Position</th><th>Change</th><th>Where</th><th>Purpose</th><th>Carried by</th>${r.splice ? '<th>Splice screen</th>' : ''}</tr>`;
      const rows = b.changes.map((c) => { const s = screen.get(c.gp); return `<tr><td>${e(`${r.input.assembly} chr${r.input.chromosome}:${genomicAt(r.input, c.gp)}`)}</td><td>${e(reverse ? `${complementBase(r.gb.genomicSequence[c.gp])}→${complementBase(c.nb)} forward strand (${c.oc}→${c.nc} on the transcript)` : `${c.oc}→${c.nc}`)}</td><td>${e(c.location)}</td><td>${e(c.pur)}</td><td>${e(carriedBy(c))}</td>${r.splice ? `<td>${s ? `${e(s.risk)}: ${e(s.reason)}` : ''}</td>` : ''}</tr>`; }).join('');
      parts.push(`<table>${head}${rows}</table>`);
    }
    if (r.splice) parts.push(`<p class="sub">${e(r.splice.edit.note)} Screen: ${e(r.splice.method)}.</p>`);
    if (r.splice && r.splice.external) { const x = r.splice.external; parts.push(`<p>${e(x.tool)} ${e(x.version)}: largest change caused by the blocking changes ${Number(x.summary.blockingEffectMax).toFixed(3)}; verdict ${e(x.verdict)}.</p>`); }
    else if (r.splice && b.changes.length) parts.push('<p class="sub">Optional: confirm with a splice predictor. Download the splice-check request from the app and run scripts/splice_check.py; attach its result to the design to update the recommendation.</p>');
    if (b.alternatives.length || b.otherPairs.length) parts.push(`<p class="sub">Alternatives that meet the same rules: ${[...b.alternatives.map((a) => `same pair, ${a.changes.join(' and ')}`), ...b.otherPairs.map((o) => `${o.pair}${b.coDelivery ? ` (cuts ${o.separation} bp apart)` : ''}: ${(Array.isArray(o.changes) ? o.changes.join(b.coDelivery ? ' and ' : '; ') : o.changes) || 'no changes'}`)].map(e).join('; ')}.</p>`);
  } else parts.push(`<p>${e(b.reason)}</p>`);
  return parts.join('');
}
