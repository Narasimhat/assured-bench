# Regression fixtures

Each fixture pins a finding from `audit/2026_GE_design_audit.md` to an executable
expectation, so an audited defect cannot silently return.

## What may live here

Public reference sequence and synthetic sequence only.

Internal project documents, IRIS identifiers, project numbers, cell-line records and
generated genomic reports must **not** be committed. Where a fixture derives from a real
project, only the gene, the requested edit, and public reference sequence are reproduced;
everything identifying the project is dropped.

## Provenance

### `apoe-r154s.gb`

- **Source:** NCBI RefSeqGene `NG_007084.2`, region 5600..8900, retrieved 2026-08-31
- **Gene:** APOE. The neighbouring TOMM40 gene and all unrelated annotation are removed.
- **Why this window:** the complete APOE CDS is retained so preprotein residue numbering
  is preserved. Residue 154 is Arg (`CGC`) — the codon the audited design mutated to
  `CGA`, which encodes Arg rather than the requested Ser.
- **Validated:** this 3,301 bp slice reproduces the full 10,612 bp record's design result
  exactly — same guides, PAMs, GC, blocking tiers, donors, amplicon and release status.
- Public reference sequence only; contains no project or subject data.

### `two-genes-partial-first.gb`

- **Source:** fully synthetic (deterministic generator); no reference, project or subject data.
- **Reproduces:** the hazard in NCBI RefSeqGene records that annotate a neighbouring gene.
  The first CDS in the file belongs to `NEIGHBOURA` and is partial (`<1..70`), out of frame
  (70 nt) and lacks ATG — exactly like TOMM40 in `NG_007084`. `TARGETB` is the complete gene.
- **What it pins:** selecting a CDS by file order designs against the wrong gene. Selecting
  by annotation completeness does not, and the choice must still be reported because it was
  inferred rather than requested. Stating the intended gene removes the ambiguity.

### `synthetic-tagging.gb`

- **Source:** fully synthetic (deterministic generator); no reference, project or subject data.
- **Shape:** single gene `TAGME`, two-exon CDS (1200 nt / 399 aa), with 1500 bp of flank
  before the ATG and 1800 bp after the stop codon.
- **Why those flanks:** N- and C-terminal designs need to place 400 bp homology arms *and*
  position recommended primers wholly outside those arms with ≥50 bp clearance. A tighter
  reference falls back to unvalidated primer placement and stops testing the real path.
- **What it pins:** terminal-tag donor construction, internal-tag frame validation,
  outside-homology-arm primer margins, and the refusal paths for unsupported cassettes and
  malformed or off-target custom guides.
- **Useful residues:** 50 is Phe, 100 is Arg. Internal-tag sites on either side of the
  locus produce donors on opposite strands, which is what exercises orientation handling.

### `nr2f2-ng016753.gb`

- **Source:** NCBI RefSeqGene `NG_016753.1` (21,336 bp), unmodified, retrieved 2026-10-07.
- **Gene:** NR2F2 (Gene ID 7026), CDS `join(11179..11620,13149..13676,16421..16695)`, protein
  `NP_066285.1` (414 aa). The record also annotates the antisense gene `NR2F2-AS1` first, so the
  design must be told the intended gene.
- **What it pins:** C-terminal tag guide selection. The guide nearest the stop codon (-12 bp)
  grades a tier below the guide at -14 bp, whose cut is 2 bp from it. Guide selection used to
  choose the pair by proximity before scoring, which discarded the better guide.
- Public reference sequence only; contains no project or subject data.

## Adding a fixture

Add the reference here, then add a case to `CASES` in `../regression-fixtures.test.js`.

Every case is additionally checked against the universal invariants in that file, so a
new fixture strengthens the whole suite rather than only its own scenario. A fixture left
unreferenced by any case will fail the suite.
