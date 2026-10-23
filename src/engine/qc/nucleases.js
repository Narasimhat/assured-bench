// Nuclease definitions: PAM, which side of the protospacer it sits on, and where the break falls. The break position (the index of the
// first base after the cut, in the reference) is what the allele library is built around. Cas12a leaves a staggered break (after the
// 18th base on the non-target strand, the 23rd on the target strand); the middle (20) is used, and the indel library spans both.
import { reverseComplement, cleanDna } from "./seq.js";

export const NUCLEASES = {
  SpCas9: { label: "SpCas9 (NGG)", pam: /^[ACGT]GG$/, pamLength: 3, side: "3", cut: 3, spacer: [17, 24] },
  "SpCas9-NG": { label: "SpCas9-NG (NG)", pam: /^[ACGT]G$/, pamLength: 2, side: "3", cut: 3, spacer: [17, 24] },
  SaCas9: { label: "SaCas9 (NNGRRT)", pam: /^[ACGT]{2}G[AG][AG]T$/, pamLength: 6, side: "3", cut: 3, spacer: [20, 24] },
  Cas12a: { label: "Cas12a (TTTV)", pam: /^TTT[ACG]$/, pamLength: 4, side: "5", cut: 20, spacer: [20, 24] },
  SpRY: { label: "SpRY (PAM-free)", pam: /^[ACGT]+$/, pamLength: 3, side: "3", cut: 3, spacer: [17, 24] },
};

export function nucleaseOrDefault(name) { return NUCLEASES[name] ? name : "SpCas9"; }

/** Place a guide on a reference (either strand). Returns { spacer, strand, start, end, cut, pam, pamOk } or { error }. */
export function locateGuide(reference, guide, nucleaseName = "SpCas9") {
  const nuclease = NUCLEASES[nucleaseOrDefault(nucleaseName)];
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
  return candidates[0];
}
