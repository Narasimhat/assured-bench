# AlphaGenome research branch

Branch: `cursor/alphagenome-research-c6a3`  
Purpose: **tissue-aware allele safety check** for ASSURED Bench substitution donors (research only).

## Product rule

**ASSURED designs; AlphaGenome stress-tests the allele.**

| ASSURED keeps | AlphaGenome adds |
|---|---|
| Guides, silent blockers, primers, Lindel, CFD, enzyme compare, QC | Expression / splicing deltas for intended vs intended+blockers in a selected cell context |
| READY / BLOCKED procurement | Watch lines and redesign hints only — never a release gate |
| Off-target / HDR / clone verdicts | Not in scope |

Hosted AlphaGenome access is currently **research / non-commercial**. API keys stay local (never browser / Vercel). Check DeepMind terms before any commercial use.

## Today’s hook (narrow, high-value)

One matched **PM / genomic SNP** donor on GRCh38:

1. Reference → intended edit (expected functional effect)
2. Reference → full donor allele
3. Intended → full donor (blocker-associated differences)

Outputs: RNA-seq, splice sites, splice-site usage.  
If blockers dominate the delta → take-home watch line + “try alternate silent set”. Donor A vs B layout compare stays in Bench; live export still runs one donor at a time.

```text
Generate PM/SNV design
  → ASSURED: guides, blockers, primers, release
  → AlphaGenome: intended vs full donor in target PSC / derivative context
  → If blockers look worse than intended → regenerate blockers / alternate donor
  → Take-home: one plain-language risk line
  → Order / QC unchanged
```

## Verified cell contexts (live metadata)

Exact biosamples present in AlphaGenome tracks (not generic iPSC):

| Ontology | Biosample | RNA-seq | DNase | ATAC | Splice usage | Notes |
|---|---|---|---|---|---|---|
| `EFO:0009747` | WTC11 | yes | yes | yes | yes | Default PSC preset |
| `EFO:0003042` | H1 | yes | yes | — | yes | hESC |
| `EFO:0003045` | H9 | yes | yes | — | yes | hESC |
| `CL:0000746` | Cardiac muscle cell | yes | yes | — | yes | Derivative |
| `CL:0000182` | Hepatocyte | yes | yes | — | yes | Derivative |
| `CL:0000679` | Glutamatergic neuron | yes | yes | — | yes | Derivative |

Absent from current tracks (do not preset): `EFO:0004905` (generic iPSC), `CL:0002322` (embryonic stem cell), `CL:0000057` (fibroblast).  
Each derivative needs an **exact match** or a clearly labelled proxy — no silent substitution of another ontology.

## Boundary

| In scope (research) | Out of scope |
|---|---|
| Human GRCh38 PM / genomic SNP donor review | Production READY gates |
| Intended vs full-donor (blocker) comparisons | Browser-held API keys |
| Exact PSC / derivative ontology presets | Commercial redistribution of AlphaGenome API |
| Local Python runner + import into Bench | Using track deltas as HDR/cut/off-target scores |
| Take-home watch from blocker vs intended peaks | Replacing Lindel / CFD / enzyme compare |
| Persist review JSON + design HTML fold | Knockout guide ranking |

## Research goals

1. **Done** — Auto-fill GRCh38 mapping from annotated GenBank (user still confirms).
2. **Done** — Exact PSC/derivative presets (WTC11 / H1 / H9 + cardiac / hepatocyte / neuron).
3. **Done** — Persist imported review + design HTML research fold.
4. **Done** — Donor A vs B blocker layout compare.
5. **Done** — Blocker-safety watch line in take-home when blockers dominate/notable vs intended.
6. **Later** — Tag/knock-in junction windows only; multi-tissue therapeutic panels; calibrated thresholds before any gating.

## How researchers use it

1. Design a PM or genomic SNP in Bench.
2. Open **Advanced → AlphaGenome (research) · allele safety check**.
3. Confirm mapping; pick an exact PSC/derivative context (default WTC11).
4. Export request → run `tools/alphagenome/review.py --run` locally → import JSON.
5. Read the blocker verdict; compare donor B if blockers dominate; take-home carries the risk line.

Core design / order / QC on `main` stay authoritative.
