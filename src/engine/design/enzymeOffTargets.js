import { pamRegex } from "./enzymeConfig.js";

export function casOffinderInput(run, genomePath, maxMismatches = 3) {
  if (!genomePath || /[\r\n]/.test(genomePath)) throw new Error("Supply a single-line genome path.");
  if (!Number.isInteger(maxMismatches) || maxMismatches < 0 || maxMismatches > 6) throw new Error("Mismatch limit must be 0–6.");
  const config = run.enzyme;
  const length = run.parameters.spacer_length;
  const pattern = config.pam_side === "5prime" ? config.pam_pattern + "N".repeat(length) : "N".repeat(length) + config.pam_pattern;
  const queries = [...new Set(run.candidates.filter(guide => guide.qc.passed).map(guide => guide.spacer))];
  if (!queries.length) throw new Error("No passing candidates to search.");
  return [genomePath, pattern, ...queries.map(spacer => `${config.pam_side === "5prime" ? "N".repeat(config.pam_pattern.length) + spacer : spacer + "N".repeat(config.pam_pattern.length)} ${maxMismatches}`), ""].join("\n");
}

/** Parse standard six-column Cas-OFFinder output. DNA must be guide-oriented,
 * including on minus-strand hits. Locations are Cas-OFFinder's 0-based site starts. */
export function parseCasOffinder(text, run) {
  const config = run.enzyme;
  const pamLength = config.pam_pattern.length;
  const length = run.parameters.spacer_length;
  const regex = pamRegex(config.pam_pattern);
  const guides = new Set(run.candidates.filter(guide => guide.qc.passed).map(guide => guide.spacer));
  const split = sequence => config.pam_side === "5prime"
    ? { pam: sequence.slice(0, pamLength), spacer: sequence.slice(pamLength) }
    : { spacer: sequence.slice(0, length), pam: sequence.slice(length) };
  const hits = [];
  const seen = new Set();
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const columns = line.trim().split(/\s+/);
    if (columns.length !== 6) throw new Error(`Invalid Cas-OFFinder row ${index + 1}.`);
    const [queryRaw, chromosome, position, targetRaw, strand, count] = columns;
    const query = queryRaw.toUpperCase();
    const target = targetRaw.toUpperCase();
    if (query.length !== length + pamLength || target.length !== query.length || !/^[ACGTN]+$/.test(query) || !/^[ACGT]+$/.test(target)
      || !/^[+-]$/.test(strand) || !/^\d+$/.test(position) || !/^\d+$/.test(count) || !Number.isSafeInteger(Number(position))) throw new Error(`Invalid Cas-OFFinder row ${index + 1}.`);
    const { spacer: guide, pam: queryPam } = split(query);
    const { spacer, pam } = split(target);
    if (!guides.has(guide) || queryPam !== "N".repeat(pamLength) || !regex.test(pam)) throw new Error(`Query or PAM mismatch in row ${index + 1}.`);
    const mismatches = [...guide].flatMap((base, i) => base !== spacer[i] ? [i] : []);
    if (mismatches.length !== Number(count)) throw new Error(`Mismatch count disagrees in row ${index + 1}.`);
    const seedMismatches = mismatches.filter(i => config.pam_side === "5prime" ? i < config.seed_length : i >= length - config.seed_length).length;
    const key = `${guide}:${chromosome}:${position}:${strand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ guide, chromosome, start: Number(position), strand, spacer, pam,
      mismatches: mismatches.length, seed_mismatches: seedMismatches,
      // Explicit heuristic: a PAM-proximal mismatch reduces estimated risk more.
      risk: Math.exp(-1.5 * seedMismatches - 0.5 * (mismatches.length - seedMismatches)) });
  }
  return hits.sort((a, b) => b.risk - a.risk || a.start - b.start);
}

export function summarizeOffTargets(hits, { intendedTarget, complete = false } = {}) {
  const matchesIntended = hit => intendedTarget && hit.chromosome === intendedTarget.chromosome
    && hit.start === intendedTarget.start && hit.strand === intendedTarget.strand;
  const intendedHits = hits.filter(matchesIntended);
  const offTargets = hits.filter(hit => !matchesIntended(hit));
  const scoreAvailable = complete && intendedHits.length === 1;
  return { status: complete ? "search_reported_complete" : "completeness_unverified", model: "seed-weighted-heuristic-v1",
    approximate: true, specificity: scoreAvailable ? 100 / (1 + offTargets.reduce((sum, hit) => sum + hit.risk, 0)) : null,
    total_hits: hits.length, off_target_count: intendedTarget ? offTargets.length : null,
    intended_target_found: intendedHits.length === 1, hits: offTargets.slice(0, 20),
    note: "Heuristic specificity, not CFD or a calibrated cleavage probability. Requires a complete assembly search and exactly one mapped intended target. Bulges are not searched." };
}
