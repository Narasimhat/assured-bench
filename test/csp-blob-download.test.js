// Firefox applies frame-src to a download that an embedded page starts from a blob: URL (it treats the click as navigating the frame to the blob), so a page in an
// iframe cannot save a report or CSV when frame-src lists only 'self'. Chrome and Edge do not check this, so it only shows in Firefox. The Trace Analysis app runs in
// an iframe (src/components/qc/QcView.jsx, ./bench.html) and builds its downloads from blobs, so frame-src has to allow blob:.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const csp = Object.fromEntries(JSON.parse(read("vercel.json")).headers[0].headers
  .find((h) => h.key === "Content-Security-Policy").value.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));

test("frame-src allows the blob: URLs the embedded Trace Analysis app downloads from, and nothing else beyond itself", () => {
  assert.deepEqual(csp["frame-src"], ["'self'", "blob:"]);
});

test("allowing blob: frames does not open scripts, plugins or framing by other sites", () => {
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.ok(!csp["default-src"].includes("blob:"));
});

test("the Trace Analysis app is a same-origin iframe, so its downloads are governed by frame-src 'self' blob:", () => {
  const view = read("src", "components", "qc", "QcView.jsx");
  assert.match(view, /const source = "\.\/bench\.html"/);
  assert.match(view, /<iframe [^>]*src=\{source\}/);
  assert.ok(!/sandbox=/.test(view.slice(view.indexOf("<iframe"), view.indexOf("/>", view.indexOf("<iframe")))), "a sandbox without allow-downloads would block them in every browser");
});

test("the report, CSV and figure downloads of the Trace Analysis app use the shared helper that keeps the object URL for a minute", () => {
  for (const file of ["QuickStart.jsx", "saveFigure.js"]) {
    const source = read("src", "engine", "qc", file);
    assert.match(source, /import \{ downloadFile \} from "\.\.\/\.\.\/services\/downloadFile\.js"/, file);
    assert.ok(!/revokeObjectURL\(url\), (1000|2000)\)/.test(source), `${file}: a revoke after one or two seconds can cancel a download that waits for Firefox's save dialog`);
  }
});
