import React, { useMemo, useState } from "react";
import { Download, Award } from "lucide-react";
import { cloneSelectionFigure } from "../../engine/qc/selectionFigure.js";
import { saveSvg, savePng, savePdf } from "../../engine/qc/saveFigure.js";

export function DecisionView({ currentProject }) {
  const qcResults = currentProject?.qcResults || [];

  const selectionSvg = useMemo(() => cloneSelectionFigure(qcResults), [qcResults]);
  const [figureBusy, setFigureBusy] = useState(false);
  const [figureError, setFigureError] = useState("");
  const downloadFigure = async (format) => {
    if (!selectionSvg || figureBusy) return;
    setFigureBusy(true);
    setFigureError("");
    const name = `${(currentProject?.gene || "clones").replace(/[^a-z0-9_-]/gi, "_")}_clone_selection`;
    try {
      if (format === "svg") saveSvg(`${name}.svg`, selectionSvg);
      else if (format === "png") await savePng(`${name}_300dpi.png`, selectionSvg, 300);
      else await savePdf(`${name}.pdf`, selectionSvg);
    } catch (error) {
      setFigureError(`Could not export the figure: ${error.message || error}`);
    } finally {
      setFigureBusy(false);
    }
  };

  const handleDownloadCsv = () => {
    if (qcResults.length === 0) return;
    const headers = ["Sample", "Decision", "HDR_Fraction", "BlockingOnly_Fraction", "Indel_Fraction", "WT_Fraction", "Rank", "Reasons"];
    const rows = qcResults.map(r => {
      const s = r.summary || {};
      const dec = r.decision?.decision || r.decision?.verdict || "unknown";
      const hdr = s.intendedEditPct ?? (r.intendedEditFraction !== undefined ? Math.round(r.intendedEditFraction * 100) : "");
      const block = s.partialConversionPct ?? (r.blockingOnlyFraction !== undefined ? Math.round(r.blockingOnlyFraction * 100) : "");
      const indel = s.betweenCutsPct ?? s.indelPct ?? s.koScorePct ?? "";
      const wt = s.wtPct ?? (r.wildTypeFraction !== undefined ? Math.round(r.wildTypeFraction * 100) : "");
      const rank = r.recommendation?.rank || r.rank || "";
      const reasons = (r.decision?.reasons || []).join("; ");
      return [r.name, dec, hdr, block, indel, wt, rank, reasons];
    });

    const csv = [headers.join(","), ...rows.map(row => row.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(currentProject?.gene || "clones")}_screening_decisions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (qcResults.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
        <Award size={40} style={{ color: "var(--text-dim)", margin: "0 auto 1rem" }} />
        <h3>No Screening Decisions Available</h3>
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Please run Trace Analysis in Step 3 to evaluate and prioritize edited clones.
        </p>
      </div>
    );
  }

  const accepted = qcResults.filter(r => (r.decision?.decision || r.decision?.verdict) === "accept");
  const topPanel = qcResults.filter(r => r.recommendation?.rank || r.rank);

  return (
    <div>
      {/* Top Banner */}
      <div className="card" style={{ borderColor: "var(--success)" }}>
        <div className="card-title">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Award size={22} style={{ color: "var(--success)" }} />
            <span>4. Reports</span>
          </div>

          <button className="btn btn-primary" onClick={handleDownloadCsv}>
            <Download size={16} />
            <span>Download Screening CSV</span>
          </button>
        </div>

        <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
          The decision engine prioritized <strong>{topPanel.length}</strong> top clone{topPanel.length === 1 ? "" : "s"} for banking down and phenotyping assays ({accepted.length} accepted sequence candidates).
        </p>
      </div>

      <section className="card" aria-labelledby="clone-figure-heading">
        <h3 id="clone-figure-heading">Clone-selection figure</h3>
        {selectionSvg ? <>
          <p style={{ color: "var(--text-muted)", margin: "0.75rem 0" }}>
            Recommended clones aligned with the wild-type control, with design annotations where available and a summary of clone calls and support. Download an editable SVG, vector PDF, or 300-dpi PNG.
          </p>
          <div className="project-controls" style={{ marginBottom: "1rem" }}>
            <button type="button" className="btn btn-secondary" disabled={figureBusy} onClick={() => downloadFigure("svg")}>Download SVG</button>
            <button type="button" className="btn btn-secondary" disabled={figureBusy} onClick={() => downloadFigure("pdf")}>Download PDF</button>
            <button type="button" className="btn btn-secondary" disabled={figureBusy} onClick={() => downloadFigure("png")}>Download PNG (300 dpi)</button>
          </div>
          {figureError && <p role="alert">{figureError}</p>}
          <div role="img" aria-label="Clone-selection figure showing recommended clones and analysis support" style={{ overflowX: "auto", background: "#fff", borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: selectionSvg }} />
        </> : <p style={{ color: "var(--text-muted)", marginTop: "0.75rem" }}>No clone-selection figure is available for these results. Review the individual trace or junction figures in Trace Analysis.</p>}
      </section>

      {/* Recommended Panel */}
      <div className="card">
        <div className="card-title">
          <span>Select clones</span>
          <span style={{ fontSize: "0.85rem", color: "var(--success)" }}>Verified Sequence Candidates</span>
        </div>

        <div className="grid-3">
          {topPanel.map((clone, idx) => {
            const rank = clone.recommendation?.rank || clone.rank;
            const s = clone.summary || {};
            const isKnock = clone.workflow === "knockout" || clone.workflow === "deletion";
            const hdr = s.intendedEditPct ?? (clone.intendedEditFraction !== undefined ? Math.round(clone.intendedEditFraction * 100) : 0);
            const block = s.partialConversionPct ?? (clone.blockingOnlyFraction !== undefined ? Math.round(clone.blockingOnlyFraction * 100) : 0);
            const wt = s.wtPct ?? (clone.wildTypeFraction !== undefined ? Math.round(clone.wildTypeFraction * 100) : 0);
            const ko = s.koScorePct ?? s.betweenCutsPct ?? 100;

            return (
              <div
                key={idx}
                style={{
                  background: "var(--bg-app)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  padding: "1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "1.1rem", fontWeight: 700 }}>{clone.name}</span>
                  <span className="badge badge-ready">Rank #{rank}</span>
                </div>

                {clone.genotype?.summary && (
                  <div style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
                    {clone.genotype.summary}
                  </div>
                )}

                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {isKnock ? (
                    <>
                      <div>Knockout Excision: <strong style={{ color: "var(--success)" }}>{ko}%</strong></div>
                      <div>Wild-Type Residual: <strong>{wt}%</strong></div>
                    </>
                  ) : (
                    <>
                      <div>Intended Edit (HDR): <strong style={{ color: "var(--success)" }}>{hdr}%</strong></div>
                      <div>Blocking-Only Conversion: <strong>{block}%</strong></div>
                      <div>Wild-Type Residual: <strong>{wt}%</strong></div>
                    </>
                  )}
                </div>

                {clone.recommendation?.action && (
                  <div style={{ marginTop: "0.5rem", borderTop: "1px solid var(--border-color)", paddingTop: "0.5rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    ✓ {clone.recommendation.action}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 96-well Plate Heatmap Simulation */}
      <div className="card">
        <div className="card-title">
          <span>Plate Overview (96-Well Format)</span>
          <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--success)" }} /> Accept
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--warning)" }} /> Hold
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#94a3b8" }} /> Reject
            </span>
          </div>
        </div>

        <div className="plate-grid">
          {Array.from({ length: 96 }).map((_, i) => {
            const rowLetter = String.fromCharCode(65 + Math.floor(i / 12));
            const colNum = (i % 12) + 1;
            const wellId = `${rowLetter}${colNum < 10 ? "0" + colNum : colNum}`;
            const clone = qcResults[i];

            let wellClass = "well-empty";
            if (clone) {
              const d = (clone.decision?.decision || clone.decision?.verdict || "").toLowerCase();
              if (d === "accept") wellClass = "well-accept";
              else if (d === "hold" || d === "re-sequence") wellClass = "well-hold";
              else wellClass = "well-reject";
            }

            return (
              <div
                key={i}
                className={`well ${wellClass}`}
                title={clone ? `${wellId}: ${clone.name} (${clone.decision?.decision || clone.decision?.verdict})` : wellId}
              >
                {wellId}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
