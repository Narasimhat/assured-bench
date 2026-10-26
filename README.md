# ASSURED Bench

> **Unified In-Silico CRISPR Design & Sanger Trace QC Workbench for Genome Engineering Scientists**

ASSURED Bench is a streamlined, client-side web application built for researchers designing, executing, and analyzing precision CRISPR edits in human cells (stem cells, iPSCs, primary cells, and cell lines).

---

## 4-Step Production Pipeline

```
Project Setup (Header) ──► 1. Design ──► 2. Order ──► 3. Trace Analysis ──► 4. Reports
```

1. **Step 1: Design & Reagents**
   - Direct target gene lookup via Ensembl REST API or local GenBank (`.gb` / `.gbk`) file upload.
   - Enzyme selection: SpCas9, AsCas12a, LbCas12a and Mad7 (names only in the dropdown).
   - Shared guide selection, matched donors, primers, reports and QC exports across enzymes.
   - Dual-guide knockouts (KO) with microdeletion prediction.
   - Point mutation / SNP corrections with silent PAM/protospacer blocking mutations (CFD penalty-minimizing).
   - Epitope and fluorescent tag knock-ins (FLAG, HA, Myc, V5, HiBiT, mEGFP, SD40-V5).
   - In-frame donor design (ssODN) and publication-ready SVG locus schematics.
   - Optional collapsible diagnostics: Guide Alternatives and In-Silico PCR Agarose Gel Simulator.

2. **Step 2: Vendor Reagent Procurement**
   - Formats guide protospacers and donor templates for direct synthesis.
   - Vendor tabs for **Integrated DNA Technologies (IDT)** (Alt-R CRISPR system, Ultramer donor oligos) and **Synthego** (synthetic sgRNA).
   - One-click sequence clipboard copy and vendor order CSV export.

3. **Step 3: Sanger Trace QC Analysis**
   - Browser-side Sanger chromatogram deconvolution (`.ab1` / `.abi` format).
   - Automatic handoff of active gRNA, PAM, and donor sequences from Step 1.
   - Rapid dropzone for Parental Control and edited clone `.ab1` files.
   - Client-side Web Worker pool execution (100% private; sequencing data never leaves your device).

4. **Step 4: Clone Selection & Reports**
   - High-confidence clone verdicts: **Accept**, **Hold**, **Sequence again**, and **Reject**.
   - Quantitative deconvolution: HDR %, Indel %, Silent Blocking %, and Wild-Type %.
   - Publication-ready vector figures (editable SVG, vector PDF, and 300-dpi PNG).
   - Screening decision table and CSV export.

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (v9 or higher)

### Installation
```bash
# Clone the repository
git clone https://github.com/Narasimhat/assured-bench.git
cd assured-bench

# Install dependencies
npm install
```

### Development Server
```bash
npm run dev
```
Open [http://localhost:5180](http://localhost:5180) in your browser.

### Automated Tests
Run the complete unit and functional test suite:
```bash
npm test
```

### Production Build
Compile optimized static production bundles to `dist/`:
```bash
npm run build
npm run preview
```

---

## Architecture & Privacy

- **100% Client-Side**: All CRISPR guide scoring, CFD matrix calculations, Sanger ABIF parsing, and trace deconvolution run directly in the user's browser.
- **Data Privacy**: Traces, clone identities, and proprietary genetic sequences are never sent to external servers.
- **Local Persistence**: Save experiments securely in browser IndexedDB/localStorage, or export portable `.assured` project bundles.

---

## License

MIT License.

## Enzyme configuration and validation

The design engine is synchronized from Assured_CRISPR_Design PR #24 (commit
`e056daf8bce6f9f6406a235f5752e965ec0af7eb`), config version 1.1.0.
Cas9 remains the default. Cas12a/Mad7 use 5′ PAMs, configurable spacer lengths,
and predicted staggered cut boundaries. Knockouts use the shared two-guide policy;
point edits use the shared 10/20/30 bp search windows. All modification types use
the standard donors, primers, figures, HTML reports, ordering and QC handoff.

Cas12a/Mad7 activity scores and CFD are uncalibrated. Canonical-PAM removal is a
categorical check, not a numerical activity prediction. The UI and reports retain
review warnings. Full crRNA ordering requires a verified repeat and documentation;
otherwise vendor rows explicitly contain a spacer only. Vendor product compatibility
must be checked. Mad7 and LbCas12a repeats are not guessed. Nominal cut offsets,
licensed Mad7 documentation, reference-tool comparisons and real genome-wide
specificity runs still require validation. QC preserves both predicted strand cuts;
it does not establish experimental cutting or repair outcomes.

## Enzyme-aware trace analysis (QC 0.6.0)

The embedded trace analyser supports Mad7, AsCas12a and LbCas12a through the
standard design handoff, JSON/HTML imports or manual spacer entry. It models
indels throughout the staggered cut span, paired deletions and adaptive larger
events; alignment and figures use both strand boundaries and the configured PAM.
The same donor/partial-conversion, genotype, clone ranking and report pipeline is
used. Results and CSV retain enzyme/config/model/cut provenance. Unknown or
conflicting enzymes fail explicitly. Non-Cas9 designs cannot silently enter the
verified Cas9-only ICE template. These paths pass generated-signal/AB1 checks;
Cas12a/Mad7 laboratory calibration and enzyme-specific thresholds are unvalidated.

## Shared SNP donor policy

All enzymes now use the Cas9-style SNP donor policy: exactly 127 nt, asymmetric
36/91 cut-centered reference windows (with the same sequence-end handling), and
opposite-guide ordering. Stale tag format, arm-length or strand settings do not
change a SNP donor. Matched donors retain shared blockers for co-delivery where
feasible; otherwise the design falls back or flags the incompatible geometry.
Synonymous PAM disruption is preferred. If unavailable, synonymous PAM-proximal
seed changes are proposed with full protein/splice checks and an explicit
unscored-protection warning. Tag format/arm controls remain available for tags.

SNP donor policy 2 places the 91 nt flank toward the PAM and the 36 nt flank
on the opposite side of the nominal target-strand cut. This mirrors the reference
layout for 5′-PAM Cas12a/Mad7 while retaining Cas9's 3′-PAM behavior. The policy is
a computational design heuristic; enzyme-specific HDR and strand preferences
still require experimental validation.


### Additional Cas9 enzymes (config 1.2.0)

Designer, Bench and Hub include SpCas9-NG (3′ NG; 20 nt spacer), SaCas9 (3′ NNGRRT; 21 nt spacer), and SpRY (3′ NNN search envelope; 20 nt spacer). Their nominal coincident cuts are 3 nt before the PAM. The standard two-guide knockout, nearest-window edit selection, 127 nt SNP donor, protein-check, report, ordering and QC handoff workflows apply. No SpCas9 CFD calibration or guide library is reused for these enzymes.

SpRY is near-PAMless, not equally active at every PAM (NRN/NYN activity differs). NNN scanning includes both classes without assigning a quantitative activity prediction. PAM-only substitutions cannot block a site under this envelope; synonymous seed changes remain unscored and require review. SaCas9 needs its own guide scaffold. Cas9-family scaffolds are not emitted as a Cas12 direct repeat plus spacer.

QC accepts the named enzyme IDs from design exports automatically. Legacy manual QC spacer ranges remain supported; Designer currently fixes these Cas9 variants to their stated default spacer lengths. Generic Cas12a remains a legacy QC option; use AsCas12a or LbCas12a for new designs.

Sources: [SpCas9-NG, Nishimasu et al.](https://doi.org/10.1126/science.aas9129), [SaCas9, Ran et al.](https://doi.org/10.1038/nature14299), [SpRY, Walton et al.](https://doi.org/10.1126/science.aba8853).

### Workflow agent

In Bench's Design screen, fetch or upload a reference, choose the modification and fill its details, then use **Workflow agent → Compare enzymes and recommend**. Select the enzymes available in your lab and choose protection-first, closest-cut, or fewer-blocking-changes priority. The agent runs the existing design engine for each enzyme in a cancellable Web Worker, with no remote model calls. The full knockout, protein-substitution, internal-tag and terminal-tag tools supply the calculations.

Blocked or incomplete designs cannot be recommended. Configured release gates precede the chosen priority; exact ties remain ties, with alphabetical display only. Cut distance, computed guide–donor protection, documented blocking changes and primer checks explain the ranking. This is a rule-based decision agent, not a calibrated predictor of experimental efficiency. It does not compare base editing or prime editing in this version. Exact genomic SNPs are included after the variant is entered in the Genomic SNP tool and its design button is used; the agent can compare alternatives even when the initial enzyme has no guide. Missing genome-wide specificity or activity evidence stays unknown. SpRY PAM-only substitutions do not become blocking protection.

**Use [enzyme] design** adopts the computed result into the normal report, Order and QC path. The agent records its version, enzyme-config version, priority, compared/excluded enzymes, reference/input SHA-256, reasoning and limitations. Recommendation JSON and the applied design's HTML/QC JSON retain that record; saved Bench projects retain it too. Changing design inputs clears the recommendation and previous QC, and cancels a running comparison. Guide sequences, direct-repeat verification and prior weak-protection acknowledgements are not transferred between enzymes.

The next-step checklist explains donor/pair use and screening. Existing AssuredQC clone decisions and ranking remain the source for downstream clone selection; final clones still need independent confirmation. Comparison does not send orders, change delivery conditions, or choose an unsupported editing technology.

Workflow agent 1.1.0 also compares exact genomic SNPs using the existing forward/reverse-coordinate, allele, blocking-policy and nucleotide-assertion checks. Applied genomic options retain the standard report/ordering/QC handoff and recommendation evidence. A genomic variant edit cancels comparison and clears the captured request; returning to the tool restores the saved reference/variant. External splice-check results are not silently transferred to different blocker sets.

The Workflow agent starts compact. Open **Comparison settings** to restrict enzymes or change priorities, **Compare options and choose a design** to inspect candidates, and **Evidence, ranking details and export** for the audit. Applying a design collapses the agent and opens the full design report.


Workflow agent 1.2.0 loads the shared Lindel model lazily for SpCas9 knockout comparisons, so its selected guide pair matches the outcome-ranked standard Designer path. Other enzymes and HDR edits never receive the SpCas9 model. Recommendation reasons/audits record whether Lindel was applied or why the engine used its fallback; missing predictions remain unknown. Predicted loss-of-function allele shares are not cutting efficiency and are not compared as cross-enzyme performance scores. Stored model weights/failure messages are removed from agent requests, and a later comparison retries a failed model load.


Workflow agent 1.3.0 prioritizes functional knockout evidence for the complete two-guide plan: the worst assessed consequence of either guide acting alone and the deletion between them, followed by annotated-isoform coverage. A simple frameshift in the nominal deletion is a later tie-breaker. Stronger functional evidence cannot override a blocked design. SpCas9 guide pairs retain Lindel-based repair-outcome selection; uncalibrated cross-enzyme outcome frequencies are not invented. Final protein loss still needs experimental confirmation, and superiority over another tool requires a held-out benchmark.

Functional knockout selection ranks individual guides before coordinated pairs with strict 40–60% spacer GC. See [selection policy and limitations](docs/functional-knockout-selection.md).
