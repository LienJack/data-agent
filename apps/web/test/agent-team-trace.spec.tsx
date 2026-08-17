import { buildAgentProductProfileRevision, buildAgentTeamPublicTrace } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentTeamTrace } from "@/components/qa/agent-team-trace";
import { WorkspaceI18nProvider } from "@/i18n";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Agent Team trace", () => {
  it("keeps a Team projection failure explicit instead of presenting an empty state", () => {
    const html = renderToStaticMarkup(
      <AgentTeamTrace profiles={[]} trace={null} error="Agent Team 轨迹加载失败" />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Agent Team 轨迹加载失败");
    expect(html).not.toContain("尚未启用 Agent Profile");
  });

  it("shows only redacted Profile, Workflow, Skill and Tool identities", async () => {
    const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
    const revision = await buildAgentProductProfileRevision({
      schema_version: "agent-product-profile-revision@1.0.0",
      scope,
      profile_id: "report-writing-agent",
      revision: 1,
      runtime_profile_ref: {
        profile_id: "report-writing-agent",
        revision: 1,
        profile_hash: hash("1"),
      },
      model_profile_ref: { resource_id: id(3), resource_revision: 1, resource_hash: hash("2") },
      prompt_ref: { prompt_id: "prompt.report", revision: 1, prompt_hash: hash("3") },
      workflow_ref: {
        workflow_id: "workflow.report",
        revision: 1,
        workflow_hash: hash("4"),
      },
      direct_tool_allowlist: ["evidence.read", "report.project"],
      skill_refs: [{ skill_id: id(4), revision: 1, revision_hash: hash("5") }],
      context_policy_ref: { resource_id: id(5), resource_revision: 1, resource_hash: hash("6") },
      execution_safety_policy_ref: {
        resource_id: id(6),
        resource_revision: 1,
        resource_hash: hash("7"),
      },
      expected_output_artifact_types: ["AnalysisReport"],
      verifier_contract_hash: hash("8"),
      approval_status: "APPROVED",
    });
    const trace = await buildAgentTeamPublicTrace({
      schema_version: "agent-team-public-trace@1.0.0",
      scope,
      run_id: id(20),
      tasks: [
        {
          task_id: id(21),
          parent_task_id: null,
          depth: 0,
          profile_id: "data-agent-orchestrator",
          profile_revision: 1,
          profile_hash: hash("9"),
          task_revision: 1,
          attempt_id: id(23),
          worker_fence: 1,
          status: "RUNNING",
          created_at: "2026-08-18T12:00:00.000Z",
        },
        {
          task_id: id(22),
          parent_task_id: id(21),
          depth: 1,
          profile_id: "report-writing-agent",
          profile_revision: 1,
          profile_hash: hash("a"),
          task_revision: 2,
          attempt_id: id(24),
          worker_fence: 1,
          status: "ACCEPTED",
          created_at: "2026-08-18T12:00:01.000Z",
        },
      ],
      handoffs: [
        {
          handoff_id: id(30),
          parent_task_id: id(21),
          child_task_id: id(22),
          parent_expected_revision: 1,
          request_hash: hash("b"),
          created_at: "2026-08-18T12:00:02.000Z",
        },
      ],
      epochs: [
        {
          task_id: id(22),
          epoch_id: id(31),
          epoch_revision: 1,
          phase: "ACTIVATED",
          build_signature: hash("c"),
          obligation_ledger_hash: hash("d"),
          created_at: "2026-08-18T12:00:03.000Z",
        },
      ],
      verifier_decisions: [
        {
          task_id: id(22),
          task_revision: 2,
          decision_id: id(32),
          completion_hash: hash("e"),
          decision_hash: hash("f"),
          created_at: "2026-08-18T12:00:04.000Z",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <WorkspaceI18nProvider initialLocale="en-US">
        <AgentTeamTrace
          trace={trace}
          profiles={[
            {
              schema_version: "agent-product-profile-registry-item@1.0.0",
              revision,
              head: {
                schema_version: "agent-product-profile-head@1.0.0",
                scope,
                profile_id: revision.profile_id,
                active_revision: 1,
                active_revision_hash: revision.revision_hash,
                lifecycle: "ENABLED",
                version: 1,
                updated_at: "2026-08-18T12:00:00.000Z",
              },
            },
          ]}
        />
      </WorkspaceI18nProvider>,
    );
    expect(html).toContain("Report");
    expect(html).toContain("workflow.report");
    expect(html).toContain("2 direct");
    expect(html).toContain("data-agent-orchestrator");
    expect(html).toContain("Tasks");
    expect(html).toContain("Handoffs · 1");
    expect(html).toContain("Context epochs · 1");
    expect(html).toContain("Verifier decisions · 1");
    expect(html).toContain("<details");
    expect(html).not.toMatch(/system prompt|private reasoning|raw context|credential/i);
  });
});
