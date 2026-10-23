import React from "react";
import { Dna, Save, FolderOpen, Download, Upload, Plus } from "lucide-react";

export function Header({
  activeStep,
  setActiveStep,
  currentProject,
  onUpdateProject,
  onNewProject,
  onSaveProject,
  onOpenProjects,
  onOpenProtocol,
  onExportBundle,
  onImportBundle
}) {
  const steps = [
    { id: "design", label: "1. Design" },
    { id: "order", label: "2. Order" },
    { id: "qc", label: "3. Trace Analysis" },
    { id: "decision", label: "4. Reports" }
  ];

  return (
    <header className="app-header">
      <div className="brand" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div className="brand-icon">
            <Dna size={20} />
          </div>
          <div>
            <a className="brand-title" href="/" title="ASSURED home" style={{ textDecoration: "none" }}>ASSURED Bench</a>
            <span className="brand-badge">v1.0</span>
          </div>
        </div>

        {/* Inline Project Identity */}
        <div className="header-project-pill" style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(0, 20, 48, 0.55)",
          border: "1px solid rgba(255, 255, 255, 0.25)",
          borderRadius: "8px",
          padding: "0.2rem 0.6rem",
          gap: "0.5rem"
        }}>
          <label htmlFor="experiment-name" style={{
            color: "#93c5fd",
            fontSize: "0.8rem",
            fontWeight: 600,
            letterSpacing: "0.02em",
            textTransform: "uppercase"
          }}>
            Project:
          </label>
          <input
            id="experiment-name"
            type="text"
            value={currentProject?.name || ""}
            onChange={e => onUpdateProject && onUpdateProject({ name: e.target.value })}
            placeholder="Untitled Experiment"
            aria-label="Experiment name"
            style={{
              background: "#ffffff",
              color: "#003366",
              border: "1px solid rgba(255, 255, 255, 0.6)",
              borderRadius: "5px",
              padding: "0.25rem 0.55rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              width: "180px",
              outline: "none"
            }}
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
            className={`step-btn ${activeStep === s.id ? "active" : ""}`}
          >
            <span className="step-num">{idx + 1}</span>
            <span>{s.label.split(". ")[1]}</span>
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
