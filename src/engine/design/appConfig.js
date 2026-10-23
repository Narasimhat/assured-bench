// Static copy and configuration for the app shell.
//
// This replaces editionConfig.js. That module carried a second, parallel "community"
// configuration selected at build time by VITE_APP_EDITION, which no deployment ever set:
// the community Vercel project served the full app, so the only observable difference was
// a stale hardcoded footer date. It cost ~25 branch points in App.jsx, had no test
// coverage, and could not be tree-shaken, so the full build shipped every community string
// anyway. Its main practical effect was forcing reportHtml.js to keep a private design-type
// list. If a narrower public surface is ever wanted, do it as a runtime setting on one
// deployment rather than a build-time edition.
import { DESIGN_TYPES } from "./designTypes.js";

export const PROJECT_TYPES = DESIGN_TYPES;

export const SAMPLE_REQUEST_TEXT = [
  "PSEN1 N32R BIHi005-A",
  "ECSIT knockout BIHi005-A",
  "SCN5A internal SPOT after P155 BIHi005-A",
  "INS C-terminal SD40-2xHA BIHi005-A",
  "SORCS1 N-terminal N:EGFP-Linker BIHi005-A",
].join("\n");

export const APP_CONFIG = Object.freeze({
  appName: "ASSURED CRISPR Designer",
  browserTitle: "ASSURED CRISPR Designer",
  metaDescription: "ASSURED CRISPR Designer helps scientists generate CRISPR edit designs, review donor architecture, and export ordering-ready reports.",
  socialDescription: "Generate CRISPR edit designs and export ordering-ready reports from a hosted browser app.",
  heroHeadline: "Genome editing design, donor review, and ordering exports in one clean workspace.",
  heroDescription: "Built for knockouts, SNP knock-ins, internal in-frame tags, and terminal reporters. Start from a request, a GenBank file, or raw sequence, then move directly into a scientist-readable report and export package.",
  heroBadges: Object.freeze(["Knockout, SNP, internal, N-term, C-term", "Annotated donor and protein views", "Spreadsheet-ready exports"]),
  valueBlurb: "One place for guides, donor geometry, protein impact, QC checkpoints, and export files.",
  emptyFolderNotice: "No GenBank folder loaded yet. KO can still start from gene name alone, but sequence-backed designs benefit from a GenBank file or raw DNA.",
  designDetailsHint: "Capture the requested edit, reporter, or tag configuration for this row.",
  defaultTag: "dTAG-V5",
  batchTypeHelp: "pm, ko, it, ct, or nt",
});
