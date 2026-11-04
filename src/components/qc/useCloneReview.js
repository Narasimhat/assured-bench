import { useEffect, useState } from "react";
import { buildCloneSpliceRequest, buildCloneAlphaGenomeRequest } from "../../services/cloneReview.js";

/**
 * The clone-review requests for the current results, and whether each imported result still belongs to them. A result is stored with the request it answered;
 * when the results, the design or the cell context change the request changes, and the stored result is shown as outdated and left out of the flags.
 */
export function useCloneReview(project, results, settings) {
  const [state, setState] = useState({ splice: {}, alphagenome: {} });
  const saved = project?.cloneReview || {};
  useEffect(() => {
    let live = true;
    (async () => {
      const next = { splice: {}, alphagenome: {} };
      try { next.splice.request = await buildCloneSpliceRequest(project, results); } catch (error) { next.splice.error = error.message; }
      try {
        if (!settings.ontologyTerm) next.alphagenome.error = "Choose the experimental cell context.";
        else next.alphagenome.request = await buildCloneAlphaGenomeRequest(project, results, settings);
      } catch (error) { next.alphagenome.error = error.message; }
      if (next.splice.request && saved.splice) { next.splice.fresh = saved.splice.requestId === next.splice.request.requestId; next.splice.imported = true; }
      else if (saved.splice) next.splice.imported = true;
      if (next.alphagenome.request && saved.alphagenome) { next.alphagenome.fresh = saved.alphagenome.requestId === next.alphagenome.request.requestId; next.alphagenome.imported = true; }
      else if (saved.alphagenome) next.alphagenome.imported = true;
      if (live) setState(next);
    })();
    return () => { live = false; };
  }, [project?.designResult, project?.genbankRaw, results, saved.splice, saved.alphagenome, settings.ontologyTerm, settings.sequenceLength]);
  const fresh = {
    splice: state.splice.fresh ? saved.splice.summary : null,
    alphagenome: state.alphagenome.fresh ? saved.alphagenome.summary : null,
  };
  return { ...state, review: fresh.splice || fresh.alphagenome ? { splice: fresh.splice, alphagenome: fresh.alphagenome } : null, saved };
}
