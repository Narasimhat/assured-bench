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

    throw error;
  }
}

/**
 * Search for genes by symbol prefix (Autocomplete)
 */
export async function searchGeneSymbols(query, species = "homo_sapiens") {
  if (!query || query.trim().length < 2) return [];
  try {
    const url = `${ENSEMBL_REST_URL}/lookup/symbol/${species}/${encodeURIComponent(query.trim())}?expand=1`;
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
      strand: data.strand
    }];
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

  // Find MANE Select or Canonical transcript
  const transcripts = geneData.Transcript || [];
  const canonId = (geneData.canonical_transcript || "").split(".")[0];
  let primaryTranscript = transcripts.find(t => t.id === canonId || t.is_canonical === 1 || t.is_canonical === true);
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
  const dnaSeq = seqData.seq.toLowerCase();

  // Build synthetic GenBank content compatible with transcriptModel.js
  const gbContent = buildSyntheticGenbank({
    gene: geneData.display_name,
    ensemblGeneId: geneData.id,
    transcriptId: primaryTranscript.id,
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
    transcriptId: primaryTranscript.id,
    isCanonical: primaryTranscript.is_canonical,
    source: "Ensembl",
    chr,
    genomicStart: start,
    genomicEnd: end,
    strand: primaryTranscript.strand,
    genbankText: gbContent,
    sequenceLength: dnaSeq.length
  };
}

/**
 * Format data into valid GenBank format string
 */
function buildSyntheticGenbank({ gene, ensemblGeneId, transcriptId, chr, genomicStart, genomicEnd, strand, exons, translation, sequence }) {
  const dateStr = new Date().toISOString().split("T")[0].toUpperCase();
  const locusName = (gene.replace(/[^A-Za-z0-9_]/g, "_") + "_REF").slice(0, 16);
  const seqLen = sequence.length;

  let gb = `LOCUS       ${locusName.padEnd(16)} ${seqLen} bp    DNA     linear   SYN ${dateStr}\n`;
  gb += `DEFINITION  ${gene} (${transcriptId}) extracted from Ensembl GRCh38 chr${chr}:${genomicStart}..${genomicEnd}.\n`;
  gb += `ACCESSION   ${transcriptId}\n`;
  gb += `VERSION     ${transcriptId}.1\n`;
  gb += `KEYWORDS    MANE Select; Canonical.\n`;
  gb += `SOURCE      Homo sapiens (human)\n`;
  gb += `  ORGANISM  Homo sapiens\n`;
  gb += `FEATURES             Location/Qualifiers\n`;
  gb += `     source          1..${seqLen}\n`;
  gb += `                     /organism="Homo sapiens"\n`;
  gb += `                     /chromosome="${chr}"\n`;
  gb += `                     /gene="${gene}"\n`;
  gb += `                     /db_xref="GeneID:${ensemblGeneId}"\n`;

  // Sort exons along forward genomic strand
  const sortedExons = [...exons].sort((a, b) => a.start - b.start);

  sortedExons.forEach((exon, idx) => {
    const relStart = exon.start - genomicStart + 1;
    const relEnd = exon.end - genomicStart + 1;
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
        const cStart = Math.max(e.start, translation.start) - genomicStart + 1;
        const cEnd = Math.min(e.end, translation.end) - genomicStart + 1;
        return `${cStart}..${cEnd}`;
      });

      const cdsLoc = intervals.length > 1 ? `join(${intervals.join(",")})` : intervals[0];
      const finalLoc = strand === -1 ? `complement(${cdsLoc})` : cdsLoc;

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
    const chunk = sequence.slice(i, i + 60);
    const blocks = [];
    for (let j = 0; j < chunk.length; j += 10) {
      blocks.push(chunk.slice(j, j + 10));
    }
    gb += `${lineNum} ${blocks.join(" ")}\n`;
  }
  gb += `//\n`;

  return gb;
}
