// Fetch a gene or transcript from Ensembl or NCBI, or a ClinVar disease variant, and build the same GenBank reference that a
// Benchling "Import from genome" export gives: sense-oriented sequence, gene / exon / CDS features, and a COMMENT block whose
// "Location: chromosome:<assembly>:<chr>:<start>:<end>:<strand>" line the Genomic SNP tool already reads.
//
// Every request is a plain cross-origin GET (Ensembl REST, NCBI Datasets and NCBI E-utilities all answer with CORS headers), so the
// app needs no server and nothing leaves the browser except the identifier being looked up. The module is a leaf: it imports nothing
// and takes the fetch implementation as an argument so tests run on recorded responses.

const ENSEMBL = "https://rest.ensembl.org";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DATASETS = "https://api.ncbi.nlm.nih.gov/datasets/v2";

/**
 * The origins this module requests. The Vercel deployment sends a Content-Security-Policy whose connect-src must list exactly these (vercel.json);
 * a test compares the two, because a browser blocks any other origin with no more detail than "Failed to fetch".
 */
export const FETCH_ORIGINS = Object.freeze([ENSEMBL, EUTILS, DATASETS].map((url) => new URL(url).origin));

/** Bases kept on each side of the gene span, so homology arms and primers for tags near the gene ends have sequence to use. */
export const DEFAULT_FLANK = 1000;

/** Genomic SNP references carry more: the optional SpliceAI check (scripts/splice_check.py) needs 5,400 bases of reference on each side of the edit. */
export const SNP_FLANK = 6000;

export const SPECIES = Object.freeze({
  human: { label: "Human", ensembl: "homo_sapiens", taxon: "9606" },
  mouse: { label: "Mouse", ensembl: "mus_musculus", taxon: "10090" },
  rat: { label: "Rat", ensembl: "rattus_norvegicus", taxon: "10116" },
  zebrafish: { label: "Zebrafish", ensembl: "danio_rerio", taxon: "7955" },
});

export class GeneFetchError extends Error {
  constructor(message) { super(message); this.name = "GeneFetchError"; }
}

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", N: "N" };
const reverseComplement = (s) => s.split("").reverse().map((b) => COMPLEMENT[b] || "N").join("");
const CODONS = (() => {
  const bases = "TCAG"; const aa = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
  const table = {}; let i = 0;
  for (const a of bases) for (const b of bases) for (const c of bases) table[a + b + c] = aa[i++];
  return table;
})();
export const translateDna = (dna) => { let out = ""; for (let i = 0; i + 3 <= dna.length; i += 3) out += CODONS[dna.slice(i, i + 3)] || "X"; return out; };

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultFetch = (...args) => globalThis.fetch(...args);

async function request(url, { fetchImpl = defaultFetch, sleep = defaultSleep } = {}, what, asText = false) {
  let res = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { res = await fetchImpl(url); } catch { throw new GeneFetchError(`Could not reach ${what}. Check the connection and try again.`); }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
      const wait = Math.min(Number(res.headers?.get?.("retry-after")) || 1, 5);
      await sleep(wait * 1000 * (attempt + 1));
      continue;
    }
    break;
  }
  if (!res.ok) {
    let detail = "";
    try { const body = await res.json(); detail = body?.error || body?.message || ""; } catch { /* body was not JSON */ }
    const error = new GeneFetchError(`${what} returned ${res.status}${detail ? `: ${detail}` : ""}.`);
    error.status = res.status;
    throw error;
  }
  return asText ? res.text() : res.json();
}

// ---------------------------------------------------------------- queries

/**
 * What the user typed: an Ensembl transcript or gene ID, a RefSeq transcript accession, an NCBI Gene ID, a transcript name such as
 * PTPRO-201, or a gene symbol. Anything else is treated as a symbol.
 */
export function parseGeneQuery(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) throw new GeneFetchError("Enter a gene symbol, an Ensembl transcript ID (ENST…) or a RefSeq accession (NM_…).");
  if (/^ENS[A-Z]*T\d{6,}(\.\d+)?$/i.test(text)) return { kind: "ensembl-transcript", id: text.toUpperCase().replace(/\.\d+$/, ""), text };
  if (/^ENS[A-Z]*G\d{6,}(\.\d+)?$/i.test(text)) return { kind: "ensembl-gene", id: text.toUpperCase().replace(/\.\d+$/, ""), text };
  if (/^(NM|NR|XM|XR)_\d+(\.\d+)?$/i.test(text)) return { kind: "refseq-transcript", accession: text.toUpperCase(), text };
  if (/^\d+$/.test(text)) return { kind: "ncbi-gene-id", id: text, text };
  const named = text.match(/^([A-Za-z0-9@._]+)-(\d{3})$/);
  if (named) return { kind: "transcript-name", symbol: named[1], name: `${named[1].toUpperCase()}-${named[2]}`, text };
  if (/^[A-Za-z0-9@._-]+$/.test(text)) return { kind: "symbol", symbol: text, text };
  throw new GeneFetchError(`"${text}" is not a gene symbol or accession.`);
}

const speciesOf = (key) => SPECIES[key] || SPECIES.human;
const stripVersion = (id) => String(id || "").replace(/\.\d+$/, "");
const clampFlank = (flank) => Math.max(0, Math.min(Number.isFinite(Number(flank)) ? Math.floor(Number(flank)) : DEFAULT_FLANK, 20000));

// ---------------------------------------------------------------- Ensembl

const ens = (path, params = "") => `${ENSEMBL}${path}?${params}${params ? "&" : ""}content-type=application/json`;
const maneTypeOf = (transcript) => (Array.isArray(transcript?.MANE) ? transcript.MANE.map((m) => m.type).find((t) => /^MANE_Select$/i.test(t)) : null);

function pickEnsemblTranscript(gene, wanted) {
  const all = Array.isArray(gene?.Transcript) ? gene.Transcript : [];
  if (wanted) {
    const hit = all.find((t) => String(t.display_name || "").toUpperCase() === wanted.toUpperCase() || stripVersion(t.id) === wanted);
    if (!hit) throw new GeneFetchError(`${gene.display_name || gene.id} has no transcript named ${wanted}.`);
    if (!hit.Translation) throw new GeneFetchError(`${wanted} does not encode a protein (${hit.biotype || "no CDS"}); the design tools need a coding transcript.`);
    return hit;
  }
  const coding = all.filter((t) => t.Translation && Array.isArray(t.Exon) && t.Exon.length);
  if (!coding.length) throw new GeneFetchError(`${gene.display_name || gene.id} has no protein-coding transcript in Ensembl.`);
  const rank = (t) => (maneTypeOf(t) ? 2 : 0) + (t.is_canonical ? 1 : 0);
  return coding.slice().sort((a, b) => rank(b) - rank(a) || (b.Translation.length || 0) - (a.Translation.length || 0))[0];
}

async function lookupEnsemblGene(query, species, ctx) {
  if (query.kind === "ensembl-gene") return request(ens(`/lookup/id/${query.id}`, "expand=1&mane=1"), ctx, "Ensembl", false);
  if (query.kind === "ensembl-transcript") {
    const transcript = await request(ens(`/lookup/id/${query.id}`, "expand=1&mane=1"), ctx, "Ensembl");
    if (transcript.object_type !== "Transcript") throw new GeneFetchError(`${query.id} is not an Ensembl transcript.`);
    const gene = await request(ens(`/lookup/id/${transcript.Parent}`, "expand=1&mane=1"), ctx, "Ensembl");
    return { gene, transcript: gene.Transcript?.find((t) => t.id === transcript.id) || transcript };
  }
  const symbol = query.symbol;
  try {
    return await request(ens(`/lookup/symbol/${species.ensembl}/${encodeURIComponent(symbol)}`, "expand=1&mane=1"), ctx, "Ensembl");
  } catch (error) {
    if (error.status !== 400 && error.status !== 404) throw error;
    // Old names and aliases are not display names; the cross-reference search finds them.
    let refs = [];
    try { refs = await request(ens(`/xrefs/symbol/${species.ensembl}/${encodeURIComponent(symbol)}`, "object_type=gene"), ctx, "Ensembl"); } catch { /* handled below */ }
    const id = (Array.isArray(refs) ? refs : []).map((r) => r.id).find((x) => /^ENS[A-Z]*G\d+/.test(x));
    if (!id) throw new GeneFetchError(`Ensembl has no ${species.label.toLowerCase()} gene called ${symbol}.`);
    return request(ens(`/lookup/id/${id}`, "expand=1&mane=1"), ctx, "Ensembl");
  }
}

async function ensemblRelease(ctx) {
  try { const info = await request(ens("/info/data"), ctx, "Ensembl"); return Array.isArray(info?.releases) ? info.releases[0] : ""; } catch { return ""; }
}

async function chromosomeLength(species, chromosome, ctx) {
  try { const info = await request(ens(`/info/assembly/${species.ensembl}/${encodeURIComponent(chromosome)}`), ctx, "Ensembl"); return Number(info?.length) || null; } catch { return null; }
}

function exonsAndCds(transcript) {
  const exons = transcript.Exon.map((e) => [Number(e.start), Number(e.end)]).sort((a, b) => a[0] - b[0]);
  const t = transcript.Translation;
  const cds = [];
  for (const [start, end] of exons) {
    const a = Math.max(start, Number(t.start)); const b = Math.min(end, Number(t.end));
    if (a <= b) cds.push([a, b]);
  }
  return { exons, cds };
}

async function ensemblSpec(query, speciesKey, flank, ctx) {
  const species = speciesOf(speciesKey);
  let gene = await lookupEnsemblGene(query, species, ctx);
  let transcript = null;
  if (gene.gene && gene.transcript) ({ gene, transcript } = gene);
  if (gene.object_type && gene.object_type !== "Gene") throw new GeneFetchError(`${query.text} is not an Ensembl gene.`);
  transcript = transcript || pickEnsemblTranscript(gene, query.kind === "transcript-name" ? query.name : null);
  if (!transcript.Translation) throw new GeneFetchError(`${transcript.display_name || transcript.id} does not encode a protein (${transcript.biotype || "no CDS"}); the design tools need a coding transcript.`);
  const { exons, cds } = exonsAndCds(transcript);
  const chromosome = String(gene.seq_region_name);
  const mane = (transcript.MANE || []).find((m) => /^MANE_Select$/i.test(m.type));
  return {
    source: "ensembl",
    species: species.ensembl,
    gene: { symbol: gene.display_name || gene.id, id: gene.id },
    transcript: {
      id: `${transcript.id}${transcript.version ? `.${transcript.version}` : ""}`,
      name: transcript.display_name || transcript.id,
      protein: transcript.Translation.id ? `${transcript.Translation.id}${transcript.Translation.version ? `.${transcript.Translation.version}` : ""}` : "",
      proteinLength: Number(transcript.Translation.length) || null,
      biotype: transcript.biotype || "",
      mane: mane ? (mane.refseq_match || "MANE Select") : "",
      canonical: Boolean(transcript.is_canonical),
    },
    assembly: transcript.assembly_name || gene.assembly_name || "",
    chromosome,
    strand: Number(gene.strand) === -1 ? -1 : 1,
    geneStart: Number(gene.start),
    geneEnd: Number(gene.end),
    exons,
    cds,
    flank: clampFlank(flank),
    async sequenceFor(start, end, strand) {
      const body = await request(`${ENSEMBL}/sequence/region/${species.ensembl}/${encodeURIComponent(chromosome)}:${start}..${end}:${strand}?content-type=text/plain`, ctx, "Ensembl", true);
      return String(body).trim();
    },
    async chromosomeLength() { return chromosomeLength(species, chromosome, ctx); },
    async release() { return ensemblRelease(ctx); },
    provenance: `Ensembl REST (rest.ensembl.org)`,
  };
}

// ---------------------------------------------------------------- NCBI

const ncbiReportUrl = (query, species) => {
  if (query.kind === "refseq-transcript") return `${DATASETS}/gene/accession/${encodeURIComponent(query.accession)}/product_report`;
  if (query.kind === "ncbi-gene-id") return `${DATASETS}/gene/id/${query.id}/product_report`;
  return `${DATASETS}/gene/symbol/${encodeURIComponent(query.symbol)}/taxon/${species.taxon}/product_report`;
};

const primaryLocation = (transcript) => (transcript.genomic_locations || []).find((l) => /^NC_/.test(l.genomic_accession_version || "") && /Primary Assembly/i.test(l.sequence_name || ""));

function pickNcbiTranscript(transcripts, query) {
  const usable = transcripts.filter((t) => t.cds?.range?.length && primaryLocation(t) && /^NM_|^XM_/.test(t.accession_version));
  if (!usable.length) throw new GeneFetchError("NCBI lists no protein-coding RefSeq transcript for this gene on the primary assembly.");
  if (query.kind === "refseq-transcript") {
    const wanted = query.accession;
    const hit = usable.find((t) => t.accession_version.toUpperCase() === wanted || (!/\.\d+$/.test(wanted) && t.accession_version.toUpperCase().startsWith(`${wanted}.`)));
    if (!hit) throw new GeneFetchError(`${query.accession} is not a protein-coding transcript with a primary-assembly alignment.`);
    return hit;
  }
  const rank = (t) => (t.select_category === "MANE_SELECT" ? 4 : 0) + (/^NM_/.test(t.accession_version) ? 2 : 0);
  return usable.slice().sort((a, b) => rank(b) - rank(a) || (b.protein?.length || 0) - (a.protein?.length || 0))[0];
}

/** Maps a CDS given in transcript coordinates (1-based, as NCBI reports it) onto genomic segments. Exons are ascending genomic intervals. */
export function cdsToGenomic(exons, strand, begin, end) {
  const order = strand === -1 ? exons.slice().sort((a, b) => b[0] - a[0]) : exons.slice().sort((a, b) => a[0] - b[0]);
  const out = []; let t = 0;
  for (const [s, e] of order) {
    const length = e - s + 1; const lo = Math.max(begin, t + 1); const hi = Math.min(end, t + length);
    if (lo <= hi) out.push(strand === -1 ? [e - (hi - t) + 1, e - (lo - t) + 1] : [s + (lo - t) - 1, s + (hi - t) - 1]);
    t += length;
  }
  return out.sort((a, b) => a[0] - b[0]);
}

async function ncbiSpec(query, speciesKey, flank, ctx) {
  const species = speciesOf(speciesKey);
  const report = await request(ncbiReportUrl(query, species), ctx, "NCBI Datasets");
  const products = (report?.reports || []).map((r) => r.product).filter(Boolean);
  if (!products.length) throw new GeneFetchError(`NCBI has no gene record for ${query.text}.`);
  const product = query.kind === "symbol" || query.kind === "transcript-name"
    ? products.find((p) => String(p.symbol).toUpperCase() === String(query.symbol).toUpperCase()) || products[0]
    : products[0];
  const transcript = pickNcbiTranscript(product.transcripts || [], query);
  const location = primaryLocation(transcript);
  const orientation = location.genomic_range.orientation === "minus" ? -1 : 1;
  const exons = location.exons.map((e) => [Number(e.begin), Number(e.end)]).sort((a, b) => a[0] - b[0]);
  const cds = cdsToGenomic(exons, orientation, Number(transcript.cds.range[0].begin), Number(transcript.cds.range[transcript.cds.range.length - 1].end));
  // NCBI gene records do not carry their own span in this report; it is the union of the gene's transcripts on the primary assembly.
  const spans = (product.transcripts || []).map(primaryLocation).filter(Boolean).map((l) => [Number(l.genomic_range.begin), Number(l.genomic_range.end)]);
  const accession = location.genomic_accession_version;
  const chromosome = (String(location.sequence_name).match(/^Chromosome\s+(\S+)/i) || [])[1] || accession;
  const assemblyFull = (String(location.sequence_name).match(/Reference\s+(\S+)\s+Primary Assembly/i) || [])[1] || "";
  return {
    source: "ncbi",
    species: species.ensembl,
    gene: { symbol: product.symbol, id: `NCBI Gene ${product.gene_id}` },
    transcript: {
      id: transcript.accession_version,
      name: `${product.symbol} ${transcript.name || ""}`.trim(),
      protein: transcript.protein?.accession_version || "",
      proteinLength: Number(transcript.protein?.length) || null,
      biotype: transcript.type || "",
      mane: transcript.select_category === "MANE_SELECT" ? (transcript.ensembl_transcript || "MANE Select") : "",
      canonical: transcript.select_category === "MANE_SELECT",
    },
    assembly: assemblyFull.replace(/\.p\d+$/, ""),
    assemblyDetail: assemblyFull,
    chromosome,
    strand: orientation,
    geneStart: Math.min(...spans.map((s) => s[0])),
    geneEnd: Math.max(...spans.map((s) => s[1])),
    exons,
    cds,
    flank: clampFlank(flank),
    async sequenceFor(start, end, strand) {
      const params = new URLSearchParams({ db: "nuccore", id: accession, seq_start: String(start), seq_stop: String(end), strand: strand === -1 ? "2" : "1", rettype: "fasta", retmode: "text" });
      const body = await request(`${EUTILS}/efetch.fcgi?${params}`, ctx, "NCBI", true);
      return String(body).split("\n").filter((l) => !l.startsWith(">")).join("").trim();
    },
    async chromosomeLength() { return null; },
    async release() { return ""; },
    provenance: `NCBI Datasets and E-utilities (${accession})`,
  };
}

// ---------------------------------------------------------------- record

const toSense = (spec, gs, ge) => (spec.strand === -1 ? [spec.regionEnd - ge + 1, spec.regionEnd - gs + 1] : [gs - spec.regionStart + 1, ge - spec.regionStart + 1]);
const senseIndex = (spec, position) => (spec.strand === -1 ? spec.regionEnd - position + 1 : position - spec.regionStart + 1);

/** Where a forward genomic position sits on the transcript, in HGVS-style cDNA coordinates (c.1652, c.2829+1, c.-12, c.*5), or null outside it. */
export function cdnaCoordinate(spec, position) {
  const exons = spec.exons.map(([a, b]) => toSense(spec, a, b)).sort((x, y) => x[0] - y[0]);
  let cumulative = 0;
  const rows = exons.map(([s, e]) => { const row = { s, e, t0: cumulative }; cumulative += e - s + 1; return row; });
  const toT = (r) => { const row = rows.find((x) => r >= x.s && r <= x.e); return row ? row.t0 + (r - row.s) + 1 : null; };
  const cds = spec.cds.map(([a, b]) => toSense(spec, a, b)).sort((x, y) => x[0] - y[0]);
  const cdsStartT = toT(cds[0][0]); const cdsEndT = toT(cds[cds.length - 1][1]);
  const number = (t) => (t < cdsStartT ? `-${cdsStartT - t}` : t > cdsEndT ? `*${t - cdsEndT}` : `${t - cdsStartT + 1}`);
  const r = senseIndex(spec, position);
  const t = toT(r);
  if (t !== null) return `c.${number(t)}`;
  const before = [...rows].reverse().find((x) => x.e < r); const after = rows.find((x) => x.s > r);
  if (!before || !after) return null;
  const donor = r - before.e; const acceptor = after.s - r;
  return donor <= acceptor ? `c.${number(before.t0 + (before.e - before.s) + 1)}+${donor}` : `c.${number(after.t0 + 1)}-${acceptor}`;
}

const pad = (text, width) => String(text).padEnd(width);
function wrapQualifier(name, value) {
  const lines = []; const head = `/${name}="`; let rest = `${head}${value}"`;
  while (rest.length > 58) { lines.push(rest.slice(0, 58)); rest = rest.slice(58); }
  lines.push(rest);
  return lines.map((l) => `${" ".repeat(21)}${l}`);
}
function wrapLocation(key, location) {
  const out = []; let first = true; let rest = location;
  while (rest.length > 58) {
    let cut = rest.lastIndexOf(",", 58); if (cut < 1) cut = 58; else cut += 1;
    out.push(`${first ? `     ${pad(key, 16)}` : " ".repeat(21)}${rest.slice(0, cut)}`); first = false; rest = rest.slice(cut);
  }
  out.push(`${first ? `     ${pad(key, 16)}` : " ".repeat(21)}${rest}`);
  return out;
}
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const genBankDate = (date) => `${String(date.getUTCDate()).padStart(2, "0")}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;

/**
 * Builds the GenBank text for a resolved transcript. `spec.regionStart/regionEnd` are forward genomic coordinates and `spec.seq` is
 * the region in sense orientation (reverse-complemented for minus-strand genes, as in a Benchling genome import).
 */
export function buildGenBank(spec, { date = new Date() } = {}) {
  const length = spec.seq.length;
  if (length !== spec.regionEnd - spec.regionStart + 1) throw new GeneFetchError(`The sequence returned (${length} bp) does not match the requested region (${spec.regionEnd - spec.regionStart + 1} bp).`);
  if (!/^[ACGTN]+$/.test(spec.seq)) throw new GeneFetchError("The sequence returned contains characters other than A, C, G, T and N.");
  const exons = spec.exons.map(([a, b]) => toSense(spec, a, b)).sort((x, y) => x[0] - y[0]);
  const cds = spec.cds.map(([a, b]) => toSense(spec, a, b)).sort((x, y) => x[0] - y[0]);
  const geneSpan = toSense(spec, spec.geneStart, spec.geneEnd).sort((x, y) => x - y);
  const cdsSequence = cds.map(([s, e]) => spec.seq.slice(s - 1, e)).join("");
  const issues = [];
  if (cdsSequence.length % 3) issues.push(`The coding sequence is ${cdsSequence.length} nt, which is not a multiple of three.`);
  if (!cdsSequence.startsWith("ATG")) issues.push(`The coding sequence begins ${cdsSequence.slice(0, 3)}, not ATG.`);
  if (!/^(TAA|TAG|TGA)$/.test(cdsSequence.slice(-3))) issues.push("The coding sequence does not end in a stop codon.");
  const protein = translateDna(cdsSequence).replace(/\*$/, "");
  if (protein.includes("*")) issues.push("The coding sequence contains an internal stop codon (selenoprotein or annotation error).");
  if (spec.transcript.proteinLength && spec.transcript.proteinLength !== protein.length) issues.push(`The translated protein is ${protein.length} aa but ${spec.provenance} reports ${spec.transcript.proteinLength} aa.`);

  const idBare = stripVersion(spec.transcript.id);
  const label = String(spec.transcript.name || idBare);
  const lines = [];
  lines.push(`LOCUS       ${pad(`${spec.gene.symbol}_${idBare}`.replace(/[^A-Za-z0-9_.-]/g, "_"), 24)}${String(length).padStart(8)} bp ds-DNA     linear       ${genBankDate(date)}`);
  lines.push(`DEFINITION  ${spec.gene.symbol} ${spec.transcript.id}, ${spec.assembly} chromosome ${spec.chromosome}:${spec.regionStart}-${spec.regionEnd} (${spec.strand === -1 ? "reverse" : "forward"} strand shown as sense).`);
  const comment = [
    `Imported from genome: ${spec.assembly}${spec.release ? ` (Ensembl release ${spec.release})` : spec.assemblyDetail ? ` (${spec.assemblyDetail}, NCBI)` : ""}`,
    `Gene: ${spec.gene.id}`,
    `Location: chromosome:${spec.assembly}:${spec.chromosome}:${spec.regionStart}:${spec.regionEnd}:${spec.strand}`,
    `Transcript: ${label} (${idBare})`,
    ...(spec.transcript.mane ? [`MANE Select: ${spec.transcript.mane}`] : []),
    `Retrieved from ${spec.provenance} on ${date.toISOString().slice(0, 10)} by Assured CRISPR Design; gene span plus ${spec.flank} bp on each side.`,
  ];
  comment.forEach((text, i) => lines.push(`${i === 0 ? "COMMENT     " : " ".repeat(12)}${text}`));
  lines.push("FEATURES             Location/Qualifiers");
  lines.push(...wrapLocation("gene", `${geneSpan[0]}..${geneSpan[1]}`));
  lines.push(...wrapQualifier("label", spec.gene.symbol));
  exons.forEach(([s, e], i) => {
    lines.push(...wrapLocation("exon", `${s}..${e}`));
    lines.push(...wrapQualifier("label", `${label} Exon ${i + 1}`));
  });
  lines.push(...wrapLocation("CDS", cds.length > 1 ? `join(${cds.map(([s, e]) => `${s}..${e}`).join(",")})` : `${cds[0][0]}..${cds[0][1]}`));
  lines.push(...wrapQualifier("gene", spec.gene.symbol));
  lines.push(...wrapQualifier("transcript_id", spec.transcript.id));
  if (spec.transcript.protein) lines.push(...wrapQualifier("protein_id", spec.transcript.protein));
  lines.push(...wrapQualifier("translation", protein));
  lines.push("ORIGIN");
  for (let i = 0; i < length; i += 60) {
    const blocks = []; for (let j = i; j < Math.min(i + 60, length); j += 10) blocks.push(spec.seq.slice(j, Math.min(j + 10, length)));
    lines.push(`${String(i + 1).padStart(9)} ${blocks.join(" ")}`);
  }
  lines.push("//");
  return { text: `${lines.join("\n")}\n`, issues, protein, cdsLength: cdsSequence.length, exonCount: exons.length };
}

async function fillRegion(spec, extra = {}) {
  // `extra.include` widens the region so that a variant outside the gene span is still covered.
  const flank = spec.flank;
  let start = spec.geneStart - flank; let end = spec.geneEnd + flank;
  if (extra.include) { start = Math.min(start, extra.include - flank); end = Math.max(end, extra.include + flank); }
  start = Math.max(1, start);
  const limit = flank ? await spec.chromosomeLength() : null;
  if (limit) end = Math.min(end, limit);
  const warnings = [];
  const attempt = async (a, b) => {
    const raw = String(await spec.sequenceFor(a, b, spec.strand)).toUpperCase();
    if (raw.length !== b - a + 1) throw new GeneFetchError(`The sequence returned (${raw.length} bp) does not match the requested region (${b - a + 1} bp).`);
    return raw;
  };
  let raw;
  try { raw = await attempt(start, end); } catch (error) {
    if (!flank || extra.include) throw error;
    // A region that runs past a chromosome end is refused; the gene span alone is always valid.
    start = spec.geneStart; end = spec.geneEnd;
    raw = await attempt(start, end);
    warnings.push("The flanking sequence could not be fetched, so the reference covers the gene span only.");
  }
  spec.regionStart = start; spec.regionEnd = end; spec.seq = raw; spec.flank = start === spec.geneStart - flank ? flank : Math.min(spec.geneStart - start, end - spec.geneEnd);
  spec.release = await spec.release();
  return warnings;
}

function summarise(spec, built, warnings) {
  const strand = spec.strand === -1 ? "−" : "+";
  return {
    source: spec.source,
    gene: spec.gene.symbol,
    geneId: spec.gene.id,
    transcriptId: spec.transcript.id,
    transcriptName: spec.transcript.name,
    mane: spec.transcript.mane,
    assembly: spec.assembly,
    chromosome: spec.chromosome,
    strand: spec.strand,
    regionStart: spec.regionStart,
    regionEnd: spec.regionEnd,
    length: spec.seq.length,
    exonCount: built.exonCount,
    cdsLength: built.cdsLength,
    proteinLength: built.protein.length,
    text: `${spec.gene.symbol} · ${spec.transcript.name} (${spec.transcript.id})${spec.transcript.mane ? " · MANE Select" : spec.transcript.canonical ? " · canonical" : ""} · ${spec.assembly} chr${spec.chromosome}:${spec.regionStart.toLocaleString("en-US")}–${spec.regionEnd.toLocaleString("en-US")} (${strand}) · ${built.exonCount} exons · ${built.protein.length} aa`,
    warnings: [...warnings, ...built.issues],
  };
}

const fileNameFor = (spec) => `${spec.gene.symbol}_${stripVersion(spec.transcript.id)}.gb`.replace(/[^A-Za-z0-9_.-]/g, "_");

/**
 * Fetches a gene, transcript or RefSeq accession and returns the GenBank reference text plus a short summary.
 * Ensembl IDs are always answered by Ensembl and RefSeq accessions or NCBI Gene IDs by NCBI; a gene symbol uses `source`.
 */
export async function fetchGeneReference({ query, source = "ensembl", species = "human", flank = DEFAULT_FLANK, fetchImpl = defaultFetch, sleep = defaultSleep, date = new Date() } = {}) {
  const parsed = parseGeneQuery(query);
  const ctx = { fetchImpl, sleep };
  const useNcbi = parsed.kind === "refseq-transcript" || parsed.kind === "ncbi-gene-id" || ((parsed.kind === "symbol" || parsed.kind === "transcript-name") && source === "ncbi");
  if (parsed.kind === "transcript-name" && useNcbi) throw new GeneFetchError("Transcript names such as PTPRO-201 are Ensembl names. Use an NM_ accession for NCBI, or switch the source to Ensembl.");
  try {
    const spec = useNcbi ? await ncbiSpec(parsed, species, flank, ctx) : await ensemblSpec(parsed, species, flank, ctx);
    const warnings = await fillRegion(spec);
    const built = buildGenBank(spec, { date });
    return { genbank: built.text, fileName: fileNameFor(spec), summary: summarise(spec, built, warnings), spec: { ...spec, seq: undefined } };
  } catch (error) {
    // Public services have outages; for a gene symbol the other service can answer the same question.
    const down = error instanceof GeneFetchError && (error.status >= 500 || /^Could not reach/.test(error.message));
    if (down && parsed.kind === "symbol") {
      error.message += ` ${useNcbi ? "Ensembl" : "NCBI"} can resolve gene symbols too: switch the source and try again.`;
    }
    throw error;
  }
}

// ---------------------------------------------------------------- ClinVar

const clinvarTerm = (raw) => {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) throw new GeneFetchError("Enter a ClinVar variation ID, VCV accession, rsID or HGVS name.");
  const vcv = text.match(/^VCV0*(\d+)(\.\d+)?$/i);
  if (vcv) return `${vcv[1]}[Variation ID]`;
  if (/^\d+$/.test(text)) return `${text}[Variation ID]`;
  return text;
};

function parseSpdi(spdi) {
  const m = String(spdi || "").match(/^(NC_\d+\.\d+):(\d+):([A-Za-z]*):([A-Za-z]*)$/);
  return m ? { accession: m[1], position: Number(m[2]) + 1, deleted: m[3].toUpperCase(), inserted: m[4].toUpperCase() } : null;
}

/** The cDNA position in a ClinVar variant name ("NM_030667.3(PTPRO):c.2829+1G>A" gives "c.2829+1"), or "" when the name is not a single substitution. */
export function cdnaFromVariantName(text) {
  const m = /\bc\.([-*]?\d+(?:[+-]\d+)?)[ACGT]>[ACGT]\b/.exec(String(text || ""));
  return m ? `c.${m[1]}` : "";
}

function describeClinVar(record) {
  const set = record.variation_set?.[0] || {};
  const titleGene = (String(record.title || "").match(/\(([^)]+)\)/) || [])[1];
  const genes = (record.genes || []).filter((g) => !/^LOC\d+$/.test(g.symbol));
  const gene = genes.find((g) => g.symbol === titleGene) || genes[0] || null;
  const location = (set.variation_loc || []).find((l) => l.status === "current" && l.assembly_name === "GRCh38");
  const spdi = parseSpdi(set.canonical_spdi);
  const type = record.obj_type || set.variant_type || "";
  // Haplotypes and compound records list several variants; only a record that is itself one substitution is designable.
  const single = type === "single nucleotide variant" && (record.variation_set || []).length === 1;
  const isSnv = Boolean(single && spdi && /^[ACGT]$/.test(spdi.deleted) && /^[ACGT]$/.test(spdi.inserted) && spdi.deleted !== spdi.inserted);
  const classification = record.germline_classification || record.clinical_significance || {};
  const chromosome = location?.chr || "";
  const reason = !isSnv
    ? (type === "Haplotype"
      ? "This ClinVar record is a haplotype (several variants on one allele). Search for the individual variant instead."
      : `${type ? `${type[0].toUpperCase()}${type.slice(1)}` : "This record"} is not a single-base substitution; the Genomic SNP designer handles substitutions only.`)
    : !gene ? "ClinVar names no gene for this variant." : !chromosome ? "ClinVar has no GRCh38 position for this variant." : "";
  return {
    id: String(record.uid),
    accession: record.accession_version || record.accession || "",
    title: record.title || "",
    type,
    gene: gene?.symbol || "",
    geneId: gene?.geneid || "",
    geneStrand: gene?.strand === "-" ? -1 : 1,
    significance: classification.description || "Not provided",
    review: classification.review_status || "",
    conditions: (classification.trait_set || []).map((t) => t.trait_name).filter(Boolean),
    proteinChange: record.protein_change || "",
    cdnaChange: set.cdna_change || set.variation_name || record.title || "",
    supported: !reason,
    unsupportedReason: reason,
    variant: !reason ? { assembly: "GRCh38", chromosome, position: spdi.position, ref: spdi.deleted, alt: spdi.inserted } : null,
  };
}

/** Looks a variant up in ClinVar by variation ID, VCV accession, rsID, HGVS name ("NM_000492.4:c.1652G>A") or "GENE c.1652G>A". */
export async function searchClinVar(query, { fetchImpl = defaultFetch, sleep = defaultSleep, limit = 12 } = {}) {
  const ctx = { fetchImpl, sleep };
  const term = clinvarTerm(query);
  const found = await request(`${EUTILS}/esearch.fcgi?${new URLSearchParams({ db: "clinvar", term, retmode: "json", retmax: String(limit) })}`, ctx, "ClinVar");
  const ids = found?.esearchresult?.idlist || [];
  if (!ids.length) throw new GeneFetchError(`ClinVar has no record matching "${String(query).trim()}". Try the variation ID, an rsID, or an HGVS name such as NM_000492.4:c.1652G>A.`);
  const summary = await request(`${EUTILS}/esummary.fcgi?${new URLSearchParams({ db: "clinvar", id: ids.join(","), retmode: "json" })}`, ctx, "ClinVar");
  const records = (summary?.result?.uids || []).map((uid) => summary.result[uid]).filter(Boolean).map(describeClinVar).sort((a, b) => Number(b.supported) - Number(a.supported));
  return { total: Number(found.esearchresult.count) || records.length, variants: records };
}

/**
 * Builds the reference for a ClinVar single-base variant: the gene's MANE Select (else canonical) transcript from Ensembl, checked
 * against the ClinVar reference base, with the variant's cDNA coordinate on that transcript for comparison with ClinVar's own.
 */
export async function fetchVariantReference(variantRecord, { flank = SNP_FLANK, fetchImpl = defaultFetch, sleep = defaultSleep, date = new Date() } = {}) {
  if (!variantRecord?.supported) throw new GeneFetchError(variantRecord?.unsupportedReason || "This variant cannot be designed.");
  const v = variantRecord.variant;
  const ctx = { fetchImpl, sleep };
  const spec = await ensemblSpec({ kind: "symbol", symbol: variantRecord.gene, text: variantRecord.gene }, "human", flank, ctx);
  if (spec.chromosome !== String(v.chromosome).replace(/^chr/i, "")) throw new GeneFetchError(`ClinVar places this variant on chromosome ${v.chromosome} but Ensembl places ${variantRecord.gene} on chromosome ${spec.chromosome}.`);
  const warnings = await fillRegion(spec, { include: v.position });
  // The record is written along the transcript, so a reverse-strand gene is read from the far end and complemented.
  const index = senseIndex(spec, v.position) - 1; // senseIndex counts from 1
  if (index < 0 || index >= spec.seq.length) throw new GeneFetchError("The variant lies outside the fetched reference.");
  const forwardBase = spec.strand === -1 ? COMPLEMENT[spec.seq[index]] : spec.seq[index];
  if (forwardBase !== v.ref) throw new GeneFetchError(`ClinVar reports ${v.ref} at ${v.assembly} chr${v.chromosome}:${v.position}, but the Ensembl reference has ${forwardBase}. The two sources disagree on this position; do not design from either without checking.`);
  const built = buildGenBank(spec, { date });
  const mine = cdnaCoordinate(spec, v.position);
  const theirs = cdnaFromVariantName(variantRecord.cdnaChange) || cdnaFromVariantName(variantRecord.title);
  const notes = [];
  if (mine && theirs && mine !== theirs) notes.push(`ClinVar names this variant ${theirs}; on the Ensembl transcript ${spec.transcript.id} it is ${mine}. ClinVar probably uses a different transcript — check before ordering.`);
  if (!mine) notes.push("The variant lies outside the transcript (promoter or flanking sequence).");
  return {
    genbank: built.text,
    fileName: fileNameFor(spec),
    summary: summarise(spec, built, [...warnings, ...notes]),
    input: { gene: variantRecord.gene, assembly: spec.assembly, chromosome: spec.chromosome, referenceStart: spec.regionStart, position: v.position, ref: v.ref, alt: v.alt, forwardConfirmed: true },
    cdna: mine,
    clinvarCdna: theirs,
  };
}
