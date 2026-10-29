import { buildCoveredAlleleReviewBatch, validateAlleleReview, alleleReviewSource } from "./alphaGenomeAlleles.js";
import { readDonorReviewResponse } from "./alphaGenomeOnline.js";

/** Review the exact edited allele of a knockout or knock-in, the way the donor workflow reviews substitution candidates. */
export async function reviewEditedAllele(project, { ontologyTerm, donorIndex = 0, batch, fetchFn = globalThis.fetch, signal, onProgress = () => {} } = {}) {
  const request = batch || await buildCoveredAlleleReviewBatch(project, { ontologyTerm, donorIndex });
  onProgress("Reviewing the exact edited allele in the selected cells…");
  const response = await fetchFn("/api/alphagenome/compare", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
  const report = validateAlleleReview(await readDonorReviewResponse(response, { fetchFn, signal, onProgress }), request);
  return { batch: request, report };
}

/** The project fields an allele review contributes, so the design page and the evidence page record it identically. */
export async function designReviewUpdate(project, settings, callbacks = {}) {
  const { report } = await reviewEditedAllele(project, { ontologyTerm: settings.ontology, ...callbacks });
  return { alleleReview: report, alleleReviewContext: settings.ontology, alleleReviewSource: alleleReviewSource(project) };
}
