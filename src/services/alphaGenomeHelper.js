/**
 * Client for the local AlphaGenome helper (tools/alphagenome/helper.py, started with `rank.py --serve`).
 *
 * The page cannot call AlphaGenome itself: the service speaks gRPC to its own client and the API key must not
 * enter a browser. The helper runs on the user's computer, listens on 127.0.0.1, holds the key, runs the same
 * comparison as `rank.py --run`, and returns the report this page already knows how to validate and rank.
 *
 * What is sent: the candidate request (sequence windows around the edit, donor alleles, context ids), to the
 * address the user configured, with a session code the helper printed. Nothing is sent until the user clicks;
 * the page never probes the address on load, because a browser may ask the user for local-network permission.
 */
import { buildCandidateRankingRequest, rankCandidates, validateRankingReport } from "./candidateRanking.js";

export const HELPER_SCHEMA = "assured-alphagenome-helper/1";
export const HELPER_DEFAULT_URL = "http://127.0.0.1:18765";
export const HELPER_START_COMMAND = "python3 tools/alphagenome/rank.py --serve";
export const HELPER_HEALTH_TIMEOUT_MS = 8000;
export const HELPER_RANK_TIMEOUT_MS = 10 * 60 * 1000;
const URL_KEY = "assured.alphagenomeHelper.url";
const TOKEN_KEY = "assured.alphagenomeHelper.token";
// Only these two spellings: the deployed Content-Security-Policy (vercel.json, connect-src) lists exactly them, and CSP source expressions cannot match [::1].
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

export class HelperError extends Error {
  constructor(code, message, status = null) { super(message); this.name = "HelperError"; this.code = code; this.status = status; }
}

/** Origin of the helper. Plain http is accepted for loopback addresses only; anything else must be https. */
export function normalizeHelperUrl(input) {
  let text = String(input ?? "").trim();
  if (!text) throw new HelperError("bad-url", "Enter the helper address, for example http://127.0.0.1:18765.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  let url;
  try { url = new URL(text); } catch { throw new HelperError("bad-url", "That helper address is not a valid URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HelperError("bad-url", "The helper address must start with http:// or https://.");
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) throw new HelperError("bad-url", "Plain http is allowed only for 127.0.0.1 or localhost (not [::1]); use https for any other address.");
  if (url.username || url.password) throw new HelperError("bad-url", "Do not put credentials in the helper address; the session code goes in its own field.");
  return url.origin;
}
export const isLoopbackUrl = (origin) => LOOPBACK.has(new URL(origin).hostname);

const UNREACHABLE = (origin) => `The helper could not be reached at ${origin}. Start it on this computer with \`${HELPER_START_COMMAND}\` (from the assured-bench folder). `
  + "If it is running, the browser may be blocking this page's access to apps on your computer: Chrome asks for permission to connect to local network devices (allow it for this site, or enable 'Apps on device' in the site settings). "
  + "Safari may block a secure page from reaching http://127.0.0.1; use Chrome or Firefox, or run Bench locally.";

function requestInit(origin, init, timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  // Chrome's local-network-access check accepts the target address space on the request itself; browsers without it ignore the field.
  const full = { ...init, signal: controller.signal, cache: "no-store", credentials: "omit", ...(isLoopbackUrl(origin) ? { targetAddressSpace: "loopback" } : {}) };
  return { full, done: () => clearTimeout(timer), controller };
}

async function call(origin, path, init, { fetchFn, timeoutMs, signal }) {
  const { full, done, controller } = requestInit(origin, init, timeoutMs, signal);
  let response;
  try { response = await fetchFn(`${origin}${path}`, full); }
  catch (error) {
    done();
    if (controller.signal.aborted && String(controller.signal.reason?.message || "") === "timeout") throw new HelperError("timeout", `The helper did not answer within ${Math.round(timeoutMs / 1000)} s. A comparison may still be running; check its terminal, then try again.`);
    if (signal?.aborted) throw new HelperError("cancelled", "The request was cancelled.");
    throw new HelperError("unreachable", UNREACHABLE(origin));
  }
  done();
  let body = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  return { status: response.status, ok: response.ok, body };
}

const FAILURE_GUIDANCE = {
  "bad-token": "The session code is missing or wrong. Copy it from the terminal where the helper is running.",
  "bad-origin": "The helper refused this page. Start it with --origin <this page's address> to allow it.",
  "bad-host": "The helper refused the address used. Use http://127.0.0.1:<port> or http://localhost:<port>.",
  busy: "The helper is already running a comparison. Wait for it to finish, then try again.",
  "no-key": "The helper has no AlphaGenome key. Run tools/alphagenome/configure_key.py (or set ALPHAGENOME_API_KEY) on that computer, restart the helper, then try again.",
};
function failure(result) {
  const code = result.body?.code;
  if (!code && result.body == null) return new HelperError("wrong-service", "The address answered, but not like the AssuredBench helper. Check the address and port.", result.status);
  return new HelperError(code || "failed", FAILURE_GUIDANCE[code] || result.body?.error || `The helper returned status ${result.status}.`, result.status);
}

/** Ask the helper who it is. Never throws: { ok, health } or { ok: false, code, message }. */
export async function checkHelper(url, { fetchFn = globalThis.fetch, timeoutMs = HELPER_HEALTH_TIMEOUT_MS } = {}) {
  try {
    const origin = normalizeHelperUrl(url);
    const result = await call(origin, "/health", { method: "GET" }, { fetchFn, timeoutMs });
    if (!result.ok) throw failure(result);
    if (result.body?.schema !== HELPER_SCHEMA) throw new HelperError("wrong-service", "The address answered, but not like the AssuredBench helper (different version or program).", result.status);
    return { ok: true, health: result.body };
  } catch (error) {
    return error instanceof HelperError ? { ok: false, code: error.code, message: error.message } : { ok: false, code: "failed", message: "The helper check failed." };
  }
}

/** POST the candidate request; resolve with the helper's report (validated by the caller against the request). */
export async function runHelperRanking(request, { url, token, fetchFn = globalThis.fetch, timeoutMs = HELPER_RANK_TIMEOUT_MS, signal } = {}) {
  const origin = normalizeHelperUrl(url);
  if (!String(token || "").trim()) throw new HelperError("bad-token", "Enter the session code printed by the helper.");
  if (!request?.requestId) throw new HelperError("bad-request", "There is no request to send.");
  const result = await call(origin, "/rank", { method: "POST", headers: { "Content-Type": "application/json", "X-Assured-Token": String(token).trim() }, body: JSON.stringify(request) }, { fetchFn, timeoutMs, signal });
  if (!result.ok) throw failure(result);
  if (!result.body || typeof result.body !== "object") throw new HelperError("wrong-service", "The helper returned something that is not a report.", result.status);
  return result.body;
}

/**
 * The whole one-click path: build the request for the candidate set, have the helper run it, check the report against
 * the request it answers, and apply the fixed ranking rule. Returns { setup, report, ranking }.
 */
export async function runHelperComparison(project, candidateSet, { contexts, mapping, mappingConfirmed, url, token, fetchFn, timeoutMs, signal } = {}) {
  const setup = await buildCandidateRankingRequest(project, candidateSet, { contexts, mapping, mappingConfirmed });
  const report = await runHelperRanking(setup.request, { url, token, fetchFn, timeoutMs, signal });
  try { validateRankingReport(report, setup.request); }
  catch (error) { throw new HelperError("invalid-report", `The helper's report was refused: ${error.message}`); }
  return { setup, report, ranking: rankCandidates(candidateSet, { ...setup, report }) };
}

/** Address in localStorage; the session code only in sessionStorage (gone when the tab closes), never alongside the address. */
export function loadHelperSettings({ local, session } = {}) {
  const read = (store, key) => { try { return (store ?? null)?.getItem(key) ?? ""; } catch { return ""; } };
  const l = local ?? (typeof localStorage !== "undefined" ? localStorage : null);
  const s = session ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  return { url: read(l, URL_KEY) || HELPER_DEFAULT_URL, token: read(s, TOKEN_KEY) };
}
export function saveHelperSettings({ url, token }, { local, session } = {}) {
  const l = local ?? (typeof localStorage !== "undefined" ? localStorage : null);
  const s = session ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  try { if (url !== undefined) l?.setItem(URL_KEY, url); } catch { /* storage unavailable */ }
  try { if (token !== undefined) s?.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
}
