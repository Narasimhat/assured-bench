import React, { useState, useMemo } from "react";
import {
  generateIdtOrderRows,
  generateSynthegoOrderRows,
  exportOrderToCsv,
  formatBulkPasteTsv,
  formatOligosFasta
} from "../../services/vendorExport.js";
import { ShoppingCart, Copy, Download, Check, ArrowRight, ClipboardList } from "lucide-react";

export function OrderView({ currentProject, onProceedToQc }) {
  const [activeVendor, setActiveVendor] = useState("idt");
  const [filterType, setFilterType] = useState("all");
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [bulkCopied, setBulkCopied] = useState(null);

  const designPayload = currentProject?.designResult ? {
    input: { gene: currentProject.gene },
    result: currentProject.designResult
  } : null;

  const idtRows = useMemo(() => designPayload ? generateIdtOrderRows(designPayload) : [], [designPayload]);
  const synthegoRows = useMemo(() => designPayload ? generateSynthegoOrderRows(designPayload) : [], [designPayload]);
  const activeRows = activeVendor === "idt" ? idtRows : synthegoRows;

  const filteredRows = useMemo(() => {
    if (filterType === "all") return activeRows;
    return activeRows.filter(row => {
      const t = (row.itemType || row.product || "").toLowerCase();
      if (filterType === "guide") return t.includes("rna");
      if (filterType === "donor") return t.includes("donor") || t.includes("ssodn");
      if (filterType === "primer") return t.includes("primer");
      return true;
    });
  }, [activeRows, filterType]);

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleBulkCopy = (mode) => {
    const text = mode === "tsv" ? formatBulkPasteTsv(filteredRows) : formatOligosFasta(filteredRows);
    navigator.clipboard.writeText(text);
    setBulkCopied(mode);
    setTimeout(() => setBulkCopied(null), 2500);
  };

  const handleDownloadCsv = () => {
    exportOrderToCsv(filteredRows, `${(currentProject?.gene || "reagents")}_${activeVendor}_order.csv`);
  };

  if (!designPayload || idtRows.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
        <ShoppingCart size={40} style={{ color: "var(--text-dim)", margin: "0 auto 1rem" }} />
        <h3>No Design Computed Yet</h3>
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Please complete Step 1 (Design &amp; Reagents) first to generate order-ready guide RNAs, donors, and primers.
        </p>
      </div>
    );
  }

  const guideCount = (currentProject.designResult.gs || currentProject.designResult.guides || []).length;
  const donorList = currentProject.designResult.os?.length
    ? currentProject.designResult.os.map((d) => d.od || d.sequence || d.genomicDonor || "")
    : currentProject.designResult.donors?.length
      ? currentProject.designResult.donors.map((d) => typeof d === "string" ? d : (d.sequence || d.od || ""))
      : currentProject.designResult.donor
        ? [currentProject.designResult.donor]
        : [];
  const validDonors = donorList.filter(Boolean);
  const primerCount = (currentProject.designResult.ps || []).length;

  return (
    <div>
      <div className="card">
        <div className="card-title" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <ShoppingCart size={20} style={{ color: "var(--primary)" }} />
            <span>2. Vendor Cart &amp; Reagent Procurement</span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleBulkCopy("tsv")}
              title="Copy tab-separated Name, Sequence, Scale, and Purification for direct bulk paste into IDT or vendor order portals"
            >
              {bulkCopied === "tsv" ? <Check size={16} style={{ color: "var(--success)" }} /> : <ClipboardList size={16} />}
              <span>{bulkCopied === "tsv" ? "Copied Bulk TSV!" : "Copy Bulk Paste (TSV)"}</span>
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleBulkCopy("fasta")}
              title="Copy all sequences in FASTA format"
            >
              {bulkCopied === "fasta" ? <Check size={16} style={{ color: "var(--success)" }} /> : <Copy size={16} />}
              <span>{bulkCopied === "fasta" ? "Copied FASTA!" : "Copy FASTA"}</span>
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

        {/* Summary Readiness Strip */}
        <div className="grid-3" style={{ marginBottom: "1.25rem" }}>
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "#f0f6fc", border: "1px solid var(--border-color)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>CRISPR Guide RNAs</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-main)" }}>
              {guideCount} gRNA{guideCount === 1 ? "" : "s"} <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>(20 nt protospacers)</span>
            </div>
          </div>
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "#f0f6fc", border: "1px solid var(--border-color)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Repair Donor Template</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-main)" }}>
              {validDonors.length > 0
                ? `${validDonors.length} ssODN${validDonors.length === 1 ? "" : "s"} (${validDonors.map((d) => `${d.length} nt`).join(", ")})`
                : "None (Knockout / Excision)"}
            </div>
          </div>
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "#f0f6fc", border: "1px solid var(--border-color)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Flanking PCR &amp; Sanger Primers</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-main)" }}>
              {primerCount} Primers <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>{currentProject.designResult.amp ? `(${currentProject.designResult.amp})` : ""}</span>
            </div>
          </div>
        </div>

        {/* Vendor Selector & Category Filter Tabs */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.25rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className={`btn ${activeVendor === "idt" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveVendor("idt")}
            >
              Integrated DNA Technologies (IDT Alt-R)
            </button>
            <button
              className={`btn ${activeVendor === "synthego" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveVendor("synthego")}
            >
              Synthego (Modified Synthetic sgRNA + Oligos)
            </button>
          </div>

          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {[
              { id: "all", label: `All (${activeRows.length})` },
              { id: "guide", label: "Guides" },
              { id: "donor", label: "Donors" },
              { id: "primer", label: "Primers" }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`btn ${filterType === tab.id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setFilterType(tab.id)}
                style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reagent Table */}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Oligo / Reagent Name</th>
                <th>Type / Product</th>
                <th>Sequence (5&prime; &rarr; 3&prime;)</th>
                <th>Scale / Purification / Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => (
                <tr key={idx}>
                  <td><strong>{row.name}</strong></td>
                  <td>
                    <span className="badge badge-ready" style={{ marginBottom: "0.25rem" }}>{row.itemType || "Oligo"}</span>
                    <div style={{ fontSize: "0.8rem", color: "var(--primary)" }}>{row.product}</div>
                  </td>
                  <td className="mono" style={{ fontSize: "0.82rem", maxWidth: "440px", wordBreak: "break-all" }}>
                    {row.sequence}
                  </td>
                  <td style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    {row.scale && <div><strong>Scale:</strong> {row.scale} · <strong>Purification:</strong> {row.purification || "Standard"}</div>}
                    <div>{row.notes}</div>
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
      </div>
    </div>
  );
}
