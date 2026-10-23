// Keep experiment inputs and their derived results together across workflow steps.
export function createProject() {
  return {
    id: `proj_${globalThis.crypto.randomUUID()}`,
    name: "New Genome Editing Experiment",
    gene: "",
    editType: "ko",
    mutation: "",
    tag: "FLAG",
    homologyArmLength: 400,
    options: { deliveryMethod: "rnp", maxBlockingChanges: 3, coDeliveryBlocking: false },
    geneMeta: null,
    genbankRaw: "",
    designResult: null,
    qcResults: []
  };
}

const designInputs = ["gene", "editType", "mutation", "tag", "homologyArmLength", "options", "genbankRaw"];

export function updateProject(project, fields) {
  const changed = designInputs.some(key => key in fields &&
    JSON.stringify(fields[key]) !== JSON.stringify(project[key]));
  const next = { ...project, ...fields };
  if (changed || ("designResult" in fields && fields.designResult !== project.designResult)) {
    // A new target or design cannot retain the previous experiment's screening results.
    Object.assign(next, { designResult: null, svgScheme: null, caption: null, status: null, qcResults: [], qcDesignSpec: null, qcDesignSource: null, qcImportedDesignText: null }, fields);
  }
  if ("qcDesignSpec" in fields && fields.qcDesignSpec !== project.qcDesignSpec) next.qcResults = [];
  return next;
}

export function parseProject(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.gene !== "string" || !["ko", "pm", "ct", "nt", "it"].includes(value.editType) ||
      (value.qcResults != null && !Array.isArray(value.qcResults)) ||
      (value.designResult != null && (typeof value.designResult !== "object" || Array.isArray(value.designResult))) ||
      (value.options != null && (typeof value.options !== "object" || Array.isArray(value.options))) ||
      ["id", "name", "mutation", "tag", "genbankRaw"].some(key => value[key] != null && typeof value[key] !== "string")) {
    throw new Error("Choose an ASSURED Bench experiment exported with the Export button.");
  }
  const defaults = createProject();
  return { ...defaults, ...value, id: value.id || defaults.id,
    options: { ...defaults.options, ...value.options,
      coDeliveryBlocking: value.options?.coDeliveryBlocking ?? value.options?.coDelivery ?? false },
    qcResults: value.qcResults || [] };
}
