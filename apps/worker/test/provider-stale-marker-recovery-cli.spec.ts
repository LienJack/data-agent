import { describe, expect, it, vi } from "vitest";
import { runProviderStaleMarkerRecoveryProcess } from "../src/provider-stale-marker-recovery-cli.js";

describe("U3 Provider stale-marker recovery CLI", () => {
  it("checks explicit confirmation before dotenv or database access", async () => {
    const connect = vi.fn();
    const load = vi.fn((environment: NodeJS.ProcessEnv) => environment);
    const report = vi.fn();

    await expect(runProviderStaleMarkerRecoveryProcess({}, connect, report, load)).resolves.toBe(
      "NOT_CONFIRMED",
    );
    expect(load).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("requires the dedicated job-role database URL without falling back to app DATABASE_URL", async () => {
    const connect = vi.fn();
    const report = vi.fn();
    const environment = {
      DATA_AGENT_U3_PROVIDER_RECOVERY_CONFIRM: "YES",
      DATABASE_URL: "postgres://ordinary-app-role",
    };
    const load = vi.fn((received: NodeJS.ProcessEnv) => received);

    await expect(
      runProviderStaleMarkerRecoveryProcess(environment, connect, report, load),
    ).resolves.toBe("CONFIG_INVALID");
    expect(load).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("processes at most one marker and reports an idle result without sensitive fields", async () => {
    const recoverNext = vi.fn(async () => ({ ok: true as const, value: null }));
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({ job: { recoverNext }, close }));
    const report = vi.fn();
    const environment = {
      DATA_AGENT_U3_PROVIDER_RECOVERY_CONFIRM: "YES",
      DATA_AGENT_JOB_DATABASE_URL: "postgres://job-role:redacted@example.invalid/data-agent",
      DATA_AGENT_JOB_DEPLOYMENT_ID: "95000000-0000-4000-8000-000000000001",
      DATA_AGENT_JOB_TENANT_ID: "95000000-0000-4000-8000-000000000002",
      DATA_AGENT_JOB_PRINCIPAL_ID: "95000000-0000-4000-8000-000000000003",
    };

    await expect(
      runProviderStaleMarkerRecoveryProcess(environment, connect, report, (received) => received),
    ).resolves.toBe("IDLE");
    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(environment.DATA_AGENT_JOB_DATABASE_URL, {
      deployment_id: environment.DATA_AGENT_JOB_DEPLOYMENT_ID,
      tenant_id: environment.DATA_AGENT_JOB_TENANT_ID,
      principal_id: environment.DATA_AGENT_JOB_PRINCIPAL_ID,
    });
    expect(recoverNext).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({
      event_name: "provider_stale_marker_recovery",
      status: "IDLE",
    });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/job-role|question|response|secret/i);
  });

  it("closes the job connection when the authority rejects recovery", async () => {
    const recoverNext = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "PROVIDER_STALE_MARKER_LEASE_STILL_ACTIVE",
        message: "redacted",
        retryable: true,
      },
    }));
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({ job: { recoverNext }, close }));

    await expect(
      runProviderStaleMarkerRecoveryProcess(
        {
          DATA_AGENT_U3_PROVIDER_RECOVERY_CONFIRM: "YES",
          DATA_AGENT_JOB_DATABASE_URL: "postgres://job-role",
          DATA_AGENT_JOB_DEPLOYMENT_ID: "95000000-0000-4000-8000-000000000001",
          DATA_AGENT_JOB_TENANT_ID: "95000000-0000-4000-8000-000000000002",
          DATA_AGENT_JOB_PRINCIPAL_ID: "95000000-0000-4000-8000-000000000003",
        },
        connect,
        vi.fn(),
        (received) => received,
      ),
    ).rejects.toThrow("PROVIDER_STALE_MARKER_LEASE_STILL_ACTIVE");
    expect(recoverNext).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
