// Bundled datasets must resolve beneath Studio, including on /studio/ deployments.
async function fetchAsset(path, base) {
  const url = `${base}${path.replace(/^\//, "")}`;
  let response;
  try { response = await fetch(url); }
  catch (cause) { throw new Error(`Could not download ${path}. Check your connection and retry.`, { cause }); }
  if (!response.ok) throw new Error(`Could not download ${path} (HTTP ${response.status}). Reload Studio and retry.`);
  return response;
}

export async function fetchTraceAsset(path, base = import.meta.env?.BASE_URL || "/") {
  const response = await fetchAsset(path, base);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 128 || String.fromCharCode(...bytes.slice(0, 4)) !== "ABIF") {
    throw new Error(`Downloaded ${path} is not a valid AB1 trace. Reload Studio and retry.`);
  }
  return buffer;
}

export async function fetchQcSpecAsset(path, base = import.meta.env?.BASE_URL || "/") {
  const response = await fetchAsset(path, base);
  return response.json();
}
