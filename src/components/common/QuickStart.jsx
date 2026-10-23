import React from "react";

const steps = [
  { id: "design", title: "Design", text: "Choose your gene and edit, fetch or upload a GenBank reference, then generate and review the design." },
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
        <h3 id="design-example-heading">Design example · TP53 C-terminal FLAG</h3>
        <ol>
          <li>Load the example to fill in <strong>TP53</strong>, <strong>C-Terminal Tag Knock-in</strong>, and <strong>FLAG</strong>, with a bundled GenBank reference.</li>
          <li>Click <strong>Generate design</strong>. Review the primary guide, alternatives, donor, primers, and schematic.</li>
          <li>Open <strong>Order</strong> to review the order sheet, or download the HTML report.</li>
        </ol>
        <p>The button saves your current experiment in Projects, then starts a separate example. No gene lookup is needed.</p>
        <button type="button" className="btn btn-secondary" onClick={onDesignExample} disabled={isLoadingExample}>
          {isLoadingExample ? "Loading example…" : "Load TP53 FLAG example"}
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
