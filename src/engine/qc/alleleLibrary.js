// Expected-allele library: every sequence a clone or pool can plausibly carry at this locus, built from the
// design hand-off alone. Sequences are full reference-window length (indels change the length), so the
// analysis can compare any part of a read against them.
//
//   wt                       the reference
//   indel                    deletions and short insertions at each cut
//   deletion_between_cuts    loss of the stretch between two cuts (two or three guides)
//   edit / edit_partial      the donor's changes on the reference. The donor is a run of features in
//                            reference order (each blocking or intended base change, and the insert if there
//                            is one); homology-directed repair copies a contiguous run of them, so every
//                            contiguous run is an allele. The full run is the intended edit; the others
//                            are partial conversion tracts, for instance blocking changes copied but the
//                            SNP not.

const MAX_DELETION = 30;
const MAX_INSERTION = 2;
const MAX_UNKNOWN_INSERTION = 10;
const MAX_DONOR_INDEL = 8;
const MAX_FEATURES = 8;
const BASES = ["A", "C", "G", "T"];

function deletion(reference, cut, size, offset) {
  const start = cut - offset;
  return reference.slice(0, start) + reference.slice(start + size);
}

function insertions(reference, cut, size) {
  let combos = [""];
  for (let i = 0; i < size; i += 1) combos = combos.flatMap((prefix) => BASES.map((base) => prefix + base));
  return combos.map((bases) => ({ sequence: reference.slice(0, cut) + bases + reference.slice(cut), bases }));
}

function describeMarkers(markers) {
  return markers.map((marker) => `${marker.ref}${marker.pos}${marker.alt}`).join(", ");
}

function donorFeatures(spec, donor) {
  const reference = spec.reference.sequence.toUpperCase();
  const markers = (spec.markers || []).filter((marker) => marker.pos >= donor.refStart && marker.pos < donor.refEnd
    && (!donor.carriesMarkers || donor.carriesMarkers.includes(marker.pos)));
  const features = markers.map((marker) => ({ kind: "marker", pos: marker.pos, marker }));
  if ((donor.insertBp || 0) > 0 || (donor.replacedBp || 0) > 0) {
    const arm5 = Number.isInteger(donor.arm5) ? donor.arm5 : donor.insertStart - donor.refStart;
    const insert = donor.sequence.slice(arm5, arm5 + (donor.insertBp || 0));
    features.push({ kind: "insert", pos: donor.refStart + arm5, refEnd: donor.refStart + arm5 + (donor.replacedBp || 0), insert });
  }
  features.sort((a, b) => a.pos - b.pos);
  return { features, reference };
}

function applyFeatures(reference, features) {
  // Apply from the right so earlier coordinates stay valid.
  let sequence = reference;
  [...features].sort((a, b) => b.pos - a.pos).forEach((feature) => {
    if (feature.kind === "marker") sequence = sequence.slice(0, feature.pos) + feature.marker.alt + sequence.slice(feature.pos + 1);
    else sequence = sequence.slice(0, feature.pos) + feature.insert + sequence.slice(feature.refEnd);
  });
  return sequence;
}

export function buildExpectedAlleles(spec, options = {}) {
  const maxDeletion = options.maxDeletion ?? MAX_DELETION;
  const maxInsertion = options.maxInsertion ?? MAX_INSERTION;
  const maxUnknownInsertion = options.maxUnknownInsertion ?? MAX_UNKNOWN_INSERTION;
  const reference = spec.reference.sequence.toUpperCase();
  const alleles = [];
  const seen = new Map();
  const priority = { wt: 5, edit: 4, edit_partial: 3, edit_indel: 2.5, deletion_between_cuts: 2, indel: 1 };
  const add = (allele) => {
    const key = allele.sequence;
    if (!seen.has(key)) { seen.set(key, allele); alleles.push(allele); return allele; }
    // Identical sequences are one allele; the more specific description wins and the other is kept as an alias.
    const existing = seen.get(key);
    existing.aliases = [...(existing.aliases || []), allele.label];
    if (priority[allele.kind] > priority[existing.kind]) {
      existing.aliases.push(existing.label);
      Object.assign(existing, { ...allele, aliases: existing.aliases, id: existing.id });
    }
    return existing;
  };
  add({ id: "wt", kind: "wt", label: "Wild type", sequence: reference, size: 0 });

  (spec.guides || []).forEach((guide, index) => {
    const tag = `g${index + 1}`;
    for (let size = 1; size <= maxDeletion; size += 1) {
      for (let offset = 0; offset <= size; offset += 1) {
        const start = guide.cut - offset;
        if (start < 0 || start + size > reference.length) continue;
        add({ id: `${tag}:del${size}@${start}`, kind: "indel", label: `${guide.name}: -${size}`, sequence: deletion(reference, guide.cut, size, offset), size: -size, guide: index + 1, cut: guide.cut });
      }
    }
    for (let size = 1; size <= maxInsertion; size += 1) {
      insertions(reference, guide.cut, size).forEach(({ sequence, bases }) => add({ id: `${tag}:ins${bases}`, kind: "indel", label: `${guide.name}: +${size} (${bases})`, sequence, size, guide: index + 1, cut: guide.cut }));
    }
    // Longer insertions: the inserted bases are unknown (4^n sequences cannot be listed), so the allele is the reference with a run
    // of N at the cut. The downstream shift is still modelled exactly; at the inserted positions every base is equally likely.
    for (let size = maxInsertion + 1; size <= maxUnknownInsertion; size += 1) {
      add({ id: `${tag}:insN${size}`, kind: "indel", label: `${guide.name}: +${size} (unknown bases)`, sequence: reference.slice(0, guide.cut) + "N".repeat(size) + reference.slice(guide.cut), size, guide: index + 1, cut: guide.cut });
    }
  });

  const guides = spec.guides || [];
  for (let i = 0; i < guides.length; i += 1) {
    for (let j = i + 1; j < guides.length; j += 1) {
      const left = Math.min(guides[i].cut, guides[j].cut);
      const right = Math.max(guides[i].cut, guides[j].cut);
      if (right - left < 2) continue;
      for (let a = -3; a <= 3; a += 1) {
        for (let b = -3; b <= 3; b += 1) {
          const start = left + a; const end = right + b;
          if (start < 1 || end <= start || end > reference.length) continue;
          add({ id: `g${i + 1}g${j + 1}:del@${start}-${end}`, kind: "deletion_between_cuts", label: `Deletion between cuts (${end - start} bp)`, sequence: reference.slice(0, start) + reference.slice(end), size: -(end - start), guides: [i + 1, j + 1] });
        }
      }
    }
  }

  const donorAlleles = [];
  (spec.donors || []).forEach((donor, donorIndex) => {
    const { features } = donorFeatures(spec, donor);
    const n = features.length;
    // Homology-directed repair copies a contiguous run of the donor's features. A single base can also be lost
    // from an otherwise complete run when the cell repairs that one mismatch back to the old base, so every
    // "all but one" set is included as well (not for more than MAX_FEATURES features, where the library would
    // outgrow what a trace can resolve).
    const runs = [];
    for (let start = 0; start < n; start += 1) for (let end = start; end < n; end += 1) runs.push(features.slice(start, end + 1));
    if (n >= 3 && n <= MAX_FEATURES) {
      for (let skip = 1; skip < n - 1; skip += 1) if (features[skip].kind === "marker") { const run = features.filter((_, index) => index !== skip); run.skipsMarker = true; runs.push(run); }
    }
    const hasIntendedAnywhere = features.some((feature) => feature.kind === "insert" || feature.marker.role === "intended");
    runs.forEach((run, runIndex) => {
      const complete = run.length === n;
      const hasInsert = run.some((feature) => feature.kind === "insert");
      const hasIntended = run.some((feature) => feature.kind === "insert" || feature.marker.role === "intended");
      const carried = run.filter((feature) => feature.kind === "marker").map((feature) => feature.marker);
      const sequence = applyFeatures(reference, run);
      const kind = complete ? "edit" : "edit_partial";
      const intendedState = !hasIntendedAnywhere ? "" : hasIntended ? "intended edit present" : "intended edit absent";
      const label = complete
        ? `Intended edit (${donor.name})`
        : `Partial conversion: ${[hasInsert ? "insert" : "", carried.length ? describeMarkers(carried) : ""].filter(Boolean).join(" + ")}${intendedState ? ` (${intendedState})` : ""}`;
      const existing = add({ id: `d${donorIndex + 1}:run${runIndex}`, kind, label, sequence, size: sequence.length - reference.length, donor: donor.name, carries: run.map((feature) => (feature.kind === "insert" ? "insert" : feature.pos)), intendedPresent: hasIntended, skipsMarker: Boolean(run.skipsMarker) });
      donorAlleles.push(existing);
    });
  });
  // A donor's complete edit that also carries a small indel at a cut (imperfect repair of the same allele). A trace cannot tell
  // "wild type + edit-with-indel" from "edit + indel" (the same bases in a different phase), so these alleles are what lets the
  // fit and its interval know the alternative exists; they carry a tie-breaking cost so that the ordinary reading wins a tie.
  if (!options.noDonorIndels) (spec.donors || []).forEach((donor, donorIndex) => {
    if ((donor.insertBp || 0) > 0 || (donor.replacedBp || 0) > 0) return;
    const edit = completeAllele(spec, donor).sequence; if (edit.length !== reference.length) return;
    (spec.guides || []).forEach((guide) => {
      for (let size = 1; size <= MAX_DONOR_INDEL; size += 1) for (let offset = 0; offset <= size; offset += 1) {
        const start = guide.cut - offset; if (start < 0 || start + size > edit.length) continue;
        add({ id: `d${donorIndex + 1}:edit-del${size}@${start}`, kind: "edit_indel", label: `Donor edit with -${size} at ${guide.name}`, sequence: edit.slice(0, start) + edit.slice(start + size), size: -size, guide: donorIndex + 1, donor: donor.name });
      }
      for (let size = 1; size <= maxInsertion; size += 1) insertions(edit, guide.cut, size).forEach(({ sequence, bases }) => add({ id: `d${donorIndex + 1}:edit-ins${bases}@${guide.cut}`, kind: "edit_indel", label: `Donor edit with +${size} (${bases}) at ${guide.name}`, sequence, size, guide: donorIndex + 1, donor: donor.name }));
    });
  });
  return { alleles, donorAlleles, referenceLength: reference.length };
}

/** The reference with one donor's complete edit applied (every marker and the insert). */
export function completeAllele(spec, donor) {
  const { features, reference } = donorFeatures(spec, donor);
  return { sequence: applyFeatures(reference, features), features };
}
