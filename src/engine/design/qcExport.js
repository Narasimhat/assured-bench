// Design hand-off for the Sanger QC app: the facts a clone or pool analysis needs, in one JSON object.
//
// Pure function of a design result (src/designEngine.js). It carries the reference window, the guides with
// their cut positions, the donors placed on the reference, every base the donor changes (intended edit or
// blocking change), the primers, and the expected amplicon sizes. The QC app builds its expected-allele
// library from this object alone, so it does not need the design engine.
//
// Coordinates are 0-based indices into reference.sequence (a window of the uploaded reference starting at
// reference.offset). A cut index c means the cut lies between bases c-1 and c on the + strand.
//
// The optional `coding` block carries the gene region (coding.sequence, starting at coding.offset in the same uploaded reference) and the coding exons as
// [start, end) pairs inside it, for the QC app's functional knockout assessment.

import { guideGeometry } from "./enzymeModelGuides.js";
export const QC_SPEC_SCHEMA = "assured-qc-design/1";

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A" };
const reverseComplement = (sequence) => [...String(sequence)].reverse().map((base) => COMPLEMENT[base] || "N").join("");

function mismatches(a, b) {
  let count = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) if (a[i] !== b[i]) count += 1;
  return count + Math.abs(a.length - b.length);
}

// Ungapped placement of a short sequence on the reference: exact if possible, otherwise the best window
// within maxMismatch (blocking changes sit inside arms, so arms rarely match exactly).
function placeSequence(genome, sequence, maxMismatch = 0) {
  const query = String(sequence).toUpperCase();
  if (!query) return null;
  const forward = genome.indexOf(query);
  if (forward >= 0) return { start: forward, end: forward + query.length, strand: "+", mismatches: 0 };
  const reverse = genome.indexOf(reverseComplement(query));
  if (reverse >= 0) return { start: reverse, end: reverse + query.length, strand: "-", mismatches: 0 };
  if (!maxMismatch) return null;
  let best = null;
  for (const [strand, probe] of [["+", query], ["-", reverseComplement(query)]]) {
    for (let start = 0; start + probe.length <= genome.length; start += 1) {
      let count = 0;
      for (let i = 0; i < probe.length && count <= maxMismatch; i += 1) if (genome[start + i] !== probe[i]) count += 1;
      if (count <= maxMismatch && (!best || count < best.mismatches)) best = { start, end: start + probe.length, strand, mismatches: count };
    }
  }
  return best;
}

function describeGuide(genome, guide, index, name) {
  if (guide.enzyme && guide.enzyme !== "spcas9") {
    const bounds = guideGeometry(guide);
    return { name: guide.n || name, spacer: guide.sp, pam: guide.pm || guide.pam, strand: guide.str, cut: guide.cut,
      protospacerStart: bounds.spacerStart, protospacerEnd: bounds.spacerEnd,
      pamStart: bounds.pamStart, pamEnd: bounds.pamEnd, cuts: guide.cuts, enzyme: guide.enzyme,
      offsetFromEdit: guide.d ?? null, index: index + 1 };
  }
  const spacer = String(guide.sp).toUpperCase();
  const placed = placeSequence(genome, spacer);
  let pam = guide.pam || "";
  let strand = guide.str || (placed ? placed.strand : "+");
  if (placed) {
    strand = placed.strand;
    pam = strand === "+" ? genome.slice(placed.end, placed.end + 3) : reverseComplement(genome.slice(placed.start - 3, placed.start));
  }
  return { name, spacer, pam, strand, cut: guide.cut, protospacerStart: placed ? placed.start : null, protospacerEnd: placed ? placed.end : null, offsetFromEdit: guide.d ?? null, index: index + 1 };
}

// Where the donor's arms sit on the reference and which bases it changes.
function alignInsertDonor(genome, donor, insertBp, arm5, arm3, replacedBp) {
  const probe = placeSequence(genome, donor.slice(0, Math.min(arm5, 40)), 2);
  if (!probe || probe.strand !== "+") return null;
  const refStart = probe.start;
  const refEnd = refStart + arm5 + replacedBp + arm3;
  const left = genome.slice(refStart, refStart + arm5);
  const right = genome.slice(refEnd - arm3, refEnd);
  const donorLeft = donor.slice(0, arm5);
  const donorRight = donor.slice(arm5 + insertBp);
  return { refStart, refEnd, arm5, arm3, insertBp, replacedBp, left, right, donorLeft, donorRight, mismatchCount: mismatches(left, donorLeft) + mismatches(right, donorRight) };
}

function collectMarkers(genome, placement, silent, intendedPositions) {
  const markers = [];
  const consider = (refSeq, donorSeq, refPos0) => {
    for (let i = 0; i < donorSeq.length; i += 1) {
      if (donorSeq[i] === refSeq[i]) continue;
      const pos = refPos0 + i;
      const known = (silent || []).find((entry) => entry.gp === pos);
      const intended = intendedPositions.has(pos);
      markers.push({
        pos, ref: refSeq[i], alt: donorSeq[i],
        role: intended ? "intended" : "blocking",
        guide: known?.gi ?? null,
        label: known?.lb || (intended ? "intended change" : ""),
        change: known && known.oc && known.nc ? `${known.oc}>${known.nc}` : `${refSeq[i]}>${donorSeq[i]}`,
      });
    }
  };
  consider(placement.left, placement.donorLeft, placement.refStart);
  consider(placement.right, placement.donorRight, placement.refEnd - placement.arm3);
  return markers;
}

// The gene region and its coding exons, so the QC app can judge a knockout on the protein (nonsense-mediated decay, truncation, splice sites) without a second GenBank upload.
// Same coordinate system as the reference window: 0-based, half-open indices into coding.sequence, which is a stretch of the uploaded reference starting at coding.offset.
// The design engine takes the uploaded record as the coding strand, so the strand is "+". Omitted when the record has no complete CDS or the region is very large.
function buildCodingBlock(result, genome, windowStart, windowEnd, maxRegion) {
  const gb = result.gb || {};
  const segments = (gb.cdsSegments || []).map((pair) => [Number(pair[0]), Number(pair[1])]).filter(([s, e]) => Number.isInteger(s) && Number.isInteger(e) && e > s).sort((a, b) => a[0] - b[0]);
  if (!segments.length) return null;
  const total = segments.reduce((sum, [s, e]) => sum + (e - s), 0);
  if (total % 3 !== 0) return null;
  const from = Math.min(segments[0][0], windowStart); const to = Math.max(segments[segments.length - 1][1], windowEnd);
  if (to - from > maxRegion) return null;
  return {
    strand: "+", gene: gb.gene || result.gene || "", transcript: gb.transcriptId || "", proteinLength: Number.isInteger(gb.proteinLength) ? gb.proteinLength : null,
    offset: from, sequence: genome.slice(from, to), segments: segments.map(([s, e]) => [s - from, e - from]),
    convention: "0-based half-open indices into sequence, which starts at offset in the uploaded reference; segments are the coding exons on the + (coding) strand",
  };
}

export function buildQcDesignSpec(result, options = {}) {
  const pad = options.windowPad ?? 300;
  if (!result || result.err) return { err: "No design result to export." };
  const genome = String(result.gb?.genomicSequence || "").toUpperCase();
  if (!genome) return { err: "The design result does not carry its reference sequence." };
  const type = result.type;
  const guides = (result.gs || []).slice(0, 3).map((guide, index) => describeGuide(genome, guide, index, guide.name || `${result.gene || "gene"}_gRNA${index + 1}`));
  const donors = [];
  const markerList = [];
  let editKind = type === "ko" ? "deletion" : (type === "pm" || type === "genomic-snv") ? "snp" : type === "it" ? "internal_tag" : "terminal_tag";
  let intendedDescription = "";

  if (type === "ct" || type === "nt") {
    const insertBp = result.il;
    // The native stop (C-terminal) or start (N-terminal) codon is replaced by the cassette, which carries its own.
    const replacedBp = 3;
    const known = result.donorReferenceInterval;
    const placement = known ? { refStart: known.start, refEnd: known.end, arm5: result.h5l, arm3: result.h3l, insertBp, replacedBp,
      left: genome.slice(known.start, known.start + result.h5l), right: genome.slice(known.end - result.h3l, known.end),
      donorLeft: result.donor.slice(0, result.h5l), donorRight: result.donor.slice(result.h5l + insertBp) }
      : alignInsertDonor(genome, result.donor, insertBp, result.h5l, result.h3l, replacedBp);
    if (!placement) return { err: "The donor could not be placed on the reference." };
    const markers = collectMarkers(genome, placement, result.ss, new Set());
    markers.forEach((marker) => markerList.push(marker));
    const format = result.donorFormat?.format || (result.donor.length <= 200 ? "ssodn" : "block");
    donors.push({
      name: `${result.gene}_${type}_donor`, format, sequence: result.donor, refStart: placement.refStart, refEnd: placement.refEnd,
      insertBp, arm5: result.h5l, arm3: result.h3l, replacedBp,
      insertStart: placement.refStart + result.h5l, // insert sits in the donor at donor index arm5
      guide: null,
      orderStrands: (result.donorFormat?.orderStrands || []).map((entry) => ({ strand: entry.strand, guides: entry.guideNames })),
    });
    editKind = format === "block" || format === "aav" ? (insertBp > 300 ? "reporter" : "tag_large") : "tag_small";
    intendedDescription = `${type === "ct" ? "C" : "N"}-terminal knock-in of ${result.tag} (${insertBp} bp)`;
  } else if (type === "pm" || type === "it" || type === "genomic-snv") {
    const insertBp = type === "it" ? result.il : 0;
    const rawDonors = result.os?.length
      ? result.os
      : (result.candidates || []).map((c, idx) => ({
          ...c.donor,
          n: `ssODN${idx + 1}`,
          gi: idx,
          desiredDiffIndexes: Number.isFinite(result.gp) && Number.isFinite(c.donor?.donorStart) ? [result.gp - c.donor.donorStart] : [],
        }));
    rawDonors.forEach((donor, index) => {
      const genomic = String(donor.genomicDonor || donor.donorSense || "").toUpperCase();
      const refSegment = genome.slice(donor.donorStart, donor.donorEnd);
      const k = type === "it" ? donor.senseInsertStart : null;
      const intendedPositions = new Set(result.enzyme && result.type === "pm" ? (result.ch || []).map(change => change.p)
        : (donor.desiredDiffIndexes || (Number.isFinite(result.gp) && Number.isFinite(donor.donorStart) ? [result.gp - donor.donorStart] : [])).map((i) => donor.donorStart + i));
      const placement = type === "it"
        ? { left: refSegment.slice(0, k), donorLeft: genomic.slice(0, k), right: refSegment.slice(k), donorRight: genomic.slice(k + insertBp), refStart: donor.donorStart, refEnd: donor.donorEnd, arm3: refSegment.length - k }
        : { left: refSegment, donorLeft: genomic, right: "", donorRight: "", refStart: donor.donorStart, refEnd: donor.donorEnd, arm3: 0 };
      const markers = collectMarkers(genome, placement, result.ss, intendedPositions);
      markers.forEach((marker) => { if (!markerList.some((existing) => existing.pos === marker.pos && existing.alt === marker.alt)) markerList.push(marker); });
      donors.push({
        name: donor.n || `ssODN${index + 1}`, format: "ssodn", sequence: genomic, refStart: donor.donorStart, refEnd: donor.donorEnd,
        insertBp, arm5: type === "it" ? k : null, arm3: type === "it" ? refSegment.length - k : null, replacedBp: 0,
        insertStart: type === "it" ? donor.donorStart + k : null,
        guide: (donor.gi ?? index) + 1, orderSequence: donor.od, orderStrand: donor.sl || "",
        carriesMarkers: markers.map((marker) => marker.pos),
      });
    });
    intendedDescription = type === "pm"
      ? `${result.wA}${result.an}${result.mA} (${result.wC}>${result.mC})`
      : type === "genomic-snv"
        ? `chr${result.input?.chromosome || ""}:${result.input?.position || ""} ${result.input?.ref || ""}>${result.input?.alt || ""}`
        : `Internal ${result.tag} insertion after ${result.wA}${result.an}`;
  } else if (type === "ko") {
    intendedDescription = "Deletion between the two cuts";
  }
  markerList.sort((a, b) => a.pos - b.pos);

  const primers = (result.ps || []).map((primer) => {
    const placed = placeSequence(genome, primer.s);
    return { name: primer.n, sequence: primer.s, start: placed ? placed.start : null, end: placed ? placed.end : null, strand: placed ? placed.strand : null };
  });
  const placedPrimers = primers.filter((primer) => primer.start !== null);
  const spans = [];
  guides.forEach((guide) => spans.push(guide.cut - 30, guide.cut + 30));
  donors.forEach((donor) => spans.push(donor.refStart, donor.refEnd));
  placedPrimers.forEach((primer) => spans.push(primer.start, primer.end));
  let windowStart = Math.max(0, Math.min(...spans) - pad);
  let windowEnd = Math.min(genome.length, Math.max(...spans) + pad);
  if (windowEnd - windowStart > (options.maxWindow ?? 5000)) return { err: "The design spans more of the reference than the QC window allows." };
  const coding = buildCodingBlock(result, genome, windowStart, windowEnd, options.maxCodingRegion ?? 300000);
  const shift = (value) => (value === null || value === undefined ? value : value - windowStart);
  const forward = placedPrimers.filter((primer) => primer.strand === "+");
  const reverse = placedPrimers.filter((primer) => primer.strand === "-");
  const amplicons = [];
  forward.forEach((fw) => reverse.forEach((rv) => {
    const wt = rv.end - fw.start;
    const edited = {};
    donors.forEach((donor) => { edited[donor.name] = wt + (donor.sequence.length - (donor.refEnd - donor.refStart)); });
    if (type === "ko" && guides.length > 1) edited.deletion = wt - (guides[guides.length - 1].cut - guides[0].cut);
    amplicons.push({ name: `${fw.name} + ${rv.name}`, forward: fw.name, reverse: rv.name, wtBp: wt, editedBp: edited });
  }));

  return {
    schema: QC_SPEC_SCHEMA,
    design: { ...(result.enzyme ? { nuclease: result.enzyme.name } : {}), type, editKind, gene: result.gene, label: intendedDescription, tag: result.tag || "", codingStrand: "+", ...(result.enzyme ? { enzyme: result.enzyme, parameters: result.enzymeParameters } : {}) },
    reference: { sequence: genome.slice(windowStart, windowEnd), offset: windowStart, convention: "0-based index into sequence; the + strand of the uploaded reference" },
    ...(coding ? { coding } : {}),
    guides: guides.map((guide) => ({ ...guide, cut: shift(guide.cut), protospacerStart: shift(guide.protospacerStart), protospacerEnd: shift(guide.protospacerEnd),
      ...(guide.cuts ? { cuts: Object.fromEntries(Object.entries(guide.cuts).map(([key, value]) => [key, shift(value)])), pamStart: shift(guide.pamStart), pamEnd: shift(guide.pamEnd) } : {}) })),
    donors: donors.map((donor) => ({ ...donor, refStart: shift(donor.refStart), refEnd: shift(donor.refEnd), insertStart: shift(donor.insertStart), carriesMarkers: donor.carriesMarkers?.map(shift) })),
    markers: markerList.map((marker) => ({ ...marker, pos: shift(marker.pos) })),
    primers: primers.map((primer) => ({ ...primer, start: shift(primer.start), end: shift(primer.end) })),
    amplicons,
  };
}
