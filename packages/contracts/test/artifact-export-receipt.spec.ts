import { describe, expect, it } from "vitest";
import {
  artifactExportReceiptSchema,
  artifactWorkspaceDocumentSchema,
  artifactWorkspaceProjectionSchema,
  artifactWorkspaceTableProjectionSchema,
  buildArtifactExportReceipt,
  computeArtifactExportRequestHash,
  verifyArtifactExportReceipt,
} from "../src/artifacts/export-receipt.js";

const sourceRef = {
  artifact_id: "00000000-0000-4000-8000-000000007001",
  artifact_type: "SandboxResult" as const,
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000007002",
  environment: "local",
  run_id: "00000000-0000-4000-8000-000000007003",
  revision: 2,
  content_hash: `sha256:${"1".repeat(64)}` as const,
};

const command = {
  schema_version: "artifact-export-command@1.0.0" as const,
  source_ref: sourceRef,
  format: "CSV" as const,
  filename_stem: "quarterly-results",
  idempotency_key: "artifact-export-0001",
};

describe("Artifact Export Receipt", () => {
  it("matches the PostgreSQL canonical request-hash fixture", async () => {
    await expect(
      computeArtifactExportRequestHash({
        schema_version: "artifact-export-command@1.0.0",
        source_ref: {
          artifact_id: "00000000-0000-4000-8000-000000007505",
          artifact_type: "ArtifactWorkspaceDocument",
          app_id: "00000000-0000-4000-8000-00000000da01",
          tenant_id: "00000000-0000-4000-8000-000000007501",
          environment: "local",
          run_id: "00000000-0000-4000-8000-000000007504",
          revision: 1,
          content_hash: `sha256:${"51".repeat(32)}`,
        },
        format: "CSV",
        filename_stem: "u7-results",
        idempotency_key: "u7-export-0001",
      }),
    ).resolves.toBe("sha256:5f7576e1518c98aa257ccea5ce5515e66ce68b15c5a938455e74c939fecb8493");
  });

  it("builds and verifies a receipt bound to one exact committed source revision", async () => {
    const requestHash = await computeArtifactExportRequestHash(command);
    const receipt = await buildArtifactExportReceipt({
      schema_version: "artifact-export-receipt@1.0.0",
      receipt_ref: {
        ...sourceRef,
        artifact_id: "00000000-0000-4000-8000-000000007004",
        artifact_type: "ArtifactExportReceipt",
        revision: 1,
        content_hash: `sha256:${"0".repeat(64)}`,
      },
      source_ref: sourceRef,
      format: "CSV",
      renderer_version: "artifact-workspace-renderer@1.0.0",
      exporter_version: "artifact-workspace-exporter@1.0.0",
      formula_policy_version: "spreadsheet-formula-neutralization@1.0.0",
      mime_type: "text/csv; charset=utf-8",
      attachment_filename: "quarterly-results.csv",
      row_count: 2,
      column_count: 2,
      request_hash: requestHash,
      output_hash: `sha256:${"2".repeat(64)}`,
      created_at: "2026-08-17T03:00:00.000Z",
    });

    await expect(verifyArtifactExportReceipt(receipt, command)).resolves.toEqual(receipt);
    expect(receipt.receipt_ref.content_hash).not.toBe(`sha256:${"0".repeat(64)}`);

    await expect(
      verifyArtifactExportReceipt(
        {
          ...receipt,
          source_ref: { ...sourceRef, revision: 3 },
        },
        command,
      ),
    ).rejects.toThrow();
  });

  it("rejects cross-scope receipt references and unsafe attachment metadata", async () => {
    const requestHash = await computeArtifactExportRequestHash(command);
    await expect(
      buildArtifactExportReceipt({
        schema_version: "artifact-export-receipt@1.0.0",
        receipt_ref: {
          ...sourceRef,
          tenant_id: "00000000-0000-4000-8000-000000007099",
          artifact_id: "00000000-0000-4000-8000-000000007004",
          artifact_type: "ArtifactExportReceipt",
          revision: 1,
          content_hash: `sha256:${"0".repeat(64)}`,
        },
        source_ref: sourceRef,
        format: "CSV",
        renderer_version: "artifact-workspace-renderer@1.0.0",
        exporter_version: "artifact-workspace-exporter@1.0.0",
        formula_policy_version: "spreadsheet-formula-neutralization@1.0.0",
        mime_type: "text/html",
        attachment_filename: "../unsafe.html",
        row_count: 1,
        column_count: 1,
        request_hash: requestHash,
        output_hash: `sha256:${"2".repeat(64)}`,
        created_at: "2026-08-17T03:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("requires table rows to close exactly over declared columns", () => {
    expect(
      artifactWorkspaceTableProjectionSchema.safeParse({
        kind: "TABLE",
        columns: [
          { key: "name", label: "Name", data_type: "STRING" },
          { key: "amount", label: "Amount", data_type: "NUMBER" },
        ],
        rows: [{ name: "A", amount: 1, injected: "=cmd()" }],
        total_rows: 1,
      }).success,
    ).toBe(false);
  });

  it("strictly rejects caller-added receipt fields", () => {
    expect(
      artifactExportReceiptSchema.safeParse({
        schema_version: "artifact-export-receipt@1.0.0",
        raw_source_document: "secret",
      }).success,
    ).toBe(false);
  });

  it("closes chart encodings and report evidence over declared columns and exact scope/run", () => {
    expect(
      artifactWorkspaceProjectionSchema.safeParse({
        kind: "CHART",
        mark: "BAR",
        title: "Broken",
        x_key: "missing",
        y_key: "amount",
        table: {
          kind: "TABLE",
          columns: [{ key: "amount", label: "Amount", data_type: "NUMBER" }],
          rows: [{ amount: 1 }],
          total_rows: 1,
        },
      }).success,
    ).toBe(false);
    expect(
      artifactWorkspaceDocumentSchema.safeParse({
        schema_version: "artifact-workspace-document@1.0.0",
        document_ref: {
          ...sourceRef,
          artifact_type: "ArtifactWorkspaceDocument",
        },
        projection: {
          kind: "REPORT",
          title: "Spliced evidence",
          sections: [
            {
              heading: "Finding",
              body_text: "Evidence",
              source_refs: [
                {
                  ...sourceRef,
                  run_id: "00000000-0000-4000-8000-000000007099",
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
