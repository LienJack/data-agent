import { describe, expect, it } from "vitest";
import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
  verifyProductTeamArtifactDocument,
} from "../src/artifacts/product-team-artifact.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Product Team Artifact", () => {
  it("seals an exact previewable QueryEvidence document", async () => {
    const sqlRef = {
      artifact_id: id(6),
      artifact_type: "SqlArtifact" as const,
      app_id: id(2),
      tenant_id: id(3),
      environment: "test" as const,
      run_id: id(4),
      revision: 1,
      content_hash: hash("6"),
    };
    const semanticBinding = await buildQueryEvidenceSemanticBinding({
      protocol_version: "query-evidence-semantic-binding@1.0.0",
      semantic_release_ref: {
        resource_id: id(8),
        resource_revision: 1,
        resource_hash: hash("8"),
        datasource_id: id(9),
        semantic_generation: 1,
        publication_status: "PUBLISHED",
      },
      semantic_context_ref: {
        package_id: id(10),
        package_hash: hash("a"),
        receipt_id: id(11),
        receipt_hash: hash("b"),
      },
      schema_snapshot_ref: {
        resource_id: id(12),
        resource_revision: 1,
        resource_hash: hash("c"),
        datasource_id: id(9),
        semantic_release_id: id(8),
        semantic_generation: 1,
      },
      datasource_ref: { resource_id: id(9), resource_revision: 1, resource_hash: hash("9") },
      target_binding_hash: hash("d"),
      columns: [
        {
          output_name: "table_count",
          logical_type: "NUMBER",
          nullable: false,
          semantic_role: "METRIC",
          semantic_object_id: "metric.table-count",
          formula_hash: hash("e"),
          aggregate: "count",
          grain: { grain_id: "table", granularity: "atomic" },
          physical_sources: [
            {
              schema_name: "falcon_db_24",
              relation_name: "orders",
              column_name: "id",
              formatted_type: "uuid",
              nullable: false,
            },
          ],
        },
      ],
      time_window: null,
    });
    const document = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@2.0.0",
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
      source_refs: [sqlRef],
      provenance: {
        kind: "GOVERNED_QUERY_RESULT",
        query_id: id(7),
        request_hash: hash("1"),
        result_hash: hash("2"),
        row_count: 1,
        byte_count: 32,
        elapsed_ms: 4,
        truncated: false,
        semantic_binding: semanticBinding,
      },
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
        schema_version: "product-team-artifact@2.0.0",
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
        provenance: null,
        projection: { kind: "REPORT", title: "bad", sections: [] },
        committed_at: "2026-08-18T12:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
