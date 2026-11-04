// The clone table and the review panel, driven with simulated results: flags and chips, the flagged filter, the inspector, and import of a splice result for exactly its own request.
// The same scenario runs under vite in CI (test/decision-clone-flags.test.js).
import { readFileSync } from "node:fs";
import { runDesign } from "../../src/engine/design/designEngine.js";
import { buildQcDesignSpec } from "../../src/engine/design/qcExport.js";
import { buildCloneSpliceRequest, CLONE_SPLICE_RESULT_SCHEMA } from "../../src/services/cloneReview.js";

const text = (node) => (typeof node === "string" ? node : (node?.children || []).map(text).join(""));
const flush = async (act, ms = 80) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };

export function simulatedProject() {
  const raw = readFileSync(new URL("../../public/references/apoe-ensg00000130203.gb", import.meta.url), "utf8");
  const designResult = runDesign("pm", raw, "R176C", "", "", { enzyme: "spcas9" });
  const spec = buildQcDesignSpec(designResult); const donor = spec.donors[0];
  const carried = spec.markers.filter((m) => m.pos >= donor.refStart && m.pos < donor.refEnd && (!donor.carriesMarkers || donor.carriesMarkers.includes(m.pos)));
  const window = spec.reference.sequence; const other = (b) => ({ A: "C", C: "A", G: "T", T: "G" }[b]);
  const intended = { label: "Intended edit (ssODN1)", kind: "edit", size: 0, fraction: 1, edits: carried.map((m) => ({ start: m.pos, end: m.pos + 1, ref: m.ref, inserted: m.alt, role: m.role === "intended" ? "intended" : "blocking" })) };
  const at = 40; const change = { position: at, relative: -5, ref: window[at], alt: other(window[at]), fraction: 0.9, confirmed: true, readsSeen: 2, readsCovering: 2, consequence: { class: "nonsense", label: "R202*", proteinChanging: true, damaging: true } };
  const dAt = donor.refStart + 5;
  const deletion = { label: "Donor edit with -4", kind: "edit_indel", size: -4, fraction: 0.5, edits: [{ start: dAt, end: dAt + 4, ref: window.slice(dAt, dAt + 4), inserted: "", role: "indel" }] };
  const flag = (code, severity, body, extra = {}) => ({ code, severity, text: body, ...extra });
  const base = { ok: true, kind: "trace-pair", sampleType: "clone", workflow: "snp", summary: { intendedEditPct: 99, partialConversionPct: 0, wtPct: 0 }, confidence: { tier: "high" }, genotype: { summary: "Homozygous for the intended edit" }, warnings: [] };
  const qcResults = [
    { ...base, name: "c1", decision: { decision: "accept", reasons: ["Intended edit at least 99%."] }, alleles: [intended], unwanted: { changes: [], flags: [], worst: null }, recommendation: { rank: 1, priority: "first", action: "Carry forward" } },
    { ...base, name: "c2", decision: { decision: "accept", reasons: ["Intended edit at least 98%."] }, alleles: [intended], unwanted: { changes: [], flags: [], worst: null } },
    { ...base, name: "c3", decision: { decision: "hold", reasons: ["A>T at -5 from the first cut (synonymous)."], unwanted: "review" }, alleles: [intended], unwanted: { changes: [{ ...change, consequence: { class: "synonymous", label: "L1L" }, confirmed: false, severity: "review" }], flags: [flag("unplanned-base", "review", "A>T at -5 from the first cut (L1L, synonymous), 90% of the signal, seen in one read only.")], worst: "review" } },
    { ...base, name: "c4", decision: { decision: "hold", reasons: ["An indel allele sits next to the intended edit."], unwanted: "review" }, alleles: [{ ...intended, fraction: 0.5 }, deletion], unwanted: { changes: [], flags: [flag("indel-at-cut", "review", "An indel allele sits next to the intended edit (-4 50%).", { knockInOnly: true })], worst: "review" } },
    { ...base, name: "c5", decision: { decision: "reject", reasons: ["A>T at -5 (R202*, nonsense) seen in 2 reads."], unwanted: "block" }, alleles: [intended], unwanted: { changes: [{ ...change, severity: "block" }], flags: [flag("unplanned-base", "block", "A>T at -5 from the first cut (R202*, nonsense), 90% of the signal, seen in 2 reads. Do not carry it forward.")], worst: "block" } },
  ];
  const project = { id: "p1", gene: "APOE", mutation: "R176C", editType: "pm", genbankRaw: raw, options: { enzyme: "spcas9" }, designResult, qcResults };
  return { project, qcResults };
}

export async function exercise({ DecisionView, React, TestRenderer, assert }) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { act } = TestRenderer;
  const { project, qcResults } = simulatedProject();
  const updates = [];
  const render = async (p) => {
    let tree;
    await act(async () => { tree = TestRenderer.create(React.createElement(DecisionView, { currentProject: p, onBackToQc() {}, onUpdateProject: (fields) => updates.push(fields) })); });
    await flush(act);
    return tree;
  };
  const find = (tree, predicate) => tree.root.findAll(predicate);
  const buttons = (tree, label) => find(tree, (n) => n.type === "button" && text(n).trim() === label);

  // 1. flags and chips, no predictor result yet
  let tree = await render(project);
  assert.equal(text(find(tree, (n) => n.props?.["data-testid"] === "flagged-count")[0]), "3", "c3 (unplanned base), c4 (indel allele) and c5 (stop codon) are flagged");
  const page = text(tree.root);
  for (const word of ["Unplanned base", "Indel allele", "Flagged: unwanted changes"]) assert.ok(page.includes(word), word);
  assert.ok(buttons(tree, "flagged").length === 1, "a filter for flagged clones");
  const chips = find(tree, (n) => n.type === "span" && typeof n.props?.title === "string" && /nonsense/.test(n.props.title));
  assert.ok(chips.length >= 1, "the chip of the rejected clone carries the protein effect in its title");

  // 2. the filter
  await act(async () => { buttons(tree, "flagged")[0].props.onClick(); });
  const flaggedTable = find(tree, (n) => n.type === "table" && !n.props["aria-label"])[0];
  const names = flaggedTable.findAll((n) => n.type === "strong").map((n) => text(n));
  assert.deepEqual(names.sort(), ["c3", "c4", "c5"]);

  // 3. the review panel offers the exports for these clones
  const exportSplice = buttons(tree, "Export SpliceAI request")[0];
  assert.ok(exportSplice && exportSplice.props.disabled === false, "the SpliceAI request is built from the open design");
  assert.equal(buttons(tree, "Export AlphaGenome request")[0].props.disabled, true, "no cell type chosen yet");

  // 4. a splice result for exactly this request is imported; one for another request is refused
  const request = await buildCloneSpliceRequest(project, qcResults);
  const rows = {}; request.alleles.forEach((a) => { rows[a.id] = { editEffectMax: 0.01, unwantedEffectMax: a.unwanted ? 0.4 : null, unwantedOnlyMax: a.unwanted ? 0.4 : null }; });
  const result = { schema: CLONE_SPLICE_RESULT_SCHEMA, tool: "SpliceAI", version: "1.3.1", requestId: request.requestId, summary: { alleles: rows } };
  const input = find(tree, (n) => n.type === "input" && n.props["aria-label"] === "SpliceAI clone result file")[0];
  const file = (data) => ({ size: 1000, text: async () => JSON.stringify(data) });
  await act(async () => { await input.props.onChange({ target: { files: [file({ ...result, requestId: "0".repeat(64) })] } }); });
  assert.ok(text(tree.root).includes("different set of clones"), "a result for another request is refused with the reason");
  assert.equal(updates.length, 0);
  await act(async () => { await input.props.onChange({ target: { files: [file(result)] } }); });
  assert.equal(updates.length, 1);
  const saved = updates[0].cloneReview.splice;
  assert.equal(saved.requestId, request.requestId);
  assert.equal(saved.summary.clones.c3.verdict, "fail");

  // 5. with the result stored, the table and the flags carry it; a stale result is left out
  const withResult = { ...project, cloneReview: updates[0].cloneReview };
  tree = await render(withResult);
  const verdictTable = find(tree, (n) => n.type === "table" && n.props["aria-label"] === "Predicted splice and expression effect per clone")[0];
  assert.ok(verdictTable, "the per-clone prediction table");
  assert.ok(text(verdictTable).includes("advises against"));
  assert.ok(text(tree.root).includes("Splice: against"), "a splice flag on the clone");
  const stale = { ...project, cloneReview: { splice: { ...updates[0].cloneReview.splice, requestId: "f".repeat(64) } } };
  tree = await render(stale);
  assert.ok(text(tree.root).includes("belongs to an earlier set of clones"), "an outdated result is shown as outdated");
  assert.ok(!text(tree.root).includes("Splice: against"), "and does not flag anything");
}
