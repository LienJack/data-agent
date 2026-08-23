import { describe, expect, it } from "vitest";
import { createPostgresAgentTeamTraceProjector } from "../../src/agents/postgres-agent-team-trace.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const ids = { principal: id(3), deployment: id(4), run: id(5), task: id(6), attempt: id(7) };

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: scope.app_id, environment: scope.environment }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: scope.tenant_id,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("authority fixture failed");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function pool(projection: unknown, error?: Error) {
  const calls: string[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string) {
      calls.push(text);
      if (text.includes("load_agent_team_public_projection")) {
        if (error) throw error;
        return { rows: [{ value: projection }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, value: { connect: async () => client } satisfies SqlPool };
}

function projection() {
  const outputRef = {
    artifact_id: id(30),
    artifact_type: "AnalysisReport",
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: `sha256:${"3".repeat(64)}`,
  };
  return {
    tasks: [
      {
        task_id: ids.task,
        parent_task_id: null,
        depth: 0,
        profile_id: "data-agent-orchestrator",
        profile_revision: 1,
        profile_hash: `sha256:${"1".repeat(64)}`,
        task_revision: 1,
        attempt_id: ids.attempt,
        worker_fence: 1,
        status: "RUNNING",
        created_at: "2026-08-18T12:00:00.000Z",
        goal_revision: 3,
        bounds: {
          max_context_bytes: 32_768,
          max_input_tokens: 8_000,
          max_output_tokens: 2_000,
          max_tool_calls: 12,
          timeout_ms: 120_000,
        },
        required_artifact_types: ["AnalysisReport"],
        artifact_refs: [outputRef],
        context_epoch_ref: null,
        completion: null,
        acceptance: null,
      },
    ],
    handoffs: [],
    epochs: [],
    verifier_decisions: [],
  };
}

describe("PostgreSQL Agent Team trace projector", () => {
  it("projects the U19 narrow RPC result under current authority", async () => {
    const database = pool(projection());
    const { capability, authorizer } = authority();
    const result = await createPostgresAgentTeamTraceProjector({
      pool: database.value,
      authorizer,
    }).load(capability, { scope, run_id: ids.run });
    expect(result).toMatchObject({
      ok: true,
      value: {
        run_id: ids.run,
        tasks: [{ profile_id: "data-agent-orchestrator", status: "RUNNING" }],
        schema_version: "agent-team-public-trace@2.0.0",
        trace_hash: expect.stringMatching(/^sha256:/),
      },
    });
    expect(
      database.calls.some((text) => text.includes("load_agent_team_public_projection_v2")),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/task_json|prompt|message|tool_args/i);
  });

  it("maps an authority hash failure without exposing database details", async () => {
    const database = pool(null, new Error("AGENT_TEAM_TRACE_CORRUPT"));
    const { capability, authorizer } = authority();
    const result = await createPostgresAgentTeamTraceProjector({
      pool: database.value,
      authorizer,
    }).load(capability, { scope, run_id: ids.run });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_TEAM_TRACE_CORRUPT" },
    });
  });
});
