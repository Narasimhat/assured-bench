// Knock-in verification from single Sanger reads (no control needed): read a junction PCR, or an out-out PCR product,
// against the expected edited allele. Used for tags and reporters too large for trace deconvolution.
//
// What it can say: whether the read matches the expected knock-in sequence, where it does not (arm, insert, junction),
// whether the blocking changes are present, and whether the read continues into genomic sequence beyond the homology arm.
// What it cannot: zygosity and copy number. A junction PCR amplifies only the knock-in allele.

import { buildComposition } from "./traceModel.js";
import { localAlign, orientAndAlign } from "./align.js";
import { completeAllele } from "./alleleLibrary.js";
import { longestGoodRun } from "./prepare.js";
import { reverseComplement } from "./seq.js";

export const JUNCTION_DEFAULTS = { trimQuality: 20, trimWindow: 15, highQuality: 30, minAligned: 100, minIdentity: 0.9, junctionMargin: 10, maxArmFlankCheck: 30 };

function regionOf(allele, donor, index) {
  const start = donor.refStart;
  const length = donor.sequence.length; // the donor's length is its span in the edited allele
  const arm5 = Number.isInteger(donor.arm5) ? donor.arm5 : null;
  const insertBp = donor.insertBp || 0;
  if (index < start) return "genomic flank (5')";
  if (index >= start + length) return "genomic flank (3')";
  if (arm5 === null || (insertBp === 0 && !(donor.replacedBp > 0))) return "donor (edited stretch)";
  if (index < start + arm5) return "5' arm";
  if (index < start + arm5 + insertBp) return "insert";
  return "3' arm";
}

export function analyseJunctionRead({ trace, spec, donorName, options = {} }) {
  const opt = { ...JUNCTION_DEFAULTS, ...options };
  const donor = (spec.donors || []).find((entry) => entry.name === donorName) || (spec.donors || [])[0];
  if (!donor) return { ok: false, error: "The design has no donor, so there is no expected knock-in allele to compare with." };
  const model = buildComposition(trace);
  const run = longestGoodRun(model.quality, 0, model.calls.length, opt.trimQuality, opt.trimWindow);
  if (!run || run.end - run.start < opt.minAligned) return { ok: false, error: `The read has no stretch of ${opt.minAligned} bases with quality of at least ${opt.trimQuality}.` };
  const trimmedCalls = model.calls.slice(run.start, run.end);
  const trimmedQuality = Array.from(model.quality.slice(run.start, run.end));
  const { sequence: expected } = completeAllele(spec, donor);
  const wild = spec.reference.sequence.toUpperCase();
  const oriented = orientAndAlign(trimmedCalls, expected);
  const reversed = oriented.orientation === "-";
  const calls = oriented.calls;
  const quality = reversed ? [...trimmedQuality].reverse() : trimmedQuality;
  const al = oriented.alignment;
  const aligned = al.matches + al.mismatches;
  const wtAlign = localAlign(calls, wild);
  const wtAligned = wtAlign.matches + wtAlign.mismatches;
  const wildExplainsRead = wtAligned >= opt.minAligned && wtAlign.identity >= opt.minIdentity && wtAlign.score >= al.score;
  if (aligned < opt.minAligned || al.identity < opt.minIdentity || wildExplainsRead) {
    const looksWild = wtAligned >= opt.minAligned && wtAlign.identity >= opt.minIdentity;
    return { ok: false, error: looksWild ? "The read matches the wild-type sequence at least as well as the expected knock-in allele (it does not reach or contain the insert)." : `The read does not match the expected knock-in allele (${aligned} aligned bases, ${(al.identity * 100).toFixed(0)}% identity).`, looksWildType: looksWild, orientation: oriented.orientation };
  }
  // events along the alignment
  const events = [];
  let previousRef = -1;
  let firstRef = -1; let lastRef = -1;
  for (let i = 0; i < calls.length; i += 1) {
    const r = al.readToRef[i];
    if (r < 0) { if (previousRef >= 0 && i > al.readStart && i < al.readEnd) events.push({ type: "insertion", readIndex: i, alleleIndex: previousRef + 1, bases: calls[i], quality: quality[i] }); continue; }
    if (firstRef < 0) firstRef = r;
    lastRef = r;
    if (previousRef >= 0 && r - previousRef > 1) events.push({ type: "deletion", readIndex: i, alleleIndex: previousRef + 1, length: r - previousRef - 1, quality: quality[i] });
    if (calls[i] !== "N" && calls[i] !== expected[r]) events.push({ type: "mismatch", readIndex: i, alleleIndex: r, read: calls[i], expected: expected[r], quality: quality[i] });
    previousRef = r;
  }
  // markers in edited-allele coordinates
  const insertBp = donor.insertBp || 0; const replaced = donor.replacedBp || 0;
  const insertPos = Number.isInteger(donor.insertStart) ? donor.insertStart : donor.refStart + (donor.arm5 || 0);
  const toAllele = (pos) => (pos < insertPos + replaced ? pos : pos + insertBp - replaced);
  const readAt = new Map(); al.readToRef.forEach((r, i) => { if (r >= 0) readAt.set(r, i); });
  const markers = (spec.markers || []).filter((m) => m.pos >= donor.refStart && m.pos < donor.refEnd).map((marker) => {
    const at = toAllele(marker.pos); const i = readAt.get(at);
    if (i === undefined) return { marker, covered: false };
    const base = calls[i];
    return { marker, covered: true, base, quality: quality[i], present: base === marker.alt, reverted: base === marker.ref, alleleIndex: at };
  });
  const annotate = (event) => ({ ...event, region: regionOf(expected, { ...donor, sequence: donor.sequence }, event.alleleIndex), expectedChange: markers.some((m) => m.covered && m.alleleIndex === event.alleleIndex) });
  const annotated = events.map(annotate);
  // spans
  const donorStart = donor.refStart; const donorEnd = donor.refStart + donor.sequence.length;
  const covers = (index) => firstRef <= index - opt.junctionMargin && lastRef >= index + opt.junctionMargin;
  const j5 = insertBp || replaced ? insertPos : donorStart; const j3 = (insertBp || replaced) ? insertPos + insertBp : donorEnd;
  const flankBases = (() => { let n = 0; al.readToRef.forEach((r) => { if (r >= 0 && (r < donorStart || r >= donorEnd)) n += 1; }); return n; })();
  const flankMismatches = annotated.filter((e) => e.type === "mismatch" && (e.region.startsWith("genomic"))).length;
  // verdict
  const details = []; let status = "pass";
  const raise = (level, text) => { details.push(text); if (level === "fail" || (level === "warn" && status === "pass")) status = level; };
  const indels = annotated.filter((e) => (e.type === "insertion" || e.type === "deletion") && e.quality >= opt.trimQuality);
  const unexpected = annotated.filter((e) => e.type === "mismatch" && !e.expectedChange && e.quality >= opt.highQuality);
  const lowQuality = annotated.filter((e) => e.type === "mismatch" && !e.expectedChange && e.quality < opt.highQuality).length;
  indels.forEach((e) => raise("fail", `${e.type === "deletion" ? `${e.length} bp deletion` : "1 bp insertion"} in the ${e.region} at allele position ${e.alleleIndex}.`));
  const unexpectedInDonor = unexpected.filter((e) => !e.region.startsWith("genomic"));
  if (unexpectedInDonor.length) raise(unexpectedInDonor.length > 2 || unexpectedInDonor.some((e) => e.region === "insert") ? "fail" : "warn", `${unexpectedInDonor.length} high-quality mismatch${unexpectedInDonor.length === 1 ? "" : "es"} against the expected sequence (${unexpectedInDonor.slice(0, 4).map((e) => `${e.expected}>${e.read} in the ${e.region}`).join("; ")}).`);
  const unexpectedFlank = unexpected.filter((e) => e.region.startsWith("genomic"));
  if (unexpectedFlank.length) raise("warn", `${unexpectedFlank.length} high-quality mismatch${unexpectedFlank.length === 1 ? "" : "es"} in the genomic flank (a parental variant, or a read error).`);
  markers.filter((m) => m.covered && !m.present && m.quality >= opt.trimQuality).forEach((m) => raise("warn", `Blocking or intended change ${m.marker.ref}>${m.marker.alt} (${m.marker.label || "marker"}) is ${m.reverted ? "absent: the read shows the original base" : `not as designed (read shows ${m.base})`}; the donor was not fully copied here.`));
  if (insertBp || replaced) {
    if (!covers(j5)) raise("warn", "The read does not span the 5' junction of the insert, so that junction is not verified.");
    if (!covers(j3)) raise("warn", "The read does not span the 3' junction of the insert, so that junction is not verified.");
  }
  if (flankBases < 20) raise("warn", "The read does not extend 20 bases into genomic sequence beyond the donor, so integration at the locus (rather than a donor fragment elsewhere or residual donor) is not shown by this read.");
  if (!details.length) details.push("The read matches the expected knock-in sequence with no unexpected differences in the aligned stretch.");
  const summary = status === "pass" ? "Matches the expected knock-in allele" : status === "warn" ? "Matches, with points to check" : "Differs from the expected knock-in allele";
  return {
    ok: true, orientation: oriented.orientation, trimmed: { start: run.start, end: run.end }, identity: al.identity, alignedBases: aligned,
    alleleRange: { start: firstRef, end: lastRef + 1 }, events: annotated, lowQualityMismatches: lowQuality, markers,
    spans: { fivePrimeJunction: (insertBp || replaced) ? covers(j5) : null, threePrimeJunction: (insertBp || replaced) ? covers(j3) : null, genomicFlankBases: flankBases, genomicFlankMismatches: flankMismatches },
    wildTypeIdentity: wtAligned >= opt.minAligned ? wtAlign.identity : null,
    verdict: { status, summary, details },
  };
}

/**
 * Out-out PCR band sizes against the expected products.
 * @param {number[]} observed band sizes in bp
 * @param {{wtBp: number, editedBp: Record<string, number>}} amplicon
 */
export function classifyBands(observed, amplicon, { tolerance = 0.05, minimumBp = 20 } = {}) {
  const bands = [...observed].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => b - a);
  const targets = [{ kind: "wild type / unedited", size: amplicon.wtBp }, ...Object.entries(amplicon.editedBp).map(([name, size]) => ({ kind: name === "deletion" ? "deletion between the cuts" : "knock-in", name, size }))];
  const assigned = bands.map((band) => {
    const hit = targets.map((target) => ({ target, off: Math.abs(band - target.size) })).sort((a, b) => a.off - b.off)[0];
    return { band, matches: hit && hit.off <= Math.max(minimumBp, tolerance * hit.target.size) ? hit.target : null };
  });
  const has = (kind) => assigned.some((entry) => entry.matches && entry.matches.kind === kind);
  const unexplained = assigned.filter((entry) => !entry.matches);
  const wt = has("wild type / unedited"); const ki = has("knock-in"); const del = has("deletion between the cuts");
  let call; let summary;
  if (!bands.length) { call = "no band"; summary = "No band entered."; }
  else if (ki && !wt && !unexplained.length) { call = "knock-in only"; summary = "Only the knock-in-sized band is present: consistent with biallelic knock-in (or one knock-in allele and a large deletion on the other that drops out)."; }
  else if (ki && wt) { call = "knock-in and wild type"; summary = "Knock-in and wild-type bands: heterozygous, or a mixture of cells (re-single-cell if unsure)."; }
  else if (wt && !ki && !unexplained.length) { call = "wild type only"; summary = "Only the wild-type-sized band: no knock-in; small indels at the cut are not visible by band size."; }
  else if (del && !wt && !ki) { call = "deletion only"; summary = "Only the deletion-sized band."; }
  else { call = "unexpected sizes"; summary = "At least one band does not match the expected wild-type, knock-in or deletion size."; }
  return { call, summary, bands: assigned.map((entry) => ({ bp: entry.band, matches: entry.matches ? entry.matches.kind : "unexpected size", expectedBp: entry.matches ? entry.matches.size : null })), expected: targets };
}
