import {
  type AppScope,
  buildContextReceiptBindingCandidate,
  buildEffectiveRunConfigReceiptCandidate,
  type EffectiveRunConfigReceiptCandidate,
  type PortResult,
  type RunRuntimeEvent,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunWorkerRunner, type RunWorkflowExecutorPort } from "../../src/runs/index.js";
import {
  hasRunProviderDispatchCapability,
  type RunBoundProviderDispatcher,
} from "../../src/runs/run-execution-context.js";
import { InMemoryRunRuntime } from "./support/in-memory-run-runtime.js";

const ids = {
  app: "90000000-0000-4000-8000-000000000001",
  workspace: "90000000-0000-4000-8000-000000000002",
  otherWorkspace: "90000000-0000-4000-8000-000000000012",
  principal: "90000000-0000-4000-8000-000000000003",
  run: "90000000-0000-4000-8000-000000000004",
  otherRun: "90000000-0000-4000-8000-000000000005",
  command: "90000000-0000-4000-8000-000000000006",
  outbox: "90000000-0000-4000-8000-000000000007",
  config: "90000000-0000-4000-8000-000000000008",
  defaults: "90000000-0000-4000-8000-000000000009",
  route: "90000000-0000-4000-8000-00000000000a",
  model: "90000000-0000-4000-8000-00000000000b",
  datasource: "90000000-0000-4000-8000-00000000000c",
  semantic: "90000000-0000-4000-8000-00000000000d",
  snapshot: "90000000-0000-4000-8000-00000000000e",
  context: "90000000-0000-4000-8000-00000000000f",
  egress: "90000000-0000-4000-8000-000000000010",
  safety: "90000000-0000-4000-8000-000000000011",
  conversation: "90000000-0000-4000-8000-000000000013",
} as const;

const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const H3 = `sha256:${"3".repeat(64)}` as const;
const H4 = `sha256:${"4".repeat(64)}` as const;
const H5 = `sha256:${"5".repeat(64)}` as const;
const H6 = `sha256:${"6".repeat(64)}` as const;

const scope = {
  app_id: ids.app,
  tenant_id: ids.workspace,
  environment: "test",
} as const satisfies AppScope;

function resource(resource_id: string, resource_revision: number, resource_hash: string) {
  return { resource_id, resource_revision, resource_hash };
}

function mandatoryBindings() {
  return [
    {
      resource_kind: "CONTEXT_POLICY" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.context, 6, H6),
      source: "POLICY" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "DATASOURCE" as const,
      mention_id: null,
      requested_resource_id: ids.datasource,
      requested_revision: 3,
      effective_resource: resource(ids.datasource, 3, H3),
      source: "DEFAULT" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "EGRESS_POLICY" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.egress, 7, H1),
      source: "POLICY" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "EXECUTION_SAFETY_POLICY" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.safety, 8, H2),
      source: "POLICY" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "MODEL_PROFILE" as const,
      mention_id: null,
      requested_resource_id: ids.model,
      requested_revision: 2,
      effective_resource: resource(ids.model, 2, H2),
      source: "DEFAULT" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "SCHEMA_SNAPSHOT" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.snapshot, 5, H5),
      source: "ACTIVE_POINTER" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "SEMANTIC_RELEASE" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.semantic, 4, H4),
      source: "ACTIVE_POINTER" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
  ];
}

function optionalSelectionEvaluations() {
  const defaultsRef = { defaults_id: ids.defaults, defaults_revision: 1, defaults_hash: H1 };
  return (["FILE", "KNOWLEDGE", "MCP_SERVER", "SKILL"] as const).map((resourceKind) => ({
    resource_kind: resourceKind,
    selection_mode: "INHERIT_DEFAULT" as const,
    binding_count: 0,
    defaults_ref: defaultsRef,
  }));
}

async function effectiveConfig(runId: string = ids.run, workspaceId: string = ids.workspace) {
  return buildEffectiveRunConfigReceiptCandidate({
    schema_version: "effective-run-config-receipt@1.0.0",
    config_id: ids.config,
    config_revision: 1,
    scope: {
      ...scope,
      tenant_id: workspaceId,
      workspace_id: workspaceId,
      principal_id: ids.principal,
    },
    run_id: runId,
    operation: "QUESTION_RUN",
    conversation_binding: { conversation_id: ids.conversation, resource_version: 3 },
    request_hash: H1,
    defaults_ref: { defaults_id: ids.defaults, defaults_revision: 1, defaults_hash: H1 },
    authority_binding: {
      authz_epoch: 1,
      membership_version: 1,
      workspace_lifecycle_version: 1,
      route_resolution_id: ids.route,
      route_resolution_hash: H2,
      resolver_policy_version: "effective-config-resolver@1",
    },
    model: {
      ...resource(ids.model, 2, H2),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      profile_version: "profile@2",
    },
    datasource: resource(ids.datasource, 3, H3),
    semantic_release: {
      ...resource(ids.semantic, 4, H4),
      datasource_id: ids.datasource,
      semantic_generation: 7,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      ...resource(ids.snapshot, 5, H5),
      datasource_id: ids.datasource,
      semantic_release_id: ids.semantic,
      semantic_generation: 7,
    },
    context_policy: {
      ...resource(ids.context, 6, H6),
      max_context_tokens: 32_000,
      max_resource_bindings: 64,
    },
    egress_policy: {
      ...resource(ids.egress, 7, H1),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE", "WORKSPACE"],
      classification: "INTERNAL",
    },
    execution_safety_policy: {
      ...resource(ids.safety, 8, H2),
      max_tool_calls: 32,
      max_provider_calls: 8,
      max_elapsed_ms: 300_000,
    },
    resource_bindings: mandatoryBindings(),
    optional_selection_evaluations: optionalSelectionEvaluations(),
    effective_egress: {
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "RESTRICTED",
    },
  });
}

function configRef(config: EffectiveRunConfigReceiptCandidate) {
  return {
    config_id: config.config_id,
    config_revision: config.config_revision,
    config_hash: config.config_hash,
  };
}

function lease(config: EffectiveRunConfigReceiptCandidate, attempt = 1): RunWorkLease {
  const suffix = String(attempt).padStart(2, "0");
  return {
    scope,
    principal_id: ids.principal,
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    command_kind: "START_L2_RESEARCH",
    attempt_id: `90000000-0000-4000-8000-0000000001${suffix}`,
    attempt_no: attempt,
    delivery_attempt_no: attempt,
    lease_duration_ms: 30_000,
    worker_id: `worker-${attempt}`,
    lease_token: attempt,
    worker_fence: attempt,
    expires_at: "2026-08-16T10:05:00.000Z",
    payload: { kind: "START_L2_RESEARCH", effective_config_ref: configRef(config) },
  };
}

function acceptedEvent(): RunRuntimeEvent {
  return {
    schema_version: "1.0.0",
    event_id: "90000000-0000-4000-8000-000000000020",
    event_type: "run.accepted",
    scope,
    run_id: ids.run,
    sequence: 1,
    worker_fence: 0,
    idempotency_key: "effective-config:accepted",
    occurred_at: "2026-08-16T10:00:00.000Z",
    payload: { command_id: ids.command, payload_hash: H1 },
  };
}

async function consumption(
  workerLease: RunWorkLease,
  config: EffectiveRunConfigReceiptCandidate,
  replayed = false,
) {
  const references = mandatoryBindings()
    .map((binding) => binding.effective_resource)
    .toSorted((left, right) => left.resource_id.localeCompare(right.resource_id));
  const contextReceipt = await buildContextReceiptBindingCandidate({
    schema_version: "effective-config-context-receipt@1.0.0",
    receipt_id: workerLease.attempt_id,
    outbox_id: workerLease.outbox_id,
    command_id: workerLease.command_id,
    consumer: "WORKER_START",
    consumer_id: workerLease.worker_id,
    attempt_id: workerLease.attempt_id,
    lease_token: workerLease.lease_token,
    worker_fence: workerLease.worker_fence,
    scope: config.scope,
    run_id: config.run_id,
    config_ref: configRef(config),
    semantic_release: config.semantic_release,
    schema_snapshot: config.schema_snapshot,
    context_policy: resource(
      config.context_policy.resource_id,
      config.context_policy.resource_revision,
      config.context_policy.resource_hash,
    ),
    provider: config.model.provider,
    audiences: config.effective_egress.allowed_audiences,
    classification: config.effective_egress.classification,
    resource_refs: references,
    consumed_at: "2026-08-16T10:01:00.000Z",
  });
  return {
    schema_version: "effective-config-worker-consumption@1.0.0",
    replayed,
    context_receipt: contextReceipt,
    effective_config: config,
  } as const;
}

async function runHarness(input: {
  workerLease: RunWorkLease;
  loader: (lease: RunWorkLease) => Promise<PortResult<unknown>>;
  executor?: RunWorkflowExecutorPort;
  providerDispatch?: RunBoundProviderDispatcher;
}) {
  const runtime = new InMemoryRunRuntime();
  await runtime.seed(acceptedEvent());
  runtime.enqueueLease(input.workerLease);
  const executor =
    input.executor ??
    ({
      async execute() {
        return { kind: "COMPLETED" };
      },
    } satisfies RunWorkflowExecutorPort);
  const runner = createRunWorkerRunner({
    queue: runtime,
    event_store: runtime,
    executor,
    effective_config_loader: input.loader,
    ...(input.providerDispatch ? { provider_dispatch: input.providerDispatch } : {}),
    now: () => new Date("2026-08-16T10:01:00.000Z"),
    create_id: vi.fn(() => crypto.randomUUID()),
  });
  const result = await runner.runOnce({ scope, worker_id: input.workerLease.worker_id });
  return { result, runtime };
}

describe("U2 Worker effective config boundary", () => {
  it("injects only an opaque audited dispatch capability after config/context verification", async () => {
    const config = await effectiveConfig();
    const workerLease = lease(config);
    const loaded = await consumption(workerLease, config);
    const providerDispatch = {
      invoke: vi.fn(async () => ({
        ok: false as const,
        error: { code: "PROVIDER_FAKE_TERMINAL", message: "fake", retryable: false },
      })),
    } satisfies RunBoundProviderDispatcher;
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        const capability = context.getProviderDispatchCapability();
        expect(hasRunProviderDispatchCapability(capability)).toBe(true);
        expect(capability).not.toHaveProperty("transport");
        expect(capability).not.toHaveProperty("invocation_store");
        expect(hasRunProviderDispatchCapability({ invoke: vi.fn() })).toBe(false);
        if (!capability) throw new Error("provider capability missing");
        await capability.invoke({ logical_call_id: ids.command });
        await expect(capability.invoke({ logical_call_id: ids.command })).resolves.toMatchObject({
          ok: false,
          error: { code: "PROVIDER_LOGICAL_CALL_DUPLICATE", retryable: false },
        });
        await capability.invoke({ logical_call_id: ids.otherRun });
        return { kind: "COMPLETED" };
      },
    };

    const { result } = await runHarness({
      workerLease,
      loader: async () => ({ ok: true, value: loaded }),
      executor,
      providerDispatch,
    });

    expect(result).toMatchObject({ ok: true, value: { kind: "COMPLETED" } });
    expect(providerDispatch.invoke).toHaveBeenCalledTimes(2);
    expect(providerDispatch.invoke).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      lease: workerLease,
      effective_config: config,
      context_receipt: loaded.context_receipt,
      logical_call_id: ids.command,
    });
  });

  it("revalidates after durable lease admission and before Executor or terminal settlement", async () => {
    const config = await effectiveConfig();
    const workerLease = lease(config);
    const runtime = new InMemoryRunRuntime();
    await runtime.seed(acceptedEvent());
    runtime.enqueueLease(workerLease);
    const readProjection = vi.spyOn(runtime, "readProjection");
    const loader = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "EFFECTIVE_CONFIG_REVOKED",
        message: "revoked",
        retryable: false,
      },
    }));
    const runner = createRunWorkerRunner({
      queue: runtime,
      event_store: runtime,
      executor: { execute: vi.fn() } as unknown as RunWorkflowExecutorPort,
      effective_config_loader: loader,
    });

    const result = await runner.runOnce({ scope, worker_id: workerLease.worker_id });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_REVOKED" },
    });
    expect(loader).toHaveBeenCalledOnce();
    expect(readProjection).toHaveBeenCalledOnce();
    expect(runtime.completed).toHaveLength(0);
    expect(runtime.operations).toEqual(["queue:lease", "event:run.leased", "queue:heartbeat"]);
  });

  it("revalidates before Executor and exposes only verified config/context accessors", async () => {
    const config = await effectiveConfig();
    const workerLease = lease(config);
    const loaded = await consumption(workerLease, config);
    const observed: string[] = [];
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        observed.push(context.getEffectiveConfig().config_hash);
        observed.push(context.getContextReceipt().receipt_hash);
        return { kind: "COMPLETED" };
      },
    };
    const loader = vi.fn(async () => ({ ok: true, value: loaded }) as const);

    const { result, runtime } = await runHarness({ workerLease, loader, executor });

    expect(result).toMatchObject({ ok: true, value: { kind: "COMPLETED" } });
    expect(loader).toHaveBeenCalledOnce();
    expect(observed).toEqual([config.config_hash, loaded.context_receipt.receipt_hash]);
    expect(runtime.operations.indexOf("event:run.leased")).toBeGreaterThan(0);
  });

  it("rejects a missing or raw legacy payload before loader and every effect", async () => {
    const config = await effectiveConfig();
    const rawLease = {
      ...lease(config),
      payload: { kind: "START_L2_RESEARCH", model_id: "caller-controlled" },
    } as RunWorkLease;
    const loader = vi.fn();
    const executor = { execute: vi.fn() } as unknown as RunWorkflowExecutorPort;

    const { result, runtime } = await runHarness({ workerLease: rawLease, loader, executor });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID" },
    });
    expect(loader).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
    expect(runtime.operations).toEqual(["queue:lease"]);
  });

  it("rejects a tampered receipt hash before Executor and event-store writes", async () => {
    const config = await effectiveConfig();
    const workerLease = lease(config);
    const loaded = await consumption(workerLease, config);
    const tampered = {
      ...loaded,
      effective_config: {
        ...loaded.effective_config,
        model: { ...loaded.effective_config.model, model_id: "tampered-model" },
      },
    };
    const executor = { execute: vi.fn() } as unknown as RunWorkflowExecutorPort;

    const { result, runtime } = await runHarness({
      workerLease,
      loader: async () => ({ ok: true, value: tampered }),
      executor,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID" },
    });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(runtime.operations).toEqual(["queue:lease", "event:run.leased", "queue:heartbeat"]);
  });

  it("rejects tampered optional selection closure before Executor and effects", async () => {
    const config = await effectiveConfig();
    const workerLease = lease(config);
    const loaded = await consumption(workerLease, config);
    const tampered = {
      ...loaded,
      effective_config: {
        ...loaded.effective_config,
        optional_selection_evaluations: loaded.effective_config.optional_selection_evaluations.map(
          (evaluation, index) => (index === 0 ? { ...evaluation, binding_count: 1 } : evaluation),
        ),
      },
    };
    const executor = { execute: vi.fn() } as unknown as RunWorkflowExecutorPort;

    const { result, runtime } = await runHarness({
      workerLease,
      loader: async () => ({ ok: true, value: tampered }),
      executor,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID" },
    });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(runtime.operations).toEqual(["queue:lease", "event:run.leased", "queue:heartbeat"]);
  });

  it("rejects a validly hashed receipt with a different run binding", async () => {
    const original = await effectiveConfig();
    const mismatched = await effectiveConfig(ids.otherRun);
    const workerLease = lease(original);
    const loaded = await consumption(workerLease, mismatched);
    const executor = { execute: vi.fn() } as unknown as RunWorkflowExecutorPort;

    const { result, runtime } = await runHarness({
      workerLease,
      loader: async () => ({ ok: true, value: loaded }),
      executor,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID" },
    });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(runtime.operations).toEqual(["queue:lease", "event:run.leased", "queue:heartbeat"]);
  });

  it("rejects a validly hashed receipt with a different workspace scope", async () => {
    const mismatched = await effectiveConfig(ids.run, ids.otherWorkspace);
    const workerLease = lease(mismatched);
    const loaded = await consumption(workerLease, mismatched);
    const executor = { execute: vi.fn() } as unknown as RunWorkflowExecutorPort;

    const { result, runtime } = await runHarness({
      workerLease,
      loader: async () => ({ ok: true, value: loaded }),
      executor,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID" },
    });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(runtime.operations).toEqual(["queue:lease", "event:run.leased", "queue:heartbeat"]);
  });

  it.each(["EFFECTIVE_CONFIG_REVOKED", "EFFECTIVE_CONFIG_FENCE_STALE"])(
    "propagates %s after lease admission but before Executor or side effect",
    async (code) => {
      const config = await effectiveConfig();
      const workerLease = lease(config);
      const executor = { execute: vi.fn() } as unknown as RunWorkflowExecutorPort;

      const { result, runtime } = await runHarness({
        workerLease,
        loader: async () => ({
          ok: false,
          error: { code, message: "authority rejected", retryable: false },
        }),
        executor,
      });

      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(executor.execute).not.toHaveBeenCalled();
      expect(runtime.operations).toEqual(["queue:lease", "event:run.leased", "queue:heartbeat"]);
    },
  );

  it("keeps the effective config hash stable across restart/replay attempts", async () => {
    const config = await effectiveConfig();
    const observed: string[] = [];
    for (const attempt of [1, 2]) {
      const workerLease = lease(config, attempt);
      const loaded = await consumption(workerLease, config, attempt === 2);
      const executor: RunWorkflowExecutorPort = {
        async execute({ context }) {
          observed.push(context.getEffectiveConfig().config_hash);
          return { kind: "COMPLETED" };
        },
      };
      const { result } = await runHarness({
        workerLease,
        loader: async () => ({ ok: true, value: loaded }),
        executor,
      });
      expect(result.ok).toBe(true);
    }

    expect(observed).toEqual([config.config_hash, config.config_hash]);
  });
});
