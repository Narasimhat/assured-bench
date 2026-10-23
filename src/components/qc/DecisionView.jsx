import React, { useMemo, useState } from "react";
import { Download, Award, Search, CheckCircle, AlertTriangle, XCircle, RefreshCw, FileText } from "lucide-react";
import { cloneSelectionFigure } from "../../engine/qc/selectionFigure.js";
import { buildQcReportHtml, buildTakeHomeMessage } from "../../engine/qc/report.js";
import { saveSvg, savePng, savePdf } from "../../engine/qc/saveFigure.js";

export function DecisionView({ currentProject, onBackToQc }) {
  const qcResults = currentProject?.qcResults || [];
  const [selectedClone, setSelectedClone] = useState(null);
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const selectionSvg = useMemo(() => cloneSelectionFigure(qcResults), [qcResults]);
  const workflow = useMemo(() => {
    const first = qcResults[0]?.workflow;
    if (first) return first;
    const editType = currentProject?.editType || currentProject?.designResult?.type;
    return editType === "ko" ? "knockout" : (editType === "pm" || editType === "genomic-snv") ? "snp" : "tag_small";
  }, [qcResults, currentProject]);
  const takeHome = useMemo(() => buildTakeHomeMessage(workflow, qcResults), [workflow, qcResults]);
  const [figureBusy, setFigureBusy] = useState(false);
  const [figureError, setFigureError] = useState("");

  const handleDownloadHtmlReport = () => {
    if (qcResults.length === 0) return;
    const html = buildQcReportHtml({
      title: `${currentProject?.gene || "CRISPR"} — Publication Clone Screening Report`,
      workflow,
      design: currentProject?.qcDesignSource || currentProject?.gene || "",
      results: qcResults,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(currentProject?.gene || "clones").replace(/[^a-z0-9_-]/gi, "_")}_publication_report.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

    const csv = [headers.join(","), ...rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
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
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", marginBottom: "1.25rem" }}>
          Please run Trace Analysis in Step 3 to evaluate and prioritize edited clones.
        </p>
        {onBackToQc && (
          <button type="button" className="btn btn-primary" onClick={onBackToQc}>
            Open Step 3: Trace Analysis
          </button>
        )}
      </div>
    );
  }

  const accepted = qcResults.filter(r => (r.decision?.decision || r.decision?.verdict) === "accept");
  const held = qcResults.filter(r => (r.decision?.decision || r.decision?.verdict) === "hold");
  const reseq = qcResults.filter(r => (r.decision?.decision || r.decision?.verdict) === "re-sequence");
  const rejected = qcResults.filter(r => (r.decision?.decision || r.decision?.verdict) === "reject");
  const topPanel = qcResults.filter(r => r.recommendation?.rank || r.rank);

  const filteredResults = qcResults.filter(r => {
    const dec = (r.decision?.decision || r.decision?.verdict || "").toLowerCase();
    if (verdictFilter !== "all" && dec !== verdictFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (r.name || "").toLowerCase().includes(q) ||
        (r.genotype?.summary || "").toLowerCase().includes(q) ||
        (r.decision?.reasons || []).join(" ").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeClone = selectedClone || topPanel[0] || qcResults[0] || null;

  const renderVerdictBadge = (decRaw) => {
    const dec = (decRaw || "unknown").toLowerCase();
    if (dec === "accept") return <span className="badge badge-ready"><CheckCircle size={13} /> Accept</span>;
    if (dec === "hold") return <span className="badge badge-review"><AlertTriangle size={13} /> Hold</span>;
    if (dec === "re-sequence") return <span className="badge badge-review"><RefreshCw size={13} /> Sequence again</span>;
    return <span className="badge badge-blocked"><XCircle size={13} /> Reject</span>;
  };

  return (
    <div>
      {/* Top Banner */}
      <div className="card" style={{ borderColor: "var(--success)" }}>
        <div className="card-title" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Award size={22} style={{ color: "var(--success)" }} />
            <span>4. Publication Report &amp; Clone Summary</span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={handleDownloadHtmlReport}>
              <FileText size={16} />
              <span>Download Publication Report (HTML)</span>
            </button>
            <button className="btn btn-secondary" onClick={handleDownloadCsv}>
              <Download size={16} />
              <span>Download Screening CSV</span>
            </button>
          </div>
        </div>

        {/* Final Take-Home Message Callout */}
        <div style={{
          padding: "1rem 1.25rem",
          borderRadius: "10px",
          background: takeHome.status === "pass" ? "var(--success-bg)" : takeHome.status === "warn" ? "var(--warning-bg)" : "var(--danger-bg)",
          border: `1.5px solid ${takeHome.status === "pass" ? "var(--success-border)" : takeHome.status === "warn" ? "var(--warning-border)" : "var(--danger-border)"}`,
          marginBottom: "1rem"
        }}>
          <div style={{
            fontSize: "0.72rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: takeHome.status === "pass" ? "var(--success)" : takeHome.status === "warn" ? "var(--warning)" : "var(--danger)",
            marginBottom: "0.3rem"
          }}>
            Final Take-Home Conclusion
          </div>
          <div style={{ fontSize: "1.08rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.35rem" }}>
            {takeHome.headline}
          </div>
          <div style={{ fontSize: "0.9rem", color: "var(--text-main)", lineHeight: 1.5, marginBottom: "0.5rem" }}>
            {takeHome.summary}
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", borderTop: "1px dashed rgba(0,0,0,0.12)", paddingTop: "0.45rem" }}>
            <strong>Recommended Next Step:</strong> {takeHome.nextStep}
          </div>
        </div>

        {/* Verdict Summary KPI Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--success)", fontWeight: 700, textTransform: "uppercase" }}>Accepted Clones</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--success)" }}>{accepted.length}</div>
          </div>
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "var(--warning-bg)", border: "1px solid var(--warning-border)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--warning)", fontWeight: 700, textTransform: "uppercase" }}>Hold / Review</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--warning)" }}>{held.length}</div>
          </div>
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "#f0f6fc", border: "1px solid var(--border-color)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--primary)", fontWeight: 700, textTransform: "uppercase" }}>Re-Sequence</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--primary)" }}>{reseq.length}</div>
          </div>
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--danger)", fontWeight: 700, textTransform: "uppercase" }}>Rejected / WT</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--danger)" }}>{rejected.length}</div>
          </div>
        </div>
      </div>

      {/* Publication Clone-Selection Figure */}
      <section className="card" aria-labelledby="clone-figure-heading">
        <div className="card-title" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <h3 id="clone-figure-heading" style={{ margin: 0 }}>Publication Clone-Selection Figure</h3>
          {selectionSvg && (
            <div className="project-controls" style={{ margin: 0 }}>
              <button type="button" className="btn btn-secondary" disabled={figureBusy} onClick={() => downloadFigure("svg")}>Download SVG</button>
              <button type="button" className="btn btn-secondary" disabled={figureBusy} onClick={() => downloadFigure("pdf")}>Download PDF</button>
              <button type="button" className="btn btn-secondary" disabled={figureBusy} onClick={() => downloadFigure("png")}>Download PNG (300 dpi)</button>
            </div>
          )}
        </div>
        {selectionSvg ? <>
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 1rem", fontSize: "0.9rem" }}>
            Recommended clones aligned with the wild-type control, with design annotations where available and a summary of clone calls and support.
          </p>
          {figureError && <p role="alert" style={{ color: "var(--danger)", marginBottom: "0.75rem" }}>{figureError}</p>}
          <div role="img" aria-label="Clone-selection figure showing recommended clones and analysis support" style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid var(--border-color)", padding: "0.5rem" }} dangerouslySetInnerHTML={{ __html: selectionSvg }} />
        </> : <p style={{ color: "var(--text-muted)", marginTop: "0.75rem" }}>No clone-selection figure is available for these results. Review the individual trace or junction figures in Trace Analysis.</p>}
      </section>

      {/* Recommended Panel */}
      {topPanel.length > 0 && (
        <div className="card">
          <div className="card-title">
            <span>Top Prioritized Clones to Carry Forward</span>
            <span style={{ fontSize: "0.85rem", color: "var(--success)" }}>Click any card to inspect details</span>
          </div>

          <div className="grid-3">
            {topPanel.map((clone, idx) => {
              const rank = clone.recommendation?.rank || clone.rank;
              const s = clone.summary || {};
              const isKnock = clone.workflow === "knockout" || clone.workflow === "deletion";
              const hdr = s.intendedEditPct ?? (clone.intendedEditFraction !== undefined ? Math.round(clone.intendedEditFraction * 100) : 0);
              const block = s.partialConversionPct ?? (clone.blockingOnlyFraction !== undefined ? Math.round(clone.blockingOnlyFraction * 100) : 0);
              const wt = s.wtPct ?? (clone.wildTypeFraction !== undefined ? Math.round(clone.wildTypeFraction * 100) : 0);
              const ko = s.koScorePct ?? s.betweenCutsPct ?? s.editedPct ?? 100;
              const isSelected = activeClone?.name === clone.name;

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedClone(clone)}
                  style={{
                    background: isSelected ? "#f0f6fc" : "var(--bg-app)",
                    border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border-color)",
                    borderRadius: "10px",
                    padding: "1.25rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    cursor: "pointer",
                    transition: "all 0.15s ease"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "1.05rem", fontWeight: 700 }}>{clone.name}</span>
                    <span className="badge badge-ready">Rank #{rank}</span>
                  </div>

                  {clone.genotype?.summary && (
                    <div style={{ fontSize: "0.8rem", color: "var(--primary)", fontWeight: 600 }}>
                      {clone.genotype.summary}
                    </div>
                  )}

                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    {isKnock ? (
                      <>
                        <div>Knockout / Indel Score: <strong style={{ color: "var(--success)" }}>{ko}%</strong></div>
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
      )}

      {/* Selected Clone Diagnostic Inspector */}
      {activeClone && (
        <div className="card" style={{ borderLeft: "4px solid var(--primary)" }}>
          <div className="card-title" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span>Selected Clone Diagnostic: <strong>{activeClone.name}</strong></span>
              {renderVerdictBadge(activeClone.decision?.decision || activeClone.decision?.verdict)}
            </div>
            {activeClone.confidence?.tier && (
              <span className="badge badge-ready" style={{ fontSize: "0.75rem" }}>
                Confidence: {activeClone.confidence.tier}
              </span>
            )}
          </div>

          <div style={{ fontSize: "0.9rem", color: "var(--text-main)", marginBottom: "0.75rem" }}>
            <strong>Decision Rationale:</strong> {(activeClone.decision?.reasons || []).join(" ") || "Evaluated by chromatogram deconvolution."}
            {activeClone.decision?.next && (
              <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                ({activeClone.decision.next})
              </span>
            )}
          </div>

          {activeClone.recommendation && activeClone.recommendation.priority !== "none" && (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", padding: "0.75rem 1rem", background: "#f0f6fc", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
              <strong>Recommendation ({activeClone.recommendation.tier || activeClone.recommendation.priority}):</strong>{" "}
              {activeClone.recommendation.action}{" "}
              {activeClone.recommendation.why?.length > 0 && `— ${activeClone.recommendation.why.join(" | ")}`}
            </div>
          )}
        </div>
      )}

      {/* Complete Clone Screening Table */}
      <div className="card">
        <div className="card-title" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <span>All Screened Samples ({filteredResults.length} of {qcResults.length})</span>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search size={14} style={{ position: "absolute", left: "0.65rem", color: "var(--text-dim)" }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by clone ID or reason…"
                style={{ padding: "0.35rem 0.65rem 0.35rem 2rem", fontSize: "0.82rem", width: "210px" }}
              />
            </div>

            {["all", "accept", "hold", "re-sequence", "reject"].map(mode => (
              <button
                key={mode}
                type="button"
                className={`btn ${verdictFilter === mode ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setVerdictFilter(mode)}
                style={{ padding: "0.35rem 0.65rem", fontSize: "0.78rem", textTransform: "capitalize" }}
              >
                {mode === "all" ? "All" : mode === "re-sequence" ? "Re-sequence" : mode}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Sample / Clone</th>
                <th>Verdict</th>
                <th>Intended Edit / KO %</th>
                <th>Blocking-Only %</th>
                <th>Wild-Type %</th>
                <th>Confidence</th>
                <th>Reasons &amp; Next Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((r, i) => {
                const s = r.summary || {};
                const dec = r.decision?.decision || r.decision?.verdict || "unknown";
                const rank = r.recommendation?.rank || r.rank;
                const isKnock = r.workflow === "knockout" || r.workflow === "deletion";
                const primaryScore = isKnock
                  ? (s.koScorePct ?? s.betweenCutsPct ?? s.editedPct ?? "—")
                  : (s.intendedEditPct ?? (r.intendedEditFraction !== undefined ? Math.round(r.intendedEditFraction * 100) : "—"));
                const block = s.partialConversionPct ?? (r.blockingOnlyFraction !== undefined ? Math.round(r.blockingOnlyFraction * 100) : "—");
                const wt = s.wtPct ?? (r.wildTypeFraction !== undefined ? Math.round(r.wildTypeFraction * 100) : "—");
                const isSelected = activeClone?.name === r.name;

                return (
                  <tr
                    key={`${r.name}-${i}`}
                    onClick={() => setSelectedClone(r)}
                    style={{
                      cursor: "pointer",
                      background: isSelected ? "#eef5fc" : undefined
                    }}
                  >
                    <td>{rank ? <strong>#{rank}</strong> : "—"}</td>
                    <td><strong>{r.name}</strong></td>
                    <td>{renderVerdictBadge(dec)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: "var(--success)" }}>
                      {primaryScore !== "—" ? `${primaryScore}%` : "—"}
                    </td>
                    <td className="mono">{block !== "—" ? `${block}%` : "—"}</td>
                    <td className="mono">{wt !== "—" ? `${wt}%` : "—"}</td>
                    <td>{r.confidence?.tier || "—"}</td>
                    <td style={{ fontSize: "0.82rem", color: "var(--text-muted)", maxWidth: "360px" }}>
                      {(r.decision?.reasons || []).join(" ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
