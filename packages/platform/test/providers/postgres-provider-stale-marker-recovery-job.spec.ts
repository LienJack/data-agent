import { describe, expect, it, vi } from "vitest";
import type { SqlPool } from "../../src/index.js";
import { createPostgresProviderStaleMarkerRecoveryJob } from "../../src/providers/postgres-provider-stale-marker-recovery-job.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

function authority() {
  const registry = createDeploymentRegistry(
    [
      {
        deployment_id: "94000000-0000-4000-8000-000000000001",
        app_id: "94000000-0000-4000-8000-000000000002",
        environment: "test",
      },
    ],
    [
      {
        subject: "94000000-0000-4000-8000-000000000003",
        deployment_id: "94000000-0000-4000-8000-000000000001",
        tenant_id: "94000000-0000-4000-8000-000000000004",
        role: "OWNER",
      },
    ],
  );
  const resolved = registry.resolveForDeployment("94000000-0000-4000-8000-000000000001", {
    subject: "94000000-0000-4000-8000-000000000003",
  });
  if (!resolved.ok) throw new Error("authority fixture failed");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

describe("Postgres Provider stale-marker recovery job", () => {
  it("rejects malformed commands without opening a database connection", async () => {
    const connect = vi.fn();
    const job = createPostgresProviderStaleMarkerRecoveryJob({
      pool: { connect } as SqlPool,
      ...authority(),
    });

    await expect(job.recover({ actor: "WORKER" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PROVIDER_STALE_MARKER_RECOVERY_COMMAND_INVALID",
        retryable: false,
      },
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("returns null when the job-only authority has no eligible stale marker", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("recover_next_stale_provider_invocation_marker")) {
        return { rows: [{ value: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));
    const job = createPostgresProviderStaleMarkerRecoveryJob({
      pool: { connect } as unknown as SqlPool,
      ...authority(),
    });

    await expect(job.recoverNext()).resolves.toEqual({ ok: true, value: null });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("pg_catalog.set_config('data_agent.app_id'"),
      [
        "94000000-0000-4000-8000-000000000002",
        "94000000-0000-4000-8000-000000000004",
        "test",
        "94000000-0000-4000-8000-000000000003",
        "owner",
        "94000000-0000-4000-8000-000000000001",
      ],
    );
    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith(
      "select app_data_agent.recover_next_stale_provider_invocation_marker() as value",
    );
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns null when no existing OUTCOME_UNKNOWN requires operator classification", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("discover_next_provider_invocation_unknown")) {
        return { rows: [{ value: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const job = createPostgresProviderStaleMarkerRecoveryJob({
      pool: {
        connect: async () => ({ query, release }),
      } as unknown as SqlPool,
      ...authority(),
    });

    await expect(job.discoverNextUnknown()).resolves.toEqual({ ok: true, value: null });
    expect(query).toHaveBeenCalledWith(
      "select app_data_agent.discover_next_provider_invocation_unknown() as value",
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
