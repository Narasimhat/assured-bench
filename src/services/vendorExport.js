import { getEnzyme } from "../engine/design/enzymeConfig.js";

function guideOrder(result, guide) {
  const id = result.enzyme?.id || result.input?.enzyme || "spcas9";
  const enzyme = getEnzyme(id);
  const spacer = guide.spacer || guide.sp || guide.sequence || guide.seq;
  return { enzyme, isCas9: id === "spcas9", spacer,
    sequence: id === "spcas9" ? spacer : (guide.full_crrna || spacer),
    notes: id === "spcas9" ? "" : `${enzyme.name}; config ${enzyme.version}; ${guide.full_crrna ? "Verified full crRNA (repeat + spacer)." : "Spacer only: supply a verified enzyme-specific repeat before ordering full crRNA."} Activity/CFD uncalibrated; confirm vendor chemistry and nuclease compatibility.` };
}

/**
 * Reagent Vendor Ordering Formatter
 * Generates direct copy-paste strings and formatted CSVs for IDT, Twist, Synthego, and GenScript.
 */

export function generateIdtOrderRows(designPayload) {
  const rows = [];
  const result = designPayload?.result;
  if (!result) return rows;

  const gene = designPayload.input?.gene || result.gene || "TARGET";

  // 1. Guides as Alt-R crRNA
  const guides = result.guides || result.gs || [];
  guides.forEach((g, idx) => {
    const order = guideOrder(result, g);
    const seq = order.sequence;
    if (seq) {
      rows.push({
        itemType: "crRNA",
        name: `${gene}_gRNA${idx + 1}`,
        sequence: seq,
        vendor: "IDT",
        product: order.isCas9 ? "Alt-R CRISPR-Cas9 crRNA (2 nmol or 10 nmol)" : `${order.enzyme.name} custom crRNA (confirm vendor compatibility)`,
        scale: "2 nmol",
        purification: "Standard Desalting",
        notes: order.isCas9 ? `Target PAM: ${g.pam || "NGG"}, GC: ${g.gc ?? "unavailable"}%, CFD residual: ${g.cfdResidual ?? "unavailable"}` : order.notes
      });
    }
  });

  // 2. Donors as Alt-R HDR Donor Oligo / Ultramer / Megamer
  const donors = result.donors || result.os || (result.donor ? [result.donor] : (result.ssodn ? [result.ssodn] : []));
  donors.forEach((d, idx) => {
    const seq = typeof d === "string" ? d : (d.od || d.sequence || d.seq || d.genomicDonor || d.donorSense || d.orderedStrandSequence);
    if (seq) {
      rows.push({
        itemType: "Donor (ssODN)",
        name: `${gene}_Donor_${idx + 1}`,
        sequence: seq,
        vendor: "IDT",
        product: seq.length <= 200 ? "Alt-R HDR Donor Oligo" : "Megamer Single-Stranded DNA",
        scale: "4 nmol",
        purification: "PAGE",
        notes: `Length: ${seq.length} nt; Synonymous PAM/seed mutations included`
      });
    }
  });

  // 3. Primers as Standard DNA Oligos
  const primerPair = result.recommendedPrimerPair || result.primers?.[0];
  if (primerPair?.forward && primerPair?.reverse) {
    rows.push({
      itemType: "Primer (Fwd)",
      name: `${gene}_PCR_Fw`,
      sequence: primerPair.forward.s || primerPair.forward.sequence,
      vendor: "IDT",
      product: "Standard DNA Oligo",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${primerPair.forward.tm}°C, GC: ${primerPair.forward.gc}%`
    });
    rows.push({
      itemType: "Primer (Rev)",
      name: `${gene}_PCR_Rev`,
      sequence: primerPair.reverse.s || primerPair.reverse.reverseComplement || primerPair.reverse.sequence,
      vendor: "IDT",
      product: "Standard DNA Oligo",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${primerPair.reverse.tm}°C, GC: ${primerPair.reverse.gc}%`
    });
  } else if (result.ps && result.ps.length >= 2) {
    const fw = result.ps.find(p => p.n?.toLowerCase().includes("fw")) || result.ps[0];
    const rev = result.ps.find(p => p.n?.toLowerCase().includes("rev")) || result.ps[1];
    rows.push({
      itemType: "Primer (Fwd)",
      name: `${gene}_PCR_Fw`,
      sequence: fw.s,
      vendor: "IDT",
      product: "Standard DNA Oligo",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${fw.tm || 60}°C, GC: ${fw.gc || 50}%`
    });
    rows.push({
      itemType: "Primer (Rev)",
      name: `${gene}_PCR_Rev`,
      sequence: rev.s,
      vendor: "IDT",
      product: "Standard DNA Oligo",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${rev.tm || 60}°C, GC: ${rev.gc || 50}%`
    });
  }

  return rows;
}

export function generateSynthegoOrderRows(designPayload) {
  const result = designPayload?.result;
  if (!result) return [];
  const gene = designPayload.input?.gene || result.gene || "TARGET";
  const rows = [];

  const guides = result.guides || result.gs || [];
  guides.forEach((g, idx) => {
    const order = guideOrder(result, g);
    const seq = order.sequence;
    if (seq) {
      rows.push({
        itemType: order.isCas9 ? "sgRNA" : "crRNA",
        name: g.n || `${gene}_sgRNA_${idx + 1}`,
        sequence: seq,
        vendor: "Synthego",
        product: order.isCas9 ? "CRISPR Synthetic sgRNA (Modified 2'-O-methyl 3' end-modified)" : `${order.enzyme.name} custom crRNA (confirm vendor compatibility)`,
        scale: "1.5 nmol",
        purification: "Standard Desalting",
        notes: order.isCas9 ? `20 nt protospacer without PAM (PAM: ${g.pam || g.pm || "NGG"})` : order.notes
      });
    }
  });

  // Include ssODN donors and flanking PCR primers so the scientist has a complete reagent list
  const donors = result.donors || result.os || (result.donor ? [result.donor] : (result.ssodn ? [result.ssodn] : []));
  donors.forEach((d, idx) => {
    const seq = typeof d === "string" ? d : (d.od || d.sequence || d.seq || d.genomicDonor || d.donorSense || d.orderedStrandSequence);
    if (seq) {
      rows.push({
        itemType: "Donor (ssODN)",
        name: d.n || `${gene}_Donor_${idx + 1}`,
        sequence: seq,
        vendor: "IDT / Custom Oligo",
        product: seq.length <= 200 ? "Alt-R HDR Donor Oligo / Ultramer" : "Megamer ssDNA",
        scale: "4 nmol",
        purification: "PAGE",
        notes: `Length: ${seq.length} nt; deliver with the matched enzyme-compatible guide and nuclease`
      });
    }
  });

  const primerPair = result.recommendedPrimerPair || result.primers?.[0];
  if (primerPair?.forward && primerPair?.reverse) {
    rows.push({
      itemType: "Primer (Fwd)",
      name: `${gene}_PCR_Fw`,
      sequence: primerPair.forward.s || primerPair.forward.sequence,
      vendor: "Standard Oligo",
      product: "Standard DNA Primer",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${primerPair.forward.tm}°C, GC: ${primerPair.forward.gc}%`
    });
    rows.push({
      itemType: "Primer (Rev)",
      name: `${gene}_PCR_Rev`,
      sequence: primerPair.reverse.s || primerPair.reverse.reverseComplement || primerPair.reverse.sequence,
      vendor: "Standard Oligo",
      product: "Standard DNA Primer",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${primerPair.reverse.tm}°C, GC: ${primerPair.reverse.gc}%`
    });
  } else if (result.ps && result.ps.length >= 2) {
    const fw = result.ps.find(p => p.n?.toLowerCase().includes("fw")) || result.ps[0];
    const rev = result.ps.find(p => p.n?.toLowerCase().includes("rev")) || result.ps[1];
    rows.push({
      itemType: "Primer (Fwd)",
      name: fw.n || `${gene}_PCR_Fw`,
      sequence: fw.s,
      vendor: "Standard Oligo",
      product: "Standard DNA Primer",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${fw.tm || 60}°C, GC: ${fw.gc || 50}%`
    });
    rows.push({
      itemType: "Primer (Rev)",
      name: rev.n || `${gene}_PCR_Rev`,
      sequence: rev.s,
      vendor: "Standard Oligo",
      product: "Standard DNA Primer",
      scale: "25 nmol",
      purification: "Standard Desalting",
      notes: `Tm: ${rev.tm || 60}°C, GC: ${rev.gc || 50}%`
    });
  }

  return rows;
}

export function formatBulkPasteTsv(orderRows) {
  if (!orderRows || orderRows.length === 0) return "";
  return orderRows
    .map(r => `${r.name}\t${r.sequence}\t${r.scale || "25nm"}\t${r.purification || "STD"}`)
    .join("\n");
}

export function formatOligosFasta(orderRows) {
  if (!orderRows || orderRows.length === 0) return "";
  return orderRows
    .map(r => `>${r.name} | ${r.itemType || r.product || ""} | ${r.notes || ""}\n${r.sequence}`)
    .join("\n");
}

export function exportOrderToCsv(orderRows, filename = "reagents_order.csv") {
  if (!orderRows || orderRows.length === 0) return;
  const headers = Object.keys(orderRows[0]);
  const csvContent = [
    headers.join(","),
    ...orderRows.map(row => headers.map(h => `"${String(row[h] || "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
