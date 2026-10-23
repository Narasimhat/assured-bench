/**
 * Assured Studio - 96-Well Plate Mapping & Sanger Trace Quality Pre-Check
 * 
 * Extracts 96-well coordinates from sample filenames and performs instant
 * signal-to-noise and Phred quality checks before and during deconvolution.
 */

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COLS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * Extracts 96-well coordinate (e.g. "A01", "C08", "H12") from a file/sample name.
 * Falls back to 1-based sequential index if no well pattern is found.
 * 
 * @param {string} name - Filename or clone identifier
 * @param {number} fallbackIndex - 0-based index if no well ID can be parsed
 * @returns {{ row: string, col: number, wellId: string, isEstimated: boolean }}
 */
export function extractWellId(name, fallbackIndex = 0) {
  if (!name) {
    const rIdx = Math.min(7, Math.floor(fallbackIndex / 12));
    const cIdx = (fallbackIndex % 12) + 1;
    const row = ROWS[rIdx];
    const wellId = `${row}${String(cIdx).padStart(2, "0")}`;
    return { row, col: cIdx, wellId, isEstimated: true };
  }

  // Check for explicit well identifiers like A01, A1, H12, _B04_, -C11-
  const explicitMatch = name.match(/(?:^|[^A-Za-z0-9])([A-Ha-h])0?([1-9]|1[0-2])(?:[^A-Za-z0-9]|$)/);
  if (explicitMatch) {
    const row = explicitMatch[1].toUpperCase();
    const col = parseInt(explicitMatch[2], 10);
    const wellId = `${row}${String(col).padStart(2, "0")}`;
    return { row, col, wellId, isEstimated: false };
  }

  // Check for clone numbers like cl1, cl12, clone_24, R176C_14
  const cloneNumMatch = name.match(/(?:cl|clone)[_-]?(\d+)/i) || name.match(/_(\d+)_/);
  if (cloneNumMatch) {
    const num = parseInt(cloneNumMatch[1], 10);
    if (num >= 1 && num <= 96) {
      const rIdx = Math.floor((num - 1) / 12);
      const col = ((num - 1) % 12) + 1;
      const row = ROWS[rIdx] || "H";
      const wellId = `${row}${String(col).padStart(2, "0")}`;
      return { row, col, wellId, isEstimated: true };
    }
  }

  // Fallback to sequential index
  const rIdx = Math.min(7, Math.floor(fallbackIndex / 12));
  const col = (fallbackIndex % 12) + 1;
  const row = ROWS[rIdx];
  const wellId = `${row}${String(col).padStart(2, "0")}`;
  return { row, col, wellId, isEstimated: true };
}

/**
 * Pre-checks chromatogram trace quality (signal intensity, Phred quality, ambiguity).
 * 
 * @param {object} trace - Object returned by parseAbif()
 * @returns {{ maxSignal: number, meanQv: number, nRatio: number, status: "PASS"|"WARN"|"FAIL", reason: string }}
 */
export function precheckTraceQuality(trace) {
  if (!trace || !trace.channels) {
    return { maxSignal: 0, meanQv: 0, nRatio: 100, status: "FAIL", reason: "Missing trace data" };
  }

  // Compute maximum peak signal across all 4 fluorophore channels
  let maxSignal = 0;
  ["A", "C", "G", "T"].forEach(ch => {
    const raw = trace.channels[ch];
    if (raw && raw.length > 0) {
      for (let i = 0; i < raw.length; i += 10) { // step by 10 for rapid evaluation
        if (raw[i] > maxSignal) maxSignal = raw[i];
      }
    }
  });

  // Calculate Phred quality score average
  let meanQv = 0;
  if (trace.hasQuality && trace.quality && trace.quality.length > 0) {
    let sum = 0;
    for (let i = 0; i < trace.quality.length; i++) {
      sum += trace.quality[i];
    }
    meanQv = sum / trace.quality.length;
  } else {
    // If no Phred scores stored in ABIF, estimate baseline quality from signal strength
    meanQv = maxSignal > 800 ? 35 : maxSignal > 300 ? 25 : 15;
  }

  // Calculate basecall ambiguity (fraction of Ns)
  const calls = trace.calls || "";
  let nCount = 0;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i] === "N") nCount++;
  }
  const nRatio = calls.length > 0 ? (nCount / calls.length) * 100 : 0;

  // Determine quality flag
  let status = "PASS";
  let reason = "Optimal fluorescence and baseline quality";

  if (maxSignal < 150) {
    status = "FAIL";
    reason = `Flatline or negligible signal (${maxSignal} RFU < 150 RFU threshold)`;
  } else if (meanQv < 18) {
    status = "FAIL";
    reason = `Severely degraded trace (mean Phred QV ${Math.round(meanQv)} < 18)`;
  } else if (maxSignal < 350) {
    status = "WARN";
    reason = `Low fluorescent signal (${maxSignal} RFU)`;
  } else if (meanQv < 25) {
    status = "WARN";
    reason = `Marginal Phred quality (mean QV ${Math.round(meanQv)})`;
  } else if (nRatio > 15) {
    status = "WARN";
    reason = `High basecall ambiguity (${Math.round(nRatio)}% Ns)`;
  }

  return {
    maxSignal,
    meanQv: Math.round(meanQv),
    nRatio: Math.round(nRatio),
    status,
    reason
  };
}

/**
 * Builds a 96-well grid map merging trace files, quality metrics, and deconvolution decisions.
 * 
 * @param {Array} traces - Array of trace file objects { name, buffer, isControl, ... }
 * @param {Array} results - Array of deconvolution results from analyseSample() / decide()
 * @returns {Map<string, object>} Map of wellId -> wellData
 */
export function buildPlateMap(traces = [], results = []) {
  const plateMap = new Map();

  // Initialize empty 96 wells
  ROWS.forEach(row => {
    COLS.forEach(col => {
      const wellId = `${row}${String(col).padStart(2, "0")}`;
      plateMap.set(wellId, {
        wellId,
        row,
        col,
        isEmpty: true,
        trace: null,
        result: null,
        quality: null,
        decision: null
      });
    });
  });

  // Populate from traces
  traces.forEach((tr, idx) => {
    const { wellId } = extractWellId(tr.name, idx);
    const existing = plateMap.get(wellId) || { wellId, row: wellId[0], col: parseInt(wellId.slice(1), 10) };
    
    // Find matching deconvolution result if present
    const cleanName = tr.name.replace(/\.[^/.]+$/, "");
    const matchingRes = results.find(r => r.name === cleanName || r.fileName === tr.name);

    plateMap.set(wellId, {
      ...existing,
      isEmpty: false,
      trace: tr,
      isControl: tr.isControl,
      result: matchingRes || null,
      decision: matchingRes?.decision?.decision || (tr.isControl ? "control" : "pending")
    });
  });

  return plateMap;
}
