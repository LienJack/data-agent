import {
  authorizeCommittedProviderDispatchPermit,
  buildCommittedProviderDispatchPermitReceipt,
  buildProviderDispatchEnvelopeCandidate,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ProviderDispatchEnvelope,
  type ProviderInvocationPublicProjection,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createAuditedModelProvider } from "../../src/providers/audited-model-provider.js";

const ids = {
  app: "82000000-0000-4000-8000-000000000001",
  workspace: "82000000-0000-4000-8000-000000000002",
  principal: "82000000-0000-4000-8000-000000000003",
  run: "82000000-0000-4000-8000-000000000004",
  invocation: "82000000-0000-4000-8000-000000000005",
  logicalCall: "82000000-0000-4000-8000-000000000006",
  task: "82000000-0000-4000-8000-000000000007",
  config: "82000000-0000-4000-8000-000000000008",
  context: "82000000-0000-4000-8000-000000000009",
  outbox: "82000000-0000-4000-8000-000000000010",
  command: "82000000-0000-4000-8000-000000000011",
  attempt: "82000000-0000-4000-8000-000000000012",
  profile: "82000000-0000-4000-8000-000000000013",
  certification: "82000000-0000-4000-8000-000000000014",
  certificationRun: "82000000-0000-4000-8000-000000000021",
  deployment: "82000000-0000-4000-8000-000000000015",
  intent: "82000000-0000-4000-8000-000000000016",
  permit: "82000000-0000-4000-8000-000000000017",
  response: "82000000-0000-4000-8000-000000000020",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const scope = {
  app_id: ids.app,
  tenant_id: ids.workspace,
  environment: "test",
  workspace_id: ids.workspace,
  principal_id: ids.principal,
} as const;

async function envelope() {
  return buildProviderDispatchEnvelopeCandidate({
    schema_version: "provider-dispatch-envelope@1.0.0",
    invocation_id: ids.invocation,
    idempotency_key: "provider-invocation-0001",
    scope,
    run_id: ids.run,
    logical_call_id: ids.invocation,
    task_ref: {
      artifact_id: ids.task,
      artifact_type: "ResearchBrief",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hash("a"),
    },
    effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: hash("b") },
    context_receipt_ref: { receipt_id: ids.context, receipt_hash: hash("c") },
    lease: {
      outbox_id: ids.outbox,
      command_id: ids.command,
      attempt_id: ids.attempt,
      attempt_no: 1,
      worker_id: "worker-u3",
      lease_token: 3,
      worker_fence: 4,
    },
    model_profile: {
      profile_id: ids.profile,
      model_config_version: 7,
      resource_hash: hash("d"),
      profile_version: "model-profile@7",
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      adapter_version: "model-provider-adapter@1.0.0",
    },
    certification: {
      receipt_ref: {
        artifact_id: ids.certification,
        artifact_type: "ModelCertificationReceipt",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.certificationRun,
        revision: 1,
        content_hash: hash("e"),
      },
      execution_profile_hash: hash("f"),
      recovery_capabilities: ["INVOCATION_RECONCILIATION"],
      certified_context_window: {
        verification_status: "VERIFIED",
        max_context_tokens: 16_000,
        max_output_tokens: 4_000,
      },
    },
    connection: {
      kind: "SYSTEM_DEPLOYMENT",
      deployment_id: ids.deployment,
      deployment_revision: 3,
      deployment_hash: hash("1"),
    },
    request_policy: {
      response_schema_version: "text2sql-answer@1.0.0",
      tool_allowlist: [],
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 8_000,
        max_output_tokens: 2_000,
        max_tool_calls: 0,
        provider_call_limit: 1,
      },
    },
    projection: {
      projection_version: "agent-data-projection@2.0.0",
      receipt_ref: {
        artifact_id: ids.invocation,
        artifact_type: "AgentDataProjectionReceipt",
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        run_id: ids.run,
        revision: 1,
        content_hash: hash("4"),
      },
      payload_hash: hash("2"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 321,
      reserved_output_tokens: 2_000,
      effective_context_ceiling_tokens: 16_000,
      effective_output_ceiling_tokens: 4_000,
      capacity_status: "WITHIN_LIMIT",
      taint_hash: hash("3"),
    },
  });
}

function workerLease() {
  return {
    scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
    principal_id: ids.principal,
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    command_kind: "START_L2_RESEARCH",
    attempt_id: ids.attempt,
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-u3",
    lease_token: 3,
    worker_fence: 4,
    expires_at: "2026-08-16T00:05:00.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: {
      kind: "START_L2_RESEARCH",
      effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: hash("b") },
    },
  } as const;
}

async function committed(dispatchEnvelope: ProviderDispatchEnvelope) {
  const persisted = await buildCommittedProviderDispatchPermitReceipt({
    schema_version: "provider-dispatch-permit@1.0.0",
    permit_id: ids.permit,
    intent_id: ids.intent,
    invocation_id: ids.invocation,
    scope,
    run_id: ids.run,
    dispatch_hash: dispatchEnvelope.dispatch_hash,
    context_receipt_ref: dispatchEnvelope.context_receipt_ref,
    lease: dispatchEnvelope.lease,
    attempt_id: ids.attempt,
    worker_fence: 4,
    committed_at: "2026-08-16T00:00:00.000Z",
  });
  const permit = await authorizeCommittedProviderDispatchPermit(
    {
      scope,
      run_id: ids.run,
      invocation_id: ids.invocation,
      dispatch_hash: dispatchEnvelope.dispatch_hash,
    },
    { resolve_committed: async () => persisted },
  );
  return { admission: "READY" as const, permit, replayed: false };
}

const publicProjection = {
  schema_version: "provider-invocation-public@1.0.0",
  invocation_id: ids.invocation,
  run_id: ids.run,
  provider: "deepseek",
  model_profile_id: ids.profile,
  model_config_version: 7,
  profile_version: "model-profile@7",
  model_id: "deepseek-v4-flash",
  certification_receipt_ref: {
    artifact_id: ids.certification,
    artifact_type: "ModelCertificationReceipt",
    app_id: ids.app,
    tenant_id: ids.workspace,
    environment: "test",
    run_id: ids.certificationRun,
    revision: 1,
    content_hash: hash("e"),
  },
  attempt_id: ids.attempt,
  attempt_no: 1,
  recovery_action: "NONE",
  status: "COMPLETED",
  reason_code: null,
  dispatch_hash: hash("6"),
  response_hash: hash("9"),
  usage_availability: "AVAILABLE",
  usage_source: "PROVIDER_REPORTED",
  input_tokens: 3,
  output_tokens: 2,
  total_tokens: 5,
  tool_calls: 0,
  provider_call_count: 1,
  retry_after_ms: null,
  latency_ms: 100,
  receipt_deep_link: `/w/${ids.workspace}/runs/${ids.run}/provider-invocations/${ids.invocation}`,
  terminal_at: "2026-08-16T00:00:01.000Z",
} as const satisfies ProviderInvocationPublicProjection;

const projectionReceipts = {
  commit: vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => ({
    ok: true as const,
    value: {
      reference: input.envelope.projection.receipt_ref,
      resolver: { resolve_committed: vi.fn(async () => null) },
    },
  })),
};

const responseObservedMarker = () => vi.fn(async () => ({ ok: true as const, value: {} }));

describe("AuditedModelProvider", () => {
  it("does not commit projection or begin when the captured Run signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const begin = vi.fn();
    const projectionCommit = vi.fn();
    const provider = createAuditedModelProvider({
      invocation_store: {} as never,
      projection_receipts: { commit: projectionCommit },
      response_artifacts: {} as never,
      transport: {} as never,
    });

    const result = await provider.invoke({
      signal: controller.signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: {},
    });

    expect(result).toMatchObject({ ok: false, error: { code: "RUN_EXECUTION_ABORTED" } });
    expect(projectionCommit).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it("commits a zero-network preflight failure when aborted after begin but before marker", async () => {
    const controller = new AbortController();
    const commitPreflightFailure = vi.fn(async () => ({
      ok: true as const,
      value: { projection: publicProjection },
    }));
    const dispatch = vi.fn();
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin: vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => ({
          ok: true as const,
          value: await committed(input.envelope),
        })),
        load: vi.fn(async () => ({ ok: true as const, value: null })),
        markDispatched: vi.fn(),
        markResponseObserved: responseObservedMarker(),
        commitTerminal: vi.fn(),
        commitPreflightFailure,
        commitCompleted: vi.fn(),
        markOutcomeUnknown: vi.fn(),
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: vi.fn() },
      transport: {
        prepare: vi.fn(async () => {
          controller.abort();
          return { ok: true as const, value: { prepared: {} } };
        }),
        dispatch,
      },
    });

    const result = await provider.invoke({
      signal: controller.signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: {},
    });

    expect(result).toMatchObject({ ok: false, error: { code: "RUN_EXECUTION_ABORTED" } });
    expect(commitPreflightFailure).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("marks outcome unknown when the Run aborts after durable dispatch marker", async () => {
    const controller = new AbortController();
    const order: string[] = [];
    const markResponseObserved = vi.fn(async () => {
      order.push("response-observed");
      return { ok: true as const, value: {} };
    });
    const markOutcomeUnknown = vi.fn(async () => {
      order.push("outcome-unknown");
      return {
        ok: true as const,
        value: { projection: { ...publicProjection, status: "OUTCOME_UNKNOWN" as const } },
      };
    });
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin: vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => ({
          ok: true as const,
          value: await committed(input.envelope),
        })),
        load: vi.fn(async () => ({ ok: true as const, value: null })),
        markDispatched: vi.fn(async () => ({ ok: true as const, value: {} })),
        markResponseObserved,
        commitTerminal: vi.fn(),
        commitPreflightFailure: vi.fn(),
        commitCompleted: vi.fn(),
        markOutcomeUnknown,
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: vi.fn() },
      transport: {
        prepare: vi.fn(async () => ({ ok: true as const, value: { prepared: {} } })),
        dispatch: vi.fn(async ({ mark_dispatched: markDispatched }) => {
          await markDispatched();
          controller.abort();
          return {
            kind: "FAILED" as const,
            reason_code: "PROVIDER_ABORTED",
            retryable: false,
            delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN" as const,
          };
        }),
      },
    });

    const result = await provider.invoke({
      signal: controller.signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: {},
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN" },
    });
    expect(markOutcomeUnknown).toHaveBeenCalledOnce();
    expect(markResponseObserved).toHaveBeenCalledWith(
      expect.objectContaining({
        observation_kind: "OUTCOME_UNKNOWN",
        response_hash: null,
        delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
      }),
    );
    expect(order).toEqual(["response-observed", "outcome-unknown"]);
  });

  it("lets the private transport durably mark dispatch and atomically commits protected output", async () => {
    const order: string[] = [];
    const begin = vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => {
      order.push("intent");
      return { ok: true as const, value: await committed(input.envelope) };
    });
    const load = vi.fn(async () => {
      order.push("load");
      return { ok: true as const, value: null };
    });
    const markDispatched = vi.fn(async () => {
      order.push("dispatch-mark");
      return { ok: true as const, value: {} };
    });
    const markResponseObserved = vi.fn(async () => {
      order.push("response-observed");
      return { ok: true as const, value: {} };
    });
    const commitCompleted = vi.fn(async () => {
      order.push("completed-atomic");
      return { ok: true as const, value: { projection: publicProjection } };
    });
    const prepare = vi.fn(async () => {
      order.push("prepare");
      return { ok: true as const, value: { prepared: { opaque: true } } };
    });
    const dispatch = vi.fn(async (input: { mark_dispatched: () => Promise<unknown> }) => {
      await input.mark_dispatched();
      order.push("network");
      return {
        kind: "COMPLETED" as const,
        output_text: "private model output",
        response_hash: hash("9"),
        tool_calls: [],
        usage: {
          source: "PROVIDER_REPORTED" as const,
          input_tokens: 3,
          output_tokens: 2,
          tool_calls: 0,
        },
      };
    });
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin,
        load,
        markDispatched,
        markResponseObserved,
        commitTerminal: vi.fn(),
        commitPreflightFailure: vi.fn(),
        commitCompleted,
        markOutcomeUnknown: vi.fn(),
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: vi.fn() },
      transport: { prepare, dispatch },
    });

    const result = await provider.invoke({
      signal: new AbortController().signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: { messages: [{ role: "user", content: "private prompt" }] },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { output_text: "private model output", projection: publicProjection },
    });
    expect(order).toEqual([
      "intent",
      "load",
      "prepare",
      "dispatch-mark",
      "network",
      "response-observed",
      "completed-atomic",
    ]);
    expect(JSON.stringify(begin.mock.calls)).not.toContain("private prompt");
    expect(JSON.stringify(commitCompleted.mock.calls)).toContain("private model output");
    expect(JSON.stringify(markDispatched.mock.calls)).not.toContain("private prompt");
  });

  it("loads a protected terminal response on restart without a second Provider call", async () => {
    const transport = vi.fn();
    const loadResponse = vi.fn(async () => ({
      ok: true as const,
      value: { output_text: "recorded output", tool_calls: [], response_hash: hash("9") },
    }));
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin: vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => ({
          ok: true as const,
          value: { ...(await committed(input.envelope)), replayed: true },
        })),
        load: vi.fn(async () => ({
          ok: true as const,
          value: {
            status: "COMPLETED" as const,
            response_hash: hash("9"),
            response_artifact_ref: {
              artifact_id: ids.response,
              artifact_type: "ProviderResponseArtifact" as const,
              app_id: ids.app,
              tenant_id: ids.workspace,
              environment: "test",
              run_id: ids.run,
              revision: 1,
              content_hash: hash("9"),
            },
            projection: publicProjection,
          },
        })),
        markDispatched: vi.fn(),
        markResponseObserved: responseObservedMarker(),
        commitTerminal: vi.fn(),
        commitPreflightFailure: vi.fn(),
        commitCompleted: vi.fn(),
        markOutcomeUnknown: vi.fn(),
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: loadResponse },
      transport: { prepare: vi.fn(), dispatch: transport },
    });

    const result = await provider.invoke({
      signal: new AbortController().signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: { messages: [{ role: "user", content: "must not resend" }] },
    });

    expect(result).toMatchObject({ ok: true, value: { output_text: "recorded output" } });
    expect(loadResponse).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["DISPATCH_MARKED", "RESPONSE_OBSERVED"] as const)(
    "fails closed on persisted non-terminal %s instead of replaying the Provider call",
    async (status) => {
      const prepare = vi.fn();
      const dispatch = vi.fn();
      const provider = createAuditedModelProvider({
        invocation_store: {
          begin: vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => ({
            ok: true as const,
            value: { ...(await committed(input.envelope)), replayed: true },
          })),
          load: vi.fn(async () => ({ ok: true as const, value: { status } })),
          markDispatched: vi.fn(),
          markResponseObserved: responseObservedMarker(),
          commitTerminal: vi.fn(),
          commitPreflightFailure: vi.fn(),
          commitCompleted: vi.fn(),
          markOutcomeUnknown: vi.fn(),
        },
        projection_receipts: projectionReceipts,
        response_artifacts: { load: vi.fn() },
        transport: { prepare, dispatch },
      });

      const result = await provider.invoke({
        signal: new AbortController().signal,
        worker_lease: workerLease(),
        envelope: await envelope(),
        payload: { private: "must not replay" },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "PROVIDER_RECONCILIATION_REQUIRED", retryable: false },
      });
      expect(prepare).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it("returns a begin-time terminal replay through the original permit with zero prepare/network", async () => {
    const dispatchEnvelope = await envelope();
    const ready = await committed(dispatchEnvelope);
    const prepare = vi.fn();
    const responseReference = {
      artifact_id: ids.response,
      artifact_type: "ProviderResponseArtifact" as const,
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hash("9"),
    };
    const loadResponse = vi.fn(async () => ({
      ok: true as const,
      value: { output_text: "recorded output", tool_calls: [], response_hash: hash("9") },
    }));
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin: vi.fn(async () => ({
          ok: true as const,
          value: {
            admission: "TERMINAL_REPLAY" as const,
            replay_action: "RETURN_RECORDED" as const,
            original_permit: ready.permit,
            status: "COMPLETED" as const,
            response_artifact_ref: responseReference,
            response_hash: hash("9"),
            projection: publicProjection,
          },
        })),
        load: vi.fn(),
        markDispatched: vi.fn(),
        markResponseObserved: responseObservedMarker(),
        commitTerminal: vi.fn(),
        commitPreflightFailure: vi.fn(),
        commitCompleted: vi.fn(),
        markOutcomeUnknown: vi.fn(),
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: loadResponse },
      transport: { prepare, dispatch: vi.fn() },
    });

    const result = await provider.invoke({
      signal: new AbortController().signal,
      worker_lease: workerLease(),
      envelope: dispatchEnvelope,
      payload: {},
    });

    expect(result).toMatchObject({ ok: true, value: { output_text: "recorded output" } });
    expect(loadResponse).toHaveBeenCalledWith({
      permit: ready.permit,
      reference: responseReference,
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    ["FAILED", "NEW_LOGICAL_INVOCATION_REQUIRED", "PROVIDER_INVOCATION_FAILED"],
    ["THROTTLED", "NEW_LOGICAL_INVOCATION_AFTER_RETRY_DELAY", "PROVIDER_THROTTLED"],
    ["OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED", "PROVIDER_INVOCATION_OUTCOME_UNKNOWN"],
  ] as const)(
    "returns stable %s terminal replay without prepare, marker, or network",
    async (status, replayAction, expectedCode) => {
      const dispatchEnvelope = await envelope();
      const ready = await committed(dispatchEnvelope);
      const prepare = vi.fn();
      const markDispatched = vi.fn();
      const dispatch = vi.fn();
      const provider = createAuditedModelProvider({
        invocation_store: {
          begin: vi.fn(async () => ({
            ok: true as const,
            value: {
              admission: "TERMINAL_REPLAY" as const,
              replay_action: replayAction,
              original_permit: ready.permit,
              status,
              response_artifact_ref: null,
              response_hash: null,
              projection: publicProjection,
            },
          })),
          load: vi.fn(),
          markDispatched,
          markResponseObserved: responseObservedMarker(),
          commitTerminal: vi.fn(),
          commitPreflightFailure: vi.fn(),
          commitCompleted: vi.fn(),
          markOutcomeUnknown: vi.fn(),
        },
        projection_receipts: projectionReceipts,
        response_artifacts: { load: vi.fn() },
        transport: { prepare, dispatch },
      });

      const result = await provider.invoke({
        signal: new AbortController().signal,
        worker_lease: workerLease(),
        envelope: dispatchEnvelope,
        payload: {},
      });

      expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
      expect(prepare).not.toHaveBeenCalled();
      expect(markDispatched).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it("marks an ambiguous dispatched failure unknown and never performs an ordinary retry", async () => {
    const markOutcomeUnknown = vi.fn(async () => ({
      ok: true as const,
      value: { projection: publicProjection },
    }));
    const transport = vi.fn(async () => {
      throw new Error("socket closed after write: private response fragment");
    });
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin: vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => ({
          ok: true as const,
          value: await committed(input.envelope),
        })),
        load: vi.fn(async () => ({ ok: true as const, value: null })),
        markDispatched: vi.fn(async () => ({ ok: true as const, value: {} })),
        markResponseObserved: responseObservedMarker(),
        commitTerminal: vi.fn(),
        commitPreflightFailure: vi.fn(),
        commitCompleted: vi.fn(),
        markOutcomeUnknown,
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: vi.fn() },
      transport: {
        prepare: vi.fn(async () => ({ ok: true as const, value: { prepared: {} } })),
        dispatch: vi.fn(async (input) => {
          await input.mark_dispatched();
          return transport();
        }),
      },
    });

    const result = await provider.invoke({
      signal: new AbortController().signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: { messages: [{ role: "user", content: "private prompt" }] },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN", retryable: false },
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(markOutcomeUnknown).toHaveBeenCalledOnce();
    expect(JSON.stringify(markOutcomeUnknown.mock.calls)).not.toContain(
      "private response fragment",
    );
  });

  it("does not prepare or dispatch when begin atomically rejects capacity", async () => {
    const prepare = vi.fn();
    const dispatch = vi.fn();
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin: vi.fn(async () => ({
          ok: true as const,
          value: {
            admission: "REJECTED" as const,
            reason_code: "PROVIDER_CONTEXT_LIMIT_EXCEEDED" as const,
            projection: publicProjection,
          },
        })),
        load: vi.fn(),
        markDispatched: vi.fn(),
        markResponseObserved: responseObservedMarker(),
        commitTerminal: vi.fn(),
        commitPreflightFailure: vi.fn(),
        commitCompleted: vi.fn(),
        markOutcomeUnknown: vi.fn(),
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: vi.fn() },
      transport: { prepare, dispatch },
    });

    const result = await provider.invoke({
      signal: new AbortController().signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: { secret: "must never reach transport" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_CONTEXT_LIMIT_EXCEEDED", retryable: false },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("commits a local preparation failure with zero network calls", async () => {
    const dispatch = vi.fn();
    const commitPreflightFailure = vi.fn(async () => ({
      ok: true as const,
      value: { projection: publicProjection },
    }));
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin: vi.fn(async (input: { envelope: ProviderDispatchEnvelope }) => ({
          ok: true as const,
          value: await committed(input.envelope),
        })),
        load: vi.fn(async () => ({ ok: true as const, value: null })),
        markDispatched: vi.fn(),
        markResponseObserved: responseObservedMarker(),
        commitTerminal: vi.fn(),
        commitPreflightFailure,
        commitCompleted: vi.fn(),
        markOutcomeUnknown: vi.fn(),
      },
      projection_receipts: projectionReceipts,
      response_artifacts: { load: vi.fn() },
      transport: {
        prepare: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "PROVIDER_CREDENTIAL_UNAVAILABLE",
            message: "credential unavailable",
            retryable: false,
          },
        })),
        dispatch,
      },
    });

    const result = await provider.invoke({
      signal: new AbortController().signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: { secret: "private" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_CREDENTIAL_UNAVAILABLE", retryable: false },
    });
    expect(commitPreflightFailure).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a substituted projection receipt before begin or transport", async () => {
    const begin = vi.fn();
    const prepare = vi.fn();
    const dispatch = vi.fn();
    const provider = createAuditedModelProvider({
      invocation_store: {
        begin,
        load: vi.fn(),
        markDispatched: vi.fn(),
        markResponseObserved: responseObservedMarker(),
        commitTerminal: vi.fn(),
        commitPreflightFailure: vi.fn(),
        commitCompleted: vi.fn(),
        markOutcomeUnknown: vi.fn(),
      },
      projection_receipts: {
        commit: vi.fn(async (input) => ({
          ok: true as const,
          value: {
            reference: {
              ...input.envelope.projection.receipt_ref,
              content_hash: hash("0"),
            },
            resolver: { resolve_committed: vi.fn(async () => null) },
          },
        })),
      },
      response_artifacts: { load: vi.fn() },
      transport: { prepare, dispatch },
    });

    const result = await provider.invoke({
      signal: new AbortController().signal,
      worker_lease: workerLease(),
      envelope: await envelope(),
      payload: { private: true },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_DATA_PROJECTION_RECEIPT_INVALID" },
    });
    expect(begin).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
