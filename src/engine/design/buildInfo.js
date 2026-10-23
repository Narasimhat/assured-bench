// Build provenance shown in the footer.
//
// The footer used to read a hardcoded string ("Hosted build - 31 Aug 2026") that nobody
// remembered to change, so it silently aged. A date cannot answer the question that
// actually matters when a report looks wrong: which code produced it. The commit SHA can.
//
// __BUILD_SHA__ / __BUILD_DATE__ are substituted at build time by vite.config.js. The
// typeof guards keep this module loadable outside a Vite build (dev tooling, node).
const sha = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";
const builtAt = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "";

export const BUILD_SHA = sha;
export const BUILD_SHORT_SHA = sha ? sha.slice(0, 7) : "";
export const BUILD_DATE = builtAt;

/** e.g. "Hosted build 418aabc - 1 Sep 2026", or a plain label when built outside git. */
export function formatBuildLabel() {
  const parts = ["Hosted build"];
  if (BUILD_SHORT_SHA) parts.push(BUILD_SHORT_SHA);
  const stamp = BUILD_DATE
    ? new Date(BUILD_DATE).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";
  return stamp ? `${parts.join(" ")} \u2022 ${stamp}` : parts.join(" ");
}
