import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { semanticSourceBundleSchema } from "../packages/contracts/src/index.js";
import { validateSourceBundle } from "../packages/semantic/src/validation/source-bundle-validator.js";
import { describe, expect, it } from "vitest";

const path = resolve("infra/agenticdatabench/ecommerce-v1/semantic/ecommerce-source-bundle.json");

describe("E-commerce semantic candidate bundle", () => {
  it("has production-sized governed semantics without duplicate identities", async () => {
    const bundle = semanticSourceBundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const validation = validateSourceBundle(bundle);
    expect(
      validation.valid,
      validation.issues.map(({ severity, message }) => `${severity}: ${message}`).join("\n"),
    ).toBe(true);
    expect(bundle.metrics).toHaveLength(32);
    expect(bundle.dimensions).toHaveLength(15);
    expect(bundle.relationships.length).toBeGreaterThanOrEqual(8);
    expect(bundle.business_ontology?.entities.length).toBeGreaterThanOrEqual(12);
    expect(bundle.business_ontology?.terms.length).toBeGreaterThanOrEqual(40);
    expect(bundle.business_ontology?.lifecycle).toBe("draft");
    expect(new Set(bundle.metrics.map(({ metric_id }) => metric_id)).size).toBe(bundle.metrics.length);
    expect(new Set(bundle.business_ontology?.terms.map(({ term_id }) => term_id)).size).toBe(
      bundle.business_ontology?.terms.length,
    );
  });
});
