import { buildQcDesignSpec } from "../engine/design/qcExport.js";
import { readGenomicReferenceMetadata } from "../engine/design/genomicSnp.js";

export const ALPHAGENOME_REQUEST_SCHEMA = "assured-alphagenome-request/1";

/**
 * Research tissue/cell presets verified against live AlphaGenome output metadata
 * (RNA-seq + splice-usage coverage unless noted). Generic iPSC (EFO:0004905) and
 * CL:0002322 / CL:0000057 are absent from current tracks — use exact PSC lines.
 * Assay coverage differs by line; unsupported tracks fail rather than substituting.
 */
export const ALPHAGENOME_RESEARCH_TISSUES = Object.freeze([
  { id: "EFO:0009747", label: "WTC11 PSC (EFO:0009747)", kind: "psc", match: "exact" },
  { id: "EFO:0003042", label: "H1 hESC (EFO:0003042)", kind: "psc", match: "exact" },
  { id: "EFO:0003045", label: "H9 hESC (EFO:0003045)", kind: "psc", match: "exact" },
  { id: "CL:0000746", label: "Cardiac muscle cell (CL:0000746)", kind: "derivative", match: "exact" },
  { id: "CL:0000182", label: "Hepatocyte (CL:0000182)", kind: "derivative", match: "exact" },
  { id: "CL:0000679", label: "Glutamatergic neuron (CL:0000679)", kind: "derivative", match: "exact" },
  { id: "UBERON:0002107", label: "Liver tissue (UBERON:0002107)", kind: "tissue", match: "exact" },
  { id: "UBERON:0000948", label: "Heart tissue (UBERON:0000948)", kind: "tissue", match: "exact" },
  { id: "CL:0000084", label: "T cell (CL:0000084)", kind: "immune", match: "exact" },
]);

/** Noise floors for raw maxAbsDelta. Not calibrated thresholds — research heuristics only. */
const BLOCKER_DELTA_FLOOR = {
  RNA_SEQ: 1e-3,
  // Splice-site probabilities often quantize near ~1/256; equal tiny bins must not force dominate.
  SPLICE_SITES: 1e-3,
  // Usage often sits on a coarse bin; equal tiny peaks must not alone force "dominate".
  SPLICE_SITE_USAGE: 1e-2,
};

function comparisonTracks(report, id) {
  return report?.comparisons?.find((c) => c.id === id)?.tracks || [];
}

function peakByOutput(tracks, output) {
  const rows = tracks.filter((t) => t.output === output && Number.isFinite(t.maxAbsDelta));
  if (!rows.length) return null;
  return rows.reduce((best, t) => (t.maxAbsDelta > best.maxAbsDelta ? t : best), rows[0]);
}

function outputRatio(intendedPeak, blockerPeak, output) {
  const floor = BLOCKER_DELTA_FLOOR[output] ?? 1e-4;
  if (!intendedPeak || !blockerPeak) return null;
  if (blockerPeak.maxAbsDelta <= floor) return 0;
  if (intendedPeak.maxAbsDelta <= floor) return Infinity;
  const ratio = blockerPeak.maxAbsDelta / intendedPeak.maxAbsDelta;
  // Near-equal peaks just above the assay floor are quantization noise, not redesign signals.
  if (ratio <= 1.05 && blockerPeak.maxAbsDelta <= floor * 5) return 0;
  return ratio;
}

/**
 * Research-only allele safety read of an imported AlphaGenome report.
 * RNA-seq and splice-site peaks lead the verdict; splice-usage alone does not
 * force "dominate" when both peaks sit on a quantization floor.
 * Never changes READY/BLOCKED; raw track units are assay-specific.
 */
export function summarizeBlockerSafety(report, request = null) {
  if (!report || report.status !== "complete" || !Array.isArray(report.comparisons)) return null;
  const intended = comparisonTracks(report, "reference_to_intended");
  const blockers = comparisonTracks(report, "intended_to_full_donor");
  if (!intended.length || !blockers.length) return null;

  const outputs = ["RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE"];
  const byOutput = {};
  for (const output of outputs) {
    const intendedPeak = peakByOutput(intended, output);
    const blockerPeak = peakByOutput(blockers, output);
    if (!intendedPeak || !blockerPeak) continue;
    const ratio = outputRatio(intendedPeak, blockerPeak, output);
    byOutput[output] = {
      output,
      intendedMaxAbsDelta: intendedPeak.maxAbsDelta,
      blockerMaxAbsDelta: blockerPeak.maxAbsDelta,
      ratio,
      blockerTrack: `${blockerPeak.name} (${blockerPeak.strand || "."})`,
      intendedTrack: `${intendedPeak.name} (${intendedPeak.strand || "."})`,
    };
  }
  if (!Object.keys(byOutput).length) return null;

  // Primary signals for redesign: expression and splice-site class. Usage is supporting only.
  const primary = ["RNA_SEQ", "SPLICE_SITES"].map((o) => byOutput[o]).filter(Boolean);
  const usage = byOutput.SPLICE_SITE_USAGE;
  const dominateLead = primary.find((e) => e.ratio >= 1) || null;
  const notableLead = primary.find((e) => e.ratio >= 0.5) || null;
  // Usage can reinforce dominate only when clearly above its own floor and primary is already notable.
  const usageDominates = usage && usage.ratio >= 1.25 && usage.blockerMaxAbsDelta > BLOCKER_DELTA_FLOOR.SPLICE_SITE_USAGE;

  const ontology = request?.ontologyTerms?.[0] || report.ontologyTerms?.[0] || "the selected tissue";
  const donor = request?.donor || report.donor || "this donor";
  let severity = "info";
  let verdict = "blockers_minor";
  let text;
  let short;
  if (dominateLead || (notableLead && usageDominates)) {
    severity = "warn";
    verdict = "blockers_dominate";
    const lead = dominateLead || usage;
    text = `Donor blockers on ${donor} drive ${lead.output.replace(/_/g, "-").toLowerCase()} changes as large as or larger than the intended edit in ${ontology} (peak maxAbsΔ ${lead.blockerMaxAbsDelta.toPrecision(3)} vs intended ${lead.intendedMaxAbsDelta.toPrecision(3)} on ${lead.blockerTrack}). Try an alternate silent blocker set — research signal only, not a release gate.`;
    short = "donor blockers may drive expression/splicing changes";
  } else if (notableLead) {
    severity = "warn";
    verdict = "blockers_notable";
    const lead = notableLead;
    text = `Donor blockers on ${donor} add a notable share of the ${lead.output.replace(/_/g, "-").toLowerCase()} delta in ${ontology} (about ${Math.round(Math.min(lead.ratio, 10) * 100)}% of the intended-edit peak). Consider an alternate silent set if another matched donor is available.`;
    short = "blocker side-effects are worth checking";
  } else {
    text = `Imported AlphaGenome review for ${donor} in ${ontology}: blocker-associated deltas stay below the intended-edit peaks in this context (research only; not a safety proof).`;
    short = "blocker deltas look smaller than the intended edit";
  }

  return {
    severity,
    verdict,
    text,
    short,
    ontology,
    donor,
    byOutput,
    nextStep: verdict === "blockers_minor"
      ? null
      : "Compare the other matched donor (or regenerate silent blockers), then re-run AlphaGenome on the leaner allele.",
  };
}

const rc = sequence => [...sequence].reverse().map(b => ({ A: "T", C: "G", G: "C", T: "A", N: "N" }[b])).join("");
const stable = value => value && typeof value === "object"
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
  : value;

/** Normalize common human assembly synonyms for AlphaGenome (GRCh38 only). */
export function normalizeHumanAssembly(name) {
  const raw = String(name || "").trim();
  if (/^(?:GRCh38(?:\.p\d+)?|hg38)$/i.test(raw)) return "GRCh38";
  if (/^(?:GRCh37(?:\.p\d+)?|hg19)$/i.test(raw)) return "GRCh37";
  return raw || null;
}

function chromosomeFromNcAccession(accession) {
  const m = String(accession || "").match(/^NC_0*(\d+)\./i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 1 && n <= 22) return String(n);
  if (n === 23) return "X";
  if (n === 24) return "Y";
  return null;
}

/**
 * Detect GRCh38 genomic mapping from GenBank text for research AlphaGenome review.
 * Supports Assured/Ensembl Location lines and common region DEFINITION annotations.
 * Returns null when coordinates cannot be verified — never invents an assembly or start.
 */
export function detectGenomicMappingFromGenbank(raw) {
  const text = String(raw || "");
  if (!text.trim()) return null;

  const canonical = readGenomicReferenceMetadata(text);
  if (canonical) {
    return {
      assembly: normalizeHumanAssembly(canonical.assembly) || canonical.assembly,
      chromosome: String(canonical.chromosome).replace(/^chr/i, ""),
      referenceStart: canonical.start,
      orientation: canonical.orientation === -1 ? -1 : 1,
      end: canonical.end,
      source: "location-chromosome",
      label: "GenBank Location (chromosome:assembly:chr:start:end:strand)",
    };
  }

  const importedAssembly = text.match(/Imported from genome:\s*(GRCh38(?:\.p\d+)?|hg38|GRCh37(?:\.p\d+)?|hg19)\b/i);
  const chrRange = text.match(/Location:\s*chr([0-9XYM]+)\s+(\d+)\s*-\s*(\d+)\b/i);
  if (importedAssembly && chrRange) {
    const start = Number(chrRange[2]);
    const end = Number(chrRange[3]);
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start) {
      return {
        assembly: normalizeHumanAssembly(importedAssembly[1]),
        chromosome: chrRange[1].toUpperCase(),
        referenceStart: start,
        orientation: 1,
        end,
        source: "location-chr-range",
        label: "GenBank Location (chrN start-end) with imported assembly",
      };
    }
  }

  const region = text.match(
    /\b(NC_\d+\.\d+)\s*:\s*(\d+)\s*\.\.\s*(\d+)\s*\((GRCh38(?:\.p\d+)?|hg38|GRCh37(?:\.p\d+)?|hg19)\)[^\n]{0,80}?\b(plus|minus|forward|reverse)\s+strand\b/i
  );
  if (region) {
    const chrom = chromosomeFromNcAccession(region[1]);
    const start = Number(region[2]);
    const end = Number(region[3]);
    if (chrom && Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start) {
      const strand = region[5].toLowerCase();
      return {
        assembly: normalizeHumanAssembly(region[4]),
        chromosome: chrom,
        referenceStart: start,
        orientation: strand === "minus" || strand === "reverse" ? -1 : 1,
        end,
        source: "definition-nc-region",
        label: "DEFINITION NC accession genomic region",
      };
    }
  }

  return null;
}

export async function reviewRequestId(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(payload)));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}

/** Mapping used for AlphaGenome form auto-fill and conflict checks. */
export function alphaGenomeMapping(project) {
  const detected = detectGenomicMappingFromGenbank(project?.genbankRaw || "");
  if (!detected) return null;
  return {
    assembly: detected.assembly,
    chromosome: detected.chromosome,
    referenceStart: detected.referenceStart,
    orientation: detected.orientation,
    end: detected.end,
    source: detected.source,
    label: detected.label,
    grch38: detected.assembly === "GRCh38",
  };
}

const variantKey = (v) => `${v.position}:${v.ref}>${v.alt}:${v.role}`;

/**
 * Extract chromosome-plus alleles for one matched substitution donor.
 * When referenceStart/orientation are omitted, positions stay 0-based on the uploaded reference.
 */
export function listDonorAlleleVariants(project, { donorIndex = 0, referenceStart = null, orientation = 1 } = {}) {
  const result = project?.designResult;
  if (!result || result.err || !["pm", "genomic-snv"].includes(result.type)) {
    throw new Error("AlphaGenome donor review currently supports substitution designs only; select a point-mutation or genomic SNP design.");
  }
  const genome = result.gb?.genomicSequence?.toUpperCase();
  if (!genome || genome.length > 1000000 || !/^[ACGTN]+$/.test(genome)) throw new Error("A valid uploaded genomic reference of at most 1 Mb is required.");
  const mapped = Number.isSafeInteger(referenceStart) && referenceStart >= 1 && [1, -1].includes(orientation);
  if (referenceStart != null && !mapped) {
    throw new Error("Provide the 1-based chromosome start and reference orientation (+1 or -1).");
  }
  const spec = buildQcDesignSpec(result);
  if (spec.err) throw new Error(spec.err);
  const donor = spec.donors?.[donorIndex];
  if (!Number.isInteger(donorIndex) || !donor || donor.insertBp) throw new Error("Select a matched substitution donor.");
  const from = donor.refStart + spec.reference.offset;
  const to = donor.refEnd + spec.reference.offset;
  if (donor.sequence.length !== to - from || !/^[ACGT]+$/.test(donor.sequence)) throw new Error("Donor must contain unambiguous bases and preserve reference length.");
  const intended = new Set((spec.markers || []).filter(m => m.role === "intended").map(m => m.pos + spec.reference.offset));
  const variants = [];
  for (let i = 0; i < donor.sequence.length; i += 1) {
    const index = from + i;
    const ref = genome[index], alt = donor.sequence[i];
    if (ref === alt) continue;
    if (!/^[ACGT]$/.test(ref || "")) throw new Error("An edited reference base is ambiguous or outside the uploaded reference.");
    const position = mapped
      ? (orientation === -1 ? referenceStart + genome.length - 1 - index : referenceStart + index)
      : index;
    variants.push({
      position,
      ref: mapped && orientation === -1 ? rc(ref) : ref,
      alt: mapped && orientation === -1 ? rc(alt) : alt,
      role: intended.has(index) ? "intended" : "blocking",
      referenceIndex: index,
    });
  }
  variants.sort((a, b) => a.position - b.position);
  if (!variants.some(v => v.role === "intended")) throw new Error("No validated intended substitution was found in this donor.");
  return {
    donorIndex,
    donorName: donor.name || `Donor ${donorIndex + 1}`,
    genomeLength: genome.length,
    mapped,
    variants,
  };
}

/**
 * Side-by-side blocker layouts for two donors that should share the same intended edit.
 * Positions use chromosome-plus coordinates when mapping is provided; otherwise uploaded-reference indices.
 */
export function compareDonorBlockerLayouts(project, {
  donorIndexA = 0, donorIndexB = 1, referenceStart = null, orientation = 1,
} = {}) {
  if (donorIndexA === donorIndexB) throw new Error("Choose two different matched donors to compare.");
  const a = listDonorAlleleVariants(project, { donorIndex: donorIndexA, referenceStart, orientation });
  const b = listDonorAlleleVariants(project, { donorIndex: donorIndexB, referenceStart, orientation });
  const intendedA = a.variants.filter(v => v.role === "intended");
  const intendedB = b.variants.filter(v => v.role === "intended");
  const intendedKeysA = new Set(intendedA.map(variantKey));
  const intendedKeysB = new Set(intendedB.map(variantKey));
  const sharedIntended = intendedA.filter(v => intendedKeysB.has(variantKey(v)));
  if (!sharedIntended.length || intendedKeysA.size !== intendedKeysB.size || sharedIntended.length !== intendedKeysA.size) {
    throw new Error("These donors do not share the same intended substitution set; AlphaGenome A vs B compare is for alternate blocker layouts of one edit.");
  }
  const blockA = a.variants.filter(v => v.role === "blocking");
  const blockB = b.variants.filter(v => v.role === "blocking");
  const blockKeysA = new Set(blockA.map(variantKey));
  const blockKeysB = new Set(blockB.map(variantKey));
  const sharedBlocking = blockA.filter(v => blockKeysB.has(variantKey(v)));
  const onlyA = blockA.filter(v => !blockKeysB.has(variantKey(v)));
  const onlyB = blockB.filter(v => !blockKeysA.has(variantKey(v)));
  const rows = [
    ...sharedIntended.map(v => ({ ...v, membership: "shared", label: "Intended (both)" })),
    ...sharedBlocking.map(v => ({ ...v, membership: "shared", label: "Blocking (both)" })),
    ...onlyA.map(v => ({ ...v, membership: "a", label: `Blocking · ${a.donorName}` })),
    ...onlyB.map(v => ({ ...v, membership: "b", label: `Blocking · ${b.donorName}` })),
  ].sort((x, y) => x.position - y.position || x.role.localeCompare(y.role));
  return {
    donorA: { index: a.donorIndex, name: a.donorName, blockingCount: blockA.length },
    donorB: { index: b.donorIndex, name: b.donorName, blockingCount: blockB.length },
    mapped: a.mapped,
    sharedIntended,
    sharedBlocking,
    onlyA,
    onlyB,
    rows,
    summary: {
      intendedShared: sharedIntended.length,
      blockingShared: sharedBlocking.length,
      blockingOnlyA: onlyA.length,
      blockingOnlyB: onlyB.length,
    },
  };
}

/** A single matched donor, not the union of blocking edits from different donor alternatives. */
export async function buildAlphaGenomeRequest(project, {
  assembly, chromosome, referenceStart, orientation, ontologyTerm, donorIndex = 0,
  mappingConfirmed = false, sequenceLength = 16384,
} = {}) {
  const result = project?.designResult;
  if (!result || result.err || !["pm", "genomic-snv"].includes(result.type)) {
    throw new Error("AlphaGenome donor review currently supports substitution designs only; select a point-mutation or genomic SNP design.");
  }
  if (!mappingConfirmed) throw new Error("Confirm the assembly and genomic mapping of the uploaded reference.");
  if (assembly !== "GRCh38") throw new Error("This first integration supports human GRCh38 only; no automatic liftover or assembly inference.");
  const chrom = String(chromosome || "").replace(/^chr/i, "").toUpperCase();
  if (!/^(?:[1-9]|1\d|2[0-2]|X|Y)$/.test(chrom)) throw new Error("Choose a human chromosome 1–22, X or Y.");
  if (!Number.isSafeInteger(referenceStart) || referenceStart < 1 || ![1, -1].includes(orientation)) {
    throw new Error("Provide the 1-based chromosome start and reference orientation (+1 or -1).");
  }
  if (typeof ontologyTerm !== "string" || !/^(?:UBERON|CL|EFO):\d+$/.test(ontologyTerm)) {
    throw new Error("Provide a tissue/cell ontology identifier from AlphaGenome output metadata (UBERON, CL or EFO).");
  }
  if (![16384, 131072].includes(sequenceLength)) throw new Error("Choose a 16,384 or 131,072 bp prediction context.");
  const declared = alphaGenomeMapping(project);
  if (declared && (declared.assembly !== assembly || String(declared.chromosome).replace(/^chr/i, "").toUpperCase() !== chrom || declared.referenceStart !== referenceStart || declared.orientation !== orientation)) {
    throw new Error("The mapping conflicts with the GenBank chromosome annotation.");
  }
  const allele = listDonorAlleleVariants(project, { donorIndex, referenceStart, orientation });
  const variants = allele.variants.map(({ position, ref, alt, role }) => ({ position, ref, alt, role }));
  if (variants.at(-1).position - variants[0].position >= sequenceLength / 2) throw new Error("Edits are too far apart for the selected context.");
  const genome = result.gb.genomicSequence.toUpperCase();
  const payload = {
    schema: ALPHAGENOME_REQUEST_SCHEMA, gene: String(result.gene || project.gene || "Locus"),
    assembly, chromosome: `chr${chrom}`, donor: allele.donorName,
    reference: { start: referenceStart, sequence: orientation === -1 ? rc(genome) : genome },
    variants, ontologyTerms: [ontologyTerm], sequenceLength,
    requestedOutputs: ["RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE"],
  };
  return { ...payload, requestId: await reviewRequestId(payload) };
}

export function validateAlphaGenomeReport(report, request) {
  if (report?.schema !== "assured-alphagenome-review/1" || report.status !== "complete" || report.requestId !== request?.requestId || report.evidenceType !== "model-prediction") {
    throw new Error("This report is incomplete or does not match the current donor, mapping, tissue and context. Export and run a new request.");
  }
  if (typeof report.sdkVersion !== "string" || typeof report.modelVersion !== "string" || !report.modelVersion || !Array.isArray(report.comparisons) || report.comparisons.length !== 3) throw new Error("The report is missing model provenance or comparisons.");
  const expected = ["reference_to_intended", "reference_to_full_donor", "intended_to_full_donor"];
  for (const [index, comparison] of report.comparisons.entries()) {
    if (comparison.id !== expected[index] || !Array.isArray(comparison.tracks) || !comparison.tracks.length) throw new Error("The report is missing matched prediction tracks.");
    if (!request.requestedOutputs.every(output => comparison.tracks.some(track => track.output === output))) throw new Error("The report is missing requested expression or splicing outputs.");
    for (const track of comparison.tracks) {
      if (!request.requestedOutputs.includes(track.output) || typeof track.name !== "string" || ![track.meanDelta, track.meanAbsDelta, track.maxAbsDelta].every(n => typeof n === "number" && Number.isFinite(n)) || track.meanAbsDelta < 0 || track.maxAbsDelta < track.meanAbsDelta) throw new Error("The report contains invalid track metrics.");
    }
  }
  return report;
}
