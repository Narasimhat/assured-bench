import React, { useEffect, useMemo, useRef } from "react";
import { CheckCircle, AlertCircle, ArrowRight, Award } from "lucide-react";
import { buildQcDesignSpec } from "../../engine/design/qcExport.js";
import { downloadDesignJson, downloadReportHtml } from "../../services/designExport.js";

// Use Assured QC itself: its upload, pairing, HTML import and worker analysis stay identical.
export function QcView({ currentProject, onUpdateProject, onProceedToDecision }) {
  const frame = useRef(null);
  const ready = useRef(false);
  const update = useRef(onUpdateProject);
  update.current = onUpdateProject;
  const source = "./bench.html";
  const qcOrigin = window.location.origin;
  const design = useMemo(() => {
    if (currentProject.qcImportedDesignText) return { text: currentProject.qcImportedDesignText, name: currentProject.qcDesignSource || "Imported design" };
    try {
      const spec = currentProject.qcDesignSpec || (currentProject.designResult ? buildQcDesignSpec(currentProject.designResult) : null);
      return spec ? { text: JSON.stringify(spec), name: currentProject.qcDesignSource || `${currentProject.gene || "Bench"} design` } : null;
    } catch { return null; }
  }, [currentProject.qcImportedDesignText, currentProject.qcDesignSource, currentProject.qcDesignSpec, currentProject.designResult, currentProject.gene]);
  const currentDesign = useRef(design);
  currentDesign.current = design;
  useEffect(() => {
    const receive = event => {
      if (event.source !== frame.current?.contentWindow || event.origin !== qcOrigin) return;
      if (event.data?.type === "assured:qc:ready") {
        ready.current = true;
        frame.current.contentWindow.postMessage({ type: "assured:qc:design", design: currentDesign.current }, qcOrigin);
      }
      if (event.data?.type === "assured:qc:results" && Array.isArray(event.data.results)) {
        update.current({ qcResults: event.data.results, ...(typeof event.data.designText === "string" ? { qcImportedDesignText: event.data.designText, qcDesignSource: event.data.designName } : {}) });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [qcOrigin]);
  useEffect(() => {
    if (ready.current) frame.current?.contentWindow?.postMessage({ type: "assured:qc:design", design }, qcOrigin);
  }, [design, qcOrigin]);

  const qcResults = currentProject?.qcResults || [];
  const acceptedCount = qcResults.filter(r => (r.decision?.decision || r.decision?.verdict) === "accept").length;

  return <div>
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h3>3. Trace Analysis</h3>
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0" }}>
            Sanger chromatogram deconvolution &amp; clone screening. Review sample/control pairings, then run analysis to generate clone rankings and publication figures.
          </p>
        </div>
        <div className="project-controls" style={{ margin: 0 }}>
          {currentProject.designResult && <>
            <button className="btn btn-secondary" onClick={() => downloadReportHtml(currentProject, currentProject.designResult)}>Download design HTML</button>
            <button className="btn btn-secondary" onClick={() => downloadDesignJson(currentProject, currentProject.designResult)}>Download Design JSON</button>
          </>}
          {qcResults.length > 0 && onProceedToDecision && (
            <button className="btn btn-primary" onClick={onProceedToDecision}>
              <Award size={16} />
              <span>View Step 4 Reports ({qcResults.length} Clones)</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>

      {qcResults.length > 0 && (
        <div style={{ marginTop: "1rem", padding: "0.75rem 1.15rem", borderRadius: "8px", background: "var(--success-bg)", border: "1px solid var(--success-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem" }}>
            <CheckCircle size={18} style={{ color: "var(--success)", flexShrink: 0 }} />
            <span>
              <strong>Trace Deconvolution Complete:</strong> {qcResults.length} sample{qcResults.length === 1 ? "" : "s"} analyzed ({acceptedCount} accepted candidate{acceptedCount === 1 ? "" : "s"}).
            </span>
          </div>
          {onProceedToDecision && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onProceedToDecision}
              style={{ padding: "0.35rem 0.85rem", fontSize: "0.82rem" }}
            >
              <span>Open Publication Report &amp; Clone Summary</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}

      {design ? (
        <div style={{ marginTop: "1rem", padding: "0.85rem 1.25rem", borderRadius: "8px", background: "linear-gradient(90deg, #eef5fc 0%, #f4f8fd 100%)", border: "1px solid #c8dcf4", borderLeft: "4px solid #0055aa", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <CheckCircle size={22} style={{ color: "#0055aa", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, color: "#003366", fontSize: "0.95rem" }}>
                Active Bench Design: {design.name}
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                Target: <strong style={{ color: "var(--text-main)" }}>{currentProject.gene || "Gene"}</strong> · Loaded into QC pipeline. Review or override gRNA &amp; donor sequences directly in the workspace below.
              </div>
            </div>
          </div>
          <div style={{ fontSize: "0.85rem", background: "#ffffff", color: "#003366", border: "1px solid #b9d5f5", padding: "0.4rem 0.85rem", borderRadius: "6px", fontWeight: 600, boxShadow: "0 1px 2px rgba(0, 34, 68, 0.05)" }}>
            Next: Provide matching Parental Control &amp; Sample .ab1 files below
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "1rem", padding: "0.85rem 1.25rem", borderRadius: "8px", background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderLeft: "4px solid var(--warning)", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <AlertCircle size={22} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: "#92400e" }}>No active design loaded</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
              Provide your <strong>gRNA sequences and donor sequence</strong> directly in the workspace below, click a <strong>1-click benchmark trace set</strong>, or design an edit in <strong>Step 1</strong>.
            </div>
          </div>
        </div>
      )}
    </div>
    <iframe ref={frame} src={source} title="Trace Analysis upload and analysis" style={{ width: "100%", height: "88vh", minHeight: 760, border: "none", borderRadius: 12, background: "transparent" }} />
  </div>;
}
