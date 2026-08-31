import {
  authorizeCommittedProviderDispatchPermit,
  buildCommittedProviderDispatchPermitReceipt,
} from "@data-agent/contracts";
import type { AppCapability, PostgresProviderInvocationStore } from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";
import { createPostgresAuditedProviderInvocationAdapter } from "../../src/providers/postgres-audited-provider-invocation-store.js";

const ids = {
  app: "85000000-0000-4000-8000-000000000001",
  workspace: "85000000-0000-4000-8000-000000000002",
  principal: "85000000-0000-4000-8000-000000000003",
  run: "85000000-0000-4000-8000-000000000004",
  invocation: "85000000-0000-4000-8000-000000000005",
  intent: "85000000-0000-4000-8000-000000000006",
  permit: "85000000-0000-4000-8000-000000000007",
  permit2: "85000000-0000-4000-8000-000000000012",
  context: "85000000-0000-4000-8000-000000000008",
  attempt: "85000000-0000-4000-8000-000000000009",
  attempt2: "85000000-0000-4000-8000-000000000013",
  outbox: "85000000-0000-4000-8000-000000000010",
  command: "85000000-0000-4000-8000-000000000011",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const scope = {
  app_id: ids.app,
  tenant_id: ids.workspace,
  environment: "test",
  workspace_id: ids.workspace,
  principal_id: ids.principal,
} as const;

async function permit(
  input: {
    readonly permit_id?: string;
    readonly attempt_id?: string;
    readonly attempt_no?: number;
    readonly lease_token?: number;
    readonly worker_fence?: number;
  } = {},
) {
  const attemptId = input.attempt_id ?? ids.attempt;
  const workerFence = input.worker_fence ?? 3;
  const receipt = await buildCommittedProviderDispatchPermitReceipt({
    schema_version: "provider-dispatch-permit@1.0.0",
    permit_id: input.permit_id ?? ids.permit,
    intent_id: ids.intent,
    invocation_id: ids.invocation,
    scope,
    run_id: ids.run,
    dispatch_hash: hash("a"),
    context_receipt_ref: { receipt_id: ids.context, receipt_hash: hash("b") },
    lease: {
      outbox_id: ids.outbox,
      command_id: ids.command,
      attempt_id: attemptId,
      attempt_no: input.attempt_no ?? 1,
      worker_id: "worker-u3",
      lease_token: input.lease_token ?? 2,
      worker_fence: workerFence,
    },
    attempt_id: attemptId,
    worker_fence: workerFence,
    committed_at: "2026-08-16T00:00:00.000Z",
  });
  return authorizeCommittedProviderDispatchPermit(
    {
      scope,
      run_id: ids.run,
      invocation_id: ids.invocation,
      dispatch_hash: hash("a"),
    },
    { resolve_committed: async () => receipt },
  );
}

describe("Postgres audited provider invocation adapter", () => {
  it("commits a known response rejection with one call, no accepted response, and no recovery action", async () => {
    const commitTerminal = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        error: { code: "STORAGE_SENTINEL", message: "test", retryable: false },
      });
    const adapter = createPostgresAuditedProviderInvocationAdapter({
      store: { commitTerminal } as unknown as PostgresProviderInvocationStore,
      capability: {} as AppCapability,
    });
    const result = await adapter.invocation_store.commitTerminal({
      worker_lease: {} as never,
      permit: await permit(),
      terminal: {
        kind: "FAILED",
        reason_code: "PROVIDER_PROTOCOL_VIOLATION",
        retryable: false,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "STORAGE_SENTINEL" } });
    expect(commitTerminal).toHaveBeenCalledOnce();
    expect(commitTerminal.mock.calls[0]?.[2]).toMatchObject({
      schema_version: "provider-invocation-commit-terminal@1.0.0",
      outcome: {
        status: "FAILED",
        reason_code: "PROVIDER_PROTOCOL_VIOLATION",
        response_artifact_ref: null,
        response_hash: null,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
        transition_from: "RESPONSE_OBSERVED",
        recovery_action: "NONE",
        provider_call_count: 1,
        retry_after_ms: null,
        reconciliation_of: null,
      },
      usage: { provider_call_count: 1, input_tokens: null, output_tokens: null },
    });
  });

  it("forwards the raw-free response observation before any terminal transition", async () => {
    const markResponseObserved = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const adapter = createPostgresAuditedProviderInvocationAdapter({
      store: { markResponseObserved } as unknown as PostgresProviderInvocationStore,
      capability: {} as AppCapability,
    });
    const committedPermit = await permit();

    await adapter.invocation_store.markResponseObserved({
      worker_lease: {} as never,
      permit: committedPermit,
      observation_kind: "COMPLETED",
      response_hash: hash("c"),
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
    });

    expect(markResponseObserved).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      schema_version: "provider-invocation-mark-response-observed@1.0.0",
      intent_id: ids.intent,
      invocation_id: ids.invocation,
      scope,
      run_id: ids.run,
      dispatch_hash: hash("a"),
      attempt_id: ids.attempt,
      worker_fence: 3,
      observation_kind: "COMPLETED",
      response_hash: hash("c"),
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
    });
  });

  it("loads the exact current permit so a fresh takeover does not inherit an older marker", async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: null });
    const adapter = createPostgresAuditedProviderInvocationAdapter({
      store: { load } as unknown as PostgresProviderInvocationStore,
      capability: {} as AppCapability,
    });
    const oldPermit = await permit();
    const currentPermit = await permit({
      permit_id: ids.permit2,
      attempt_id: ids.attempt2,
      attempt_no: 2,
      lease_token: 3,
      worker_fence: 4,
    });

    await expect(adapter.invocation_store.load({ permit: oldPermit })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(adapter.invocation_store.load({ permit: currentPermit })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(load).toHaveBeenLastCalledWith(expect.anything(), {
      schema_version: "provider-invocation-load@1.0.0",
      scope,
      run_id: ids.run,
      invocation_id: ids.invocation,
      permit_id: ids.permit2,
      permit_hash: currentPermit.permit_hash,
      dispatch_hash: hash("a"),
      attempt_id: ids.attempt2,
      worker_fence: 4,
    });
  });

  it("fails closed instead of inventing retry_after_ms for THROTTLED", async () => {
    const commitTerminal = vi.fn();
    const adapter = createPostgresAuditedProviderInvocationAdapter({
      store: { commitTerminal } as unknown as PostgresProviderInvocationStore,
      capability: {} as AppCapability,
    });

    const result = await adapter.invocation_store.commitTerminal({
      worker_lease: {} as never,
      permit: await permit(),
      terminal: {
        kind: "THROTTLED",
        reason_code: "MODEL_PROVIDER_THROTTLED",
        retryable: true,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_PROTOCOL_VIOLATION", retryable: false },
    });
    expect(commitTerminal).not.toHaveBeenCalled();
  });
});
