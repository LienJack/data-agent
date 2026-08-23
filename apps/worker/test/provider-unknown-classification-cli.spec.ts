import { describe, expect, it, vi } from "vitest";
import {
  providerUnknownClassificationExitCode,
  runProviderUnknownClassificationProcess,
} from "../src/provider-unknown-classification-cli.js";

describe("U3 Provider unknown classification CLI", () => {
  it("requires explicit confirmation before environment or job database access", async () => {
    const load = vi.fn();
    const connect = vi.fn();
    await expect(runProviderUnknownClassificationProcess({}, connect, vi.fn(), load)).resolves.toBe(
      "NOT_CONFIRMED",
    );
    expect(load).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("classifies AT_LEAST_ONCE_ONLY unknown as nonzero manual review without Provider I/O", async () => {
    const classification = {
      schema_version: "provider-invocation-unknown-classification@1.0.0",
      invocation_id: "93000000-0000-4000-8000-000000000001",
      intent_id: "93000000-0000-4000-8000-000000000002",
      intent_hash: `sha256:${"1".repeat(64)}`,
      permit_id: "93000000-0000-4000-8000-000000000003",
      permit_hash: `sha256:${"2".repeat(64)}`,
      outcome_id: "93000000-0000-4000-8000-000000000004",
      outcome_hash: `sha256:${"3".repeat(64)}`,
      recovery_capability_used: "AT_LEAST_ONCE_ONLY",
      recovery_action: "MANUAL_REVIEW_REQUIRED",
      required_action: "MANUAL_REVIEW_REQUIRED",
    };
    const discoverNextUnknown = vi.fn(async () => ({
      ok: true as const,
      value: classification,
    }));
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({
      job: { discoverNextUnknown },
      close,
    }));
    const report = vi.fn();

    const result = await runProviderUnknownClassificationProcess(
      {
        DATA_AGENT_U3_PROVIDER_UNKNOWN_CONFIRM: "YES",
        DATA_AGENT_JOB_DATABASE_URL: "postgres://job-role",
        DATA_AGENT_JOB_DEPLOYMENT_ID: "95000000-0000-4000-8000-000000000001",
        DATA_AGENT_JOB_TENANT_ID: "95000000-0000-4000-8000-000000000002",
        DATA_AGENT_JOB_PRINCIPAL_ID: "95000000-0000-4000-8000-000000000003",
      },
      connect as never,
      report,
      (received) => received,
    );

    expect(result).toBe("MANUAL_REVIEW_REQUIRED");
    expect(providerUnknownClassificationExitCode(result)).toBe(3);
    expect(discoverNextUnknown).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith("postgres://job-role", {
      deployment_id: "95000000-0000-4000-8000-000000000001",
      tenant_id: "95000000-0000-4000-8000-000000000002",
      principal_id: "95000000-0000-4000-8000-000000000003",
    });
    expect(close).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "MANUAL_REVIEW_REQUIRED",
        invocation_id: classification.invocation_id,
      }),
    );
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/question|response|secret/i);
  });
});
