// Reads the design hand-off (schema assured-qc-design/1) and checks that it is internally consistent
// before any trace is analysed: a spec that disagrees with its own reference would give confident but
// wrong allele calls.

import { isDna, reverseComplement } from "./seq.js";

export const QC_SPEC_SCHEMA = "assured-qc-design/1";
export const EDIT_KINDS = ["knockout", "deletion", "snp", "tag_small", "tag_large", "reporter", "internal_tag", "terminal_tag"];

export function validateDesignSpec(spec) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);
  if (!spec || typeof spec !== "object") return { ok: false, errors: ["The design file is not a JSON object."], warnings };
  if (spec.schema !== QC_SPEC_SCHEMA) fail(`Unsupported schema "${spec.schema}" (expected ${QC_SPEC_SCHEMA}).`);
  const reference = String(spec.reference?.sequence || "").toUpperCase();
  if (!isDna(reference)) fail("reference.sequence must be A, C, G and T only.");
  const length = reference.length;
  if (!EDIT_KINDS.includes(spec.design?.editKind)) fail(`design.editKind must be one of ${EDIT_KINDS.join(", ")}.`);
  const inside = (value, label, upper = length) => {
    if (!Number.isInteger(value) || value < 0 || value > upper) fail(`${label} (${value}) lies outside the reference window (0-${upper}).`);
  };

  (spec.guides || []).forEach((guide, index) => {
    const label = `Guide ${index + 1} (${guide.name || "unnamed"})`;
    inside(guide.cut, `${label} cut`);
    const spacer = String(guide.spacer || "").toUpperCase();
    if (!isDna(spacer) || spacer.length < 17 || spacer.length > 24) fail(`${label}: spacer must be 17-24 nt of DNA.`);
    if (guide.protospacerStart !== null && guide.protospacerStart !== undefined) {
      const site = reference.slice(guide.protospacerStart, guide.protospacerEnd);
      const expected = guide.strand === "+" ? spacer : reverseComplement(spacer);
      if (site !== expected) fail(`${label}: the spacer does not match the reference at ${guide.protospacerStart}-${guide.protospacerEnd} on the ${guide.strand} strand.`);
      const cut = guide.strand === "+" ? guide.protospacerEnd - 3 : guide.protospacerStart + 3;
      if (cut !== guide.cut) fail(`${label}: cut index ${guide.cut} is not 3 bp from the PAM (expected ${cut}).`);
      const pamSite = guide.strand === "+"
        ? reference.slice(guide.protospacerEnd, guide.protospacerEnd + 3)
        : reverseComplement(reference.slice(guide.protospacerStart - 3, guide.protospacerStart));
      if (!/^[ACGT]GG$/.test(pamSite)) warnings.push(`${label}: PAM ${pamSite} is not NGG on the reference (it may be changed on purpose by a blocking edit).`);
    } else warnings.push(`${label}: protospacer position not given; the cut index is taken as stated.`);
  });

  // Optional coding block (the gene region and its coding exons, written by the design app): checked for consistency with the reference window.
  if (spec.coding !== undefined && spec.coding !== null) {
    const block = spec.coding; const cseq = String(block.sequence || "").toUpperCase(); const segments = Array.isArray(block.segments) ? block.segments : [];
    if (!isDna(cseq)) fail("coding.sequence must be A, C, G and T only.");
    if (!segments.length) fail("coding.segments must list the coding exons ([start, end] pairs).");
    let total = 0; let previous = -1;
    segments.forEach((pair, index) => {
      const [s, e] = Array.isArray(pair) ? pair : [];
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > cseq.length || e <= s) fail(`coding segment ${index + 1} is not a valid interval inside coding.sequence.`);
      else { if (s < previous) fail("coding.segments must be in order and must not overlap."); previous = e; total += e - s; }
    });
    if (segments.length && total % 3 !== 0) warnings.push(`The coding segments add up to ${total} nt, not a multiple of three; the functional knockout assessment will not use them.`);
    if (Number.isInteger(spec.reference?.offset) && Number.isInteger(block.offset) && !spec.reference?.mirrored) {
      const from = spec.reference.offset - block.offset;
      if (from < 0 || cseq.slice(from, from + length) !== reference) fail("coding.sequence does not contain the reference window at the stated offsets.");
    }
  }

  const markers = spec.markers || [];
  markers.forEach((marker, index) => {
    inside(marker.pos, `Marker ${index + 1} position`, length - 1);
    if (reference[marker.pos] !== marker.ref) fail(`Marker at ${marker.pos}: reference base is ${reference[marker.pos]}, not ${marker.ref}.`);
    if (marker.alt === marker.ref) fail(`Marker at ${marker.pos}: alternate base equals the reference base.`);
  });

  (spec.donors || []).forEach((donor, index) => {
    const label = `Donor ${index + 1} (${donor.name || "unnamed"})`;
    const sequence = String(donor.sequence || "").toUpperCase();
    if (!isDna(sequence)) fail(`${label}: sequence must be A, C, G and T only.`);
    inside(donor.refStart, `${label} refStart`);
    inside(donor.refEnd, `${label} refEnd`);
    if (donor.refEnd <= donor.refStart) fail(`${label}: refEnd must exceed refStart.`);
    const insertBp = donor.insertBp || 0;
    const replaced = donor.replacedBp || 0;
    const refSpan = donor.refEnd - donor.refStart;
    if (sequence.length - insertBp !== refSpan - replaced) fail(`${label}: donor length ${sequence.length} minus insert ${insertBp} does not equal the reference span ${refSpan} minus replaced ${replaced}.`);
    // Arms and marker bases must agree with the reference: every difference outside the insert is a declared marker.
    const k = Number.isInteger(donor.arm5) ? donor.arm5 : (Number.isInteger(donor.insertStart) ? donor.insertStart - donor.refStart : null);
    const declared = new Set(markers.map((marker) => marker.pos));
    const compare = (donorSlice, refStart, label2) => {
      for (let i = 0; i < donorSlice.length; i += 1) {
        const pos = refStart + i;
        if (donorSlice[i] !== reference[pos] && !declared.has(pos)) fail(`${label}: donor differs from the reference at ${pos} (${label2}) but no marker declares it.`);
        if (donorSlice[i] !== reference[pos] && declared.has(pos)) {
          const marker = markers.find((entry) => entry.pos === pos);
          if (marker.alt !== donorSlice[i]) fail(`${label}: marker at ${pos} says ${marker.alt} but the donor carries ${donorSlice[i]}.`);
        }
      }
    };
    if (insertBp > 0 && k !== null) {
      compare(sequence.slice(0, k), donor.refStart, "5' arm");
      compare(sequence.slice(k + insertBp), donor.refStart + k + replaced, "3' arm");
    } else if (insertBp === 0) compare(sequence, donor.refStart, "donor");
  });

  (spec.primers || []).forEach((primer) => {
    if (primer.start === null || primer.start === undefined) { warnings.push(`Primer ${primer.name} is not placed on the reference.`); return; }
    const site = reference.slice(primer.start, primer.end);
    const expected = primer.strand === "+" ? primer.sequence : reverseComplement(primer.sequence);
    if (site !== String(expected).toUpperCase()) fail(`Primer ${primer.name} does not match the reference at ${primer.start}-${primer.end}.`);
  });
  (spec.amplicons || []).forEach((amplicon) => {
    const fw = (spec.primers || []).find((primer) => primer.name === amplicon.forward);
    const rv = (spec.primers || []).find((primer) => primer.name === amplicon.reverse);
    if (fw && rv && rv.end - fw.start !== amplicon.wtBp) fail(`Amplicon ${amplicon.name}: stated wild-type size ${amplicon.wtBp} bp, primers give ${rv.end - fw.start} bp.`);
  });
  return { ok: errors.length === 0, errors, warnings };
}


const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A" };
const complementBase = (base) => COMPLEMENT[base] || base;

/**
 * The same design seen from the other strand: reference and donors reverse-complemented, coordinates mirrored.
 * Used when a trace was read from the reverse primer, so that every later step can assume the read runs along
 * increasing reference indices.
 */
export function reverseSpec(spec) {
  const length = spec.reference.sequence.length;
  const mirror = (position) => (position === null || position === undefined ? position : length - 1 - position);
  const boundary = (position) => (position === null || position === undefined ? position : length - position);
  const flip = (strand) => (strand === "+" ? "-" : strand === "-" ? "+" : strand);
  return {
    ...spec,
    reference: { ...spec.reference, sequence: reverseComplement(spec.reference.sequence), mirrored: !spec.reference.mirrored },
    guides: (spec.guides || []).map((guide) => ({
      ...guide, strand: flip(guide.strand), cut: boundary(guide.cut),
      protospacerStart: boundary(guide.protospacerEnd), protospacerEnd: boundary(guide.protospacerStart),
    })),
    donors: (spec.donors || []).map((donor) => {
      const replaced = donor.replacedBp || 0;
      const hasInsert = (donor.insertBp || 0) > 0 || replaced > 0;
      const arm5 = Number.isInteger(donor.arm5) ? donor.arm5 : (Number.isInteger(donor.insertStart) ? donor.insertStart - donor.refStart : null);
      const arm3 = hasInsert && arm5 !== null ? donor.refEnd - donor.refStart - arm5 - replaced : donor.arm3;
      return {
        ...donor,
        sequence: reverseComplement(donor.sequence),
        refStart: boundary(donor.refEnd), refEnd: boundary(donor.refStart),
        arm5: hasInsert && arm5 !== null ? arm3 : donor.arm5, arm3: hasInsert && arm5 !== null ? arm5 : donor.arm3,
        insertStart: Number.isInteger(donor.insertStart) ? boundary(donor.insertStart) - replaced : donor.insertStart,
        carriesMarkers: donor.carriesMarkers ? donor.carriesMarkers.map(mirror) : donor.carriesMarkers,
      };
    }),
    markers: (spec.markers || []).map((marker) => ({ ...marker, pos: mirror(marker.pos), ref: complementBase(marker.ref), alt: complementBase(marker.alt) })).sort((a, b) => a.pos - b.pos),
    primers: (spec.primers || []).map((primer) => ({ ...primer, start: boundary(primer.end), end: boundary(primer.start), strand: flip(primer.strand) })),
    amplicons: [],
  };
}
