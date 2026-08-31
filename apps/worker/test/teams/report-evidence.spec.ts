import {
  buildProductTeamArtifactDocument,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { describe, expect, it, vi } from "vitest";
import { resolveReportEvidence } from "../../src/teams/report-evidence.js";
import {
  comparisonId as id,
  monthlyComparisonFixture,
  comparisonRef as ref,
  comparisonScope as scope,
} from "../analysis/support/monthly-comparison-fixture.js";

async function fixtures() {
  const query = (await monthlyComparisonFixture()).document;
  const chart = ref("ArtifactWorkspaceDocument", 70);
  const report = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: ref("AnalysisReport", 71),
    profile_id: "governed-analysis-agent",
    task_id: id(72),
    source_refs: [query.artifact_ref, chart],
    provenance: null,
    projection: {
      kind: "REPORT",
      title: "已验收趋势",
      sections: [
        {
          heading: "趋势图",
          body_text: `原始图表 artifact://${chart.artifact_id}`,
          source_refs: [chart],
        },
      ],
    },
    committed_at: "2026-08-31T00:00:00.000Z",
  });
  const docs = new Map([query, report].map((doc) => [doc.artifact_ref.artifact_id, doc]));
  const resolve = vi.fn(async (reference) => docs.get(reference.artifact_id) ?? null);
  return { query, report, chart, docs, resolve };
}

describe("Report accepted evidence bundle", () => {
  it("keeps the existing single QueryEvidence context and source contract", async () => {
    const { query, resolve } = await fixtures();
    const result = await resolveReportEvidence({
      scope,
      run_id: id(3),
      references: [query.artifact_ref],
      resolve,
    });
    expect(result.source_refs).toEqual([query.artifact_ref]);
    expect(result.retained_sections).toEqual([]);
    if (query.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
    expect(JSON.parse(result.context_text)).toEqual({
      evidence_ref: query.artifact_ref,
      columns: query.projection.columns,
      rows: query.projection.rows,
      total_rows: query.projection.total_rows,
    });
  });

  it.each([false, true])(
    "composes an accepted analysis with exact original sections (plus query=%s)",
    async (withQuery) => {
      const { query, report, chart, resolve } = await fixtures();
      const references = withQuery
        ? [query.artifact_ref, report.artifact_ref]
        : [report.artifact_ref];
      const result = await resolveReportEvidence({ scope, run_id: id(3), references, resolve });
      expect(new Set(result.source_refs.map((r) => r.artifact_id))).toEqual(
        new Set([
          query.artifact_ref.artifact_id,
          report.artifact_ref.artifact_id,
          chart.artifact_id,
        ]),
      );
      if (report.projection.kind !== "REPORT") throw new Error("TEST_REPORT_REQUIRED");
      expect(result.retained_sections).toEqual(report.projection.sections);
      expect(JSON.parse(result.context_text)).toMatchObject({
        accepted_inputs: expect.arrayContaining([
          { evidence_ref: report.artifact_ref, projection: report.projection },
        ]),
      });
    },
  );

  it.each([
    "run_id",
    "app_id",
    "tenant_id",
    "environment",
    "type",
    "duplicate",
    "empty",
    "too_many",
  ])("rejects %s before resolving any document", async (problem) => {
    const { query, resolve } = await fixtures();
    let references = [query.artifact_ref];
    if (problem === "type") references = [{ ...query.artifact_ref, artifact_type: "SqlArtifact" }];
    else if (problem === "empty") references = [];
    else if (problem === "duplicate") references = [query.artifact_ref, query.artifact_ref];
    else if (problem === "too_many")
      references = Array.from({ length: 17 }, (_, i) => ({
        ...query.artifact_ref,
        artifact_id: id(200 + i),
      }));
    else
      references = [
        { ...query.artifact_ref, [problem]: problem === "environment" ? "other" : id(999) },
      ];
    await expect(
      resolveReportEvidence({ scope, run_id: id(3), references, resolve }),
    ).rejects.toThrow("TEAM_REPORT_INPUT_INVALID");
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "hash",
    "reference",
    "section_source",
    "source_overflow",
    "section_overflow",
  ])("rejects %s without truncating or inventing source evidence", async (problem) => {
    const { report, docs, resolve } = await fixtures();
    let reference = report.artifact_ref;
    if (problem === "missing") docs.clear();
    else if (problem === "reference") reference = { ...reference, revision: 2 };
    else if (problem === "hash") docs.set(reference.artifact_id, { ...report, task_id: id(999) });
    else {
      if (report.projection.kind !== "REPORT") throw new Error("TEST_REPORT_REQUIRED");
      const section = report.projection.sections[0];
      if (!section) throw new Error("TEST_SECTION_REQUIRED");
      const material: ProductTeamArtifactDocument = {
        ...report,
        projection: {
          ...report.projection,
          sections:
            problem === "section_overflow"
              ? Array.from({ length: 100 }, () => section)
              : report.projection.sections,
        },
      };
      if (problem === "section_source")
        material.projection = {
          ...report.projection,
          sections: [
            {
              heading: "伪造引用",
              body_text: "未知来源",
              source_refs: [ref("QueryEvidence", 999)],
            },
          ],
        };
      if (problem === "source_overflow")
        material.source_refs = [
          ...report.source_refs,
          ...Array.from({ length: 14 }, (_, i) => ref("QueryEvidence", 300 + i)),
        ];
      const rebuilt = await buildProductTeamArtifactDocument(material);
      reference = rebuilt.artifact_ref;
      docs.set(reference.artifact_id, rebuilt);
    }
    await expect(
      resolveReportEvidence({ scope, run_id: id(3), references: [reference], resolve }),
    ).rejects.toThrow();
  });
});
