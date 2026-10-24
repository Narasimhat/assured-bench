const csvCell = value => {
  let text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  if (/^[=+@-].+/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
};
export function enzymeGuideCsv(run) {
  const fields = ["id", "enzyme", "config_version", "created_at", "status", "coordinate_system", "start", "end", "strand", "pam", "spacer", "cuts", "gc", "filter_pass", "filter_reasons", "score", "scoring_model", "scoring_version", "score_approximate", "full_crrna", "parameters", "off_target", "reference", "modification", "cut_distance"];
  return [fields.join(","), ...run.candidates.map(guide => [guide.id, guide.enzyme, run.enzyme.version, run.created_at,
    run.status, run.coordinate_system, guide.start, guide.end, guide.strand, guide.pam, guide.spacer, guide.cuts, guide.gc,
    guide.qc.passed, guide.qc.reasons, guide.score.value, guide.score.model, guide.score.version, guide.score.approximate,
    guide.full_crrna, run.parameters, run.off_target, run.reference, run.modification, guide.cut_distance].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
const safe = value => String(value).replace(/["\r\n]/g, " ");
export function enzymeGuideGenbank(run) {
  const sequence = run.reference_sequence.toLowerCase();
  const comment = JSON.stringify({ config: run.enzyme, parameters: run.parameters, status: run.status, created_at: run.created_at,
    off_target: run.off_target, coordinate_system: run.coordinate_system, reference: run.reference, modification: run.modification });
  const lines = [`LOCUS       ASSURED_GUIDES ${sequence.length} bp    DNA     linear`,
    "DEFINITION  Enzyme guide candidates; review required.", "ACCESSION   ASSURED_GUIDES", "VERSION     ASSURED_GUIDES.1"];
  // Wrap without dropping characters so the JSON comment can be reconstructed.
  for (let i = 0; i < comment.length; i += 65) lines.push(`${i === 0 ? "COMMENT     " : "            "}${comment.slice(i, i + 65)}`);
  lines.push("FEATURES             Location/Qualifiers");
  for (const guide of run.candidates) {
    const location = (start, end) => guide.strand === "-" ? `complement(${start + 1}..${end})` : `${start + 1}..${end}`;
    lines.push(`     misc_feature    ${location(guide.spacer_start, guide.spacer_end)}`,
      `                     /label="${guide.id}"`,
      `                     /note="${safe(`enzyme=${guide.enzyme}; spacer=${guide.spacer}; cuts=${JSON.stringify(guide.cuts)}; score=${guide.score.value}; model=${guide.score.model}; model_version=${guide.score.version}; approximate=${guide.score.approximate}; filters=${guide.qc.reasons.join(",")}; full_crrna=${guide.full_crrna || "unavailable"}`)}"`,
      `     misc_feature    ${location(guide.pam_start, guide.pam_end)}`,
      `                     /label="PAM ${guide.pam}"`);
  }
  lines.push("ORIGIN");
  for (let i = 0; i < sequence.length; i += 60) lines.push(`${String(i + 1).padStart(9)} ${sequence.slice(i, i + 60).match(/.{1,10}/g).join(" ")}`);
  lines.push("//", "");
  return lines.join("\n");
}
