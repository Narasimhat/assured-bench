// Screens the final guide targets and primer sites against dbSNP (GRCh38) through NCBI E-utilities, which allow requests from a browser.
//
// What this is: a lookup of known population variants, with their frequencies, under the PAM, the spacer and the primers of a design. What it is not: a check of the cell
// line's own genotype. Variants private to a line, zygosity and copy number are never assessed here. Nothing is called "clean" unless the query ran and returned variants
// whose reference alleles agree with the record (that agreement also verifies the genomic orientation of the record). When a step cannot be done the result says "not assessed"
// and why.
//
// Policy: a variant is "common" at a minor-allele frequency of 1% or more, "uncommon" from 0.1%. A common variant in the spacer or PAM, or in the last 5 nt of a primer, flags the design.
import { parseGB } from "../engine/design/designEngine.js";

export const DBSNP_SOURCE = "NCBI dbSNP via E-utilities (GRCh38)";
export const COMMON_MAF = 0.01;
export const UNCOMMON_MAF = 0.001;
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const WINDOW_PAD = 30;
const FREQUENCY_STUDIES = ["ALFA", "TOPMED", "GnomAD_genomes", "GnomAD_exomes", "1000Genomes"];
const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A" };
const rc = (s) => [...String(s)].reverse().map((c) => COMPLEMENT[c] || "N").join("");

const chromosomeName = (token) => {
  const nc = String(token).match(/^NC_0*(\d+)\.\d+$/i);
  if (nc) { const n = Number(nc[1]); return n === 23 ? "X" : n === 24 ? "Y" : n === 12920 ? "MT" : String(n); }
  const chr = String(token).replace(/^chr/i, "");
  return /^(\d{1,2}|X|Y|MT)$/i.test(chr) ? chr.toUpperCase() : null;
};

/**
 * Where the record sits on GRCh38: { chromosome, start (1-based coordinate of the first base), orientations: [+1, -1] to try in order, basis }, or { reason }.
 * Only coordinates the record states are used; a RefSeqGene (NG_) record states none.
 */
export function genomicFrameOfRecord(genbankRaw) {
  const text = String(genbankRaw || "");
  const region = text.match(/(NC_\d+\.\d+):(\d+)\.\.(\d+)\s*\((GRCh3\d)[^)]*\)(?:,\s*(plus|minus) strand)?/i);
  if (region) {
    if (!/GRCh38/i.test(region[4])) return { reason: `the record is on ${region[4]}; dbSNP is queried on GRCh38` };
    const chromosome = chromosomeName(region[1]);
    return chromosome ? { chromosome, start: Number(region[2]), orientations: [/minus/i.test(region[5] || "") ? -1 : 1], basis: "region stated in the record definition" } : { reason: "unrecognised chromosome accession" };
  }
  const located = text.match(/Location:\s*chromosome:(GRCh\d+|[A-Za-z0-9_.]+):([A-Za-z0-9]+):(\d+):(\d+):(-?1)\b/i);
  if (located) {
    if (!/GRCh38/i.test(located[1])) return { reason: `the record is on ${located[1]}; dbSNP is queried on GRCh38` };
    const chromosome = chromosomeName(located[2]);
    return chromosome ? { chromosome, start: Number(located[3]), end: Number(located[4]), orientations: [located[5] === "-1" ? -1 : 1], basis: "location stated in the record" } : { reason: "unrecognised chromosome" };
  }
  const imported = text.match(/Imported from genome:\s*(GRCh\d+)[^L]*Location:\s*(chr[0-9XYM]+)\s+(\d+)-(\d+)/i);
  if (imported) {
    if (!/GRCh38/i.test(imported[1])) return { reason: `the record is on ${imported[1]}; dbSNP is queried on GRCh38` };
    const chromosome = chromosomeName(imported[2]);
    // the strand is not stated: both are tried and the one whose reference bases agree with dbSNP is used
    return chromosome ? { chromosome, start: Number(imported[3]), end: Number(imported[4]), orientations: [1, -1], basis: "location stated in the record (strand not stated, verified against dbSNP reference alleles)" } : { reason: "unrecognised chromosome" };
  }
  if (/RefSeqGene|\bNG_\d+/i.test(text)) return { reason: "a RefSeqGene (NG_) record carries no chromosome coordinates" };
  return { reason: "the record states no genomic coordinates" };
}

/** Index of an exact occurrence of `seq` (or its reverse complement) in the record: { index, orientation } or null. */
function locate(record, seq) {
  const s = String(seq || "").toUpperCase(); if (!s) return null;
  const f = record.indexOf(s); if (f >= 0) return { index: f, strand: "+" };
  const r = record.indexOf(rc(s)); if (r >= 0) return { index: r, strand: "-" };
  return null;
}

/** The sites to screen, as 0-based half-open record intervals: guide targets (spacer + PAM) and primer binding sites. */
export function screeningSites(designResult, record) {
  const sites = [];
  (designResult?.gs || []).forEach((guide, i) => {
    const spacer = String(guide.sp || guide.spacer || "").toUpperCase(); const pam = String(guide.pm || guide.pam || "").toUpperCase();
    const hit = locate(record, spacer + pam);
    sites.push(hit ? { kind: "guide", label: guide.n || `gRNA${i + 1}`, spacer, pam, strand: hit.strand, start: hit.index, end: hit.index + spacer.length + pam.length }
      : { kind: "guide", label: guide.n || `gRNA${i + 1}`, spacer, pam, missing: "target not found in the record (PAM context differs)" });
  });
  (designResult?.ps || []).forEach((primer, i) => {
    const seq = String(primer.s || primer.seq || "").toUpperCase(); const hit = locate(record, seq);
    sites.push(hit ? { kind: "primer", label: primer.n || `Primer${i + 1}`, sequence: seq, strand: hit.strand, start: hit.index, end: hit.index + seq.length }
      : { kind: "primer", label: primer.n || `Primer${i + 1}`, sequence: seq, missing: "primer sequence not found in the record" });
  });
  return sites;
}

/** Minor-allele frequency of a dbSNP summary: the first of the large studies that reports one, as min(f, 1 - f) of the listed allele. */
export function frequencyOf(doc) {
  const studies = (doc?.global_mafs || []).map((m) => { const hit = String(m.freq || "").match(/^([ACGTN-]+)=([0-9.]+)\/(\d+)/i); return hit ? { study: m.study, allele: hit[1], f: Number(hit[2]), n: Number(hit[3]) } : null; }).filter(Boolean);
  const pick = FREQUENCY_STUDIES.map((s) => studies.find((x) => x.study === s)).find(Boolean) || null;
  return pick ? { study: pick.study, allele: pick.allele, maf: Math.min(pick.f, 1 - pick.f), n: pick.n } : null;
}

/** The GRCh38 HGVS entries of a dbSNP summary (the docsum lists every assembly; the highest NC_ version of the chromosome is GRCh38): { start, end, kind, ref, alt } with 1-based inclusive positions. */
export function parseHgvs(doc) {
  const text = String(doc?.docsum || ""); const byAccession = new Map();
  for (const m of text.matchAll(/(NC_\d+)\.(\d+):g\.(\d+)(?:_(\d+))?(delins[ACGT]*|del[ACGT]*|dup[ACGT]*|ins[ACGT]*|[ACGT]>[ACGT])/g)) {
    const key = m[1]; const version = Number(m[2]); const start = Number(m[3]); const end = m[4] ? Number(m[4]) : start; const tail = m[5];
    const snv = tail.match(/^([ACGT])>([ACGT])$/);
    const entry = { start, end, kind: snv ? "snv" : tail.startsWith("delins") ? "delins" : tail.startsWith("del") ? "del" : tail.startsWith("dup") ? "dup" : "ins", ref: snv ? snv[1] : null, alt: snv ? snv[2] : null, text: tail };
    if (!byAccession.has(key) || byAccession.get(key).version < version) byAccession.set(key, { version, entries: [] });
    if (byAccession.get(key).version === version) byAccession.get(key).entries.push(entry);
  }
  const best = [...byAccession.values()].sort((a, b) => b.version - a.version)[0];
  return best ? best.entries : [];
}

const classOf = (maf) => (maf == null ? "unknown" : maf >= COMMON_MAF ? "common" : maf >= UNCOMMON_MAF ? "uncommon" : "rare");

/** Where a record index falls in a guide target or primer: a label and a rank of importance. */
function locationIn(site, index) {
  if (site.kind === "guide") {
    const off = site.strand === "+" ? index - site.start : site.end - 1 - index; // 0-based from the 5' end of spacer + PAM on the guide strand
    if (off >= site.spacer.length) { const p = off - site.spacer.length + 1; return { label: `PAM position ${p}${p > 1 ? " (G of NGG)" : ""}`, seedOrPam: true, pamCore: p > 1 }; }
    const pos = off + 1; // 1 = PAM-distal, 20 = PAM-adjacent
    return { label: `spacer position ${pos}${pos === site.spacer.length ? " (PAM-adjacent)" : ""}`, seedOrPam: pos > site.spacer.length - 10, pamCore: false };
  }
  const fromThreePrime = site.strand === "+" ? site.end - 1 - index : index - site.start; // 0 = the primer's 3' base
  return { label: fromThreePrime < 5 ? `primer 3' end (${fromThreePrime + 1} from the 3' base)` : `primer position ${site.strand === "+" ? index - site.start + 1 : site.end - index}`, threePrimeEnd: fromThreePrime < 5 };
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

async function getJson(fetchFn, url, delayMs, queries) {
  await sleep(delayMs); queries.push(url);
  const response = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(15000) });
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "error"}`);
  return response.json();
}

/**
 * The screen. Returns { ok: true, status: "flagged" | "none_found" | "partial" | "not_assessed", summary, source, retrievedAt, guideChecks, primerChecks, reason? }.
 * `fetchFn` is injectable; `delayMs` spaces the requests (NCBI allows 3 per second without a key).
 */
export async function screenTargetVariants({ gene, genbankRaw, designResult, fetchFn = globalThis.fetch, delayMs = 350, now = () => new Date() } = {}) {
  const base = { ok: true, gene: String(gene || designResult?.gene || "").toUpperCase(), source: DBSNP_SOURCE, retrievedAt: now().toISOString(), guideChecks: [], primerChecks: [], scope: "Known population variants only. Variants private to the cell line, zygosity and copy number are not assessed." };
  const notAssessed = (reason) => ({ ...base, status: "not_assessed", reason, summary: `Not assessed: ${reason}. ${base.scope}` });
  if (!designResult || designResult.err) return notAssessed("no design to screen");
  if (typeof fetchFn !== "function") return notAssessed("no network access from this environment");
  let record; try { record = String(parseGB(genbankRaw)?.seq || "").toUpperCase(); } catch { record = ""; }
  if (!record) return notAssessed("the reference record could not be read");
  const frame = genomicFrameOfRecord(genbankRaw); if (frame.reason) return notAssessed(frame.reason);
  const sites = screeningSites(designResult, record); const located = sites.filter((s) => !s.missing);
  if (!located.length) return notAssessed("no guide target or primer site could be located in the record");

  const queries = []; const docs = new Map(); const perSite = new Map(); let truncated = false;
  try {
    for (const site of located) {
      const lo = Math.max(0, site.start - WINDOW_PAD); const hi = site.end + WINDOW_PAD; // record indices; mapped to coordinates per orientation below
      site.window = { lo, hi };
    }
    // The orientation decides which genomic coordinates a record index has; resolve it with the first window, then verify on all variants returned.
    const attempt = async (orientation) => {
      const coordOf = (index) => (orientation === 1 ? frame.start + index : (frame.end != null ? frame.end - index : frame.start + record.length - 1 - index));
      const result = []; const ids = new Set(); const windowIds = new Map();
      for (const site of located) {
        const a = coordOf(site.window.lo); const b = coordOf(site.window.hi - 1); const from = Math.min(a, b); const to = Math.max(a, b);
        const term = `${frame.chromosome}[CHR] AND ${from}:${to}[CHRPOS]`;
        const search = await getJson(fetchFn, `${EUTILS}/esearch.fcgi?db=snp&term=${encodeURIComponent(term)}&retmode=json&retmax=500`, delayMs, queries);
        const list = search?.esearchresult?.idlist || []; if (Number(search?.esearchresult?.count) > list.length) truncated = true;
        windowIds.set(site, list); list.forEach((id) => ids.add(id));
      }
      const all = [...ids].filter((id) => !docs.has(id));
      for (let i = 0; i < all.length; i += 150) {
        const batch = all.slice(i, i + 150);
        const sum = await getJson(fetchFn, `${EUTILS}/esummary.fcgi?db=snp&id=${batch.join(",")}&retmode=json`, delayMs, queries);
        for (const id of batch) if (sum?.result?.[id]) docs.set(id, sum.result[id]);
      }
      // verify: every reference base dbSNP reports in these windows must equal the record's base in this orientation
      let agree = 0; let disagree = 0;
      const variants = [];
      for (const [site, list] of windowIds) for (const id of list) {
        const doc = docs.get(id); if (!doc) continue;
        for (const al of parseHgvs(doc)) {
          if (al.kind !== "snv") continue; // only single-base changes have a reference base to compare
          const index = orientation === 1 ? al.start - frame.start : (frame.end != null ? frame.end - al.start : frame.start + record.length - 1 - al.start);
          if (index < 0 || index >= record.length) continue;
          const recordBase = orientation === 1 ? record[index] : COMPLEMENT[record[index]];
          if (recordBase === al.ref) agree += 1; else disagree += 1;
        }
      }
      return { orientation, coordOf, windowIds, agree, disagree };
    };
    let chosen = null; let lastTried = null;
    for (const orientation of frame.orientations) {
      lastTried = await attempt(orientation);
      if (lastTried.agree >= 3 && lastTried.disagree === 0) { chosen = lastTried; break; }
    }
    if (!chosen) {
      const seen = (lastTried?.agree ?? 0) + (lastTried?.disagree ?? 0);
      return notAssessed(seen === 0 ? "dbSNP returned too few single-base variants in these windows to verify the genomic coordinates of the record"
        : `the reference bases dbSNP reports in these windows did not agree with the record (${lastTried.agree} agree, ${lastTried.disagree} differ), so the genomic coordinates could not be verified`);
    }

    const checkFor = (site) => {
      const list = chosen.windowIds.get(site) || []; const variants = [];
      for (const id of list) {
        const doc = docs.get(id); if (!doc) continue;
        const alleles = parseHgvs(doc); if (!alleles.length) continue;
        const indexOf = (position) => (chosen.orientation === 1 ? position - frame.start : (frame.end != null ? frame.end - position : frame.start + record.length - 1 - position));
        // every base the variant touches; an insertion touches the two bases it falls between
        const indexes = alleles.flatMap((a) => { const out = []; for (let position = a.start; position <= a.end; position += 1) out.push(indexOf(position)); return out; });
        const hit = indexes.find((index) => index >= site.start && index < site.end); if (hit === undefined) continue;
        const first = alleles[0];
        const freq = frequencyOf(doc);
        variants.push({ rsid: `rs${doc.snp_id || doc.uid || id}`, position: first.start, chromosome: frame.chromosome, class: classOf(freq?.maf), maf: freq ? Math.round(freq.maf * 1e6) / 1e6 : null, allele: freq?.allele || null, study: freq?.study || null,
          type: doc.snp_class || "", alleles: [...new Set(alleles.map((a) => (a.kind === "snv" ? `${a.ref}>${a.alt}` : a.text)))].join(", "), location: locationIn(site, hit) });
      }
      const seen = new Set(); return variants.filter((v) => (seen.has(v.rsid) ? false : (seen.add(v.rsid), true))).sort((a, b) => (b.maf ?? -1) - (a.maf ?? -1));
    };
    for (const site of sites) {
      if (site.missing) { (site.kind === "guide" ? base.guideChecks : base.primerChecks).push({ label: site.label, status: "not_assessed", reason: site.missing }); continue; }
      const variants = checkFor(site);
      const common = variants.filter((v) => v.class === "common" && (site.kind === "guide" || v.location.threePrimeEnd));
      const notable = variants.filter((v) => v.class === "uncommon" && (site.kind === "guide" ? v.location.seedOrPam : v.location.threePrimeEnd));
      const entry = { label: site.label, strand: site.strand, ...(site.kind === "guide" ? { spacer: site.spacer, pam: site.pam } : { sequence: site.sequence }), variants, status: common.length ? "flagged" : "none_found",
        note: common.length
          ? `${common.map((v) => `${v.rsid} at ${v.location.label}, ${v.allele || "alt"} ${(v.maf * 100).toFixed(1)}% (${v.study})`).join("; ")}. ${site.kind === "guide" ? "A mismatch there can reduce cutting; confirm the cell line's genotype." : "Allelic dropout is possible; confirm the primer site in the cell line."}`
          : `No variant with frequency of 1% or more${notable.length ? `; ${notable.length} uncommon variant(s) in the ${site.kind === "guide" ? "seed or PAM" : "3' end"} (0.1-1%)` : ""}.` };
      (site.kind === "guide" ? base.guideChecks : base.primerChecks).push(entry);
    }
  } catch (error) {
    return notAssessed(`the dbSNP query failed (${error?.message || error})`);
  }
  const all = [...base.guideChecks, ...base.primerChecks]; const flagged = all.filter((c) => c.status === "flagged"); const missing = all.filter((c) => c.status === "not_assessed");
  const status = flagged.length ? "flagged" : missing.length || truncated ? "partial" : "none_found";
  const summary = flagged.length
    ? `Common variant(s) overlap the design: ${flagged.map((c) => `${c.label}: ${c.note}`).join(" ")} ${base.scope}`
    : `No variant with a frequency of 1% or more was found in dbSNP (GRCh38, retrieved ${base.retrievedAt.slice(0, 10)}) at ${base.guideChecks.filter((c) => c.status !== "not_assessed").length} guide target(s) and ${base.primerChecks.filter((c) => c.status !== "not_assessed").length} primer site(s).${missing.length ? ` Not assessed: ${missing.map((c) => `${c.label} (${c.reason})`).join("; ")}.` : ""}${truncated ? " A window returned more variants than were retrieved." : ""} ${base.scope}`;
  return { ...base, status, summary, genomicFrame: { chromosome: frame.chromosome, start: frame.start, basis: frame.basis }, queries: queries.length };
}
