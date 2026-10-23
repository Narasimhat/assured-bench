import React, { useCallback, useRef } from "react";
import AssuredDesignApp from "../../designer/AssuredDesignApp.jsx";
import { buildDesignSchemeSvg, buildDesignSchemeCaption } from "../../engine/design/designScheme.js";
import { ArrowRight } from "lucide-react";

function designHandoffKey(result) {
  if (!result) return "";
  const guides = (result.gs || []).map((g) => `${g.sp}:${g.str}:${g.cut}`).join("|");
  const donors = (result.os || []).map((o) => o.od || o.seq || "").join("|");
  return `${result.type}::${result.gene || ""}::${guides}::${donors.slice(0, 240)}`;
}

/**
 * Bench Design step: the same ASSURED CRISPR Designer workspace, embedded so its
 * active successful design feeds Order / Trace Analysis / Reports.
 */
export function DesignView({
  onUpdateProject,
  onProceedToOrder,
  onProceedToQc,
  currentProject,
}) {
  const onUpdateProjectRef = useRef(onUpdateProject);
  onUpdateProjectRef.current = onUpdateProject;
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;
  const lastKeyRef = useRef("");

  const handleActiveDesignChange = useCallback((payload) => {
    if (!payload?.result) return;
    const result = payload.result;
    const key = designHandoffKey(result);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    const row = payload.row || {};
    const procurement = payload.procurement || null;
    const project = projectRef.current || {};
    const svgScheme = buildDesignSchemeSvg(result);
    const caption = buildDesignSchemeCaption(result);

    onUpdateProjectRef.current({
      gene: result.gene || row.gene || project.gene || "",
      editType: result.type || row.projectType || project.editType || "pm",
      mutation: row.mutation || project.mutation || "",
      tag: row.tag || project.tag || "",
      homologyArmLength: Number(row.homologyArm) || project.homologyArmLength || 400,
      options: {
        ...project.options,
        deliveryMethod: row.deliveryMethod && row.deliveryMethod !== "unknown"
          ? row.deliveryMethod
          : (project.options?.deliveryMethod || "rnp"),
        maxBlockingChanges: Number(row.maxBlockingChanges || project.options?.maxBlockingChanges || 3),
        coDeliveryBlocking: row.coDelivery ?? project.options?.coDeliveryBlocking ?? true,
        acceptWeakProtection: !!row.acceptWeakProtection,
        weakProtectionReason: row.weakProtectionReason || "",
        acceptedBy: row.acceptedBy || "",
      },
      genbankRaw: row.gbRaw || project.genbankRaw || "",
      geneMeta: row.gbRaw
        ? {
            geneSymbol: result.gene || row.gene || "",
            transcriptId: result.gb?.transcriptId || "",
            source: row.fileName ? `Designer reference: ${row.fileName}` : "ASSURED CRISPR Designer",
            genbankText: row.gbRaw,
          }
        : project.geneMeta,
      designResult: { ...result, procurement },
      svgScheme,
      caption,
      status: procurement?.status || "review",
      name: project.name?.startsWith("Preset:")
        ? project.name
        : `${result.gene || row.gene || "Design"} (${result.type || row.projectType || "edit"})`,
    });
  }, []);

  return (
    <div>
      {currentProject?.designResult && (
        <div
          className="card"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1rem",
            borderColor: "var(--success-border, #a7f3d0)",
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>
              Designer handoff ready: {currentProject.gene || "design"} ({currentProject.editType})
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
              Continue to Order for vendor exports, or Trace Analysis for Sanger QC.
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={onProceedToOrder}>
              <ArrowRight size={16} />
              <span>Continue to Order</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={onProceedToQc}>
              Trace Analysis
            </button>
          </div>
        </div>
      )}

      <AssuredDesignApp
        embedded
        hideMarketingHero
        onActiveDesignChange={handleActiveDesignChange}
      />
    </div>
  );
}
