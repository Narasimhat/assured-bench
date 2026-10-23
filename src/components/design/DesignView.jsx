import React, { useState } from "react";
import { runDesign, summarizeProcurementReadiness } from "../../engine/design/designEngine.js";
import { buildDesignSchemeSvg, buildDesignSchemeCaption } from "../../engine/design/designScheme.js";
import { fetchGeneGenbank } from "../../services/ensembl.js";
import { downloadReportHtml, downloadDesignJson, downloadSchemeSvg } from "../../services/designExport.js";
import { GuideAlternatives } from "./GuideAlternatives.jsx";
import { GelSimulator } from "./GelSimulator.jsx";
import { Search, Play, CheckCircle, AlertTriangle, XCircle, ArrowRight, Upload, Download, FileText, FlaskConical } from "lucide-react";

export function DesignView({ currentProject, onUpdateProject, onProceedToOrder, onProceedToQc, onOpenProtocol }) {
  const geneInput = currentProject.gene ?? "";
  const editType = currentProject.editType ?? "ko";
  const mutation = currentProject.mutation ?? "";
  const tag = currentProject.tag ?? "FLAG";
  const homologyArmLength = currentProject.homologyArmLength ?? 400;
  const deliveryMethod = currentProject.options?.deliveryMethod ?? "rnp";
  const maxBlockingChanges = currentProject.options?.maxBlockingChanges ?? 3;
  const coDelivery = currentProject.options?.coDeliveryBlocking ?? currentProject.options?.coDelivery ?? false;
  const geneMeta = currentProject.geneMeta ?? null;
  const genbankRaw = currentProject.genbankRaw ?? "";
  const setGeneInput = gene => onUpdateProject({ gene, geneMeta: null, genbankRaw: "" });
  const setEditType = editType => onUpdateProject({ editType });
  const setMutation = mutation => onUpdateProject({ mutation });
  const setTag = tag => onUpdateProject({ tag });
  const setOption = fields => onUpdateProject({ options: { ...currentProject.options, ...fields } });
  const [isLoadingGene, setIsLoadingGene] = useState(false);
  const [isDesigning, setIsDesigning] = useState(false);
  const [error, setError] = useState(null);

  // Active design result
  const designResult = currentProject?.designResult || null;

  // Ensembl Automated Fetch
  const handleFetchEnsembl = async () => {
    if (!geneInput.trim()) return;
    setIsLoadingGene(true);
    setError(null);
    try {
      const meta = await fetchGeneGenbank(geneInput.trim());
      onUpdateProject({
        gene: meta.geneSymbol,
        geneMeta: meta,
        genbankRaw: meta.genbankText
      });
    } catch (err) {
      setError(err.message || "Failed to fetch gene data from Ensembl.");
    } finally {
      setIsLoadingGene(false);
    }
  };

  // Upload local GenBank file
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const meta = {
        geneSymbol: file.name.replace(/\.[^/.]+$/, ""),
        source: "Manual file upload",
        genbankText: text
      };
      onUpdateProject({ gene: meta.geneSymbol, geneMeta: meta, genbankRaw: text });
    };
    reader.readAsText(file);
  };

  // Generate design
  const handleRunDesign = async () => {
    if (!genbankRaw) {
      setError("Please fetch a gene from Ensembl or upload a GenBank reference file first.");
      return;
    }
    setIsDesigning(true);
    setError(null);
    try {
      const options = {
        deliveryMethod,
        maxBlockingChanges: Number(maxBlockingChanges),
        coDeliveryBlocking: coDelivery,
        expectedGene: geneMeta?.geneSymbol || geneInput.trim(),
        ensureGuidePair: true,
        allowNonCodingBlockers: true
      };

      const result = runDesign(
        editType,
        genbankRaw,
        mutation,
        tag,
        Number(homologyArmLength),
        options
      );

      if (result.err) throw new Error(result.err);
      result.procurement = summarizeProcurementReadiness(result);
      const svgScheme = buildDesignSchemeSvg(result);
      const caption = buildDesignSchemeCaption(result);

      const updated = {
        gene: geneMeta?.geneSymbol || geneInput.trim(),
        editType,
        mutation,
        tag,
        homologyArmLength,
        options,
        genbankRaw,
        designResult: result,
        svgScheme,
        caption,
        status: result.procurement?.status || "review"
      };

      onUpdateProject(updated);
    } catch (err) {
      setError("Design calculation failed: " + (err.message || String(err)));
    } finally {
      setIsDesigning(false);
    }
  };

  const getStatusBadge = (status) => {
    if (status === "ready") {
      return <span className="badge badge-ready"><CheckCircle size={14} /> READY FOR PROCUREMENT</span>;
    } else if (status === "review") {
      return <span className="badge badge-review"><AlertTriangle size={14} /> REVIEW REQUIRED</span>;
    }
    return <span className="badge badge-blocked"><XCircle size={14} /> BLOCKED</span>;
  };

  return (
    <div>
      {/* Parameter Input Card */}
      <div className="card">
        <div className="card-title">
          <span>1. Design your edit</span>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal" }}>
            Choose a target, load its reference, then generate a design.
          </span>
        </div>

        <div className="grid-2">
          {/* Target Gene Entry */}
          <div>
            <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
              Target Gene Symbol or Ensembl ID
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={geneInput}
                disabled={isLoadingGene}
                aria-label="Target gene"
                onChange={(e) => setGeneInput(e.target.value.toUpperCase())}
                placeholder="e.g. SCN5A, APOE, TP53"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleFetchEnsembl}
                disabled={isLoadingGene || !geneInput.trim()}
              >
                <Search size={16} />
                <span>{isLoadingGene ? "Fetching..." : "Fetch Gene"}</span>
              </button>
            </div>

            {geneMeta && (
              <p style={{ fontSize: "0.8rem", color: "var(--success)", marginTop: "0.4rem" }}>
                ✓ Loaded: <strong>{geneMeta.geneSymbol}</strong> ({geneMeta.transcriptId || "Custom Reference"})
              </p>
            )}
          </div>

          {/* Fallback Upload */}
          <div>
            <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
              Or Upload GenBank Record (.gb / .gbk)
            </label>
            <label className="btn btn-secondary" style={{ width: "100%", justifyContent: "center", cursor: "pointer" }}>
              <Upload size={16} />
              <span>Browse Local Reference File</span>
              <input type="file" accept=".gb,.gbk,.txt" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
          </div>
        </div>

        {geneMeta?.warning && <p role="status" style={{ marginTop: "0.75rem", color: "var(--warning)" }}>{geneMeta.warning} <a href={geneMeta.sourceUrl} target="_blank" rel="noreferrer">Reference record</a></p>}

        {/* Edit Configuration */}
        <div className="grid-3" style={{ marginTop: "1.25rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
              Edit Type
            </label>
            <select value={editType} onChange={(e) => setEditType(e.target.value)} style={{ width: "100%" }}>
              <option value="ko">Knockout (KO Dual Guides)</option>
              <option value="pm">Point Mutation / SNP Knock-in</option>
              <option value="ct">C-Terminal Tag Knock-in</option>
              <option value="nt">N-Terminal Tag Knock-in</option>
              <option value="it">Internal Tag Knock-in</option>
            </select>
          </div>

          {editType === "pm" && (
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                Amino Acid Substitution
              </label>
              <input
                type="text"
                value={mutation}
                onChange={(e) => setMutation(e.target.value)}
                placeholder="e.g. R154S, E342K"
                style={{ width: "100%" }}
              />
            </div>
          )}

          {(editType === "ct" || editType === "nt" || editType === "it") && (
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                Tag Cassette
              </label>
              <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: "100%" }}>
                <option value="SD40-V5">SD40-V5 (Split-GFP & V5)</option>
                <option value="FLAG">FLAG (DYKDDDDK)</option>
                <option value="HA">HA (YPYDVPDYA)</option>
                <option value="Myc">Myc (EQKLISEEDL)</option>
                <option value="V5">V5 (GKPIPNPLLGLDST)</option>
                <option value="HiBiT">HiBiT (VSGWRLFKKIS)</option>
                <option value="mEGFP">mEGFP (Monomeric Enhanced GFP)</option>
              </select>
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
              Delivery Platform
            </label>
            <select value={deliveryMethod} onChange={(e) => setOption({ deliveryMethod: e.target.value })} style={{ width: "100%" }}>
              <option value="rnp">Synthetic sgRNA + Cas9 RNP (Cleanest)</option>
              <option value="u6">U6 Plasmid / Lentivirus</option>
            </select>
          </div>
        </div>

        {/* Advanced Options Bar */}
        <div style={{ display: "flex", gap: "2rem", marginTop: "1rem", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Max Silent Blocking Changes:</span>
            <select
              value={maxBlockingChanges}
              onChange={(e) => setOption({ maxBlockingChanges: Number(e.target.value) })}
              style={{ padding: "0.3rem 0.5rem", fontSize: "0.85rem" }}
            >
              <option value={1}>1 mutation</option>
              <option value={2}>2 mutations</option>
              <option value={3}>3 mutations (Recommended)</option>
            </select>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={coDelivery}
              onChange={(e) => setOption({ coDeliveryBlocking: e.target.checked })}
            />
            <span>Co-delivery mode (block all offered guides)</span>
          </label>

          <button
            className="btn btn-primary"
            onClick={handleRunDesign}
            disabled={isDesigning || isLoadingGene || !genbankRaw}
            style={{ marginLeft: "auto" }}
          >
            <Play size={16} />
            <span>{isDesigning ? "Computing Design..." : "Generate design"}</span>
          </button>
        </div>

        {!genbankRaw && <p style={{ marginTop: "1rem", color: "var(--text-muted)" }}>Fetch a gene or upload a GenBank reference to enable design.</p>}
        {error && (
          <div role="alert" style={{ marginTop: "1rem", padding: "0.75rem", borderRadius: "8px", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger)", fontSize: "0.9rem", fontWeight: 600 }}>
            {error}
          </div>
        )}
      </div>

      {/* Results Display */}
      {designResult && (
        <>
          {/* Release State Banner */}
          <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderColor: designResult.procurement?.status === "ready" ? "var(--success)" : "var(--warning)" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.3rem" }}>
                <span style={{ fontSize: "1.1rem", fontWeight: 700 }}>Design Status:</span>
                {getStatusBadge(designResult.procurement?.status || "review")}
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                {designResult.procurement?.status === "ready"
                  ? "Configured design gates passed. Complete the checks below before ordering."
                  : "External verification or review notes apply. Review candidate metrics below."}
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadReportHtml(currentProject, designResult)}
                title="Download full standalone interactive HTML report"
              >
                <FileText size={16} />
                <span>HTML Report</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => downloadDesignJson(currentProject, designResult)}
                title="Download machine-readable design specification JSON"
              >
                <Download size={16} />
                <span>Design JSON</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={onOpenProtocol}
                style={{ color: "var(--primary)", borderColor: "rgba(2, 132, 199, 0.4)", fontWeight: 600 }}
                title="View wet-lab bench protocol and pipetting checklist"
              >
                <FlaskConical size={16} />
                <span>Bench Protocol</span>
              </button>

              <button className="btn btn-primary" onClick={onProceedToOrder}>
                <span>Proceed to Order</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          {(designResult.procurement?.blockers?.length > 0 || designResult.procurement?.warnings?.length > 0 || designResult.procurement?.standingRequirements?.length > 0) && (
            <div className="card">
              <h3>Before ordering</h3>
              <ul style={{ paddingLeft: "1.25rem" }}>
                {[...(designResult.procurement.blockers || []), ...(designResult.procurement.warnings || []), ...(designResult.procurement.standingRequirements || [])].map((note, i) => <li key={i}>{note}</li>)}
              </ul>
            </div>
          )}

          {/* Target Region SVG Schematic */}
          {currentProject?.svgScheme && (
            <div className="card">
              <div className="card-title">
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span>Target Locus Schematic</span>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal" }}>
                    Publication-ready vector layout
                  </span>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => downloadSchemeSvg(currentProject, currentProject.svgScheme)}
                  style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
                  title="Download standalone SVG vector graphic for publications or slides"
                >
                  <Download size={14} />
                  <span>Download SVG</span>
                </button>
              </div>
              <div
                style={{ overflowX: "auto", background: "#fff", padding: "1.5rem", borderRadius: "8px" }}
                dangerouslySetInnerHTML={{ __html: currentProject.svgScheme }}
              />
              {currentProject?.caption && (
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.75rem", fontStyle: "italic" }}>
                  {currentProject.caption}
                </p>
              )}
            </div>
          )}

          {/* Guides and Donors Cards */}
          <div className="grid-2">
            {/* Guide RNA Card */}
            <div className="card">
              <div className="card-title">
                <span>Selected Guide RNAs (20 nt Protospacer)</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Guide Name</th>
                    <th>Spacer (5' → 3')</th>
                    <th>PAM</th>
                    <th>GC %</th>
                    <th>Cut distance</th>
                    <th>Protection</th>
                  </tr>
                </thead>
                <tbody>
                  {(designResult.guides || designResult.gs || []).map((g, idx) => (
                    <tr key={idx}>
                      <td><strong>{idx === 0 ? "Primary" : "Selected alternative"} gRNA {idx + 1}</strong></td>
                      <td className="mono" style={{ color: "var(--primary)" }}>{g.spacer || g.sp || g.sequence || g.seq}</td>
                      <td className="mono" style={{ color: "var(--warning)" }}>{g.pam || g.pm || "Not assessed"}</td>
                      <td>{g.gc ?? "—"}%</td>
                      <td>{Number.isFinite(g.d) ? `${Math.abs(g.d)} bp ${g.d < 0 ? "upstream" : g.d > 0 ? "downstream" : "at insertion"}` : "Not assessed"}</td>
                      <td>
                        <span title={designResult.guideProtection?.[idx]?.reason || ""}>
                          {designResult.guideProtection?.[idx]?.tier || (Number.isFinite(g.cfdResidual) ? `CFD ${g.cfdResidual.toFixed(4)}` : "Not assessed")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Donor Repair Template Card */}
            <div className="card">
              <div className="card-title">
                <span>Donor Repair Template (ssODN)</span>
              </div>
              {(() => {
                const donor = designResult.donors?.[0] || designResult.os?.[0] || designResult.donor || designResult.ssodn;
                const seq = typeof donor === "string" ? donor : (donor?.od || donor?.sequence || donor?.genomicDonor || donor?.donorSense);
                if (seq) {
                  return (
                    <div>
                      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                        Strand matches guide PAM-bearing strand to prevent re-cleavage:
                      </p>
                      <div
                        className="mono"
                        style={{
                          background: "var(--bg-app)",
                          padding: "0.85rem",
                          borderRadius: "8px",
                          wordBreak: "break-all",
                          fontSize: "0.85rem",
                          lineHeight: "1.6",
                          border: "1px solid var(--border-color)"
                        }}
                      >
                        {seq}
                      </div>
                      <div style={{ marginTop: "0.75rem", display: "flex", gap: "1.5rem", fontSize: "0.85rem" }}>
                        <span>Length: <strong>{seq.length} nt</strong></span>
                        <span>Format: <strong>Single-Stranded Oligo (ssODN)</strong></span>
                      </div>
                    </div>
                  );
                }
                return <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No donor required for pure dual-guide knockout.</p>;
              })()}
            </div>
          </div>

          {designResult.guideAlternatives && (
            <details className="card" style={{ marginTop: "1rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-main)", userSelect: "none" }}>
                Advanced: Guide Alternatives &amp; Off-Target Rankings
              </summary>
              <div style={{ marginTop: "1rem" }}>
                <GuideAlternatives result={designResult} />
              </div>
            </details>
          )}

          {/* In-Silico PCR Agarose Gel Simulator */}
          <details className="card" style={{ marginTop: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-main)", userSelect: "none" }}>
              Advanced: In-Silico PCR &amp; Agarose Gel Simulator
            </summary>
            <div style={{ marginTop: "1rem" }}>
              <GelSimulator designResult={designResult} currentProject={currentProject} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
