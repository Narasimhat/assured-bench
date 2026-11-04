import test from "node:test";
import assert from "node:assert/strict";
import { downloadFile } from "../src/services/downloadFile.js";

// A small stand-in for the page: records what the browser would see, in order.
function stubPage() {
  const log = []; const revoked = []; const body = [];
  const link = { style: {}, click() { log.push(["click", { attached: body.includes(link), href: link.href, name: link.download }]); }, remove() { body.splice(body.indexOf(link), 1); log.push(["remove"]); } };
  globalThis.document = { createElement: (tag) => { assert.equal(tag, "a"); return link; }, body: { appendChild: (el) => { body.push(el); log.push(["append"]); } } };
  const real = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, timeout: globalThis.setTimeout };
  const timers = [];
  URL.createObjectURL = () => "blob:stub/1"; URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  return { log, revoked, timers, restore() { URL.createObjectURL = real.create; URL.revokeObjectURL = real.revoke; globalThis.setTimeout = real.timeout; delete globalThis.document; } };
}

test("the link is in the page when it is clicked, and the object URL is not revoked until later", () => {
  const page = stubPage();
  try {
    downloadFile("<html></html>", "report.html", "text/html");
    assert.deepEqual(page.log.map((entry) => entry[0]), ["append", "click", "remove"]);
    assert.deepEqual(page.log[1][1], { attached: true, href: "blob:stub/1", name: "report.html" });
    assert.deepEqual(page.revoked, [], "nothing is revoked while the download starts");
    assert.equal(page.timers.length, 1);
    assert.ok(page.timers[0].ms >= 30000, "the URL is kept long enough for a large file");
    page.timers[0].fn();
    assert.deepEqual(page.revoked, ["blob:stub/1"]);
  } finally { page.restore(); }
});

test("a Blob is passed through and text is wrapped in one", () => {
  const page = stubPage(); const made = []; const create = URL.createObjectURL;
  URL.createObjectURL = (blob) => { made.push(blob); return "blob:stub/2"; };
  try {
    const blob = new Blob(["a,b"], { type: "text/csv" });
    downloadFile(blob, "a.csv");
    downloadFile("x,y", "b.csv", "text/csv");
    assert.equal(made[0], blob);
    assert.ok(made[1] instanceof Blob);
    assert.equal(made[1].type, "text/csv");
    assert.equal(made[1].size, 3);
  } finally { URL.createObjectURL = create; page.restore(); }
});
