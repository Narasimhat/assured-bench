import { useEffect, useRef, useState } from "react";
import { describeMapping, resolveReferenceMapping } from "../../services/referenceMapping.js";

/**
 * Looks up where the uploaded reference sits in GRCh38 (src/services/referenceMapping.js) for the two panels that need a mapping.
 * It starts by itself when `enabled` (the record does not state its location), cancels when the reference changes, ignores an answer that
 * arrives after that, and hands a successful result to `apply(result, overwrite)`; the caller decides what to do with fields the user typed.
 * `start({ overwrite })` runs it on demand.
 */
export function useMappingLookup({ enabled, gene, sequence, editIndex, orientations = [1], resetKey, fetchImpl, initial = null, apply }) {
  const [lookup, setLookup] = useState(initial || { status: "idle" }); // idle | running | ok | failed
  const run = useRef(0);
  const latest = useRef({});
  latest.current = { gene, sequence, editIndex, orientations, fetchImpl, apply };

  const start = async ({ overwrite }) => {
    const id = ++run.current;
    const c = latest.current;
    setLookup({ status: "running" });
    let out;
    try { out = await resolveReferenceMapping({ gene: c.gene, sequence: c.sequence, editIndex: c.editIndex, orientations: c.orientations, fetchImpl: c.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : undefined) }); }
    catch { out = { ok: false, message: "The lookup failed unexpectedly; enter the position by hand." }; }
    if (id !== run.current) return; // another reference or another click took over
    setLookup(out.ok ? { status: "ok", result: out } : { status: "failed", message: out.message });
    if (out.ok) latest.current.apply?.(out, overwrite);
  };

  const mounted = useRef(false);
  useEffect(() => { if (mounted.current) setLookup({ status: "idle" }); mounted.current = true; }, [resetKey]);
  useEffect(() => { if (enabled) start({ overwrite: false }); return () => { run.current += 1; }; }, [resetKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { lookup, start };
}

/**
 * The line under the mapping fields: what is missing, or what Ensembl returned. The Ensembl sentence is shown only while the fields still hold what
 * Ensembl returned (`fromLookup`); a value the user edited is theirs, and the page does not claim otherwise.
 */
export function mappingNote({ missing, detected, lookup, geneSymbol, ready, fromLookup, before = "Before running", readySuffix = "Mapping ready: the helper checks it against GRCh38 before predicting and refuses a mismatch." }) {
  if (lookup.status === "running") return `Looking up where ${geneSymbol} sits in GRCh38 (Ensembl) and placing your sequence there\u2026`;
  const found = fromLookup ? describeMapping(lookup.result) : "";
  const unread = detected || fromLookup ? "" : lookup.status === "failed" ? `Bench could not place this reference automatically: ${lookup.message} ` : "Bench could not read where this reference sits in GRCh38. ";
  if (ready) return `${found ? `${found.replace(" Check the numbers, then tick the box.", "")} ` : ""}${readySuffix}`.trim();
  return `${found ? `${found} ` : ""}${unread}${missing.length ? `${before}: ${missing.join("; ")}.` : ""}`.trim();
}
