import { indexOfGenomic } from "../engine/design/genomicCoords.js";

export function normalizeGenomicDesign(snpDesign) {
  if (!snpDesign || snpDesign.err) return snpDesign || { err: "No genomic design returned." };
    const gp = indexOfGenomic(snpDesign.input, snpDesign.input.position);
    return {
      ...snpDesign,
      type: "genomic-snv",
      gene: snpDesign.input?.gene || "Locus",
      gp,
      deliveryMethod: snpDesign.input?.deliveryMethod || "rnp",
      gs: (snpDesign.candidates || []).map((c) => ({
        ...c,
        n: c.name,
        pm: c.pam,
        note: `chr${snpDesign.input.chromosome}:${c.interval.start}–${c.interval.end}; cut offset ${c.d} bp; ${c.protection.tier} protection`
      })),
      os: (snpDesign.candidates || []).map((c) => ({
        ...c.donor,
        n: `ssODN matched to ${c.name}`,
        guideName: c.name,
        guideStrand: c.str,
        nucleotideValidation: c.nucleotideValidation,
        guideProtection: c.crossProtection || [{ guideName: c.name, ...c.protection }],
        desiredDiffIndexes: Number.isFinite(gp) && Number.isFinite(c.donor?.donorStart) ? [gp - c.donor.donorStart] : []
      })),
      ps: snpDesign.primers?.length ? [snpDesign.primers[0].forward, snpDesign.primers[0].reverse] : [],
      primerCandidates: snpDesign.primers || [],
      amp: snpDesign.primers?.length ? `${snpDesign.primers[0].ampliconLength} bp (WT and edited)` : "",
      primerStrategy: "Genomic PCR; RNA validation must separately establish splice effects.",
      procurement: {
        status: snpDesign.status === "BLOCKED" ? "blocked" : "review",
        blockers: snpDesign.blockers || [],
        warnings: snpDesign.warnings || [],
        standingRequirements: []
      }
    };
}
