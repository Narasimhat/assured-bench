import { buildQcDesignSpec } from "../engine/design/qcExport.js";
import { readGenomicReferenceMetadata } from "../engine/design/genomicSnp.js";

export const ALPHAGENOME_REQUEST_SCHEMA = "assured-alphagenome-request/1";
const rc = sequence => [...sequence].reverse().map(b => ({ A: "T", C: "G", G: "C", T: "A", N: "N" }[b])).join("");
const stable = value => value && typeof value === "object"
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
  : value;
export async function reviewRequestId(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(payload)));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}

export function alphaGenomeMapping(project) {
  const meta = readGenomicReferenceMetadata(project?.genbankRaw || "");
  return meta ? { assembly: meta.assembly, chromosome: meta.chromosome, referenceStart: meta.start, orientation: meta.orientation } : null;
}

/** Index (0-based, in the uploaded reference) of the intended substitution of the current design, or null; used to place the reference on the genome. */
export function intendedEditIndex(project) {
  try {
    const result = project?.designResult;
    if (!result || result.err || !["pm", "genomic-snv"].includes(result.type)) return null;
    const spec = buildQcDesignSpec(result);
    if (spec.err) return null;
    const marker = (spec.markers || []).find(m => m.role === "intended");
    return marker ? marker.pos + spec.reference.offset : null;
  } catch { return null; }
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
  if (!/^(?:[1-9]|1\d|2[0-2]|X|Y)$/.test(chrom)) throw new Error("Select the human chromosome the uploaded reference sits on (1–22, X or Y). Bench could not read it from the reference, so it has to be chosen.");
  if (!Number.isSafeInteger(referenceStart) || referenceStart < 1 || ![1, -1].includes(orientation)) {
    throw new Error("Enter the 1-based chromosome position of the first base of the uploaded reference and choose its orientation (+1 or −1).");
  }
  if (typeof ontologyTerm !== "string" || !/^(?:UBERON|CL|EFO):\d+$/.test(ontologyTerm)) {
    throw new Error("Provide a tissue/cell ontology identifier from AlphaGenome output metadata (UBERON, CL or EFO).");
  }
  if (![16384, 131072].includes(sequenceLength)) throw new Error("Choose a 16,384 or 131,072 bp prediction context.");
  const genome = result.gb?.genomicSequence?.toUpperCase();
  if (!genome || genome.length > 1000000 || !/^[ACGTN]+$/.test(genome)) throw new Error("A valid uploaded genomic reference of at most 1 Mb is required.");
  const declared = alphaGenomeMapping(project);
  if (declared && (declared.assembly !== assembly || String(declared.chromosome).replace(/^chr/i, "").toUpperCase() !== chrom || declared.referenceStart !== referenceStart || declared.orientation !== orientation)) {
    throw new Error("The mapping conflicts with the GenBank chromosome annotation.");
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
    variants.push({
      position: orientation === -1 ? referenceStart + genome.length - 1 - index : referenceStart + index,
      ref: orientation === -1 ? rc(ref) : ref,
      alt: orientation === -1 ? rc(alt) : alt,
      role: intended.has(index) ? "intended" : "blocking",
    });
  }
  variants.sort((a, b) => a.position - b.position);
  if (!variants.some(v => v.role === "intended")) throw new Error("No validated intended substitution was found in this donor.");
  if (variants.at(-1).position - variants[0].position >= sequenceLength / 2) throw new Error("Edits are too far apart for the selected context.");
  const payload = {
    schema: ALPHAGENOME_REQUEST_SCHEMA, gene: String(result.gene || project.gene || "Locus"),
    assembly, chromosome: `chr${chrom}`, donor: donor.name,
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
