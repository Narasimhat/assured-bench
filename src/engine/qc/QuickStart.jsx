import { useEffect, useMemo, useRef, useState } from "react";
import { classifyFiles, buildPairs, readDesign, planTasks, runPool } from "./quick.js";
import { parseSampleSheet } from "./sheet.js";
import { validateDesignSpec } from "./designSpec.js";
import { parseCodingFields } from "./coding.js";
import { parseAbif } from "./abif.js";
import { headline } from "./batch.js";
import { buildQcReportHtml, buildResultsCsv, buildTakeHomeMessage } from "./report.js";
import { resequenceListCsv } from "./plateReport.js";
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
  const controlPicker = useRef(null); const filePicker = useRef(null); const folderPicker = useRef(null); const designPicker = useRef(null);
  const files = useRef(new Map()); const buffers = useRef(new Map());
  const [traceNames, setTraceNames] = useState([]); const [explicitControls, setExplicitControls] = useState([]); const [sheetText, setSheetText] = useState(""); const [designText, setDesignText] = useState(""); const [designName, setDesignName] = useState(""); const [geneText, setGeneText] = useState(""); const [geneName, setGeneName] = useState(""); const [regionsText, setRegionsText] = useState(""); const [epitopeText, setEpitopeText] = useState("");
  const [guidesText, setGuidesText] = useState(""); const [donorText, setDonorText] = useState(""); const [nuclease, setNuclease] = useState("SpCas9"); const [typeOverride, setTypeOverride] = useState(""); const [goal, setGoal] = useState("homozygous");
  const [customSequenceMode, setCustomSequenceMode] = useState(false);
  const [pairsEdit, setPairsEdit] = useState({}); const [running, setRunning] = useState(false); const [progress, setProgress] = useState(null);
  const [outcome, setOutcome] = useState(null); const [picked, setPicked] = useState(0); const [panel, setPanel] = useState(0); const [figureBusy, setFigureBusy] = useState(false); const [error, setError] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [draggingControl, setDraggingControl] = useState(false);
  const [draggingEdited, setDraggingEdited] = useState(false);
  const [traceUrl, setTraceUrl] = useState("");
  const [urlRole, setUrlRole] = useState("edited");
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [designIndex, setDesignIndex] = useState(0);

  useEffect(() => {
    if ((initialDesign?.text || "") === designText) return;
    setDesignText(initialDesign?.text || ""); setDesignName(initialDesign ? initialDesign.name || "Bench design" : ""); setDesignIndex(0);
    files.current.clear(); buffers.current.clear();
    setTraceNames([]); setExplicitControls([]); setPairsEdit({}); setOutcome(null); setError("");
  }, [initialDesign]);
  const previousOutcome = useRef(null);
  useEffect(() => {
    if (!outcome && previousOutcome.current && onResults) onResults({ results: [] });
    previousOutcome.current = outcome;
    if (outcome && onResults) onResults({ results: withRecommendations(outcome.results, panel ? { panel } : {}), designText, designName });
  }, [outcome, panel, onResults]);

  const addFiles = async (list, role = "auto") => {
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
      if (role === "control" && duplicates.length) {
        setExplicitControls((prev) => Array.from(new Set([...prev, ...duplicates])));
      }
      setImportStatus(`${kinds.traces.length} new traces; ${duplicates.length} traces already loaded; ${kinds.designs.length} design files; ${kinds.sheets.length} sample-sheet files; ${expanded.skipped.length} unsupported files skipped.`);
      if (!incoming.length) {
        if (duplicates.length) setImportStatus(`All ${duplicates.length} selected traces are already loaded.${role === "control" ? " Assigned as Parental Control." : " Your existing analysis is unchanged."}`);
        else setImportStatus(selected.length ? "No supported files found. Select .ab1 files or a sequencing .zip archive." : "The browser returned no files. Select .ab1 files inside the folder.");
        return;
      }
      incoming.forEach((f) => { files.current.set(f.name, f); buffers.current.delete(f.name); });
      setTraceNames((previous) => Array.from(new Set([...previous, ...kinds.traces])));
      if (role === "control" && kinds.traces.length) {
        setExplicitControls((previous) => Array.from(new Set([...previous, ...kinds.traces])));
      } else if (role === "auto" && kinds.traces.length) {
        const autoCtrls = kinds.traces.filter((n) => /(?:^|[\s_\-.])(wt|wild[\s_-]?type|ctrl|control|parental|unedited|untreated)(?:$|[\s_\-.])/i.test(n));
        if (autoCtrls.length) setExplicitControls((previous) => Array.from(new Set([...previous, ...autoCtrls])));
      }
      setPairsEdit({}); setOutcome(null);
      for (const sheetFile of incoming.filter((f) => kinds.sheets.includes(f.name))) {
        const txt = await sheetFile.text();
        const parsed = parseSampleSheet(txt);
        if (parsed.rows.length > 0 && parsed.errors.length === 0) {
          setSheetText(txt);
          break;
        }
      }
      const validDesigns = [];
      for (const designFile of incoming.filter((f) => kinds.designs.includes(f.name))) {
        try {
          const txt = await designFile.text();
          const d = readDesign(txt);
          if (d.kind === "spec" && validateDesignSpec(d.spec).ok) validDesigns.push({ name: designFile.name, text: txt });
          else if (d.kind === "report" && d.designs?.length > 0) validDesigns.push({ name: designFile.name, text: txt });
        } catch {
          // Ignore non-Assured JSON/HTML files in folders
        }
      }
      if (validDesigns.length > 0) {
        setDesignName(validDesigns[0].name);
        setDesignText("");
        setDesignIndex(0);
        setDesignText(validDesigns[0].text);
      }
      const gene = incoming.find((f) => kinds.genes.includes(f.name)); if (gene) { setGeneText(await gene.text()); setGeneName(gene.name); }
      if (duplicates.length && role !== "control") setError(`Already loaded: ${duplicates.join(", ")}. Kept the existing traces. For different reads with the same filename, rename them before adding; to replace a trace, remove it first.`);
      if (validDesigns.length > 1) setError("More than one design file was selected. Loaded the first; use Replace design to choose a different report.");
    } catch (e) { setImportStatus(""); setError(`Could not read the selected file. Try copying it from the network drive to a local folder and selecting it again. ${e.message || ""}`); }
  };

  const loadSampleBundle = async (bundleKey) => {
    if (running) return;
    setError("");
    setImportStatus("Loading bundled benchmark traces…");
    try {
      const base = import.meta.env?.BASE_URL || "./";
      const relPath = bundleKey === "myd88"
        ? "drive_data/myd88/myd88_clones.assured.zip"
        : "demo_traces/apoe_qc_practice.zip";
      const fileName = bundleKey === "myd88" ? "myd88_clones.assured.zip" : "apoe_qc_practice.zip";
      const response = await fetch(`${base}${relPath}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: "application/zip" });
      files.current.clear();
      buffers.current.clear();
      setTraceNames([]);
      setExplicitControls([]);
      setSheetText("");
      setPairsEdit({});
      setOutcome(null);
      await addFiles([file], "auto");
    } catch (e) {
      setImportStatus("");
      setError(`Could not load sample trace bundle: ${e.message || e}`);
    }
  };

  const loadFromUrl = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const raw = traceUrl.trim();
    if (!raw || running || loadingUrl) return;
    setError("");
    setLoadingUrl(true);
    setImportStatus("Fetching trace / archive from URL…");
    try {
      const urls = raw.split(/[\s,]+/).filter(Boolean);
      const fetchedFiles = [];
      for (const u of urls) {
        const parsedUrl = new URL(u, window.location.href);
        const response = await fetch(parsedUrl.href);
        if (!response.ok) throw new Error(`HTTP ${response.status} when fetching ${parsedUrl.pathname}`);
        const buf = await response.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
        const isAb1 = bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x42 && bytes[2] === 0x49 && bytes[3] === 0x46;
        let baseName = decodeURIComponent(parsedUrl.pathname.split("/").filter(Boolean).pop() || "remote_sample");
        if (isZip && !/\.zip$/i.test(baseName)) baseName += ".zip";
        else if (isAb1 && !/\.(ab1|abi)$/i.test(baseName)) baseName += ".ab1";
        fetchedFiles.push(new File([buf], baseName));
      }
      await addFiles(fetchedFiles, urlRole);
      setTraceUrl("");
    } catch (err) {
      setImportStatus("");
      setError(`Could not fetch URL (${err.message || err}). Ensure the link is a direct .ab1 or .zip file with CORS access enabled, or download it locally and drop it above.`);
    } finally {
      setLoadingUrl(false);
    }
  };

  const built = useMemo(() => (traceNames.length ? buildPairs({ traceNames, sheetText, explicitControls }) : { pairs: [], problems: [] }), [traceNames, sheetText, explicitControls]);
  const design = useMemo(() => { try { return { ...readDesign(designText, { designIndex }), error: "" }; } catch (e) { return { kind: "none", error: e.message }; } }, [designText, designIndex]);
  const pairs = built.pairs.map((p, i) => ({ ...p, ...(pairsEdit[i] || {}) }));
  const guides = guidesText.split(/[,;\s]+/).map(cleanDna).filter(Boolean);
  const lowCount = pairs.filter((p) => p.confidence === "low").length;

  const designGuideItems = useMemo(() => {
    if (design.kind === "report") {
      return (design.chosen?.guides || []).map((g, i) => ({
        name: g.name || `Guide ${i + 1}`,
        sequence: g.sequence || "",
      }));
    }
    if (design.kind === "spec") {
      return (design.spec?.guides || []).map((g, i) => ({
        name: g.name || `Guide ${i + 1}`,
        sequence: g.spacer || g.sequence || "",
        pam: g.pam || "",
        strand: g.strand || "",
      }));
    }
    return [];
  }, [design]);

  const designGuides = useMemo(() => designGuideItems.map((g) => g.sequence).filter(Boolean), [designGuideItems]);

  const designDonorItems = useMemo(() => {
    const raw = design.kind === "report" ? (design.donors || []) : design.kind === "spec" ? (design.spec?.donors || []) : [];
    return raw
      .map((d, i) => {
        if (typeof d === "string") return { name: `ssODN ${i + 1}`, sequence: d };
        const seq = d?.orderSequence || d?.sequence || "";
        return { name: d?.name || `ssODN ${i + 1}`, sequence: seq, genomicSequence: d?.sequence || seq };
      })
      .filter((d) => d.sequence);
  }, [design]);

  const manualDonors = useMemo(() => {
    const raw = String(donorText || "").trim();
    if (!raw) return [];
    if (/^>/m.test(raw)) {
      return raw
        .split(/^>/m)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block, i) => {
          const lines = block.split(/\r?\n/);
          const name = lines[0].trim() || `ssODN ${i + 1}`;
          const sequence = cleanDna(lines.slice(1).join(""));
          return { name, sequence };
        })
        .filter((d) => d.sequence);
    }
    return raw
      .split(/[,;\r\n]+/)
      .map((part, i) => ({ name: `ssODN ${i + 1}`, sequence: cleanDna(part.replace(/\d+/g, "")) }))
      .filter((d) => d.sequence);
  }, [donorText]);

  const handlePopulateFromDesign = () => {
    if (designGuides.length) setGuidesText(designGuides.join(", "));
    if (designDonorItems.length) {
      setDonorText(designDonorItems.map((d) => d.sequence).join("\n"));
    }
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
      const cleanDonor = manualDonors.length > 1
        ? manualDonors
        : (manualDonors[0]?.sequence || "");
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

  const autoDetectedControls = useMemo(() => {
    if (explicitControls.length > 0) return [];
    return Array.from(new Set(pairs.flatMap((p) => p.control || [])));
  }, [explicitControls, pairs]);

  return (
    <div className="card quick" style={{ padding: "18px 20px" }}>
      <input ref={designPicker} hidden style={{ display: "none" }} id="q-design" aria-label="Design report file" type="file" accept=".html,.htm,.json,text/html,application/json" disabled={running} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

      {/* 2-Column Side-by-Side Setup Workspace */}
      <div className="qc-setup-grid">
        {/* LEFT PANEL: Sanger Chromatogram Traces */}
        <div className="qc-panel">
          <div>
            <div className="qc-panel-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                  <span className="qc-step-pill">Step 1</span>
                  <h2 style={{ margin: 0, fontSize: "15.5px" }}>Upload Sanger Traces (.ab1 / .zip)</h2>
                </div>
                <div className="muted" style={{ fontSize: "12px" }}>
                  Provide your unedited parental control and edited clone chromatograms, or launch a 1-click benchmark cohort.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="link"
                  disabled={running}
                  onClick={() => loadSampleBundle("apoe")}
                  style={{ fontSize: "11px", padding: "4px 9px", margin: 0, fontWeight: 700 }}
                  title="Load 4 APOE R176C SNP knock-in traces + matched design"
                >
                  ⚡ APOE R176C Set (4)
                </button>
                <button
                  type="button"
                  className="link"
                  disabled={running}
                  onClick={() => loadSampleBundle("myd88")}
                  style={{ fontSize: "11px", padding: "4px 9px", margin: 0, fontWeight: 700 }}
                  title="Load 11 MYD88 KO hiPSC clone traces + matched design"
                >
                  ⚡ MYD88 KO Set (11)
                </button>
              </div>
            </div>

            {/* Side-by-Side Dropzones inside Panel 1 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px", marginBottom: "10px" }}>
              {/* Box 1: Parental / WT Control */}
              <div
                className={`drop${draggingControl ? " over" : ""}`}
                style={{ margin: 0, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between", borderColor: explicitControls.length ? "var(--success)" : undefined }}
                onDragOver={(e) => { e.preventDefault(); setDraggingControl(true); }}
                onDragLeave={() => setDraggingControl(false)}
                onDrop={(e) => { e.preventDefault(); setDraggingControl(false); addFiles(e.dataTransfer.files, "control"); }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-main)" }}>
                        1A. Parental Control (.ab1)
                      </div>
                      <div className="muted" style={{ fontSize: "11px", marginTop: "2px" }}>
                        Unedited WT chromatogram.
                      </div>
                    </div>
                    <input
                      ref={controlPicker}
                      hidden
                      style={{ display: "none" }}
                      type="file"
                      multiple
                      accept=".ab1,.abi"
                      disabled={running}
                      onChange={(e) => { addFiles(e.target.files, "control"); e.target.value = ""; }}
                      aria-label="Choose parental control AB1 files"
                    />
                    <button type="button" disabled={running} onClick={() => controlPicker.current.click()} style={{ whiteSpace: "nowrap", fontSize: "11.5px", padding: "5px 10px", margin: 0 }}>
                      Select Control
                    </button>
                  </div>

                  {explicitControls.length > 0 ? (
                    <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
                      {explicitControls.map((ctrl) => (
                        <span
                          key={ctrl}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            fontSize: "11px",
                            fontFamily: "monospace",
                            padding: "2px 7px",
                            borderRadius: "999px",
                            background: "var(--success-bg)",
                            color: "var(--success)",
                            border: "1px solid var(--success-border)",
                            fontWeight: 600,
                          }}
                        >
                          ✓ {ctrl}
                          <button
                            type="button"
                            disabled={running}
                            onClick={() => setExplicitControls((prev) => prev.filter((c) => c !== ctrl))}
                            style={{ border: "none", background: "transparent", color: "inherit", padding: "0 2px", cursor: "pointer", fontSize: "12px", lineHeight: 1 }}
                            title="Unassign as explicit control"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : autoDetectedControls.length > 0 ? (
                    <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
                      Auto-detected: <code>{autoDetectedControls.join(", ")}</code>
                    </div>
                  ) : (
                    <div style={{ marginTop: "8px", fontSize: "10.5px", color: "var(--text-dim)" }}>
                      Auto-detected if named <code>WT</code> / <code>Ctrl</code> in ZIP.
                    </div>
                  )}
                </div>
              </div>

              {/* Box 2: Edited Clone Samples / Sequencing ZIP / Folder */}
              <div
                className={`drop${draggingEdited ? " over" : ""}`}
                style={{ margin: 0, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}
                onDragOver={(e) => { e.preventDefault(); setDraggingEdited(true); }}
                onDragLeave={() => setDraggingEdited(false)}
                onDrop={(e) => { e.preventDefault(); setDraggingEdited(false); addFiles(e.dataTransfer.files, "edited"); }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "6px" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-main)" }}>
                        1B. Edited Clones (.ab1 / .zip)
                      </div>
                      <div className="muted" style={{ fontSize: "11px", marginTop: "2px" }}>
                        Drop clone <code>.ab1</code> files, plate <code>.zip</code>, or folder.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                      <input
                        ref={filePicker}
                        hidden
                        style={{ display: "none" }}
                        type="file"
                        multiple
                        accept=".zip,.ab1,.abi,.csv,.tsv,.json,.html,.htm,.gb,.gbk,.gbff,.genbank,text/html,application/json"
                        disabled={running}
                        onChange={(e) => { addFiles(e.target.files, "edited"); e.target.value = ""; }}
                        aria-label="Choose files"
                      />
                      <button type="button" disabled={running} onClick={() => filePicker.current.click()} style={{ fontSize: "11.5px", padding: "5px 10px", margin: 0 }}>
                        Add Clones / ZIP
                      </button>
                      <input
                        ref={folderPicker}
                        hidden
                        style={{ display: "none" }}
                        type="file"
                        multiple
                        webkitdirectory=""
                        directory=""
                        disabled={running}
                        onChange={(e) => { addFiles(e.target.files, "edited"); e.target.value = ""; }}
                        aria-label="Choose a folder"
                      />
                      <button type="button" disabled={running} onClick={() => folderPicker.current.click()} style={{ fontSize: "11.5px", padding: "5px 10px", margin: 0 }}>
                        Folder
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: "8px", fontSize: "10.5px", color: "var(--text-dim)" }}>
                    Also accepts design (<code>.html</code>/<code>.json</code>) &amp; sample sheets (<code>.csv</code>).
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Compact Remote URL Loader at bottom of Left Panel */}
          <div style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "#f8fbfe" }}>
            <form onSubmit={loadFromUrl} style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <label htmlFor="q-trace-url" style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--text-main)", whiteSpace: "nowrap" }}>
                🔗 Remote URL:
              </label>
              <input
                id="q-trace-url"
                type="text"
                value={traceUrl}
                disabled={running || loadingUrl}
                onChange={(e) => setTraceUrl(e.target.value)}
                placeholder="Paste sequencing .zip or .ab1 link (LIMS / Core facility)…"
                style={{ flex: "1 1 180px", fontSize: "11.5px", padding: "4px 8px", margin: 0 }}
              />
              <select
                aria-label="Role for fetched URL"
                value={urlRole}
                disabled={running || loadingUrl}
                onChange={(e) => setUrlRole(e.target.value)}
                style={{ fontSize: "11.5px", padding: "4px 6px", width: "auto", margin: 0 }}
              >
                <option value="edited">Clones / ZIP</option>
                <option value="control">Control (.ab1)</option>
              </select>
              <button
                type="submit"
                className="link"
                disabled={running || loadingUrl || !traceUrl.trim()}
                style={{ fontSize: "11.5px", padding: "4px 10px", margin: 0, whiteSpace: "nowrap" }}
              >
                {loadingUrl ? "Fetching…" : "Fetch"}
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT PANEL: Target Design & CRISPR Sequences (gRNA & ssODN) */}
        <div className="qc-panel sequence-config">
          <div>
            <div className="qc-panel-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                  <span className="qc-step-pill">Step 2</span>
                  <h2 style={{ margin: 0, fontSize: "15.5px" }}>Target Design: gRNA &amp; Donor Sequences</h2>
                </div>
                <div className="muted" style={{ fontSize: "12px" }}>
                  Upload an ASSURED Design file or enter gRNA spacers &amp; ssODN templates directly.
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                {!designName ? (
                  <button
                    type="button"
                    className="link"
                    disabled={running}
                    onClick={() => designPicker.current.click()}
                    style={{ fontSize: "11.5px", padding: "4px 10px", margin: 0, fontWeight: 700 }}
                  >
                    📄 Upload Design (.html / .json)
                  </button>
                ) : (
                  <>
                    {!customSequenceMode ? (
                      <button
                        type="button"
                        className="link"
                        style={{ fontSize: "11.5px", padding: "4px 9px", background: "var(--bg-input)", borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 700, margin: 0 }}
                        onClick={handlePopulateFromDesign}
                      >
                        ✎ Override Sequences
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link"
                        style={{ fontSize: "11.5px", padding: "4px 9px", background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning)", fontWeight: 700, margin: 0 }}
                        onClick={() => setCustomSequenceMode(false)}
                      >
                        ↺ Revert to Design
                      </button>
                    )}
                    <button type="button" className="link" style={{ fontSize: "11.5px", padding: "4px 8px", margin: 0 }} disabled={running} onClick={() => designPicker.current.click()}>Replace</button>
                    <button type="button" className="link" style={{ fontSize: "11.5px", padding: "4px 8px", margin: 0 }} disabled={running} onClick={() => { setDesignName(""); setDesignText(""); setDesignIndex(0); setOutcome(null); setError(""); }}>Remove</button>
                  </>
                )}
              </div>
            </div>

            {designName && (
              <div role="status" style={{ marginBottom: "8px" }}>
                {design.error ? (
                  <p className="error" style={{ margin: "4px 0", fontSize: "12px" }}>
                    <b>Design needs attention ({designName}):</b> {design.error} Replace or remove this file to continue.
                  </p>
                ) : design.kind === "report" && design.designs.length > 1 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <label htmlFor="q-design-choice" style={{ fontSize: "12px", fontWeight: 600 }}>Design in report:</label>
                    <select id="q-design-choice" disabled={running} value={designIndex} onChange={(e) => { setDesignIndex(Number(e.target.value)); setOutcome(null); }} style={{ width: "auto", fontSize: "12px", padding: "4px 8px" }}>
                      {design.designs.map((d, i) => <option key={i} value={i}>{d.title}</option>)}
                    </select>
                  </div>
                ) : null}
              </div>
            )}

            {designName && !customSequenceMode && !design.error ? (
              <div style={{ padding: "10px 12px", background: "var(--success-bg)", borderRadius: "8px", border: "1px solid var(--success-border)", fontSize: "12.5px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
                  <span style={{ fontWeight: 700, color: "var(--success)" }}>
                    ✓ Active Design: {designName} ({designGuideItems.length} gRNA{designGuideItems.length === 1 ? "" : "s"}, {designDonorItems.length} ssODN{designDonorItems.length === 1 ? "" : "s"})
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                  <div>
                    <strong style={{ fontSize: "11.5px", color: "var(--text-muted)" }}>
                      gRNA Spacers ({designGuideItems.length}):
                    </strong>
                    {designGuideItems.length > 0 ? (
                      <ul style={{ margin: "4px 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                        {designGuideItems.map((g, idx) => (
                          <li key={idx} style={{ fontFamily: "monospace", fontSize: "11.5px" }}>
                            <strong>{g.name || `Guide ${idx + 1}`}:</strong> <code>{g.sequence}</code> ({g.sequence.length} nt{g.pam ? `, ${g.pam}` : ""})
                          </li>
                        ))}
                      </ul>
                    ) : <span className="muted"> (inferred automatically)</span>}
                  </div>
                  <div>
                    <strong style={{ fontSize: "11.5px", color: "var(--text-muted)" }}>
                      Donor Templates ({designDonorItems.length} ssODN{designDonorItems.length === 1 ? "" : "s"}):
                    </strong>
                    {designDonorItems.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "4px" }}>
                        {designDonorItems.map((d, idx) => (
                          <div key={idx} style={{ background: "var(--bg-input)", color: "var(--text-main)", border: "1px solid var(--border-color)", padding: "4px 7px", borderRadius: "4px" }}>
                            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                              <span>{d.name || `ssODN ${idx + 1}`}</span>
                              <span>{d.sequence.length} nt</span>
                            </div>
                            <div style={{ fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all", maxHeight: "42px", overflowY: "auto" }}>
                              {d.sequence}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="muted" style={{ fontSize: "11.5px", marginTop: "4px" }}>No donor (knockout / deletion workflow)</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {customSequenceMode && designName && (
                  <div style={{ padding: "6px 10px", background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderRadius: "6px", fontSize: "11.5px", color: "var(--warning)" }}>
                    ⚠️ <strong>Manual Override Active:</strong> Using custom gRNA and donor sequences below instead of {designName}.
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
                  {/* gRNA sequence input */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "3px" }}>
                      <label htmlFor="q-guides-main" style={{ fontWeight: 700, fontSize: "12px", color: "var(--text-main)" }}>
                        gRNA Spacer(s) (1–3 guides)
                      </label>
                      <span style={{ fontSize: "10.5px", color: "var(--text-dim)" }}>
                        {guides.length > 0 ? `${guides.length} guide(s)` : "inferred if blank"}
                      </span>
                    </div>
                    <input
                      id="q-guides-main"
                      type="text"
                      value={guidesText}
                      onChange={(e) => setGuidesText(e.target.value.toUpperCase())}
                      placeholder="e.g. ACACTGCCAGGCGCTTCTGC, CCCCGGCCTGGTACACTGCC"
                      style={{ fontFamily: "monospace", fontSize: "12px", padding: "6px 9px" }}
                    />
                    {guides.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                        {guides.map((g, gi) => {
                          const isStandardLen = g.length === 20;
                          return (
                            <span
                              key={gi}
                              style={{
                                fontSize: "10.5px",
                                fontFamily: "monospace",
                                padding: "1px 5px",
                                borderRadius: "4px",
                                background: isStandardLen ? "#ecfdf5" : "#fffbeb",
                                color: isStandardLen ? "#047857" : "#b45309",
                                border: `1px solid ${isStandardLen ? "#a7f3d0" : "#fde68a"}`
                              }}
                            >
                              gRNA {gi + 1}: {g.length} nt {isStandardLen ? "✓" : ""}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Donor sequence input */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "3px" }}>
                      <label htmlFor="q-donor-main" style={{ fontWeight: 700, fontSize: "12px", color: "var(--text-main)" }}>
                        Donor ssODN(s) (1 per line)
                      </label>
                      <span style={{ fontSize: "10.5px", fontWeight: 600, color: "var(--text-muted)" }}>
                        {manualDonors.length > 0 ? `${manualDonors.length} ssODN (${manualDonors.map((d) => `${d.sequence.length}nt`).join(", ")})` : "optional (HDR)"}
                      </span>
                    </div>
                    <textarea
                      id="q-donor-main"
                      value={donorText}
                      onChange={(e) => setDonorText(e.target.value.toUpperCase())}
                      placeholder="Paste 1 or more ssODN donor sequences (one per line)…"
                      style={{ fontFamily: "monospace", minHeight: "54px", resize: "vertical", fontSize: "11.5px", padding: "6px 9px" }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Sequence Presets at bottom of Right Panel */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", flexWrap: "wrap", paddingTop: "8px", marginTop: "8px", borderTop: "1px dashed var(--border-color)", fontSize: "11px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: "var(--text-muted)" }}>Sample sequences:</span>
              <button
                type="button"
                className="link"
                style={{ fontSize: "11px", padding: "2px 7px", margin: 0 }}
                onClick={() => {
                  setGuidesText("ACACTGCCAGGCGCTTCTGC, CCCCGGCCTGGTACACTGCC");
                  setDonorText([
                    "TCGGCCAGAGCACCGAGGAGCTGCGGGTGCGCCTCGCCTCCCACCTGCGCAAGCTGCGTAAGCGGCTCCTCCGCGATGCCGATGACCTCCAAAAGTGCCTGGCTGTCTACCAGGCCGGGGCCCGCGA",
                    "CCGAGGAGCTGCGGGTGCGCCTCGCCTCCCACCTGCGCAAGCTGCGTAAGCGGCTCCTCCGCGATGCCGATGACCTCCAAAAGTGCCTGGCTGTCTACCAGGCCGGGGCCCGCGAGGGCGCCGAGCG"
                  ].join("\n"));
                  setCustomSequenceMode(true);
                }}
              >
                APOE R176C (2 gRNA + 2 ssODN)
              </button>
              <button
                type="button"
                className="link"
                style={{ fontSize: "11px", padding: "2px 7px", margin: 0 }}
                onClick={() => {
                  setGuidesText("CCTCAGTGTCTTCGAGCTGG, ACTGAGGCCGAGCTGTACCG");
                  setDonorText("");
                  setCustomSequenceMode(true);
                }}
              >
                Dual-Guide KO
              </button>
            </div>
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

      {importStatus && <p role="status" className="note" style={{ margin: "8px 0" }}>{importStatus}</p>}

      {/* Prominent Action & Sample Pairing Section */}
      {traceNames.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <div className="qc-action-bar">
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-main)" }}>
                Ready to Screen: {pairs.length} sample{pairs.length === 1 ? "" : "s"} ({traceNames.length} trace{traceNames.length === 1 ? "" : "s"})
              </div>
              <div className="muted" style={{ fontSize: "12px" }}>
                Paired by {built.source === "explicit" ? "uploaded Parental Control" : built.source === "sheet" ? "sample sheet" : "file names"} · Guides from {guideSource}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <label htmlFor="q-nuc" style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Nuclease:</label>
                <select id="q-nuc" value={nuclease} onChange={(e) => setNuclease(e.target.value)} style={{ width: "auto", fontSize: "12px", padding: "5px 8px" }}>
                  {Object.entries(NUCLEASES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <label htmlFor="q-goal" style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Accept:</label>
                <select id="q-goal" value={goal} onChange={(e) => setGoal(e.target.value)} style={{ width: "auto", fontSize: "12px", padding: "5px 8px" }}>
                  <option value="homozygous">Homozygous edits only</option>
                  <option value="any">Heterozygous edits too</option>
                </select>
              </div>

              <button
                type="button"
                className="primary"
                disabled={running || !pairs.length || (!customSequenceMode && (!!design.error || !!(designName && !designText)))}
                onClick={run}
                style={{ fontSize: "13.5px", padding: "8px 18px", boxShadow: "0 2px 6px rgba(0, 85, 170, 0.25)" }}
              >
                {running ? "Analysing…" : `Analyse ${pairs.length} sample${pairs.length === 1 ? "" : "s"}`}
              </button>
              {progress && <span className="muted" style={{ fontSize: "12px", fontWeight: 600 }}>{progress.done} of {progress.total}</span>}
            </div>
          </div>

          {built.problems.map((p) => <p key={p} className="note">{p}</p>)}
          {lowCount > 0 && <p className="note">{lowCount} pairing{lowCount === 1 ? " is" : "s are"} a guess (marked low): check the control column before running.</p>}

          <details open={!outcome} style={{ marginTop: "6px" }}>
            <summary style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
              Sample &amp; Control Pairing Table ({pairs.length} sample{pairs.length === 1 ? "" : "s"}) — {outcome ? "click to expand / adjust pairings" : "verify control assignment before running"}
            </summary>
            <div className="scroll" style={{ maxHeight: "240px", marginTop: "6px" }}>
              <table><thead><tr><th>Sample</th><th>Reads</th><th>Control</th><th>Type</th><th>Pairing</th></tr></thead><tbody>
                {pairs.map((p, i) => (
                  <tr key={p.sample + i}><td><b>{p.sample}</b></td><td>{p.edited.length}</td>
                    <td><select value={p.control[0]} onChange={(e) => setPairsEdit({ ...pairsEdit, [i]: { control: [e.target.value], confidence: "set by you" } })} style={{ padding: "4px 8px", fontSize: "12px" }}>{traceNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
                    <td><select value={p.type} onChange={(e) => setPairsEdit({ ...pairsEdit, [i]: { ...(pairsEdit[i] || {}), type: e.target.value } })} style={{ padding: "4px 8px", fontSize: "12px" }}><option value="clone">clone</option><option value="pool">pool</option></select></td>
                    <td className={p.confidence === "low" ? "warn" : ""} title={p.reason}>{p.confidence}</td></tr>
                ))}
              </tbody></table>
            </div>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center", marginTop: "6px" }}>
              <details>
                <summary style={{ fontSize: "12px", color: "var(--text-muted)" }}>Manage loaded trace files ({traceNames.length})</summary>
                <ul style={{ marginTop: "6px" }}>{traceNames.map((name) => {
                  const isExplicitCtrl = explicitControls.includes(name);
                  return (
                    <li key={name} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", fontSize: "12px" }}>
                      <span>{name}</span>
                      {isExplicitCtrl && <span style={{ fontSize: "11px", color: "var(--success)", fontWeight: 600 }}>(Parental Control)</span>}
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => {
                          setExplicitControls((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
                          setPairsEdit({});
                          setOutcome(null);
                        }}
                        style={{ fontSize: "11px", padding: "2px 6px" }}
                      >
                        {isExplicitCtrl ? "Unset Control" : "Set as Control"}
                      </button>
                      <button type="button" disabled={running} aria-label={`Remove trace ${name}`} onClick={() => {
                        files.current.delete(name); buffers.current.delete(name); setTraceNames((previous) => previous.filter((n) => n !== name)); setExplicitControls((previous) => previous.filter((n) => n !== name)); setPairsEdit({}); setOutcome(null); setError("");
                      }} style={{ fontSize: "11px", padding: "2px 6px" }}>Remove</button>
                    </li>
                  );
                })}</ul>
              </details>

              <details>
                <summary style={{ fontSize: "12px", color: "var(--text-muted)" }}>Advanced: Sample type override &amp; GenBank protein assessment</summary>
                <div style={{ padding: "8px 0" }}>
                  <label className="field" htmlFor="q-type">Sample type (overrides the guess for every sample)</label>
                  <select id="q-type" value={typeOverride} onChange={(e) => setTypeOverride(e.target.value)}><option value="">as paired</option><option value="clone">clones</option><option value="pool">pools</option></select>
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
                </div>
              </details>
            </div>
          </details>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {outcome && (() => {
        const takeHome = buildTakeHomeMessage(outcome.workflow, ranked);
        const boxBorder = takeHome.status === "pass" ? "var(--success)" : takeHome.status === "warn" ? "var(--warning)" : "#ef4444";
        const boxBg = takeHome.status === "pass" ? "var(--success-bg)" : takeHome.status === "warn" ? "var(--warning-bg)" : "#fef2f2";
        const boxColor = takeHome.status === "pass" ? "var(--success)" : takeHome.status === "warn" ? "var(--warning)" : "#991b1b";
        return (
          <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "2px solid var(--border-color)" }}>
            <div style={{ border: `1px solid ${boxBorder}`, borderLeft: `6px solid ${boxBorder}`, background: boxBg, borderRadius: "10px", padding: "12px 16px", marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <div style={{ flex: "1 1 360px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", color: boxColor, marginBottom: "2px" }}>
                    Final Take-Home Conclusion
                  </div>
                  <div style={{ fontSize: "15.5px", fontWeight: 800, color: "var(--text-main)", marginBottom: "3px" }}>
                    {takeHome.headline}
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-main)", marginBottom: "2px" }}>
                    {takeHome.summary} <span className="muted" style={{ fontWeight: 600 }}>— {takeHome.nextStep}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => download(`assured_qc_publication_report_${stamp}.html`, buildQcReportHtml({ workflow: outcome.workflow, design: designName, results: ranked, notes: outcome.problems }), "text/html")}
                    style={{ fontSize: "12px", padding: "7px 14px", margin: 0 }}
                  >
                    Download Publication Report (HTML)
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => download(`assured_qc_${stamp}.csv`, buildResultsCsv(outcome.workflow, ranked), "text/csv")}
                    style={{ fontSize: "12px", padding: "7px 12px", margin: 0, background: "#ffffff" }}
                  >
                    Download Table (CSV)
                  </button>
                </div>
              </div>
            </div>

            {/* Side-by-Side Master-Detail Results Split */}
            <div className="qc-results-split">
              {/* LEFT: Clone Screening Table (Master) */}
              <div className="qc-master-pane">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                  <h3 style={{ margin: 0, fontSize: "14.5px" }}>
                    Clone Screening Table ({outcome.results.length})
                  </h3>
                  <div className="chips" style={{ margin: 0 }}>
                    {DECISION_ORDER.map((k) => (
                      <span key={k} className={`chip d-${k.replace("-", "")}`} style={{ marginBottom: "2px" }}>
                        {LABEL[k]} {counts[k]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="muted" style={{ fontSize: "11.5px", marginBottom: "6px" }}>
                  Click any clone row below to inspect its chromatogram and allele breakdown on the right →
                </div>
                <div className="scroll" style={{ maxHeight: "620px", margin: 0 }}>
                  <table style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Priority</th>
                        <th>Decision</th>
                        <th>Sample</th>
                        <th>Result</th>
                        <th>Edited (95% CI)</th>
                        <th>Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outcome.results.map((r, i) => (
                        <tr key={r.name + i} className={`pick${i === picked ? " active" : ""}`} onClick={() => setPicked(i)} style={{ cursor: "pointer" }}>
                          <td>{ranked[i].recommendation.rank ? <b>#{ranked[i].recommendation.rank} {PRIORITY_LABEL[ranked[i].recommendation.priority] || ""}</b> : (PRIORITY_LABEL[ranked[i].recommendation.priority] || "—")}</td>
                          <td><span className={`chip d-${r.decision.decision.replace("-", "")}`}>{LABEL[r.decision.decision]}</span></td>
                          <td><b>{r.name}</b></td>
                          <td>{r.ok ? headline(outcome.workflow, r) : r.error}</td>
                          <td>{r.ok ? `${r.summary.editedPct}% (${interval(r.intervals?.editedPct)})` : ""}</td>
                          <td>{r.confidence ? r.confidence.tier : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* RIGHT: Selected Clone Inspector (Detail) */}
              <div className="qc-detail-pane">
                {result && (
                  <Detail
                    workflow={outcome.workflow}
                    result={result}
                    headerExtra={
                      <div>
                        <p style={{ margin: "4px 0" }}><b>{LABEL[result.decision.decision]}.</b> {result.decision.reasons.join(" ")} <span className="muted">{result.decision.next}</span></p>
                        {recommendation && recommendation.priority !== "none" && (
                          <p style={{ margin: "4px 0" }}>
                            <b>{/^KO score/.test(recommendation.basis || "") ? "KO score" : /^HDR score/.test(recommendation.basis || "") ? "HDR score, lower bound" : "Knockout support"} {recommendation.score} ({recommendation.tier}).</b>{" "}
                            {recommendation.action}{" "}
                            <span className="muted">
                              {recommendation.why.join(" | ")}{recommendation.flags.length ? ` Note: ${recommendation.flags.join("; ")}.` : ""}
                            </span>
                          </p>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                          <button type="button" className="link" style={{ margin: 0 }} disabled={figureBusy || !result.ok} onClick={() => figure("svg")}>Clone figure (SVG)</button>
                          <button type="button" className="link" style={{ margin: 0 }} disabled={figureBusy || !result.ok} onClick={() => figure("png")}>Clone figure (PNG, 300 dpi)</button>
                          <button type="button" className="link" style={{ margin: 0 }} disabled={figureBusy || !result.ok} onClick={() => figure("pdf")}>Clone figure (PDF)</button>
                        </div>
                      </div>
                    }
                  />
                )}
              </div>
            </div>
            <details className="aligned" style={{ marginTop: "12px" }}>
              <summary><b>Multi-Clone Publication Figures &amp; Cohort Alignments (SVG / PNG / PDF)</b></summary>
              {selectionSvg && (
                <div style={{ marginTop: "10px" }}>
                  <p className="muted">Top prioritized clones aligned with the wild-type control and cohort summary figure.</p>
                  <p><label>Clones to carry forward first <input type="number" min="1" max="48" value={panel || panelAuto} onChange={(e) => setPanel(Math.max(0, Math.min(48, Math.round(Number(e.target.value)) || 0)))} style={{ width: "4em" }} /></label> <span className="muted">({koRun ? "a knockout takes one clone per genotype" : "clones of one genotype are replicates, so up to six"}; the ranking itself does not change)</span></p>
                  <div className="scroll" dangerouslySetInnerHTML={{ __html: selectionSvg }} />
                  <p>
                    <button type="button" className="link" onClick={() => saveSvg(`assured_qc_clone_selection_${stamp}.svg`, selectionSvg)}>Clone selection (SVG)</button>
                    <button type="button" className="link" onClick={() => savePng(`assured_qc_clone_selection_${stamp}_300dpi.png`, selectionSvg)}>Clone selection (PNG)</button>
                    <button type="button" className="link" onClick={() => savePdf(`assured_qc_clone_selection_${stamp}.pdf`, selectionSvg)}>Clone selection (PDF)</button>
                  </p>
                </div>
              )}
              {alignedList.map((g, gi) => (
                <div key={gi} style={{ marginTop: "12px" }}>
                  <p><b>All clones aligned with the wild-type control</b>{alignedList.length > 1 ? ` (design group ${gi + 1}, ${g.items.length} samples)` : ` (${g.items.length} samples)`}</p>
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
                </div>
              ))}
              <p style={{ marginTop: "8px" }}>
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
            </details>
          </div>
        );
      })()}
    </div>
  );
}
