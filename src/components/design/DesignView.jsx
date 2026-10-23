import React, { useMemo, useState } from "react";
import { CASSETTES, INTERNAL_TAGS, runDesign, summarizeProcurementReadiness } from "../../engine/design/designEngine.js";
import { buildDesignSchemeSvg, buildDesignSchemeCaption } from "../../engine/design/designScheme.js";
import { fetchGeneGenbank } from "../../services/ensembl.js";
import { downloadReportHtml, downloadDesignJson, downloadSchemeSvg } from "../../services/designExport.js";
import { GuideAlternatives } from "./GuideAlternatives.jsx";
import { GelSimulator } from "./GelSimulator.jsx";
import {
  Search,
  Play,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Upload,
  Download,
  FileText,
  FlaskConical,
  Copy,
  Check,
  Sparkles,
  Shield
} from "lucide-react";

// Cassette menus mirror ASSURED CRISPR Designer so Bench emits the same inserts.
const CT_TAG_OPTIONS = [
  "FLAG",
  "dTAG-V5",
  "dTAG-HA",
  "SD40-V5",
  "SD40-HA",
  "SD40-GGGGS-V5",
  "GGGGS3-SD40-GGGGS-V5",
  "miniIAA7-V5",
  "miniIAA7-HA",
  "2xHA-only",
  "SD40-2xHA",
  "dTAG-2xHA",
  "mAID-2xHA",
  "T2A-EGFP",
  "T2A-mScarlet_I3",
  "T2A-mStayGold2",
  "P2A-mCherry",
  "P2A-mScarlet",
  "P2A-mStayGold2",
  "SD40-2xHA-P2A-mCherry",
  "dTAG-2xHA-P2A-mCherry",
  "mAID-2xHA-P2A-mCherry",
  "dTAG-V5-P2A-BlastiR",
  "dTAG-V5-P2A-HygroR",
  "SD40-V5-P2A-BlastiR",
  "SD40-V5-P2A-HygroR",
];

const NT_TAG_OPTIONS = [
  "FLAG",
  "N:EGFP-Linker",
  "N:mStayGold2-Linker",
  "N:dTAG-V5",
  "N:dTAG-HA",
  "N:SD40-V5",
  "N:SD40-HA",
  "N:miniIAA7-V5",
  "N:miniIAA7-HA",
  "N:SD40-Linker",
  "N:dTAG-Linker",
  "N:mAID-Linker",
  "N:2xHA-dTAG-Linker",
  "T2A-EGFP",
  "T2A-mScarlet_I3",
  "T2A-mStayGold2",
  "P2A-mCherry",
  "P2A-mScarlet",
  "P2A-mStayGold2",
  "N:dTAG-V5-P2A-BlastiR",
  "N:dTAG-V5-P2A-HygroR",
  "N:SD40-V5-P2A-BlastiR",
  "N:SD40-V5-P2A-HygroR",
];

function availableTags(editType) {
  if (editType === "it") return Object.keys(INTERNAL_TAGS);
  const keys = editType === "nt" ? NT_TAG_OPTIONS : CT_TAG_OPTIONS;
  return keys.filter((key) => key === "FLAG" || CASSETTES[key] || INTERNAL_TAGS[key]);
}

function defaultTagFor(editType) {
  const options = availableTags(editType);
  if (editType === "it") return options[0] || "SPOT";
  if (editType === "nt") return options.includes("N:dTAG-V5") ? "N:dTAG-V5" : options[0] || "FLAG";
  return options.includes("dTAG-V5") ? "dTAG-V5" : options[0] || "FLAG";
}

export function DesignView({
  currentProject,
  onUpdateProject,
  onProceedToOrder,
  onProceedToQc,
  onOpenProtocol,
  onLoadPreset
}) {
  const geneInput = currentProject.gene ?? "";
  const editType = currentProject.editType ?? "ko";
  const mutation = currentProject.mutation ?? "";
  const tagOptions = useMemo(() => availableTags(editType), [editType]);
  const tag = tagOptions.includes(currentProject.tag) ? currentProject.tag : defaultTagFor(editType);
  const homologyArmLength = currentProject.homologyArmLength ?? 400;
  const deliveryMethod = currentProject.options?.deliveryMethod ?? "rnp";
  const maxBlockingChanges = currentProject.options?.maxBlockingChanges ?? 3;
  const coDelivery = currentProject.options?.coDeliveryBlocking ?? currentProject.options?.coDelivery ?? true;
  const acceptWeakProtection = currentProject.options?.acceptWeakProtection ?? false;
  const weakProtectionReason = currentProject.options?.weakProtectionReason ?? "";
  const acceptedBy = currentProject.options?.acceptedBy ?? "";
  const geneMeta = currentProject.geneMeta ?? null;
  const genbankRaw = currentProject.genbankRaw ?? "";
  const setGeneInput = gene => onUpdateProject({ gene, geneMeta: null, genbankRaw: "" });
  const setEditType = nextType => {
    const nextTag = availableTags(nextType).includes(currentProject.tag)
      ? currentProject.tag
      : defaultTagFor(nextType);
    onUpdateProject({ editType: nextType, tag: nextTag });
  };
  const setMutation = mutation => onUpdateProject({ mutation });
  const setTag = tag => onUpdateProject({ tag });
  const setHomologyArmLength = len => onUpdateProject({ homologyArmLength: len });
  const setOption = fields => onUpdateProject({ options: { ...currentProject.options, ...fields } });
  const [isLoadingGene, setIsLoadingGene] = useState(false);
  const [isDesigning, setIsDesigning] = useState(false);
  const [error, setError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  const handleCopy = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

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

  // Generate design (with optional customGuides override)
  const executeDesign = async (customGuides = null) => {
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
        acceptWeakProtection: !coDelivery && acceptWeakProtection,
        weakProtectionReason: !coDelivery && acceptWeakProtection ? weakProtectionReason : "",
        acceptedBy: !coDelivery && acceptWeakProtection ? acceptedBy : "",
        expectedGene: geneMeta?.geneSymbol || geneInput.trim(),
        ensureGuidePair: true,
        allowNonCodingBlockers: true,
        ...(customGuides ? { customGuides } : {})
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

  const handleRunDesign = () => executeDesign(null);

  const handleSelectAlternativeGuide = (spacer) => {
    if (!spacer) return;
    executeDesign([spacer]);
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
        <div className="card-title" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <span>1. Design your edit</span>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal", marginTop: "0.15rem" }}>
              Choose a target gene, load its genomic reference, or launch a validated preset below.
            </div>
          </div>

          {onLoadPreset && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                <Sparkles size={14} style={{ color: "var(--primary)" }} />
                Instant Presets:
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.65rem", fontSize: "0.78rem" }}
                onClick={() => onLoadPreset("tp53_flag")}
                title="Load TP53 C-terminal FLAG knock-in and auto-compute design"
              >
                TP53 C-term FLAG
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.65rem", fontSize: "0.78rem" }}
                onClick={() => onLoadPreset("tp53_pm")}
                title="Load TP53 R175H point mutation knock-in with silent PAM blocking"
              >
                TP53 R175H (SNP KI)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.65rem", fontSize: "0.78rem" }}
                onClick={() => onLoadPreset("tp53_ko")}
                title="Load TP53 dual-guide constitutive knockout"
              >
                TP53 Dual-Guide KO
              </button>
            </div>
          )}
        </div>

        <div className="grid-2">
          {/* Target Gene Entry */}
          <div>
            <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
              Gene symbol, ENST…, or NM_…
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={geneInput}
                disabled={isLoadingGene}
                aria-label="Target gene"
                onChange={(e) => setGeneInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter" && geneInput.trim()) handleFetchEnsembl(); }}
                placeholder="e.g. TP53, ENST00000269305, NM_000546.5"
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

        {geneMeta?.warning && <p role="status" style={{ marginTop: "0.75rem", color: "var(--warning)", fontSize: "0.85rem" }}>{geneMeta.warning} {geneMeta.sourceUrl && <a href={geneMeta.sourceUrl} target="_blank" rel="noreferrer">Reference record</a>}</p>}

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

          {(editType === "pm" || editType === "it") && (
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                {editType === "it" ? "Insertion Residue Position" : "Amino Acid Substitution"}
              </label>
              <input
                type="text"
                value={mutation}
                onChange={(e) => setMutation(e.target.value.toUpperCase())}
                placeholder={editType === "it" ? "e.g. P155" : "e.g. R175H, R154S, E342K"}
                style={{ width: "100%" }}
              />
            </div>
          )}

          {(editType === "ct" || editType === "nt" || editType === "it") && (
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 500, fontSize: "0.9rem" }}>
                {editType === "it" ? "Internal Tag" : "Tag Cassette"}
              </label>
              <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: "100%" }}>
                {tagOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}{INTERNAL_TAGS[option] ? ` (${INTERNAL_TAGS[option].len} bp)` : CASSETTES[option] ? ` (${CASSETTES[option].len || CASSETTES[option].seq?.length || "?"} bp)` : ""}
                  </option>
                ))}
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
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "1rem", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
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

          {(editType === "ct" || editType === "nt") && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Homology Arm (bp):</span>
              <select
                value={homologyArmLength}
                onChange={(e) => setHomologyArmLength(Number(e.target.value))}
                style={{ padding: "0.3rem 0.5rem", fontSize: "0.85rem" }}
              >
                <option value={60}>60 bp (ssODN Ultramer)</option>
                <option value={200}>200 bp (ssDNA / dsDNA)</option>
                <option value={400}>400 bp (Standard HDR Arm)</option>
              </select>
            </div>
          )}

          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer", maxWidth: "28rem" }}>
            <input
              type="checkbox"
              checked={coDelivery}
              onChange={(e) => setOption({
                coDeliveryBlocking: e.target.checked,
                ...(e.target.checked ? { acceptWeakProtection: false } : {})
              })}
              style={{ marginTop: "0.2rem" }}
            />
            <span>
              <strong>Co-transfect both guides and both ssODNs</strong>
              <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.78rem", lineHeight: 1.4 }}>
                Builds every donor to block every offered guide. On by default, matching ASSURED CRISPR Designer.
              </span>
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.85rem", cursor: coDelivery ? "not-allowed" : "pointer", maxWidth: "28rem", opacity: coDelivery ? 0.5 : 1 }}>
            <input
              type="checkbox"
              disabled={coDelivery}
              checked={!coDelivery && acceptWeakProtection}
              onChange={(e) => setOption({ acceptWeakProtection: e.target.checked })}
              style={{ marginTop: "0.2rem" }}
            />
            <span>
              <strong>Accept weak guide protection and order anyway</strong>
              <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.78rem", lineHeight: 1.4 }}>
                {coDelivery
                  ? "Not available with co-delivery. Order matched pairs separately instead."
                  : "Records a reviewed decision; the design never reads as ready."}
              </span>
            </span>
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

        {!coDelivery && acceptWeakProtection && (
          <div className="grid-2" style={{ marginTop: "0.85rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Weak-protection reason
              </label>
              <input
                type="text"
                value={weakProtectionReason}
                onChange={(e) => setOption({ weakProtectionReason: e.target.value })}
                placeholder="Why is weak protection acceptable for this order?"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Accepted by
              </label>
              <input
                type="text"
                value={acceptedBy}
                onChange={(e) => setOption({ acceptedBy: e.target.value })}
                placeholder="Reviewer initials or name"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}

        {!genbankRaw && <p style={{ marginTop: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>Fetch a gene, upload a GenBank reference, or click one of the Instant Presets above to enable design.</p>}
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
          <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", borderColor: designResult.procurement?.status === "ready" ? "var(--success)" : "var(--warning)" }}>
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
              <ul style={{ paddingLeft: "1.25rem", marginTop: "0.5rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                {[...(designResult.procurement.blockers || []), ...(designResult.procurement.warnings || []), ...(designResult.procurement.standingRequirements || [])].map((note, i) => <li key={i} style={{ marginBottom: "0.25rem" }}>{note}</li>)}
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
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Guide Name</th>
                      <th>Spacer (5&prime; &rarr; 3&prime;)</th>
                      <th>PAM</th>
                      <th>GC %</th>
                      <th>Cut distance</th>
                      <th>Protection</th>
                      <th>Copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(designResult.guides || designResult.gs || []).map((g, idx) => {
                      const seq = g.spacer || g.sp || g.sequence || g.seq;
                      return (
                        <tr key={idx}>
                          <td><strong>{g.n || `${idx === 0 ? "Primary" : "Selected alternative"} gRNA ${idx + 1}`}</strong></td>
                          <td className="mono" style={{ color: "var(--primary)", fontWeight: 600 }}>{seq}</td>
                          <td className="mono" style={{ color: "var(--warning)" }}>{g.pam || g.pm || "NGG"}</td>
                          <td>{g.gc ?? "\u2014"}%</td>
                          <td>{Number.isFinite(g.d) ? `${Math.abs(g.d)} bp ${g.d < 0 ? "upstream" : g.d > 0 ? "downstream" : "at insertion"}` : "Exonic cut"}</td>
                          <td>
                            <span title={designResult.guideProtection?.[idx]?.reason || ""}>
                              {designResult.guideProtection?.[idx]?.tier || (Number.isFinite(g.cfdResidual) ? `CFD ${g.cfdResidual.toFixed(4)}` : "Assessed")}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => handleCopy(seq, `g-${idx}`)}
                              style={{ padding: "0.25rem 0.55rem", fontSize: "0.75rem" }}
                            >
                              {copiedKey === `g-${idx}` ? <Check size={13} style={{ color: "var(--success)" }} /> : <Copy size={13} />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Silent PAM/Protospacer Blocking Substitutions Summary */}
              {designResult.ss && designResult.ss.length > 0 && (
                <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", borderRadius: "8px", background: "var(--success-bg)", border: "1px solid var(--success-border)", fontSize: "0.82rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, color: "var(--success)", marginBottom: "0.35rem" }}>
                    <Shield size={15} />
                    <span>Silent Re-Cut Blocking Substitutions ({designResult.ss.length})</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {designResult.ss.map((s, si) => (
                      <span
                        key={si}
                        className="mono"
                        style={{ background: "#ffffff", padding: "0.2rem 0.55rem", borderRadius: "5px", border: "1px solid var(--success-border)", color: "var(--text-main)", fontSize: "0.78rem" }}
                        title={s.blockingReason || "Synonymous blocking substitution prevents Cas9 re-cleavage after HDR"}
                      >
                        {s.ob || ""}&rarr;{s.nb || ""} {s.oc && s.nc ? `(${s.oc}\u2192${s.nc}, ${s.aa || "synonymous"})` : `pos ${s.gp ?? si + 1}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Donor Repair Template Card */}
            <div className="card">
              <div className="card-title">
                <span>Donor Repair Template (ssODN)</span>
                {(() => {
                  const donor = designResult.donors?.[0] || designResult.os?.[0] || designResult.donor || designResult.ssodn;
                  const seq = typeof donor === "string" ? donor : (donor?.od || donor?.sequence || donor?.genomicDonor || donor?.donorSense);
                  if (!seq) return null;
                  return (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleCopy(seq, "donor")}
                      style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }}
                    >
                      {copiedKey === "donor" ? <Check size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />}
                      <span>{copiedKey === "donor" ? "Copied Donor" : "Copy Donor"}</span>
                    </button>
                  );
                })()}
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
                          fontSize: "0.82rem",
                          lineHeight: "1.6",
                          border: "1px solid var(--border-color)",
                          maxHeight: "160px",
                          overflowY: "auto"
                        }}
                      >
                        {seq}
                      </div>
                      <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "1.25rem", fontSize: "0.85rem" }}>
                        <span>Length: <strong>{seq.length} nt</strong></span>
                        {designResult.h5l && designResult.h3l && (
                          <span>Homology Arms: <strong>5&prime; {designResult.h5l} nt / 3&prime; {designResult.h3l} nt</strong></span>
                        )}
                        <span>Format: <strong>{seq.length <= 200 ? "Single-Stranded Oligo (ssODN)" : "Long ssDNA / Megamer"}</strong></span>
                      </div>
                    </div>
                  );
                }
                return <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No donor required for pure dual-guide knockout.</p>;
              })()}
            </div>
          </div>

          {/* Flanking PCR & Sanger Sequencing Verification Primers Card */}
          {designResult.ps && designResult.ps.length > 0 && (
            <div className="card">
              <div className="card-title" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <span>Flanking PCR &amp; Sanger Sequencing Primers</span>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "normal", marginLeft: "0.75rem" }}>
                    {designResult.amp ? `Expected Amplicon: ${designResult.amp}` : "Outside homology arms to prevent episomal donor amplification"}
                  </span>
                </div>
                {designResult.primerStrategy && (
                  <span className="badge badge-ready" style={{ fontSize: "0.75rem" }}>
                    {designResult.primerStrategy}
                  </span>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Primer Name</th>
                      <th>Sequence (5&prime; &rarr; 3&prime;)</th>
                      <th>Length</th>
                      <th>Tm (&deg;C)</th>
                      <th>GC %</th>
                      <th>Copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {designResult.ps.map((p, idx) => (
                      <tr key={idx}>
                        <td><strong>{p.n || `Primer ${idx + 1}`}</strong></td>
                        <td className="mono" style={{ color: "var(--primary)", fontWeight: 600 }}>{p.s}</td>
                        <td>{p.s ? `${p.s.length} nt` : "\u2014"}</td>
                        <td>{p.tm ? `${p.tm}\u00B0C` : "\u2014"}</td>
                        <td>{p.gc ? `${p.gc}%` : "\u2014"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleCopy(p.s, `p-${idx}`)}
                            style={{ padding: "0.25rem 0.55rem", fontSize: "0.75rem" }}
                          >
                            {copiedKey === `p-${idx}` ? <Check size={13} style={{ color: "var(--success)" }} /> : <Copy size={13} />}
                            <span>{copiedKey === `p-${idx}` ? "Copied" : "Copy"}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {designResult.primerWarning && (
                <p style={{ marginTop: "0.6rem", fontSize: "0.82rem", color: "var(--warning)" }}>
                  Note: {designResult.primerWarning}
                </p>
              )}
            </div>
          )}

          {designResult.guideAlternatives && (
            <details className="card" style={{ marginTop: "1rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-main)", userSelect: "none" }}>
                Advanced: Guide Alternatives &amp; Off-Target Rankings ({designResult.guideAlternatives.candidates?.length || 0} nearby candidates)
              </summary>
              <div style={{ marginTop: "1rem" }}>
                <GuideAlternatives
                  result={designResult}
                  onSelectAlternative={handleSelectAlternativeGuide}
                />
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
