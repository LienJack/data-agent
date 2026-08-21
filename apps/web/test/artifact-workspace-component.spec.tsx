import type { ArtifactPreviewResult } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactWorkspace } from "@/components/workbench/artifact-workspace";

const sourceRef = {
  artifact_id: "00000000-0000-4000-8000-000000007401",
  artifact_type: "ArtifactWorkspaceDocument" as const,
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000007402",
  environment: "test",
  run_id: "00000000-0000-4000-8000-000000007403",
  revision: 1,
  content_hash: `sha256:${"4".repeat(64)}` as const,
};

describe("ArtifactWorkspace", () => {
  it("renders untrusted markup as escaped text and exposes the exact source hash", () => {
    const preview: ArtifactPreviewResult = {
      schema_version: "artifact-preview-result@1.0.0",
      source_ref: sourceRef,
      renderer_version: "artifact-workspace-renderer@1.0.0",
      projection: {
        kind: "MARKDOWN",
        plain_text: '<script>alert("x")</script><img src=x onerror=alert(1)>',
        links: [{ label: "safe", href: "https://example.com/evidence" }],
      },
      viewport: { offset: 0, limit: 100, total_rows: null, truncated: false },
    };
    const markup = renderToStaticMarkup(<ArtifactWorkspace preview={preview} />);
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).toContain(sourceRef.content_hash);
    expect(markup).toContain('rel="noreferrer noopener"');
  });

  it("cross-links report evidence with the complete immutable ArtifactReference", () => {
    const evidenceRef = {
      ...sourceRef,
      artifact_id: "00000000-0000-4000-8000-000000007499",
      artifact_type: "SqlArtifact" as const,
      revision: 3,
      content_hash: `sha256:${"9".repeat(64)}` as const,
    };
    const preview: ArtifactPreviewResult = {
      schema_version: "artifact-preview-result@1.0.0",
      source_ref: sourceRef,
      renderer_version: "artifact-workspace-renderer@1.0.0",
      projection: {
        kind: "REPORT",
        title: "Evidence report",
        sections: [{ heading: "Finding", body_text: "Text", source_refs: [evidenceRef] }],
      },
      viewport: { offset: 0, limit: 100, total_rows: null, truncated: false },
    };
    const markup = renderToStaticMarkup(<ArtifactWorkspace preview={preview} />);
    expect(markup).toContain(`/artifacts/${evidenceRef.artifact_id}?reference=`);
    const href = markup.match(/href="([^"]+\?reference=[^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    expect(href).toBeDefined();
    const encodedReference = new URL(href ?? "", "http://localhost").searchParams.get("reference");
    expect(JSON.parse(encodedReference ?? "null")).toEqual(evidenceRef);
  });

  it("renders a governed V2 chart with an equivalent accessible data table", () => {
    const evidenceRef = {
      ...sourceRef,
      artifact_id: "00000000-0000-4000-8000-000000007498",
      artifact_type: "QueryEvidence" as const,
      content_hash: `sha256:${"8".repeat(64)}` as const,
    };
    const preview: ArtifactPreviewResult = {
      schema_version: "artifact-preview-result@2.0.0",
      source_ref: sourceRef,
      renderer_version: "artifact-workspace-renderer@2.0.0",
      source_refs: [evidenceRef],
      provenance: {
        transform_version: "query-evidence-chart@1.0.0",
        dataset_hash: `sha256:${"7".repeat(64)}`,
        resolved_context: {
          package_id: "00000000-0000-4000-8000-000000007490",
          package_hash: `sha256:${"6".repeat(64)}`,
          receipt_id: "00000000-0000-4000-8000-000000007491",
          receipt_hash: `sha256:${"5".repeat(64)}`,
        },
      },
      projection: {
        kind: "CHART",
        chart_type: "LINE",
        title: "月度订单趋势",
        description: "由已提交 QueryEvidence 确定性派生",
        unit: "单",
        x_key: "month",
        y_keys: ["order_count"],
        legend: { visible: false },
        table: {
          kind: "TABLE",
          columns: [
            { key: "month", label: "月份", data_type: "STRING" },
            { key: "order_count", label: "订单量", data_type: "NUMBER" },
          ],
          rows: [
            { month: "2026-01", order_count: 20 },
            { month: "2026-02", order_count: 32 },
          ],
          total_rows: 2,
        },
      },
      viewport: { offset: 0, limit: 2, total_rows: 2, truncated: false },
    };
    const markup = renderToStaticMarkup(<ArtifactWorkspace preview={preview} />);
    expect(markup).toContain("月度订单趋势");
    expect(markup).toContain("查看数据表（与图表同源）");
    expect(markup).toContain('open=""');
    expect(markup).toContain("2026-01");
    expect(markup).toContain("订单量");
    expect(markup).toContain(preview.provenance.dataset_hash);
    expect(markup).toContain(evidenceRef.content_hash);
    expect(markup).toContain(preview.provenance.resolved_context.receipt_hash);
    expect(markup).toContain("治理来源");
    expect(markup).toContain("单位：单");
    expect(markup).toContain("1–2 / 2");
  });

  it("keeps governed table pagination on native keyboard-operable buttons", () => {
    const preview: ArtifactPreviewResult = {
      schema_version: "artifact-preview-result@1.0.0",
      source_ref: { ...sourceRef, artifact_type: "QueryEvidence" },
      renderer_version: "artifact-workspace-renderer@1.0.0",
      projection: {
        kind: "TABLE",
        columns: [{ key: "value", label: "数值", data_type: "NUMBER" }],
        rows: [{ value: 41 }, { value: 73 }],
        total_rows: 5,
      },
      viewport: { offset: 0, limit: 2, total_rows: 5, truncated: true },
    };
    const markup = renderToStaticMarkup(
      <ArtifactWorkspace preview={preview} onPageChange={() => undefined} />,
    );
    expect(markup).toContain("1–2 / 5 · 已分页");
    expect(markup).toContain("上一页");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>上一页<\/button>/);
    expect(markup).toMatch(/<button type="button" class="[^"]+">下一页<\/button>/);
  });
});
