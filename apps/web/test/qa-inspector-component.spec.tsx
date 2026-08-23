import { publicRunEventSchema, type QaInspectorTarget } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubagentInspector } from "@/components/qa/qa-inspector";

const runId = "10000000-0000-4000-8000-000000000021";
const taskId = "10000000-0000-4000-8000-000000000022";
const target: QaInspectorTarget = {
  kind: "subagent",
  run_id: runId,
  profile_id: "governed-text2sql-agent",
  task_id: taskId,
  anchor_sequence: 1,
};
const agent = publicRunEventSchema.parse({
  schema_version: "public-run-event@2.0.0",
  event_id: "10000000-0000-4000-8000-000000000023",
  run_id: runId,
  sequence: 1,
  occurred_at: "2026-08-21T00:00:00.000Z",
  type: "agent",
  payload: {
    profile_id: "governed-text2sql-agent",
    task_id: taskId,
    status: "RUNNING",
    phase: "compile.query",
    title: "internal-title",
    summary: "正在编译查询",
    duration_ms: null,
    error_code: null,
  },
});

describe("QAInspector", () => {
  it("derives a Subagent baseline from the same public replay", () => {
    const html = renderToStaticMarkup(<SubagentInspector target={target} events={[agent]} />);
    expect(html).toContain("Text2SQL");
    expect(html).toContain("正在编译查询");
    expect(html).toContain("已载入 replay");
    expect(html).not.toContain("reasoning_content");
  });

  it("shows a deterministic stale state without selecting a newer task", () => {
    const html = renderToStaticMarkup(
      <SubagentInspector
        target={{ ...target, task_id: "10000000-0000-4000-8000-000000000099" }}
        events={[agent]}
      />,
    );
    expect(html).toContain("Subagent 目标已过期");
    expect(html).toContain("SUBAGENT_INSPECTOR_TARGET_STALE");
  });
});
