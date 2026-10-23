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
    <div className="card" style={{ padding: "0.9rem 1.25rem", marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>3. Trace Analysis &amp; Clone Screening Report</h3>
          {design ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.25rem 0.7rem", borderRadius: "999px", background: "#eef5fc", border: "1px solid #b9d5f5", color: "#003366", fontSize: "0.8rem", fontWeight: 700 }}>
              <CheckCircle size={14} style={{ color: "#0055aa" }} />
              Active Design: {design.name} ({currentProject.gene || "Gene"})
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.25rem 0.7rem", borderRadius: "999px", background: "var(--warning-bg)", border: "1px solid var(--warning-border)", color: "#92400e", fontSize: "0.8rem", fontWeight: 600 }}>
              <AlertCircle size={14} style={{ color: "var(--warning)" }} />
              Standalone Mode (enter gRNA/donor below or load a preset)
            </span>
          )}
        </div>
        <div className="project-controls" style={{ margin: 0 }}>
          {currentProject.designResult && <>
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} onClick={() => downloadReportHtml(currentProject, currentProject.designResult)}>Download design HTML</button>
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} onClick={() => downloadDesignJson(currentProject, currentProject.designResult)}>Download Design JSON</button>
          </>}
        </div>
      </div>
    </div>
    <iframe ref={frame} src={source} title="Trace Analysis upload and analysis" style={{ width: "100%", height: "88vh", minHeight: 820, border: "none", borderRadius: 12, background: "transparent" }} />
  </div>;
}
