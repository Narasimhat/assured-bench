import React, { useState, useMemo } from "react";
import { buildPlateMap } from "../../engine/qc/plateQuality.js";
import { Grid, CheckCircle, AlertTriangle, XCircle, Info, Filter, ShieldCheck } from "lucide-react";

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COLS = Array.from({ length: 12 }, (_, i) => i + 1);

export function PlateView({ traces = [], results = [], selectedResult, onSelectResult }) {
  const [filterMode, setFilterMode] = useState("all"); // "all", "accepted", "quality"
  const [hoveredWell, setHoveredWell] = useState(null);

  // Build 96-well data map
  const plateMap = useMemo(() => {
    return buildPlateMap(traces, results);
  }, [traces, results]);

  // Aggregate statistics
  const stats = useMemo(() => {
    let populatedCount = 0;
    let acceptCount = 0;
    let holdCount = 0;
    let rejectCount = 0;
    let controlCount = 0;

    plateMap.forEach((well) => {
      if (!well.isEmpty) {
        populatedCount++;
        const dec = well.decision?.toLowerCase();
        if (well.isControl || dec === "control") controlCount++;
        else if (dec === "accept") acceptCount++;
        else if (dec === "hold") holdCount++;
        else if (dec === "reject") rejectCount++;
      }
    });

    return {
      total: populatedCount,
      accept: acceptCount,
      hold: holdCount,
      reject: rejectCount,
      control: controlCount,
      successRate: populatedCount > 0 ? Math.round((acceptCount / Math.max(1, populatedCount - controlCount)) * 100) : 0
    };
  }, [plateMap]);

  // Determine styling for a given well
  const getWellStyle = (well) => {
    if (well.isEmpty) {
      return {
        background: "var(--bg-app)",
        border: "1px dashed var(--border-light)",
        opacity: 0.6,
        cursor: "default"
      };
    }

    const isSelected = selectedResult && (
      selectedResult.name === well.result?.name ||
      selectedResult.fileName === well.trace?.name
    );

    // If filterMode is "accepted", dim everything that is not accepted
    const isDimmed = filterMode === "accepted" && well.decision !== "accept";

    let bg = "#64748b"; // pending
    let border = "#475569";
    let glow = "none";

    if (filterMode === "quality") {
      const q = well.quality?.status;
      if (q === "PASS") { bg = "#10b981"; border = "#059669"; }
      else if (q === "WARN") { bg = "#f59e0b"; border = "#d97706"; }
      else if (q === "FAIL") { bg = "#ef4444"; border = "#dc2626"; }
    } else {
      const dec = well.decision?.toLowerCase();
      if (well.isControl || dec === "control") {
        bg = "#3b82f6";
        border = "#2563eb";
      } else if (dec === "accept") {
        bg = "#10b981";
        border = "#059669";
        glow = "0 0 10px rgba(16, 185, 129, 0.4)";
      } else if (dec === "hold") {
        bg = "#f59e0b";
        border = "#d97706";
      } else if (dec === "reject") {
        bg = "#ef4444";
        border = "#dc2626";
      }
    }

    return {
      background: bg,
      border: isSelected ? "2px solid #38bdf8" : `1px solid ${border}`,
      boxShadow: isSelected ? "0 0 12px #38bdf8" : glow,
      opacity: isDimmed ? 0.25 : 1.0,
      cursor: "pointer",
      transform: isSelected ? "scale(1.15)" : "scale(1.0)",
      transition: "all 0.15s ease-in-out"
    };
  };

  const handleWellClick = (well) => {
    if (well.isEmpty) return;
    if (well.result && onSelectResult) {
      onSelectResult(well.result);
    } else if (well.trace && results.length > 0) {
      const clean = well.trace.name.replace(/\.[^/.]+$/, "");
      const found = results.find(r => r.name === clean || r.fileName === well.trace.name);
      if (found && onSelectResult) onSelectResult(found);
    }
  };

  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <div className="card-title">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Grid size={18} style={{ color: "var(--primary)" }} />
          <span>96-Well Plate QC Heatmap</span>
          <span className="badge badge-ready" style={{ fontSize: "0.75rem" }}>
            Interactive Clone Mapper
          </span>
        </div>

        {/* Filter Controls */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "0.25rem", background: "var(--bg-app)", padding: "0.2rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}>
            <button
              className={`btn ${filterMode === "all" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setFilterMode("all")}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
            >
              All Wells ({stats.total})
            </button>
            <button
              className={`btn ${filterMode === "accepted" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setFilterMode("accepted")}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
            >
              Winning Clones Only ({stats.accept})
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Bar */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem", fontSize: "0.85rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--success)", display: "inline-block" }}></span>
          <span><strong>{stats.accept}</strong> Accepted ({stats.successRate}%)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--warning)", display: "inline-block" }}></span>
          <span><strong>{stats.hold}</strong> Hold / Review</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#94a3b8", display: "inline-block" }}></span>
          <span><strong>{stats.reject}</strong> WT / Reject</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--accent-blue)", display: "inline-block" }}></span>
          <span><strong>{stats.control}</strong> WT Control</span>
        </div>
        <div style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
          Click any active well to inspect its chromatogram trace
        </div>
      </div>

      {/* 96-Well Microplate Grid Container */}
      <div style={{ overflowX: "auto", background: "var(--bg-app)", padding: "1.25rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
        <div style={{ minWidth: "580px", margin: "0 auto" }}>
          {/* Column Headers (1 to 12) */}
          <div style={{ display: "grid", gridTemplateColumns: "32px repeat(12, 1fr)", gap: "6px", textAlign: "center", marginBottom: "6px" }}>
            <div></div>
            {COLS.map((col) => (
              <div key={col} style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>
                {col}
              </div>
            ))}
          </div>

          {/* Rows (A to H) */}
          {ROWS.map((row) => (
            <div
              key={row}
              style={{
                display: "grid",
                gridTemplateColumns: "32px repeat(12, 1fr)",
                gap: "6px",
                alignItems: "center",
                marginBottom: "6px"
              }}
            >
              {/* Row Header Letter */}
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: "bold", textAlign: "center" }}>
                {row}
              </div>

              {/* 12 Wells per row */}
              {COLS.map((col) => {
                const wellId = `${row}${String(col).padStart(2, "0")}`;
                const well = plateMap.get(wellId);
                const isHovered = hoveredWell?.wellId === wellId;

                return (
                  <div
                    key={wellId}
                    style={{ position: "relative", display: "flex", justifyContent: "center" }}
                    onMouseEnter={() => !well?.isEmpty && setHoveredWell(well)}
                    onMouseLeave={() => setHoveredWell(null)}
                  >
                    <button
                      onClick={() => handleWellClick(well)}
                      title={well?.isEmpty ? `Well ${wellId} (Empty)` : `${wellId}: ${well.trace?.name}`}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        padding: 0,
                        outline: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.7rem",
                        color: "#ffffff",
                        fontWeight: "600",
                        ...getWellStyle(well)
                      }}
                    >
                      {!well.isEmpty ? (well.isControl ? "WT" : well.wellId.slice(1)) : ""}
                    </button>

                    {/* Hover Tooltip Card */}
                    {isHovered && !well.isEmpty && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "115%",
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border-color)",
                          padding: "0.6rem 0.8rem",
                          borderRadius: "6px",
                          boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                          zIndex: 100,
                          pointerEvents: "none",
                          minWidth: "180px",
                          whiteSpace: "nowrap"
                        }}
                      >
                        <div style={{ fontWeight: "bold", fontSize: "0.8rem", color: "var(--primary)" }}>
                          Well {well.wellId} • {well.isControl ? "Parental WT Control" : "Colony Sample"}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }}>
                          {well.trace?.name}
                        </div>
                        {well.result && (
                          <div style={{ marginTop: "4px", fontSize: "0.75rem" }}>
                            Status: <strong style={{ textTransform: "uppercase" }}>{well.decision}</strong>
                            {well.result.summary && (
                              <div style={{ color: "var(--primary)", marginTop: "2px", fontWeight: 600 }}>
                                Intended Edit: {well.result.summary.intendedEditPct || well.result.summary.koScorePct || 0}%
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
