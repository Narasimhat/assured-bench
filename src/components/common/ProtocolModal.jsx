import React, { useState, useMemo } from "react";
import { X, Printer, CheckSquare, Square, FlaskConical, Beaker, Clock, Thermometer, ShieldCheck } from "lucide-react";

const CELL_PLATFORMS = {
  ipsc: {
    name: "Human Induced Pluripotent Stem Cells (iPSC)",
    nucleofectionSolution: "P3 Primary Cell Solution",
    program: "B-016 or CA-137 (Lonza 4D)",
    cellCount: "200,000 cells / rxn",
    medium: "mTeSR Plus / Essential 8 + CloneR or RevitaCell (10 µM)",
    coldShock: "32°C transient incubation for 24h (boosts HDR knock-in up to 2-fold)"
  },
  hek293: {
    name: "HEK293T / Immortalized Cell Line",
    nucleofectionSolution: "SF Cell Line Solution",
    program: "CM-130 (Lonza 4D)",
    cellCount: "250,000 cells / rxn",
    medium: "DMEM + 10% FBS + 1% Pen/Strep",
    coldShock: "Standard 37°C incubation (or 32°C 24h for HDR)"
  },
  tcells: {
    name: "Primary Human T-Cells / PBMCs",
    nucleofectionSolution: "P3 Primary Cell Solution",
    program: "EO-115 (Lonza 4D)",
    cellCount: "1,000,000 cells / rxn",
    medium: "X-VIVO 15 + 5% Human AB Serum + IL-2 (100 U/mL)",
    coldShock: "37°C incubation"
  },
  k562: {
    name: "K562 / Suspension Hematopoietic Cells",
    nucleofectionSolution: "SF Cell Line Solution",
    program: "FF-120 (Lonza 4D)",
    cellCount: "500,000 cells / rxn",
    medium: "RPMI-1640 + 10% FBS",
    coldShock: "37°C incubation"
  }
};

export function ProtocolModal({ isOpen, onClose, currentProject }) {
  const [platformKey, setPlatformKey] = useState("ipsc");
  const [numReactions, setNumReactions] = useState(2); // e.g. test + control
  const [checkedSteps, setCheckedSteps] = useState(new Set());

  const platform = CELL_PLATFORMS[platformKey] || CELL_PLATFORMS.ipsc;
  const editType = currentProject?.editType || "ko";
  const gene = currentProject?.gene || "Target Gene";

  // Reagent calculations with 1.1x excess for pipette dead volume
  const rxnCount = Math.max(1, parseInt(numReactions, 10) || 1);
  const excessFactor = 1.15;
  const totalVolumeMultiplier = rxnCount * excessFactor;

  const rnpRecipe = useMemo(() => {
    const isKnockin = editType === "pm" || editType === "ct" || editType === "nt" || editType === "it";
    const isDualKo = editType === "ko";

    const items = [
      {
        reagent: "Cas9 Nuclease (61 µM / 10 mg/mL)",
        stock: "61 µM (10 µg/µL)",
        singleRxnVol: 0.8, // ~50 pmol
        finalAmount: "50 pmol (8 µg)"
      }
    ];

    if (isDualKo) {
      items.push(
        {
          reagent: "gRNA 1 (Synthetic sgRNA)",
          stock: "100 µM",
          singleRxnVol: 0.6,
          finalAmount: "60 pmol"
        },
        {
          reagent: "gRNA 2 (Synthetic sgRNA)",
          stock: "100 µM",
          singleRxnVol: 0.6,
          finalAmount: "60 pmol"
        }
      );
    } else {
      items.push({
        reagent: "Guide RNA (Synthetic sgRNA)",
        stock: "100 µM",
        singleRxnVol: 1.2,
        finalAmount: "120 pmol (2.4x molar ratio)"
      });
    }

    if (isKnockin) {
      items.push({
        reagent: "ssODN Donor Repair Template",
        stock: "100 µM",
        singleRxnVol: 1.0,
        finalAmount: "100 pmol"
      });
    }

    return items;
  }, [editType]);

  const toggleStep = (stepId) => {
    setCheckedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.75)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 110,
      backdropFilter: "blur(4px)"
    }}>
      <div className="card" style={{
        width: "820px",
        maxWidth: "92vw",
        maxHeight: "88vh",
        overflowY: "auto",
        position: "relative",
        padding: "1.75rem",
        background: "var(--card-bg)"
      }}>
        {/* Modal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <FlaskConical size={22} style={{ color: "var(--primary)" }} />
              <h2 style={{ margin: 0, fontSize: "1.35rem" }}>CRISPR Bench Protocol & Checklist</h2>
              <span className="badge badge-ready">Wet-Lab Verified</span>
            </div>
            <p style={{ margin: "0.3rem 0 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              Standard operating procedure for <strong>{gene}</strong> genome editing in <strong>{platform.name}</strong>.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-secondary"
              onClick={handlePrint}
              style={{ fontSize: "0.85rem", padding: "0.4rem 0.75rem" }}
              title="Print checklist for wet-lab biosafety cabinet"
            >
              <Printer size={15} />
              <span>Print Checklist</span>
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0.2rem" }}>
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Configuration Strip */}
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", background: "var(--bg-app)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)", marginBottom: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
              Host Cell Platform
            </label>
            <select
              value={platformKey}
              onChange={(e) => setPlatformKey(e.target.value)}
              style={{ padding: "0.35rem 0.6rem", fontSize: "0.85rem" }}
            >
              <option value="ipsc">Human iPSCs (Stem Cells)</option>
              <option value="hek293">HEK293T (Immortalized)</option>
              <option value="tcells">Primary Human T-Cells</option>
              <option value="k562">K562 (Hematopoietic)</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
              Number of Reactions
            </label>
            <input
              type="number"
              min="1"
              max="96"
              value={numReactions}
              onChange={(e) => setNumReactions(parseInt(e.target.value, 10) || 1)}
              style={{ width: "80px", padding: "0.35rem 0.6rem", fontSize: "0.85rem" }}
            />
          </div>

          <div style={{ flex: 1, minWidth: "220px", fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div>Lonza Buffer: <strong style={{ color: "var(--primary)" }}>{platform.nucleofectionSolution}</strong></div>
            <div>4D Pulse Code: <strong style={{ color: "var(--primary)" }}>{platform.program}</strong></div>
            <div>Cell Density: <strong>{platform.cellCount}</strong></div>
          </div>
        </div>

        {/* Section 1: RNP Assembly Master Mix */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h4 style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0 0 0.6rem", fontSize: "1rem" }}>
            <Beaker size={16} style={{ color: "var(--primary)" }} />
            <span>1. RNP Electroporation Master Mix ({rxnCount} rxns + 15% pipette excess)</span>
          </h4>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Stock Conc.</th>
                <th>Per Reaction (1x)</th>
                <th>Total Master Mix ({rxnCount}x)</th>
                <th>Role & Notes</th>
              </tr>
            </thead>
            <tbody>
              {rnpRecipe.map((item, idx) => (
                <tr key={idx}>
                  <td><strong>{item.reagent}</strong></td>
                  <td className="mono" style={{ fontSize: "0.85rem" }}>{item.stock}</td>
                  <td className="mono" style={{ color: "var(--primary)" }}>{item.singleRxnVol.toFixed(1)} µL</td>
                  <td className="mono" style={{ color: "var(--success)", fontWeight: 700 }}>
                    {(item.singleRxnVol * totalVolumeMultiplier).toFixed(1)} µL
                  </td>
                  <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{item.finalAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.4rem", fontStyle: "italic" }}>
            Assembly Tip: Combine Cas9 and sgRNA first. Incubate 15 minutes at room temperature (20-25°C) to allow ribonucleoprotein complexation before adding donor template or cells.
          </p>
        </div>

        {/* Section 2: Day-by-Day Experimental Timeline */}
        <div>
          <h4 style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0 0 0.75rem", fontSize: "1rem" }}>
            <Clock size={16} style={{ color: "var(--primary)" }} />
            <span>2. Step-by-Step Bench Checklist</span>
          </h4>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {/* Step 1 */}
            <div
              onClick={() => toggleStep("s1")}
              style={{
                display: "flex",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: checkedSteps.has("s1") ? "rgba(16, 185, 129, 0.08)" : "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                cursor: "pointer",
                alignItems: "flex-start"
              }}
            >
              <div style={{ marginTop: "2px", color: checkedSteps.has("s1") ? "var(--success)" : "var(--text-dim)" }}>
                {checkedSteps.has("s1") ? <CheckSquare size={18} /> : <Square size={18} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Day 0 — Cell Harvesting & Nucleofection
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem", lineHeight: "1.5" }}>
                  Harvest {platform.cellCount} in log phase. Pellet at 200 x g for 5 min. Aspirate supernatant completely. Resuspend pellet in 18 µL {platform.nucleofectionSolution}. Add 2-3 µL of pre-assembled RNP complex. Transfer to 4D Nucleocuvette and pulse with code <strong>{platform.program}</strong>. Immediately rescue cells with 80 µL warm medium.
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div
              onClick={() => toggleStep("s2")}
              style={{
                display: "flex",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: checkedSteps.has("s2") ? "rgba(16, 185, 129, 0.08)" : "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                cursor: "pointer",
                alignItems: "flex-start"
              }}
            >
              <div style={{ marginTop: "2px", color: checkedSteps.has("s2") ? "var(--success)" : "var(--text-dim)" }}>
                {checkedSteps.has("s2") ? <CheckSquare size={18} /> : <Square size={18} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Day 1 — Medium Refresh & Cold Shock
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem", lineHeight: "1.5" }}>
                  {platform.coldShock}. Change medium to standard culture medium without ROCK inhibitor.
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div
              onClick={() => toggleStep("s3")}
              style={{
                display: "flex",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: checkedSteps.has("s3") ? "rgba(16, 185, 129, 0.08)" : "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                cursor: "pointer",
                alignItems: "flex-start"
              }}
            >
              <div style={{ marginTop: "2px", color: checkedSteps.has("s3") ? "var(--success)" : "var(--text-dim)" }}>
                {checkedSteps.has("s3") ? <CheckSquare size={18} /> : <Square size={18} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Day 3 — Pool Editing Check (Bulk Validation)
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem", lineHeight: "1.5" }}>
                  Harvest 10,000 cells from the bulk pool. Lyse in QuickExtract (65°C 15 min, 98°C 2 min). Run Sanger sequencing to confirm pool editing efficiency before proceeding to single-cell cloning.
                </div>
              </div>
            </div>

            {/* Step 4 */}
            <div
              onClick={() => toggleStep("s4")}
              style={{
                display: "flex",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: checkedSteps.has("s4") ? "rgba(16, 185, 129, 0.08)" : "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                cursor: "pointer",
                alignItems: "flex-start"
              }}
            >
              <div style={{ marginTop: "2px", color: checkedSteps.has("s4") ? "var(--success)" : "var(--text-dim)" }}>
                {checkedSteps.has("s4") ? <CheckSquare size={18} /> : <Square size={18} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Day 4 to 12 — Single-Cell Plating & Expansion
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem", lineHeight: "1.5" }}>
                  Plate single cells into 96-well culture plates (0.5 cells/well or FACS single-cell sorting into 100 µL conditioned medium with survival supplement). Allow colonies to emerge for 10-14 days until discrete colonies are visible under phase contrast.
                </div>
              </div>
            </div>

            {/* Step 5 */}
            <div
              onClick={() => toggleStep("s5")}
              style={{
                display: "flex",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: checkedSteps.has("s5") ? "rgba(16, 185, 129, 0.08)" : "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                cursor: "pointer",
                alignItems: "flex-start"
              }}
            >
              <div style={{ marginTop: "2px", color: checkedSteps.has("s5") ? "var(--success)" : "var(--text-dim)" }}>
                {checkedSteps.has("s5") ? <CheckSquare size={18} /> : <Square size={18} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Day 14 — Colony Direct PCR & Gel Screening
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem", lineHeight: "1.5" }}>
                  Pick 1/4 of each colony into 20 µL lysis buffer. Retain 3/4 in culture. Perform 35-cycle PCR with ASSURED Bench primers. Run 5 µL on a 2.0% agarose gel and compare band migration against the <strong>In-Silico Gel Simulator</strong>.
                </div>
              </div>
            </div>

            {/* Step 6 */}
            <div
              onClick={() => toggleStep("s6")}
              style={{
                display: "flex",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: checkedSteps.has("s6") ? "rgba(16, 185, 129, 0.08)" : "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                cursor: "pointer",
                alignItems: "flex-start"
              }}
            >
              <div style={{ marginTop: "2px", color: checkedSteps.has("s6") ? "var(--success)" : "var(--text-dim)" }}>
                {checkedSteps.has("s6") ? <CheckSquare size={18} /> : <Square size={18} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Day 15 — Sanger Sequencing & Trace Analysis
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem", lineHeight: "1.5" }}>
                  Submit candidate amplicons to Sanger sequencing. Once .ab1 files are returned, drop them into <strong>Step 3: Trace Analysis</strong>. View the 96-well heatmap, verify 100% deconvolution, and export your HTML QC report for publication!
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
