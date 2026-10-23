// Donor format and arm control for terminal-tag knock-ins.
//
// Pure functions of sequence and numbers (no React, no DOM, no dependencies), shared by the design
// engine, the app, the HTML report and the CLI. Three things live here:
//
//   1. Which donor format a given insert suits (ssODN, synthesized dsDNA block, or cloned/AAV donor)
//      and the arm lengths each format starts from.
//   2. Per-side arm planning: separate 5' and 3' lengths, clamped to the reference that was supplied,
//      and optionally trimmed so an arm does not run into a stretch that is hard to synthesize or
//      whose length varies between alleles.
//   3. A synthesis pre-check of the finished donor.
//
// Sources for the numbers: IDT product and protocol pages for Alt-R HDR Donor Oligos (ssODN) and
// Alt-R HDR Donor Blocks. Insertions shorter than 120 bp are recommended as ssODNs; blocks cover
// 201-3000 bases with 200-300 bp arms recommended (100 bp usable when sequence complexity requires
// it; their protocol advises 100-500 bp); ssODN donor oligos run to 200 nt with 30-60 nt arms. The
// 500 bp insert size at which the default moves from a block to a cloned/AAV donor is this tool's
// choice (reporter- and selection-cassette-sized inserts), not a vendor limit: a block remains
// orderable to 3000 bp.
//
// The synthesis pre-check is a heuristic. IDT's own complexity screen is proprietary and decides
// whether an order is accepted; passing this check does not guarantee acceptance, and failing it
// does not mean the order will be refused. It looks for homopolymer runs, extreme local GC,
// perfect short tandem repeats, and an arm that ends inside a homopolymer (such runs are often
// length-polymorphic between alleles). It does not look for inverted repeats, secondary structure
// or direct repeats between distant parts of the donor.

export const DONOR_FORMATS = {
  ssodn: {
    key: "ssodn", short: "ssODN", label: "ssODN (single-stranded oligo, e.g. Alt-R HDR Donor Oligo)",
    maxLength: 200, defaultArm: 60, minArm: 30, maxArm: 60,
  },
  block: {
    key: "block", short: "dsDNA block", label: "dsDNA donor block (e.g. Alt-R HDR Donor Block)",
    minLength: 201, maxLength: 3000, defaultArm: 250, minArm: 100, maxArm: 500,
  },
  aav: {
    key: "aav", short: "AAV / plasmid", label: "AAV or plasmid donor (cloned)",
    defaultArm: 500, minArm: 300, maxArm: 1000,
  },
};
export const DONOR_FORMAT_KEYS = Object.keys(DONOR_FORMATS);
export const SSODN_BELOW_INSERT_BP = 120;
export const AAV_ABOVE_INSERT_BP = 500;

export const SYNTHESIS_THRESHOLDS = {
  homopolymer: 12,
  armEndRun: 6,
  gcWindow: 50,
  gcLow: 0.2,
  gcHigh: 0.8,
  tandemMinLength: 20,
  tandemMaxPeriod: 8,
};

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", N: "N" };
const reverseComplement = (seq) => String(seq).split("").reverse().map((base) => COMPLEMENT[base] || "N").join("");
const positiveInt = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function recommendDonorFormat(insertBp) {
  const length = Number(insertBp);
  if (!(length > 0)) return { format: "block", reason: "Insert length is unknown, so a dsDNA block is assumed." };
  if (length < SSODN_BELOW_INSERT_BP) {
    return { format: "ssodn", reason: `A ${length} bp insert is shorter than ${SSODN_BELOW_INSERT_BP} bp, the size IDT recommends an ssODN for.` };
  }
  if (length > AAV_ABOVE_INSERT_BP) {
    return {
      format: "aav",
      reason: `A ${length} bp insert is above ${AAV_ABOVE_INSERT_BP} bp (reporter or selection-cassette size), where this tool defaults to a cloned or AAV donor with ${DONOR_FORMATS.aav.defaultArm} bp arms. A synthesized block is still possible up to ${DONOR_FORMATS.block.maxLength} bp in total.`,
    };
  }
  return { format: "block", reason: `A ${length} bp insert is longer than ${SSODN_BELOW_INSERT_BP} bp and no longer than ${AAV_ABOVE_INSERT_BP} bp, which suits a synthesized dsDNA block with ${DONOR_FORMATS.block.defaultArm} bp arms.` };
}

export function defaultArms(format, insertBp) {
  const spec = DONOR_FORMATS[format] || DONOR_FORMATS.block;
  if (format === "ssodn") {
    const room = Math.max(Math.floor((spec.maxLength - Number(insertBp || 0)) / 2), 0);
    // When the insert leaves less than the minimum arm, keep the minimum and let the length check
    // report that the oligo exceeds its limit, rather than emit arms too short to be useful.
    return { five: Math.max(Math.min(spec.defaultArm, room), spec.minArm), three: Math.max(Math.min(spec.defaultArm, room), spec.minArm), feasible: room >= spec.minArm };
  }
  return { five: spec.defaultArm, three: spec.defaultArm, feasible: true };
}

// Synthesis pre-check -------------------------------------------------------------------------

function homopolymerIssues(seq, thresholds) {
  const issues = [];
  for (let start = 0; start < seq.length;) {
    let end = start;
    while (end < seq.length && seq[end] === seq[start]) end += 1;
    if (end - start >= thresholds.homopolymer) {
      issues.push({ kind: "homopolymer", start, end, detail: `${end - start}-nt poly-${seq[start]} run` });
    }
    start = end;
  }
  return issues;
}

function gcIssues(seq, thresholds) {
  const width = thresholds.gcWindow;
  if (seq.length < width) return [];
  const prefix = [0];
  for (let i = 0; i < seq.length; i += 1) prefix.push(prefix[i] + (seq[i] === "G" || seq[i] === "C" ? 1 : 0));
  const flagged = [];
  for (let i = 0; i + width <= seq.length; i += 1) {
    const fraction = (prefix[i + width] - prefix[i]) / width;
    if (fraction < thresholds.gcLow) flagged.push({ start: i, end: i + width, fraction, kind: "gc-low" });
    else if (fraction > thresholds.gcHigh) flagged.push({ start: i, end: i + width, fraction, kind: "gc-high" });
  }
  const merged = [];
  flagged.forEach((window) => {
    const last = merged[merged.length - 1];
    if (last && last.kind === window.kind && window.start <= last.end) {
      last.end = window.end;
      last.fraction = window.kind === "gc-low" ? Math.min(last.fraction, window.fraction) : Math.max(last.fraction, window.fraction);
    } else merged.push({ ...window });
  });
  return merged.map((item) => ({
    kind: item.kind, start: item.start, end: item.end,
    detail: `${item.kind === "gc-low" ? "very low" : "very high"} GC (${Math.round(item.fraction * 100)}% in a ${width}-nt window)`,
  }));
}

function tandemIssues(seq, thresholds) {
  const found = [];
  for (let period = 2; period <= thresholds.tandemMaxPeriod; period += 1) {
    let run = 0;
    for (let i = 0; i <= seq.length - period; i += 1) {
      const matches = i < seq.length - period && seq[i] === seq[i + period];
      if (matches) { run += 1; continue; }
      const length = run + period;
      const start = i - run;
      if (run > 0 && length >= thresholds.tandemMinLength && new Set(seq.slice(start, start + period)).size > 1) {
        found.push({ kind: "tandem-repeat", start, end: start + length, period, detail: `${seq.slice(start, start + period)} tandem repeat, ${length} nt` });
      }
      run = 0;
    }
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.period - b.period);
  const kept = [];
  found.forEach((item) => { if (!kept.some((other) => item.start >= other.start && item.end <= other.end)) kept.push(item); });
  return kept.map(({ period, ...rest }) => rest);
}

export function scanSynthesisRisks(sequence, thresholds = SYNTHESIS_THRESHOLDS) {
  const seq = String(sequence || "").toUpperCase();
  return [...homopolymerIssues(seq, thresholds), ...gcIssues(seq, thresholds), ...tandemIssues(seq, thresholds)]
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

// Length of the single-base run that straddles the cut between genome[boundary - 1] and genome[boundary].
function runAcross(genome, boundary) {
  if (boundary <= 0 || boundary >= genome.length || genome[boundary - 1] !== genome[boundary]) return 0;
  let start = boundary - 1;
  let end = boundary;
  while (start > 0 && genome[start - 1] === genome[boundary]) start -= 1;
  while (end < genome.length - 1 && genome[end + 1] === genome[boundary]) end += 1;
  return end - start + 1;
}

function armIssues(genome, side, edge, length, thresholds) {
  const arm = side === "five" ? genome.slice(edge - length, edge) : genome.slice(edge, edge + length);
  const issues = scanSynthesisRisks(arm, thresholds);
  const outer = side === "five" ? edge - length : edge + length;
  const run = runAcross(genome, outer);
  if (run >= thresholds.armEndRun) {
    issues.push({ kind: "arm-end-in-run", start: 0, end: 0, detail: `the arm ends inside a ${run}-nt poly-${genome[outer]} run, whose length often differs between alleles` });
  }
  return issues;
}

// Longest arm up to `requested` (stepping down by 10 bp, never below `minArm`) that has no flagged
// stretch. A flagged stretch inside the minimum arm cannot be avoided by trimming, so the arm is then
// left at its requested length and the stretch is reported instead.
export function trimArm(genome, side, edge, requested, minArm, thresholds = SYNTHESIS_THRESHOLDS) {
  const longest = requested;
  const base = armIssues(genome, side, edge, longest, thresholds);
  if (!base.length || longest <= minArm) return { length: longest, fromLength: longest, trimmed: false, unavoidable: base.length > 0, issues: base };
  if (armIssues(genome, side, edge, minArm, thresholds).length) return { length: longest, fromLength: longest, trimmed: false, unavoidable: true, issues: base };
  for (let length = Math.floor((longest - 1) / 10) * 10; length > minArm; length -= 10) {
    if (!armIssues(genome, side, edge, length, thresholds).length) return { length, fromLength: longest, trimmed: true, unavoidable: false, issues: base };
  }
  return { length: minArm, fromLength: longest, trimmed: true, unavoidable: false, issues: base };
}

// Arm planning ------------------------------------------------------------------------------------
//
// `leftEdge` is the index where the 5' arm ends (exclusive) and `rightEdge` the index where the 3'
// arm starts, both into `genome`. Options:
//   donorFormat      "auto" | "ssodn" | "block" | "aav"; absent keeps the pre-existing behaviour
//                    (symmetric arms of `requestedArm`, 250 bp when none is given)
//   arm5Length / arm3Length   per-side lengths; override `requestedArm` for that side
//   autoTrimArms     shorten an arm that runs into a flagged stretch (not for cloned/AAV donors)
export function planDonorArms({ insertBp, genome, leftEdge, rightEdge, requestedArm, options = {} }) {
  const seq = String(genome || "").toUpperCase();
  const recommended = recommendDonorFormat(insertBp);
  const wanted = options.donorFormat;
  const requestedFormat = DONOR_FORMAT_KEYS.includes(wanted) ? wanted : (wanted === "auto" ? "auto" : null);
  const format = requestedFormat && requestedFormat !== "auto" ? requestedFormat : (requestedFormat === "auto" ? recommended.format : null);
  const defaults = format ? defaultArms(format, insertBp) : null;
  const symmetric = positiveInt(requestedArm);
  const wantFive = positiveInt(options.arm5Length) ?? symmetric ?? defaults?.five ?? 250;
  const wantThree = positiveInt(options.arm3Length) ?? symmetric ?? defaults?.three ?? 250;
  const availFive = Math.max(leftEdge, 0);
  const availThree = Math.max(seq.length - rightEdge, 0);
  let five = Math.min(wantFive, availFive);
  let three = Math.min(wantThree, availThree);
  const limited = { five: wantFive > availFive, three: wantThree > availThree };
  const trims = { five: null, three: null };
  const trimFormat = format || "block";
  if (options.autoTrimArms === true && trimFormat !== "aav") {
    const minArm = DONOR_FORMATS[trimFormat].minArm;
    const resultFive = trimArm(seq, "five", leftEdge, five, Math.min(minArm, five));
    const resultThree = trimArm(seq, "three", rightEdge, three, Math.min(minArm, three));
    trims.five = resultFive; trims.three = resultThree;
    five = resultFive.length; three = resultThree.length;
  }
  return {
    requestedFormat, format, recommended, defaults,
    arms: {
      five, three, requestedFive: wantFive, requestedThree: wantThree, limited, trims, symmetricRequest: symmetric,
      endRun: { five: runAcross(seq, leftEdge - five), three: runAcross(seq, rightEdge + three) },
    },
  };
}

// Report ---------------------------------------------------------------------------------------------

function regionOf(index, five, insertBp) {
  if (index < five) return { region: "5\u2032 arm", offset: 0 };
  if (index < five + insertBp) return { region: "insert", offset: five };
  return { region: "3\u2032 arm", offset: five + insertBp };
}

export function buildDonorFormatReport({ plan, donor, insertBp, firstGuideStrand, guides }) {
  const sequence = String(donor || "").toUpperCase();
  const totalLength = sequence.length;
  const { five, three } = plan.arms;
  const inferred = !plan.format;
  const format = plan.format || (totalLength <= DONOR_FORMATS.ssodn.maxLength ? "ssodn" : "block");
  const spec = DONOR_FORMATS[format];
  const notes = [];
  const gcCount = [...sequence].filter((base) => base === "G" || base === "C").length;

  const limitProblems = [];
  if (format === "ssodn" && totalLength > spec.maxLength) {
    limitProblems.push(`The ${totalLength} nt donor is longer than the ${spec.maxLength} nt an ssODN can be ordered at; use a dsDNA block or shorten the arms (minimum ${spec.minArm} nt).`);
  }
  if (format === "block" && totalLength < spec.minLength) limitProblems.push(`The ${totalLength} bp donor is shorter than the ${spec.minLength} bp minimum for a donor block; lengthen the arms or use an ssODN.`);
  if (format === "block" && totalLength > spec.maxLength) limitProblems.push(`The ${totalLength} bp donor is longer than the ${spec.maxLength} bp maximum for a donor block; use a cloned or AAV donor.`);
  if (!plan.defaults?.feasible && plan.format === "ssodn") limitProblems.push(`A ${insertBp} bp insert leaves less than ${spec.minArm} nt per arm within ${spec.maxLength} nt; use a dsDNA block.`);

  [["5\u2032", five], ["3\u2032", three]].forEach(([label, length]) => {
    if (format === "block" && (length < spec.minArm || length > spec.maxArm)) notes.push(`The ${label} arm is ${length} bp, outside IDT's ${spec.minArm}-${spec.maxArm} bp range for donor blocks.`);
    if (format === "ssodn" && (length < spec.minArm || length > spec.maxArm)) notes.push(`The ${label} arm is ${length} nt, outside the ${spec.minArm}-${spec.maxArm} nt usually used for ssODNs.`);
  });
  if (format === "block" && five >= 200 && five <= 300 && three >= 200 && three <= 300) notes.push("Both arms are within IDT's recommended 200-300 bp.");
  if (plan.arms.limited.five) notes.push(`The 5\u2032 arm is limited to ${five} bp by the supplied reference (${plan.arms.requestedFive} bp requested).`);
  if (plan.arms.limited.three) notes.push(`The 3\u2032 arm is limited to ${three} bp by the supplied reference (${plan.arms.requestedThree} bp requested).`);
  [["5\u2032", plan.arms.trims.five], ["3\u2032", plan.arms.trims.three]].forEach(([label, trim]) => {
    if (trim?.trimmed) notes.push(`The ${label} arm was shortened from ${trim.fromLength} to ${trim.length} bp to avoid: ${trim.issues.map((item) => item.detail).join("; ")}.`);
    else if (trim?.unavoidable) notes.push(`The ${label} arm contains a flagged stretch within its first ${DONOR_FORMATS[format].minArm} bp, so trimming cannot remove it: ${trim.issues.map((item) => item.detail).join("; ")}.`);
  });
  if (plan.requestedFormat && plan.requestedFormat !== "auto" && plan.requestedFormat !== plan.recommended.format) {
    notes.push(`${DONOR_FORMATS[plan.requestedFormat].short} was selected; ${DONOR_FORMATS[plan.recommended.format].short} is recommended for this insert. ${plan.recommended.reason}`);
  }
  if (format === "aav") notes.push("The sequence shown is the homology cassette (arms plus insert) to clone into the donor vector; it is not an oligo order.");

  const synthesisIssues = scanSynthesisRisks(sequence).map((item) => {
    const { region, offset } = regionOf(item.start, five, insertBp);
    return { ...item, region, location: `nt ${item.start - offset + 1}-${item.end - offset} of the ${region}` };
  });
  const boundaryIssues = [];
  [["five", "5\u2032 arm"], ["three", "3\u2032 arm"]].forEach(([side, region]) => {
    const run = plan.arms.endRun?.[side] || 0;
    if (run >= SYNTHESIS_THRESHOLDS.armEndRun) boundaryIssues.push({ kind: "arm-end-in-run", start: 0, end: 0, region, detail: `the arm ends inside a ${run}-nt single-base run, whose length often differs between alleles` });
  });
  const issues = [...synthesisIssues, ...boundaryIssues];
  const synthesisRelevant = format !== "aav";
  const status = limitProblems.length || (synthesisRelevant && issues.length) ? "warn" : "pass";

  // Only an explicit or automatic ssODN choice picks a strand; a format inferred from length changes nothing.
  // The ssODN to use with a guide is complementary to that guide's PAM-bearing strand. Two guides
  // on the same strand share one ssODN; guides on opposite strands each need their own, which has
  // the same insert and blocking changes on the other strand.
  const guideList = guides?.length ? guides : [{ str: firstGuideStrand }];
  const strand = format === "ssodn" && !inferred ? matchedSsodnStrand(guideList[0].str) : null;
  const orderStrands = [];
  if (strand) {
    guideList.forEach((guide, index) => {
      if (index > 0 && guide.str !== "+" && guide.str !== "-") return;
      const matched = matchedSsodnStrand(guide.str);
      const existing = orderStrands.find((entry) => entry.strand === matched);
      const label = guide.name || `guide ${index + 1}`;
      if (existing) {
        existing.guideNames.push(label);
        existing.guideStrands.push(guide.str);
      } else {
        orderStrands.push({
          strand: matched,
          sequence: matched === "antisense" ? reverseComplement(sequence) : sequence,
          guideNames: [label],
          guideStrands: [guide.str],
        });
      }
    });
  }
  return {
    requested: plan.requestedFormat,
    recommended: plan.recommended,
    format, inferred,
    label: spec.label, short: spec.short,
    insertBp, totalLength,
    gc: totalLength ? Math.round((gcCount / totalLength) * 1000) / 10 : null,
    arms: {
      five, three,
      requestedFive: plan.arms.requestedFive, requestedThree: plan.arms.requestedThree,
      trimmedFive: !!plan.arms.trims.five?.trimmed, trimmedThree: !!plan.arms.trims.three?.trimmed,
      limitedFive: plan.arms.limited.five, limitedThree: plan.arms.limited.three,
    },
    limits: { status: limitProblems.length ? "warn" : "pass", problems: limitProblems },
    synthesis: { scope: "heuristic pre-check, not IDT's complexity screen", relevant: synthesisRelevant, issues },
    notes, status,
    orderStrand: strand,
    orderSequence: strand ? (strand === "antisense" ? reverseComplement(sequence) : sequence) : null,
    orderStrands,
  };
}

function matchedSsodnStrand(guideStrand) {
  return guideStrand === "+" ? "antisense" : "sense";
}

// Plain description used by the app card and the HTML report so both say the same thing.
export function describeDonorFormat(report) {
  if (!report) return null;
  const arms = report.arms;
  const armText = arms.five === arms.three ? `${arms.five} bp each` : `${arms.five} bp (5\u2032) and ${arms.three} bp (3\u2032)`;
  const rows = [
    ["Format", `${report.label}${report.inferred ? " (inferred from the donor length)" : report.requested === "auto" ? " (automatic)" : ""}`],
    ["Arms", armText],
    ["Donor length", `${report.totalLength} bp (${arms.five} + ${report.insertBp} + ${arms.three}), GC ${report.gc}%`],
  ];
  if (report.recommended && report.requested !== null) rows.push(["Recommended for this insert", `${DONOR_FORMATS[report.recommended.format].short}. ${report.recommended.reason}`]);
  if (report.orderStrands?.length > 1) {
    const strandText = (entry) => `${entry.strand === "sense" ? "sense (genomic + strand as supplied)" : "antisense (reverse complement of the supplied strand)"} for ${entry.guideNames.join(" and ")} (${entry.guideStrands.map((str) => `${str} strand`).join(", ")})`;
    rows.push(["Strands to order", `Two ssODNs, ${report.orderStrands.map(strandText).join("; ")}. They carry the same insert and the same blocking changes for both guides and differ only in strand; each is complementary to the PAM-bearing strand of its guide. Order both and deliver both with the two guides.`]);
  } else if (report.orderStrand) rows.push(["Strand to order", `${report.orderStrand === "sense" ? "Sense (genomic + strand as supplied)" : "Antisense (reverse complement of the supplied strand)"}, the strand complementary to the PAM-bearing strand of ${report.orderStrands?.[0]?.guideNames?.length > 1 ? "both guides" : "guide 1"}, as for the point-mutation ssODNs.`]);
  const synthesis = report.synthesis.relevant
    ? (report.synthesis.issues.length
      ? report.synthesis.issues.map((item) => `${item.region}: ${item.detail}${item.location ? ` (${item.location})` : ""}`)
      : ["No homopolymer, extreme-GC or tandem-repeat stretch flagged."])
    : ["Not applicable to a cloned donor (the cassette is cloned, not synthesized)."];
  return { heading: "Donor format and arms", rows, problems: report.limits.problems, notes: report.notes, synthesis, synthesisScope: report.synthesis.scope, status: report.status };
}
