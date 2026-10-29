# Collaborator research pilot

Use https://assured-bench.vercel.app/ in a current desktop browser. This is a
research testing release; predictions are not experimental validation or clinical advice.
Use public reference examples first. Do not upload patient, identifiable or confidential
sequences without your institution's approval for the relevant services.

1. Load **TP53 R175H (SNP KI)**. Confirm two distinct guides, two explicitly matched
   donors and screening primers appear.
2. Select **WTC11 iPSC reference**, unlock online analysis with the owner's private
   analysis access code, and use **Design and review**. The API key is not that code;
   collaborators must never receive the owner's Google API key.
3. Wait for completed evidence. If a job explicitly fails, rerun the same review to
   start a new attempt; queued/running work resumes and completed work is reused. Inspect the cell/track labels and comparison of
   intended edit versus full donor. Smaller additional disturbance is comparative
   evidence, not proof that a design is safe. Missing tracks remain not assessed.
4. In **Compare alternatives**, select two different eligible guides and apply them.
   Under **Advanced**, joint protection rebuilds donors against both guides and
   requires another review. Without joint protection, use the designs separately.
5. Open **Scientific report**. Confirm the chosen sequences, caveats and available
   evidence. **Print / save PDF** opens your browser's print dialog; choose Save as PDF.
   HTML, FASTA, SVG and QC JSON downloads are also available.
6. Rename this test experiment, **Save**, reopen it from **Projects**, and verify
   the selected design and evidence survived. Export a portable `.assured` backup;
   browser saves are specific to this device/browser and are not cloud backups.
7. Repeat with **TP53 Dual-Guide KO**. On **Selected design**, choose the cell type
   and use the same **Design and review** action to compare eligible knockout pairs.
   A uniquely supported recommendation is applied; trade-offs retain your selection.
   Lower remaining target RNA supports disruption; it does not prove protein disappearance.
8. Repeat with a terminal **2A reporter**. The same action compares N/C arrangements
   and guide alternatives using your selected reporter and cell context. Supply known
   terminal requirements under the folded settings. Unknown requirements can yield
   trade-offs rather than a preferred terminus. **Compare alternatives** shows the evidence
   and manual selection. Large synthetic edits are less established.
9. For **FLAG**, other terminal fusions, and internal knock-ins, the same front-page
   action reviews the selected integrated allele. These do not automatically search
   alternative cassettes. A separate 2A purpose can be explored explicitly under Advanced.
   Substitutions using enzymes without an automatic candidate search review the existing
   guide–donor pairs while preserving their sequences and enzyme.
10. Switch to **Scientific report** or **Analysis & evidence** during a review; waiting
   must continue. Return to **Selected design** to inspect progress and results.
11. For trace QC, upload an approved parental control and edited trace set with the
   matching design. Imported laboratory cohorts are intentionally absent from the
   hosted build. Trace analysis runs locally; manually sending an ICE package is a
   separate disclosure to that external service.

Before ordering, independently check genome-wide guide and primer specificity,
experimental-line variants, donor structure and the relevant transcript/protein.
Record gene/edit, cell context, enzyme, reference accession/assembly, timestamp,
expected versus observed behavior and a screenshot when reporting a problem.
Share feedback through your agreed private channel; do not post sequences or codes
in public issues.

## Access and privacy

- Basic design/report use is public and needs no code. Online AlphaGenome requires
  the private access code once per browser/domain for seven days, unless cookies are
  cleared or the signing secret changes. Private browsing and different devices
  require separate unlocks. There is no per-collaborator account or individual revocation.
- The server stores only the configured code hash; the browser receives a signed
  Secure, HttpOnly, SameSite=Strict cookie. Do not put codes in URLs or Git.
- The online reviewer sends selected sequence context to Google AlphaGenome and
  retains requests/reports in private Vercel Blob storage. Automatic data expiry
  and per-user isolation are not implemented. Use approved reference examples for this pilot.
- Making GitHub private restricts source access; it does not restrict the public app
  or erase earlier clones, forks, cached deployments or disclosure.
