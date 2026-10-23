import { validateDesignSpec } from "../engine/qc/designSpec.js";
import { buildQcDesignSpec } from "../engine/design/qcExport.js";

export function parseQcDesign(text) {
  const value = JSON.parse(text);
  const spec = value?.schema === "assured-qc-design/1" ? value
    : value?.designResult ? buildQcDesignSpec(value.designResult) : null;
  if (!spec) throw new Error("Choose the Design JSON exported by the design tool, or an exported Bench .assured project.");
  let validation;
  try { validation = validateDesignSpec(spec); }
  catch { throw new Error("The design file has malformed fields. Export a new Design JSON from the design tool."); }
  if (!validation.ok) throw new Error("Invalid QC design: " + validation.errors.join(" "));
  return { spec, warnings: validation.warnings };
}
