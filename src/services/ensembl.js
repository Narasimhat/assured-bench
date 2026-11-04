/**
 * Ensembl REST API Service for automated transcript & CDS retrieval.
 * Eliminates manual GenBank file creation by fetching MANE Select / Canonical records.
 */

const ENSEMBL_REST_URL = "https://rest.ensembl.org";

async function fetchJson(url, description) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000)
    });
  } catch (err) {
    throw new Error(`Could not reach Ensembl while ${description}. Check your connection or upload a GenBank reference.`, { cause: err });
  }
  if (!response.ok) {
    const error = new Error(response.status >= 500
      ? `Ensembl is temporarily unavailable (HTTP ${response.status}). Retry later or upload a GenBank reference.`
      : `Ensembl could not complete ${description} (HTTP ${response.status}). Check the gene symbol or upload a GenBank reference.`);
    error.status = response.status;
    throw error;
  }
  try {
    return await response.json();
  } catch (err) {
    throw new Error("Ensembl returned an unreadable response. Retry later or upload a GenBank reference.", { cause: err });
  }
}

export async function fetchGeneGenbank(geneSymbol, species = "homo_sapiens") {
  try {
    return await fetchEnsemblGeneGenbank(geneSymbol, species);
  } catch (error) {
    const sym = (geneSymbol || "").trim().toUpperCase();
    const base = import.meta.env?.BASE_URL || "/";

    if (species === "homo_sapiens" && ["TP53", "ENSG00000141510"].includes(sym)) {
      try {
        const response = await fetch(`${base}references/tp53-NG_017013.2.gb`);
        if (response.ok) {
          const genbankText = await response.text();
          if (genbankText.includes("ORIGIN")) {
            return {
              geneSymbol: "TP53", ensemblId: "ENSG00000141510", transcriptId: "NM_000546.5",
              referenceAccession: "NG_017013.2", proteinId: "NP_000537.3", chr: "17",
              source: "Bundled NCBI RefSeqGene", sourceUrl: "https://www.ncbi.nlm.nih.gov/nuccore/NG_017013.2",
              warning: "Ensembl lookup failed. Using bundled NCBI RefSeqGene NG_017013.2, TP53 variant 1 (NM_000546.5 / NP_000537.3).",
              genbankText, sequenceLength: 32772
            };
          }
        }
      } catch {}
    }

    if (species === "homo_sapiens" && ["APOE", "ENSG00000130203"].includes(sym)) {
      try {
        const response = await fetch(`${base}references/apoe-ensg00000130203.gb`);
        if (response.ok) {
          const genbankText = await response.text();
          if (genbankText.includes("ORIGIN")) {
            return {
              geneSymbol: "APOE", ensemblId: "ENSG00000130203", transcriptId: "ENST00000252486",
              referenceAccession: "APOE_(ENSG00000130203)", proteinId: "CCDS12647", chr: "19",
              source: "Bundled Reference", sourceUrl: "https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=ENSG00000130203",
              warning: "Ensembl lookup failed. Using bundled APOE reference (ENSG00000130203 / ENST00000252486).",
              genbankText, sequenceLength: 3640
            };
          }
        }
      } catch {}
    }

    if (species === "homo_sapiens" && ["DIPK2A", "C3ORF58", "ENSG00000181744"].includes(sym)) {
      try {
        const response = await fetch(`${base}references/dipk2a-region.gb`);
        if (response.ok) {
          const genbankText = await response.text();
          if (genbankText.includes("ORIGIN")) {
            return {
              geneSymbol: "DIPK2A", ensemblId: "ENSG00000181744", transcriptId: "NM_173552.5",
              referenceAccession: "NM_173552.5", proteinId: "NP_775823.2", chr: "3",
              source: "Bundled Reference", sourceUrl: "https://www.ncbi.nlm.nih.gov/nuccore/NM_173552.5",
              warning: "Ensembl lookup failed. Using bundled DIPK2A reference (NM_173552.5).",
              genbankText, sequenceLength: genbankText.length
            };
          }
        }
      } catch {}
    }

    if (species === "homo_sapiens" && ["NR2F2", "ENSG00000185551"].includes(sym)) {
      try {
        const response = await fetch(`${base}references/nr2f2-ng016753.gb`);
        if (response.ok) {
          const genbankText = await response.text();
          if (genbankText.includes("ORIGIN")) {
            return {
              geneSymbol: "NR2F2", ensemblId: "ENSG00000185551", transcriptId: "NM_021005.4",
              referenceAccession: "NG_016753.1", proteinId: "NP_066285.1", chr: "15",
              source: "Bundled NCBI RefSeqGene", sourceUrl: "https://www.ncbi.nlm.nih.gov/nuccore/NG_016753.1",
              warning: "Ensembl lookup failed. Using bundled NR2F2 reference (NG_016753.1).",
              genbankText, sequenceLength: genbankText.length
            };
          }
        }
      } catch {}
    }

    if (species === "homo_sapiens" && ["INS", "ENSG00000254647"].includes(sym)) {
      try {
        const response = await fetch(`${base}references/ins-ensg00000254647.gb`);
        if (response.ok) {
          const genbankText = await response.text();
          if (genbankText.includes("ORIGIN")) {
            return {
              geneSymbol: "INS", ensemblId: "ENSG00000254647", transcriptId: "ENST00000381330",
              referenceAccession: "INS_(ENSG00000254647)", proteinId: "NP_000198.1", chr: "11",
              source: "Bundled Reference", sourceUrl: "https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=ENSG00000254647",
              warning: "Ensembl lookup failed. Using bundled INS reference (ENSG00000254647).",
              genbankText, sequenceLength: genbankText.length
            };
          }
        }
      } catch {}
    }

    try {
      return await fetchMyGeneUcscGenbank(geneSymbol, species);
    } catch {}

    throw error;
  }
}

/**
 * High-availability fallback using MyGene.info + UCSC Genome Browser REST API when rest.ensembl.org is unavailable (e.g. HTTP 500).
 */
async function fetchMyGeneUcscGenbank(geneSymbol, species = "homo_sapiens") {
  const sym = (geneSymbol || "").trim().toUpperCase();
  if (!sym) throw new Error("Enter a gene symbol.");
  const speciesMap = {
    homo_sapiens: { mygene: "human", ucsc: "hg38", assembly: "GRCh38", organism: "Homo sapiens" },
    mus_musculus: { mygene: "mouse", ucsc: "mm39", assembly: "GRCm39", organism: "Mus musculus" },
    rattus_norvegicus: { mygene: "rat", ucsc: "rn7", assembly: "mRatBN7.2", organism: "Rattus norvegicus" },
    danio_rerio: { mygene: "zebrafish", ucsc: "danRer11", assembly: "GRCz11", organism: "Danio rerio" },
  };
  const cfg = speciesMap[species];
  if (!cfg) throw new Error(`Unsupported species for UCSC fallback: ${species}`);
  const qExpr = /^ENS[A-Z]*G\d+/i.test(sym) ? `ensembl.gene:${sym.split(".")[0]}` : `symbol:${sym}`;
  const mgUrl = `https://mygene.info/v3/query?q=${encodeURIComponent(qExpr)}&species=${cfg.mygene}&fields=symbol,name,ensembl.gene,exons,genomic_pos`;
  const mgData = await fetchJson(mgUrl, `looking up '${sym}' via MyGene`);
  const hits = Array.isArray(mgData?.hits) ? mgData.hits : [];
  const hit = hits.find(h => String(h.symbol || "").toUpperCase() === sym && h.exons) || hits.find(h => h.exons) || null;
  if (!hit) throw new Error(`No transcript exon annotations found for '${sym}'.`);
  const exonsList = Array.isArray(hit.exons) ? hit.exons : [hit.exons];
  const codingList = exonsList.filter(e => e && Array.isArray(e.position) && e.position.length > 0 && Number.isFinite(e.cdsstart) && Number.isFinite(e.cdsend) && e.cdsstart < e.cdsend);
  const chosen = (codingList.length ? codingList : exonsList).sort((a, b) => ((b.cdsend || b.txend) - (b.cdsstart || b.txstart)) - ((a.cdsend || a.txend) - (a.cdsstart || a.txstart)))[0];
  if (!chosen || !Array.isArray(chosen.position) || !chosen.position.length) throw new Error(`Incomplete exon coordinates for '${sym}'.`);

  const chr = String(chosen.chr || "").replace(/^chr/i, "");
  const strand = chosen.strand === -1 ? -1 : 1;
  const padding = 1500;
  const start = Math.max(1, Number(chosen.txstart) + 1 - padding);
  const end = Number(chosen.txend) + padding;
  const ucscUrl = `https://api.genome.ucsc.edu/getData/sequence?genome=${cfg.ucsc};chrom=chr${chr};start=${start - 1};end=${end}`;
  const seqData = await fetchJson(ucscUrl, "loading genomic sequence from UCSC");
  const dnaSeq = String(seqData?.dna || "").toLowerCase();
  if (!/^[acgtn]+$/.test(dnaSeq) || dnaSeq.length !== end - start + 1) {
    throw new Error("UCSC returned an incomplete genomic sequence.");
  }

  const ensemblId = (Array.isArray(hit.ensembl) ? hit.ensembl[0]?.gene : hit.ensembl?.gene) || hit.symbol || sym;
  const transcriptId = chosen.transcript || `${hit.symbol || sym}_canonical`;
  const exons = chosen.position.map(([eStart0, eEnd1], idx) => ({
    id: `${transcriptId}_exon${idx + 1}`,
    start: Number(eStart0) + 1,
    end: Number(eEnd1),
  }));
  const translation = Number.isFinite(chosen.cdsstart) && Number.isFinite(chosen.cdsend) && chosen.cdsstart < chosen.cdsend
    ? { id: `${transcriptId}_cds`, start: Number(chosen.cdsstart) + 1, end: Number(chosen.cdsend) }
    : null;

  const gbContent = buildSyntheticGenbank({
    gene: hit.symbol || sym,
    ensemblGeneId: ensemblId,
    transcriptId,
    assembly: cfg.assembly,
    organism: cfg.organism,
    isCanonical: true,
    chr,
    genomicStart: start,
    genomicEnd: end,
    strand,
    exons,
    translation,
    sequence: dnaSeq,
  });

  return {
    geneSymbol: hit.symbol || sym,
    ensemblId,
    transcriptId,
    isCanonical: true,
    assembly: cfg.assembly,
    source: "UCSC / NCBI RefSeq (Ensembl fallback)",
    chr,
    genomicStart: start,
    genomicEnd: end,
    strand,
    referenceOrientation: "gene",
    ...(strand === -1 ? { warning: "Reverse-strand gene: the reference sequence and exon coordinates are oriented in the gene direction. Guide strands and positions are relative to this reference, not chromosome plus." } : {}),
    genbankText: gbContent,
    sequenceLength: dnaSeq.length,
  };
}

/**
 * Search for genes by symbol prefix (Autocomplete)
 */
export async function searchGeneSymbols(query, species = "homo_sapiens") {
  if (!query || query.trim().length < 2) return [];
  try {
    const url = `${ENSEMBL_REST_URL}/lookup/symbol/${species}/${encodeURIComponent(query.trim())}?expand=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      return [{
        id: data.id,
        symbol: data.display_name,
        description: data.description,
        biotype: data.biotype,
        seq_region_name: data.seq_region_name,
        start: data.start,
        end: data.end,
        strand: data.strand
      }];
    }
  } catch {}
  try {
    const sym = query.trim().toUpperCase();
    const mgRes = await fetch(`https://mygene.info/v3/query?q=symbol:${encodeURIComponent(sym)}&species=human&fields=symbol,name,ensembl.gene,genomic_pos&size=3`);
    if (!mgRes.ok) return [];
    const mgData = await mgRes.json();
    return (mgData.hits || []).filter(h => h.symbol).map(h => {
      const gp = Array.isArray(h.genomic_pos) ? h.genomic_pos[0] : h.genomic_pos;
      const eid = (Array.isArray(h.ensembl) ? h.ensembl[0]?.gene : h.ensembl?.gene) || h.symbol;
      return {
        id: eid,
        symbol: h.symbol,
        description: h.name || "",
        biotype: "protein_coding",
        seq_region_name: gp?.chr || "",
        start: gp?.start || 0,
        end: gp?.end || 0,
        strand: gp?.strand || 1,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fetch full gene model with MANE Select / Canonical transcript and generate a synthetic GenBank format
 */
async function fetchEnsemblGeneGenbank(geneSymbol, species = "homo_sapiens") {
  const symbol = geneSymbol.trim().toUpperCase();
  const lookupPath = /^ENSG\d+(?:\.\d+)?$/.test(symbol)
    ? `lookup/id/${encodeURIComponent(symbol)}`
    : `lookup/symbol/${species}/${encodeURIComponent(symbol)}`;
  const lookupUrl = `${ENSEMBL_REST_URL}/${lookupPath}?expand=1&content-type=application/json`;
  const geneData = await fetchJson(lookupUrl, `looking up '${symbol}'`);

  // Prefer the explicitly declared canonical transcript over a conflicting flag.
  const transcripts = geneData.Transcript || [];
  const canonId = (geneData.canonical_transcript || "").split(".")[0];
  let primaryTranscript = transcripts.find(t => String(t.id).split(".")[0] === canonId)
    || transcripts.find(t => t.is_canonical === 1 || t.is_canonical === true);
  if (!primaryTranscript && transcripts.length > 0) {
    primaryTranscript = transcripts.find(t => t.Translation) || transcripts[0];
  }

  if (!primaryTranscript) {
    throw new Error(`No transcript found for gene ${geneSymbol}.`);
  }

  // Fetch genomic DNA sequence for the transcript region (with padding for primers and homology)
  const chr = geneData.seq_region_name;
  const padding = 1500;
  const start = Math.max(1, primaryTranscript.start - padding);
  const end = primaryTranscript.end + padding;

  const seqUrl = `${ENSEMBL_REST_URL}/sequence/region/${species}/${chr}:${start}..${end}:1?mask_feature=0`;
  const seqData = await fetchJson(seqUrl, "loading the genomic sequence");
  const dnaSeq = String(seqData.seq || "").toLowerCase();
  if (!/^[acgtn]+$/.test(dnaSeq) || dnaSeq.length !== end - start + 1) {
    throw new Error("Ensembl returned a sequence that does not match the requested genomic interval. Retry or upload a verified GenBank reference.");
  }
  if (![1, -1].includes(primaryTranscript.strand)) throw new Error("Ensembl did not provide a valid transcript strand.");
  const assembly = geneData.assembly_name || primaryTranscript.assembly_name || null;
  const organism = { homo_sapiens: "Homo sapiens", mus_musculus: "Mus musculus", rattus_norvegicus: "Rattus norvegicus", danio_rerio: "Danio rerio" }[species] || species.replace(/_/g, " ");
  const isCanonical = Boolean(primaryTranscript.is_canonical || String(primaryTranscript.id).split(".")[0] === canonId);

  const transcriptId = /\.\d+$/.test(primaryTranscript.id) ? primaryTranscript.id
    : primaryTranscript.version ? `${primaryTranscript.id}.${primaryTranscript.version}`
    : primaryTranscript.id === canonId && /\.\d+$/.test(geneData.canonical_transcript || "") ? geneData.canonical_transcript : primaryTranscript.id;

  // Build synthetic GenBank content compatible with transcriptModel.js
  const gbContent = buildSyntheticGenbank({
    gene: geneData.display_name,
    ensemblGeneId: geneData.id,
    transcriptId,
    assembly, organism, isCanonical,
    chr,
    genomicStart: start,
    genomicEnd: end,
    strand: primaryTranscript.strand,
    exons: primaryTranscript.Exon || [],
    translation: primaryTranscript.Translation,
    sequence: dnaSeq
  });

  return {
    geneSymbol: geneData.display_name,
    ensemblId: geneData.id,
    transcriptId,
    isCanonical,
    assembly,
    source: "Ensembl",
    chr,
    genomicStart: start,
    genomicEnd: end,
    strand: primaryTranscript.strand,
    referenceOrientation: "gene",
    ...(primaryTranscript.strand === -1 ? { warning: "Reverse-strand gene: the reference sequence and exon coordinates are oriented in the gene direction. Guide strands and positions are relative to this reference, not chromosome plus." } : {}),
    genbankText: gbContent,
    sequenceLength: dnaSeq.length
  };
}

/**
 * Format data into valid GenBank format string
 */
function buildSyntheticGenbank({ gene, ensemblGeneId, transcriptId, assembly, organism, isCanonical, chr, genomicStart, genomicEnd, strand, exons, translation, sequence }) {
  const dateStr = new Date().toISOString().split("T")[0].toUpperCase();
  const locusName = (gene.replace(/[^A-Za-z0-9_]/g, "_") + "_REF").slice(0, 16);
  const seqLen = sequence.length;
  // The native design model expects an increasing, gene-oriented CDS. A GenBank
  // complement() qualifier alone is not interpreted by that model.
  const orientedSequence = strand === -1
    ? [...sequence].reverse().map(base => ({ a: "t", t: "a", c: "g", g: "c", n: "n" }[base.toLowerCase()] || base)).join("")
    : sequence;
  const relativeInterval = (start, end) => strand === -1
    ? [genomicEnd - end + 1, genomicEnd - start + 1]
    : [start - genomicStart + 1, end - genomicStart + 1];

  let gb = `LOCUS       ${locusName.padEnd(16)} ${seqLen} bp    DNA     linear   SYN ${dateStr}\n`;
  gb += `DEFINITION  ${gene} (${transcriptId}) extracted from Ensembl ${assembly || "assembly not reported"} chr${chr}:${genomicStart}..${genomicEnd}; reference oriented in the gene direction (chromosome strand ${strand}).\n`;
  gb += `ACCESSION   ${transcriptId}\n`;
  gb += `VERSION     ${transcriptId}\n`;
  gb += `KEYWORDS    Ensembl ${isCanonical ? "canonical transcript" : "transcript"}.\n`;
  gb += `SOURCE      ${organism}\n`;
  gb += `  ORGANISM  ${organism}\n`;
  if (assembly) gb += `COMMENT     Location: chromosome:${assembly}:${chr}:${genomicStart}:${genomicEnd}:${strand}\n`;
  gb += `FEATURES             Location/Qualifiers\n`;
  gb += `     source          1..${seqLen}\n`;
  gb += `                     /organism="${organism}"\n`;
  gb += `                     /chromosome="${chr}"\n`;
  gb += `                     /gene="${gene}"\n`;
  gb += `                     /db_xref="Ensembl:${ensemblGeneId}"\n`;
  gb += `     gene            1..${seqLen}\n`;
  gb += `                     /gene="${gene}"\n`;

  // Exon 1 is the biological first exon, including on reverse-strand genes.
  const sortedExons = [...exons].sort((a, b) => strand === -1 ? b.start - a.start : a.start - b.start);

  sortedExons.forEach((exon, idx) => {
    const [relStart, relEnd] = relativeInterval(exon.start, exon.end);
    if (relStart >= 1 && relEnd <= seqLen) {
      gb += `     exon            ${relStart}..${relEnd}\n`;
      gb += `                     /gene="${gene}"\n`;
      gb += `                     /number="${idx + 1}"\n`;
      gb += `                     /note="exon_id=${exon.id}"\n`;
    }
  });

  // Add CDS if translation exists
  if (translation && sortedExons.length > 0) {
    const codingExons = sortedExons.filter(e => e.end >= translation.start && e.start <= translation.end);
    if (codingExons.length > 0) {
      const intervals = codingExons.map((e, i) => {
        const [cStart, cEnd] = relativeInterval(Math.max(e.start, translation.start), Math.min(e.end, translation.end));
        return `${cStart}..${cEnd}`;
      });

      const cdsLoc = intervals.length > 1 ? `join(${intervals.join(",")})` : intervals[0];
      const finalLoc = cdsLoc;

      gb += `     CDS             ${finalLoc}\n`;
      gb += `                     /gene="${gene}"\n`;
      gb += `                     /protein_id="${translation.id}"\n`;
      gb += `                     /transcript_id="${transcriptId}"\n`;
      gb += `                     /translation=""\n`;
    }
  }

  // Format ORIGIN sequence block (60 nt per line, 10 nt blocks)
  gb += `ORIGIN\n`;
  for (let i = 0; i < seqLen; i += 60) {
    const lineNum = String(i + 1).padStart(9, " ");
    const chunk = orientedSequence.slice(i, i + 60);
    const blocks = [];
    for (let j = 0; j < chunk.length; j += 10) {
      blocks.push(chunk.slice(j, j + 10));
    }
    gb += `${lineNum} ${blocks.join(" ")}\n`;
  }
  gb += `//\n`;

  return gb;
}
