import { describe, expect, it, vi } from "vitest";
import {
  createMultiPrincipalRunWorkerRunner,
  isRunnableWorkspaceMember,
} from "../../src/runs/multi-principal-runner.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-00000000aa11",
  environment: "local",
} as const;

describe("multi-principal run worker", () => {
  it("polls each active user under a principal-specific runner", async () => {
    const observed: string[] = [];
    const createRunner = vi.fn(async (principalId: string) => ({
      ok: true as const,
      value: {
        async runOnce() {
          observed.push(principalId);
          return { ok: true as const, value: { kind: "IDLE" as const } };
        },
      },
    }));
    const runner = createMultiPrincipalRunWorkerRunner({
      listPrincipals: async () => ({
        ok: true,
        value: [{ principal_id: "principal-a" }, { principal_id: "principal-b" }],
      }),
      createRunner,
    });
    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toEqual({
      ok: true,
      value: { kind: "IDLE" },
    });
    expect(observed).toEqual(["principal-a", "principal-b"]);
    expect(createRunner).toHaveBeenCalledTimes(2);
  });

  it("stops after the first claimed user run and never executes it as another principal", async () => {
    const observed: string[] = [];
    const runner = createMultiPrincipalRunWorkerRunner({
      listPrincipals: async () => ({
        ok: true,
        value: [{ principal_id: "principal-a" }, { principal_id: "principal-b" }],
      }),
      createRunner: async (principalId) => ({
        ok: true,
        value: {
          async runOnce() {
            observed.push(principalId);
            return {
              ok: true,
              value:
                principalId === "principal-a"
                  ? { kind: "COMPLETED" as const, run_id: "run-a", final_event_sequence: 2 }
                  : { kind: "IDLE" as const },
            };
          },
        },
      }),
    });
    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", run_id: "run-a" },
    });
    expect(observed).toEqual(["principal-a"]);
  });

  it("skips a principal-specific authority denial and continues to runnable principals", async () => {
    const observed: string[] = [];
    const runner = createMultiPrincipalRunWorkerRunner({
      listPrincipals: async () => ({
        ok: true,
        value: [{ principal_id: "principal-a" }, { principal_id: "principal-b" }],
      }),
      createRunner: async (principalId) => {
        if (principalId === "principal-a") {
          return {
            ok: false,
            error: {
              code: "APP_SCOPE_FORBIDDEN",
              message: "membership raced with listing",
              retryable: false,
            },
          };
        }
        return {
          ok: true,
          value: {
            async runOnce() {
              observed.push(principalId);
              return {
                ok: true as const,
                value: { kind: "COMPLETED" as const, run_id: "run-b", final_event_sequence: 2 },
              };
            },
          },
        };
      },
    });

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", run_id: "run-b" },
    });
    expect(observed).toEqual(["principal-b"]);
  });

  it("skips a role downgrade raced after membership listing", async () => {
    const observed: string[] = [];
    const runner = createMultiPrincipalRunWorkerRunner({
      listPrincipals: async () => ({
        ok: true,
        value: [{ principal_id: "principal-a" }, { principal_id: "principal-b" }],
      }),
      createRunner: async (principalId) =>
        principalId === "principal-a"
          ? {
              ok: false,
              error: {
                code: "WORKSPACE_ROLE_DENIED",
                message: "role changed after listing",
                retryable: false,
              },
            }
          : {
              ok: true,
              value: {
                async runOnce() {
                  observed.push(principalId);
                  return { ok: true as const, value: { kind: "IDLE" as const } };
                },
              },
            },
    });

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toEqual({
      ok: true,
      value: { kind: "IDLE" },
    });
    expect(observed).toEqual(["principal-b"]);
  });

  it("advances the cursor after non-IDLE work so a busy principal cannot starve the next", async () => {
    const observed: string[] = [];
    const runner = createMultiPrincipalRunWorkerRunner({
      listPrincipals: async () => ({
        ok: true,
        value: [{ principal_id: "principal-a" }, { principal_id: "principal-b" }],
      }),
      createRunner: async (principalId) => ({
        ok: true,
        value: {
          async runOnce() {
            observed.push(principalId);
            return {
              ok: true as const,
              value: {
                kind: "COMPLETED" as const,
                run_id: `run-${principalId}`,
                final_event_sequence: 2,
              },
            };
          },
        },
      }),
    });

    await runner.runOnce({ scope, worker_id: "worker-1" });
    await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(observed).toEqual(["principal-a", "principal-b"]);
  });

  it("classifies only active WORKSPACE_ADMIN/ANALYST members as CLI-runnable principals", () => {
    expect(
      [
        { role: "WORKSPACE_ADMIN", user_status: "ACTIVE", revoked_at: null },
        { role: "ANALYST", user_status: "ACTIVE", revoked_at: null },
        { role: "VIEWER", user_status: "ACTIVE", revoked_at: null },
        { role: "WORKSPACE_ADMIN", user_status: "DISABLED", revoked_at: null },
        { role: "ANALYST", user_status: "ACTIVE", revoked_at: "2026-08-16T00:00:00.000Z" },
      ].map(isRunnableWorkspaceMember),
    ).toEqual([true, true, false, false, false]);
  });
});
