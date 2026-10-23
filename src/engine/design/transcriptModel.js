function extractFeatureRanges(loc) {
  const nums = String(loc || "").match(/\d+/g);
  if (!nums || nums.length < 2) return [];
  const ranges = [];
  for (let index = 0; index < nums.length - 1; index += 2) {
    ranges.push([parseInt(nums[index], 10) - 1, parseInt(nums[index + 1], 10)]);
  }
  return ranges;
}

function getGeneNameFromFeatures(features) {
  const geneFeature = features.find((entry) => entry.type === "gene");
  return geneFeature?.q?.label || geneFeature?.q?.gene || "Gene";
}

function getTranscriptIdForGene(features, gene) {
  const wanted = String(gene || "").trim().toUpperCase();
  if (!wanted) return "";
  const match = (features || []).find((entry) => {
    if (entry.type !== "mRNA" && entry.type !== "transcript") return false;
    const entryGene = String(entry?.q?.gene || "").trim().toUpperCase();
    return entryGene && entryGene === wanted;
  });
  return String(match?.q?.transcript_id || match?.q?.label || "").trim();
}

function getTranscriptIdFromFeatures(features) {
  const mrnaFeature = features.find((entry) => entry.type === "mRNA" || entry.type === "transcript");
  return mrnaFeature?.q?.transcript_id || mrnaFeature?.q?.label || mrnaFeature?.q?.gene || "";
}

function normalizeExons(features) {
  return features
    .filter((feature) => feature.type === "exon")
    .map((feature, index) => {
      const ranges = extractFeatureRanges(feature.loc);
      if (!ranges.length) return null;
      const [start, end] = ranges[0];
      const label = feature.q?.label || `Exon ${index + 1}`;
      const labelMatch = label.match(/Exon\s+(\d+)/i);
      return {
        start,
        end,
        exonNumber: labelMatch ? parseInt(labelMatch[1], 10) : index + 1,
        label,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

const STOP_CODONS = new Set(["TAA", "TAG", "TGA"]);

/** GenBank marks an incomplete feature with < or > in its location. */
function isPartialLocation(loc) {
  return /[<>]/.test(String(loc || ""));
}

function getCdsGeneName(feature) {
  const explicit = String(feature?.q?.gene || "").trim();
  if (explicit) return explicit;
  // Fall back to the label, which is conventionally "<GENE> CDS".
  return String(feature?.q?.label || "").trim().replace(/\s+CDS$/i, "");
}

function describeCdsCandidate(rawRecord, feature) {
  const cdsSegments = extractFeatureRanges(feature.loc);
  if (!cdsSegments.length) return null;
  const sequence = cdsSegments.map(([start, end]) => rawRecord.seq.slice(start, end)).join("").toUpperCase();
  const partial = isPartialLocation(feature.loc);
  const startsAtg = sequence.slice(0, 3) === "ATG";
  const inFrame = sequence.length > 0 && sequence.length % 3 === 0;
  const endsStop = STOP_CODONS.has(sequence.slice(-3));
  return {
    feature,
    cdsSegments,
    sequence,
    gene: getCdsGeneName(feature),
    transcriptId: String(feature?.q?.transcript_id || "").trim(),
    partial,
    startsAtg,
    inFrame,
    endsStop,
    // Completeness dominates: a partial annotation cannot be trusted for coordinates or
    // residue numbering, whatever else it has going for it.
    score: (partial ? 0 : 8) + (startsAtg ? 4 : 0) + (inFrame ? 2 : 0) + (endsStop ? 1 : 0),
  };
}

/**
 * Selects the CDS to design against, and reports why.
 *
 * This used to return the FIRST CDS feature in the file with no further checks. NCBI
 * RefSeqGene records routinely annotate neighbouring genes, so uploading NG_007084 for
 * APOE silently designed against TOMM40 - whose CDS is additionally partial (<1..71),
 * out of frame (391 nt) and does not begin with ATG. Nothing was reported to the user.
 *
 * `options.expectedGene` lets a caller state the intended gene, which removes the
 * ambiguity rather than resolving it positionally.
 */
function normalizeCds(rawRecord, options = {}) {
  const expectedGeneRaw = String(options.expectedGene || "").trim();
  const expectedGene = expectedGeneRaw.toUpperCase();
  const candidates = rawRecord.feats
    .filter((feature) => feature.type === "CDS")
    .map((feature) => describeCdsCandidate(rawRecord, feature))
    .filter(Boolean);
  if (!candidates.length) return null;

  const genes = [...new Set(candidates.map((candidate) => candidate.gene).filter(Boolean))];
  const issues = [];

  let pool = candidates;
  let matchedExpected = false;
  if (expectedGene) {
    const matches = candidates.filter((candidate) => candidate.gene.toUpperCase() === expectedGene);
    if (matches.length) {
      pool = matches;
      matchedExpected = true;
    } else if (!genes.length) {
      // Plenty of real references - SnapGene exports especially - carry no /gene
      // qualifier at all. That is unverifiable rather than wrong, so it is a review item
      // (which is what the request asks for) rather than a hard block.
      issues.push({
        code: "gene-identity-unverifiable",
        severity: "warning",
        message: `The reference does not name the gene on any CDS feature, so it cannot be confirmed as ${expectedGeneRaw}. Verify the reference identity before release.`,
      });
    } else {
      issues.push({
        code: "expected-gene-not-found",
        severity: "blocker",
        message: `The reference annotates no CDS for ${expectedGeneRaw}. CDS features present: ${genes.join(", ")}.`,
      });
    }
  }

  const selected = pool
    .slice()
    .sort((left, right) => right.score - left.score || left.cdsSegments[0][0] - right.cdsSegments[0][0])[0];
  // Reads as "The APOE CDS ..." with a gene name, "The selected CDS ..." without one.
  const label = selected.gene || "selected";

  if (genes.length > 1 && !matchedExpected) {
    issues.push({
      code: "multiple-genes",
      severity: "blocker",
      message: `The reference annotates ${genes.length} genes (${genes.join(", ")}). ${label} was chosen by annotation completeness, not because it was requested. State the intended gene or trim the reference to a single gene before release.`,
    });
  }
  if (selected.partial) {
    issues.push({
      code: "partial-cds",
      severity: "blocker",
      message: `The ${label} CDS is a partial annotation (${selected.feature.loc}), so its coordinates and residue numbering cannot be trusted.`,
    });
  }
  if (!selected.startsAtg) {
    issues.push({
      code: "cds-no-start-codon",
      severity: "blocker",
      message: `The ${label} CDS does not begin with ATG (begins ${selected.sequence.slice(0, 3) || "nothing"}), so residue numbering would be wrong.`,
    });
  }
  if (!selected.inFrame) {
    issues.push({
      code: "cds-not-in-frame",
      severity: "blocker",
      message: `The ${label} CDS is ${selected.sequence.length} nt, which is not a multiple of three.`,
    });
  }
  if (!selected.endsStop) {
    issues.push({
      code: "cds-no-stop-codon",
      severity: "warning",
      message: `The ${label} CDS does not end in a stop codon; confirm the annotation is complete.`,
    });
  }

  return {
    cdsSegments: selected.cdsSegments,
    cdsSequence: selected.sequence,
    // Only subtract the stop codon when there actually is one.
    proteinLength: selected.endsStop
      ? Math.floor(selected.sequence.length / 3) - 1
      : Math.floor(selected.sequence.length / 3),
    gene: selected.gene,
    transcriptId: selected.transcriptId,
    issues,
  };
}

function normalizeInterval(input) {
  if (Array.isArray(input) && input.length >= 2) return [Number(input[0]), Number(input[1])];
  if (input && typeof input === "object") return [Number(input.start), Number(input.end)];
  return [NaN, NaN];
}

function normalizeIntervalList(inputs = []) {
  return inputs
    .map(normalizeInterval)
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left[0] - right[0]);
}

function normalizeExonList(inputs = []) {
  return inputs
    .map((input, index) => {
      const [start, end] = normalizeInterval(input);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return {
        start,
        end,
        exonNumber: Number(input?.exonNumber) || index + 1,
        label: input?.label || `Exon ${Number(input?.exonNumber) || index + 1}`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

function buildCdsSequenceFromSegments(genomicSequence, cdsSegments) {
  let cdsSequence = "";
  for (const [start, end] of cdsSegments) cdsSequence += genomicSequence.slice(start, end);
  return cdsSequence;
}

function buildTranscriptModel({
  gene,
  transcriptId = "",
  proteinLength = null,
  genomicSequence,
  cdsSegments,
  exons = [],
  strand = 1,
  source,
  assembly = "",
  rawFeatures = [],
  referenceIssues = [],
}) {
  const normalizedSequence = String(genomicSequence || "").toUpperCase();
  if (!normalizedSequence) return null;
  const normalizedCdsSegments = normalizeIntervalList(cdsSegments);
  if (!normalizedCdsSegments.length) return null;
  const cdsSequence = buildCdsSequenceFromSegments(normalizedSequence, normalizedCdsSegments);
  const resolvedProteinLength = Number.isFinite(proteinLength) ? proteinLength : Math.floor(cdsSequence.length / 3) - 1;
  return {
    gene: String(gene || "Gene"),
    transcriptId: String(transcriptId || ""),
    proteinLength: resolvedProteinLength,
    genomicSequence: normalizedSequence,
    cdsSequence,
    cdsSegments: normalizedCdsSegments,
    exons: normalizeExonList(exons),
    strand: strand === -1 ? -1 : 1,
    source: String(source || "unknown"),
    assembly: String(assembly || ""),
    rawFeatures: Array.isArray(rawFeatures) ? rawFeatures : [],
    referenceIssues: Array.isArray(referenceIssues) ? referenceIssues : [],
  };
}

export function normalizeGenBankToTranscriptModel(rawRecord, options = {}) {
  if (!rawRecord?.seq) return null;
  const normalizedCds = normalizeCds(rawRecord, options);
  if (!normalizedCds) return null;

  // The gene name must come from the CDS actually being designed against, not from
  // whichever gene feature appears first - otherwise a TOMM40 design can be labelled APOE.
  const featureGene = getGeneNameFromFeatures(rawRecord.feats);
  const gene = normalizedCds.gene || featureGene;
  const referenceIssues = [...normalizedCds.issues];
  if (normalizedCds.gene && featureGene && featureGene !== normalizedCds.gene) {
    referenceIssues.push({
      code: "gene-annotation-mismatch",
      severity: "warning",
      message: `The first gene feature is ${featureGene} but the selected CDS belongs to ${normalizedCds.gene}; the CDS is authoritative.`,
    });
  }
  const transcriptId = normalizedCds.transcriptId
    || getTranscriptIdForGene(rawRecord.feats, gene)
    || getTranscriptIdFromFeatures(rawRecord.feats);
  const exons = normalizeExons(rawRecord.feats);

  return buildTranscriptModel({
    gene,
    transcriptId,
    genomicSequence: rawRecord.seq,
    cdsSegments: normalizedCds.cdsSegments,
    exons,
    strand: 1,
    source: "genbank",
    assembly: "",
    rawFeatures: rawRecord.feats,
    proteinLength: normalizedCds.proteinLength,
    referenceIssues,
  });
}

export function getCdsFromModel(model) {
  if (!model) return null;
  if (model.cdsSegments && model.genomicSequence) {
    return {
      segs: model.cdsSegments,
      cds: model.cdsSequence,
      prot: model.proteinLength,
      name: model.gene,
    };
  }
  return null;
}

export function getExonsFromModel(model) {
  return Array.isArray(model?.exons) ? model.exons : [];
}

export function getGenomicSequence(model) {
  return String(model?.genomicSequence || "");
}

export function getCdsSegments(model) {
  return Array.isArray(model?.cdsSegments) ? model.cdsSegments : [];
}

export function getFeatureCount(model) {
  return Array.isArray(model?.rawFeatures) ? model.rawFeatures.length : 0;
}

export function normalizeEnsemblToTranscriptModel(payload) {
  return buildTranscriptModel({
    gene: payload?.gene || payload?.geneSymbol || payload?.displayName,
    transcriptId: payload?.transcriptId || payload?.id || payload?.stableId,
    proteinLength: payload?.proteinLength,
    genomicSequence: payload?.genomicSequence || payload?.sequence,
    cdsSegments: payload?.cdsSegments || payload?.cds || [],
    exons: payload?.exons || [],
    strand: payload?.strand,
    source: "ensembl",
    assembly: payload?.assembly || payload?.assemblyName || "",
    rawFeatures: payload?.rawFeatures || [],
  });
}

export function normalizeNcbiToTranscriptModel(payload) {
  return buildTranscriptModel({
    gene: payload?.gene || payload?.geneSymbol || payload?.symbol,
    transcriptId: payload?.transcriptId || payload?.accession || payload?.id,
    proteinLength: payload?.proteinLength,
    genomicSequence: payload?.genomicSequence || payload?.sequence,
    cdsSegments: payload?.cdsSegments || payload?.cds || [],
    exons: payload?.exons || [],
    strand: payload?.strand,
    source: "ncbi",
    assembly: payload?.assembly || payload?.assemblyName || "",
    rawFeatures: payload?.rawFeatures || [],
  });
}

export function normalizeRawSequenceToTranscriptModel(payload) {
  const genomicSequence = String(payload?.sequence || "").toUpperCase().replace(/[^ACGT]/g, "");
  const cdsStartInput = Number(payload?.cdsStart);
  const cdsEndInput = Number(payload?.cdsEnd);
  if (!genomicSequence || !Number.isFinite(cdsStartInput) || !Number.isFinite(cdsEndInput)) return null;
  const cdsStart = Math.max(0, Math.floor(cdsStartInput) - 1);
  const cdsEnd = Math.min(genomicSequence.length, Math.floor(cdsEndInput));
  if (cdsEnd <= cdsStart) return null;
  const exons = Array.isArray(payload?.exons) && payload.exons.length
    ? payload.exons
    : [{ start: cdsStart, end: cdsEnd, exonNumber: 1, label: "Exon 1" }];
  return buildTranscriptModel({
    gene: payload?.gene || payload?.geneSymbol || "Gene",
    transcriptId: payload?.transcriptId || "",
    genomicSequence,
    cdsSegments: [[cdsStart, cdsEnd]],
    exons,
    strand: 1,
    source: "raw-sequence",
    assembly: payload?.assembly || "",
    rawFeatures: [],
  });
}

export function codingPosToGenomic(model, codingPos) {
  const segments = getCdsSegments(model);
  let cursor = 0;
  for (const [start, end] of segments) {
    if (cursor + (end - start) > codingPos) return start + (codingPos - cursor);
    cursor += end - start;
  }
  return null;
}

export function genomicPosToAa(model, genomicPos) {
  const segments = getCdsSegments(model);
  let cursor = 0;
  for (const [start, end] of segments) {
    if (start <= genomicPos && genomicPos < end) return Math.floor((cursor + genomicPos - start) / 3) + 1;
    cursor += end - start;
  }
  return null;
}

export function getCodonAtAa(model, aaNumber, codonToAa) {
  const genomicSequence = getGenomicSequence(model);
  const codingStart = (aaNumber - 1) * 3;
  const genomicPositions = [0, 1, 2].map((offset) => codingPosToGenomic(model, codingStart + offset));
  if (genomicPositions.some((position) => position === null || position === undefined)) return null;
  const codon = genomicPositions.map((position) => genomicSequence[position]).join("");
  return { g: genomicPositions[0], cod: codon, aa: codonToAa(codon), genomicPositions };
}

export function findExonForSegment(modelOrExons, start, end) {
  const exons = Array.isArray(modelOrExons) ? modelOrExons : getExonsFromModel(modelOrExons);
  return exons.find((exon) => exon.start <= start && exon.end >= end)
    || exons.find((exon) => !(exon.end <= start || exon.start >= end))
    || null;
}

export function findSpCas9Guides(model, reverseComplement, target, range = 50) {
  const seq = getGenomicSequence(model);
  const results = [];
  for (let pos = Math.max(0, target - range - 23); pos <= Math.min(seq.length - 23, target + range); pos += 1) {
    const plusPam = seq.slice(pos + 20, pos + 23);
    if (["AGG", "TGG", "CGG", "GGG"].includes(plusPam)) {
      const spacer = seq.slice(pos, pos + 20);
      const cut = pos + 17;
      const gc = Math.round((spacer.split("").filter((base) => base === "G" || base === "C").length / 20) * 100);
      if (!spacer.includes("TTTTT") && !spacer.includes("AAAAA") && Math.abs(cut - target) <= range) results.push({ sp: spacer, pam: plusPam, str: "+", cut, d: cut - target, gc, ps: pos });
    }
    const minusPam = seq.slice(pos, pos + 3);
    if (["CCA", "CCT", "CCC", "CCG"].includes(minusPam)) {
      const spacer = reverseComplement(seq.slice(pos + 3, pos + 23));
      const cut = pos + 6;
      const gc = Math.round((spacer.split("").filter((base) => base === "G" || base === "C").length / 20) * 100);
      if (!spacer.includes("TTTTT") && !spacer.includes("AAAAA") && Math.abs(cut - target) <= range) results.push({ sp: spacer, pam: reverseComplement(minusPam), str: "-", cut, d: cut - target, gc, ps: pos });
    }
  }
  return results;
}

export function selectNearbyGuidesForModel(model, reverseComplement, targetPos, window = 10) {
  const guidesInWindow = findSpCas9Guides(model, reverseComplement, targetPos, window).sort((left, right) => Math.abs(left.d) - Math.abs(right.d));
  if (!guidesInWindow.length) return [];
  const minimumAlternativeCutOffset = 10;
  const firstGuide = guidesInWindow[0];
  const distinctCandidates = guidesInWindow.filter((guide) => guide !== firstGuide && Math.abs(guide.cut - firstGuide.cut) >= minimumAlternativeCutOffset);
  const secondGuide = distinctCandidates.find((guide) => guide.str !== firstGuide.str) || distinctCandidates[0] || null;
  return secondGuide ? [firstGuide, secondGuide] : [firstGuide];
}

export function describeKoGenomicContextFromModel(model, cut) {
  const exons = getExonsFromModel(model);
  const segments = getCdsSegments(model);
  const regions = exons.length
    ? exons.map((exon) => ({ start: exon.start, end: exon.end, exonNumber: exon.exonNumber }))
    : segments.map(([start, end], index) => ({ start, end, exonNumber: index + 1 }));

  for (let index = 0; index < regions.length; index += 1) {
    const { start, end, exonNumber } = regions[index];
    if (cut >= start && cut < end) {
      return {
        label: `exon ${exonNumber}`,
        detail: `${cut - start} bp into exon ${exonNumber}`,
      };
    }
    const next = regions[index + 1];
    if (next && cut >= end && cut < next.start) {
      const afterPrev = cut - end;
      const beforeNext = next.start - cut;
      const usePrev = afterPrev <= beforeNext;
      return {
        label: `intron between exon ${exonNumber} and exon ${next.exonNumber}`,
        detail: usePrev
          ? `${afterPrev} bp downstream of exon ${exonNumber}`
          : `${beforeNext} bp upstream of exon ${next.exonNumber}`,
      };
    }
  }

  if (cut < regions[0].start) {
    return {
      label: "upstream of CDS",
      detail: `${regions[0].start - cut} bp upstream of exon ${regions[0].exonNumber}`,
    };
  }

  const lastRegion = regions[regions.length - 1];
  return {
    label: "downstream of CDS",
    detail: `${cut - lastRegion.end} bp downstream of exon ${lastRegion.exonNumber}`,
  };
}

export function describeGuidePlacementFromModel(model, guide) {
  const exons = getExonsFromModel(model);
  const segments = getCdsSegments(model);
  const regions = exons.length
    ? exons.map((exon) => ({ start: exon.start, end: exon.end, exonNumber: exon.exonNumber }))
    : segments.map(([start, end], index) => ({ start, end, exonNumber: index + 1 }));
  if (!regions.length || !Number.isFinite(guide?.ps)) {
    return { label: "context unavailable", detail: "Guide placement could not be resolved on the reference." };
  }

  const guideStart = guide.ps;
  const guideEnd = guide.ps + 23;
  const overlappingExons = regions.filter((region) => guideStart < region.end && guideEnd > region.start);

  if (overlappingExons.length === 1) {
    const exon = overlappingExons[0];
    const fullyInside = guideStart >= exon.start && guideEnd <= exon.end;
    if (fullyInside) {
      return {
        label: `exonic (exon ${exon.exonNumber})`,
        detail: `Guide spans ${guideEnd - guideStart} bp within exon ${exon.exonNumber}.`,
      };
    }
    return {
      label: `crosses exon ${exon.exonNumber} boundary`,
      detail: `Guide overlaps exon ${exon.exonNumber} and adjacent noncoding sequence.`,
    };
  }

  if (overlappingExons.length > 1) {
    const first = overlappingExons[0];
    const last = overlappingExons[overlappingExons.length - 1];
    return {
      label: `crosses exon boundary`,
      detail: `Guide spans exon ${first.exonNumber} to exon ${last.exonNumber}.`,
    };
  }

  if (guideEnd <= regions[0].start) {
    return {
      label: "upstream of CDS",
      detail: `Guide lies upstream of exon ${regions[0].exonNumber}.`,
    };
  }

  for (let index = 0; index < regions.length - 1; index += 1) {
    const left = regions[index];
    const right = regions[index + 1];
    if (guideStart >= left.end && guideEnd <= right.start) {
      return {
        label: `intronic`,
        detail: `Guide lies in the intron between exon ${left.exonNumber} and exon ${right.exonNumber}.`,
      };
    }
    if (guideStart < right.start && guideEnd > left.end) {
      return {
        label: "crosses exon boundary",
        detail: `Guide spans the intron between exon ${left.exonNumber} and exon ${right.exonNumber}.`,
      };
    }
  }

  const lastRegion = regions[regions.length - 1];
  if (guideStart >= lastRegion.end) {
    return {
      label: "downstream of CDS",
      detail: `Guide lies downstream of exon ${lastRegion.exonNumber}.`,
    };
  }

  return { label: "context unavailable", detail: "Guide placement could not be resolved on the reference." };
}

export function extractCodingDonorWindowFromModel(model, donorStart, donorEnd, payload) {
  const seq = getGenomicSequence(model);
  const segs = getCdsSegments(model);
  const entries = [];
  let codingCursor = 0;
  segs.forEach(([segStart, segEnd]) => {
    const overlapStart = Math.max(donorStart, segStart);
    const overlapEnd = Math.min(donorEnd, segEnd);
    for (let genomicPos = overlapStart; genomicPos < overlapEnd; genomicPos += 1) {
      entries.push({
        wt: seq[genomicPos],
        donor: payload[genomicPos - donorStart],
        codingIndex: codingCursor + (genomicPos - segStart),
      });
    }
    codingCursor += segEnd - segStart;
  });
  if (!entries.length) return { codingWt: "", codingDonor: "" };
  const trimStart = (3 - (entries[0].codingIndex % 3)) % 3;
  const trimmed = entries.slice(trimStart);
  const usableLength = trimmed.length - (trimmed.length % 3);
  const finalEntries = trimmed.slice(0, usableLength);
  return {
    codingWt: finalEntries.map((entry) => entry.wt).join(""),
    codingDonor: finalEntries.map((entry) => entry.donor).join(""),
  };
}

export function findKoDesignTargetFromModel(model, reverseComplement, selectKoGuidePair) {
  const seq = getGenomicSequence(model);
  const segs = getCdsSegments(model);
  const exons = getExonsFromModel(model);
  const indexedSegments = segs.map(([start, end], index) => ({ start, end, index }));
  const nonTerminalSegments = indexedSegments.filter((entry) => entry.index < segs.length - 1);
  if (!nonTerminalSegments.length) return null;
  const preferredSegments = nonTerminalSegments.filter((entry) => entry.index >= 1 && entry.index <= 3);
  const targetSegments = preferredSegments.length ? preferredSegments : nonTerminalSegments;
  const boundaryWindow = 25;

  const candidates = targetSegments.map(({ start, end, index }) => {
    const exonLength = end - start;
    const exon = findExonForSegment(exons, start, end);
    const guides = findSpCas9Guides(model, reverseComplement, Math.floor((start + end) / 2), Math.floor(exonLength / 2) + 10)
      .filter((guide) => guide.cut >= start - boundaryWindow && guide.cut <= end + boundaryWindow)
      .sort((left, right) => right.gc - left.gc);
    const pair = selectKoGuidePair(guides);
    return {
      segmentIndex: index + 1,
      exonNumber: exon?.exonNumber || index + 1,
      start,
      end,
      exonLength,
      pair,
    };
  }).filter((entry) => entry.pair);

  candidates.sort((left, right) => {
    if (left.pair.oppositeStrands !== right.pair.oppositeStrands) return left.pair.oppositeStrands ? -1 : 1;
    if (right.exonLength !== left.exonLength) return right.exonLength - left.exonLength;
    if (right.pair.score !== left.pair.score) return right.pair.score - left.pair.score;
    return left.pair.spacing - right.pair.spacing;
  });

  return candidates[0] || null;
}
