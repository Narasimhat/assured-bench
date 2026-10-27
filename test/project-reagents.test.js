import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runDesign, summarizeProcurementReadiness } from "../src/engine/design/designEngine.js";
import { loadLindel } from "../src/engine/design/lindel/loadLindel.js";
import { projectDesignReagents } from "../src/services/projectReagents.js";
import { generateIdtOrderRows } from "../src/services/vendorExport.js";

const lindel = await loadLindel();
const dipk2a = fs.readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");

function ko() {
  const result = runDesign("ko", dipk2a, "", "", "", {
    enzyme: "spcas9",
    expectedGene: "DIPK2A",
    koLindel: lindel,
    ensureGuidePair: true,
    allowNonCodingBlockers: true,
  });
  result.procurement = summarizeProcurementReadiness(result);
  return result;
}

test("projectDesignReagents surfaces guides and primers for a knockout", () => {
  const result = ko();
  const reagents = projectDesignReagents(result, "DIPK2A");
  assert.equal(reagents.gene, "DIPK2A");
  assert.ok(reagents.counts.guides >= 2, "knockout offers at least two guides");
  assert.equal(reagents.counts.donors, 0, "knockout has no donor oligo");
  assert.ok(reagents.counts.primers >= 2, "screening primers are present");
  assert.ok(reagents.guides.every((g) => g.sequence && g.name));
  assert.ok(reagents.primers.every((p) => p.sequence && p.name));
});

test("projectDesignReagents stays aligned with vendor order rows", () => {
  const result = ko();
  const reagents = projectDesignReagents(result, "DIPK2A");
  const rows = generateIdtOrderRows({ input: { gene: "DIPK2A" }, result });
  const guideRows = rows.filter((r) => /rna/i.test(r.itemType));
  const primerRows = rows.filter((r) => /primer/i.test(r.itemType));
  assert.equal(reagents.counts.guides, guideRows.length);
  assert.equal(reagents.counts.primers, primerRows.length);
  assert.deepEqual(
    reagents.guides.map((g) => g.sequence),
    guideRows.map((r) => r.sequence)
  );
});

test("empty or errored designs project to zero reagents", () => {
  assert.deepEqual(projectDesignReagents(null).counts, { guides: 0, donors: 0, primers: 0 });
  assert.deepEqual(projectDesignReagents({ err: "boom" }).counts, { guides: 0, donors: 0, primers: 0 });
});
