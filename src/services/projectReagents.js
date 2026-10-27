/**
 * Project a designResult into the orderable reagents the user needs next:
 * guides, donors, and primers. Same fields Order / vendor export already read.
 */

function guideSequence(guide) {
  return guide?.spacer || guide?.sp || guide?.sequence || guide?.seq || "";
}

function donorSequence(donor) {
  if (!donor) return "";
  if (typeof donor === "string") return donor;
  return donor.od || donor.sequence || donor.seq || donor.genomicDonor || donor.donorSense || donor.orderedStrandSequence || "";
}

function primerSequence(primer, role) {
  if (!primer) return "";
  if (role === "rev") {
    return primer.s || primer.reverseComplement || primer.sequence || "";
  }
  return primer.s || primer.sequence || "";
}

function collectDonors(result) {
  if (result.donors?.length) return result.donors;
  if (result.os?.length) return result.os;
  if (result.donor) return [result.donor];
  if (result.ssodn) return [result.ssodn];
  return [];
}

function collectPrimers(result, gene) {
  const pair = result.recommendedPrimerPair || result.primers?.[0];
  if (pair?.forward && pair?.reverse) {
    return [
      {
        id: "fwd",
        role: "forward",
        name: `${gene}_PCR_Fw`,
        sequence: primerSequence(pair.forward, "fwd"),
        note: pair.forward.tm != null ? `Tm ${pair.forward.tm}°C` : "",
      },
      {
        id: "rev",
        role: "reverse",
        name: `${gene}_PCR_Rev`,
        sequence: primerSequence(pair.reverse, "rev"),
        note: pair.reverse.tm != null ? `Tm ${pair.reverse.tm}°C` : "",
      },
    ].filter((row) => row.sequence);
  }

  const list = result.ps || [];
  if (list.length >= 2) {
    const fw = list.find((p) => p.n?.toLowerCase().includes("fw")) || list[0];
    const rev = list.find((p) => p.n?.toLowerCase().includes("rev")) || list[1];
    return [
      {
        id: "fwd",
        role: "forward",
        name: fw.n || `${gene}_PCR_Fw`,
        sequence: primerSequence(fw, "fwd"),
        note: fw.tm != null ? `Tm ${fw.tm}°C` : "",
      },
      {
        id: "rev",
        role: "reverse",
        name: rev.n || `${gene}_PCR_Rev`,
        sequence: primerSequence(rev, "rev"),
        note: rev.tm != null ? `Tm ${rev.tm}°C` : "",
      },
    ].filter((row) => row.sequence);
  }

  return list
    .map((p, idx) => ({
      id: `p${idx}`,
      role: "primer",
      name: p.n || `${gene}_Primer_${idx + 1}`,
      sequence: primerSequence(p, "fwd"),
      note: p.tm != null ? `Tm ${p.tm}°C` : "",
    }))
    .filter((row) => row.sequence);
}

/**
 * @param {object|null|undefined} designResult
 * @param {string} [geneHint]
 * @returns {{ gene: string, guides: object[], donors: object[], primers: object[], counts: { guides: number, donors: number, primers: number } }}
 */
export function projectDesignReagents(designResult, geneHint = "") {
  if (!designResult || designResult.err) {
    return { gene: geneHint || "TARGET", guides: [], donors: [], primers: [], counts: { guides: 0, donors: 0, primers: 0 } };
  }

  const gene = geneHint || designResult.gene || "TARGET";
  const rawGuides = designResult.guides || designResult.gs || [];
  const guides = rawGuides
    .map((g, idx) => {
      const sequence = guideSequence(g);
      if (!sequence) return null;
      return {
        id: g.n || g.id || `g${idx + 1}`,
        name: g.n || g.name || `${gene}_gRNA${idx + 1}`,
        sequence,
        pam: g.pam || g.pm || "",
        strand: g.strand || g.str || "",
        note: [g.pam || g.pm ? `PAM ${g.pam || g.pm}` : "", g.strand || g.str ? `strand ${g.strand || g.str}` : ""]
          .filter(Boolean)
          .join(" · "),
      };
    })
    .filter(Boolean);

  const donors = collectDonors(designResult)
    .map((d, idx) => {
      const sequence = donorSequence(d);
      if (!sequence) return null;
      const name = typeof d === "object" && d.name ? d.name : `${gene}_Donor_${idx + 1}`;
      return {
        id: typeof d === "object" && (d.id || d.name) ? (d.id || d.name) : `d${idx + 1}`,
        name,
        sequence,
        note: `${sequence.length} nt`,
      };
    })
    .filter(Boolean);

  const primers = collectPrimers(designResult, gene);

  return {
    gene,
    guides,
    donors,
    primers,
    counts: {
      guides: guides.length,
      donors: donors.length,
      primers: primers.length,
    },
  };
}
