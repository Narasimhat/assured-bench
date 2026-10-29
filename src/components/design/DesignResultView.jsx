import React, { useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import { buildDesignSchemeSvg } from "../../engine/design/designScheme.js";
import { buildTakeHome } from "../../services/takeHome.js";
import { generateReportHtml, downloadReportHtml, downloadDesignJson, downloadSchemeSvg, downloadCasOffinderInput, downloadSupplementaryFasta } from "../../services/designExport.js";
import { DesignResult } from "./DesignResult.jsx";
import { KoGuidePicker } from "./KoGuidePicker.jsx";
import { GuideAlternatives } from "./GuideAlternatives.jsx";
import { PmCandidatePicker } from "./PmCandidatePicker.jsx";
import { WorkflowAgent } from "./WorkflowAgent.jsx";
import { RegulatoryContextPanel } from "./RegulatoryContextPanel.jsx";
import { AlphaGenomeAlleleReview } from "./AlphaGenomeAlleleReview.jsx";
import { AlphaGenomeReview } from "./AlphaGenomeReview.jsx";
import "./designResult.css";
import { DonorCandidateComparison } from "./DonorCandidateComparison.jsx";

function ScientificReport({ project, result }) {
  const frame = useRef(null);
  const [printError, setPrintError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const html = useMemo(() => generateReportHtml(project, result), [project, result]);
  const printReport = () => {
    setPrintError("");
    try {
      if (!frame.current?.contentWindow) throw new Error("The report is still loading.");
      frame.current.contentWindow.focus();
      frame.current.contentWindow.print();
    } catch {
      setPrintError("Printing is unavailable in this browser. Download the HTML report, open it in a browser, and choose Print to save a PDF.");
    }
  };
  return <section aria-label="Scientific report" className="scientific-report-view">
    <div className="report-toolbar">
      <div><h2>Scientific design report</h2><p>A complete computational manuscript with figures, methods and supplementary data.</p></div>
      <div className="report-actions">
        <button className="btn btn-primary" disabled={!loaded} onClick={printReport}><Printer size={16} />Print / save PDF</button>
        <button className="btn btn-secondary" onClick={() => downloadReportHtml(project, result)}><FileText size={16} />Download HTML</button>
      </div>
    </div>
    <div className="report-downloads" aria-label="Supplementary downloads">
      <span>Supplementary files</span>
      <button className="btn btn-secondary" onClick={() => downloadSupplementaryFasta(project, result)}>Sequences (FASTA)</button>
      <button className="btn btn-secondary" onClick={() => downloadSchemeSvg(project)}>Figure (SVG)</button>
      <button className="btn btn-secondary" onClick={() => downloadDesignJson(project, result)}>QC design (JSON)</button>
    </div>
    <p className="report-print-help">The PDF uses the same manuscript and figures. Choose “Save as PDF” in your browser’s print dialog.</p>
    {printError && <p role="alert">{printError}</p>}
    <iframe ref={frame} title="ASSURED scientific design report" srcDoc={html} onLoad={() => setLoaded(true)} sandbox="allow-same-origin allow-modals" className="scientific-report-frame" />
  </section>;
}

export function DesignResultView({ project, reagents, busy, onProceedToOrder, onUpdateProject, onUsePair, onUseRecommended, onSelectAlternative, onUseCandidate, onEditSettings }) {
  const result = project.designResult;
  const [page, setPage] = useState("design");
  const [exportError, setExportError] = useState("");
  const takeHome = buildTakeHome({ designResult: result, biomniReport: project.biomniReport });
  const scheme = useMemo(() => buildDesignSchemeSvg(result, { responsive: true }), [result]);
  const supportsDonorComparison = (result.type === "pm" && (!project.options?.enzyme || project.options.enzyme === "spcas9")) || (result.type === "genomic-snv" && (!result.enzyme || result.enzyme.id === "spcas9"));
  const hasPmCandidates = result.type === "pm" && supportsDonorComparison && Boolean(result.an && result.wA && result.mA && project.genbankRaw);
  const substitution = ["pm", "genomic-snv"].includes(result.type);
  const structural = ["ko", "ct", "nt", "it"].includes(result.type);
  const canCompare = substitution || structural || Boolean(result.guideAlternatives?.candidates?.length);
  const openPage = next => { setPage(next); setExportError(""); };
  const exportOffTargets = () => {
    const exported = downloadCasOffinderInput(project, result);
    if (!exported.ok) setExportError(exported.error);
  };
  return <div className="design-product">
    <nav className="design-result-nav" aria-label="Design results">
      {[["design", "Selected design"], ["report", "Scientific report"], ...(canCompare ? [["guides", "Compare alternatives"]] : []), ["evidence", "Analysis & evidence"]].map(([id, label]) => <button key={id} type="button" aria-current={page === id ? "page" : undefined} onClick={() => openPage(id)}>{label}</button>)}
    </nav>
    <div hidden={page !== "design" && page !== "guides"} aria-label="Design and review workflow">
      {substitution && <DonorCandidateComparison key={project.id} project={project} onUpdateProject={onUpdateProject} busy={busy} expanded={page === "guides"} selectedOnly={!supportsDonorComparison} />}
      {structural && <AlphaGenomeAlleleReview key={project.id} project={project} onUpdateProject={onUpdateProject} workflow busy={busy} expanded={page === "guides"} />}
    </div>
    {page === "design" && <>
      <DesignResult currentProject={project} designResult={result} takeHome={takeHome} reagents={reagents} onProceedToOrder={onProceedToOrder} onEditDesign={onEditSettings} onDownloadReport={() => openPage("report")} onDownloadOffTarget={exportOffTargets} />
      {exportError && <p role="alert">{exportError}</p>}

      {scheme && <figure className="card product-scheme"><div dangerouslySetInnerHTML={{ __html: scheme }} /><figcaption>Selected edit and screening scheme. Computational design; experimental validation is pending.</figcaption></figure>}
    </>}
    {page === "report" && <ScientificReport project={project} result={result} />}
    {page === "guides" && hasPmCandidates && <details className="card"><summary>Additional comparison methods: local helper and null comparison</summary><PmCandidatePicker project={project} result={result} busy={busy} onUseCandidate={onUseCandidate} /></details>}
    {page === "guides" && !substitution && <details className="card"><summary>Manual guide alternatives</summary><section aria-label="Alternative guides"><h2>Compare alternative guides</h2><p className="muted">Review alternatives before replacing the selected design. Applying a pair runs the analysis again.</p>
      {result.type === "ko" && !result.koPicker?.rows?.length && <p>Guide list not available for this design. {result.koPickerError ? `It could not be built (${result.koPickerError}).` : "Edit the design and click Generate design to list and choose guides."}</p>}
      {result.koPicker?.rows?.length > 0 && <KoGuidePicker result={result} genbankRaw={project.genbankRaw} geneSymbol={result.gene || project.gene} busy={busy} onUsePair={onUsePair} onUseRecommended={onUseRecommended} />}
      {result.guideAlternatives?.candidates?.length > 0 && <GuideAlternatives result={result} onSelectAlternative={onSelectAlternative} />}
    </section></details>}
    {page === "evidence" && <section aria-label="Analysis and evidence"><div className="card"><h2>Analysis &amp; evidence</h2><p className="muted">Review runs from the selected-design page. Inspect supporting sources and study settings here.</p><button className="btn btn-primary" onClick={() => openPage("design")}>Open design and review</button><button className="btn btn-secondary" onClick={() => openPage("report")}><FileText size={16} />Open scientific report</button></div><RegulatoryContextPanel project={project} onUpdateProject={onUpdateProject} /><WorkflowAgent project={project} onUpdateProject={onUpdateProject} />{substitution && <details className="card"><summary>Advanced · individual SNP export and import</summary><AlphaGenomeReview key={project.id} project={project} onReviewDesigns={() => openPage("design")} /></details>}</section>}
    {page !== "design" && <button className="btn btn-secondary return-to-design" onClick={() => openPage("design")}><ArrowLeft size={16} />Return to selected design</button>}
  </div>;
}
