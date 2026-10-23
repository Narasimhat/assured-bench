// Minimal GenBank flat-file reader: the sequence and the features with their locations and qualifiers.
// Enough for a RefSeqGene / Ensembl / SnapGene export: LOCUS, DEFINITION, ACCESSION, FEATURES (CDS, exon, mRNA, gene), ORIGIN.
// Locations: a..b, a, <a..b, a..>b, complement(...), join(...), order(...), nested. Positions are returned 0-based, half-open,
// segments in ascending genomic order; `strand` is "+" or "-" (the strand of the first segment).

function splitTop(text) {
  const parts = []; let depth = 0; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1; else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start)); return parts;
}

function parseLocationPart(text, strand = 1) {
  const part = text.trim(); let m;
  if ((m = /^complement\((.*)\)$/.exec(part))) return parseLocationPart(m[1], -strand);
  if ((m = /^(?:join|order)\((.*)\)$/.exec(part))) return splitTop(m[1]).flatMap((piece) => parseLocationPart(piece, strand));
  if ((m = /^[<>]?(\d+)\.\.[<>]?(\d+)$/.exec(part))) return [{ s: Number(m[1]) - 1, e: Number(m[2]), strand }];
  if ((m = /^[<>]?(\d+)$/.exec(part))) return [{ s: Number(m[1]) - 1, e: Number(m[1]), strand }];
  return [];
}

export function parseLocation(text) {
  const pieces = parseLocationPart(String(text).replace(/\s+/g, ""));
  if (!pieces.length) return null;
  const strand = pieces[0].strand === -1 ? "-" : "+";
  const segments = pieces.map((p) => [p.s, p.e]).sort((x, y) => x[0] - y[0]);
  return { strand, segments };
}

/** @returns {{ locus: string, accession: string, definition: string, sequence: string, features: Array<{ type: string, location: object|null, qualifiers: object }> }} */
export function parseGenBank(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const first = (prefix) => { const line = lines.find((l) => l.startsWith(prefix)); return line ? line.slice(prefix.length).trim() : ""; };
  const featStart = lines.findIndex((l) => l.startsWith("FEATURES"));
  const originStart = lines.findIndex((l) => l.startsWith("ORIGIN"));
  const features = [];
  if (featStart >= 0) {
    const end = originStart >= 0 ? originStart : lines.length;
    let current = null; let qualifier = null;
    for (let i = featStart + 1; i < end; i += 1) {
      const line = lines[i];
      if (/^ {5}\S/.test(line)) { current = { type: line.slice(5, 21).trim(), locText: line.slice(21).trim(), raw: [] }; features.push(current); qualifier = null; continue; }
      if (!current) continue;
      const body = line.slice(21).trim(); if (!body) continue;
      if (body.startsWith("/")) { const eq = body.indexOf("="); qualifier = { name: eq > 0 ? body.slice(1, eq) : body.slice(1), text: eq > 0 ? body.slice(eq + 1) : "true" }; current.raw.push(qualifier); }
      else if (qualifier) qualifier.text += (qualifier.name === "translation" ? "" : " ") + body;
      else current.locText += body;
    }
  }
  const out = features.map((f) => {
    const qualifiers = {};
    f.raw.forEach((q) => { const value = q.text.replace(/^"/, "").replace(/"$/, ""); (qualifiers[q.name] = qualifiers[q.name] || []).push(value); });
    return { type: f.type, location: parseLocation(f.locText), qualifiers };
  });
  let sequence = "";
  if (originStart >= 0) for (let i = originStart + 1; i < lines.length; i += 1) { if (lines[i].startsWith("//")) break; sequence += lines[i].replace(/[^A-Za-z]/g, ""); }
  const locusLine = lines.find((l) => l.startsWith("LOCUS")) || "";
  return { locus: locusLine.split(/\s+/)[1] || "", accession: first("ACCESSION").split(/\s+/)[0] || "", definition: first("DEFINITION"), sequence: sequence.toUpperCase(), features: out };
}

export const qualifier = (feature, name) => (feature.qualifiers[name] || [])[0] || "";
