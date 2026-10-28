// Settings that belong to one design run and must not be inherited by the next one.
//
// `customGuides` are spacers the user pasted for a particular gene, reference and enzyme. They used to be saved with the project's design
// options, so after a design with custom guides every later design (another gene, another enzyme) started from them and failed with
// "Custom gRNA ... could not be mapped to the reference sequence". They are passed explicitly to the run that needs them and never read back
// from saved options. `avoidBlockerPositions` is the same kind of setting: the blocker positions a chosen candidate's later donor version avoids.
const PER_RUN_KEYS = ["customGuides", "avoidBlockerPositions", "reservedBlockerPositions"];

export function withoutRunOverrides(options) {
  const clean = { ...(options || {}) };
  for (const key of PER_RUN_KEYS) delete clean[key];
  return clean;
}
