import { buildResolutionTrace, buildSqlHistoryEntry } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResolutionTracePanel } from "@/components/qa/resolution-trace-view";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

describe("Resolution Trace panel", () => {
  it("renders bounded server-authored trace nodes without horizontal overflow", async () => {
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      config_ref: null,
      nodes: [
        {
          node_id: `event:${id(5)}`,
          kind: "PROGRESS",
          source_event_id: id(5),
          sequence: 1,
          occurred_at: "2026-08-18T12:00:00.000Z",
          status: "RUNNING",
          title: "Evidence planning",
          summary: "A".repeat(2_000),
          duration_ms: null,
          artifact_refs: [],
        },
      ],
      edges: [],
    });
    const html = renderToStaticMarkup(
      <ResolutionTracePanel trace={trace} sql={[]} focusSequence={1} />,
    );
    expect(html).toContain("运行与证据");
    expect(html).toContain("Evidence planning");
    expect(html).toContain("break-words");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(`id="resolution-trace-event:${id(5)}"`);
    expect(html).not.toContain("private reasoning");
  });

  it("renders hash-only SQL history with a conversation deep link", async () => {
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      config_ref: null,
      nodes: [],
      edges: [],
    });
    const entry = await buildSqlHistoryEntry({
      schema_version: "sql-history-entry@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      sql_artifact_ref: {
        artifact_id: id(6),
        artifact_type: "SqlArtifact",
        ...scope,
        run_id: id(3),
        revision: 1,
        content_hash: hash("1"),
      },
      execution_receipt_ref: null,
      query_evidence_ref: null,
      result_ref: null,
      schema_snapshot_ref: null,
      schema_snapshot_hash: hash("2"),
      compiler_version: "postgresql-compiler@1.0.0",
      ast_hash: hash("3"),
      statement_hash: hash("4"),
      parameter_hash: hash("5"),
      query_hash: hash("6"),
      status: "COMPILED",
      occurred_at: "2026-08-18T12:00:00.000Z",
      conversation_href: `/w/${scope.tenant_id}/qa?conversation=${id(4)}&run=${id(3)}&tab=conversation`,
    });
    const html = renderToStaticMarkup(
      <ResolutionTracePanel trace={trace} sql={[entry]} initialTab="sql" />,
    );
    expect(html).toContain("postgresql-compiler@1.0.0");
    expect(html).toContain("打开原会话");
    expect(html).not.toMatch(/parameters|rows|prompt|context/i);
    const empty = renderToStaticMarkup(<ResolutionTracePanel trace={trace} sql={[]} />);
    expect(empty).toContain("暂无运行节点");
  });
});
