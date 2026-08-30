import { runRuntimeEventSchema, sha256ContentHash } from "@data-agent/contracts";
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

function pool(projection: unknown, error?: Error, events: readonly object[] = []) {
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
      if (text.includes("from run_events")) {
        return { rows: events, rowCount: events.length } as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, value: { connect: async () => client } satisfies SqlPool };
}

async function eventRow(overrides: Record<string, unknown> = {}) {
  const event = runRuntimeEventSchema.parse({
    schema_version: "run-runtime-event@2.0.0",
    event_id: id(50),
    scope,
    run_id: ids.run,
    sequence: 3,
    worker_fence: 1,
    idempotency_key: "team-status:completed",
    occurred_at: "2026-08-18T12:00:01.000Z",
    event_type: "run.agent_status",
    payload: {
      profile_id: "data-agent-orchestrator",
      task_id: ids.task,
      status: "COMPLETED",
      phase: "root.delegation.completed",
      title: "Root",
      summary: "Delegation completed.",
      duration_ms: 10,
      error_code: null,
    },
    ...overrides,
  });
  return {
    ...event.scope,
    event_id: event.event_id,
    run_id: event.run_id,
    sequence: event.sequence,
    worker_fence: event.worker_fence,
    dedupe_key: event.idempotency_key,
    event_type: event.event_type,
    payload_json: event.payload,
    event_document: event,
    event_hash: await sha256ContentHash(event),
    created_at: event.occurred_at,
  };
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
        tasks: [
          {
            profile_id: "data-agent-orchestrator",
            status: "PENDING",
            status_source: { kind: "TASK_RECORD" },
          },
        ],
        schema_version: "agent-team-public-trace@3.0.0",
        trace_hash: expect.stringMatching(/^sha256:/),
      },
    });
    expect(
      database.calls.some((text) => text.includes("load_agent_team_public_projection_v2")),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/task_json|prompt|message|tool_args/i);
    expect(database.calls[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ");
  });

  it("retains multiple Root rounds and derives statuses only from verified exact-task events", async () => {
    const value = projection();
    const root = value.tasks[0];
    if (!root) throw new Error("root fixture missing");
    value.tasks.push({ ...root, task_id: id(8), attempt_id: id(9) });
    const row = await eventRow();
    const database = pool(value, undefined, [row]);
    const { capability, authorizer } = authority();
    const result = await createPostgresAgentTeamTraceProjector({
      pool: database.value,
      authorizer,
    }).load(capability, { scope, run_id: ids.run });
    expect(result).toMatchObject({
      ok: true,
      value: {
        tasks: [
          {
            task_id: ids.task,
            status: "COMPLETED",
            completion: null,
            acceptance: null,
            status_source: { kind: "RUN_EVENT", event_id: id(50), event_hash: row.event_hash },
          },
          { task_id: id(8), status: "PENDING", status_source: { kind: "TASK_RECORD" } },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("Delegation completed.");
  });

  it.each(["hash", "profile", "fence", "run", "scope"])(
    "fails closed on %s mismatch",
    async (kind) => {
      const overrides =
        kind === "fence"
          ? { worker_fence: 2 }
          : kind === "run"
            ? { run_id: id(99) }
            : kind === "scope"
              ? { scope: { ...scope, tenant_id: id(99) } }
              : {};
      const row = await eventRow(overrides);
      if (kind === "hash") row.event_hash = `sha256:${"0".repeat(64)}`;
      if (kind === "profile" && row.event_document.event_type === "run.agent_status") {
        row.event_document.payload.profile_id = "governed-analysis-agent";
        row.event_hash = await sha256ContentHash(row.event_document);
      }
      const database = pool(projection(), undefined, [row]);
      const { capability, authorizer } = authority();
      const result = await createPostgresAgentTeamTraceProjector({
        pool: database.value,
        authorizer,
      }).load(capability, { scope, run_id: ids.run });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code:
            kind === "hash"
              ? "RUN_EVENT_STORE_EVENT_CORRUPT"
              : "AGENT_TEAM_TRACE_EVENT_IDENTITY_MISMATCH",
        },
      });
      expect(database.calls.at(-1)).toBe("ROLLBACK");
    },
  );

  it("does not load events when the Run is absent or denied", async () => {
    const database = pool(null);
    const { capability, authorizer } = authority();
    expect(
      await createPostgresAgentTeamTraceProjector({ pool: database.value, authorizer }).load(
        capability,
        { scope, run_id: ids.run },
      ),
    ).toEqual({ ok: true, value: null });
    expect(database.calls.some((call) => call.includes("from run_events"))).toBe(false);
  });

  it("uses committed sequence, not Worker versus database wall-clock ordering", async () => {
    const pending = await eventRow({
      sequence: 2,
      event_id: id(51),
      occurred_at: "2026-08-18T11:59:59.800Z",
    });
    const completed = await eventRow({ occurred_at: "2026-08-18T11:59:59.900Z" });
    const database = pool(projection(), undefined, [pending, completed]);
    const { capability, authorizer } = authority();
    expect(
      await createPostgresAgentTeamTraceProjector({ pool: database.value, authorizer }).load(
        capability,
        { scope, run_id: ids.run },
      ),
    ).toMatchObject({
      ok: true,
      value: {
        tasks: [{ status: "COMPLETED", status_source: { sequence: 3 } }],
      },
    });
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
