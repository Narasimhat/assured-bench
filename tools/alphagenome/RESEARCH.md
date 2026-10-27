# AlphaGenome research branch

Branch: `cursor/alphagenome-research-c6a3`  
Purpose: develop **research-only** donor functional review for ASSURED Bench.

## Boundary

| In scope (research) | Out of scope (do not mix into commercial release) |
|---|---|
| Human GRCh38 PM / genomic SNP donor review | Production release gates / READY status |
| Intended vs full-donor (blocker) comparisons | Browser-held API keys |
| Tissue/cell ontology presets for lab lines | Commercial redistribution of AlphaGenome API |
| Local Python runner + import into Bench | Using track deltas as HDR/cut scores |
| Optional persistence of review JSON on the project for research exports | Replacing Lindel / CFD / enzyme compare |

Hosted AlphaGenome access is offered by DeepMind for **non-commercial research**; check current terms before any wider use.

## Research goals (in order)

1. **Lower friction (done on this branch)** — auto-fill GRCh38 mapping from annotated GenBank when available (Assured Location lines, Ensembl `chrN start-end`, NC region DEFINITION). User still confirms before export; NG_ RefSeqGene records without coordinates are not invented.
2. **Tissue-matched reviews (done)** — presets for common research lines (iPSC, hepatocyte, cardiomyocyte, T cell, etc.).
3. **Report attachment** — optional fold in the design HTML for research exports (still not a gate).
4. **Donor A vs B** — compare blocker layouts for the same intended edit.
5. **Later** — tag/knock-in junction windows; blocker-safety watch lines in take-home.

## How researchers use it today

1. Design a PM or genomic SNP in Bench (`main` design path).
2. Open **Advanced → AlphaGenome (research)**.
3. Confirm mapping, pick tissue preset or ontology ID, export request.
4. Run `tools/alphagenome/review.py --run` locally with a research API key.
5. Import the JSON and inspect the three comparisons.

Core design / order / QC on `main` stay authoritative. This branch only extends the optional research adapter.
