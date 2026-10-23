// Reads guides and donors out of an exported Assured design report (HTML), so that the QC needs no retyping. The report is read as text with a small
// tokenizer: nothing in it is rendered or executed, and scripts, styles, frames and embedded objects are dropped before anything is read.
// (Approach and section names follow Assured_TraceEdit's design-import.js; this version has no DOM dependency so that the command line can use it.)

import { parseProteinNotes } from "./protein.js";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "svg", "noscript"]);
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function parseHtml(html) {
  const root = { tag: "#root", children: [], parent: null, text: "", parts: [] }; const all = []; let current = root; let dropDepth = 0; let dropTag = null;
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>|([^<]+)|</g; let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[3] !== undefined) { if (!dropDepth) { const t = m[3].replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (e) => ENTITIES[e]); current.text += t; current.parts.push(t); } continue; }
    if (!m[1]) continue;
    const tag = m[1].toLowerCase(); const closing = m[0][1] === "/";
    if (dropDepth) { if (tag === dropTag) { if (closing) { dropDepth -= 1; if (!dropDepth) dropTag = null; } else if (m[2] !== "/") dropDepth += 1; } continue; }
    if (!closing && DROP.has(tag)) { if (m[2] !== "/" && !VOID.has(tag)) { dropDepth = 1; dropTag = tag; } continue; }
    if (closing) { let n = current; while (n && n.tag !== tag) n = n.parent; if (n && n.parent) current = n.parent; continue; }
    const node = { tag, children: [], parent: current, text: "", parts: [], index: all.length }; current.children.push(node); all.push(node);
    if (!VOID.has(tag) && m[2] !== "/") current = node;
  }
  const textOf = (node) => { let out = node.parts.join(" "); node.children.forEach((c) => { out += ` ${textOf(c)}`; }); return out; };
  all.forEach((n) => { n.textContent = null; });
  const text = (node) => { if (node.textContent === null) node.textContent = textOf(node).replace(/\s+/g, " ").trim(); return node.textContent; };
  return { all, text, textRaw: (node) => textOf(node) };
}

const reverseComplement = (s) => [...s].reverse().map((b) => ({ A: "T", C: "G", G: "C", T: "A" }[b])).join("");
const valid = (s, min, max) => s.length >= min && s.length <= max && /^[ACGT]+$/.test(s);

export function parseDesignReport(html) {
  if (typeof html !== "string" || html.length > 5_000_000) throw new Error("The design report must be smaller than 5 MB.");
  const { all: nodes, text } = parseHtml(html); const dna = (node) => (node ? text(node).replace(/\s/g, "").toUpperCase() : "");
  const headings = nodes.filter((n) => n.tag === "h1"); const sections = nodes.filter((n) => n.tag === "h2"); const designs = [];
  for (const heading of sections.filter((n) => /gRNA\s+Sequences/i.test(text(n)))) {
    const index = nodes.indexOf(heading);
    const start = [...headings].reverse().find((n) => nodes.indexOf(n) < index); const end = headings.find((n) => nodes.indexOf(n) > index);
    const stop = end ? nodes.indexOf(end) : nodes.length; const nextSection = sections.find((n) => nodes.indexOf(n) > index); const guideEnd = nextSection ? nodes.indexOf(nextSection) : stop;
    const guides = [];
    for (const tr of nodes.slice(index + 1, guideEnd).filter((n) => n.tag === "tr")) {
      const cells = tr.children.filter((n) => n.tag === "td" || n.tag === "th");
      if (cells.length < 2 || /^name$/i.test(text(cells[0]))) continue;
      const parts = text(cells[1]).toUpperCase().split(/\s+/).filter(Boolean); let sequence = parts[0] || "";
      if (parts.length === 1 && sequence.length === 23 && /GG$/.test(sequence)) sequence = sequence.slice(0, 20);
      if (!valid(sequence, 20, 20)) continue;
      if (!guides.some((g) => g.sequence === sequence)) guides.push({ name: text(cells[0]), sequence });
    }
    const donorSection = sections.find((n) => nodes.indexOf(n) > index && nodes.indexOf(n) < stop && /(?:ssODN\s+Donor\s+Templates|Donor\s+Design)/i.test(text(n)));
    const donors = []; const proteinTexts = [start ? text(start) : ""];
    if (donorSection) {
      const donorStart = nodes.indexOf(donorSection); const next = sections.find((n) => nodes.indexOf(n) > donorStart);
      const donorEnd = Math.min(stop, next ? nodes.indexOf(next) : stop); const donorNodes = nodes.slice(donorStart + 1, donorEnd); proteinTexts.push(donorNodes.map((n) => n.parts.join(" ")).join(" "));
      for (const label of donorNodes) {
        if (label.children.some((c) => c.tag !== "span") || !/^(?:Donor|Donor ssODN)$/i.test(text(label))) continue;
        const siblings = label.parent.children; const sibling = siblings[siblings.indexOf(label) + 1];
        const sequence = dna(sibling); if (!valid(sequence, 30, 4000)) continue;
        const nameHeading = [...donorNodes].reverse().find((n) => n.tag === "h3" && nodes.indexOf(n) < nodes.indexOf(label));
        const name = nameHeading ? text(nameHeading) : "ssODN donor";
        if (donors.some((d) => d.name === name && (d.sequence === sequence || d.sequence === reverseComplement(sequence)))) continue;
        const card = label.parent && label.parent.parent;
        const cardText = card ? text(card) : "";
        const isOppositeRef = /Opposite\s+(?:donor\s+)?strand|Reference\s+strand/i.test(cardText);
        if (isOppositeRef) continue;
        const recommended = /Order this strand|Recommended to order|Candidate donor|Candidate strand/i.test(cardText) || !isOppositeRef;
        donors.push({ name, sequence, recommended });
      }
      if (!donors.length) {
        for (const node of donorNodes) {
          if (node.tag !== "div" || !node.children.length || node.children.some((c) => c.tag !== "span")) continue;
          const sequence = dna(node);
          if (valid(sequence, 60, 4000) && !donors.some((d) => d.sequence === sequence || d.sequence === reverseComplement(sequence))) {
            donors.push({ name: "HDR donor", sequence, recommended: true });
          }
        }
      }
    }
    if (guides.length) designs.push({ title: start ? text(start) : "Assured design", guides, donors, protein: parseProteinNotes(proteinTexts) });
  }
  if (!designs.length) throw new Error("No supported Assured Design gRNA section found. Upload the exported design HTML report; PDF and order sheets are not supported.");
  return designs;
}
