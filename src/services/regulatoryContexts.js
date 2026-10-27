import catalog from "./data/alphaGenomeContexts.json" with { type: "json" };

export const REGULATORY_CONTEXT_CATALOG = catalog;
export const REGULATORY_CONTEXT_PLAN_SCHEMA = "assured-regulatory-context-plan/1";
export const BROAD_CONTEXT_IDS = catalog.contexts.filter(c => c.default).map(c => c.id);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const OUTPUTS = ["RNA_SEQ", "SPLICE_SITE_USAGE", "SPLICE_JUNCTIONS", "ATAC", "DNASE", "CHIP_HISTONE", "CHIP_TF", "CONTACT_MAPS"];

export function regulatoryContextCoverage(context) {
  const tracks = context.outputTracks || {};
  return {
    expression: Boolean(tracks.RNA_SEQ),
    // Generic SPLICE_SITES tracks are shared, so cannot stand in for cell-specific usage/junctions.
    splicing: Boolean(tracks.SPLICE_SITE_USAGE || tracks.SPLICE_JUNCTIONS),
    accessibility: ["ATAC", "DNASE"].filter(o => tracks[o]),
    regulatoryMarks: ["CHIP_HISTONE", "CHIP_TF"].filter(o => tracks[o]),
    contacts: Boolean(tracks.CONTACT_MAPS),
    missingOutputs: OUTPUTS.filter(o => !tracks[o]),
  };
}

/** A cell-context plan only. It carries no DNA, API credentials, predictions or release decision. */
export function buildRegulatoryContextPlan({ contextIds, pscLine = "", derivativeNotes = "" } = {}) {
  if (!Array.isArray(contextIds) || !contextIds.length || new Set(contextIds).size !== contextIds.length) throw new Error("Choose at least one context; duplicate contexts are not allowed.");
  if (typeof pscLine !== "string" || typeof derivativeNotes !== "string" || pscLine.length > 200 || derivativeNotes.length > 2000) throw new Error("Use a PSC line label up to 200 characters and experimental notes up to 2,000 characters.");
  const contexts = contextIds.map(id => {
    const context = catalog.contexts.find(c => c.id === id);
    if (!context) throw new Error(`Unknown model context: ${id}`);
    return { ...context, coverage: regulatoryContextCoverage(context) };
  });
  if (!contexts.some(c => c.lineage === "Pluripotent")) throw new Error("Include at least one pluripotent reference context for the starting state.");
  return {
    schema: REGULATORY_CONTEXT_PLAN_SCHEMA, status: "planned", predictionPerformed: false,
    createdAt: new Date().toISOString(),
    experimentalContext: { pscLine: pscLine.trim(), derivativeNotes: derivativeNotes.trim(), exactModelMatchVerified: false },
    provider: { name: "AlphaGenome", organism: catalog.organism, modelVersion: catalog.modelVersion, sdkVersion: catalog.sdkVersion, metadataRetrievedAt: catalog.retrievedAt },
    contexts, sharedOutputs: catalog.sharedOutputs,
    executionReady: false,
    remainingWork: ["Construct and verify exact edited alleles and genomic mapping.", "Run an indel-aware, multi-context prediction and scoring job.", "Compare intended and collateral regulatory effects with recorded uncertainty."],
    limitations: catalog.limitations,
  };
}

export function validateRegulatoryContextPlan(plan) {
  if (plan?.schema !== REGULATORY_CONTEXT_PLAN_SCHEMA || plan.status !== "planned" || plan.predictionPerformed !== false || plan.executionReady !== false || !Array.isArray(plan.contexts) || !plan.contexts.length) throw new Error("This is not a valid unexecuted regulatory-context plan.");
  const rebuilt = buildRegulatoryContextPlan({ contextIds: plan.contexts.map(c => c.id), ...plan.experimentalContext });
  // Validate persisted coverage as well as IDs: imported plans must not invent available assays.
  for (const [i, context] of plan.contexts.entries()) {
    const expected = rebuilt.contexts[i];
    if (canonical(context) !== canonical(expected)) throw new Error("Context plan coverage does not match the recorded catalog.");
  }
  if (plan.provider?.metadataRetrievedAt !== catalog.retrievedAt || plan.provider?.modelVersion !== catalog.modelVersion || plan.experimentalContext?.exactModelMatchVerified !== false) throw new Error("Context catalog provenance does not match; configure the panel again.");
  return plan;
}
