# Functional knockout selection v2

The existing design engine generates the plans. The new selector ranks single guides first and then evaluates a coordinated pair. This is a sequence-supported recommendation, not a newly trained model or a calibrated probability of functional knockout.

## Eligibility and individual ranking

Scan the supplied reference for the selected enzyme. Require 40–60% GC calculated from the exact spacer fraction (excluding PAM and scaffold/repeat), no homopolymer longer than four bases, and no TTTT when delivery is U6/Pol III. A cut must be more than 10 bp inside a coding segment in every usable same-gene CDS annotation supplied with the record. The conservative boundary margin keeps the existing deletion panel, which includes 10 bp deletions, inside annotated coding sequence. Criteria are not relaxed when too few guides qualify.

Rank by coding coverage, existing frameshift-panel functional tier, escape in other annotated coding sequences, and supported repair predictions in five-percentage-point bins. Potential in-frame exon skipping, a sequence self-complementarity screen, distance from coding boundaries, and balanced GC break remaining ties. Exon length divisible by three is a rescue flag, not evidence that skipping occurs. Individual tiers remain conditional on frameshift outcomes and are not cutting efficiencies.

The functional panel already checks NMD escape, retained truncated protein and possible downstream translation initiation. SpCas9 can additionally use loaded Lindel weights. Cas9 repair predictions are never transferred to other enzymes. Distinct same-gene CDS structures are deduplicated; the previous eight-structure cap has been removed. Unsupported or absent transcript annotations cannot establish full biological isoform coverage.

## Individual guides versus the pair

The result records the top two individuals, their combined nominal deletion assessment and up to six backup individual guides. Pair search retains the top two, adds high-ranked guides with cut-position diversity, and examines all combinations in a maximum 24-guide shortlist. Cuts must be 10–140 bp apart; 40–140 bp is preferred among equivalent functional assessments. Pair tier and isoform escape precede spacing preference and individual ranks. The coordinated pair can differ from the top individuals. The design's guides, primers, ordering and QC export describe this coordinated pair; the report identifies the difference explicitly.

If no coordinated pair qualifies, return a diagnostic with the individual rankings in `koSelection`; do not silently widen spacing or GC. Pair search is bounded and disclosed, not an assertion of global optimality. Cas12 cut positions are nominal; staggered-end processing can change the repaired junction.

## Reports and traceability

The HTML and text reports include eligibility counts, ranking policy/version, individual recommendations, pair assessment, backups, evidence scope, missing assessments and validation advice. The QC handoff records selection version and policy without changing its coordinate system. Manual guide overrides must meet GC, sequence and shared coding-interior requirements; they are assessed but are not falsely labelled automatically optimized.

Expression in the user's cells, essential-domain annotations, sample variants/copy number, genome-wide specificity, calibrated cutting efficiency, folding energies and rearrangement/regulatory effects are explicitly unassessed. Existing primers support the coordinated design; sequencing both sites/junction and confirming protein loss plus relevant function remain necessary. Published-dataset benchmarking and experimental validation have not been performed for this selector.
