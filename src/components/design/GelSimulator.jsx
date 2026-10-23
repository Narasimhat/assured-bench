import React, { useState, useMemo } from "react";
import { Download, Sliders, Eye, RefreshCw, Info } from "lucide-react";

/**
 * Standard DNA Ladder Specifications
 */
const LADDERS = {
  ladder100bp: {
    name: "100 bp DNA Ladder (100 - 1500 bp)",
    bands: [
      { bp: 1500, intensity: 0.6 },
      { bp: 1200, intensity: 0.6 },
      { bp: 1000, intensity: 1.0, isRef: true }, // reference band
      { bp: 900, intensity: 0.5 },
      { bp: 800, intensity: 0.5 },
      { bp: 700, intensity: 0.5 },
      { bp: 600, intensity: 0.5 },
      { bp: 500, intensity: 1.0, isRef: true }, // reference band
      { bp: 400, intensity: 0.5 },
      { bp: 300, intensity: 0.5 },
      { bp: 200, intensity: 0.5 },
      { bp: 100, intensity: 0.4 }
    ],
    minBp: 80,
    maxBp: 1800
  },
  ladder1kb: {
    name: "1 kb Plus DNA Ladder (250 - 10,000 bp)",
    bands: [
      { bp: 10000, intensity: 0.6 },
      { bp: 8000, intensity: 0.6 },
      { bp: 6000, intensity: 0.6 },
      { bp: 5000, intensity: 0.6 },
      { bp: 4000, intensity: 0.6 },
      { bp: 3000, intensity: 1.0, isRef: true },
      { bp: 2000, intensity: 0.6 },
      { bp: 1500, intensity: 0.6 },
      { bp: 1000, intensity: 1.0, isRef: true },
      { bp: 750, intensity: 0.5 },
      { bp: 500, intensity: 0.8 },
      { bp: 250, intensity: 0.5 }
    ],
    minBp: 200,
    maxBp: 12000
  }
};

/**
 * Tag length lookup (in bp) for tag knock-ins
 */
const TAG_LENGTHS = {
  "SD40-V5": 141,
  "FLAG": 24,
  "HA": 27,
  "Myc": 30,
  "V5": 42,
  "HiBiT": 33,
  "mEGFP": 717
};

export function GelSimulator({ designResult, currentProject }) {
  const [agarosePct, setAgarosePct] = useState(2.0); // 1.0% to 3.0%
  const [ladderKey, setLadderKey] = useState("ladder100bp");
  const [runTime, setRunTime] = useState(1.0); // 0.6 (short) to 1.4 (extended)
  const [showLabels, setShowLabels] = useState(true);
  const [dyeColor, setDyeColor] = useState("cyan"); // "cyan", "green", "amber"

  // Extract amplicon information from designResult
  const ampliconInfo = useMemo(() => {
    let wtBp = 450;
    let editedBp = 380;
    let deletionBp = 0;
    let editType = currentProject?.editType || designResult?.type || "ko";
    let tag = currentProject?.tag || designResult?.tag || "";

    // Parse from result.amp if string (e.g. "WT ~466 bp | deletion ~420 bp")
    if (designResult?.amp) {
      const wtMatch = String(designResult.amp).match(/WT\s*~?(\d+)\s*bp/i);
      const delMatch = String(designResult.amp).match(/deletion\s*~?(\d+)\s*bp/i);
      if (wtMatch) wtBp = parseInt(wtMatch[1], 10);
      if (delMatch) {
        editedBp = parseInt(delMatch[1], 10);
        deletionBp = wtBp - editedBp;
      }
    } else if (designResult?.amplicon?.length) {
      wtBp = designResult.amplicon.length;
    }

    // Dual-guide knockout deletion calculation fallback
    if (editType === "ko" && !deletionBp) {
      const gs = designResult?.gs || designResult?.guides || [];
      if (gs.length >= 2 && gs[0]?.cut && gs[1]?.cut) {
        deletionBp = Math.abs(gs[0].cut - gs[1].cut);
        editedBp = Math.max(100, wtBp - deletionBp);
      } else {
        deletionBp = 80;
        editedBp = wtBp - 80;
      }
    }

    // Tag Knock-in calculation
    if (editType === "ct" || editType === "nt" || editType === "it") {
      const tagBp = TAG_LENGTHS[tag] || 120;
      editedBp = wtBp + tagBp;
    }

    // Point mutation calculation (same size or small RFLP restriction digestion shift)
    if (editType === "pm") {
      editedBp = wtBp; // Identical size without restriction enzyme
    }

    return { wtBp, editedBp, deletionBp, editType, tag };
  }, [designResult, currentProject]);

  // Migration formula: log(bp) mapped to Y position
  const ladder = LADDERS[ladderKey] || LADDERS.ladder100bp;
  const gelHeight = 360;
  const wellY = 40;
  const bottomY = 330;

  // Compute Y coordinate on the gel for a given fragment size in bp
  const getYForBp = (bp) => {
    if (bp <= 0) return bottomY;
    const minLog = Math.log10(ladder.minBp);
    const maxLog = Math.log10(ladder.maxBp);
    const bpLog = Math.log10(bp);

    // Agarose effect: higher percentage compresses large bands at top and spreads small bands
    const norm = (maxLog - bpLog) / (maxLog - minLog);
    const agaroseFactor = Math.pow(norm, 1.0 + (agarosePct - 1.5) * 0.35);
    const runScaled = agaroseFactor * runTime;

    const y = wellY + runScaled * (bottomY - wellY);
    return Math.min(bottomY + 10, Math.max(wellY + 5, y));
  };

  // Color theme mapping
  const colors = {
    cyan: { band: "#38bdf8", glow: "rgba(56, 189, 248, 0.45)", ref: "#7dd3fc" },
    green: { band: "#4ade80", glow: "rgba(74, 222, 128, 0.45)", ref: "#86efac" },
    amber: { band: "#fbbf24", glow: "rgba(251, 191, 36, 0.45)", ref: "#fde68a" }
  }[dyeColor];

  // Lanes data
  const lanes = [
    {
      id: "lane-ladder",
      title: "Ladder",
      bands: ladder.bands.map(b => ({
        bp: b.bp,
        y: getYForBp(b.bp),
        intensity: b.intensity,
        isRef: b.isRef,
        label: `${b.bp} bp`
      }))
    },
    {
      id: "lane-wt",
      title: "Wild-Type",
      desc: "Parental control",
      bands: [
        {
          bp: ampliconInfo.wtBp,
          y: getYForBp(ampliconInfo.wtBp),
          intensity: 1.0,
          label: `${ampliconInfo.wtBp} bp (WT)`
        }
      ]
    },
    {
      id: "lane-het",
      title: "Het Clone",
      desc: "Heterozygous edit",
      bands: [
        {
          bp: ampliconInfo.wtBp,
          y: getYForBp(ampliconInfo.wtBp),
          intensity: 0.65,
          label: `${ampliconInfo.wtBp} bp`
        },
        {
          bp: ampliconInfo.editedBp,
          y: getYForBp(ampliconInfo.editedBp),
          intensity: 0.65,
          label: `${ampliconInfo.editedBp} bp`
        }
      ]
    },
    {
      id: "lane-hom",
      title: "Hom Clone",
      desc: "Homozygous edit",
      bands: [
        {
          bp: ampliconInfo.editedBp,
          y: getYForBp(ampliconInfo.editedBp),
          intensity: 1.0,
          label: `${ampliconInfo.editedBp} bp (Edited)`
        }
      ]
    },
    {
      id: "lane-ctrl",
      title: "NTC",
      desc: "No-template water control",
      bands: []
    }
  ];

  // SVG Export handler
  const handleDownloadSvg = () => {
    const svgEl = document.getElementById("gel-simulator-svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(currentProject?.gene || "pcr")}_gel_simulation.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const laneWidth = 72;
  const startX = 40;
  const svgWidth = startX + lanes.length * laneWidth + 40;

  return (
    <div className="card">
      <div className="card-title">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span>In-Silico PCR Agarose Gel Simulator</span>
          <span className="badge badge-ready" style={{ fontSize: "0.75rem" }}>
            Pre-Sequencing Screening Guide
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className="btn btn-secondary"
            onClick={handleDownloadSvg}
            style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
            title="Download publication-quality SVG gel image"
          >
            <Download size={14} />
            <span>Download SVG Gel</span>
          </button>
        </div>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
        Simulated electrophoretic migration of PCR screening amplicons. Verify colony band shifts before submitting clones for Sanger sequencing.
      </p>

      {/* Control Sliders & Options */}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", background: "var(--bg-app)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)", marginBottom: "1.25rem", alignItems: "center" }}>
        {/* Agarose % */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Agarose Gel %: <strong>{agarosePct.toFixed(1)}%</strong>
          </label>
          <input
            type="range"
            min="1.0"
            max="3.0"
            step="0.5"
            value={agarosePct}
            onChange={(e) => setAgarosePct(parseFloat(e.target.value))}
            style={{ width: "120px" }}
          />
        </div>

        {/* Run Time / Voltage Scale */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Run Distance: <strong>{Math.round(runTime * 100)}%</strong>
          </label>
          <input
            type="range"
            min="0.7"
            max="1.3"
            step="0.1"
            value={runTime}
            onChange={(e) => setRunTime(parseFloat(e.target.value))}
            style={{ width: "120px" }}
          />
        </div>

        {/* Ladder Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>DNA Ladder</label>
          <select
            value={ladderKey}
            onChange={(e) => setLadderKey(e.target.value)}
            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
          >
            <option value="ladder100bp">100 bp Ladder (High Resolution)</option>
            <option value="ladder1kb">1 kb Plus Ladder (Broad Range)</option>
          </select>
        </div>

        {/* Dye Color */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Staining Fluorophore</label>
          <select
            value={dyeColor}
            onChange={(e) => setDyeColor(e.target.value)}
            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
          >
            <option value="cyan">GelGreen / Blue Light (Cyan)</option>
            <option value="green">SYBR Safe (Green)</option>
            <option value="amber">Ethidium Bromide (UV Amber)</option>
          </select>
        </div>

        {/* Show Labels Toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer", marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
          />
          <span>Show bp labels</span>
        </label>
      </div>

      {/* Virtual Agarose Gel SVG Canvas */}
      <div style={{ overflowX: "auto", display: "flex", justifyContent: "center", background: "#050811", padding: "1.5rem", borderRadius: "10px", border: "1px solid #1e293b" }}>
        <svg
          id="gel-simulator-svg"
          width={svgWidth}
          height={gelHeight}
          viewBox={`0 0 ${svgWidth} ${gelHeight}`}
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {/* Gel Backdrop / UV Chamber */}
          <rect
            x="10"
            y="10"
            width={svgWidth - 20}
            height={gelHeight - 20}
            rx="12"
            fill="#090d16"
            stroke="#1e293b"
            strokeWidth="2"
          />

          {/* UV Transilluminator Diffuse Background Glow */}
          <radialGradient id="uv-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={colors.glow} stopOpacity="0.15" />
            <stop offset="100%" stopColor="#090d16" stopOpacity="0.0" />
          </radialGradient>
          <rect
            x="15"
            y="15"
            width={svgWidth - 30}
            height={gelHeight - 30}
            fill="url(#uv-glow)"
          />

          {/* Render Lanes */}
          {lanes.map((lane, laneIdx) => {
            const laneX = startX + laneIdx * laneWidth;
            const wellWidth = 42;
            const wellX = laneX + (laneWidth - wellWidth) / 2;

            return (
              <g key={lane.id}>
                {/* Agarose Well Pocket */}
                <rect
                  x={wellX}
                  y={wellY - 14}
                  width={wellWidth}
                  height={10}
                  rx="2"
                  fill="#030712"
                  stroke="#334155"
                  strokeWidth="1.5"
                />

                {/* Lane Header */}
                <text
                  x={laneX + laneWidth / 2}
                  y={wellY - 20}
                  fill="#94a3b8"
                  fontSize="11"
                  fontWeight="600"
                  textAnchor="middle"
                >
                  {lane.title}
                </text>

                {/* Bands inside Lane */}
                {lane.bands.map((band, bandIdx) => {
                  const bandWidth = wellWidth - 6;
                  const bandX = wellX + 3;
                  const bandHeight = band.isRef ? 4.5 : 3.0;
                  const opacity = Math.min(1.0, 0.4 + (band.intensity || 0.6) * 0.6);

                  return (
                    <g key={bandIdx} style={{ cursor: "pointer" }}>
                      {/* Glow Filter / Blur */}
                      <rect
                        x={bandX - 2}
                        y={band.y - bandHeight / 2 - 1.5}
                        width={bandWidth + 4}
                        height={bandHeight + 3}
                        rx="2"
                        fill={colors.glow}
                        opacity={opacity * 0.8}
                      />
                      {/* Core Fluorescent Band */}
                      <rect
                        x={bandX}
                        y={band.y - bandHeight / 2}
                        width={bandWidth}
                        height={bandHeight}
                        rx="1.5"
                        fill={band.isRef ? colors.ref : colors.band}
                        opacity={opacity}
                      />

                      {/* Basepair Label */}
                      {showLabels && (
                        <text
                          x={bandX + bandWidth + 4}
                          y={band.y + 3}
                          fill="#64748b"
                          fontSize="9.5"
                          fontFamily="monospace"
                        >
                          {band.label || `${band.bp} bp`}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Electrodes Legend */}
          <text x="25" y={wellY - 5} fill="#ef4444" fontSize="12" fontWeight="bold">- (Cathode)</text>
          <text x="25" y={bottomY + 12} fill="#3b82f6" fontSize="12" fontWeight="bold">+ (Anode)</text>
        </svg>
      </div>

      {/* Amplicon Size Diagnostic Summary */}
      <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", fontSize: "0.85rem" }}>
        <div style={{ padding: "0.75rem", borderRadius: "6px", background: "var(--bg-app)", border: "1px solid var(--border-color)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Wild-Type Amplicon</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-main)" }}>{ampliconInfo.wtBp} bp</div>
        </div>

        <div style={{ padding: "0.75rem", borderRadius: "6px", background: "var(--bg-app)", border: "1px solid var(--border-color)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Edited Amplicon</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--success)" }}>{ampliconInfo.editedBp} bp</div>
        </div>

        <div style={{ padding: "0.75rem", borderRadius: "6px", background: "var(--bg-app)", border: "1px solid var(--border-color)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Predicted Size Shift (Δ)</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: ampliconInfo.wtBp !== ampliconInfo.editedBp ? "var(--warning)" : "var(--text-dim)" }}>
            {ampliconInfo.wtBp !== ampliconInfo.editedBp
              ? `${Math.abs(ampliconInfo.wtBp - ampliconInfo.editedBp)} bp (${ampliconInfo.editedBp < ampliconInfo.wtBp ? "deletion excision" : "insertion tag"})`
              : "0 bp (SNP / RFLP)"}
          </div>
        </div>
      </div>
    </div>
  );
}
