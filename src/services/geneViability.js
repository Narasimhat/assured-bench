// Is the gene one a cell can lose? Population constraint and cell-line essentiality for the target gene, from one public source (Open Targets Platform:
// gnomAD loss-of-function constraint and DepMap CRISPR gene-effect scores), shown for every gene whether the numbers are reassuring or not.
//
// What it is not: a prediction for iPSCs. DepMap screens are cancer cell lines; a gene that is dispensable there can still matter in a stem cell or
// differentiated cell, and the reverse. The numbers say what to look at before a knockout is planned, not whether it will work.

export const OPEN_TARGETS_API = "https://api.platform.opentargets.org/api/v4/graphql";
const SEARCH = `query($q:String!){ search(queryString:$q, entityNames:["target"], page:{index:0,size:5}){ hits{ id name object{ ... on Target{ approvedSymbol } } } } }`;
const TARGET = `query($id:String!){ meta{ dataVersion{ year month } } target(ensemblId:$id){ id approvedSymbol
  geneticConstraint{ constraintType exp obs oe oeLower oeUpper score }
  depMapEssentiality{ tissueName screens{ geneEffect } } } }`;
const DEPENDENCY_CUTOFF = -0.5; // the cut-off DepMap users commonly apply to Chronos gene effect; -1 is about the median of common-essential genes

const round = (x, n = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null);

async function post(fetchFn, query, variables) {
  const response = await fetchFn(OPEN_TARGETS_API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout?.(12000) });
  if (!response?.ok) throw new Error(`Open Targets answered HTTP ${response?.status ?? "none"}`);
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors[0].message || "Open Targets returned an error");
  return json.data;
}

/** Summarise an Open Targets `target` document: { gnomad, depmap } with every number as the source gives it. Exported for tests. */
export function summariseViability(target, meta) {
  const lof = (target?.geneticConstraint || []).find((c) => c.constraintType === "lof") || null;
  const mis = (target?.geneticConstraint || []).find((c) => c.constraintType === "mis") || null;
  const effects = (target?.depMapEssentiality || []).flatMap((t) => (t.screens || []).map((s) => s.geneEffect)).filter(Number.isFinite).sort((a, b) => a - b);
  const median = effects.length ? (effects.length % 2 ? effects[(effects.length - 1) / 2] : (effects[effects.length / 2 - 1] + effects[effects.length / 2]) / 2) : null;
  return {
    gnomad: lof ? { pLI: round(lof.score, 3), loeuf: round(lof.oeUpper, 2), observed: lof.obs ?? null, expected: round(lof.exp, 1), observedOverExpected: round(lof.oe, 2), missenseZ: mis ? round(mis.score, 2) : null } : null,
    depmap: effects.length ? { screens: effects.length, medianGeneEffect: round(median, 2), mostNegativeGeneEffect: round(effects[0], 2), screensAtOrBelowCutoff: effects.filter((x) => x <= DEPENDENCY_CUTOFF).length, cutoff: DEPENDENCY_CUTOFF } : null,
    release: meta?.dataVersion ? `${meta.dataVersion.year}.${meta.dataVersion.month}` : null,
  };
}

export function describeViability(v) {
  if (!v) return "";
  if (!v.ok) return `Gene viability: not retrieved (${v.error}). Check gnomAD constraint and DepMap before planning a knockout.`;
  const parts = [];
  parts.push(v.gnomad ? `gnomAD loss-of-function constraint: pLI ${v.gnomad.pLI}, LOEUF ${v.gnomad.loeuf} (${v.gnomad.observed ?? "?"} observed vs ${v.gnomad.expected ?? "?"} expected loss-of-function variants)` : "gnomAD constraint: no entry");
  parts.push(v.depmap ? `DepMap CRISPR gene effect over ${v.depmap.screens} cancer cell-line screens: median ${v.depmap.medianGeneEffect}, most negative ${v.depmap.mostNegativeGeneEffect}, ${v.depmap.screensAtOrBelowCutoff} at or below ${v.depmap.cutoff} (0 = no effect, -1 = typical common-essential gene)` : "DepMap: no screens");
  return `${parts.join("; ")}. Source: ${v.source}${v.release ? `, release ${v.release}` : ""}. Cancer cell lines are not iPSCs; this says what to look at before the knockout, not whether it will work.`;
}

/** { ok, symbol, ensemblId, gnomad, depmap, release, source } or { ok:false, error }. Never throws. */
export async function queryGeneViability({ symbol, ensemblId } = {}, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== "function") return { ok: false, error: "no network access" };
  try {
    let id = ensemblId || null;
    if (!id) {
      const wanted = String(symbol || "").trim().toUpperCase();
      if (!wanted) return { ok: false, error: "no gene symbol" };
      const hits = (await post(fetchFn, SEARCH, { q: wanted }))?.search?.hits || [];
      id = hits.find((h) => String(h.object?.approvedSymbol || "").toUpperCase() === wanted)?.id || null;
      if (!id) return { ok: false, error: `Open Targets has no target named ${wanted}` };
    }
    const data = await post(fetchFn, TARGET, { id });
    if (!data?.target) return { ok: false, error: `Open Targets has no target ${id}` };
    return { ok: true, symbol: data.target.approvedSymbol, ensemblId: data.target.id, source: "Open Targets Platform (gnomAD constraint; DepMap CRISPR screens)", ...summariseViability(data.target, data.meta) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
