import React from "react";

const steps = [
  { id: "design", title: "Design", text: "Use the embedded ASSURED CRISPR Designer workspace: parse requests or load a demo, generate designs, then continue to Order." },
  { id: "order", title: "Plan reagents", text: "Review guides, donor, and primers, complete the listed checks, and export your reagent sheet." },
  { id: "qc", title: "Trace Analysis", text: "Upload the parental control and edited AB1 traces, check the detected control and clone counts, then click Analyse." },
  { id: "decision", title: "Reports", text: "Inspect QC results and candidate reasons, compare clones, and download the screening CSV." },
];

export function QuickStart({ onNavigate, onDesignExample, isLoadingExample }) {
  return (
    <details className="quick-start card">
      <summary>Quick start · How to use ASSURED Bench</summary>
      <ol className="quick-start-steps" aria-label="Bench workflow">
        {steps.map((step, index) => (
          <li key={step.id}>
            <span className="quick-start-number" aria-hidden="true">{index + 1}</span>
            <h3><button type="button" onClick={() => onNavigate(step.id)}>{step.title}</button></h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
      <section className="quick-start-example" aria-labelledby="design-example-heading">
        <h3 id="design-example-heading">Design · ASSURED CRISPR Designer</h3>
        <ol>
          <li>Open <strong>Design</strong> and click <strong>Load demo requests</strong> (or paste your own edit requests).</li>
          <li>Fetch or upload a GenBank reference for each row, then generate the design and review the report.</li>
          <li>The selected design is handed to Bench automatically — open <strong>Order</strong> or <strong>Trace Analysis</strong>.</li>
        </ol>
        <p>Optional: load a bundled TP53 FLAG knock-in into the Bench project for Order/QC without using the designer workspace.</p>
        <button type="button" className="btn btn-secondary" onClick={onDesignExample} disabled={isLoadingExample}>
          {isLoadingExample ? "Loading example…" : "Load TP53 FLAG Bench preset"}
        </button>
        <button type="button" className="btn btn-primary" style={{ marginLeft: "0.5rem" }} onClick={() => onNavigate("design")}>
          Open Designer
        </button>
      </section>
      <div className="quick-start-paths">
        <section aria-labelledby="practice-heading">
          <h3 id="practice-heading">Try sample data</h3>
          <p>Start a new experiment, open Trace Analysis, download the <strong>practice ZIP</strong>, and load it with <strong>Add files</strong>. Review pairings and run analysis, then open Reports to compare and select clones. The APOE trace benchmark includes its own design reference and is separate from the TP53 design example.</p>
          <button className="btn btn-secondary" type="button" onClick={() => onNavigate("qc")}>Open Trace Analysis</button>
        </section>
        <section aria-labelledby="experiment-heading">
          <h3 id="experiment-heading">Use your own experiment</h3>
          <p>Work through the steps in order. When your edit is designed, click <strong>Save</strong> (or <strong>Export</strong> for a portable lab backup) to preserve your experiment during the 2–3 week wet-lab cycle.</p>
          <p>When your sequencing traces arrive, open <strong>Projects</strong>, select your experiment, and Bench will automatically carry your design into <strong>Trace Analysis</strong>—simply upload your <code>.ab1</code> clone traces and matching parental control. You can repeat analysis across multiple clone batches or plates anytime.</p>
        </section>
      </div>
    </details>
  );
}
