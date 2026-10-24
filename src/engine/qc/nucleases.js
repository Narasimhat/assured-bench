// Nuclease definitions: PAM, which side of the protospacer it sits on, and where the break falls. The break position (the index of the
// first base after the cut, in the reference) is what the allele library is built around. Cas12a leaves a staggered break (after the
// 18th base on the non-target strand, the 23rd on the target strand). Named Cas12 enzymes use the target cut; the legacy Cas12a midpoint is retained.
import { ENZYMES, pamRegex } from "./enzymeConfig.js";
import { reverseComplement, cleanDna } from "./seq.js";

export const NUCLEASES = {
  SpCas9: { label: "SpCas9 (NGG)", pam: /^[ACGT]GG$/, pamLength: 3, side: "3", cut: 3, spacer: [17, 24] },
  "SpCas9-NG": { label: "SpCas9-NG (NG)", pam: /^[ACGT]G$/, pamLength: 2, side: "3", cut: 3, spacer: [17, 24] },
  SaCas9: { label: "SaCas9 (NNGRRT)", pam: /^[ACGT]{2}G[AG][AG]T$/, pamLength: 6, side: "3", cut: 3, spacer: [20, 24] },
  Cas12a: { label: "Cas12a (TTTV)", pam: /^TTT[ACG]$/, pamLength: 4, side: "5", cut: 20, spacer: [20, 24] },
  ...Object.fromEntries(Object.values(ENZYMES).filter(e => e.id !== "spcas9").map(e => [e.name, {
    label: e.name, enzyme: e.id, version: e.version, pam: pamRegex(e.pam_pattern), pamLength: e.pam_pattern.length,
    side: "5", cut: e.cut_offsets.target, cutOffsets: e.cut_offsets, spacer: [e.spacer_len.min, e.spacer_len.max],
  }])),
  SpRY: { label: "SpRY (PAM-free)", pam: /^[ACGT]+$/, pamLength: 3, side: "3", cut: 3, spacer: [17, 24] },
};

export function nucleaseOrDefault(name) {
  if (!name) return "SpCas9";
  const key = Object.keys(NUCLEASES).find(key => key.toLowerCase() === String(name).toLowerCase() || NUCLEASES[key].enzyme === name);
  if (!key) throw new Error(`Unknown nuclease: ${name}. Select a supported enzyme; it cannot be analysed as SpCas9.`);
  return key;
}
export function specNuclease(spec, guide = null) {
  const globalName = spec?.design?.enzyme?.id || spec?.design?.enzyme || spec?.design?.nuclease || spec?.nuclease;
  const of = g => g?.enzyme?.id || g?.enzyme || g?.nuclease;
  const declared = guide ? of(guide) : of(spec?.guides?.[0]);
  if (globalName && declared && nucleaseOrDefault(globalName) !== nucleaseOrDefault(declared)) throw new Error('The guide enzyme conflicts with the design nuclease.');
  if (!guide) for (const g of spec?.guides || []) if (of(g) && nucleaseOrDefault(of(g)) !== nucleaseOrDefault(globalName || declared)) throw new Error('Mixed nuclease designs require separate analyses.');
  return nucleaseOrDefault(declared || globalName);
}

export function expectedGuideGeometry(guide, spec = {}) {
  const name = specNuclease(spec, guide), n = NUCLEASES[name];
  const start = guide.protospacerStart ?? guide.start, end = guide.protospacerEnd ?? guide.end;
  const plus = guide.strand !== "-";
  const pamStart = plus === (n.side === "5") ? start - n.pamLength : end;
  const at = offset => plus ? start + offset : end - offset;
  const cut = n.side === "5" ? at(n.cut) : (plus ? end - n.cut : start + n.cut);
  const offsets = n.cutOffsets || (name === "Cas12a" ? { target: 23, non_target: 18 } : null);
  return { name, nuclease: n, pamStart, pamEnd: pamStart + n.pamLength, cut,
    ...(offsets ? { cuts: Object.fromEntries(Object.entries(offsets).map(([key, offset]) => [key, at(offset)])) } : {}) };
}

/** Place a guide on a reference (either strand). Returns { spacer, strand, start, end, cut, pam, pamOk } or { error }. */
export function locateGuide(reference, guide, nucleaseName = "SpCas9") {
  let name;
  try { name = nucleaseOrDefault(nucleaseName); } catch (error) { return { error: error.message }; }
  const nuclease = NUCLEASES[name];
  const spacer = cleanDna(guide);
  if (spacer.length < nuclease.spacer[0] || spacer.length > nuclease.spacer[1]) return { error: `Guide ${guide} must be ${nuclease.spacer[0]}-${nuclease.spacer[1]} nt for ${nuclease.label}.` };
  const slice = (from, to) => (from < 0 || to > reference.length ? "" : reference.slice(from, to));
  const find = (needle) => { const hits = []; let at = reference.indexOf(needle); while (at >= 0) { hits.push(at); at = reference.indexOf(needle, at + 1); } return hits; };
  const candidates = [];
  find(spacer).forEach((at) => {
    const end = at + spacer.length;
    const pam = nuclease.side === "3" ? slice(end, end + nuclease.pamLength) : slice(at - nuclease.pamLength, at);
    const cut = nuclease.side === "3" ? end - nuclease.cut : at + nuclease.cut;
    candidates.push({ spacer, strand: "+", start: at, end, cut, pam, pamOk: nuclease.pam.test(pam) });
  });
  find(reverseComplement(spacer)).forEach((at) => {
    const end = at + spacer.length;
    const pam = nuclease.side === "3" ? reverseComplement(slice(at - nuclease.pamLength, at)) : reverseComplement(slice(end, end + nuclease.pamLength));
    const cut = nuclease.side === "3" ? at + nuclease.cut : end - nuclease.cut;
    candidates.push({ spacer, strand: "-", start: at, end, cut, pam, pamOk: nuclease.pam.test(pam) });
  });
  if (!candidates.length) return { error: `Guide ${guide} was not found in the control sequence (either strand).` };
  candidates.sort((x, y) => Number(y.pamOk) - Number(x.pamOk));
  const chosen = candidates[0];
  const geometry = expectedGuideGeometry(chosen, { nuclease: name });
  if (geometry.cuts && Object.values(geometry.cuts).some(c => c < 0 || c > reference.length)) return { error: `The control read does not cover both predicted strand cuts for ${name}.` };
  return { ...chosen, nuclease: name, ...(nuclease.enzyme ? { enzyme: nuclease.enzyme, configVersion: nuclease.version } : {}),
    pamStart: geometry.pamStart, pamEnd: geometry.pamEnd, ...(geometry.cuts ? { cuts: geometry.cuts } : {}) };
}

export function hydrateCutGeometry(spec) {
  const name = specNuclease(spec);
  return { ...spec, design: { ...spec.design, nuclease: name }, guides: (spec.guides || []).map(guide => {
    const nuclease = NUCLEASES[specNuclease(spec, guide)];
    if ((!nuclease.cutOffsets && specNuclease(spec, guide) !== "Cas12a") || guide.protospacerStart == null) return guide;
    const geometry = expectedGuideGeometry(guide, spec);
    if (guide.cut !== geometry.cut) throw new Error(`Guide ${guide.name}: cut disagrees with ${geometry.name} geometry.`);
    if (guide.cuts && Object.entries(geometry.cuts).some(([key, value]) => guide.cuts[key] !== value)) throw new Error(`Guide ${guide.name}: strand cuts disagree with ${geometry.name} geometry.`);
    return { ...guide, cuts: geometry.cuts, pamStart: geometry.pamStart, pamEnd: geometry.pamEnd };
  }) };
}
