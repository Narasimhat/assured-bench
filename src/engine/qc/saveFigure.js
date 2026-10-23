// Browser-only helpers: save an SVG, rasterise it to a PNG at a given resolution (the SVGs of this app are 1 unit = 1 pixel at 96 dpi), or write it as a vector PDF.
import { svgToPdf } from "./svgPdf.js";
export const downloadBlob = (name, data, type) => {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const saveSvg = (name, svg) => downloadBlob(name, svg, "image/svg+xml");
export async function svgToPngBlob(svg, dpi = 300) {
  const scale = dpi / 96; const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  const canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
export async function savePng(name, svg, dpi = 300) { downloadBlob(name, await svgToPngBlob(svg, dpi), "image/png"); }
export async function savePdf(name, svg) {
  try { downloadBlob(name, await svgToPdf(svg), "application/pdf"); } catch (error) { if (typeof window !== "undefined" && window.alert) window.alert(`The PDF could not be written: ${error.message}. The SVG download is unaffected.`); else throw error; }
}
