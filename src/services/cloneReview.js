// Review of what a clone carries: the alleles read from its traces, placed on the uploaded reference, ready for the splice and expression predictors that the
// design was reviewed with. The design run reviews the edit that was planned; this reviews what was found: the intended edit as it was read, the bases the design
// did not ask for, and any indel allele. Both predictors run on the user's machine (tools/spliceai, tools/alphagenome); this module only builds the requests, checks
// that a result belongs to them and turns scores into a verdict per clone. Scores are model predictions, not measurements.
import { buildQcDesignSpec } from "../engine/design/qcExport.js";
import { SPLICE_CHECK_THRESHOLDS } from "../engine/design/pairBlocking.js";
import { resolveAlphaGenomeMapping, reviewRequestId } from "./alphaGenomeReview.js";
import { ALLELE_CONTEXT_LENGTHS } from "./alphaGenomeAlleles.js";
import { parseGenBank } from "../engine/qc/genbank.js";
import { validateDesignSpec } from "../engine/qc/designSpec.js";

export const CLONE_SPLICE_REQUEST_SCHEMA = "assured-clone-splice-request/1";
export const CLONE_SPLICE_RESULT_SCHEMA = "assured-clone-splice-result/1";
export const CLONE_ALPHAGENOME_REQUEST_SCHEMA = "assured-alphagenome-clone-request/1";
export const CLONE_ALPHAGENOME_REPORT_SCHEMA = "assured-alphagenome-clone-review/1";
export const CLONE_REVIEW_LIMITS = Object.freeze({ alleles: 24, editsPerAllele: 12 });
export const CLONE_ALPHAGENOME_OUTPUTS = Object.freeze(["RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE"]);
export { SPLICE_CHECK_THRESHOLDS };

const COMP = { A: "T", C: "G", G: "C", T: "A", N: "N" };
const rc = (s) => [...String(s)].reverse().map((b) => COMP[b] || "N").join("");
const sha256Hex = async (text) => [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((n) => n.toString(16).padStart(2, "0")).join("");
const EDIT_KEYS = ["start", "end", "ref", "inserted", "role"];

/** The clones worth predicting: read, not a pool, not junction reads; a clone that was rejected is left out unless it carries a flagged unwanted change (then the effect is what explains the flag). */
export function reviewableClones(results, { includeRejected = false } = {}) {
  return (results || []).filter((r) => r && r.ok && r.kind === "trace-pair" && r.sampleType !== "pool" && Array.isArray(r.alleles)
    && (includeRejected || (r.decision?.decision || r.decision?.verdict) !== "reject" || r.unwanted?.worst === "block")
    && ((r.alleles || []).length || (r.unwanted?.changes || []).length));
}

const overlaps = (a, b) => (a.start === a.end ? b.start < a.start && a.start < b.end : b.start === b.end ? a.start < b.start && b.start < a.end : a.start < b.end && b.start < a.end);

/**
 * The alleles of one clone as edits (indices in the QC reference window, forward strand): every allele the fit found, and the bases the design did not plan, put on
 * the dominant allele that carries the intended edit (a trace cannot say which allele a heterozygous base is on; the review assumes the edited one, and says so).
 * @returns {Array<{ label: string, kind: string, fraction: number, edits: Array<{ start: number, end: number, ref: string, inserted: string, role: string }>, unwanted: boolean, assumption: string }>}
 */
export function cloneAlleleCandidates(result) {
  // roles the runners know: intended, blocking, unplanned, indel (a base of the fit that is neither a designed marker nor an indel is an unplanned one)
  const role = (e) => (["intended", "blocking", "indel", "unplanned"].includes(e.role) ? e.role : "unplanned");
  const observed = (result.alleles || []).map((a) => ({ label: a.label, kind: a.kind, fraction: a.fraction, edits: a.edits.map((e) => ({ ...e, role: role(e) })), unwanted: a.edits.some((e) => role(e) === "indel" || role(e) === "unplanned"), assumption: "" }));
  const unplanned = (result.unwanted?.changes || []).map((c) => ({ start: c.position, end: c.position + 1, ref: c.ref, inserted: c.alt, role: "unplanned" }));
  const out = observed.slice();
  if (unplanned.length) {
    const host = observed.find((a) => a.kind === "edit" || a.kind === "edit_partial") || null;
    const extra = (edits) => unplanned.filter((u) => !edits.some((e) => overlaps(u, e)));
    if (host) {
      const idx = out.indexOf(host);
      out[idx] = { ...host, label: `${host.label} + unplanned base${unplanned.length > 1 ? "s" : ""}`, edits: [...host.edits, ...extra(host.edits)].sort((a, b) => a.start - b.start), unwanted: true, assumption: "The unplanned base is placed on the allele that carries the intended edit; a trace cannot show which allele a heterozygous base is on." };
    } else out.push({ label: "unplanned base" + (unplanned.length > 1 ? "s" : "") + " on the reference", kind: "unplanned", fraction: Math.max(...(result.unwanted.changes || []).map((c) => c.fraction)), edits: unplanned, unwanted: true, assumption: "No allele with the intended edit was found; the unplanned bases are placed on the unedited reference." });
  }
  return out.filter((a) => a.edits.length && a.edits.length <= CLONE_REVIEW_LIMITS.editsPerAllele);
}

/** The reference, the offset of the QC window in it and the intended alleles (one per ssODN) of the open design. Throws a message the user can act on. */
export async function cloneReviewContext(project) {
  // Imported experimental designs take precedence over newly generated guide/donor alternatives.
  if (project?.qcImportedDesignText || project?.qcDesignSpec) {
    let spec = project.qcDesignSpec || null;
    if (typeof project.qcImportedDesignText === "string" && /^\s*\{/.test(project.qcImportedDesignText)) spec = JSON.parse(project.qcImportedDesignText);
    if (!spec) throw new Error("Run trace analysis first (or upload a JSON QC design spec) so the QC reference window is available for clone review.");
    const validation = validateDesignSpec(spec);
    if (!validation.ok) throw new Error("The imported experimental QC design is invalid: " + validation.errors.join(" "));
    const raw = project.cloneReviewReferenceRaw || project.genbankRaw;
    if (!raw) throw new Error("Load the genomic GenBank reference for this experimental QC design below. Its sequence must match the QC window.");
    const record = parseGenBank(raw);
    const genome = record.sequence;
    if (!genome || genome.length > 1000000) throw new Error("Load a genomic GenBank reference of at most 1 Mb.");
    const window = spec.reference.sequence.toUpperCase();
    // Sanger-derived reference windows can have noisy ends. Only permit a uniquely exact core;
    // every marker and every reviewed change must lie inside it. Never repair internal mismatches.
    const trim = Math.min(40, Math.floor(window.length / 10));
    let offset = genome.indexOf(window), coreStart = 0, coreEnd = window.length;
    if (offset < 0) {
      coreStart = trim; coreEnd = window.length - trim;
      const core = window.slice(coreStart, coreEnd), hit = genome.indexOf(core);
      if (core.length < 100 || hit < 0 || genome.indexOf(core, hit + 1) >= 0) throw new Error("The QC reference has no unique exact match in this record. Check the reference, strand and parental variants; internal mismatches cannot be ignored.");
      offset = hit - coreStart;
    } else if (genome.indexOf(window, offset + 1) >= 0) throw new Error("The QC reference matches more than once in this record.");
    if (offset < 0 || offset + window.length > genome.length || (spec.markers || []).some(m => m.pos < coreStart || m.pos >= coreEnd)) throw new Error("The QC markers or window extend outside the verified reference match.");
    const intended = (spec.donors || []).filter(d => !(d.insertBp > 0)).map((d, i) => ({
      id: `D${i + 1}`, name: d.name,
      edits: (spec.markers || []).filter(m => m.pos >= d.refStart && m.pos < d.refEnd && (!d.carriesMarkers || d.carriesMarkers.includes(m.pos)))
        .map(m => ({ start: m.pos + offset, end: m.pos + offset + 1, ref: m.ref, inserted: m.alt, role: m.role === "intended" ? "intended" : "blocking" })).sort((a, b) => a.start - b.start),
    })).filter(d => d.edits.length);
    const strands = new Set(record.features.filter(f => f.type === "CDS" && f.location).map(f => f.location.strand));
    if (strands.size !== 1) throw new Error("The reference must identify one unambiguous coding strand.");
    return { genome, spec, offset, intended, strand: strands.has("-") ? -1 : 1, gene: spec.design?.gene || project.gene || "Locus", fileName: project.cloneReviewReferenceName || "reference.gb", verifiedCore: [coreStart, coreEnd] };
  }
  const design = project?.designResult;
  if (!design || design.err) throw new Error("Open the design (Step 1) that these clones were made from, so that the clone changes can be placed on its reference.");
  const genome = String(design.gb?.genomicSequence || "").toUpperCase();
  if (!genome || genome.length > 1000000 || !/^[ACGTN]+$/.test(genome)) throw new Error("The design has no valid reference sequence of at most 1 Mb.");
  const spec = buildQcDesignSpec(design, { maxWindow: 1000000 });
  if (spec.err) throw new Error(spec.err);
  const offset = spec.reference.offset;
  const intended = (spec.donors || []).filter((d) => !(d.insertBp > 0)).map((d, index) => ({
    id: `D${index + 1}`, name: d.name,
    edits: (spec.markers || []).filter((m) => m.pos >= d.refStart && m.pos < d.refEnd && (!d.carriesMarkers || d.carriesMarkers.includes(m.pos)))
      .map((m) => ({ start: m.pos + offset, end: m.pos + offset + 1, ref: m.ref, inserted: m.alt, role: m.role === "intended" ? "intended" : "blocking" })).sort((a, b) => a.start - b.start),
  })).filter((d) => d.edits.length);
  const strand = design.gb?.strand === -1 ? -1 : 1;
  return { design, genome, spec, offset, intended, strand, gene: String(design.gene || project.gene || "Locus"), fileName: String(design.input?.fileName || project.genbankName || "") };
}

/** Distinct alleles over the clones, each with the clones that carry it, edits on the uploaded reference and the intended allele to compare with. Throws when an edit does not sit on the reference. */
export function collectReviewAlleles(context, results, options = {}) {
  const { genome, offset, intended } = context;
  const byKey = new Map(); const problems = [];
  for (const result of reviewableClones(results, options)) {
    for (const candidate of cloneAlleleCandidates(result)) {
      if (context.verifiedCore && candidate.edits.some(e => e.start < context.verifiedCore[0] || e.end > context.verifiedCore[1])) throw new Error(`${result.name}: a change lies outside the exact reference match; verify the read before predicting it.`);
      const edits = candidate.edits.map((e) => ({ start: e.start + offset, end: e.end + offset, ref: e.ref, inserted: e.inserted, role: e.role })).sort((a, b) => a.start - b.start);
      if (edits.some((e, i) => i && edits[i - 1].end > e.start)) { problems.push(`${result.name}: overlapping edits in ${candidate.label}`); continue; }
      const bad = edits.find((e) => genome.slice(e.start, e.end) !== e.ref);
      if (bad) { problems.push(`${result.name}: ${candidate.label} does not match the reference at ${bad.start + 1} (the QC design and the open design differ)`); continue; }
      const key = JSON.stringify(edits.map((e) => EDIT_KEYS.map((k) => e[k])));
      if (!byKey.has(key)) byKey.set(key, { edits, label: candidate.label, unwanted: candidate.unwanted, assumption: candidate.assumption, clones: [] });
      byKey.get(key).clones.push({ name: result.name, label: candidate.label, fraction: candidate.fraction, decision: result.decision?.decision || "" });
    }
  }
  if (problems.length && !byKey.size) throw new Error(`The clone changes could not be placed on the reference: ${problems.slice(0, 3).join("; ")}.`);
  const alleles = [...byKey.values()].sort((a, b) => Number(b.unwanted) - Number(a.unwanted) || b.clones.length - a.clones.length).map((a, i) => {
    const snv = new Set(a.edits.filter((e) => e.end - e.start === 1 && e.inserted.length === 1).map((e) => `${e.start}${e.inserted}`));
    const best = intended.map((d) => ({ d, hit: d.edits.filter((e) => snv.has(`${e.start}${e.inserted}`)).length })).filter((x) => x.hit && x.hit >= x.d.edits.length / 2).sort((x, y) => y.hit - x.hit)[0];
    return { id: `A${i + 1}`, label: a.label, unwanted: a.unwanted, assumption: a.assumption, intendedId: best ? best.d.id : null, edits: a.edits, clones: a.clones };
  });
  if (!alleles.length) throw new Error("None of the clones carries an allele to review (wild type, rejected or unreadable results are left out).");
  if (alleles.length > CLONE_REVIEW_LIMITS.alleles) throw new Error(`There are ${alleles.length} distinct alleles to review (limit ${CLONE_REVIEW_LIMITS.alleles}). Review the flagged clones first.`);
  return { alleles, problems };
}

const finish = async (payload) => ({ ...payload, requestId: await reviewRequestId(payload) });

/** The SpliceAI request: coordinates are indices (0-based, half-open) into the reference record exactly as uploaded, the record is identified by its SHA-256. */
export async function buildCloneSpliceRequest(project, results, options = {}) {
  const context = await cloneReviewContext(project);
  const { alleles } = collectReviewAlleles(context, results, options);
  const used = new Set(alleles.map((a) => a.intendedId).filter(Boolean));
  const payload = {
    schema: CLONE_SPLICE_REQUEST_SCHEMA, gene: context.gene, referenceFile: context.fileName,
    reference: { length: context.genome.length, sha256: await sha256Hex(context.genome), convention: "0-based half-open indices into the record as uploaded" },
    geneStrand: context.strand, window: options.window || 400,
    thresholds: { pass: SPLICE_CHECK_THRESHOLDS.pass, review: SPLICE_CHECK_THRESHOLDS.review },
    intended: context.intended.filter((d) => used.has(d.id)).map((d) => ({ id: d.id, name: d.name, edits: d.edits })),
    alleles: alleles.map((a) => ({ id: a.id, label: a.label, intendedId: a.intendedId, unwanted: a.unwanted, edits: a.edits, clones: a.clones })),
  };
  return finish(payload);
}

/** The AlphaGenome request: edits on the GRCh38 chromosome (a mapped human reference is required, as for the design review). */
export async function buildCloneAlphaGenomeRequest(project, results, { ontologyTerm, sequenceLength = 131072, ...options } = {}) {
  if (!/^(CL|EFO|UBERON):\d+$/.test(ontologyTerm || "")) throw new Error("Choose the experimental cell context.");
  if (!ALLELE_CONTEXT_LENGTHS.includes(sequenceLength)) throw new Error("Unsupported context length.");
  const context = await cloneReviewContext(project);
  const mapping = await resolveAlphaGenomeMapping(project.cloneReviewReferenceRaw ? { ...project, genbankRaw: project.cloneReviewReferenceRaw, genomicDesignInput: null } : project);
  if (!mapping || mapping.assembly !== "GRCh38") throw new Error("Fetch a mapped human GRCh38 reference before reviewing the clone alleles (the design review needs the same).");
  const { alleles } = collectReviewAlleles(context, results, options);
  const L = context.genome.length; const S = mapping.referenceStart; const forward = mapping.orientation === 1;
  const place = (e) => {
    const [start, end] = forward ? [S - 1 + e.start, S - 1 + e.end] : [S - 1 + L - e.end, S - 1 + L - e.start];
    return { start, end, ref: forward ? e.ref : rc(e.ref), inserted: forward ? e.inserted : rc(e.inserted), role: e.role };
  };
  const placed = alleles.map((a) => ({ ...a, edits: a.edits.map(place).sort((x, y) => x.start - y.start) }));
  const intendedUsed = new Set(placed.map((a) => a.intendedId).filter(Boolean));
  const intended = context.intended.filter((d) => intendedUsed.has(d.id)).map((d) => ({ id: d.id, name: d.name, edits: d.edits.map(place).sort((x, y) => x.start - y.start) }));
  const all = [...placed.flatMap((a) => a.edits), ...intended.flatMap((d) => d.edits)];
  const lo = Math.min(...all.map((e) => e.start)); const hi = Math.max(...all.map((e) => e.end));
  if (hi - lo >= sequenceLength / 2) throw new Error("The changes are too far apart for the selected prediction context; choose a longer context or review fewer clones.");
  const payload = {
    schema: CLONE_ALPHAGENOME_REQUEST_SCHEMA, assembly: "GRCh38", chromosome: `chr${String(mapping.chromosome).replace(/^chr/i, "")}`, gene: context.gene,
    reference: { start: S, sequence: forward ? context.genome : rc(context.genome) }, sequenceLength, ontologyTerms: [ontologyTerm], requestedOutputs: [...CLONE_ALPHAGENOME_OUTPUTS],
    intended, alleles: placed.map((a) => ({ id: a.id, label: a.label, intendedId: a.intendedId, unwanted: a.unwanted, edits: a.edits, clones: a.clones })),
  };
  return finish(payload);
}

const verdictOf = (effect) => (effect <= SPLICE_CHECK_THRESHOLDS.pass ? "pass" : effect <= SPLICE_CHECK_THRESHOLDS.review ? "review" : "fail");

/** A SpliceAI result is accepted only for the exact request it answers. */
export function validateCloneSpliceResult(result, request) {
  if (!result || result.schema !== CLONE_SPLICE_RESULT_SCHEMA) throw new Error(`This is not a clone splice result (schema ${CLONE_SPLICE_RESULT_SCHEMA}).`);
  if (!request || result.requestId !== request.requestId) throw new Error("This result was made for a different set of clones or alleles. Export the request again and run it.");
  if (typeof result.tool !== "string" || typeof result.version !== "string" || !result.version) throw new Error("The result has no model provenance.");
  const rows = result.summary?.alleles;
  if (!rows || request.alleles.some((a) => !rows[a.id])) throw new Error("The result does not cover every allele of the request.");
  for (const a of request.alleles) {
    const row = rows[a.id];
    if (!Number.isFinite(row.editEffectMax) || (row.unwantedEffectMax !== null && !Number.isFinite(row.unwantedEffectMax))) throw new Error(`The scores of ${a.id} are missing or not numbers.`);
  }
  return result;
}

/**
 * Splice verdict per allele and per clone. The effect judged is the largest SpliceAI change (acceptor/donor, gain/loss) that the clone's unwanted edits add to the intended
 * allele; an allele without unwanted edits is judged on its own change against wild type (the intended edit as it was read). pass <= 0.05, review <= 0.2, fail above (the same
 * cut-offs as the design review).
 */
export function summariseCloneSplice(request, result) {
  validateCloneSpliceResult(result, request);
  const alleles = {}; const clones = {};
  for (const a of request.alleles) {
    const row = result.summary.alleles[a.id];
    const unwanted = row.unwantedEffectMax !== null && row.unwantedEffectMax !== undefined;
    const effect = unwanted ? row.unwantedEffectMax : row.editEffectMax; const verdict = verdictOf(effect);
    alleles[a.id] = { id: a.id, label: a.label, effect, verdict, basis: unwanted ? (a.intendedId ? "unwanted edits on top of the intended allele" : "unwanted edits against wild type") : "the allele as read, against wild type", editEffectMax: row.editEffectMax, unwantedOnlyMax: row.unwantedOnlyMax ?? null };
    for (const c of a.clones) {
      const entry = { allele: a.id, label: a.label, effect, verdict, basis: alleles[a.id].basis, unwanted: Boolean(a.unwanted) };
      const rank = { pass: 0, review: 1, fail: 2 };
      if (!clones[c.name] || rank[verdict] > rank[clones[c.name].verdict] || (verdict === clones[c.name].verdict && effect > clones[c.name].effect)) clones[c.name] = entry;
    }
  }
  return { tool: result.tool, version: result.version, thresholds: request.thresholds, alleles, clones };
}

/** An AlphaGenome report is accepted only for the exact request it answers. */
export function validateCloneAlphaGenomeReport(report, request) {
  if (!report || report.schema !== CLONE_ALPHAGENOME_REPORT_SCHEMA || report.status !== "complete" || report.evidenceType !== "model-prediction") throw new Error("This report is incomplete or is not a clone AlphaGenome review.");
  if (!request || report.requestId !== request.requestId) throw new Error("This report was made for a different set of clones, alleles, cell context or prediction window. Export the request again and run it.");
  if (typeof report.sdkVersion !== "string" || typeof report.modelVersion !== "string" || !report.modelVersion) throw new Error("The report is missing model provenance.");
  const byId = new Map((report.alleles || []).map((a) => [a.id, a]));
  for (const a of request.alleles) {
    const got = byId.get(a.id);
    if (!got || !Array.isArray(got.comparisons) || !got.comparisons.length) throw new Error(`The report has no comparison for ${a.id}.`);
  }
  return report;
}

/**
 * Per clone, the largest raw track change (mean |delta| and max |delta| per output) that its allele makes against the intended allele (against wild type when the allele has no
 * intended partner). AlphaGenome deltas have assay-specific units and no calibrated threshold: they rank clones by how much the unwanted edits move the prediction, they are not a verdict.
 */
export function summariseCloneAlphaGenome(request, report) {
  validateCloneAlphaGenomeReport(report, request);
  const byId = new Map(report.alleles.map((a) => [a.id, a])); const clones = {}; const alleles = {};
  for (const a of request.alleles) {
    const got = byId.get(a.id);
    const wanted = a.intendedId ? "intended_to_allele" : "reference_to_allele";
    const comparison = got.comparisons.find((c) => c.id === wanted) || got.comparisons[0];
    const perOutput = {};
    for (const track of comparison.tracks || []) {
      const row = perOutput[track.output] || { meanAbsDelta: 0, maxAbsDelta: 0 };
      row.meanAbsDelta = Math.max(row.meanAbsDelta, track.meanAbsDelta); row.maxAbsDelta = Math.max(row.maxAbsDelta, track.maxAbsDelta); perOutput[track.output] = row;
    }
    alleles[a.id] = { id: a.id, label: a.label, comparison: comparison.id, outputs: perOutput };
    for (const c of a.clones) {
      const score = perOutput.SPLICE_SITE_USAGE?.maxAbsDelta ?? perOutput.SPLICE_SITES?.maxAbsDelta ?? 0;
      if (!clones[c.name] || score > clones[c.name].spliceScore) clones[c.name] = { allele: a.id, label: a.label, comparison: comparison.id, outputs: perOutput, spliceScore: score, unwanted: Boolean(a.unwanted) };
    }
  }
  return { modelVersion: report.modelVersion, sdkVersion: report.sdkVersion, ontologyTerms: report.ontologyTerms || request.ontologyTerms, alleles, clones };
}
