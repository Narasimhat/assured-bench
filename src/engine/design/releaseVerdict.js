// The one release verdict a design gets, and the words used to state it.
//
// The downloaded HTML report has led with this since the report layer was extracted. The
// on-screen report never stated it at all: it rendered its own nine-row checklist that
// graded a hard blocker as "warn", so the screen a reviewer actually looks at was the one
// surface that would not say "BLOCKED". Two surfaces describing the same design in
// different words is the failure this module exists to prevent - they now read the same
// status, label, lead sentence and reason lists from here.
//
// Keep this free of React and of Vite-only globals so `node --test` can load it.
import { summarizeProcurementReadiness } from "./designEngine.js";

export const RELEASE_VERDICT_STYLES = Object.freeze({
  blocked: Object.freeze({
    label: "BLOCKED",
    fg: "#B42318",
    bg: "#FEF3F2",
    border: "#F04438",
    lead: "Do not order. Resolve every blocker below and regenerate the design.",
  }),
  review: Object.freeze({
    label: "REVIEW REQUIRED",
    fg: "#B45309",
    bg: "#FFFAEB",
    border: "#F79009",
    lead: "Computation succeeded, but external checks remain. Resolve the items below before ordering.",
  }),
  ready: Object.freeze({
    label: "READY",
    fg: "#027A48",
    bg: "#F6FEF9",
    border: "#12B76A",
    lead: "All configured release gates passed. The standing requirements below still apply.",
  }),
});

/**
 * The authoritative release state of a design, with everything needed to render it.
 *
 * `orderable` is the single question every ordering control should ask. Only "ready" is
 * orderable: "review" is not, which is the distinction an earlier version of the donor
 * badge missed by treating "not blocked" as a green light.
 */
export function getReleaseVerdict(result) {
  const readiness = result?.type === "genomic-snv"
    ? { status: result.blockers?.length ? "blocked" : "review", blockers: result.blockers, warnings: result.warnings }
    : summarizeProcurementReadiness(result);
  const status = RELEASE_VERDICT_STYLES[readiness.status] ? readiness.status : "review";
  const tone = RELEASE_VERDICT_STYLES[status];
  return {
    status,
    label: tone.label,
    lead: tone.lead,
    fg: tone.fg,
    bg: tone.bg,
    border: tone.border,
    orderable: status === "ready",
    blockers: readiness.blockers || [],
    warnings: readiness.warnings || [],
    standingRequirements: readiness.standingRequirements || [],
    guidePairs: readiness.guidePairs || [],
  };
}

/**
 * Release state for one donor, which is its guide+donor pair's state - not the design's.
 *
 * A design can be "review required" overall while one pair is sound and another is not.
 * Painting both donors with the design-level answer made a strongly blocked pair read the
 * same as a weak one, and it is why a whole design used to be condemned by an alternative
 * the report told you not to use.
 */
export function getDonorReleaseStatus(result, donorGuideName) {
  const verdict = getReleaseVerdict(result);
  // A design-wide blocker (wrong reference, failed protein assertion) sinks every pair.
  if (verdict.status === "blocked") return "blocked";
  const pair = verdict.guidePairs.find((entry) => entry.guideName === donorGuideName);
  if (!pair) return verdict.status;
  // Distinguished from "blocked": the design is not blocked, this one pair is refused.
  if (!pair.orderable) return "pair-blocked";
  if (pair.acknowledged) return "accepted";
  return verdict.status;
}

/** The reason lists, in the order both surfaces present them. */
export function getReleaseVerdictSections(verdict) {
  return [
    { title: "Blockers", items: verdict.blockers, color: "#B42318" },
    { title: "Review items", items: verdict.warnings, color: "#B45309" },
    { title: "Standing requirements", items: verdict.standingRequirements, color: "#475467" },
  ].filter((section) => section.items.length > 0);
}
