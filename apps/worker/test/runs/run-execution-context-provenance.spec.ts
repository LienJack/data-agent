import { DEFAULT_RUN_EXECUTION_POLICY, type RunWorkLease } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createResearchWorkflowExecutor } from "../../src/runs/research-workflow-executor.js";
import type { RunExecutionContext } from "../../src/runs/run-worker-runner.js";

const principalId = "a0000000-0000-4000-8000-000000000001";
const lease = {
  scope: {
    app_id: "a0000000-0000-4000-8000-000000000002",
    tenant_id: "a0000000-0000-4000-8000-000000000003",
    environment: "test",
  },
  principal_id: principalId,
  outbox_id: "a0000000-0000-4000-8000-000000000004",
  run_id: "a0000000-0000-4000-8000-000000000005",
  command_id: "a0000000-0000-4000-8000-000000000006",
  command_kind: "START_L2_RESEARCH",
  attempt_id: "a0000000-0000-4000-8000-000000000007",
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 30_000,
  worker_id: "worker-1",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-16T10:05:00.000Z",
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
  payload: {
    kind: "START_L2_RESEARCH",
    effective_config_ref: {
      config_id: "a0000000-0000-4000-8000-000000000008",
      config_revision: 1,
      config_hash: `sha256:${"1".repeat(64)}`,
    },
  },
} as const satisfies RunWorkLease;

describe("RunExecutionContext provenance", () => {
  it("rejects a structurally forged context before any workflow/tool work", async () => {
    const forgedContext = {
      getEffectiveConfig: () => ({ config_id: "forged" }),
      getContextReceipt: () => ({ receipt_id: "forged" }),
      heartbeat: async () => ({ ok: true, value: { expires_at: lease.expires_at } }),
      checkpoint: async () => ({
        ok: false,
        error: { code: "FORGED", message: "forged", retryable: false },
      }),
      executeSideEffectOnce: async () => ({
        ok: false,
        error: { code: "FORGED", message: "forged", retryable: false },
      }),
      emitDisplayEvent: async () => ({ ok: true, value: { sequence: 1 } }),
    } as unknown as RunExecutionContext;
    const executor = createResearchWorkflowExecutor({
      research_authority: {} as never,
      authority_capabilities: {
        forArtifactType: () => ({
          app_capability: {},
          authority_capability_id: "a0000000-0000-4000-8000-000000000009",
        }),
        forDomain: () => ({
          app_capability: {},
          authority_capability_id: "a0000000-0000-4000-8000-000000000009",
        }),
      },
      principal_id: principalId,
      create_id: () => "a0000000-0000-4000-8000-00000000000a",
      now: () => new Date("2026-08-16T10:01:00.000Z"),
    });

    const result = await executor.execute({
      lease,
      restored_snapshot: null,
      context: forgedContext,
      signal: new AbortController().signal,
      deadline_at: "2026-08-16T10:05:00.000Z",
    });

    expect(result).toEqual({ kind: "FAILED", error_code: "RUN_EXECUTION_CONTEXT_UNTRUSTED" });
  });
});
