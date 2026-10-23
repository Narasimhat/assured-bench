// Vector PDF from the SVG figures this app draws, with no dependencies and no DOM, so the same code runs in the browser and in node.
// Supported SVG: svg (width, height, viewBox), g and a with transform, rect (rx, ry), circle, ellipse, line, polyline, polygon, path (M L H V C S Q T A Z),
// text (x, y, font-size, font-weight, font-style, text-anchor), fill and stroke colours, opacity, stroke-width, stroke-dasharray, stroke-linejoin/linecap,
// and a tiling pattern fill (url(#id) to a <pattern> of rects, lines and paths). Anything else is skipped and reported in `unsupported`.
// Text uses the standard Helvetica and Courier faces (not embedded), so it prints and edits everywhere; characters outside Windows-1252 are replaced
// by look-alikes or "?" and counted in `lost`.

// Glyph widths (1/1000 em) of Helvetica and Helvetica-Bold for Windows-1252 codes 32..255, from the Adobe core AFM files; Courier is 600 throughout.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,584,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,584,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
const WIN1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
const MINUS_CODE = 0x81; // not used by Windows-1252; mapped to the glyph "minus" through the font's Differences array
const SUBSTITUTE = { 0x03bc: "\u00b5", 0x2265: ">=", 0x2264: "<=", 0x2192: "->", 0x2190: "<-", 0x2248: "~", 0x2260: "!=", 0x2032: "'", 0x2033: '"', 0x2010: "-", 0x2011: "-", 0x2009: " ", 0x2002: " ", 0x2003: " ", 0x202f: " ", 0x200b: "" };
const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", gray: "#808080", grey: "#808080", orange: "#ffa500", purple: "#800080", yellow: "#ffff00", currentcolor: "#000000" };
const SKIP = new Set(["title", "desc", "metadata", "defs", "pattern"]);
const SHAPES = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text"]);
const K = 0.5522847498307936;

const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
const fmt = (x) => { const s = (Math.round(x * 1000) / 1000).toString(); return s === "-0" ? "0" : s; };
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]; // apply a, then b

const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e];
});

export function parseSvg(src) {
  const root = { tag: "#root", attrs: {}, kids: [] };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s\/>!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = token.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.kids.push({ text: m[1] });
    else if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); }
    else if (m[3] !== undefined) {
      const attrs = {}; let a; attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[4] || ""))) attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
      const node = { tag: m[3].replace(/^.*:/, ""), attrs, kids: [] };
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.kids.push({ text: decode(m[6]) });
  }
  return root;
}

const textOf = (node) => node.kids.map((k) => (k.text !== undefined ? k.text : k.tag === "title" || k.tag === "desc" ? "" : textOf(k))).join(""); // tooltips (<title>) are not drawn

function parseTransform(value) {
  let m = [1, 0, 0, 1, 0, 0];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let t;
  while ((t = re.exec(value || ""))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number); let n = null;
    if (t[1] === "matrix" && a.length === 6) n = a;
    else if (t[1] === "translate") n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (t[1] === "scale") n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
    else if (t[1] === "rotate") {
      const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0;
      n = mul(mul([1, 0, 0, 1, -cx, -cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, cx, cy]);
    } else if (t[1] === "skewX") n = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (t[1] === "skewY") n = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (n && n.every(Number.isFinite)) m = mul(n, m);
  }
  return m;
}

function parseColor(value) {
  if (value === undefined || value === null) return null;
  let v = String(value).trim().toLowerCase();
  if (!v || v === "none" || v === "transparent") return null;
  if (NAMED[v]) v = NAMED[v];
  let m = /^#([0-9a-f]{3})$/.exec(v); if (m) return [...m[1]].map((c) => parseInt(c + c, 16) / 255);
  m = /^#([0-9a-f]{6})$/.exec(v); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*\)$/.exec(v);
  if (m) return [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].map(([x, p]) => Math.min(1, Math.max(0, p ? x / 100 : x / 255)));
  return [0, 0, 0];
}

function encodeText(text) {
  const codes = []; let lost = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 9 || cp === 10 || cp === 13) codes.push(32);
    else if (cp < 32) continue;
    else if (cp < 128 || (cp >= 0xa0 && cp <= 0xff)) codes.push(cp);
    else if (WIN1252[cp] !== undefined) codes.push(WIN1252[cp]);
    else if (cp === 0x2212) codes.push(MINUS_CODE);
    else if (SUBSTITUTE[cp] !== undefined) for (const c of SUBSTITUTE[cp]) codes.push(c.charCodeAt(0));
    else { codes.push(63); lost++; }
  }
  return { codes, lost };
}

function fontOf(ctx) {
  const family = String(ctx.family || "").toLowerCase();
  const mono = /courier|monospace|consolas|menlo|mono/.test(family.replace("sans-serif", ""));
  const bold = /^(bold|bolder|[6-9]00)$/.test(String(ctx.weight)); const italic = /italic|oblique/.test(String(ctx.fstyle));
  const suffix = bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "";
  return { name: (mono ? "Courier" : "Helvetica") + suffix, mono, bold };
}

const glyphWidth = (font, code) => (font.mono ? 600 : (font.bold ? HELV_BOLD : HELV)[code - 32] || 0);

function arcToBeziers(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [["L", x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const p = (phi * Math.PI) / 180, c = Math.cos(p), s = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const num_ = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num_ / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9)), step = dth / n, t = (4 / 3) * Math.tan(step / 4), out = [];
  for (let i = 0; i < n; i++) {
    const a1 = th1 + i * step, a2 = a1 + step;
    const pt = (a, k, sgn) => [Math.cos(a) - sgn * k * Math.sin(a), Math.sin(a) + sgn * k * Math.cos(a)];
    const [e1x, e1y] = pt(a1, t, 1), [e2x, e2y] = pt(a2, t, -1), [e3x, e3y] = [Math.cos(a2), Math.sin(a2)];
    const map = (x, y) => [c * rx * x - s * ry * y + cx, s * rx * x + c * ry * y + cy];
    out.push(["C", ...map(e1x, e1y), ...map(e2x, e2y), ...map(e3x, e3y)]);
  }
  return out;
}

function pathOps(d) {
  const tokens = String(d || "").match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const ops = []; let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
  const nx = () => Number(tokens[i++]);
  const have = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === "Z") { ops.push(["Z"]); x = sx; y = sy; lc = lq = null; continue; }
    do {
      if (C === "M") { const a = nx(), b = nx(); x = rel ? x + a : a; y = rel ? y + b : b; sx = x; sy = y; ops.push(["M", x, y]); cmd = rel ? "l" : "L"; lc = lq = null; break; }
      if (C === "L") { const a = nx(), b = nx(); x = rel ? x + a : a; y = rel ? y + b : b; ops.push(["L", x, y]); lc = lq = null; }
      else if (C === "H") { const a = nx(); x = rel ? x + a : a; ops.push(["L", x, y]); lc = lq = null; }
      else if (C === "V") { const b = nx(); y = rel ? y + b : b; ops.push(["L", x, y]); lc = lq = null; }
      else if (C === "C") { const v = [nx(), nx(), nx(), nx(), nx(), nx()].map((q, k) => (rel ? q + (k % 2 ? y : x) : q)); ops.push(["C", ...v]); lc = [v[2], v[3]]; lq = null; x = v[4]; y = v[5]; }
      else if (C === "S") { const v = [nx(), nx(), nx(), nx()].map((q, k) => (rel ? q + (k % 2 ? y : x) : q)); const f = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; ops.push(["C", f[0], f[1], ...v]); lc = [v[0], v[1]]; lq = null; x = v[2]; y = v[3]; }
      else if (C === "Q" || C === "T") {
        let q1; if (C === "Q") { q1 = [nx(), nx()].map((q, k) => (rel ? q + (k % 2 ? y : x) : q)); } else q1 = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y];
        const e = [nx(), nx()].map((q, k) => (rel ? q + (k % 2 ? y : x) : q));
        ops.push(["C", x + (2 / 3) * (q1[0] - x), y + (2 / 3) * (q1[1] - y), e[0] + (2 / 3) * (q1[0] - e[0]), e[1] + (2 / 3) * (q1[1] - e[1]), e[0], e[1]]);
        lq = q1; lc = null; x = e[0]; y = e[1];
      } else if (C === "A") {
        const rx = nx(), ry = nx(), phi = nx(), fa = nx(), fs = nx(), a = nx(), b = nx(), ex = rel ? x + a : a, ey = rel ? y + b : b;
        for (const o of arcToBeziers(x, y, rx, ry, phi, fa, fs, ex, ey)) ops.push(o);
        x = ex; y = ey; lc = lq = null;
      } else { i = tokens.length; break; }
    } while (have());
  }
  return ops;
}

const rectOps = (x, y, w, h, rx, ry) => {
  if (!(rx > 0 || ry > 0)) return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  rx = Math.min(rx || ry, w / 2); ry = Math.min(ry || rx, h / 2);
  return [["M", x + rx, y], ["L", x + w - rx, y], ["C", x + w - rx + K * rx, y, x + w, y + ry - K * ry, x + w, y + ry], ["L", x + w, y + h - ry],
    ["C", x + w, y + h - ry + K * ry, x + w - rx + K * rx, y + h, x + w - rx, y + h], ["L", x + rx, y + h],
    ["C", x + rx - K * rx, y + h, x, y + h - ry + K * ry, x, y + h - ry], ["L", x, y + ry], ["C", x, y + ry - K * ry, x + rx - K * rx, y, x + rx, y], ["Z"]];
};
const ellipseOps = (cx, cy, rx, ry) => [["M", cx + rx, cy], ["C", cx + rx, cy + K * ry, cx + K * rx, cy + ry, cx, cy + ry], ["C", cx - K * rx, cy + ry, cx - rx, cy + K * ry, cx - rx, cy],
  ["C", cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry], ["C", cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy], ["Z"]];
const opsToPdf = (ops) => ops.map((o) => (o[0] === "Z" ? "h" : o.slice(1).map(fmt).join(" ") + " " + { M: "m", L: "l", C: "c" }[o[0]])).join("\n");

const INHERITED = { fill: "fill", stroke: "stroke", "stroke-width": "sw", "fill-opacity": "fo", "stroke-opacity": "so", "font-family": "family", "font-size": "size", "font-weight": "weight", "font-style": "fstyle", "text-anchor": "anchor", "stroke-linejoin": "join", "stroke-linecap": "cap", "stroke-dasharray": "dash", "fill-rule": "rule" };

function styleOf(node) {
  const out = { ...node.attrs };
  if (node.attrs.style) for (const part of node.attrs.style.split(";")) { const k = part.indexOf(":"); if (k > 0) out[part.slice(0, k).trim()] = part.slice(k + 1).trim(); }
  return out;
}

function derive(ctx, a) {
  const next = { ...ctx };
  for (const [attr, key] of Object.entries(INHERITED)) if (a[attr] !== undefined) next[key] = a[attr];
  if (a.opacity !== undefined) next.op = ctx.op * Math.min(1, Math.max(0, num(a.opacity, 1))); // group opacity is applied to each child (exact unless children overlap)
  return next;
}

class Sheet {
  constructor(patterns) { this.fonts = new Map(); this.gstates = new Map(); this.patterns = []; this.patternDefs = patterns; this.lost = 0; this.unsupported = new Set(); this.out = []; }
  font(f) { if (!this.fonts.has(f.name)) this.fonts.set(f.name, "F" + (this.fonts.size + 1)); return this.fonts.get(f.name); }
  gstate(fo, so) { const key = fmt(fo) + "," + fmt(so); if (!this.gstates.has(key)) this.gstates.set(key, { name: "G" + (this.gstates.size + 1), fo, so }); return this.gstates.get(key).name; }
  pattern(def, matrix) { const key = def.id + ":" + matrix.map(fmt).join(","); let p = this.patterns.find((q) => q.key === key); if (!p) { p = { key, name: "P" + (this.patterns.length + 1), def, matrix }; this.patterns.push(p); } return p.name; }
}

function paintState(sheet, ctx, ctm, out, hasText) {
  const op = ctx.op;
  const fillPattern = typeof ctx.fill === "string" && /^url\(\s*#([^)]+)\)/.exec(ctx.fill.trim());
  const fillColor = fillPattern ? null : parseColor(ctx.fill), strokeColor = parseColor(ctx.stroke);
  const sw = num(ctx.sw, 1);
  const doStroke = !hasText && !!strokeColor && sw > 0;
  let doFill = !!fillColor;
  if (fillPattern) {
    const def = sheet.patternDefs[fillPattern[1].trim()];
    if (def) { out.push("/Pattern cs /" + sheet.pattern(def, mul(def.transform, ctm)) + " scn"); doFill = true; }
  } else if (fillColor) out.push(fillColor.map(fmt).join(" ") + " rg");
  const fo = num(ctx.fo, 1) * op, so = num(ctx.so, 1) * op;
  if (fo < 1 || so < 1) out.push("/" + sheet.gstate(Math.min(1, fo), Math.min(1, so)) + " gs");
  if (doStroke) {
    out.push(strokeColor.map(fmt).join(" ") + " RG", fmt(sw) + " w", ({ round: 1, bevel: 2 }[ctx.join] || 0) + " j", ({ round: 1, square: 2 }[ctx.cap] || 0) + " J", "4 M");
    const dash = String(ctx.dash || "").split(/[\s,]+/).filter(Boolean).map(Number);
    if (dash.length && dash.every((q) => Number.isFinite(q) && q >= 0) && dash.some((q) => q > 0)) out.push("[" + dash.map(fmt).join(" ") + "] 0 d");
  }
  return { doFill, doStroke };
}

function drawNode(node, ctx, ctm, sheet, out) {
  if (node.text !== undefined) return;
  const tag = node.tag;
  if (SKIP.has(tag)) return;
  const a = styleOf(node);
  if (a.display === "none" || a.visibility === "hidden") return;
  const next = derive(ctx, a);
  const local = parseTransform(a.transform);
  const total = mul(local, ctm);
  const hasT = a.transform !== undefined && local.some((v, i) => v !== [1, 0, 0, 1, 0, 0][i]);
  if (tag === "g" || tag === "a" || tag === "svg" || tag === "switch") {
    const inner = [];
    for (const kid of node.kids) drawNode(kid, next, total, sheet, inner);
    if (inner.length) { out.push("q"); if (hasT) out.push(local.map(fmt).join(" ") + " cm"); out.push(...inner, "Q"); }
    return;
  }
  if (!SHAPES.has(tag)) { sheet.unsupported.add(tag); return; }
  const body = [];
  if (tag === "text") {
    const color = parseColor(next.fill);
    const raw = textOf(node).replace(/[ \t\r\n]+/g, " ").replace(/^ | $/g, "");
    if (!color || !raw) return;
    const font = fontOf(next), size = num(String(next.size).replace("px", ""), 16), { codes, lost } = encodeText(raw);
    sheet.lost += lost;
    const width = (codes.reduce((s, c) => s + glyphWidth(font, c), 0) * size) / 1000;
    const x = num(a.x) - (next.anchor === "middle" ? width / 2 : next.anchor === "end" ? width : 0), y = num(a.y);
    const str = codes.map((c) => (c === 40 || c === 41 || c === 92 ? "\\" + String.fromCharCode(c) : c < 32 || c > 126 ? "\\" + c.toString(8).padStart(3, "0") : String.fromCharCode(c))).join("");
    paintState(sheet, { ...next, stroke: "none" }, total, body, true);
    body.push("BT", "/" + sheet.font(font) + " " + fmt(size) + " Tf", "1 0 0 -1 " + fmt(x) + " " + fmt(y) + " Tm", "(" + str + ") Tj", "ET");
  } else {
    let ops;
    if (tag === "rect") ops = rectOps(num(a.x), num(a.y), num(a.width), num(a.height), num(a.rx, num(a.ry)), num(a.ry, num(a.rx)));
    else if (tag === "circle") ops = ellipseOps(num(a.cx), num(a.cy), num(a.r), num(a.r));
    else if (tag === "ellipse") ops = ellipseOps(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
    else if (tag === "line") ops = [["M", num(a.x1), num(a.y1)], ["L", num(a.x2), num(a.y2)]];
    else if (tag === "polyline" || tag === "polygon") {
      const v = String(a.points || "").split(/[\s,]+/).filter(Boolean).map(Number);
      ops = []; for (let i = 0; i + 1 < v.length; i += 2) ops.push([i ? "L" : "M", v[i], v[i + 1]]);
      if (tag === "polygon" && ops.length) ops.push(["Z"]);
    } else ops = pathOps(a.d);
    if (tag === "rect" && !(num(a.width) > 0 && num(a.height) > 0)) return;
    if (tag === "circle" && !(num(a.r) > 0)) return;
    if (!ops.length) return;
    const isLine = tag === "line" || tag === "polyline";
    const st = paintState(sheet, isLine ? { ...next, fill: "none" } : next, total, body, false);
    if (!st.doFill && !st.doStroke) return;
    body.push(opsToPdf(ops), st.doFill && st.doStroke ? (next.rule === "evenodd" ? "B*" : "B") : st.doFill ? (next.rule === "evenodd" ? "f*" : "f") : "S");
  }
  out.push("q"); if (hasT) out.push(local.map(fmt).join(" ") + " cm"); out.push(...body, "Q");
}

function collectPatterns(node, into) {
  if (node.text !== undefined) return;
  if (node.tag === "pattern" && node.attrs.id) {
    into[node.attrs.id] = { id: node.attrs.id, width: num(node.attrs.width, 0), height: num(node.attrs.height, 0), transform: parseTransform(node.attrs.patternTransform), node };
  }
  for (const k of node.kids) collectPatterns(k, into);
}

const defaults = { fill: "#000000", stroke: "none", sw: 1, fo: 1, so: 1, op: 1, family: "Arial, Helvetica, sans-serif", size: 16, weight: "normal", fstyle: "normal", anchor: "start", join: "miter", cap: "butt", dash: "", rule: "nonzero" };

export function renderSvg(svgText) {
  const tree = parseSvg(svgText);
  const root = tree.kids.find((k) => k.tag === "svg");
  if (!root) throw new Error("not an SVG document");
  const patterns = {}; collectPatterns(root, patterns);
  const vb = String(root.attrs.viewBox || "").split(/[\s,]+/).filter(Boolean).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const width = num(String(root.attrs.width || "").replace(/px$/, ""), hasVb ? vb[2] : 300), height = num(String(root.attrs.height || "").replace(/px$/, ""), hasVb ? vb[3] : 150);
  const sx = hasVb ? width / vb[2] : 1, sy = hasVb ? height / vb[3] : 1, px = 0.75;
  const base = [px * sx, 0, 0, -px * sy, hasVb ? -vb[0] * px * sx : 0, height * px + (hasVb ? vb[1] * px * sy : 0)];
  const sheet = new Sheet(patterns);
  const out = ["q", base.map(fmt).join(" ") + " cm"];
  const rootAttrs = styleOf(root);
  const ctx = derive(defaults, rootAttrs);
  for (const kid of root.kids) drawNode(kid, ctx, base, sheet, out);
  out.push("Q");
  const titleNode = root.kids.find((k) => k.tag === "title");
  // tiling patterns: drawn in their own tile space, the page matrix is in the pattern dictionary
  const tiles = sheet.patterns.map((p) => {
    const inner = new Sheet({}); const body = [];
    for (const kid of p.def.node.kids) drawNode(kid, derive(defaults, {}), [1, 0, 0, 1, 0, 0], inner, body);
    sheet.lost += inner.lost; for (const u of inner.unsupported) sheet.unsupported.add(u);
    const fonts = [...inner.fonts];
    return { ...p, content: body.join("\n"), fonts: fonts.length ? fonts : [], gstates: [...inner.gstates.values()] };
  });
  return { width: width * px, height: height * px, content: out.join("\n"), fonts: sheet.fonts, gstates: [...sheet.gstates.values()], tiles, lost: sheet.lost, unsupported: [...sheet.unsupported], title: titleNode ? titleNode.kids.map((k) => k.text || "").join("").trim() : "" };
}

const enc = new TextEncoder();
async function deflate(bytes) {
  if (typeof CompressionStream === "undefined" || typeof Response === "undefined" || typeof Blob === "undefined") return null;
  try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()); } catch { return null; }
}
const hexTitle = (s) => "<FEFF" + [...s].map((c) => c.codePointAt(0).toString(16).padStart(4, "0")).join("") + ">";

/** Convert one SVG figure to a one-page PDF. Resolves to { bytes, lost, unsupported, width, height } (page size in points, one SVG pixel = 0.75 pt). */
export async function convertSvg(svgText, { compress = true } = {}) {
  const doc = renderSvg(svgText);
  const objects = []; // each: { head: string, body?: Uint8Array }
  const reserve = () => objects.push(null);
  const add = (head, body) => { objects.push({ head, body }); return objects.length; };
  const stream = async (dict, text) => {
    let bytes = enc.encode(text), filter = "";
    if (compress) { const z = await deflate(bytes); if (z && z.length < bytes.length) { bytes = z; filter = " /Filter /FlateDecode"; } }
    return add(dict + filter + " /Length " + bytes.length, bytes);
  };
  reserve(); reserve(); reserve(); // 1 catalog, 2 pages, 3 page
  const contentId = await stream("<<", doc.content);
  const infoId = add("<< /Producer (Assured QC)" + (doc.title ? " /Title " + hexTitle(doc.title) : "") + " >>");
  const fontRefs = [];
  for (const [name, key] of doc.fonts) {
    const id = add("<< /Type /Font /Subtype /Type1 /BaseFont /" + name + " /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [" + MINUS_CODE + " /minus] >> >>");
    fontRefs.push("/" + key + " " + id + " 0 R");
  }
  const patRefs = [];
  for (const t of doc.tiles) {
    const res = "<< " + (t.fonts.length ? "/Font << " + (await Promise.all(t.fonts.map(async ([name, key]) => "/" + key + " " + add("<< /Type /Font /Subtype /Type1 /BaseFont /" + name + " /Encoding /WinAnsiEncoding >>") + " 0 R"))).join(" ") + " >> " : "") + ">>";
    const id = await stream("<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 " + fmt(t.def.width) + " " + fmt(t.def.height) + "] /XStep " + fmt(t.def.width) + " /YStep " + fmt(t.def.height) + " /Matrix [" + t.matrix.map(fmt).join(" ") + "] /Resources " + res, t.content);
    patRefs.push("/" + t.name + " " + id + " 0 R");
  }
  const gs = doc.gstates.map((g) => "/" + g.name + " << /Type /ExtGState /ca " + fmt(g.fo) + " /CA " + fmt(g.so) + " >>");
  const resources = "<< " + (fontRefs.length ? "/Font << " + fontRefs.join(" ") + " >> " : "") + (gs.length ? "/ExtGState << " + gs.join(" ") + " >> " : "") + (patRefs.length ? "/Pattern << " + patRefs.join(" ") + " >> " : "") + ">>";
  objects[0] = { head: "<< /Type /Catalog /Pages 2 0 R >>" };
  objects[1] = { head: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" };
  objects[2] = { head: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + fmt(doc.width) + " " + fmt(doc.height) + "] /Resources " + resources + " /Contents " + contentId + " 0 R >>" };
  const parts = []; let offset = 0; const offsets = [];
  const push = (bytes) => { parts.push(bytes); offset += bytes.length; };
  push(enc.encode("%PDF-1.4\n")); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // second line: high bytes so transfer tools treat the file as binary
  objects.forEach((o, i) => {
    offsets.push(offset);
    if (o.body) { push(enc.encode((i + 1) + " 0 obj\n" + o.head + " >>\nstream\n")); push(o.body); push(enc.encode("\nendstream\nendobj\n")); }
    else push(enc.encode((i + 1) + " 0 obj\n" + o.head + "\nendobj\n"));
  });
  const xref = offset;
  push(enc.encode("xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n" + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R /Info " + infoId + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"));
  const bytes = new Uint8Array(offset); let at = 0; for (const p of parts) { bytes.set(p, at); at += p.length; }
  return { bytes, lost: doc.lost, unsupported: doc.unsupported, width: doc.width, height: doc.height };
}

export const svgToPdf = async (svgText, options) => (await convertSvg(svgText, options)).bytes;
