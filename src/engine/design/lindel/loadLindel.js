// Loads the Lindel weights (src/lindel/lindel-weights.bin, 6.5 MB) once, in the browser or in Node.
//
// The file is a build asset, not part of the main bundle: nothing imports this module until a knockout design asks for outcome-based ranking, and the
// browser fetches the file only then. `new URL(..., import.meta.url)` is resolved by Vite to the hashed asset URL (and to a file: URL under Node).
import { parseLindelWeights } from "./lindel.js";

export const LINDEL_WEIGHTS_URL = new URL("./lindel-weights.bin", import.meta.url);

let loading = null;

/** Resolves to the parsed model. A failed load is not cached, so a later call retries. */
export function loadLindel(options = {}) {
  if (options.reload) loading = null;
  if (!loading) {
    loading = (async () => {
      const url = options.url || LINDEL_WEIGHTS_URL;
      if (url.protocol === "file:") {
        const nodeFs = "node:fs/promises"; const nodeUrl = "node:url"; // variable specifiers keep Node's modules out of the browser bundle on purpose
        const { readFile } = await import(/* @vite-ignore */ nodeFs);
        const { fileURLToPath } = await import(/* @vite-ignore */ nodeUrl);
        return parseLindelWeights(await readFile(fileURLToPath(url)));
      }
      const response = await (options.fetchImpl || fetch)(url.href || String(url));
      if (!response.ok) throw new Error(`Lindel weights could not be loaded (HTTP ${response.status}).`);
      return parseLindelWeights(await response.arrayBuffer());
    })().catch((error) => { loading = null; throw error; });
  }
  return loading;
}
