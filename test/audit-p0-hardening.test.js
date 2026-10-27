import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unacceptedAdvisories, ACCEPTED } from "../scripts/check_audit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const csp = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")).headers[0].headers
  .find((h) => h.key === "Content-Security-Policy").value.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));

test("CSP: scripts only from the app's own files, no eval, no plugins, no base-tag or form hijack, framing only by itself", () => {
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]); assert.deepEqual(csp["base-uri"], ["'self'"]); assert.deepEqual(csp["frame-ancestors"], ["'self'"]);
  assert.deepEqual(csp["default-src"], ["'self'"]);
  // Plain http appears only in connect-src, only for this computer (the optional local AlphaGenome helper, tools/alphagenome/rank.py --serve).
  const LOOPBACK_CONNECT = ["http://127.0.0.1:*", "http://localhost:*"];
  for (const [name, values] of Object.entries(csp)) {
    assert.ok(!values.includes("*"), name); assert.ok(!values.includes("'unsafe-eval'"), name); assert.ok(!values.includes("http:"), name);
    const plainHttp = values.filter((v) => v.startsWith("http://"));
    assert.deepEqual(plainHttp, name === "connect-src" ? LOOPBACK_CONNECT : [], `${name}: plain http`);
  }
  assert.ok(!csp["script-src"].includes("'unsafe-inline'"));
});

test("CSP matches what the app loads: stylesheet and fonts from Google Fonts, blob workers and downloads, https fetches (APIs and the trace-from-URL loader)", () => {
  assert.ok(csp["style-src"].includes("https://fonts.googleapis.com") && csp["font-src"].includes("https://fonts.gstatic.com"));
  assert.ok(csp["worker-src"].includes("blob:") && csp["img-src"].includes("blob:") && csp["img-src"].includes("data:"));
  // the trace loader (src/engine/qc/QuickStart.jsx) fetches any https URL the user pastes, so connect-src cannot list origins; plain http is not allowed
  assert.ok(csp["connect-src"].includes("https:") && csp["connect-src"].includes("'self'"));
  // every external origin the source fetches is https
  const origins = new Set();
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(f.name)) for (const m of fs.readFileSync(p, "utf8").matchAll(/["'`](http:\/\/[^"'`$ ]+)/g)) origins.add(`${p}: ${m[1]}`); } };
  walk(path.join(ROOT, "src"));
  // the only plain-http origins the app may request are this computer's, for the local AlphaGenome helper (connect-src lists exactly those)
  const insecure = [...origins].filter((o) => !/w3\.org|openxmlformats/.test(o) && !/: http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o));
  assert.deepEqual(insecure, [], "an http:// origin in the source would be blocked by the policy");
});

test("the HTML entry points carry no inline script and no inline event handler (the policy would block them)", () => {
  for (const file of ["index.html", "bench.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(![...html.matchAll(/<script\b([^>]*)>/gi)].some((m) => !/\bsrc=/.test(m[1])), `${file}: inline <script>`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${file}: inline event handler`);
  }
});

test("audit gate: only the two xlsx advisories are accepted; any other high advisory fails", () => {
  assert.deepEqual(Object.keys(ACCEPTED).sort(), ["GHSA-4r6h-8v6p-xvw6", "GHSA-5pgg-2g8v-p4x9"]);
  const via = (id, severity = "high") => ({ source: 1, name: "pkg", title: "t", url: `https://github.com/advisories/${id}`, severity });
  assert.deepEqual(unacceptedAdvisories({ vulnerabilities: { xlsx: { severity: "high", via: [via("GHSA-4r6h-8v6p-xvw6"), via("GHSA-5pgg-2g8v-p4x9")] } } }), []);
  const bad = unacceptedAdvisories({ vulnerabilities: { xlsx: { severity: "high", via: [via("GHSA-4r6h-8v6p-xvw6")] }, evil: { severity: "critical", via: [via("GHSA-xxxx-yyyy-zzzz", "critical")] }, lowpkg: { severity: "low", via: [via("GHSA-aaaa-bbbb-cccc", "low")] } } });
  assert.deepEqual(bad.map((b) => b.id), ["GHSA-xxxx-yyyy-zzzz"]);
  assert.deepEqual(unacceptedAdvisories({ vulnerabilities: { viaOnly: { severity: "high", via: ["xlsx"] } } }), [], "a vulnerability reported only through another package has its own entry");
});

test("CI workflow runs the tests, the build and the audit gate", () => {
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  for (const needle of ["npm ci", "npm test", "npm run build", "scripts/check_audit.mjs", "node-version: 22"]) assert.ok(ci.includes(needle), needle);
});
