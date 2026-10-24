const cell = value => {
  let text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  if (/^[=+@-].+/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
};
export function enzymeDonorCsv(run) {
  const fields = ["id", "enzyme", "config_version", "created_at", "status", "format", "strand", "sequence_5to3", "length", "matched_guide_ids", "delivery", "reference_interval", "arms", "modification", "edits", "protein_validation", "guide_protection", "synthesis_flags", "warnings", "parameters", "reference"];
  return [fields.join(","), ...(run.donor_design?.donors || []).map(donor => [donor.id, donor.enzyme, donor.config_version,
    run.created_at, donor.status, donor.format, donor.strand, donor.order_sequence, donor.order_sequence.length,
    donor.matched_guide_ids, donor.delivery, donor.reference_interval, donor.arms, run.modification, donor.edits,
    donor.protein_validation, donor.guide_protection, donor.synthesis_flags, donor.warnings,
    run.donor_design.parameters, run.reference].map(cell).join(","))].join("\r\n") + "\r\n";
}
export function enzymeDonorFasta(run) {
  return (run.donor_design?.donors || []).map(donor => `>${donor.id} ${donor.enzyme} config=${donor.config_version} status=${donor.status.replace(/ /g, "_")} format=${donor.format} strand=${donor.strand} guide_ids=${donor.matched_guide_ids.join(",")}\n${donor.order_sequence.match(/.{1,70}/g).join("\n")}\n`).join("");
}
export function enzymeDonorGenbank(run) {
  return (run.donor_design?.donors || []).map(donor => {
    // The record uses input-sense orientation so features can be read consistently.
    // CSV/FASTA use the selected order orientation, which may be antisense for ssODN.
    const lines = [`LOCUS       ${donor.id.replace(/-/g, "_")} ${donor.sequence.length} bp    DNA     linear`,
      `DEFINITION  ${run.modification.label}; ${donor.status}.`, `ACCESSION   ${donor.id.replace(/-/g, "_")}`];
    const metadata = JSON.stringify({ enzyme: run.enzyme, reference: run.reference, modification: run.modification,
      status: donor.status, created_at: run.created_at, parameters: run.donor_design.parameters,
      edits: donor.edits, guide_protection: donor.guide_protection, warnings: donor.warnings, reference_interval: donor.reference_interval,
      selected_order_strand: donor.strand, record_orientation: "input-sense", coordinate_system: run.coordinate_system });
    for (let i = 0; i < metadata.length; i += 65) lines.push(`${i === 0 ? "COMMENT     " : "            "}${metadata.slice(i, i + 65)}`);
    lines.push("FEATURES             Location/Qualifiers");
    for (const annotation of donor.annotations) {
      if (annotation.end <= annotation.start) continue;
      lines.push(`     misc_feature    ${annotation.start + 1}..${annotation.end}`, `                     /label="${annotation.label.replace(/["\r\n]/g, " ")}"`);
    }
    for (const edit of donor.edits.filter(entry => entry.kind === "synonymous_pam" || entry.kind === "desired")) {
      const delta = donor.edits.filter(entry => entry.end <= edit.start).reduce((sum, entry) => sum + entry.sequence.length - (entry.end - entry.start), 0);
      const position = edit.start - donor.reference_interval.start + delta + 1;
      lines.push(`     misc_difference ${position}`, `                     /label="${edit.kind}"`, `                     /replace="${edit.sequence.toLowerCase()}"`);
    }
    lines.push("ORIGIN");
    const seq = donor.sequence.toLowerCase();
    for (let i = 0; i < seq.length; i += 60) lines.push(`${String(i + 1).padStart(9)} ${seq.slice(i, i + 60).match(/.{1,10}/g).join(" ")}`);
    lines.push("//", "");
    return lines.join("\n");
  }).join("");
}
