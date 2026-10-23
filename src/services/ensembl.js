/**
 * Gene / transcript lookup for ASSURED Bench.
 *
 * Uses the same client-side Ensembl / NCBI / ClinVar fetch path as ASSURED CRISPR Designer
 * (geneFetch.js), so a Bench design starts from the same GenBank-shaped reference the design
 * tool would produce. A pinned TP53 RefSeqGene remains available when Ensembl/NCBI are down.
 */
import {
  FETCH_ORIGINS,
  SPECIES,
  GeneFetchError,
  fetchGeneReference,
  parseGeneQuery,
} from "./geneFetch.js";

export { FETCH_ORIGINS, SPECIES, GeneFetchError, fetchGeneReference, parseGeneQuery };

const TP53_FALLBACK_QUERIES = new Set(["TP53", "ENSG00000141510"]);

function speciesKeyFromEnsembl(species) {
  const match = Object.entries(SPECIES).find(([, value]) => value.ensembl === species);
  return match?.[0] || "human";
}

function mapFetchResult(result) {
  const summary = result.summary || {};
  return {
    geneSymbol: summary.gene || "",
    ensemblId: summary.geneId || "",
    transcriptId: summary.transcriptId || "",
    referenceAccession: summary.transcriptId || "",
    proteinId: "",
    chr: summary.chromosome || "",
    genomicStart: summary.regionStart,
    genomicEnd: summary.regionEnd,
    strand: summary.strand,
    source: summary.source || "Ensembl",
    sourceUrl: summary.source === "NCBI"
      ? `https://www.ncbi.nlm.nih.gov/gene/?term=${encodeURIComponent(summary.geneId || summary.gene || "")}`
      : `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${encodeURIComponent(summary.geneId || "")}`,
    warning: (summary.warnings || []).filter(Boolean).join(" ") || undefined,
    genbankText: result.genbank,
    sequenceLength: summary.length || result.genbank?.length || 0,
    fileName: result.fileName,
    summaryText: summary.text,
  };
}

async function loadBundledTp53(fetchImpl = globalThis.fetch) {
  const base = import.meta.env?.BASE_URL || "/";
  const response = await fetchImpl(`${base}references/tp53-NG_017013.2.gb`);
  if (!response.ok) return null;
  const genbankText = await response.text();
  if (!genbankText.includes("VERSION     NG_017013.2") || !genbankText.includes("ORIGIN")) return null;
  return {
    geneSymbol: "TP53",
    ensemblId: "ENSG00000141510",
    transcriptId: "NM_000546.5",
    referenceAccession: "NG_017013.2",
    proteinId: "NP_000537.3",
    chr: "17",
    source: "Bundled NCBI RefSeqGene",
    sourceUrl: "https://www.ncbi.nlm.nih.gov/nuccore/NG_017013.2",
    warning: "Ensembl lookup failed. Using bundled NCBI RefSeqGene NG_017013.2, TP53 variant 1 (NM_000546.5 / NP_000537.3). Coordinates are relative to this record.",
    genbankText,
    sequenceLength: 32772,
  };
}

function shouldUseTp53Fallback(query, species, error) {
  if (species !== "homo_sapiens" && species !== "human") return false;
  const normalized = String(query || "").trim().toUpperCase().replace(/\.\d+$/, "");
  if (!TP53_FALLBACK_QUERIES.has(normalized)) return false;
  if (error?.status && error.status < 500 && error.status !== 429) return false;
  const message = String(error?.message || "");
  if (/no .+ gene called/i.test(message)) return false;
  return /Could not reach|temporarily unavailable|returned 5\d\d|Failed to fetch|network/i.test(message)
    || error?.status >= 500
    || error?.status === 429
    || error instanceof TypeError;
}

/**
 * Fetch a gene / transcript and return a Bench-shaped geneMeta object with genbankText.
 * `species` accepts either an Ensembl species slug (`homo_sapiens`) or a geneFetch key (`human`).
 * Optional `fetchImpl` / `sleep` are forwarded to geneFetch for tests.
 */
export async function fetchGeneGenbank(geneSymbol, species = "homo_sapiens", { fetchImpl, sleep } = {}) {
  const query = String(geneSymbol || "").trim();
  const speciesKey = SPECIES[species] ? species : speciesKeyFromEnsembl(species);
  const fetchOpts = {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(sleep ? { sleep } : {}),
  };
  try {
    const result = await fetchGeneReference({ query, source: "ensembl", species: speciesKey, ...fetchOpts });
    return mapFetchResult(result);
  } catch (error) {
    if (shouldUseTp53Fallback(query, speciesKey === "human" ? "homo_sapiens" : species, error)) {
      const fallback = await loadBundledTp53(fetchImpl);
      if (fallback) return fallback;
    }
    if (error instanceof GeneFetchError) {
      let message = error.message;
      if (/^Could not reach/.test(message)) {
        message = "Could not reach Ensembl while looking up the gene. Check your connection or upload a GenBank reference.";
      } else if (error.status >= 500) {
        message = `Ensembl is temporarily unavailable (HTTP ${error.status}). Retry later or upload a GenBank reference.`;
      } else if (error.status) {
        message = `Ensembl could not complete looking up '${query}' (HTTP ${error.status}). Check the gene symbol or upload a GenBank reference.`;
      }
      const wrapped = new Error(message, { cause: error });
      wrapped.status = error.status;
      throw wrapped;
    }
    throw error;
  }
}

/**
 * Search for genes by symbol prefix (best-effort Ensembl lookup for autocomplete).
 */
export async function searchGeneSymbols(query, species = "homo_sapiens") {
  if (!query || query.trim().length < 2) return [];
  const speciesSlug = SPECIES[species]?.ensembl || species;
  try {
    const url = `https://rest.ensembl.org/lookup/symbol/${speciesSlug}/${encodeURIComponent(query.trim())}?expand=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    return [{
      id: data.id,
      symbol: data.display_name,
      description: data.description,
      biotype: data.biotype,
      seq_region_name: data.seq_region_name,
      start: data.start,
      end: data.end,
      strand: data.strand,
    }];
  } catch {
    return [];
  }
}
