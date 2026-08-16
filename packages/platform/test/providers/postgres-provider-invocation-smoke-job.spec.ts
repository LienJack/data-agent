import { describe, expect, it, vi } from "vitest";
import type { SqlPool } from "../../src/index.js";
import { createPostgresProviderInvocationSmokeJob } from "../../src/providers/postgres-provider-invocation-smoke-job.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const runId = "91000000-0000-4000-8000-000000000001";
const commandId = "91000000-0000-4000-8000-000000000002";
const attemptId = "91000000-0000-4000-8000-000000000003";

function authority() {
  const registry = createDeploymentRegistry(
    [
      {
        deployment_id: "91000000-0000-4000-8000-000000000008",
        app_id: "91000000-0000-4000-8000-000000000004",
        environment: "test",
      },
    ],
    [
      {
        subject: "91000000-0000-4000-8000-000000000006",
        deployment_id: "91000000-0000-4000-8000-000000000008",
        tenant_id: "91000000-0000-4000-8000-000000000005",
        role: "OWNER",
      },
    ],
  );
  const resolved = registry.resolveForDeployment("91000000-0000-4000-8000-000000000008", {
    subject: "91000000-0000-4000-8000-000000000006",
  });
  if (!resolved.ok) throw new Error("authority fixture failed");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

describe("Postgres Provider invocation smoke job", () => {
  it("rejects malformed targets without opening a job connection", async () => {
    const connect = vi.fn();
    const auth = authority();
    const job = createPostgresProviderInvocationSmokeJob({
      pool: { connect } as SqlPool,
      ...auth,
    });

    await expect(job.claim({ worker_id: "worker" })).resolves.toMatchObject({
      ok: false,
      error: { code: "PROVIDER_INVOCATION_SMOKE_INPUT_INVALID" },
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("accepts only an exact target claim with zero invocation precondition", async () => {
    const value = {
      schema_version: "provider-invocation-smoke-claim@1.0.0",
      lease: {
        scope: {
          app_id: "91000000-0000-4000-8000-000000000004",
          tenant_id: "91000000-0000-4000-8000-000000000005",
          environment: "test",
        },
        principal_id: "91000000-0000-4000-8000-000000000006",
        outbox_id: "91000000-0000-4000-8000-000000000007",
        run_id: runId,
        command_id: commandId,
        command_kind: "START_L2_RESEARCH",
        attempt_id: attemptId,
        attempt_no: 1,
        delivery_attempt_no: 1,
        lease_duration_ms: 30_000,
        worker_id: "worker-u3-smoke",
        lease_token: 1,
        worker_fence: 1,
        expires_at: "2026-08-17T00:00:30.000Z",
        payload: { kind: "START_L2_RESEARCH" },
      },
      precondition: {
        run_id: runId,
        command_id: commandId,
        logical_invocation_id: commandId,
        intent_count: 0,
        permit_count: 0,
        marker_count: 0,
        outcome_count: 0,
        usage_count: 0,
        response_artifact_count: 0,
      },
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("claim_provider_invocation_smoke_work")) {
        return { rows: [{ value }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));
    const auth = authority();
    const job = createPostgresProviderInvocationSmokeJob({
      pool: { connect } as unknown as SqlPool,
      ...auth,
    });

    await expect(
      job.claim({
        worker_id: "worker-u3-smoke",
        lease_duration_ms: 30_000,
        expected_run_id: runId,
        expected_command_id: commandId,
      }),
    ).resolves.toMatchObject({ ok: true, value: { precondition: { intent_count: 0 } } });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("pg_catalog.set_config('data_agent.app_id'"),
      [
        "91000000-0000-4000-8000-000000000004",
        "91000000-0000-4000-8000-000000000005",
        "test",
        "91000000-0000-4000-8000-000000000006",
        "owner",
        "91000000-0000-4000-8000-000000000008",
      ],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("platform.backend_context_matches"),
      [
        "91000000-0000-4000-8000-000000000004",
        "91000000-0000-4000-8000-000000000005",
        "test",
        true,
      ],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("claim_provider_invocation_smoke_work"),
      ["worker-u3-smoke", 30_000, runId, commandId],
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a replay-shaped claim whose precondition already contains an intent", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("claim_provider_invocation_smoke_work")) {
        return {
          rows: [
            {
              value: {
                schema_version: "provider-invocation-smoke-claim@1.0.0",
                lease: {},
                precondition: {
                  run_id: runId,
                  command_id: commandId,
                  logical_invocation_id: commandId,
                  intent_count: 1,
                  permit_count: 1,
                  marker_count: 1,
                  outcome_count: 1,
                  usage_count: 1,
                  response_artifact_count: 1,
                },
              },
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const auth = authority();
    const job = createPostgresProviderInvocationSmokeJob({
      pool: { connect: async () => ({ query, release }) } as unknown as SqlPool,
      ...auth,
    });

    await expect(
      job.claim({
        worker_id: "worker-u3-smoke",
        lease_duration_ms: 30_000,
        expected_run_id: runId,
        expected_command_id: commandId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROVIDER_INVOCATION_SMOKE_PROOF_INVALID" },
    });
    expect(release).toHaveBeenCalledOnce();
  });
});
