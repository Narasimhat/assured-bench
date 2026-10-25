import { parseGB } from "../engine/design/designEngine.js";
export function uploadedReferenceGene(raw, requested = "", filename = "") {
  const record = parseGB(raw);
  if (!record.seq || !/^[ACGTN]+$/.test(record.seq)) throw Error("Choose a GenBank file containing a DNA sequence.");
  const genes = [...new Set(record.feats.filter(f => f.type === "CDS")
    .map(f => String(f.q?.gene || f.q?.label || "").trim().replace(/\s+CDS$/i, "")).filter(Boolean))];
  const match = genes.find(gene => gene.toUpperCase() === requested.trim().toUpperCase());
  if (match) return match;
  if (genes.length === 1) return genes[0];
  if (genes.length > 1) throw Error(`This file annotates several genes (${genes.join(", ")}). Enter the intended gene in Target gene and upload the file again.`);
  return requested.trim() || filename.replace(/\.[^/.]+$/, "");
}
