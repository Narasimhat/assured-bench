// Fail the build on a high or critical advisory in the shipped dependencies unless it is listed below with the reason it is accepted.
// Usage: npm audit --omit=dev --json > audit.json; node scripts/check_audit.mjs audit.json
import fs from "node:fs";

export const ACCEPTED = Object.freeze({
  "GHSA-4r6h-8v6p-xvw6": "xlsx 0.18.5, prototype pollution when reading a crafted workbook: no fixed version is published on npm (the maintainers distribute newer builds from their own CDN). Review: the app reads workbooks the user chooses on their own machine; replace the reader or vendor a patched build before accepting workbooks from other people.",
  "GHSA-5pgg-2g8v-p4x9": "xlsx 0.18.5, regular-expression denial of service on a crafted workbook: same status as above; the effect is a stalled browser tab.",
});

const BLOCKING = new Set(["high", "critical"]);

export function unacceptedAdvisories(auditJson) {
  const out = [];
  for (const [name, vuln] of Object.entries(auditJson?.vulnerabilities || {})) {
    if (!BLOCKING.has(vuln.severity)) continue;
    const direct = (vuln.via || []).filter((v) => typeof v === "object");
    if (!direct.length) continue; // reported through a dependency that carries its own entry
    for (const v of direct) {
      const id = String(v.url || "").split("/").pop();
      if (BLOCKING.has(v.severity) && !(id in ACCEPTED)) out.push({ package: name, id: id || v.title, severity: v.severity, title: v.title });
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("check_audit.mjs") && process.argv[2]) {
  const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const bad = unacceptedAdvisories(report);
  const accepted = Object.entries(report.vulnerabilities || {}).flatMap(([name, v]) => (v.via || []).filter((x) => typeof x === "object" && String(x.url || "").split("/").pop() in ACCEPTED).map((x) => `${name}: ${x.url}`));
  accepted.forEach((a) => console.log(`accepted advisory (see scripts/check_audit.mjs): ${a}`));
  if (bad.length) { bad.forEach((b) => console.error(`blocking advisory: ${b.package} ${b.id} (${b.severity}) ${b.title}`)); process.exit(1); }
  console.log("npm audit: no unaccepted high or critical advisory");
}
