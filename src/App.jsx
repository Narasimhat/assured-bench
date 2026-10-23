import React, { useState, useEffect } from "react";
import { Header } from "./components/layout/Header.jsx";
import { DesignView } from "./components/design/DesignView.jsx";
import { OrderView } from "./components/order/OrderView.jsx";
import { QcView } from "./components/qc/QcView.jsx";
import { DecisionView } from "./components/qc/DecisionView.jsx";
import { saveProject, listProjects, deleteProject, exportProjectBundle } from "./services/storage.js";
import { ProtocolModal } from "./components/common/ProtocolModal.jsx";
import { createProject, updateProject, parseProject } from "./services/projectState.js";
import { X, Trash2, FolderOpen } from "lucide-react";

export function App() {
  const [activeStep, setActiveStep] = useState("design");
  const [currentProject, setCurrentProject] = useState(createProject);

  const [isLoadingExample, setIsLoadingExample] = useState(false);
  const [savedProjects, setSavedProjects] = useState([]);
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [showProtocolModal, setShowProtocolModal] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const showToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const loadProjects = async () => {
    try {
      setSavedProjects(await listProjects());
    } catch (err) {
      showToast("Could not load saved experiments: " + err.message);
    }
  };

  const handleUpdateProject = (fields) => {
    const projectId = currentProject.id;
    setCurrentProject(prev => prev.id === projectId ? updateProject(prev, fields) : prev);
  };

  const handleSave = async () => {
    try {
      await saveProject(currentProject);
      await loadProjects();
      showToast("Experiment saved on this device.");
    } catch (err) {
      showToast("Could not save experiment: " + err.message);
    }
  };

  const handleNewProject = () => {
    setCurrentProject(createProject());
    setActiveStep("design");
    showToast("Started fresh experiment.");
  };

  const handleDesignExample = async () => {
    setIsLoadingExample(true);
    try {
      const base = import.meta.env.BASE_URL;
      const response = await fetch(`${base}references/tp53-NG_017013.2.gb`);
      if (!response.ok) throw new Error(`Reference download failed (HTTP ${response.status}).`);
      const raw = await response.text();
      if (!raw.includes("VERSION     NG_017013.2") || !raw.includes("ORIGIN")) throw new Error("The example reference is invalid.");
      // Keep the current work available in Projects before starting the example.
      await saveProject(currentProject);
      await loadProjects();
      setCurrentProject({ ...createProject(), name: "Example: TP53 C-terminal FLAG", gene: "TP53", editType: "ct", tag: "FLAG",
        genbankRaw: raw, geneMeta: { geneSymbol: "TP53", transcriptId: "NM_000546.5", source: "Bundled NCBI RefSeqGene",
          sourceUrl: "https://www.ncbi.nlm.nih.gov/nuccore/NG_017013.2",
          warning: "Design example: NCBI RefSeqGene NG_017013.2, TP53 variant 1. Coordinates are relative to this reference record.",
          genbankText: raw } });
      setActiveStep("design");
      showToast("Example loaded. Your previous experiment is saved in Projects. Click Generate design.");
    } catch (error) {
      showToast("Could not load design example: " + error.message);
    } finally {
      setIsLoadingExample(false);
    }
  };

  const handleSelectProject = (proj, targetStep = "design") => {
    setCurrentProject(proj);
    setActiveStep(targetStep);
    setShowProjectsModal(false);
    showToast(`Loaded '${proj.name}'`);
  };

  const handleDeleteProject = async (id, e) => {
    e.stopPropagation();
    try {
      await deleteProject(id);
      await loadProjects();
      showToast("Project deleted.");
    } catch (err) {
      showToast("Could not delete experiment: " + err.message);
    }
  };

  const handleExport = () => {
    exportProjectBundle(currentProject);
    showToast("Exported .assured project file.");
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = parseProject(event.target.result);
        await saveProject(parsed);
        setCurrentProject(parsed);
        setActiveStep("design");
        await loadProjects();
        showToast(`Imported '${parsed.name || parsed.gene || "Experiment"}'!`);
      } catch (err) {
        showToast("Could not import experiment: " + err.message);
      }
    };
    reader.onerror = () => showToast("Could not read the experiment file.");
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        activeStep={activeStep}
        setActiveStep={setActiveStep}
        currentProject={currentProject}
        onUpdateProject={handleUpdateProject}
        onNewProject={handleNewProject}
        onSaveProject={handleSave}
        onOpenProjects={() => setShowProjectsModal(true)}
        onOpenProtocol={() => setShowProtocolModal(true)}
        onExportBundle={handleExport}
        onImportBundle={handleImport}
      />

      {notification && (
        <div role="status" style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          background: "var(--bg-surface)",
          border: "1px solid var(--primary)",
          color: "var(--text-main)",
          padding: "0.75rem 1.25rem",
          borderRadius: "8px",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
          zIndex: 100,
          fontSize: "0.9rem"
        }}>
          {notification}
        </div>
      )}

      <main className="app-container">
        {activeStep === "design" && (
          <DesignView
            key={currentProject.id}
            currentProject={currentProject}
            onUpdateProject={handleUpdateProject}
            onProceedToOrder={() => setActiveStep("order")}
            onProceedToQc={() => setActiveStep("qc")}
            onOpenProtocol={() => setShowProtocolModal(true)}
          />
        )}

        {activeStep === "order" && (
          <OrderView
            currentProject={currentProject}
            onProceedToQc={() => setActiveStep("qc")}
            onOpenProtocol={() => setShowProtocolModal(true)}
          />
        )}

        <div hidden={activeStep !== "qc"}>
          <QcView
            key={currentProject.id}
            currentProject={currentProject}
            onUpdateProject={handleUpdateProject}
          />
        </div>

        {activeStep === "decision" && (
          <DecisionView currentProject={currentProject} />
        )}
      </main>

      {/* Saved Projects Modal */}
      {showProjectsModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100
        }}>
          <div className="card" style={{ width: "650px", maxWidth: "90vw", maxHeight: "80vh", overflowY: "auto", position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <FolderOpen size={20} style={{ color: "var(--primary)" }} />
                <h3>Saved Experiments ({savedProjects.length})</h3>
              </div>
              <button onClick={() => setShowProjectsModal(false)}>
                <X size={20} />
              </button>
            </div>

            {savedProjects.length === 0 ? (
              <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem" }}>
                No saved experiments yet. Click 'Save' in the header to save your work.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {savedProjects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => handleSelectProject(p)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.85rem 1rem",
                      borderRadius: "8px",
                      background: "var(--bg-app)",
                      border: "1px solid var(--border-color)",
                      cursor: "pointer",
                      transition: "border-color 0.15s ease"
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.name || p.gene || "Unnamed Project"}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        Gene: <strong>{p.gene || "N/A"}</strong> | Edit: <strong>{p.editType}</strong> | Last updated: {new Date(p.updatedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      {(p.designResult || p.qcDesignSpec) && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={(e) => { e.stopPropagation(); handleSelectProject(p, "qc"); }}
                          style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          title="Open this saved project directly in Trace Analysis"
                        >
                          <span>Analyse Traces 🔬</span>
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        onClick={(e) => handleDeleteProject(p.id, e)}
                        style={{ padding: "0.4rem 0.6rem", color: "var(--danger)" }}
                        title="Delete saved experiment"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Experimental Bench Protocol & Checklist Modal */}
      <ProtocolModal
        isOpen={showProtocolModal}
        onClose={() => setShowProtocolModal(false)}
        currentProject={currentProject}
      />
    </div>
  );
}
