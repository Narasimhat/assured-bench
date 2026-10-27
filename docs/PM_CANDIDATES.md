# Point-mutation candidate pairs

For a point-mutation design with SpCas9, Bench can show several matched guide + donor pairs instead of one,
check each against the core design requirements, and, optionally, compare them with AlphaGenome. It appears under
**Alternative guides** on the result page.

Nothing here changes what **Generate design** returns. `runDesign` output is byte-identical to before; the candidate
set is built on request from the same reference.

## 1. Candidate set (`src/engine/design/pmCandidates.js`)

1. Every SpCas9 guide with a cut within 30 bp of the edit is found.
2. For each guide two donor versions are built. Version 1 is the donor `runDesign` builds; version 2 uses blocking
   changes at different positions (`avoidBlockerPositions`).
3. Each row is checked against the reference, not against the engine's own objects:

| Gate | Requirement |
|---|---|
| G1 | the edited CDS, translated independently, differs from the reference only by the requested change |
| G2 | repaired-allele CFD at or below 0.023 (the strong-protection threshold) |
| G3 | cut within 20 bp of the edit |
| G4 | ssODN arms of at least 30 nt either side of the edit, every substitution inside the donor (30 nt is a convention, not a measured threshold) |
| G5 | spacer occurs once in the reference window and has an NGG PAM |
| G6 | spacer GC between 30 and 80%, the exclusion the knockout selector already uses (added after the first APOE run kept a 95% GC guide) |

4. Rows that pass are ordered by tier: cut within 10 bp first; then protection that does not rest on a single spacer
   mismatch with an intact PAM; then fewer blocking changes. CFD is reported but does not order candidates, because the
   table has exact-zero cells. Up to six candidates are kept, at most two donor versions per guide.
5. Flags (not gates): GC outside 40-60%, PAM disrupted by the repair, one spacer mismatch with intact PAM, CFD exactly 0.
   "Edit alone" is the CFD if only the intended base converts and no blocker does.

**Not assessed:** genome-wide specificity. Every candidate carries `specificity.status = "not-assessed"`; the interface
says so and points to the off-target export.

For the ssODN, a plus-strand guide gets the reverse complement of the plus-strand allele (`donor.orientation`);
substitutions and the AlphaGenome request always use the plus-strand allele.

Example (APOE R176C, bundled reference): 14 guides, 28 guide/donor versions, 4 pass, tiers 1, 1, 2, 3. TP53 R175H gives 4.

## 2. Regulatory comparison (`tools/alphagenome/rank.py`, `src/services/candidateRanking.js`)

Research use. AlphaGenome terms are non-commercial and each prediction sends a sequence window to Google; the key stays
local (see `README.md`).

**One click (local helper).** The page cannot call AlphaGenome itself (the service speaks gRPC to its own client, and the key
must not enter a browser), so a small helper runs on your computer and the page talks to it:

```bash
python3 tools/alphagenome/rank.py --serve        # once per session; prints a session code
# In Bench: Regulatory comparison > paste the session code > Run AlphaGenome comparison
```

The page builds the request, the helper runs the comparison with your key, and the page checks the report against that
request and applies the same fixed rule as for an imported file. The first run for a locus also builds the null (about 90
predictions; about 10-20 s in the earlier APOE run, longer if your API quota throttles) and caches it in `local-reviews/null-cache/`; later runs reuse it.

What the helper protects, and what it does not:
- it listens on 127.0.0.1 only; it answers only the pages you allow (`https://assured-bench.vercel.app` and the local dev
  server by default; add one with `--origin https://...`) and only for `Host: 127.0.0.1|localhost:<port>`;
- `POST /rank` needs the session code printed at start-up; one comparison at a time; request size is capped;
- the key stays in the helper process (it is read from `ALPHAGENOME_API_KEY` or `local-reviews/alphagenome-api-key.local`);
  `/health` reports only whether a key exists; error replies never contain upstream error text, sequences or the key;
- the page sends nothing until you click, and never probes the address on load (a browser may ask for local-network permission);
- sequence windows still go from your computer to Google for each prediction; the AlphaGenome terms (non-commercial use) apply.

Browsers. The page is served over https and calls `http://127.0.0.1`. Chrome allows this after a local-network permission
prompt (allow it for the Bench site; the setting is "Apps on device" in site settings in recent versions); the helper
answers the preflight with `Access-Control-Allow-Private-Network`. Firefox should allow it (loopback is treated as potentially trustworthy; not tested here). Safari may
refuse an https page's request to `http://127.0.0.1`; use Chrome or Firefox, or run Bench locally (`npm run dev`, origin
`http://localhost:5173`), or use the manual route below. Browser behaviour has changed between releases; the helper's
protocol is tested, the browsers' prompts are not.

**Manual route (no helper).**

```bash
# 1. In Bench: Regulatory comparison > No helper > Export request   (one JSON file)
python3 tools/alphagenome/rank.py request.json --validate-only          # offline, no key, no network
python3 tools/alphagenome/rank.py request.json --run --output report.json --null null-cache.json
# 2. In Bench: Import report (matched to the exported request)
```

The null cache is built on the first run and reused when the locus, window, contexts, reference and model are unchanged.

**What is predicted.** Reference, the intended edit alone, and each distinct donor allele (candidates with the same
substitution set share one allele; the model never sees the guide or the ssODN arms), in one to four cell contexts.

**Metrics**, each donor allele against the intended-edit-only allele, plus-strand tracks, inside the annotated gene:
1. exon expression, |log2 ratio| of summed RNA-seq over the annotated exons;
2. local expression change within 50 bp of the substituted bases, relative to the reference level;
3. splice-site usage change at annotated sites (context-specific);
4. splice-site probability change at annotated sites;
5. largest new splice-site gain inside the gene.

**Null.** 30 random sets of 1, 2 or 3 single-base synonymous changes in distinct codons within 35 bp of the edit, added to
the intended edit, for each blocker count present. The sets are seeded and reproduce exactly.

**Statistic.** A donor's composite is its largest upward deviation across the five metrics, in null standard deviations
(population SD, with floors for coarsely quantised outputs), against the null of the same blocker count. Its p value is the
share of null alleles whose own composite, measured against the rest of the null, is at least as large, counting the
donor itself. Flag at p <= 0.05.

*Why not ranks.* The first version used each metric's percentile in the null. A percentile saturates at 1.0 for any value
above the null maximum, so with five metrics and 30 null alleles a value above the null maximum still got p of 0.13 or more and no donor
could reach 0.05; a positive-control test exposed it. The deviation-based composite flags a large effect (p = 1/31), flags
about 1 in 30 null alleles against the rest of the null, and gives p = 0.32-0.87 for the four saved APOE candidates.

**Decision rule** (fixed, `RANKING_RULE`):
1. Design-check tier comes first. The model never rescues a gate failure.
2. A donor flagged in the primary context (the first requested) is demoted by one tier.
3. Raw deltas never order candidates. Candidates left in the best tier are reported as **equally supported**; a single one
   is "Best-supported among N candidates evaluated in <context>".
4. If the primary context's reference exon RNA-seq averages below 1.0 it is uninformative and no regulatory ordering is made.
5. Further contexts are reported alongside and never change the order.
6. If one candidate must be ordered first among a tie, a separate convention is shown, labelled as not evidence: lower
   edit-alone CFD (binned to 0.05), then closer cut, then GC nearer 50%.

Sensitivity: the report also states what the literal "any metric above the null 95th percentile" rule would flag. For
APOE R176C it flags the three-blocker candidate (annotated splice change 0.0037 against a null maximum of 0.0034) and
leaves the top set unchanged.

## 3. Applying a pair

"Use" reruns the design with that guide alone and its donor version. `avoidBlockerPositions` is a per-run option, never
saved with the project (`src/services/runOptions.js`). Tests show the rerun returns the identical guide and ssODN for every
APOE and TP53 candidate.

## 4. Limits

- SpCas9 point mutations only. Plus-strand genes in a chromosome-forward GRCh38 reference only (minus-strand is refused).
- The mapping (chromosome, reference start) is confirmed by the user; an Ensembl-style `GRCh38 ... Location: chrN start-end`
  line prefills it.
- A ranking, whether imported or run through the helper, lives in the open page only; run it again to reproduce it (the request is deterministic and the model's predictions repeat exactly).
- Model output is uncalibrated and does not predict cutting, HDR, clone fitness or protein function.

## 5. Tests

`npm test` (candidate set, ranking service, helper client, picker render tests, parity with the saved APOE run) and, with the
AlphaGenome SDK installed, `cd tools/alphagenome && PYTHONPATH=. python3 -m unittest test_rank test_helper test_review test_context_catalog`.
`test/fixtures/alphagenome-helper/wire.json` is what the Python helper sent in its own tests; the page's tests replay it, and
`test_helper.py` fails when it goes stale (`UPDATE_WIRE_FIXTURE=1` regenerates it). Neither suite runs a real browser, a real
listening socket across processes, or the hosted model; first use on your machine is the integration test.
The parity fixtures (`test/fixtures/alphagenome-ranking/`) are real predictions from the earlier APOE R176C run; the fake
client in `test_rank.py` is for plumbing only. A Python reference of the statistic re-derives the expected values that the
JavaScript must reproduce.
