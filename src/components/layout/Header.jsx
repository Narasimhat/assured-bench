import React from "react";
import { Dna, Save, FolderOpen, Download, Upload, Plus, Check } from "lucide-react";

export function Header({
  activeStep,
  setActiveStep,
  currentProject,
  onUpdateProject,
  onNewProject,
  onSaveProject,
  onOpenProjects,
  onExportBundle,
  onImportBundle
}) {
  const hasDesign = Boolean(currentProject?.designResult);
  const qcCount = currentProject?.qcResults?.length || 0;
  const acceptedCount = (currentProject?.qcResults || []).filter(
    r => (r.decision?.decision || r.decision?.verdict) === "accept"
  ).length;

  const steps = [
    { id: "design", label: "Design", done: hasDesign },
    { id: "order", label: "Order", done: hasDesign },
    { id: "qc", label: "Trace Analysis & Report", done: qcCount > 0, badge: qcCount > 0 ? (acceptedCount > 0 ? `${acceptedCount}/${qcCount}✓` : qcCount) : null }
  ];

  return (
    <header className="app-header">
      <div className="brand" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div className="brand-icon">
            <Dna size={20} />
          </div>
          <div>
            <a className="brand-title" href="/" title="ASSURED Bench Home" style={{ textDecoration: "none" }}>ASSURED Bench</a>
            <span className="brand-badge">v1.1</span>
          </div>
        </div>

        {/* Inline Project Identity */}
        <div className="header-project-pill">
          <label htmlFor="experiment-name">
            Project:
          </label>
          <input
            id="experiment-name"
            type="text"
            value={currentProject?.name || ""}
            onChange={e => onUpdateProject && onUpdateProject({ name: e.target.value })}
            placeholder="Untitled Experiment"
            aria-label="Experiment name"
          />
        </div>
      </div>

      {/* Stepper Navigation */}
      <nav className="stepper-container" aria-label="Experiment workflow">
        {steps.map((s, idx) => (
          <button
            key={s.id}
            aria-current={activeStep === s.id ? "step" : undefined}
            onClick={() => setActiveStep(s.id)}
            className={`step-btn ${activeStep === s.id ? "active" : ""} ${s.done && activeStep !== s.id ? "completed" : ""}`}
          >
            <span className="step-num">
              {s.done && activeStep !== s.id ? <Check size={13} /> : idx + 1}
            </span>
            <span>{s.label}</span>
            {s.badge && (
              <span style={{
                fontSize: "0.7rem",
                padding: "0.05rem 0.4rem",
                borderRadius: "999px",
                background: activeStep === s.id ? "#e0f2fe" : "rgba(255,255,255,0.22)",
                color: activeStep === s.id ? "#0369a1" : "#ffffff",
                fontWeight: 700
              }}>
                {s.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Project Controls */}
      <div className="project-controls">
        <button
          className="btn btn-secondary"
          onClick={onNewProject}
          title="Start a new experiment"
          style={{ padding: "0.45rem 0.85rem", fontSize: "0.85rem" }}
        >
          <Plus size={16} />
          <span>New</span>
        </button>

        <button
          className="btn btn-secondary"
          onClick={onOpenProjects}
          title="Open saved experiments"
          style={{ padding: "0.45rem 0.85rem", fontSize: "0.85rem" }}
        >
          <FolderOpen size={16} />
          <span>Projects</span>
        </button>

        <button
          className="btn btn-secondary"
          onClick={onSaveProject}
          title="Save experiment locally"
          style={{ padding: "0.45rem 0.85rem", fontSize: "0.85rem" }}
        >
          <Save size={16} />
          <span>Save</span>
        </button>

        <button
          className="btn btn-secondary"
          onClick={onExportBundle}
          title="Export .assured experiment bundle"
          style={{ padding: "0.45rem 0.85rem", fontSize: "0.85rem" }}
        >
          <Download size={16} />
          <span>Export</span>
        </button>

        <label
          className="btn btn-secondary"
          title="Import .assured experiment bundle"
          style={{ padding: "0.45rem 0.85rem", fontSize: "0.85rem", cursor: "pointer", margin: 0 }}
        >
          <Upload size={16} />
          <span>Import</span>
          <input
            type="file"
            accept=".assured,.json"
            onChange={onImportBundle}
            style={{ display: "none" }}
          />
        </label>
      </div>
    </header>
  );
}
