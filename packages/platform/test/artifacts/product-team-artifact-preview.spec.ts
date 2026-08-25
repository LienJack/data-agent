import { buildProductTeamArtifactDocument } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { projectArtifactDocument } from "../../src/artifacts/artifact-workspace-service.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Product Team Artifact preview", () => {
  it("projects an exact AnalysisReport reference without raw Tool output fallback", async () => {
    const document = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@2.0.0",
      artifact_ref: {
        artifact_id: id(1),
        artifact_type: "AnalysisReport",
        app_id: id(2),
        tenant_id: id(3),
        environment: "test",
        run_id: id(4),
        revision: 1,
        content_hash: `sha256:${"0".repeat(64)}`,
      },
      profile_id: "report-writing-agent",
      task_id: id(5),
      source_refs: [],
      provenance: null,
      projection: {
        kind: "REPORT",
        title: "E-commerce 数据库表数量",
        sections: [{ heading: "结论", body_text: "共有 14 张表。", source_refs: [] }],
      },
      committed_at: "2026-08-18T12:00:00.000Z",
    });
    await expect(
      projectArtifactDocument(document, document.artifact_ref, { offset: 0, limit: 100 }),
    ).resolves.toMatchObject({
      source_ref: document.artifact_ref,
      projection: { kind: "REPORT", title: "E-commerce 数据库表数量" },
    });
  });
});
