import { describe, expect, it } from "vitest";
import {
  buildProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "../src/artifacts/product-team-artifact.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Product Team Artifact", () => {
  it("seals an exact previewable QueryEvidence document", async () => {
    const document = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@1.0.0",
      artifact_ref: {
        artifact_id: id(1),
        artifact_type: "QueryEvidence",
        app_id: id(2),
        tenant_id: id(3),
        environment: "test",
        run_id: id(4),
        revision: 1,
        content_hash: hash("0"),
      },
      profile_id: "governed-text2sql-agent",
      task_id: id(5),
      source_refs: [],
      projection: {
        kind: "TABLE",
        columns: [{ key: "table_count", label: "table_count", data_type: "NUMBER" }],
        rows: [{ table_count: 14 }],
        total_rows: 1,
      },
      committed_at: "2026-08-18T12:00:00.000Z",
    });
    await expect(verifyProductTeamArtifactDocument(document)).resolves.toEqual(document);
    expect(document.artifact_ref.content_hash).not.toBe(hash("0"));
  });

  it("rejects a report projection masquerading as SqlArtifact", async () => {
    await expect(
      buildProductTeamArtifactDocument({
        schema_version: "product-team-artifact@1.0.0",
        artifact_ref: {
          artifact_id: id(1),
          artifact_type: "SqlArtifact",
          app_id: id(2),
          tenant_id: id(3),
          environment: "test",
          run_id: id(4),
          revision: 1,
          content_hash: hash("0"),
        },
        profile_id: "governed-text2sql-agent",
        task_id: id(5),
        source_refs: [],
        projection: { kind: "REPORT", title: "bad", sections: [] },
        committed_at: "2026-08-18T12:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
