import { describe, expect, it } from "vitest";
import {
  semanticImportUploadInputSchema,
  semanticWorkspaceExportHashMaterial,
  semanticWorkspaceExportHashMaterialSchema,
  semanticWorkspaceExportSchema,
  sha256ContentHash,
  verifySemanticWorkspaceExport,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}` as const;

async function fixture() {
  const material = {
    format: "semantic-workspace-export@1.0.0" as const,
    compatibility: {
      semantic_protocol_version: "semantic-source-payload@1.0.0",
      minimum_importer_version: "data-agent@0.1.0",
    },
    datasource_refs: [
      {
        logical_ref: "revenue-primary",
        display_name: "Revenue warehouse",
        dialect: "postgresql" as const,
        schema_fingerprint: hash,
      },
    ],
    domains: [
      {
        semantic_domain: "revenue",
        datasource_logical_ref: "revenue-primary",
        source_release: { generation: "3", digest: hash },
        semantic: { metrics: [{ metric_id: "net_revenue" }] },
      },
    ],
  };
  return {
    ...material,
    exported_at: "2026-08-14T08:00:00.000Z",
    content_hash: await sha256ContentHash(material),
  };
}

describe("semantic portability", () => {
  it("verifies the canonical content hash while excluding export time", async () => {
    const document = await fixture();
    expect(await verifySemanticWorkspaceExport(document)).toEqual(document);
    expect(semanticWorkspaceExportHashMaterial(document)).not.toHaveProperty("exported_at");
  });

  it("fails closed for unknown fields and a changed payload", async () => {
    const document = await fixture();
    expect(
      semanticWorkspaceExportSchema.safeParse({
        ...document,
        workspace_id: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    await expect(
      verifySemanticWorkspaceExport({
        ...document,
        domains: [{ ...document.domains[0], semantic: { metrics: [] } }],
      }),
    ).rejects.toThrow("SEMANTIC_IMPORT_CONTENT_HASH_MISMATCH");
  });

  it("rejects dangling and duplicate logical datasource references", async () => {
    const document = await fixture();
    const dangling = {
      ...document,
      domains: [{ ...document.domains[0], datasource_logical_ref: "missing" }],
    };
    dangling.content_hash = await sha256ContentHash(
      semanticWorkspaceExportHashMaterialSchema.parse({
        format: dangling.format,
        compatibility: dangling.compatibility,
        datasource_refs: dangling.datasource_refs,
        domains: dangling.domains,
      }),
    );
    await expect(verifySemanticWorkspaceExport(dangling)).rejects.toThrow(
      "SEMANTIC_IMPORT_DATASOURCE_REF_MISSING",
    );
  });

  it("enforces the 1 MiB upload boundary", async () => {
    const document = await fixture();
    expect(
      semanticImportUploadInputSchema.safeParse({
        schema_version: "semantic-import-upload@1.0.0",
        operation_id: crypto.randomUUID(),
        idempotency_key: crypto.randomUUID(),
        file_name: "semantic.json",
        byte_size: 1024 * 1024 + 1,
        document,
      }).success,
    ).toBe(false);
  });
});
