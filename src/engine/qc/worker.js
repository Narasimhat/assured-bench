import { runJobs } from "./runJobs.js";
import { parseAbif } from "./abif.js";
import { analyseSample } from "./batch.js";
import { decide } from "./decision.js";
import { chromatogramFigure } from "./figure.js";

const sha256Hex = async (buffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))).map((b) => b.toString(16).padStart(2, "0")).join("");

self.onmessage = async (event) => {
  const { id, input, task, figure } = event.data;
  if (task) {
    // one sample (all of its reads) per message, so that a pool of workers can share a plate
    const started = Date.now();
    try {
      const controls = task.controls.map((f) => parseAbif(f.buffer, f.name)); const edited = task.edited.map((f) => parseAbif(f.buffer, f.name));
      const result = analyseSample({ name: task.name, spec: task.spec, control: controls[0], edited: edited[0], extraReads: edited.slice(1).map((e, i) => ({ name: `read ${i + 2}`, control: controls[i + 1] || controls[0], edited: e })), sampleType: task.sampleType, options: task.options || {} });
      const decision = decide(task.workflow, result, task.decisionOptions || {});
      const inputs = { controls: await Promise.all(task.controls.map(async (f) => ({ file: f.name, sha256: await sha256Hex(f.buffer) }))), edited: await Promise.all(task.edited.map(async (f) => ({ file: f.name, sha256: await sha256Hex(f.buffer) }))) };
      self.postMessage({ index: task.index, result: { ...result, decision, sampleType: task.sampleType, workflow: task.workflow, well: task.well, pairing: task.pairing, inputs, seconds: (Date.now() - started) / 1000, warnings: [...(task.planNotes || []), ...(result.warnings || [])] } });
    } catch (error) {
      self.postMessage({ index: task.index, result: { name: task.name, kind: "trace-pair", ok: false, error: String(error.message || error), warnings: [], decision: decide(task.workflow, { ok: false, error: String(error.message || error) }) } });
    }
    return;
  }
  if (figure) {
    try {
      const { svg } = chromatogramFigure({ name: figure.name, controlTrace: parseAbif(figure.control.buffer, figure.control.name), editedTrace: parseAbif(figure.edited.buffer, figure.edited.name), spec: figure.spec, sampleType: figure.sampleType, workflow: figure.workflow, options: {} });
      self.postMessage({ id, figure: svg });
    } catch (error) { self.postMessage({ id, figureError: String(error.message || error) }); }
    return;
  }
  const result = runJobs(input, (progress) => self.postMessage({ id, progress }));
  self.postMessage({ id, result });
};
