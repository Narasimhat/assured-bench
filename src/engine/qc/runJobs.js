// Everything the web worker does, as a plain function so that it can be tested without a browser.
import { parseAbif } from "./abif.js";
import { planDesign, analyseSample, analyseJunction, bandsFor, WORKFLOWS } from "./batch.js";

const baseName = (name) => String(name).replace(/\.ab1$/i, "").replace(/\.[^.]+$/, "");

/** "clone1: 841, 631" per line (a line with no name applies to every sample). */
export function parseBandsText(text) {
  const byName = new Map(); let all = null;
  String(text || "").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim(); if (!trimmed) return;
    const colon = trimmed.indexOf(":");
    const sizes = (colon >= 0 ? trimmed.slice(colon + 1) : trimmed).split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
    if (colon >= 0) byName.set(trimmed.slice(0, colon).trim(), sizes); else all = sizes;
  });
  return { byName, all };
}

export function runJobs(input, onProgress = () => {}) {
  const { workflow, designSpec = null, manual = {}, control = null, samples = [], sampleType = "pool", bandsText = "", options = {} } = input;
  const flow = WORKFLOWS[workflow];
  if (!flow) return { ok: false, error: `Unknown workflow "${workflow}".` };
  if (!samples.length) return { ok: false, error: flow.method === "junction" ? "Add at least one sequencing read." : "Add at least one edited trace." };
  const notes = [];
  let controlTrace = null;
  try {
    if (flow.method === "trace") {
      if (!control) return { ok: false, error: "Add the control (unedited) trace." };
      controlTrace = parseAbif(control.buffer, control.name);
    }
    const plan = flow.method === "junction"
      ? (designSpec ? planDesign({ designSpec }) : { error: "Large-insert and reporter checks need the exported design file (it holds the expected knock-in sequence)." })
      : planDesign({ designSpec, control: controlTrace, guides: manual.guides, donor: manual.donor, protein: manual.protein, gene: manual.gene, nuclease: manual.nuclease, baseEditor: input.baseEditor || null, genbank: input.genbank || "", codingOptions: input.codingOptions || {}, editedForCut: flow.method === "trace" ? samples.slice(0, 6).map((s) => { try { return parseAbif(s.buffer, s.name); } catch { return null; } }).filter(Boolean) : [] });
    if (plan.error) return { ok: false, error: plan.error };
    if (flow.needsDonor && !(plan.spec.donors || []).length) return { ok: false, error: "This workflow needs a donor: use a design file that has one, or paste the donor sequence." };
    (plan.warnings || []).forEach((w) => notes.push(w));
    const bands = parseBandsText(bandsText);
    const results = [];
    samples.forEach((sample, index) => {
      onProgress({ done: index, total: samples.length, name: sample.name });
      let result;
      try {
        const trace = parseAbif(sample.buffer, sample.name);
        result = flow.method === "junction"
          ? analyseJunction({ name: baseName(sample.name), spec: plan.spec, trace })
          : analyseSample({ name: baseName(sample.name), spec: plan.spec, control: controlTrace, edited: trace, sampleType, options: { ...options, codingInput: plan.codingInput || null } });
      } catch (error) {
        result = { name: baseName(sample.name), kind: flow.method === "junction" ? "junction" : "trace-pair", ok: false, error: `Could not read ${sample.name}: ${error.message}`, warnings: [] };
      }
      const observed = bands.byName.get(baseName(sample.name)) || bands.byName.get(sample.name) || bands.all;
      if (observed && observed.length) result.bands = bandsFor(plan.spec, observed);
      results.push(result);
    });
    onProgress({ done: samples.length, total: samples.length, name: "" });
    return {
      ok: true, source: plan.source, notes, results,
      design: { type: plan.spec.design?.type, editKind: plan.spec.design?.editKind, gene: plan.spec.design?.gene, label: plan.spec.design?.label, guides: plan.spec.guides.map((g) => ({ name: g.name, spacer: g.spacer, strand: g.strand, pam: g.pam })), donors: (plan.spec.donors || []).map((d) => ({ name: d.name, format: d.format, length: d.sequence.length, insertBp: d.insertBp || 0 })), markers: (plan.spec.markers || []).length },
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
