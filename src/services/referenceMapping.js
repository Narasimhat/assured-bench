/**
 * Where an uploaded genomic reference sits in GRCh38, worked out from the design itself.
 *
 * Some references state it ("Location: chromosome:GRCh38:19:44905754:44909393:1"); others (RefSeqGene records, hand-made files) do not.
 * For those, the gene symbol and the sequence around the edit are enough:
 *   1. Ensembl gives the gene's chromosome and span (GRCh38, human), and the genomic sequence of that span;
 *   2. a 40-base stretch of the reference next to the edit is searched for in that sequence; it must occur exactly once;
 *   3. that fixes the position of the reference's first base, and the whole reference is then compared with the genome there.
 * Only the gene symbol and coordinates leave the browser; the reference sequence is compared locally.
 *
 * The result is a proposal. A mapping that is off by even one base would put the edit on a different base, so the caller still shows the
 * numbers and the comparison, and the user confirms. A reference that differs from GRCh38 at more than 1% of its bases is refused.
 */
const ENSEMBL = "https://rest.ensembl.org";
export const MAX_GENE_SPAN = 2_000_000;
export const MAX_MISMATCH_FRACTION = 0.01;
export const ANCHOR_LENGTH = 40;
const HUMAN_CHROMOSOME = /^(?:[1-9]|1\d|2[0-2]|X|Y)$/;
const ANCHOR_OFFSETS = [0, 120, 300, 700, 1500, 3000];

class Unreachable extends Error {}
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url, { fetchImpl, sleep }, asText = false) {
  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) }); }
    catch { if (attempt < 2) { await sleep(500 * (attempt + 1)); continue; } throw new Unreachable(); }
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
    break;
  }
  if (!response.ok) return { ok: false, status: response.status };
  try { return { ok: true, status: response.status, body: asText ? String(await response.text()).trim() : await response.json() }; }
  catch { throw new Unreachable(); }
}

const fail = (reason, message, extra = {}) => ({ ok: false, reason, message, ...extra });
const fmt = (n) => Number(n).toLocaleString("en-US");

/** First anchors tried: the stretch just before the edit and just after it, then the same further out. */
export function anchorStarts(length, editIndex, k = ANCHOR_LENGTH) {
  const out = [];
  for (const d of ANCHOR_OFFSETS) for (const s of [editIndex - k - d, editIndex + 1 + d]) if (s >= 0 && s + k <= length && !out.includes(s)) out.push(s);
  return out;
}

function occurrences(haystack, needle, limit = 2) {
  const hits = [];
  for (let i = haystack.indexOf(needle); i !== -1 && hits.length < limit; i = haystack.indexOf(needle, i + 1)) hits.push(i);
  return hits;
}

/**
 * @param {{ gene: string, sequence: string, editIndex: number, fetchImpl?: Function, sleep?: Function }} input  editIndex is 0-based in `sequence`.
 * @returns {Promise<object>} { ok: true, chromosome, referenceStart, assembly, gene, comparison, anchor } or { ok: false, reason, message }
 */
export async function resolveReferenceMapping({ gene, sequence, editIndex, fetchImpl = (...a) => globalThis.fetch(...a), sleep = defaultSleep } = {}) {
  const ctx = { fetchImpl, sleep };
  const symbol = String(gene || "").trim();
  if (!/^[A-Za-z0-9@._-]{1,30}$/.test(symbol)) return fail("no-gene", "The design does not name a gene, so there is nothing to look up.");
  const reference = String(sequence || "").toUpperCase();
  if (!/^[ACGTN]+$/.test(reference) || reference.length > 1_000_000) return fail("no-sequence", "The uploaded reference is not a plain A/C/G/T/N sequence of at most 1 Mb.");
  if (!Number.isInteger(editIndex) || editIndex < 0 || editIndex >= reference.length) return fail("no-edit", "The position of the edit in the reference is not known.");
  try {
    const found = await get(`${ENSEMBL}/lookup/symbol/homo_sapiens/${encodeURIComponent(symbol)}?content-type=application/json`, ctx);
    if (!found.ok) return found.status === 400 || found.status === 404
      ? fail("not-found", `Ensembl has no human gene called ${symbol}.`)
      : fail("network", `Ensembl answered with status ${found.status}; try again later or enter the position by hand.`);
    const g = found.body;
    const chromosome = String(g?.seq_region_name ?? "").replace(/^chr/i, "").toUpperCase();
    if (g?.object_type !== "Gene" || !HUMAN_CHROMOSOME.test(chromosome)) return fail("not-found", `${symbol} is not a gene on a primary human chromosome in Ensembl.`);
    if (g.assembly_name !== "GRCh38") return fail("assembly", `Ensembl reports ${symbol} on ${g.assembly_name || "an unknown assembly"}; this tool uses GRCh38.`);
    if (Number(g.strand) !== 1) return fail("minus-strand", `${symbol} is on the reverse strand. Regulatory comparison supports plus-strand genes only, so no mapping was looked up.`);
    const geneStart = Number(g.start), geneEnd = Number(g.end), span = geneEnd - geneStart + 1;
    if (!Number.isSafeInteger(geneStart) || !Number.isSafeInteger(geneEnd) || span < 1) return fail("not-found", `Ensembl returned no usable position for ${symbol}.`);
    if (span > MAX_GENE_SPAN) return fail("too-large", `${symbol} spans ${fmt(span)} bases; the automatic lookup stops at ${fmt(MAX_GENE_SPAN)}. Enter the position by hand.`);

    const region = (start, end) => `${ENSEMBL}/sequence/region/homo_sapiens/${chromosome}:${start}..${end}:1?content-type=text/plain`;
    const geneSequenceResponse = await get(region(geneStart, geneEnd), ctx, true);
    if (!geneSequenceResponse.ok) return fail("network", `Ensembl could not return the sequence of ${symbol} (status ${geneSequenceResponse.status}).`);
    const geneSequence = geneSequenceResponse.body.toUpperCase();
    if (geneSequence.length !== span || !/^[ACGTN]+$/.test(geneSequence)) return fail("network", `Ensembl returned an unexpected sequence for ${symbol}.`);

    let anchor = null, tried = 0;
    for (const start of anchorStarts(reference.length, editIndex)) {
      const probe = reference.slice(start, start + ANCHOR_LENGTH);
      if (probe.includes("N") || new Set(probe).size < 3) continue;
      tried += 1;
      const hits = occurrences(geneSequence, probe);
      if (hits.length === 1) { anchor = { index: start, geneOffset: hits[0] }; break; }
    }
    if (!anchor) return fail(tried ? "not-found-in-gene" : "no-anchor", tried
      ? `The ${ANCHOR_LENGTH}-base stretches of the reference around the edit were not found exactly once inside ${symbol} (GRCh38). The reference may be a different gene or assembly, carry differences near the edit, or be repetitive there.`
      : "The reference around the edit has no usable stretch to search for.");

    const referenceStart = geneStart + anchor.geneOffset - anchor.index;
    const referenceEnd = referenceStart + reference.length - 1;
    if (referenceStart < 1) return fail("outside", "The reference would start before the beginning of the chromosome, so this placement is not valid.");
    let genome;
    if (referenceStart >= geneStart && referenceEnd <= geneEnd) genome = geneSequence.slice(referenceStart - geneStart, referenceStart - geneStart + reference.length);
    else {
      const flank = await get(region(referenceStart, referenceEnd), ctx, true);
      if (!flank.ok) return fail("outside", `Ensembl could not return GRCh38 chr${chromosome}:${fmt(referenceStart)}-${fmt(referenceEnd)} to check the reference against (status ${flank.status}).`);
      genome = flank.body.toUpperCase();
    }
    if (genome.length !== reference.length) return fail("network", "Ensembl returned a region of unexpected length.");
    let compared = 0, mismatches = 0;
    for (let i = 0; i < reference.length; i += 1) {
      if (reference[i] === "N" || genome[i] === "N") continue;
      compared += 1; if (reference[i] !== genome[i]) mismatches += 1;
    }
    if (!compared || mismatches / compared > MAX_MISMATCH_FRACTION) return fail("mismatch", `Placed at chr${chromosome}:${fmt(referenceStart)}, the reference differs from GRCh38 at ${fmt(mismatches)} of ${fmt(compared)} bases, too many to trust the placement. Enter the position by hand.`, { comparison: { compared, mismatches } });
    return { ok: true, chromosome, referenceStart, referenceEnd, assembly: "GRCh38", gene: { symbol: g.display_name || symbol, id: g.id, start: geneStart, end: geneEnd }, comparison: { length: reference.length, compared, mismatches, identity: 1 - mismatches / compared }, anchor: { index: anchor.index, length: ANCHOR_LENGTH } };
  } catch (error) {
    if (error instanceof Unreachable) return fail("network", "Ensembl could not be reached. Check the connection, or enter the position by hand.");
    throw error;
  }
}

/** One sentence for the page. */
export function describeMapping(result) {
  if (!result?.ok) return result?.message || "";
  const { comparison: c, gene, chromosome, referenceStart } = result;
  const same = c.mismatches === 0 ? `matches GRCh38 at all ${fmt(c.compared)} bases` : `matches GRCh38 at ${fmt(c.compared - c.mismatches)} of ${fmt(c.compared)} bases (${fmt(c.mismatches)} differ)`;
  return `Filled from Ensembl: ${gene.symbol} is on chromosome ${chromosome} (GRCh38) and the uploaded sequence starts at ${fmt(referenceStart)}; it ${same}. Check the numbers, then tick the box.`;
}
