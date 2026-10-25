import { runWorkflowAgent } from "./workflowAgent.js";
self.onmessage = async ({ data }) => {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data)));
    const referenceDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.genbankRaw));
    const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
    const report = await runWorkflowAgent(data, { onProgress: progress => self.postMessage({ type: "progress", progress }) });
    self.postMessage({ type: "complete", report: { ...report, inputSha256: hex(digest), referenceSha256: hex(referenceDigest) } });
  } catch (error) { self.postMessage({ type: "error", error: error.message || String(error) }); }
};
