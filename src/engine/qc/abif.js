// ABIF (.ab1) reader: the four processed channels, base calls, peak locations and quality scores.
// Runs on a Uint8Array/ArrayBuffer in the browser or in node; no dependencies.

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 7: 4, 8: 8, 10: 8, 11: 4, 12: 8, 13: 1, 18: 1, 19: 1, 20: 8, 21: 4 };
const CHANNEL_TAGS = [9, 10, 11, 12];

function view(input) {
  if (input instanceof ArrayBuffer) return new DataView(input);
  return new DataView(input.buffer, input.byteOffset, input.byteLength);
}

function readEntries(dv) {
  if (dv.byteLength < 128) throw new Error("This file is too small to be an .ab1 trace.");
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "ABIF") throw new Error("This is not an ABIF (.ab1) file.");
  const count = dv.getInt32(18, false);
  const offset = dv.getInt32(26, false);
  if (count <= 0 || count > 10000 || offset <= 0 || offset + 28 * count > dv.byteLength) throw new Error("The .ab1 directory is damaged.");
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    const at = offset + 28 * i;
    const name = String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
    const number = dv.getInt32(at + 4, false);
    const type = dv.getUint16(at + 8, false);
    const elementSize = dv.getUint16(at + 10, false);
    const elements = dv.getInt32(at + 12, false);
    const dataSize = dv.getInt32(at + 16, false);
    const dataOffset = dataSize <= 4 ? at + 20 : dv.getInt32(at + 20, false);
    if (dataOffset < 0 || dataOffset + dataSize > dv.byteLength) throw new Error(`The .ab1 entry ${name}${number} points outside the file.`);
    entries.set(`${name}${number}`, { name, number, type, elementSize, elements, dataSize, dataOffset });
  }
  return entries;
}

function readShorts(dv, entry) {
  const out = new Int16Array(entry.elements);
  for (let i = 0; i < entry.elements; i += 1) out[i] = dv.getInt16(entry.dataOffset + 2 * i, false);
  return out;
}

function readText(dv, entry) {
  let text = "";
  for (let i = 0; i < entry.dataSize; i += 1) text += String.fromCharCode(dv.getUint8(entry.dataOffset + i));
  return text;
}

function readBytes(dv, entry) {
  const out = new Uint8Array(entry.dataSize);
  for (let i = 0; i < entry.dataSize; i += 1) out[i] = dv.getUint8(entry.dataOffset + i);
  return out;
}

export function parseAbif(input, name = "") {
  const dv = view(input);
  const entries = readEntries(dv);
  const need = (key) => { const entry = entries.get(key); if (!entry) throw new Error(`The trace has no ${key} record (not a processed Sanger trace?).`); return entry; };
  const order = readText(dv, need("FWO_1")).toUpperCase();
  if (!/^[ACGT]{4}$/.test(order) || new Set(order).size !== 4) throw new Error(`Unexpected channel order "${order}".`);
  const channels = {};
  CHANNEL_TAGS.forEach((tag, index) => { channels[order[index]] = readShorts(dv, need(`DATA${tag}`)); });
  const length = channels.A.length;
  if (!["C", "G", "T"].every((base) => channels[base].length === length)) throw new Error("The four channels differ in length.");
  const callsEntry = entries.get("PBAS2") || need("PBAS1");
  const locEntry = entries.get("PLOC2") || need("PLOC1");
  const qualEntry = entries.get("PCON2") || entries.get("PCON1");
  const calls = readText(dv, callsEntry).toUpperCase().replace(/[^ACGTN]/g, "N");
  const peakLocations = Array.from(readShorts(dv, locEntry), (value) => value);
  // PLOC is stored as signed 16-bit; positions beyond 32767 wrap, so restore them.
  for (let i = 0; i < peakLocations.length; i += 1) if (peakLocations[i] < 0) peakLocations[i] += 65536;
  const n = Math.min(calls.length, peakLocations.length);
  const quality = qualEntry ? readBytes(dv, qualEntry).slice(0, n) : new Uint8Array(n);
  return { name, order, channels, samples: length, calls: calls.slice(0, n), peakLocations: peakLocations.slice(0, n), quality, hasQuality: quality.some((value) => value > 0) };
}
