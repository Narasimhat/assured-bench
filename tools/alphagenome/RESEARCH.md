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

1. **Blocker safety** — detect when silent PAM/seed changes add large splice/expression deltas beyond the intended edit.
2. **Tissue-matched reviews** — presets for common research lines (iPSC, hepatocyte, cardiomyocyte, T cell, etc.).
3. **Lower friction** — auto-fill GRCh38 mapping from annotated GenBank when available.
4. **Report attachment** — optional fold in the design HTML for research exports (still not a gate).
5. **Later** — tag/knock-in junction windows; donor A vs B comparison.

## How researchers use it today

1. Design a PM or genomic SNP in Bench (`main` design path).
2. Open **Advanced → AlphaGenome (research)**.
3. Confirm mapping, pick tissue preset or ontology ID, export request.
4. Run `tools/alphagenome/review.py --run` locally with a research API key.
5. Import the JSON and inspect the three comparisons.

Core design / order / QC on `main` stay authoritative. This branch only extends the optional research adapter.
