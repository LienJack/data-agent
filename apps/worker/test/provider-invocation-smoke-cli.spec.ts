import { describe, expect, it, vi } from "vitest";
import { runProviderInvocationSmokeProcess } from "../src/provider-invocation-smoke-cli.js";
import {
  requireCompletedProviderSmokeCycle,
  runWorkerProcess,
  targetProviderSmokeQueue,
} from "../src/run-worker-cli.js";

describe("U3 Provider invocation one-shot CLI", () => {
  it("has no import-time execution and rejects missing confirmation before env/DB delegation", async () => {
    const run = vi.fn(async () => undefined);
    const load = vi.fn((environment: NodeJS.ProcessEnv) => environment);

    await expect(runProviderInvocationSmokeProcess({}, run, load)).resolves.toBe("NOT_CONFIRMED");
    expect(load).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["/repo", "/repo/apps/worker"])(
    "loads confirmed root environment once and delegates one-shot from %s",
    async (cwd) => {
      const run = vi.fn(async () => undefined);
      const environment = {
        DATA_AGENT_U3_PROVIDER_SMOKE_CONFIRM: "YES",
        DATA_AGENT_U3_PROVIDER_SMOKE_RUN_ID: "90000000-0000-4000-8000-000000000001",
        DATA_AGENT_U3_PROVIDER_SMOKE_COMMAND_ID: "90000000-0000-4000-8000-000000000002",
      };
      const load = vi.fn((received: NodeJS.ProcessEnv, receivedCwd?: string) => ({
        ...received,
        DEEPSEEK_API_KEY: `resolved-for-${receivedCwd?.length ?? 0}`,
      }));

      await expect(runProviderInvocationSmokeProcess(environment, run, load, cwd)).resolves.toBe(
        "COMPLETED",
      );
      expect(load).toHaveBeenCalledOnce();
      expect(load).toHaveBeenCalledWith(environment, cwd);
      expect(run).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ DATA_AGENT_U3_PROVIDER_SMOKE_ONE_SHOT: "YES" }),
      );
    },
  );

  it("rejects a missing target before root env or database delegation", async () => {
    const run = vi.fn(async () => undefined);
    const load = vi.fn((environment: NodeJS.ProcessEnv) => environment);

    await expect(
      runProviderInvocationSmokeProcess({ DATA_AGENT_U3_PROVIDER_SMOKE_CONFIRM: "YES" }, run, load),
    ).resolves.toBe("TARGET_INVALID");
    expect(load).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects direct one-shot Worker execution without confirmation before config or DB", async () => {
    await expect(
      runWorkerProcess({ DATA_AGENT_U3_PROVIDER_SMOKE_ONE_SHOT: "YES" }),
    ).rejects.toThrow("EXPLICIT_CONFIRMATION_REQUIRED");
  });

  it.each([
    { ok: true, value: { kind: "IDLE" } },
    { ok: true, value: { kind: "FAILED" } },
    { ok: true, value: { kind: "RETRY_SCHEDULED" } },
    { ok: true, value: { kind: "SUSPENDED" } },
    { ok: false, error: { code: "QUEUE_FAILED" } },
  ])("rejects a one-shot result that did not complete a Provider-backed Run", (result) => {
    expect(() => requireCompletedProviderSmokeCycle(result)).toThrow(
      "PROVIDER_INVOCATION_SMOKE_NOT_COMPLETED",
    );
    expect(() => requireCompletedProviderSmokeCycle(result)).not.toThrow(
      /secret|question|response/i,
    );
  });

  it("accepts only a completed one-shot cycle", () => {
    expect(() =>
      requireCompletedProviderSmokeCycle({ ok: true, value: { kind: "COMPLETED" } }),
    ).not.toThrow();
  });

  it("uses the target-only Authority instead of the ordinary FIFO queue and claims at most once", async () => {
    const queue = {
      lease: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      retry: vi.fn(),
    };
    const lease = {
      run_id: "90000000-0000-4000-8000-000000000003",
      command_id: "90000000-0000-4000-8000-000000000004",
    };
    const claimTarget = vi.fn(async () => ({
      ok: true as const,
      value: { lease },
    }));
    const targeted = targetProviderSmokeQueue(queue as never, claimTarget as never);

    await expect(targeted.lease({} as never)).resolves.toEqual({ ok: true, value: lease });
    await expect(targeted.lease({} as never)).resolves.toEqual({ ok: true, value: null });
    expect(queue.lease).not.toHaveBeenCalled();
    expect(claimTarget).toHaveBeenCalledOnce();
    expect(queue.heartbeat).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
    expect(queue.retry).not.toHaveBeenCalled();
  });
});
