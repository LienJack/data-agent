import {
  buildProviderTaskArtifactDocument,
  type ProviderExecutionProfile,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AuditedModelProvider } from "../../src/providers/audited-model-provider.js";
import { resolveProductionProviderConnectionKinds } from "../../src/providers/production-run-bound-provider-dispatcher.js";
import { createRunBoundProviderDispatcher } from "../../src/providers/run-bound-provider-dispatcher.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "../runs/support/effective-config-fixture.js";

const ids = {
  app: "88000000-0000-4000-8000-000000000001",
  workspace: "88000000-0000-4000-8000-000000000002",
  principal: "88000000-0000-4000-8000-000000000003",
  run: "88000000-0000-4000-8000-000000000004",
  command: "88000000-0000-4000-8000-000000000005",
  event: "88000000-0000-4000-8000-000000000006",
  outbox: "88000000-0000-4000-8000-000000000007",
  attempt: "88000000-0000-4000-8000-000000000008",
  deployment: "88000000-0000-4000-8000-000000000009",
  otherDeployment: "88000000-0000-4000-8000-000000000011",
  certification: "88000000-0000-4000-8000-000000000010",
} as const;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;

function lease(): RunWorkLease {
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
    lease_token: 2,
    worker_fence: 3,
    expires_at: "2026-08-17T00:05:00.000Z",
    payload: { kind: "START_L2_RESEARCH" },
  };
}

describe("run-bound Provider coordinator", () => {
  it.each([
    ["within limit", 32_000, 4_000, "WITHIN_LIMIT"],
    ["over context limit", 1, 1, "EXCEEDED"],
  ] as const)(
    "builds a %s private envelope from U2, DB task, and AVAILABLE profile authorities",
    async (_case, contextCeiling, outputCeiling, expectedCapacityStatus) => {
      const config = await buildWorkerEffectiveConfigFixture({
        scope: lease().scope,
        workspace_id: ids.workspace,
        principal_id: ids.principal,
        run_id: ids.run,
      });
      const workerLease = bindEffectiveConfigLease(lease(), config);
      const loaded = await createEffectiveConfigFixtureLoader(config)(workerLease);
      if (!loaded.ok) throw new Error("fixture load failed");
      const context = (
        loaded.value as {
          readonly context_receipt: Parameters<
            ReturnType<typeof createRunBoundProviderDispatcher>["invoke"]
          >[0]["context_receipt"];
        }
      ).context_receipt;
      const document = await buildProviderTaskArtifactDocument({
        schema_version: "provider-task-artifact@1.0.0",
        message_id: ids.event,
        accepted_event_id: ids.event,
        conversation_id: config.conversation_binding.conversation_id,
        conversation_resource_version: config.conversation_binding.resource_version,
        command_id: ids.command,
        run_id: ids.run,
        message_role: "user",
        message_type: "text",
        question: "查询华南区净收入",
      });
      const taskReference = {
        artifact_id: ids.event,
        artifact_type: "ProviderTaskArtifact",
        ...workerLease.scope,
        run_id: ids.run,
        revision: 1,
        content_hash: document.content_hash,
      } as const;
      const profile = {
        model_profile_id: config.model.resource_id,
        model_config_version: config.model.resource_revision,
        resource_hash: config.model.resource_hash,
        profile_version: config.model.profile_version,
        provider: config.model.provider,
        model_id: config.model.model_id,
        display_name: "DeepSeek V4 Flash",
        adapter_version: "model-provider-adapter@1.0.0",
        certification_receipt_ref: {
          artifact_id: ids.certification,
          artifact_type: "ModelCertificationReceipt",
          ...workerLease.scope,
          run_id: ids.run,
          revision: 1,
          content_hash: hash("c"),
        },
        execution_profile_hash: hash("d"),
        recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
        connection: {
          kind: "SYSTEM_DEPLOYMENT",
          deployment_id: ids.deployment,
          deployment_revision: 1,
          deployment_hash: hash("e"),
        },
        effective_context_ceiling_tokens: contextCeiling,
        effective_output_ceiling_tokens: outputCeiling,
        readiness: "AVAILABLE",
        selectable: true,
        unavailable_reason: null,
      } as const satisfies ProviderExecutionProfile;
      const projectionCommit = vi.fn(
        async (_lease: unknown, receipt: { receipt_hash: string }) => ({
          ok: true as const,
          value: {
            artifact_id: ids.command,
            artifact_type: "AgentDataProjectionReceipt" as const,
            ...workerLease.scope,
            run_id: ids.run,
            revision: 1,
            content_hash: receipt.receipt_hash,
          },
        }),
      );
      const auditedInvoke = vi.fn(
        async (invocation: Parameters<AuditedModelProvider["invoke"]>[0]) => {
          const committed = await projectionAuthority?.commit({
            worker_lease: invocation.worker_lease,
            envelope: invocation.envelope,
          });
          expect(committed?.ok).toBe(true);
          return {
            ok: false as const,
            error: { code: "PROVIDER_FAKE_TERMINAL", message: "fake", retryable: false },
          };
        },
      );
      let projectionAuthority:
        | Parameters<
            Parameters<typeof createRunBoundProviderDispatcher>[0]["create_audited_provider"]
          >[0]
        | null = null;
      const dispatcher = createRunBoundProviderDispatcher({
        task_artifacts: {
          commit: vi.fn(async () => ({
            ok: true as const,
            value: {
              schema_version: "provider-task-artifact-commit-result@1.0.0" as const,
              disposition: "CREATED" as const,
              reference: taskReference,
              document,
              committed_at: "2026-08-17T00:00:00.000Z",
            },
          })),
          load: vi.fn(),
        },
        execution_profiles: { list: async () => ({ ok: true, value: [profile] }) },
        projection_store: {
          commit: projectionCommit,
          committedResolverForLease: () => ({ resolve_committed: async () => null }),
        },
        create_audited_provider: (authority) => {
          projectionAuthority = authority;
          return { invoke: auditedInvoke };
        },
        allowed_providers: ["deepseek"],
        allowed_connection_kinds: ["SYSTEM_DEPLOYMENT"],
        system_deployment_id: ids.deployment,
        required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
        response_schema_version: "qa-answer@1.0.0",
        response_schema_bytes: 512,
      });

      const result = await dispatcher.invoke({
        signal: new AbortController().signal,
        lease: workerLease,
        effective_config: config,
        context_receipt: context,
        logical_call_id: ids.command,
      });

      expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_FAKE_TERMINAL" } });
      expect(auditedInvoke).toHaveBeenCalledOnce();
      const invocation = auditedInvoke.mock.calls[0]?.[0];
      expect(invocation?.envelope.model_profile.model_id).toBe("deepseek-v4-flash");
      expect(invocation?.envelope.task_ref).toEqual(taskReference);
      expect(invocation?.envelope.projection).toMatchObject({
        token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
        trusted_input_token_upper_bound: expect.any(Number),
        capacity_status: expectedCapacityStatus,
      });
      expect(invocation?.payload).toMatchObject({
        messages: [{ role: "user", content: document.question }],
        token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      });
      expect(JSON.stringify(invocation?.envelope)).not.toContain(document.question);
      expect(projectionCommit).toHaveBeenCalledOnce();
    },
  );

  it("fails before task/projection/provider when Effective model is not AVAILABLE", async () => {
    const taskCommit = vi.fn();
    const dispatcher = createRunBoundProviderDispatcher({
      task_artifacts: { commit: taskCommit, load: vi.fn() },
      execution_profiles: { list: async () => ({ ok: true, value: [] }) },
      projection_store: {} as never,
      create_audited_provider: vi.fn(),
      allowed_providers: ["deepseek"],
      allowed_connection_kinds: ["SYSTEM_DEPLOYMENT"],
      system_deployment_id: ids.deployment,
      required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      response_schema_version: "qa-answer@1.0.0",
      response_schema_bytes: 512,
    });
    const config = await buildWorkerEffectiveConfigFixture({
      scope: lease().scope,
      workspace_id: ids.workspace,
      principal_id: ids.principal,
      run_id: ids.run,
    });
    const workerLease = bindEffectiveConfigLease(lease(), config);
    const loaded = await createEffectiveConfigFixtureLoader(config)(workerLease);
    if (!loaded.ok) throw new Error("fixture load failed");

    const result = await dispatcher.invoke({
      signal: new AbortController().signal,
      lease: workerLease,
      effective_config: config,
      context_receipt: (
        loaded.value as {
          readonly context_receipt: Parameters<typeof dispatcher.invoke>[0]["context_receipt"];
        }
      ).context_receipt,
      logical_call_id: ids.command,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_PROFILE_NOT_AVAILABLE" },
    });
    expect(taskCommit).not.toHaveBeenCalled();
  });

  it("rejects a managed connection before task, invocation begin, or Provider transport", async () => {
    const environmentWithCredential = { DEEPSEEK_API_KEY: "present-but-not-authority" };
    const config = await buildWorkerEffectiveConfigFixture({
      scope: lease().scope,
      workspace_id: ids.workspace,
      principal_id: ids.principal,
      run_id: ids.run,
    });
    const workerLease = bindEffectiveConfigLease(lease(), config);
    const loaded = await createEffectiveConfigFixtureLoader(config)(workerLease);
    if (!loaded.ok) throw new Error("fixture load failed");
    const managedProfile = {
      model_profile_id: config.model.resource_id,
      model_config_version: config.model.resource_revision,
      resource_hash: config.model.resource_hash,
      profile_version: config.model.profile_version,
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      display_name: "DeepSeek V4 Flash managed",
      adapter_version: "model-provider-adapter@1.0.0",
      certification_receipt_ref: {
        artifact_id: ids.certification,
        artifact_type: "ModelCertificationReceipt",
        ...workerLease.scope,
        run_id: ids.run,
        revision: 1,
        content_hash: hash("c"),
      },
      execution_profile_hash: hash("d"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      connection: {
        kind: "MANAGED_CONNECTION",
        provider_connection_id: ids.deployment,
        config_version: 1,
        connection_hash: hash("e"),
      },
      effective_context_ceiling_tokens: 32_000,
      effective_output_ceiling_tokens: 4_000,
      readiness: "AVAILABLE",
      selectable: true,
      unavailable_reason: null,
    } as const satisfies ProviderExecutionProfile;
    const taskCommit = vi.fn();
    const createAudited = vi.fn();
    const dispatcher = createRunBoundProviderDispatcher({
      task_artifacts: { commit: taskCommit, load: vi.fn() },
      execution_profiles: { list: async () => ({ ok: true, value: [managedProfile] }) },
      projection_store: {} as never,
      create_audited_provider: createAudited,
      allowed_providers: ["deepseek"],
      allowed_connection_kinds: resolveProductionProviderConnectionKinds(environmentWithCredential),
      system_deployment_id: ids.deployment,
      required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      response_schema_version: "qa-answer@1.0.0",
      response_schema_bytes: 512,
    });

    const result = await dispatcher.invoke({
      signal: new AbortController().signal,
      lease: workerLease,
      effective_config: config,
      context_receipt: (
        loaded.value as {
          readonly context_receipt: Parameters<typeof dispatcher.invoke>[0]["context_receipt"];
        }
      ).context_receipt,
      logical_call_id: ids.command,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_CONNECTION_PROOF_INVALID" },
    });
    expect(taskCommit).not.toHaveBeenCalled();
    expect(createAudited).not.toHaveBeenCalled();
  });

  it("rejects a system deployment certified for another deployment before projection, begin, or network", async () => {
    const config = await buildWorkerEffectiveConfigFixture({
      scope: lease().scope,
      workspace_id: ids.workspace,
      principal_id: ids.principal,
      run_id: ids.run,
    });
    const workerLease = bindEffectiveConfigLease(lease(), config);
    const loaded = await createEffectiveConfigFixtureLoader(config)(workerLease);
    if (!loaded.ok) throw new Error("fixture load failed");
    const crossDeploymentProfile = {
      model_profile_id: config.model.resource_id,
      model_config_version: config.model.resource_revision,
      resource_hash: config.model.resource_hash,
      profile_version: config.model.profile_version,
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      display_name: "DeepSeek V4 Flash other deployment",
      adapter_version: "model-provider-adapter@1.0.0",
      certification_receipt_ref: {
        artifact_id: ids.certification,
        artifact_type: "ModelCertificationReceipt",
        ...workerLease.scope,
        run_id: ids.run,
        revision: 1,
        content_hash: hash("c"),
      },
      execution_profile_hash: hash("d"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: ids.otherDeployment,
        deployment_revision: 1,
        deployment_hash: hash("e"),
      },
      effective_context_ceiling_tokens: 32_000,
      effective_output_ceiling_tokens: 4_000,
      readiness: "AVAILABLE",
      selectable: true,
      unavailable_reason: null,
    } as const satisfies ProviderExecutionProfile;
    const taskCommit = vi.fn();
    const projectionCommit = vi.fn();
    const createAudited = vi.fn();
    const dispatcher = createRunBoundProviderDispatcher({
      task_artifacts: { commit: taskCommit, load: vi.fn() },
      execution_profiles: { list: async () => ({ ok: true, value: [crossDeploymentProfile] }) },
      projection_store: { commit: projectionCommit } as never,
      create_audited_provider: createAudited,
      allowed_providers: ["deepseek"],
      allowed_connection_kinds: ["SYSTEM_DEPLOYMENT"],
      system_deployment_id: ids.deployment,
      required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      response_schema_version: "qa-answer@1.0.0",
      response_schema_bytes: 512,
    });

    const result = await dispatcher.invoke({
      signal: new AbortController().signal,
      lease: workerLease,
      effective_config: config,
      context_receipt: (
        loaded.value as {
          readonly context_receipt: Parameters<typeof dispatcher.invoke>[0]["context_receipt"];
        }
      ).context_receipt,
      logical_call_id: ids.command,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_CONNECTION_PROOF_INVALID" },
    });
    expect(taskCommit).not.toHaveBeenCalled();
    expect(projectionCommit).not.toHaveBeenCalled();
    expect(createAudited).not.toHaveBeenCalled();
  });

  it("rejects unsupported DeepSeek recovery capabilities before projection, begin, or network", async () => {
    const config = await buildWorkerEffectiveConfigFixture({
      scope: lease().scope,
      workspace_id: ids.workspace,
      principal_id: ids.principal,
      run_id: ids.run,
    });
    const workerLease = bindEffectiveConfigLease(lease(), config);
    const loaded = await createEffectiveConfigFixtureLoader(config)(workerLease);
    if (!loaded.ok) throw new Error("fixture load failed");
    const unsupportedRecoveryProfile = {
      model_profile_id: config.model.resource_id,
      model_config_version: config.model.resource_revision,
      resource_hash: config.model.resource_hash,
      profile_version: config.model.profile_version,
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      display_name: "DeepSeek V4 Flash unimplemented status path",
      adapter_version: "model-provider-adapter@1.0.0",
      certification_receipt_ref: {
        artifact_id: ids.certification,
        artifact_type: "ModelCertificationReceipt",
        ...workerLease.scope,
        run_id: ids.run,
        revision: 1,
        content_hash: hash("c"),
      },
      execution_profile_hash: hash("d"),
      recovery_capabilities: ["INVOCATION_STATUS_QUERY"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: ids.deployment,
        deployment_revision: 1,
        deployment_hash: hash("e"),
      },
      effective_context_ceiling_tokens: 32_000,
      effective_output_ceiling_tokens: 4_000,
      readiness: "AVAILABLE",
      selectable: true,
      unavailable_reason: null,
    } as const satisfies ProviderExecutionProfile;
    const taskCommit = vi.fn();
    const projectionCommit = vi.fn();
    const createAudited = vi.fn();
    const dispatcher = createRunBoundProviderDispatcher({
      task_artifacts: { commit: taskCommit, load: vi.fn() },
      execution_profiles: {
        list: async () => ({ ok: true, value: [unsupportedRecoveryProfile] }),
      },
      projection_store: { commit: projectionCommit } as never,
      create_audited_provider: createAudited,
      allowed_providers: ["deepseek"],
      allowed_connection_kinds: ["SYSTEM_DEPLOYMENT"],
      system_deployment_id: ids.deployment,
      required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      response_schema_version: "qa-answer@1.0.0",
      response_schema_bytes: 512,
    });

    const result = await dispatcher.invoke({
      signal: new AbortController().signal,
      lease: workerLease,
      effective_config: config,
      context_receipt: (
        loaded.value as {
          readonly context_receipt: Parameters<typeof dispatcher.invoke>[0]["context_receipt"];
        }
      ).context_receipt,
      logical_call_id: ids.command,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_RECOVERY_CAPABILITY_UNSUPPORTED" },
    });
    expect(taskCommit).not.toHaveBeenCalled();
    expect(projectionCommit).not.toHaveBeenCalled();
    expect(createAudited).not.toHaveBeenCalled();
  });

  it("fails closed on credential-like task content before projection begin or transport", async () => {
    const config = await buildWorkerEffectiveConfigFixture({
      scope: lease().scope,
      workspace_id: ids.workspace,
      principal_id: ids.principal,
      run_id: ids.run,
    });
    const workerLease = bindEffectiveConfigLease(lease(), config);
    const loaded = await createEffectiveConfigFixtureLoader(config)(workerLease);
    if (!loaded.ok) throw new Error("fixture load failed");
    const document = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@1.0.0",
      message_id: ids.event,
      accepted_event_id: ids.event,
      conversation_id: config.conversation_binding.conversation_id,
      conversation_resource_version: config.conversation_binding.resource_version,
      command_id: ids.command,
      run_id: ids.run,
      message_role: "user",
      message_type: "text",
      question: "请使用 api_key=sk-this-is-a-secret-value 查询收入",
    });
    const profile = {
      model_profile_id: config.model.resource_id,
      model_config_version: config.model.resource_revision,
      resource_hash: config.model.resource_hash,
      profile_version: config.model.profile_version,
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      display_name: "DeepSeek V4 Flash",
      adapter_version: "model-provider-adapter@1.0.0",
      certification_receipt_ref: {
        artifact_id: ids.certification,
        artifact_type: "ModelCertificationReceipt",
        ...workerLease.scope,
        run_id: ids.run,
        revision: 1,
        content_hash: hash("c"),
      },
      execution_profile_hash: hash("d"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: ids.deployment,
        deployment_revision: 1,
        deployment_hash: hash("e"),
      },
      effective_context_ceiling_tokens: 32_000,
      effective_output_ceiling_tokens: 4_000,
      readiness: "AVAILABLE",
      selectable: true,
      unavailable_reason: null,
    } as const satisfies ProviderExecutionProfile;
    const projectionCommit = vi.fn();
    const createAudited = vi.fn();
    const dispatcher = createRunBoundProviderDispatcher({
      task_artifacts: {
        commit: async () => ({
          ok: true,
          value: {
            schema_version: "provider-task-artifact-commit-result@1.0.0",
            disposition: "CREATED",
            reference: {
              artifact_id: ids.event,
              artifact_type: "ProviderTaskArtifact",
              ...workerLease.scope,
              run_id: ids.run,
              revision: 1,
              content_hash: document.content_hash,
            },
            document,
            committed_at: "2026-08-17T00:00:00.000Z",
          },
        }),
        load: vi.fn(),
      },
      execution_profiles: { list: async () => ({ ok: true, value: [profile] }) },
      projection_store: {
        commit: projectionCommit,
        committedResolverForLease: vi.fn(),
      },
      create_audited_provider: createAudited,
      allowed_providers: ["deepseek"],
      allowed_connection_kinds: ["SYSTEM_DEPLOYMENT"],
      system_deployment_id: ids.deployment,
      required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      response_schema_version: "qa-answer@1.0.0",
      response_schema_bytes: 512,
    });

    const result = await dispatcher.invoke({
      signal: new AbortController().signal,
      lease: workerLease,
      effective_config: config,
      context_receipt: (
        loaded.value as {
          readonly context_receipt: Parameters<typeof dispatcher.invoke>[0]["context_receipt"];
        }
      ).context_receipt,
      logical_call_id: ids.command,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_DATA_PROJECTION_DLP_REJECTED" },
    });
    expect(projectionCommit).not.toHaveBeenCalled();
    expect(createAudited).not.toHaveBeenCalled();
  });
});
