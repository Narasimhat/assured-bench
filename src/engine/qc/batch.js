import { ENZYME_CONFIG_VERSION } from "./enzymeConfig.js";
import { expectedGuideGeometry, specNuclease, hydrateCutGeometry } from "./nucleases.js";
import { enzymeAnalysisNotes } from "./cutGeometry.js";
// Orchestration shared by the app, its worker and the tests: choose the design, analyse one sample, return plain data.
import { analysePair, analyseReads } from "./analyze.js";
import { annotateSpecProtein } from "./protein.js";
import { specFromControl } from "./manualSpec.js";
import { validateDesignSpec } from "./designSpec.js";
import { analyseJunctionRead, classifyBands } from "./junction.js";
import { contributionsSvg, discordanceSvg } from "./charts.js";
import { buildTraceView } from "./alignedView.js";
import { baseEditMarkers, baseEditTable } from "./baseEdit.js";
import { discoverCut } from "./cutDiscovery.js";
import { buildCodingContext, describeContext, codingBlockToGenBank } from "./coding.js";

export const WORKFLOWS = {
  knockout: { label: "Knockout (indels at one cut)", needsDonor: false, method: "trace" },
  deletion: { label: "Deletion between two or three cuts", needsDonor: false, method: "trace" },
  snp: { label: "SNP correction (ssODN, silent blocking changes)", needsDonor: true, method: "trace" },
  tag_small: { label: "Small tag knock-in (ssODN up to 300 nt)", needsDonor: true, method: "trace" },
  reporter: { label: "Large tag or reporter knock-in (junction reads)", needsDonor: false, method: "junction" },
  base_edit: { label: "Base editing (A>G or C>T in the editing window)", needsDonor: false, method: "trace", baseEdit: true },
};

/** Spec from an exported design, or built from the control trace, guides and donor. */
function planDesignCore({ designSpec, control, guides, donor, gene, nuclease, baseEditor = null, editedForCut = [], protein = [] }) {
  if (designSpec) {
    const unwrappedSpec = (designSpec.schema === "assured-studio/1" && designSpec.qcSpec) ? designSpec.qcSpec : designSpec;
    const check = validateDesignSpec(unwrappedSpec);
    if (!check.ok) return { error: `The design file is not usable: ${check.errors[0]}${check.errors.length > 1 ? ` (and ${check.errors.length - 1} more)` : ""}`, warnings: check.warnings };
    const hydrated = { ...unwrappedSpec, design: { ...unwrappedSpec.design, nuclease: specNuclease(unwrappedSpec) },
      guides: (unwrappedSpec.guides || []).map(g => {
        if (g.protospacerStart == null) return g;
        const geometry = expectedGuideGeometry(g, unwrappedSpec);
        return { ...g, ...(geometry.cuts ? { cuts: geometry.cuts } : {}), pamStart: geometry.pamStart, pamEnd: geometry.pamEnd };
      }) };
    return { spec: annotateSpecProtein(hydrated, protein), warnings: [...check.warnings, ...enzymeAnalysisNotes(hydrated)], source: "design" };
  }
  if (!control) return { error: "Add the control trace, or a design file." };
  const guideList = (Array.isArray(guides) ? guides : String(guides || "").split(/[,\s;]+/)).filter(Boolean);
  const notes = [];
  let built;
  if (!guideList.length && !baseEditor) {
    // No guide on record: the cut is where the edited traces depart from the control.
    const found = editedForCut.map((edited) => discoverCut({ control, edited })).filter((r) => r.ok && r.confidence >= 0.3).map((r) => r.readIndex).sort((x, y) => x - y);
    if (!found.length) return { error: "No guide was given and no cut site could be inferred from the edited traces (no clear point where they depart from the control). Enter the guide sequence." };
    const cut = found[found.length >> 1];
    built = specFromControl({ control, guides: [], cutIndices: [cut], donor, gene, nuclease });
    if (!built.error) notes.push(`No guide was given: the cut was inferred at read position ${cut} (median of ${found.length} sample${found.length === 1 ? "" : "s"} that depart from the control there). Enter the guide for an exact design.`);
  } else built = specFromControl({ control, guides: guideList, donor, gene, nuclease });
  if (built.error) return { error: built.error, warnings: [] };
  if (baseEditor) {
    const reference = built.spec.reference.sequence;
    const markers = baseEditMarkers({ reference, guide: guideList[0], editor: baseEditor.editor, window: baseEditor.window, target: baseEditor.target, nuclease });
    if (markers.error) return { error: markers.error, warnings: [] };
    if (!markers.markers.length) return { error: `No ${baseEditor.editor === "CBE" ? "C" : "A"} lies in positions ${(baseEditor.window || [4, 8]).join("-")} of this protospacer, so a ${baseEditor.editor || "ABE"} would not edit it.`, warnings: [] };
    built.spec.markers = markers.markers; built.spec.design.editKind = "base_edit"; built.spec.baseEditor = { editor: baseEditor.editor || "ABE", window: baseEditor.window || [4, 8], target: baseEditor.target ?? null };
  }
  return { spec: annotateSpecProtein(built.spec, protein), warnings: [...notes, ...(built.warnings || []), ...enzymeAnalysisNotes(built.spec)], source: guideList.length ? "manual" : "inferred cut" };
}

const codingCache = new Map();
/** The coding context of a design: the gene record (GenBank text) located around the design's reference window. Cached per record, reference and options. */
export function codingFor(input, spec) {
  if (!input || !input.genbank) return null;
  const reference = spec.reference.sequence;
  const key = [input.genbank.length, input.genbank.slice(0, 160), input.gene || "", input.transcript || "", JSON.stringify(input.regions || []), JSON.stringify(input.epitope || null), reference.length, reference.slice(0, 80)].join("|");
  if (!codingCache.has(key)) codingCache.set(key, buildCodingContext(input.genbank, { reference, gene: input.gene || spec.design?.gene || "", transcript: input.transcript || "", regions: input.regions || [], epitope: input.epitope || null }));
  return codingCache.get(key);
}

export function planDesign(input) {
  const plan = planDesignCore(input);
  if (plan.error) return plan;
  // A gene record given with the traces wins; otherwise the coding block of the design file is used (knockout and deletion designs, where the functional assessment applies).
  let genbank = input.genbank || ""; let fromDesign = false; const block = input.designSpec && input.designSpec.coding;
  if (!genbank && block && ["knockout", "deletion"].includes(plan.spec?.design?.editKind)) {
    const total = (block.segments || []).reduce((sum, pair) => sum + (pair[1] - pair[0]), 0);
    if (block.sequence && total > 0 && total % 3 === 0) { genbank = codingBlockToGenBank(block); fromDesign = true; }
  }
  if (!genbank) return plan;
  const o = input.codingOptions || {}; const codingInput = { genbank, gene: o.gene || "", transcript: o.transcript || "", regions: o.regions || [], epitope: o.epitope || null };
  const got = codingFor(codingInput, plan.spec); const warnings = [...(plan.warnings || [])];
  if (!got.ok) { warnings.push(`Functional knockout assessment is off: ${got.error}`); return { ...plan, warnings, codingInput: null, coding: null }; }
  const m = got.context.models[0];
  warnings.push(`Coding context${fromDesign ? " (from the design file)" : ""}: ${m.id}, ${m.protLen} residues in ${m.segs.length} coding exon${m.segs.length === 1 ? "" : "s"} (${got.context.models.length} annotated coding isoform${got.context.models.length === 1 ? "" : "s"}; the longest is used). The design's reference matches the record at ${Math.round(got.context.location.identity * 1000) / 10}%.`, ...got.context.warnings);
  return { ...plan, warnings, codingInput, coding: describeContext(got.context), codingSource: fromDesign ? "design file" : "gene record" };
}

const round = (value, digits = 3) => (value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);

const compactFunction = (fn) => ({ call: fn.call, score: { lofPct: fn.score.lofPct, uncertainPct: fn.score.uncertainPct, notLofPct: fn.score.notLofPct }, caveats: fn.caveats, confirm: fn.confirm, context: fn.context,
  rows: fn.rows.map((r) => ({ label: r.label, kind: r.kind, size: r.size, fraction: round(r.fraction, 4), class: r.class, lof: r.lof, summary: r.summary, details: r.details })) });

// The chromatograms of the first read laid onto the control (src/alignedView.js), for the report figures; never allowed to stop an analysis.
function traceViewOf(result, control, edited, options) {
  if (options.traceView === false) return undefined;
  try { return buildTraceView({ prepared: result.prepared, control, edited }) || undefined; } catch { return undefined; }
}

export function analyseSample({ name, spec, control, edited, extraReads = [], sampleType = "pool", options = {} }) {
  spec = annotateSpecProtein(hydrateCutGeometry(spec)); // the protein consequence of the designed changes (a design planned with planDesign has it already); estimates do not use it
  // Coding context (a gene record supplied with the design): turns the frameshift proxy into a functional knockout assessment.
  const codingResult = codingFor(options.codingInput, spec); const coding = codingResult && codingResult.ok ? codingResult.context : null;
  const { codingInput, ...engineOptions } = options;
  // One read: as before. Several (forward and reverse, or repeats): fitted together; each read is aligned to its own control.
  const result = extraReads.length
    ? analyseReads({ reads: [{ name: "read 1", control, edited }, ...extraReads.map((r, i) => ({ name: r.name || `read ${i + 2}`, control: r.control, edited: r.edited }))], spec, options: { ...engineOptions, sampleType, coding } })
    : analysePair({ control, edited, spec, options: { ...engineOptions, sampleType, coding } });
  if (!result.ok) return { name, kind: "trace-pair", ok: false, error: result.error, warnings: result.warnings || [] };
  const decomposition = result.decomposition;
  return {
    name, kind: "trace-pair", ok: true, sampleType, enzymeConfigVersion: ENZYME_CONFIG_VERSION, analysisModel: enzymeAnalysisNotes(spec).length ? "staggered-break-span/1" : "single-cut/1", nuclease: specNuclease(spec), cutSites: spec.guides.map(g => ({ name: g.name, strand: g.strand, cut: g.cut, ...(g.cuts ? { cuts: g.cuts } : {}) })), warnings: result.warnings, orientation: result.prepared.orientation,
    summary: result.summary, intervals: result.intervals || null, confidence: result.confidence || null, reads: result.reads || null, agreement: result.agreement || null,
    genotype: result.genotype ? { category: result.genotype.category, call: result.genotype.call, summary: result.genotype.summary, flags: result.genotype.flags, alleles: result.genotype.alleles.map((a) => ({ label: a.label, kind: a.kind, size: a.size, fraction: round(a.fraction) })) } : null,
    contributions: decomposition.contributions.slice(0, 14).map((c) => ({ label: c.label, kind: c.kind, size: c.size, fraction: round(c.fraction, 4), indistinguishable: c.indistinguishable, alsoConsistentWith: c.alsoConsistentWith })),
    functional: result.functional ? compactFunction(result.functional) : null,
    baseEdits: spec.baseEditor ? { editor: spec.baseEditor.editor, window: spec.baseEditor.window, target: spec.baseEditor.target, positions: baseEditTable(result.prepared, result.markerReadout, result.quality.upstreamRms, options.baseEdit || {}) } : null,
    unplanned: (result.unplanned || []).map((h) => ({ relative: h.relative, change: `${h.ref}>${h.alt}`, fraction: round(h.fraction, 3) })),
    markers: result.markerReadout.map((row) => ({ position: row.marker.pos, change: `${row.marker.ref}>${row.marker.alt}`, role: row.marker.role, label: row.marker.label || "", covered: row.covered, reason: row.reason || "", altEdited: round(row.altEdited), altControl: round(row.altControl), altNet: round(row.altNet), ...(row.marker.protein ? { protein: { label: row.marker.protein.label, residue: row.marker.protein.residue, from: row.marker.protein.from, to: row.marker.protein.to, silent: row.marker.protein.silent, codonFrom: row.marker.protein.codonFrom, codonTo: row.marker.protein.codonTo } } : {}) })),
    quality: { upstreamRms: round(result.quality.upstreamRms, 4), upstreamBackground: round(result.quality.upstreamBackground, 4), r2: round(decomposition.r2), noiseFraction: round(decomposition.noiseFraction), rawSum: round(decomposition.rawSum), windowLength: decomposition.windowLength, positionsUsed: decomposition.positionsUsed, candidates: decomposition.candidates, columns: decomposition.columns, discordanceBefore: round(result.quality.discordanceBefore), discordanceNearCut: round(result.quality.discordanceNearCut), discordanceAfter: round(result.quality.discordanceAfter), patches: result.prepared.patches.length },
    charts: { contributions: contributionsSvg(decomposition.contributions), discordance: discordanceSvg(result.prepared) },
    view: traceViewOf(result, control, edited, options),
  };
}

export function analyseJunction({ name, spec, trace, donorName }) {
  const result = analyseJunctionRead({ trace, spec, donorName });
  if (!result.ok) return { name, kind: "junction", ok: false, error: result.error, looksWildType: Boolean(result.looksWildType), warnings: [] };
  return {
    name, kind: "junction", ok: true, nuclease: specNuclease(spec), cutSites: (spec.guides || []).map(g => ({ name: g.name, strand: g.strand, cut: g.cut, cuts: g.cuts })), orientation: result.orientation, identity: round(result.identity, 4), alignedBases: result.alignedBases,
    verdict: result.verdict, spans: result.spans, wildTypeIdentity: round(result.wildTypeIdentity, 4),
    events: result.events.slice(0, 20).map((e) => ({ type: e.type, region: e.region, alleleIndex: e.alleleIndex, quality: e.quality, detail: e.type === "mismatch" ? `${e.expected}>${e.read}` : e.type === "deletion" ? `${e.length} bp` : e.bases || "", expectedChange: Boolean(e.expectedChange) })),
    markers: result.markers.map((m) => ({ position: m.marker.pos, change: `${m.marker.ref}>${m.marker.alt}`, label: m.marker.label || "", covered: m.covered, present: Boolean(m.present), base: m.base || "" })),
    warnings: [],
  };
}

/** One-line result for the sample table. */
export const FUNCTIONAL_WORDS = { predicted_knockout: "predicted functional knockout", predicted_knockout_with_caveats: "predicted knockout, with caveats", not_knockout: "not a knockout", uncertain: "functional effect uncertain", unclear: "no allele above the floor" };

export function headline(workflow, r) {
  if (!r.ok) return r.error;
  if (r.kind === "junction") return `${r.verdict.summary}${r.spans.fivePrimeJunction === false ? "; 5' junction not spanned" : ""}${r.spans.threePrimeJunction === false ? "; 3' junction not spanned" : ""}`;
  const s = r.summary;
  if (r.genotype) return `${r.genotype.summary}${r.functional ? ` (${FUNCTIONAL_WORDS[r.functional.call.status] || r.functional.call.status})` : ""}`;
  if (workflow === "snp" || workflow === "tag_small") return `HDR score ${s.intendedEditPct}%, blocking-only ${s.partialConversionPct}%, indels ${s.indelPct}%, wild type ${s.wtPct}%`;
  if (workflow === "deletion") return `Edited ${s.editedPct}% (deletion between cuts ${s.betweenCutsPct}%), KO score ${s.koScorePct}%`;
  return `Edited ${s.editedPct}%, KO score ${s.koScorePct}%, wild type ${s.wtPct}%`;
}

export function bandsFor(spec, observed, donorName) {
  const amplicon = (spec.amplicons || [])[0];
  if (!amplicon) return null;
  const edited = donorName && amplicon.editedBp[donorName] ? { [donorName]: amplicon.editedBp[donorName] } : amplicon.editedBp;
  return classifyBands(observed, { ...amplicon, editedBp: edited });
}
