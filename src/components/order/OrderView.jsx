import React, { useState } from "react";
import { generateIdtOrderRows, generateSynthegoOrderRows, exportOrderToCsv } from "../../services/vendorExport.js";
import { GelSimulator } from "../design/GelSimulator.jsx";
import { ShoppingCart, Copy, Download, Check, ArrowRight, FlaskConical } from "lucide-react";

export function OrderView({ currentProject, onProceedToQc, onOpenProtocol }) {
  const [activeVendor, setActiveVendor] = useState("idt");
  const [copiedIdx, setCopiedIdx] = useState(null);

  const designPayload = currentProject?.designResult ? {
    input: { gene: currentProject.gene },
    result: currentProject.designResult
  } : null;

  const idtRows = designPayload ? generateIdtOrderRows(designPayload) : [];
  const synthegoRows = designPayload ? generateSynthegoOrderRows(designPayload) : [];

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleDownloadCsv = () => {
    const rows = activeVendor === "idt" ? idtRows : synthegoRows;
    exportOrderToCsv(rows, `${(currentProject?.gene || "reagents")}_${activeVendor}_order.csv`);
  };

  if (!designPayload || idtRows.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
        <ShoppingCart size={40} style={{ color: "var(--text-dim)", margin: "0 auto 1rem" }} />
        <h3>No Design Computed Yet</h3>
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Please complete Step 1 (Design & Reagents) first to generate order-ready guide RNAs, donors, and primers.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <ShoppingCart size={20} style={{ color: "var(--primary)" }} />
            <span>2. Vendor Cart & Reagent Procurement</span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-secondary"
              onClick={onOpenProtocol}
              style={{ color: "var(--primary)", borderColor: "rgba(2, 132, 199, 0.4)", fontWeight: 600 }}
              title="View wet-lab bench protocol and pipetting checklist"
            >
              <FlaskConical size={16} />
              <span>Bench Protocol</span>
            </button>
            <button className="btn btn-secondary" onClick={handleDownloadCsv}>
              <Download size={16} />
              <span>Download CSV</span>
            </button>
            <button className="btn btn-primary" onClick={onProceedToQc}>
              <span>Proceed to Trace Analysis</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Vendor Selector Tabs */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.75rem" }}>
          <button
            className={`btn ${activeVendor === "idt" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveVendor("idt")}
          >
            Integrated DNA Technologies (IDT)
          </button>
          <button
            className={`btn ${activeVendor === "synthego" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveVendor("synthego")}
          >
            Synthego (Synthetic sgRNA)
          </button>
        </div>

        {/* Reagent Table */}
        <table>
          <thead>
            <tr>
              <th>Oligo / Reagent Name</th>
              <th>Type / Product</th>
              <th>Sequence (5' → 3')</th>
              <th>Scale / Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(activeVendor === "idt" ? idtRows : synthegoRows).map((row, idx) => (
              <tr key={idx}>
                <td><strong>{row.name}</strong></td>
                <td>
                  <span style={{ fontSize: "0.85rem", color: "var(--primary)" }}>{row.product || row.itemType}</span>
                </td>
                <td className="mono" style={{ fontSize: "0.85rem", maxWidth: "450px", wordBreak: "break-all" }}>
                  {row.sequence}
                </td>
                <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {row.notes}
                </td>
                <td>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleCopy(row.sequence, idx)}
                    style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}
                  >
                    {copiedIdx === idx ? <Check size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />}
                    <span>{copiedIdx === idx ? "Copied" : "Copy"}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* In-Silico PCR Agarose Gel Simulator */}
      <details className="card" style={{ marginTop: "1rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-main)", userSelect: "none" }}>
          Optional: In-Silico PCR &amp; Agarose Gel Simulator
        </summary>
        <div style={{ marginTop: "1rem" }}>
          <GelSimulator designResult={currentProject?.designResult} currentProject={currentProject} />
        </div>
      </details>
    </div>
  );
}
