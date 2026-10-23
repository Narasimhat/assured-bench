// Zero-configuration flow, as plain functions so that it is tested without a browser: files in, pairs and a design inferred, a pool of workers
// run the samples, decisions come out. The React component only draws what these return.
import { autoPair, parseSampleSheet, resolveSheet, directionOf, looksLikePool } from "./sheet.js";
import { parseDesignReport } from "./designReport.js";
import { planDesign } from "./batch.js";
import { wellOf } from "./decision.js";

const ext = (name) => String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
export function classifyFiles(names) {
  const out = { traces: [], sheets: [], designs: [], genes: [], other: [] };
  names.forEach((name) => { const e = ext(name); if (e === "ab1" || e === "abi") out.traces.push(name); else if (e === "csv" || e === "tsv" || e === "txt") out.sheets.push(name); else if (e === "json" || e === "html" || e === "htm") out.designs.push(name); else if (e === "gb" || e === "gbk" || e === "gbff" || e === "genbank") out.genes.push(name); else out.other.push(name); });
  return out;
}

/** Pairs from an explicit control upload, a sheet (if there is one), or from the file names; every pair carries its confidence and the reason. */
export function buildPairs({ traceNames, sheetText = "", explicitControls = [] }) {
  const validControls = (explicitControls || []).filter((c) => traceNames.includes(c));
  if (validControls.length > 0) {
    const ctrlSet = new Set(validControls);
    const editedTraces = traceNames.filter((n) => !ctrlSet.has(n));
    if (!editedTraces.length) {
      return {
        pairs: [],
        problems: ["Parental control trace loaded. Now add one or more edited clone .ab1 traces in Box 2 to pair and analyse."],
        source: "explicit",
      };
    }
    const stems = new Map();
    editedTraces.forEach((name) => {
      const { stem, direction } = directionOf(name);
      const pool = looksLikePool(name);
      const slotKey = direction ? stem : name.replace(/^.*[\\/]/, "").replace(/\.(ab1|abi|abif|scf)$/i, "");
      if (!stems.has(slotKey)) stems.set(slotKey, { pool, files: [] });
      const slot = stems.get(slotKey);
      slot.pool = slot.pool || pool;
      slot.files.push({ name, direction: direction || "F" });
    });
    const orderedControls = [...validControls].sort((a, b) => {
      const da = directionOf(a).direction || "F";
      const db = directionOf(b).direction || "F";
      return da === db ? 0 : da === "F" ? -1 : 1;
    });
    const pairs = [];
    for (const [sample, slot] of stems) {
      const sortedEdited = slot.files
        .sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "F" ? -1 : 1))
        .map((x) => x.name);
      pairs.push({
        sample,
        edited: sortedEdited,
        control: orderedControls.slice(0, 2),
        type: slot.pool ? "pool" : "clone",
        confidence: "explicit",
        reason: "paired with uploaded Parental Control trace",
      });
    }
    return { pairs, problems: [], source: "explicit" };
  }
  if (sheetText.trim()) {
    const sheet = parseSampleSheet(sheetText); const resolved = resolveSheet(sheet.rows, traceNames);
    return { pairs: resolved.jobs.filter((j) => j.ok).map((j) => ({ sample: j.sample, edited: j.edited, control: j.control, type: j.type, confidence: "sheet", reason: "from the sample sheet", guides: j.guides, donor: j.donor, workflow: j.workflow })), problems: [...sheet.errors, ...resolved.problems], source: "sheet" };
  }
  const paired = autoPair(traceNames);
  return { pairs: paired.pairs, problems: [...paired.unpaired.map((u) => `${u.name}: ${u.reason}`), ...paired.problems.map((p) => `Check: ${p}`)], source: "names" };
}

/** A design from what was dropped: a JSON spec, an HTML design report, or nothing (the guides then come from the text box or from the traces). */
export function readDesign(text, { designIndex = 0 } = {}) {
  if (!text) return { kind: "none" };
  if (/^\s*[{[]/.test(text)) { const spec = JSON.parse(text); return { kind: "spec", spec, label: spec.design?.label || spec.design?.gene || "design file" }; }
  const designs = parseDesignReport(text); const chosen = designs[Math.min(designIndex, designs.length - 1)];
  return { kind: "report", designs, chosen, guides: chosen.guides.map((g) => g.sequence), donors: chosen.donors, label: chosen.title, protein: chosen.protein || [] };
}

/**
 * What the classic form takes from a design file: a JSON spec as it is, or, from an HTML design report, its guides and its recommended donor
 * (a report has no reference window, so it cannot stand in for the spec in the junction check). Throws the parser's message for a file that is neither.
 */
export function readDesignForForm(text, { needsDonor = false, isJunction = false } = {}) {
  const d = readDesign(text);
  if (d.kind === "none") throw new Error("The file is empty.");
  if (d.kind === "spec") return { kind: "spec", spec: d.spec, label: d.label, note: "" };
  const donor = d.donors.find((x) => x.recommended) || d.donors[0] || null;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const notes = [`Read ${plural(d.guides.length, "guide")} and ${plural(d.donors.length, "donor")} from the design report "${d.label}"${d.designs.length > 1 ? ` (the file holds ${d.designs.length} designs; the first was used)` : ""}.`];
  if (needsDonor && !donor) notes.push("The report has no ssODN donor (a long knock-in donor is not read from a report): paste it below.");
  if (isJunction) notes.push("The junction check needs the .json design file; a report gives only guides and donors.");
  return { kind: "report", guides: d.guides.join(", "), donor: donor ? donor.sequence : "", label: d.label, protein: d.protein || [], note: notes.join(" ") };
}

export function inferWorkflow(spec) {
  if (!spec) return "knockout";
  if ((spec.donors || []).length) return (spec.donors[0].insertBp || 0) > 0 ? "tag_small" : "snp";
  return spec.guides.length > 1 ? "deletion" : "knockout";
}

/** The donors of a design report that are used together: all the ones recommended to order (ssODNs matched to each guide), else the first; one donor stays a plain sequence. */
export function reportDonors(donors) {
  const chosen = donors.filter((d) => d.recommended); const list = chosen.length ? chosen : donors.slice(0, 1);
  if (list.length <= 1) return list[0] ? list[0].sequence : "";
  return list.map((d) => ({ name: d.name, sequence: d.sequence }));
}

/** One task per sample. `getTrace(name)` returns a parsed trace; the plan (spec) is made once per distinct control, guides and donor. */
export function planTasks({ pairs, getTrace, design = { kind: "none" }, guides = [], donor = "", nuclease = "SpCas9", workflow = "auto", sampleType = "", goal = "homozygous", baseEditor = null, genbank = "", codingOptions = {} }) {
  const cache = new Map(); const tasks = []; const problems = [];
  const designGuides = design.kind === "report" ? design.guides : []; const designDonor = design.kind === "report" ? reportDonors(design.donors) : "";
  pairs.forEach((pair, index) => {
    const g = pair.guides?.length ? pair.guides : (guides.length ? guides : designGuides); const d = pair.donor || donor || designDonor;
    const key = JSON.stringify([pair.control[0], g, d, design.kind === "spec" ? "spec" : "", pair.nuclease || nuclease]);
    if (!cache.has(key)) {
      const control = getTrace(pair.control[0]);
      const sameControl = pairs.filter((p) => p.control[0] === pair.control[0]).slice(0, 6);
      cache.set(key, planDesign({ designSpec: design.kind === "spec" ? design.spec : null, control, guides: g, donor: d, protein: design.kind === "report" ? design.protein : undefined, gene: "sample", nuclease: pair.nuclease || nuclease, baseEditor, genbank, codingOptions, editedForCut: g.length || design.kind === "spec" ? [] : sameControl.map((p) => { try { return getTrace(p.edited[0]); } catch { return null; } }).filter(Boolean) }));
    }
    const plan = cache.get(key);
    if (plan.error) { problems.push(`${pair.sample}: ${plan.error}`); return; }
    tasks.push({ index: tasks.length, name: pair.sample, nuclease: plan.spec.nuclease || plan.spec.design?.nuclease || pair.nuclease || nuclease, spec: plan.spec, workflow: workflow !== "auto" ? workflow : baseEditor ? "base_edit" : (pair.workflow || inferWorkflow(plan.spec)), sampleType: sampleType || pair.type || "clone", controls: pair.control, edited: pair.edited, decisionOptions: { goal }, options: plan.codingInput ? { codingInput: plan.codingInput } : {}, planNotes: plan.warnings || [], pairing: { confidence: pair.confidence, reason: pair.reason }, well: wellOf(pair.edited[0]) });
  });
  return { tasks, problems };
}

/**
 * Run tasks on a pool. `spawn()` returns a worker-like object ({ postMessage, onmessage, terminate }); `payload(task)` builds the message for a
 * task (the buffers). Results come back in task order; a worker that fails is reported as a failed sample, not as a failed run.
 */
export function runPool({ tasks, spawn, size, payload, onProgress = () => {} }) {
  const results = new Array(tasks.length); let next = 0; let done = 0; const workers = [];
  return new Promise((resolve) => {
    if (!tasks.length) { resolve(results); return; }
    const finishOne = (worker, index, result) => { results[index] = result; done += 1; onProgress({ done, total: tasks.length, name: tasks[index].name }); if (next < tasks.length) { const i = next; next += 1; worker.current = i; worker.postMessage(payload(tasks[i], i)); } else if (done === tasks.length) { workers.forEach((w) => w.terminate()); resolve(results); } };
    for (let k = 0; k < Math.min(size, tasks.length); k += 1) {
      const worker = spawn(); workers.push(worker);
      worker.onmessage = (event) => finishOne(worker, event.data.index, event.data.result);
      worker.onerror = (event) => { const failed = worker.current ?? -1; if (failed >= 0) finishOne(worker, failed, { name: tasks[failed].name, kind: "trace-pair", ok: false, error: `The worker stopped: ${event.message || "error"}`, warnings: [], decision: { decision: "re-sequence", reasons: ["The analysis of this sample stopped unexpectedly."], next: "Try again." } }); };
      const i = next; next += 1; worker.current = i; worker.postMessage(payload(tasks[i], i));
    }
  });
}
