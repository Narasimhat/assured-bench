# Unwanted changes in clones

Step 4 asks of every clone: *is this the edit that was designed, and nothing else?* This page says what is checked, how a flag becomes a decision, and what the checks cannot see. Everything is read from Sanger traces. A flag is a call from a trace, not a measurement of the genome; a predicted splice or expression effect is a model output, not an experimental result.

## What is flagged

| Flag | Raised when | Severity | Decision effect |
| --- | --- | --- | --- |
| `unplanned-base` | A base other than the control's carries at least 25 % of the signal at a position the design did not change, the fit does not predict it, and the control is clean there (35 % when the overall fit is poor). Every read is scanned on its own and the hits are merged on the forward strand. The scan covers the fitted stretch (25 bases before the first cut to 150 after the last) and, where the reads can be compared, the rest of the read. | `block` if it changes the protein and two reads show it; otherwise `review` | In a knock-in (SNP or small tag): protein-changing and confirmed in two reads → **reject**; protein-changing in one read → **sequence again** (from the other direction); any other unplanned base → an accepted clone is **held**. In a knockout or base-editing run an unplanned base only holds an accepted clone (a protein change is not unwanted there). |
| `many-differences` | More than two isolated positions differ from the control in a read. That is a rearranged or mixed read, a contaminated template or a poor trace, not single base changes. | `review` | An accepted clone is sent to **sequence again**. |
| `misaligned-stretch` | Three or more neighbouring positions differ (the two reads are out of register: a base call missed or added) or a lone difference has another right next to it. These are not read as base changes. | `review` inside the fitted stretch, `info` outside | An accepted clone is **held**. |
| `indel-at-cut` | In a knock-in run an indel allele (10 % or more) sits beside the intended edit. | `review` | None added (the genotype call already holds or rejects). |
| `blocking-only` | In a knock-in run 10 % or more of the alleles carry only part of the planned changes. | `review` | None added. |
| `reads-disagree` | The reads of one clone disagree about the edited share. | `review` | Already **sequence again**. |
| `low-fit` | The allele library explains less than 80 % of the difference from wild type. | `info` | None. |
| Splice review (optional) | SpliceAI's largest acceptor or donor change that the clone's unwanted edits add to the intended allele is above 0.05 (`review`) or above 0.2 (`block`: advice against). | `review` / `block` | None: shown in the table, report and CSV; the decision is not changed by a model prediction. |

Workflow matters: the flags that only make sense for a knock-in (`indel-at-cut`, `blocking-only`) are applied by the workflow the run used, not by the design file. A flagged clone also ranks behind the clean ones in the carry-forward panel, and a rejected or sequence-again clone is not in it.

## How a base is judged

A base seen in a read is **confirmed** when two reads show it, **discordant** when one read shows it and another read that covers the position shows the reference base (a read artefact is more likely), and **single** when only one read covers it. The protein effect comes from the reading frame the design gives (the codon notes of the design file), or from the gene record when one is loaded with the traces (which also knows exon boundaries). A design that names no codons gives the effect `unknown`: it is not guessed. The effect classes are synonymous, missense, nonsense, start loss, stop loss, splice site and noncoding. With a gene record the class follows the engine's own exon-aware coding assessment; without one it is read from the codon frame alone, which cannot know where an exon ends.

## Splice and expression review of the clone alleles

The design review predicts the planned edit. The clone review predicts what each clone was found to carry: the alleles the fit found (the intended edit as read, an indel allele), with the unplanned bases put on the allele that carries the intended edit (a trace cannot say which allele a heterozygous base is on, and the review says so). Distinct alleles are scored once and shared between the clones that carry them.

1. In Step 4, **Export SpliceAI request** (and, for AlphaGenome, choose the cell type and window and **Export AlphaGenome request**).
2. Run the tool on your computer: `python tools/spliceai/clone_splice_check.py request.json reference.gb -o result.json` (see `tools/spliceai/README.md`) and `python tools/alphagenome/clones.py request.json --run --output report.json` (see `tools/alphagenome/README.md`; your own API key, never entered in the browser).
3. **Import** the result. It is accepted only for the exact request it answers (a SHA-256 over the clones, alleles, coordinates, cell type and window); a result for earlier clones is shown as outdated and ignored.

SpliceAI is judged at the design review's thresholds (supports at or below 0.05, review at or below 0.2, advice against above), applied to the change the unwanted edits add to the intended allele, or to the allele as read when it has no unwanted edit. AlphaGenome deltas have assay-specific units and no calibrated threshold: they rank the clones and give no verdict. Neither predicts cutting efficiency, HDR yield, protein function or clone fitness.

## What these checks cannot see

- A change outside the sequenced stretch, a large deletion or rearrangement, or a base on the other allele hidden by a wild-type allele.
- A heterozygous base cannot be placed on one allele, and phase between bases is unknown.
- Reads with a noisy start or tail: positions near the ends are not compared, and a difference without agreeing neighbours is not called.
- A parental difference from the design reference is patched into the reference when it is in the control, so it is not an edit.
- Off-target edits anywhere else in the genome. Whole-genome sequencing is the check for that.
- Predicted effects depend on the reference the review is run on; SpliceAI pads a reference shorter than its 5 kb context with N and the result says so.

## Where the code is

`src/engine/qc/unplanned.js` (scan and merge), `unwanted.js` (protein effect, flags, observed alleles), `decision.js` and `recommend.js` (rules and ranking), `src/services/cloneReview.js` and `cloneFlags.js` (alleles, requests, import, flags), `src/components/qc/CloneReviewPanel.jsx`, `tools/spliceai/clone_splice_check.py`, `tools/alphagenome/clones.py`. Tests: `test/qc-unwanted-changes.test.js` (simulated traces), `test/clone-review.test.js`, `test/decision-clone-flags.test.js`, and the Python tests beside each tool.
