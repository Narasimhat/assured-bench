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
