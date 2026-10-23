import { useEffect, useMemo, useRef, useState } from "react";
import { classifyFiles, buildPairs, readDesign, planTasks, runPool } from "./quick.js";
import { parseCodingFields } from "./coding.js";
import { parseAbif } from "./abif.js";
import { headline } from "./batch.js";
import { buildQcReportHtml, buildResultsCsv } from "./report.js";
import { buildPlateReportHtml, resequenceListCsv } from "./plateReport.js";
import { tally, DECISION_ORDER } from "./decision.js";
import { withRecommendations, recommendationCsv, panelOf } from "./recommend.js";
import { runProteinFigure } from "./proteinFigure.js";
import { runSummaryFigure } from "./summaryFigure.js";
import { alignedGroups, clonesAlignedFigure, clonesAlignmentFigure } from "./alignedFigure.js";
import { cloneSelectionFigure } from "./selectionFigure.js";
import { saveSvg, savePng, savePdf } from "./saveFigure.js";
import { NUCLEASES } from "./nucleases.js";
import { expandImportFiles } from "./importFiles.js";
import { cleanDna } from "./seq.js";
import Detail from "./Detail.jsx";
import IceExport from "./IceExport.jsx";

const LABEL = { accept: "Accept", hold: "Hold", "re-sequence": "Sequence again", reject: "Reject" };
const download = (name, data, type) => { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
const arrayBufferOf = (file) => file.arrayBuffer();
const interval = (iv) => (iv ? `${iv[0]}-${iv[1]}%` : "");

export default function QuickStart({ initialDesign = null, onResults } = {}) {
  const filePicker = useRef(null); const folderPicker = useRef(null); const designPicker = useRef(null);
  const files = useRef(new Map()); const buffers = useRef(new Map());
  const [traceNames, setTraceNames] = useState([]); const [sheetText, setSheetText] = useState(""); const [designText, setDesignText] = useState(""); const [designName, setDesignName] = useState(""); const [geneText, setGeneText] = useState(""); const [geneName, setGeneName] = useState(""); const [regionsText, setRegionsText] = useState(""); const [epitopeText, setEpitopeText] = useState("");
  const [guidesText, setGuidesText] = useState(""); const [donorText, setDonorText] = useState(""); const [nuclease, setNuclease] = useState("SpCas9"); const [typeOverride, setTypeOverride] = useState(""); const [goal, setGoal] = useState("homozygous");
  const [customSequenceMode, setCustomSequenceMode] = useState(false);
  const [pairsEdit, setPairsEdit] = useState({}); const [running, setRunning] = useState(false); const [progress, setProgress] = useState(null);
  const [outcome, setOutcome] = useState(null); const [picked, setPicked] = useState(0); const [panel, setPanel] = useState(0); const [figureBusy, setFigureBusy] = useState(false); const [error, setError] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  const [designIndex, setDesignIndex] = useState(0);

  useEffect(() => {
    if ((initialDesign?.text || "") === designText) return;
    setDesignText(initialDesign?.text || ""); setDesignName(initialDesign ? initialDesign.name || "Bench design" : ""); setDesignIndex(0);
    files.current.clear(); buffers.current.clear();
    setTraceNames([]); setPairsEdit({}); setOutcome(null); setError("");
  }, [initialDesign]);
  const previousOutcome = useRef(null);
  useEffect(() => {
    if (!outcome && previousOutcome.current && onResults) onResults({ results: [] });
    previousOutcome.current = outcome;
    if (outcome && onResults) onResults({ results: withRecommendations(outcome.results, panel ? { panel } : {}), designText, designName });
  }, [outcome, panel, onResults]);

  const addFiles = async (list) => {
    if (running) return;
    try {
      setError("");
      const selected = Array.from(list || []);
      setImportStatus("Reading selected files…");
      const expanded = await expandImportFiles(selected);
      const duplicates = [];
      const seen = new Set(files.current.keys());
      const incoming = expanded.files.filter((f) => {
        if (/\.(ab1|abi)$/i.test(f.name) && seen.has(f.name)) { duplicates.push(f.name); return false; }
        seen.add(f.name); return true;
      });
      const kinds = classifyFiles(incoming.map((f) => f.name));
      setImportStatus(`${kinds.traces.length} new traces; ${duplicates.length} traces already loaded; ${kinds.designs.length} design files; ${kinds.sheets.length} sample-sheet files; ${expanded.skipped.length} unsupported files skipped.`);
      if (!incoming.length) {
        if (duplicates.length) setImportStatus(`All ${duplicates.length} selected traces are already loaded. Your existing analysis is unchanged. See Loaded traces below.`);
        else setImportStatus(selected.length ? "No supported files found. Select the folder containing AB1 files, or use Add files to select AB1 files or a sequencing ZIP." : "The browser returned no files. Use Add files to select the AB1 files inside the folder; for a network drive, try a local copy.");
        return;
      }
      incoming.forEach((f) => { files.current.set(f.name, f); buffers.current.delete(f.name); });
      setTraceNames((previous) => Array.from(new Set([...previous, ...kinds.traces]))); setPairsEdit({}); setOutcome(null);
      const sheet = incoming.find((f) => kinds.sheets.includes(f.name)); if (sheet) setSheetText(await sheet.text());
      const design = incoming.find((f) => kinds.designs.includes(f.name)); if (design) { setDesignName(design.name); setDesignText(""); setDesignIndex(0); setDesignText(await design.text()); }
      const gene = incoming.find((f) => kinds.genes.includes(f.name)); if (gene) { setGeneText(await gene.text()); setGeneName(gene.name); }
      if (duplicates.length) setError(`Already loaded: ${duplicates.join(", ")}. Kept the existing traces. For different reads with the same filename, rename them before adding; to replace a trace, remove it first.`);
      if (kinds.designs.length > 1) setError("More than one design file was selected. Loaded the first; use Replace design to choose a different report.");
    } catch (e) { setImportStatus(""); setError(`Could not read the selected file. Try copying it from the network drive to a local folder and selecting it again. ${e.message || ""}`); }
  };

  const built = useMemo(() => (traceNames.length ? buildPairs({ traceNames, sheetText }) : { pairs: [], problems: [] }), [traceNames, sheetText]);
  const design = useMemo(() => { try { return { ...readDesign(designText, { designIndex }), error: "" }; } catch (e) { return { kind: "none", error: e.message }; } }, [designText, designIndex]);
  const pairs = built.pairs.map((p, i) => ({ ...p, ...(pairsEdit[i] || {}) }));
  const guides = guidesText.split(/[,;\s]+/).map(cleanDna).filter(Boolean);
  const lowCount = pairs.filter((p) => p.confidence === "low").length;

  const designGuides = useMemo(() => {
    if (design.kind === "report") return design.guides || [];
    if (design.kind === "spec") return (design.spec?.guides || []).map((g) => g.spacer || g.sequence || "");
    return [];
  }, [design]);

  const designDonors = useMemo(() => {
    if (design.kind === "report") return design.donors || [];
    if (design.kind === "spec") return design.spec?.donors || [];
    return [];
  }, [design]);

  const handlePopulateFromDesign = () => {
    if (designGuides.length) setGuidesText(designGuides.join(", "));
    const dSeq = typeof designDonors[0] === "string" ? designDonors[0] : (designDonors[0]?.sequence || "");
    if (dSeq) setDonorText(dSeq);
    setCustomSequenceMode(true);
  };

  const isUsingCustom = customSequenceMode || !designName;
  const guideSource = isUsingCustom
    ? (guides.length ? `the guides entered below (${guides.length} guide${guides.length === 1 ? "" : "s"})` : "none: the cut site will be inferred from where the traces depart from the control")
    : (design.kind === "spec" ? `the design file (${design.label})` : design.kind === "report" ? `the design report (${design.label}: ${design.guides.length} guide${design.guides.length === 1 ? "" : "s"})` : guides.length ? "the guides entered below" : "none: the cut site will be inferred from where the traces depart from the control");

  const run = async () => {
    if (!customSequenceMode && (design.error || (designName && !designText))) { setError("Replace or remove the unreadable design before analysing."); return; }
    setRunning(true); setOutcome(null); setPicked(0); setError("");
    try {
      const needed = new Set(pairs.flatMap((p) => [...p.control, ...p.edited]));
      for (const name of needed) if (!buffers.current.has(name)) buffers.current.set(name, await arrayBufferOf(files.current.get(name)));
      const parsed = new Map(); const getTrace = (name) => { if (!parsed.has(name)) parsed.set(name, parseAbif(buffers.current.get(name).slice(0), name)); return parsed.get(name); };
      const coding = geneText ? parseCodingFields({ regionsText, epitopeText }) : { options: {}, problems: [] };
      if (coding.problems.length) { setError(coding.problems.join(" ")); setRunning(false); return; }
      const effectiveDesign = customSequenceMode || !designName ? { kind: "none" } : design;
      const cleanDonor = cleanDna(donorText.replace(/^>.*$/gm, "").replace(/\d+/g, ""));
      const { tasks, problems } = planTasks({ pairs, getTrace, design: effectiveDesign, guides, donor: cleanDonor, nuclease, sampleType: typeOverride, goal, genbank: geneText, codingOptions: coding.options });
      if (!tasks.length) { setError(problems.join(" ") || "Nothing to analyse."); setRunning(false); return; }
      setProgress({ done: 0, total: tasks.length });
      const size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
      const results = await runPool({ tasks, size, spawn: () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" }), onProgress: setProgress,
        payload: (task, index) => ({ task: { ...task, index, controls: task.controls.map((n) => ({ name: n, buffer: buffers.current.get(n).slice(0) })), edited: task.edited.map((n) => ({ name: n, buffer: buffers.current.get(n).slice(0) })) } }) });
      setOutcome({ results, tasks, problems: [...built.problems, ...problems], workflow: tasks[0].workflow });
    } catch (e) { setError(e.message || String(e)); }
    setRunning(false); setProgress(null);
  };

  const result = outcome ? outcome.results[picked] : null; const counts = outcome ? tally(outcome.results.map((r) => r.decision)) : null;
  const runFigure = outcome ? runProteinFigure(outcome.results) : ""; const koRun = outcome ? outcome.workflow === "knockout" || outcome.workflow === "deletion" : false; const panelAuto = koRun ? 3 : 6; const ranked = outcome ? withRecommendations(outcome.results, panel ? { panel } : {}) : null; const selectionSvg = ranked ? cloneSelectionFigure(ranked) : ""; const summaryFigure = ranked ? runSummaryFigure(ranked) : ""; const recommendation = ranked && ranked[picked] ? ranked[picked].recommendation : null;
  const alignedList = ranked ? alignedGroups(ranked).map((items) => ({ items, grid: clonesAlignmentFigure(items), stack: items.length <= 48 ? clonesAlignedFigure(items) : "" })) : [];
  const PRIORITY_LABEL = { first: "carry forward", confirmed: "confirmed", reserve: "reserve", duplicate: "backup", caution: "protein still made", not_recommended: "not recommended", discard: "discard", resequence: "sequence again" };
  const stamp = new Date().toISOString().slice(0, 10);
  const figure = async (format) => {
    if (!outcome || !result || !result.ok) return; setFigureBusy(true);
    try {
      const task = outcome.tasks[picked]; const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      const svg = await new Promise((resolve, reject) => { worker.onmessage = (e) => (e.data.figure ? resolve(e.data.figure) : reject(new Error(e.data.figureError))); worker.postMessage({ id: 1, figure: { name: task.name, spec: task.spec, sampleType: task.sampleType, workflow: task.workflow, control: { name: task.controls[0], buffer: buffers.current.get(task.controls[0]).slice(0) }, edited: { name: task.edited[0], buffer: buffers.current.get(task.edited[0]).slice(0) } } }); });
      worker.terminate();
      if (format === "svg") download(`${task.name}_figure.svg`, svg, "image/svg+xml");
      else if (format === "pdf") await savePdf(`${task.name}_figure.pdf`, svg);
      else { const scale = 300 / 96; const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); const img = new Image(); await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; }); const canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale); const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); canvas.toBlob((blob) => download(`${task.name}_figure_300dpi.png`, blob, "image/png")); }
    } catch (e) { setError(`Could not make the figure: ${e.message}`); }
    setFigureBusy(false);
  };

  return (
    <div className="card quick">
      <h2>Quick start: add files or a folder</h2>
      <div className={`drop${dragging ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "8px" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-main)" }}>
              {designName ? "Provide parental control and sample .ab1 files" : "Drop AB1 chromatogram files, sequencing ZIPs, or design reports"}
            </div>
            <div className="muted" style={{ fontSize: "12px", marginTop: "2px" }}>
              {designName ? "Upload control & sample traces together (forward and reverse reads supported)." : "Accepts .ab1 traces, sequencing ZIPs, design reports (.html/.json), sample sheets (.csv), and GenBank files."}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <input ref={filePicker} hidden style={{ display: "none" }} type="file" multiple accept=".zip,.ab1,.abi,.csv,.tsv,.json,.html,.htm,.gb,.gbk,.gbff,.genbank,text/html,application/json" disabled={running} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} aria-label="Choose files" />
            <button type="button" disabled={running} onClick={() => filePicker.current.click()}>
              {designName ? "Add AB1 Traces or ZIP" : "Add files (AB1, ZIP, HTML, JSON)"}
            </button>
            <input ref={folderPicker} hidden style={{ display: "none" }} type="file" multiple webkitdirectory="" directory="" disabled={running} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} aria-label="Choose a folder" />
            <button type="button" disabled={running} onClick={() => folderPicker.current.click()}>
              {designName ? "Add trace folder" : "Add folder"}
            </button>
          </div>
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-dim)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
          <span>Traces and design files stay loaded. Add folders or files one at a time.</span>
          <span>🔒 Files are processed 100% locally in your browser; never uploaded.</span>
        </div>
      </div>
      {importStatus && <p role="status" className="note">{importStatus}</p>}
      <input ref={designPicker} hidden style={{ display: "none" }} id="q-design" aria-label="Design report file" type="file" accept=".html,.htm,.json,text/html,application/json" disabled={running} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      {!designName && <p className="muted" style={{ margin: "8px 0" }}>Add a design report (HTML or JSON) using Add files above, or enter gRNA and donor sequences directly below.</p>}
      {designName && <div role="status">
        <p><b>{design.error ? "Design needs attention:" : "Design loaded & parsed:"}</b> {designName} <button type="button" disabled={running} onClick={() => designPicker.current.click()}>Replace design</button> <button type="button" disabled={running} onClick={() => { setDesignName(""); setDesignText(""); setDesignIndex(0); setOutcome(null); setError(""); }}>Remove design</button></p>
        {design.error ? <p className="error">{design.error} Replace or remove this file to continue.</p> : design.kind === "report" ? <>
          {design.designs.length > 1 && <><label htmlFor="q-design-choice">Design in this report</label><select id="q-design-choice" disabled={running} value={designIndex} onChange={(e) => { setDesignIndex(Number(e.target.value)); setOutcome(null); }}>{design.designs.map((d, i) => <option key={i} value={i}>{d.title}</option>)}</select></>}
          <p>Imported {design.label}: {design.guides.length} guides, {design.donors.length} donors.{design.donors.filter((d) => d.recommended).length > 1 ? ` The ${design.donors.filter((d) => d.recommended).length} recommended donors are used together.` : ""}</p>
          <ul>{design.chosen.guides.map((g) => <li key={g.sequence}>{g.name}: <code>{g.sequence}</code></li>)}</ul>
          {!traceNames.length && <p className="note" style={{ color: "var(--success)", fontWeight: 500, margin: "0.5rem 0" }}>✓ Design ready. Now please provide your matching parental control (e.g. Ctrl.ab1) and edited clone sample .ab1 files above.</p>}
        </> : design.kind === "spec" ? <>
          <p><b>Imported design:</b> {design.spec?.design?.gene ? `${design.spec.design.gene} — ` : ""}{design.label} ({design.spec?.guides?.length || 0} guide{design.spec?.guides?.length === 1 ? "" : "s"}{design.spec?.donors?.length ? `, ${design.spec.donors.length} donor${design.spec.donors.length === 1 ? "" : "s"}` : ""}).</p>
          {design.spec?.guides?.length > 0 && <ul>{design.spec.guides.map((g, gi) => <li key={g.spacer || gi}><strong>{g.name || `Guide ${gi + 1}`}</strong>: <code>{g.spacer}</code> (PAM: {g.pam || "NGG"}{g.strand ? `, strand ${g.strand}` : ""})</li>)}</ul>}
          {!traceNames.length && <p className="note" style={{ color: "var(--success)", fontWeight: 500, margin: "0.5rem 0" }}>✓ Design ready. Now please provide your matching parental control (e.g. Ctrl.ab1) and edited clone sample .ab1 files above.</p>}
        </> : <p className="note">The design is empty or could not be read. Replace or remove it to continue.</p>}
      </div>}

      {/* Prominent gRNA and Donor Sequences Section */}
      <div className="card sequence-config" style={{ marginTop: "1rem", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "14px 16px", background: "var(--bg-surface)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>🧬 CRISPR Sequences: gRNA &amp; Donor</span>
            </h3>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: "12px" }}>
              Specify gRNA spacer sequences (for cut site determination) and donor ssODN (for knock-in / point-mutation calling).
            </p>
          </div>
          {designName && (
            <div>
              {!customSequenceMode ? (
                <button
                  type="button"
                  className="link"
                  style={{ fontSize: "12px", background: "var(--bg-input)", borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 600, margin: 0 }}
                  onClick={handlePopulateFromDesign}
                >
                  ✎ Customize / Override Sequences
                </button>
              ) : (
                <button
                  type="button"
                  className="link"
                  style={{ fontSize: "12px", background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning)", fontWeight: 600, margin: 0 }}
                  onClick={() => setCustomSequenceMode(false)}
                >
                  ↺ Revert to Parsed Design File
                </button>
              )}
            </div>
          )}
        </div>

        {designName && !customSequenceMode ? (
          <div style={{ padding: "10px 14px", background: "var(--success-bg)", borderRadius: "8px", border: "1px solid var(--success-border)", fontSize: "13px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontWeight: 600, color: "var(--success)" }}>✓ Using sequences from design: {designName}</span>
              <span className="muted" style={{ fontSize: "11px" }}>Click &quot;Customize / Override&quot; to test alternate gRNAs or donors</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
              <div>
                <strong style={{ fontSize: "12px", color: "var(--text-muted)" }}>gRNA Spacers:</strong>
                {designGuides.length > 0 ? (
                  <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                    {designGuides.map((g, idx) => (
                      <li key={idx} style={{ fontFamily: "monospace", fontSize: "12px" }}>
                        <strong>Guide {idx + 1}:</strong> <code>{g}</code> ({g.length} nt)
                      </li>
                    ))}
                  </ul>
                ) : <span className="muted"> (none specified; cut site will be inferred)</span>}
              </div>
              <div>
                <strong style={{ fontSize: "12px", color: "var(--text-muted)" }}>Donor (ssODN):</strong>
                {designDonors.length > 0 && (typeof designDonors[0] === "string" ? designDonors[0] : designDonors[0]?.sequence) ? (
                  <div style={{ marginTop: "4px", fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all", background: "var(--bg-input)", color: "var(--text-main)", border: "1px solid var(--border-color)", padding: "4px 8px", borderRadius: "4px", maxHeight: "60px", overflowY: "auto" }}>
                    {typeof designDonors[0] === "string" ? designDonors[0] : designDonors[0].sequence} ({((typeof designDonors[0] === "string" ? designDonors[0] : designDonors[0].sequence) || "").length} nt)
                  </div>
                ) : <div className="muted" style={{ fontSize: "12px", marginTop: "2px" }}>No donor (knockout / deletion workflow)</div>}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {customSequenceMode && designName && (
              <div style={{ padding: "8px 12px", background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderRadius: "6px", fontSize: "12px", color: "var(--warning)" }}>
                ⚠️ <strong>Manual Override Active:</strong> The analysis will use your custom gRNA and donor sequences below instead of the design file.
              </div>
            )}

            <div className="row" style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {/* gRNA sequence input */}
              <div style={{ flex: "1 1 320px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                  <label htmlFor="q-guides-main" style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>
                    gRNA Sequence(s)
                  </label>
                  <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                    {guides.length > 0 ? `${guides.length} guide(s) entered` : "optional (inferred if blank)"}
                  </span>
                </div>
                <input
                  id="q-guides-main"
                  type="text"
                  value={guidesText}
                  onChange={(e) => setGuidesText(e.target.value.toUpperCase())}
                  placeholder="e.g. AACCAGTTGCAGGCGCCCCA (comma-separate multiple)"
                  style={{ fontFamily: "monospace", letterSpacing: "0.5px" }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px", alignItems: "center" }}>
                  {guides.map((g, gi) => {
                    const isStandardLen = g.length === 20;
                    return (
                      <span
                        key={gi}
                        style={{
                          fontSize: "11px",
                          fontFamily: "monospace",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: isStandardLen ? "#ecfdf5" : "#fffbeb",
                          color: isStandardLen ? "#047857" : "#b45309",
                          border: `1px solid ${isStandardLen ? "#a7f3d0" : "#fde68a"}`
                        }}
                      >
                        gRNA {gi + 1}: {g.length} nt {isStandardLen ? "✓" : "(standard: 20 nt)"}
                      </span>
                    );
                  })}
                  <span className="muted" style={{ fontSize: "11px" }}>
                    Enter 1–3 spacers without PAM (e.g. 20 nt).
                  </span>
                </div>
              </div>

              {/* Donor sequence input */}
              <div style={{ flex: "1 1 320px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                  <label htmlFor="q-donor-main" style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>
                    Donor Sequence (ssODN, ≤ 300 nt)
                  </label>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: cleanDna(donorText).length > 300 ? "#f87171" : "var(--text-muted)" }}>
                    {cleanDna(donorText).length} / 300 nt
                  </span>
                </div>
                <textarea
                  id="q-donor-main"
                  value={donorText}
                  onChange={(e) => setDonorText(e.target.value.toUpperCase())}
                  placeholder="Paste single-stranded donor sequence (ssODN) with intended edit and silent blocking mutations..."
                  style={{ fontFamily: "monospace", minHeight: "68px", resize: "vertical", fontSize: "12px" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "2px" }}>
                  <span className="muted" style={{ fontSize: "11px" }}>
                    Required for SNP corrections &amp; small tag knock-ins with ≥15 nt homology arms.
                  </span>
                  {(guidesText || donorText) && (
                    <button
                      type="button"
                      className="link"
                      style={{ fontSize: "11px", padding: "1px 6px", border: "none", color: "var(--text-dim)", textDecoration: "underline", background: "none", cursor: "pointer", margin: 0 }}
                      onClick={() => { setGuidesText(""); setDonorText(""); }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Presets / Examples */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingTop: "6px", borderTop: "1px dashed var(--border-color)" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)" }}>Quick sample sequences:</span>
              <button
                type="button"
                className="link"
                style={{ fontSize: "11px", padding: "2px 8px", margin: 0 }}
                onClick={() => {
                  setGuidesText("GACCGTAGCTACGTACGTAG");
                  setDonorText("TGCAGGCGCCCCACGTACCGGACCGTAGCTACGTACGTAGTTCTACCGGAACGTCCGGTACGTAGCTACGTACGTAGACCGT");
                  setCustomSequenceMode(true);
                }}
              >
                APOE R176C ssODN Example
              </button>
              <button
                type="button"
                className="link"
                style={{ fontSize: "11px", padding: "2px 8px", margin: 0 }}
                onClick={() => {
                  setGuidesText("CCTCAGTGTCTTCGAGCTGG, ACTGAGGCCGAGCTGTACCG");
                  setDonorText("");
                  setCustomSequenceMode(true);
                }}
              >
                Dual-Guide Deletion Example
              </button>
            </div>
          </div>
        )}
      </div>

      {traceNames.length > 0 && <details open>
        <summary>Loaded traces ({traceNames.length})</summary>
        <ul>{traceNames.map((name) => <li key={name}><span>{name}</span> <button type="button" disabled={running} aria-label={`Remove trace ${name}`} onClick={() => {
          files.current.delete(name); buffers.current.delete(name); setTraceNames((previous) => previous.filter((n) => n !== name)); setPairsEdit({}); setOutcome(null); setError("");
        }}>Remove</button></li>)}</ul>
      </details>}
      {traceNames.length > 0 && (
        <>
          <p>{traceNames.length} trace{traceNames.length === 1 ? "" : "s"}; {pairs.length} sample{pairs.length === 1 ? "" : "s"} paired by {built.source === "sheet" ? "the sample sheet" : "file names"}. Guides from {guideSource}.</p>
          {built.problems.map((p) => <p key={p} className="note">{p}</p>)}
          {lowCount > 0 && <p className="note">{lowCount} pairing{lowCount === 1 ? " is" : "s are"} a guess (marked low): check the control column before running.</p>}
          <div className="scroll">
            <table><thead><tr><th>Sample</th><th>Reads</th><th>Control</th><th>Type</th><th>Pairing</th></tr></thead><tbody>
              {pairs.map((p, i) => (
                <tr key={p.sample + i}><td>{p.sample}</td><td>{p.edited.length}</td>
                  <td><select value={p.control[0]} onChange={(e) => setPairsEdit({ ...pairsEdit, [i]: { control: [e.target.value], confidence: "set by you" } })}>{traceNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
                  <td><select value={p.type} onChange={(e) => setPairsEdit({ ...pairsEdit, [i]: { ...(pairsEdit[i] || {}), type: e.target.value } })}><option value="clone">clone</option><option value="pool">pool</option></select></td>
                  <td className={p.confidence === "low" ? "warn" : ""} title={p.reason}>{p.confidence}</td></tr>
              ))}
            </tbody></table>
          </div>
          <details><summary>Additional settings: Nuclease, Sample type, Protein assessment</summary>
            <label className="field" htmlFor="q-nuc">Nuclease</label>
            <select id="q-nuc" value={nuclease} onChange={(e) => setNuclease(e.target.value)}>{Object.entries(NUCLEASES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <label className="field" htmlFor="q-type">Sample type (overrides the guess for every sample)</label>
            <select id="q-type" value={typeOverride} onChange={(e) => setTypeOverride(e.target.value)}><option value="">as paired</option><option value="clone">clones</option><option value="pool">pools</option></select>
            <label className="field" htmlFor="q-goal">Accept</label>
            <select id="q-goal" value={goal} onChange={(e) => setGoal(e.target.value)}><option value="homozygous">homozygous edits only (heterozygous clones are held)</option><option value="any">heterozygous edits too</option></select>
            <label className="field" htmlFor="q-gene">Gene record (GenBank, optional): judges knockouts on the protein</label>
            <input id="q-gene" type="file" accept=".gb,.gbk,.gbff,.genbank,.txt" onChange={async (e) => { const f = e.target.files && e.target.files[0]; if (f) { setGeneText(await f.text()); setGeneName(f.name); } else { setGeneText(""); setGeneName(""); } }} />
            {geneName && <p className="muted">Using {geneName}: each allele is translated, nonsense-mediated decay and splice sites are assessed, and the knockout is called on the predicted protein.</p>}
            {geneText && (
              <>
                <label className="field" htmlFor="q-regions">Essential regions (optional, residue numbers)</label>
                <input id="q-regions" type="text" value={regionsText} onChange={(e) => setRegionsText(e.target.value)} placeholder="TIR domain:172-314, Death domain:67-122" />
                <label className="field" htmlFor="q-epitope">Antibody epitope (optional, residue numbers)</label>
                <input id="q-epitope" type="text" value={epitopeText} onChange={(e) => setEpitopeText(e.target.value)} placeholder="200-250" />
              </>
            )}
          </details>
          <p><button type="button" className="primary" disabled={running || !pairs.length || (!customSequenceMode && (!!design.error || !!(designName && !designText)))} onClick={run}>{running ? "Analysing..." : `Analyse ${pairs.length} sample${pairs.length === 1 ? "" : "s"}`}</button> {progress && <span className="muted">{progress.done} of {progress.total}</span>}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {outcome && (
        <>
          <h2>Decisions</h2>
          <p className="chips">{DECISION_ORDER.map((k) => <span key={k} className={`chip d-${k.replace("-", "")}`}>{LABEL[k]} {counts[k]}</span>)}</p>
          {summaryFigure && <div className="scroll" dangerouslySetInnerHTML={{ __html: summaryFigure }} />}
          {selectionSvg && (
            <details open className="aligned">
              <summary><b>Clone selection</b></summary>
              <p className="muted">From the design to the clones to take forward: the guides, cuts and designed changes over the chromatograms of those clones, and a table of all clones.</p>
              <p><label>Clones to carry forward first <input type="number" min="1" max="48" value={panel || panelAuto} onChange={(e) => setPanel(Math.max(0, Math.min(48, Math.round(Number(e.target.value)) || 0)))} style={{ width: "4em" }} /></label> <span className="muted">({koRun ? "a knockout takes one clone per genotype" : "clones of one genotype are replicates, so up to six"}; the ranking itself does not change)</span></p>
              <div className="scroll" dangerouslySetInnerHTML={{ __html: selectionSvg }} />
              <p>
                <button type="button" className="link" onClick={() => saveSvg(`assured_qc_clone_selection_${stamp}.svg`, selectionSvg)}>Clone selection (SVG)</button>
                <button type="button" className="link" onClick={() => savePng(`assured_qc_clone_selection_${stamp}_300dpi.png`, selectionSvg)}>Clone selection (PNG)</button>
                <button type="button" className="link" onClick={() => savePdf(`assured_qc_clone_selection_${stamp}.pdf`, selectionSvg)}>Clone selection (PDF)</button>
              </p>
            </details>
          )}
          {alignedList.map((g, gi) => (
            <details key={gi} className="aligned">
              <summary><b>All clones aligned with the wild-type control</b>{alignedList.length > 1 ? ` (design group ${gi + 1}, ${g.items.length} samples)` : ` (${g.items.length} samples)`}</summary>
              <p className="muted">Best clone first, on the same stretch of the control read. Base calls first, then the chromatograms{g.stack ? "" : " (not drawn above 48 clones)"}.</p>
              <div className="scroll" dangerouslySetInnerHTML={{ __html: g.grid }} />
              {g.stack && <div className="scroll" dangerouslySetInnerHTML={{ __html: g.stack }} />}
              <p>
                <button type="button" className="link" onClick={() => saveSvg(`assured_qc_clones_alignment_${stamp}.svg`, g.grid)}>Base-call alignment (SVG)</button>
                <button type="button" className="link" onClick={() => savePng(`assured_qc_clones_alignment_${stamp}_300dpi.png`, g.grid)}>Base-call alignment (PNG)</button>
                <button type="button" className="link" onClick={() => savePdf(`assured_qc_clones_alignment_${stamp}.pdf`, g.grid)}>Base-call alignment (PDF)</button>
                {g.stack && <button type="button" className="link" onClick={() => saveSvg(`assured_qc_clones_aligned_${stamp}.svg`, g.stack)}>Chromatograms (SVG)</button>}
                {g.stack && <button type="button" className="link" onClick={() => savePng(`assured_qc_clones_aligned_${stamp}_300dpi.png`, g.stack)}>Chromatograms (PNG)</button>}
                {g.stack && <button type="button" className="link" onClick={() => savePdf(`assured_qc_clones_aligned_${stamp}.pdf`, g.stack)}>Chromatograms (PDF)</button>}
              </p>
            </details>
          ))}
            {panelOf(ranked).length > 0 && <p>Carry forward first: <b>{panelOf(ranked).join(", ")}</b> <span className="muted">{outcome.workflow === "knockout" || outcome.workflow === "deletion" ? "(ranked by how strongly the sequence predicts loss of protein; best clone of each genotype)" : "(ranked by the lower bound of the intended-edit interval; clones of one genotype count separately)"}</span></p>}
          <p>
            <button type="button" className="link" onClick={() => download(`assured_qc_${stamp}.html`, buildQcReportHtml({ workflow: outcome.workflow, results: ranked, notes: outcome.problems }), "text/html")}>Report (HTML)</button>
            <button type="button" className="link" onClick={() => download(`assured_qc_${stamp}.csv`, buildResultsCsv(outcome.workflow, ranked), "text/csv")}>Table (CSV)</button>
            <button type="button" className="link" onClick={() => download(`assured_qc_plate_${stamp}.html`, buildPlateReportHtml({ title: "Plate", results: ranked }), "text/html")}>Plate view (HTML)</button>
            <button type="button" className="link" onClick={() => download(`assured_qc_resequence_${stamp}.csv`, resequenceListCsv(outcome.results), "text/csv")}>Re-sequence list (CSV)</button>
            <button type="button" className="link" onClick={() => download(`assured_qc_recommendation_${stamp}.csv`, recommendationCsv(ranked), "text/csv")}>Recommendation (CSV)</button>
            {summaryFigure && <button type="button" className="link" onClick={() => saveSvg(`assured_qc_summary_${stamp}.svg`, summaryFigure)}>Summary graph (SVG)</button>}
            {summaryFigure && <button type="button" className="link" onClick={() => savePng(`assured_qc_summary_${stamp}_300dpi.png`, summaryFigure)}>Summary graph (PNG)</button>}
            {summaryFigure && <button type="button" className="link" onClick={() => savePdf(`assured_qc_summary_${stamp}.pdf`, summaryFigure)}>Summary graph (PDF)</button>}
            {runFigure && <button type="button" className="link" onClick={() => download(`assured_qc_protein_products_${stamp}.svg`, runFigure, "image/svg+xml")}>Protein products (SVG)</button>}
            {runFigure && <button type="button" className="link" onClick={() => savePdf(`assured_qc_protein_products_${stamp}.pdf`, runFigure)}>Protein products (PDF)</button>}
          </p>
          <IceExport tasks={outcome.tasks} results={outcome.results} getBytes={name => {
            const bytes = buffers.current.get(name); if (!bytes) throw new Error(`Trace no longer available: ${name}`); return bytes;
          }} />
          <div className="scroll">
            <table><thead><tr><th>Decision</th><th>Sample</th><th>Result</th><th>Edited, 95% interval</th><th>Confidence</th><th>Priority</th></tr></thead><tbody>
              {outcome.results.map((r, i) => (
                <tr key={r.name + i} className={`pick${i === picked ? " active" : ""}`} onClick={() => setPicked(i)}>
                  <td><span className={`chip d-${r.decision.decision.replace("-", "")}`}>{LABEL[r.decision.decision]}</span></td><td>{r.name}</td>
                  <td>{r.ok ? headline(outcome.workflow, r) : r.error}</td><td>{r.ok ? `${r.summary.editedPct}% (${interval(r.intervals?.editedPct)})` : ""}</td><td>{r.confidence ? r.confidence.tier : ""}</td><td>{ranked[i].recommendation.rank ? `#${ranked[i].recommendation.rank} ${PRIORITY_LABEL[ranked[i].recommendation.priority] || ""}` : (PRIORITY_LABEL[ranked[i].recommendation.priority] || "")}</td></tr>
              ))}
            </tbody></table>
          </div>
          {result && <div className="card"><p><b>{LABEL[result.decision.decision]}.</b> {result.decision.reasons.join(" ")} <span className="muted">{result.decision.next}</span></p>
            {recommendation && recommendation.priority !== "none" && <p><b>{/^KO score/.test(recommendation.basis || "") ? "KO score" : /^HDR score/.test(recommendation.basis || "") ? "HDR score, lower bound" : "Knockout support"} {recommendation.score} ({recommendation.tier}).</b> {recommendation.action} <span className="muted">{recommendation.why.join(" | ")}{recommendation.flags.length ? ` Note: ${recommendation.flags.join("; ")}.` : ""} The weights behind the support are provisional; only a protein result settles a knockout.</span></p>}
            <p><button type="button" className="link" disabled={figureBusy || !result.ok} onClick={() => figure("svg")}>Figure (SVG)</button><button type="button" className="link" disabled={figureBusy || !result.ok} onClick={() => figure("png")}>Figure (PNG, 300 dpi)</button><button type="button" className="link" disabled={figureBusy || !result.ok} onClick={() => figure("pdf")}>Figure (PDF)</button></p></div>}
          {result && <Detail workflow={outcome.workflow} result={result} />}
        </>
      )}
    </div>
  );
}
