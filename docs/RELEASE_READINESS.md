# Collaborator release review — 2026-10-29

Scope: a small supervised research pilot using public reference examples. This is
not a clinical product, validated editing service, or unrestricted confidential-data platform.

## Checks

- Final: 403 JavaScript tests and 47 Python tests passed, including artifact and retry regressions. Production build passed.
- Dependency gate: no unaccepted high/critical advisory. Two known xlsx 0.18.5
  advisories remain explicit exceptions in scripts/check_audit.mjs. Do not import
  untrusted workbooks; replacement remains an open security task.
- Production API: rejects missing authentication, incorrect analysis codes and
  cross-origin session requests. Correct code creates a secure seven-day cookie;
  status confirms reuse without resubmitting the code. Local configured credentials
  were not found in tracked file contents; this is not a complete Git-history audit.
- Browser: TP53 R175H generates two matched guide/donor designs and opens the
  scientific manuscript with Print / save PDF, HTML and supplementary downloads.
- Release artifact gate excludes laboratory cohorts, imported project history,
  local outputs, credentials and source maps from the production build. Local
  originals are retained. Public reference GenBank records remain available.
- CI now includes the Python reviewer tests and release artifact gate.

## Remaining limits before wider sharing

1. The source repository was public at the start of review and was made private with owner approval and its README states MIT;
   no root LICENSE file was present. Institutional ownership, existing permissions
   and third-party licenses require a legal/IP review before changing distribution terms.
2. Earlier Git history and deployments contain laboratory datasets. Excluding them
   from new builds does not revoke old access. Confirm publication rights and
   decide on private repository access, protected/removed old deployments and, if
   needed, a separately planned history cleanup. Never rewrite shared history casually.
3. The production app is public. The analysis code protects the reviewer, not
   static application code or existing datasets. No per-user accounts, individual
   revocation, tenant isolation, automatic retention deletion or application-level
   distributed rate limiting are implemented. Use a small trusted group; add
   full-site authentication and abuse controls before a broad/confidential pilot.
4. Computational rankings cannot establish HDR yield, cutting efficiency, protein
   disappearance or reporter function. Genome-wide specificity and laboratory
   validation remain required. Cell contexts are model tracks, not measurements of
   the collaborator's own culture. Large synthetic insertions have extra uncertainty.
5. The current Google API's terms and institutional approvals must cover your use;
   commercial rights are a separate question from patentability.

## Live checks completed

- The rs35599367 / WTC11 online SNP review completed with a matching request ID.
- The complete browser TP53 R175H / WTC11 donor workflow reviewed 12 candidates,
  selected two different guide/donor pairs, saved, and restored after reload.
- One initial knockout worker run failed after two queue deliveries. A fresh
  knockout run and a larger C-terminal 2A cassette run both completed. This exposed
  a recovery bug: failed identities were permanently cached. Explicit retry now
  queues a fresh deduplicated delivery group; completed evidence remains cached.
- The recent production error-log query returned zero records in its five-minute
  window. This is a narrow snapshot, not proof of comprehensive monitoring.
- GitHub private visibility was verified through an authenticated read-back.

Verdict: suitable for a small supervised collaborator research pilot with public
reference examples after the release deployment verifies. Confidential-data,
unrestricted public and clinical release requirements remain unmet. Obtain the
exact live commit and READY state from Vercel deployment metadata.
See [collaborator checklist](COLLABORATOR_TESTING.md) for the test sequence.
