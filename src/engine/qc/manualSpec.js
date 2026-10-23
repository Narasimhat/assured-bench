// Manual mode: a design hand-off built from the control trace itself, plus guide sequence(s) and optionally a
// donor (as in the ICE web tool). Used when there is no exported design.
import { buildComposition } from "./traceModel.js";
import { reverseComplement, cleanDna } from "./seq.js";
import { QC_SPEC_SCHEMA } from "./designSpec.js";
import { locateGuide, NUCLEASES, nucleaseOrDefault } from "./nucleases.js";

function fillReference(control) {
  const model = buildComposition(control);
  let out = "";
  for (let i = 0; i < model.calls.length; i += 1) {
    if (model.calls[i] !== "N") { out += model.calls[i]; continue; }
    let best = 0; for (let b = 1; b < 4; b += 1) if (model.composition[i * 4 + b] > model.composition[i * 4 + best]) best = b;
    out += "ACGT"[best];
  }
  return out;
}

// Query (donor) aligned end to end inside the reference: gaps in the query are deletions, gaps in the reference insertions.
function fitAlign(query, reference) {
  const n = query.length; const m = reference.length;
  const MATCH = 2; const MISMATCH = -3; const GAP = -5;
  const w = m + 1;
  const H = new Int32Array((n + 1) * w);
  const T = new Uint8Array((n + 1) * w);
  for (let i = 1; i <= n; i += 1) { H[i * w] = i * GAP; T[i * w] = 2; }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diag = H[(i - 1) * w + j - 1] + (query[i - 1] === reference[j - 1] ? MATCH : MISMATCH);
      const up = H[(i - 1) * w + j] + GAP;
      const left = H[i * w + j - 1] + GAP;
      let value = diag; let dir = 1;
      if (up > value) { value = up; dir = 2; }
      if (left > value) { value = left; dir = 3; }
      H[i * w + j] = value; T[i * w + j] = dir;
    }
  }
  let bj = 0; let best = -Infinity;
  for (let j = 0; j <= m; j += 1) if (H[n * w + j] > best) { best = H[n * w + j]; bj = j; }
  const ops = []; let i = n; let j = bj;
  while (i > 0) {
    const dir = T[i * w + j];
    if (dir === 1) { ops.push("M"); i -= 1; j -= 1; } else if (dir === 2) { ops.push("I"); i -= 1; } else { ops.push("D"); j -= 1; }
  }
  ops.reverse();
  return { ops, refStart: j, refEnd: bj, score: best };
}

export { locateGuide } from "./nucleases.js";

/**
 * Spec from the control read, the guides and the donor. `donor` is one sequence, or a list of donors (strings or { name, sequence }) that are used
 * together: ssODNs that each carry the edit and the blocking changes of their own guide. For point changes the markers of all donors are merged;
 * a marker carried by every donor is the intended change, one carried by some is a blocking change, and each donor lists the markers it carries.
 */
export function specFromControl(input) {
  const list = Array.isArray(input.donor) ? input.donor.map((d) => (typeof d === "string" ? { name: "", sequence: d } : d)).filter((d) => d && cleanDna(d.sequence)) : null;
  if (!list) return specFromControlOne(input);
  if (list.length <= 1) return specFromControlOne({ ...input, donor: list[0] ? list[0].sequence : "" });
  const parts = list.map((d) => specFromControlOne({ ...input, donor: d.sequence }));
  const failed = parts.find((p) => p.error); if (failed) return { error: failed.error };
  const hasBlock = (p) => p.spec.donors.some((d) => (d.insertBp || 0) > 0 || (d.replacedBp || 0) > 0);
  if (parts.some(hasBlock)) return { spec: parts[0].spec, warnings: [...(parts[0].warnings || []), "Several donors are used together only for point changes; this design has an insert or a replacement, so only the first donor was used."] };
  const spec = parts[0].spec; const warnings = []; const merged = new Map();
  for (const [i, p] of parts.entries()) {
    for (const m of p.spec.markers) {
      const seen = merged.get(m.pos);
      if (seen && seen.alt !== m.alt) return { error: `The donors disagree at position ${m.pos}: ${seen.alt} in one and ${m.alt} in another.` };
      merged.set(m.pos, seen ? { ...seen, carriedBy: seen.carriedBy + 1 } : { ...m, carriedBy: 1 });
    }
    (p.warnings || []).forEach((w) => { if (!warnings.includes(w)) warnings.push(w); });
    const donor = p.spec.donors[0];
    if (donor) spec.donors[i] = { ...donor, name: list[i].name || `donor ${i + 1}`, carriesMarkers: p.spec.markers.map((m) => m.pos) };
  }
  spec.donors = spec.donors.slice(0, parts.length);
  spec.markers = [...merged.values()].sort((a, b) => a.pos - b.pos).map(({ carriedBy, ...m }) => (carriedBy === parts.length ? { ...m, role: "intended", label: "intended change" } : { ...m, role: "blocking", label: "blocking change" }));
  spec.design.editKind = "snp";
  spec.design.label = `${parts.length} donors with ${spec.markers.length} substitution${spec.markers.length === 1 ? "" : "s"} (${spec.markers.filter((m) => m.role === "intended").length} carried by every donor)`;
  if (!spec.markers.some((m) => m.role === "intended")) { spec.markers = spec.markers.map((m) => ({ ...m, role: "unclassified", label: "" })); warnings.push("No change is carried by every donor, so none is marked as the intended edit."); }
  return { spec, warnings };
}

function specFromControlOne({ control, guides, donor = "", gene = "sample", minArm = 15, nuclease = "SpCas9", cutIndices = [] }) {
  const reference = fillReference(control);
  const warnings = [];
  const guideList = (Array.isArray(guides) ? guides : String(guides || "").split(/[,\s;]+/)).filter(Boolean);
  if (!guideList.length && !cutIndices.length) return { error: "Enter at least one guide sequence." };
  if (guideList.length > 3) return { error: "At most three guides are supported." };
  const placed = [];
  for (const guide of guideList) {
    const located = locateGuide(reference, guide, nuclease);
    if (located.error) return { error: located.error };
    if (!located.pamOk) warnings.push(`Guide ${guide}: the sequence next to it (${located.pam || "none in the read"}) is not a ${NUCLEASES[nucleaseOrDefault(nuclease)].label} PAM; the cut is placed as that nuclease would cut.`);
    placed.push(located);
  }
  // cut sites inferred from the traces stand in for guides of unknown sequence
  cutIndices.forEach((cut) => placed.push({ spacer: "", strand: "+", start: cut - 17, end: cut + 3, cut, pam: "", inferred: true }));
  const spec = {
    schema: QC_SPEC_SCHEMA, design: { type: "manual", editKind: "knockout", gene, label: "Manual entry", tag: "", codingStrand: "+" },
    reference: { sequence: reference, offset: 0, convention: "0-based index into the control read" },
    guides: placed.map((g, index) => ({ name: g.inferred ? `${gene}_cut${index + 1}` : `${gene}_g${index + 1}`, spacer: g.spacer, pam: g.pam, strand: g.strand, cut: g.cut, protospacerStart: g.start, protospacerEnd: g.end, index: index + 1 })),
    donors: [], markers: [], primers: [], amplicons: [],
  };
  const donorSeq = cleanDna(donor);
  if (donorSeq) {
    if (donorSeq.length > 300) return { error: "The donor is longer than 300 nt. Sanger deconvolution cannot quantify larger inserts; use the junction check instead." };
    const forward = fitAlign(donorSeq, reference);
    const reverse = fitAlign(reverseComplement(donorSeq), reference);
    const useReverse = reverse.score > forward.score;
    const aligned = useReverse ? reverse : forward;
    const sequence = useReverse ? reverseComplement(donorSeq) : donorSeq;
    // walk the alignment: every query base is either aligned to a reference base, inserted, or a reference base is deleted
    const steps = []; // {op, q, r}
    { let q = 0; let r = aligned.refStart; for (const op of aligned.ops) { steps.push({ op, q, r }); if (op !== "D") q += 1; if (op !== "I") r += 1; } }
    const isEvent = (step) => step.op !== "M" || sequence[step.q] !== reference[step.r];
    const indelSteps = steps.map((step, index) => ({ ...step, index })).filter((step) => step.op !== "M");
    let block = null;
    if (indelSteps.length) {
      // One block: from the first to the last insertion/deletion, widened over substitutions within 5 bases.
      let lo = indelSteps[0].index; let hi = indelSteps[indelSteps.length - 1].index;
      for (let widened = true; widened;) {
        widened = false;
        for (let k = Math.max(0, lo - 5); k < lo; k += 1) if (isEvent(steps[k])) { lo = k; widened = true; break; }
        for (let k = Math.min(steps.length - 1, hi + 5); k > hi; k -= 1) if (isEvent(steps[k])) { hi = k; widened = true; break; }
      }
      const first = steps[lo]; const last = steps[hi];
      const qEnd = last.op === "D" ? last.q : last.q + 1; const rEnd = last.op === "I" ? last.r : last.r + 1;
      block = { lo, hi, q0: first.q, q1: qEnd, r0: first.r, r1: rEnd };
    }
    const subs = [];
    steps.forEach((step, index) => { if (step.op === "M" && sequence[step.q] !== reference[step.r] && !(block && index >= block.lo && index <= block.hi)) subs.push({ pos: step.r, ref: reference[step.r], alt: sequence[step.q] }); });
    const leftArm = block ? block.q0 : (() => { let n_ = 0; for (let k = 0; k < steps.length && !isEvent(steps[k]); k += 1) n_ += 1; return n_; })();
    const rightArm = block ? sequence.length - block.q1 : (() => { let n_ = 0; for (let k = steps.length - 1; k >= 0 && !isEvent(steps[k]); k -= 1) n_ += 1; return n_; })();
    if (block && (block.q0 < minArm || sequence.length - block.q1 < minArm)) return { error: `Each homology arm must align for at least ${minArm} nt (found ${block.q0} and ${sequence.length - block.q1}).` };
    if (!block && (leftArm < minArm || rightArm < minArm)) { if (subs.length) { /* substitutions near an end are fine as long as the ends align */ } }
    if (!subs.length && !block) warnings.push("The donor is identical to the control sequence; there is no edit to detect.");
    const insertBp = block ? block.q1 - block.q0 : 0;
    const replacedBp = block ? block.r1 - block.r0 : 0;
    const arm5 = block ? block.q0 : null;
    const arm3 = block ? sequence.length - block.q1 : null;
    spec.donors.push({
      name: "donor", format: "ssodn", sequence, refStart: aligned.refStart, refEnd: aligned.refEnd, insertBp, replacedBp,
      arm5, arm3, insertStart: block ? block.r0 : null, guide: null, orientation: useReverse ? "reverse complement of the entered sequence" : "as entered",
    });
    const netChange = insertBp - replacedBp;
    subs.forEach((sub) => spec.markers.push({ ...sub, role: "unclassified", guide: null, label: "", change: `${sub.ref}>${sub.alt}` }));
    spec.design.editKind = block ? "tag_small" : "snp";
    spec.design.label = `Donor with ${subs.length} substitution${subs.length === 1 ? "" : "s"}${block ? ` and a ${insertBp}-for-${replacedBp} bp replacement (net ${netChange >= 0 ? "+" : ""}${netChange} bp)` : ""}`;
    if (subs.length > 8) warnings.push("The donor differs from the control by many substitutions; check that it is the right sequence.");
  } else spec.design.editKind = guideList.length > 1 ? "deletion" : "knockout";
  return { spec, warnings };
}
