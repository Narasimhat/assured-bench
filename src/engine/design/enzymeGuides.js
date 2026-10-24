import { getEnzyme, pamRegex } from "./enzymeConfig.js";

export function reverseComplementDna(sequence) {
  const complement = { A: "T", T: "A", G: "C", C: "G", N: "N" };
  return [...sequence].reverse().map(base => complement[base] || "N").join("");
}
export function normalizeGuideInput(input) {
  const text = String(input).trim();
  const lines = text.split(/\r?\n/);
  if (lines.some((line, index) => index > 0 && line.startsWith(">"))) throw new Error("Use one FASTA record per run.");
  const sequence = (lines[0]?.startsWith(">") ? lines.slice(1) : lines).join("").replace(/\s/g, "").toUpperCase();
  if (!sequence || !/^[ACGTN]+$/.test(sequence)) throw new Error("Enter DNA (A/C/G/T/N) or one FASTA record.");
  return sequence;
}

/** Coordinates are 0-based half-open on the input reference. Cut sites are interbase
 * coordinates. Offsets run from the spacer's 5′ boundary in guide orientation;
 * target/non-target labels are relative to the guide, not reference plus/minus. */
export function findEnzymeGuides(input, { enzyme = "spcas9", spacerLength, start = 0, end, allowAmbiguousSpacer = false } = {}) {
  const config = getEnzyme(enzyme);
  const sequence = allowAmbiguousSpacer ? String(input).toUpperCase() : normalizeGuideInput(input);
  const length = spacerLength ?? config.spacer_len.default;
  if (!Number.isInteger(length) || length < config.spacer_len.min || length > config.spacer_len.max) throw new Error("Spacer length is outside enzyme limits.");
  end ??= sequence.length;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > sequence.length || start > end) throw new Error("Invalid scan bounds.");
  const pamLength = config.pam_pattern.length;
  const span = length + pamLength;
  const regex = pamRegex(config.pam_pattern);
  const results = [];
  // One-base stepping deliberately preserves overlapping PAMs and legacy plus/minus order.
  for (let pos = start; pos <= end - span; pos += 1) {
    for (const strand of ["+", "-"]) {
      const site = sequence.slice(pos, pos + span);
      const oriented = strand === "+" ? site : reverseComplementDna(site);
      const fivePrime = config.pam_side === "5prime";
      const pam = fivePrime ? oriented.slice(0, pamLength) : oriented.slice(length);
      const spacer = fivePrime ? oriented.slice(pamLength) : oriented.slice(0, length);
      if (!regex.test(pam) || !(allowAmbiguousSpacer ? /^[A-Z]+$/ : /^[ACGT]+$/).test(spacer)) continue;
      const spacerOffset = fivePrime ? pamLength : 0;
      const mapBoundary = offset => strand === "+" ? pos + offset : pos + span - offset;
      const spacerBounds = [mapBoundary(spacerOffset), mapBoundary(spacerOffset + length)].sort((a, b) => a - b);
      const pamBounds = [mapBoundary(fivePrime ? 0 : length), mapBoundary(fivePrime ? pamLength : span)].sort((a, b) => a - b);
      const cuts = Object.fromEntries(Object.entries(config.cut_offsets).map(([key, offset]) => [key, mapBoundary(spacerOffset + offset)]));
      if (Object.values(cuts).some(cut => cut < 0 || cut > sequence.length)) continue;
      results.push({ id: `${enzyme}:${pos}:${strand}:${length}`, enzyme, spacer, pam, strand,
        start: pos, end: pos + span, spacer_start: spacerBounds[0], spacer_end: spacerBounds[1],
        pam_start: pamBounds[0], pam_end: pamBounds[1], cuts,
        gc: 100 * [...spacer].filter(base => /[GC]/.test(base)).length / length });
    }
  }
  return results;
}

export function assessEnzymeGuide(guide, config, { delivery = "rnp", filters = {}, exclusions = [] } = {}) {
  if (!["rnp", "poliii"].includes(delivery)) throw new Error("Unknown delivery method.");
  const policy = { ...config.filters, ...filters };
  for (const key of Object.keys(filters)) if (!(key in config.filters)) throw new Error(`Unknown filter: ${key}`);
  if (![policy.gc_min, policy.gc_max].every(Number.isFinite) || policy.gc_min < 0 || policy.gc_max > 100 || policy.gc_min > policy.gc_max) throw new Error("Invalid GC limits.");
  for (const key of ["max_homopolymer", "self_complement_length"]) {
    if (!Number.isInteger(policy[key]) || policy[key] < 0 || policy[key] > 100) throw new Error(`Invalid ${key}. Use 0 to disable.`);
  }
  const reasons = [];
  if (guide.gc < policy.gc_min || guide.gc > policy.gc_max) reasons.push("gc_outside_range");
  if (delivery === "poliii" && guide.spacer.includes("TTTT")) reasons.push("poliii_terminator");
  if (policy.max_homopolymer && new RegExp(`([ACGT])\\1{${policy.max_homopolymer},}`).test(guide.spacer)) reasons.push("homopolymer");
  const k = policy.self_complement_length;
  if (k) for (let i = 0; i + k <= guide.spacer.length; i += 1) {
    // Non-overlapping complementary arms are a screen, not a folding-energy model.
    if (guide.spacer.slice(i + k).includes(reverseComplementDna(guide.spacer.slice(i, i + k)))) { reasons.push("self_complementarity"); break; }
  }
  for (const region of exclusions) {
    if (!Number.isInteger(region.start) || !Number.isInteger(region.end) || region.start < 0 || region.end <= region.start) throw new Error("Invalid exclusion interval.");
    if (guide.start < region.end && guide.end > region.start) reasons.push(`excluded:${region.label || "SNP/repeat"}`);
  }
  return { passed: reasons.length === 0, reasons, policy };
}

/** A scorer is an injected, synchronous model adapter returning {value, model, version}.
 * Never substitute a composition heuristic for unavailable trained model weights. */
export function scoreEnzymeGuide(guide, config, sequence, scorer) {
  const approximate = config.id === "mad7";
  if (!scorer) return { value: null, model: config.scoring_model, version: null, approximate, status: "unavailable" };
  const result = scorer({ guide, config, sequence });
  if (!result || !Number.isFinite(result.value) || typeof result.model !== "string" || !result.model.trim() || typeof result.version !== "string" || !result.version.trim()) throw new Error("Scorer must return a finite value, model name and version.");
  return { ...result, approximate: approximate || Boolean(result.approximate), status: "available" };
}

export function designEnzymeGuides(input, options = {}) {
  const sequence = normalizeGuideInput(input);
  const config = getEnzyme(options.enzyme);
  const directRepeat = String(options.directRepeat ?? config.direct_repeat ?? "").replace(/\s/g, "").toUpperCase().replace(/T/g, "U");
  if (directRepeat && !/^[ACGU]+$/.test(directRepeat)) throw new Error("Direct repeat must contain RNA bases only.");
  const repeatSource = String(options.repeatSource || "").trim();
  const repeatVerified = Boolean(options.repeatVerified && directRepeat && repeatSource);
  // Validate options even when the sequence has no candidates.
  assessEnzymeGuide({ spacer: "", gc: 50, start: 0, end: 0 }, config, options);
  if ((options.exclusions || []).some(region => region.end > sequence.length)) throw new Error("Exclusion interval exceeds reference length.");
  const candidates = findEnzymeGuides(sequence, options).map(guide => {
    const qc = assessEnzymeGuide(guide, config, options);
    const score = scoreEnzymeGuide(guide, config, sequence, options.scorer);
    const rna = guide.spacer.replace(/T/g, "U");
    return { ...guide, qc, score, full_crrna: config.pam_side === "5prime" && repeatVerified
      ? (config.direct_repeat_position === "5prime" ? directRepeat + rna : rna + directRepeat) : null };
  });
  candidates.sort((a, b) => Number(b.qc.passed) - Number(a.qc.passed)
    || (b.score.value ?? -Infinity) - (a.score.value ?? -Infinity) || a.start - b.start || a.strand.localeCompare(b.strand));
  return { schema_version: "1.0.0", created_at: new Date().toISOString(), enzyme: config,
    parameters: { spacer_length: options.spacerLength ?? config.spacer_len.default, delivery: options.delivery || "rnp",
      filters: { ...config.filters, ...options.filters }, exclusions: options.exclusions || [], direct_repeat: directRepeat || null,
      repeat_verified_by_user: repeatVerified, repeat_source: repeatSource || null },
    reference_sequence: sequence, coordinate_system: "0-based half-open; cuts are interbase; strands relative to input",
    status: "REVIEW REQUIRED", off_target: { status: "not_run", specificity: null, hits: [] }, candidates };
}
