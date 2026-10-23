// Sample sheet and automatic pairing. A sheet (CSV) says which trace belongs to which control, with which guides and donor; with no sheet the
// files are paired by their names (the same run code, a control-looking name in the group, forward/reverse suffixes). Pairings come with a
// confidence and a reason, and anything that cannot be paired is listed instead of guessed.

const ALIASES = {
  sample: ["sample", "name", "id", "clone"], edited: ["edited", "file", "ab1", "forward", "fwd", "read", "edited_fwd", "trace"], edited_rev: ["edited_rev", "reverse", "rev", "edited_reverse", "reverse_read"],
  control: ["control", "ctrl", "wt", "control_fwd", "wildtype", "parental"], control_rev: ["control_rev", "control_reverse", "ctrl_rev"], guides: ["guides", "guide", "grna", "grnas", "spacer", "spacers"],
  donor: ["donor", "ssodn", "template"], type: ["type", "sample_type", "kind"], workflow: ["workflow", "experiment", "edit"], design: ["design", "design_file"], nuclease: ["nuclease", "cas"], group: ["group", "plate", "project", "locus"],
};
const canonical = (header) => { const h = String(header).trim().toLowerCase().replace(/[\s\-]+/g, "_"); for (const [key, names] of Object.entries(ALIASES)) if (names.includes(h)) return key; return h; };

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false; const input = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = (input.split(/\r?\n/, 1)[0].match(/\t/g) || []).length > (input.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? "\t" : ",";
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) { if (c === '"') { if (input[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += c; continue; }
    if (c === '"') quoted = true; else if (c === delimiter) { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const stripExt = (name) => String(name).replace(/^.*[\\/]/, "").replace(/\.(ab1|abi|abif|scf)$/i, "");
const keyOf = (name) => stripExt(name).toLowerCase();

/** Parse a sample sheet into rows; every row names its files by file name (extension optional). */
export function parseSampleSheet(text) {
  const table = parseCsv(text); if (table.length < 2) return { rows: [], errors: ["The sample sheet needs a header row and at least one sample."] };
  const header = table[0].map(canonical); const errors = [];
  if (!header.includes("edited")) errors.push("The sample sheet needs an 'edited' column (the trace file of each sample).");
  const rows = table.slice(1).map((cells, index) => {
    const r = { line: index + 2 }; header.forEach((h, i) => { r[h] = (cells[i] ?? "").trim(); });
    r.guides = String(r.guides || "").split(/[,;\s]+/).filter(Boolean); r.donor = String(r.donor || "").replace(/\s+/g, "");
    r.type = /pool|bulk/i.test(r.type || "") ? "pool" : "clone";
    return r;
  });
  return { rows, errors };
}

/** Match the names in a sheet to the uploaded files (case-insensitive, extension optional, unique prefix as a last resort). */
export function resolveSheet(rows, fileNames) {
  const files = fileNames.map((name) => ({ name, key: keyOf(name) })); const byKey = new Map(files.map((f) => [f.key, f.name]));
  const problems = []; const find = (value, line, what) => {
    if (!value) return null; const k = keyOf(value);
    if (byKey.has(k)) return byKey.get(k);
    const near = files.filter((f) => f.key.startsWith(k)); if (near.length === 1) return near[0].name;
    problems.push(`Line ${line}: ${what} "${value}" ${near.length > 1 ? `matches ${near.length} files` : "was not found among the uploaded files"}.`); return null;
  };
  const jobs = rows.map((r) => {
    const edited = find(r.edited, r.line, "trace"); const control = find(r.control, r.line, "control"); const editedRev = find(r.edited_rev, r.line, "reverse trace"); const controlRev = find(r.control_rev, r.line, "reverse control");
    return { sample: r.sample || stripExt(r.edited || ""), edited: [edited, editedRev].filter(Boolean), control: [control, controlRev].filter(Boolean), guides: r.guides, donor: r.donor, type: r.type, workflow: r.workflow || "", design: r.design || "", nuclease: r.nuclease || "", group: r.group || "", ok: Boolean(edited && (control || r.control === "")), line: r.line };
  });
  return { jobs, problems };
}

const CONTROL_WORDS = new Set(["wt", "wildtype", "ctrl", "control", "ctl", "utf", "untransfected", "untreated", "parental", "neg", "nt", "ntc", "unedited", "c"]);
const POOL_WORDS = new Set(["pool", "bulk", "tra", "transfected", "population", "mix"]);
const tokens = (name) => stripExt(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export const looksLikeControl = (name) => tokens(name).some((t) => CONTROL_WORDS.has(t) || /^(wt|ctrl|control)\d*$/.test(t)) || /[-_.]c$/i.test(stripExt(name).replace(/\.\d+$/, ""));
export const looksLikePool = (name) => tokens(name).some((t) => POOL_WORDS.has(t));
const runCode = (name) => { const m = stripExt(name).match(/\.(\d{2,4})$/) || stripExt(name).match(/[_-](\d{3,4})$/); return m ? m[1] : ""; };
const DIRECTION = /^(.*?)[_.\-](f|r|fwd|rev|fw|rv|forward|reverse)(?=([_.\-]?\d+)?$)/i;
export function directionOf(name) { const m = stripExt(name).match(DIRECTION); if (!m) return { stem: stripExt(name), direction: null }; return { stem: m[1] + (m[3] || ""), direction: /^f/i.test(m[2]) ? "F" : "R" }; }
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i += 1; return i; };

/**
 * Pair files without a sheet. Files sharing a run code form a group; the control-looking file of the group is the control of the others.
 * Forward/reverse reads of the same stem are kept together.
 */
export function autoPair(fileNames) {
  const names = [...new Set(fileNames)]; const groups = new Map();
  names.forEach((name) => { const code = runCode(name) || "_"; if (!groups.has(code)) groups.set(code, []); groups.get(code).push(name); });
  const pairs = []; const unpaired = []; const problems = [];
  for (const [code, members] of groups) {
    const info = members.map((name) => ({ name, ...directionOf(name), control: looksLikeControl(name), pool: looksLikePool(name) }));
    const controls = info.filter((x) => x.control); const samples = info.filter((x) => !x.control);
    if (!controls.length) { samples.forEach((s) => unpaired.push({ name: s.name, reason: `no control-looking file (wt, ctrl, control, utf, -C) among the files with run code ${code}` })); continue; }
    const controlStems = new Map(); controls.forEach((c) => { if (!controlStems.has(c.stem)) controlStems.set(c.stem, {}); controlStems.get(c.stem)[c.direction || "F"] = c.name; });
    const stemList = [...controlStems.keys()];
    const stems = new Map(); samples.forEach((s) => { if (!stems.has(s.stem)) stems.set(s.stem, { pool: s.pool, files: {} }); const slot = stems.get(s.stem); slot.pool = slot.pool || s.pool; slot.files[s.direction || "F"] = s.name; });
    for (const [stem, slot] of stems) {
      const ranked = stemList.map((c) => ({ c, score: commonPrefix(c.toLowerCase(), stem.toLowerCase()) })).sort((x, y) => y.score - x.score);
      const chosen = ranked[0]; const tie = ranked.length > 1 && ranked[1].score === chosen.score && stemList.length > 1;
      const confidence = stemList.length === 1 ? "high" : tie ? "low" : "medium";
      const ctl = controlStems.get(chosen.c);
      pairs.push({ sample: stem, edited: [slot.files.F, slot.files.R].filter(Boolean), control: [ctl.F || ctl.R, ctl.F && ctl.R ? ctl.R : null].filter(Boolean), type: slot.pool ? "pool" : "clone", confidence, reason: stemList.length === 1 ? `the only control with run code ${code}` : tie ? `${stemList.length} controls share run code ${code} equally well; check this pairing` : `closest name among ${stemList.length} controls with run code ${code}` });
      if (tie) problems.push(`${stem}: ambiguous control (${stemList.join(", ")})`);
    }
  }
  // Fallback for what is left: a file named like the parental line (its name is the beginning of the sample names) is the control.
  const used = new Set(pairs.flatMap((p) => p.edited)); const stemOf = (name) => stripExt(name).replace(/\.\d+$/, "").toLowerCase();
  const stillUnpaired = []; const reassigned = [];
  unpaired.forEach((u) => {
    const mine = stemOf(u.name);
    const candidates = names.filter((n) => n !== u.name && !used.has(n) && stemOf(n).length >= 6 && mine.startsWith(stemOf(n)) && stemOf(n) !== mine);
    const best = candidates.length ? candidates.reduce((a, b) => (stemOf(b).length > stemOf(a).length ? b : a)) : null;
    if (best && candidates.filter((c) => stemOf(c) === stemOf(best)).length === 1) reassigned.push({ sample: u.name, control: best }); else stillUnpaired.push(u);
  });
  reassigned.forEach((r) => pairs.push({ sample: stripExt(r.sample), edited: [r.sample], control: [r.control], type: looksLikePool(r.sample) ? "pool" : "clone", confidence: "low", reason: `"${stripExt(r.control)}" looks like the parental line: its name begins the sample name` }));
  return { pairs, unpaired: stillUnpaired, problems };
}
