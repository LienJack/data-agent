import {
  buildProviderTaskArtifactDocument,
  buildSubagentCapabilityCatalogSnapshot,
  type ContextReceiptBinding,
  computeProviderTaskContextSelectionHash,
  computeProviderTaskVisibleMessageHash,
  DEFAULT_RUN_EXECUTION_POLICY,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunBoundSemanticContextResolver } from "../../src/runs/run-bound-semantic-context.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "./support/effective-config-fixture.js";

const scope = {
  app_id: "87000000-0000-4000-8000-000000000001",
  tenant_id: "87000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const principalId = "87000000-0000-4000-8000-000000000003";

describe("run-bound resolved context", () => {
  it.each(["research", "root", "task-failure", "history-mismatch"])(
    "derives exact frozen context: %s",
    async (mode) => {
      const config = await buildWorkerEffectiveConfigFixture({
        scope,
        workspace_id: scope.tenant_id,
        principal_id: principalId,
        run_id: "87000000-0000-4000-8000-000000000004",
      });
      let lease = bindEffectiveConfigLease(
        {
          scope,
          principal_id: principalId,
          outbox_id: "87000000-0000-4000-8000-000000000005",
          run_id: config.run_id,
          command_id: "87000000-0000-4000-8000-000000000006",
          command_kind: "START_L2_RESEARCH",
          attempt_id: "87000000-0000-4000-8000-000000000007",
          attempt_no: 1,
          delivery_attempt_no: 1,
          lease_duration_ms: 30_000,
          worker_id: "worker-u12",
          lease_token: 2,
          worker_fence: 3,
          expires_at: "2026-08-17T10:00:00.000Z",
          execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
          payload: { kind: "START_L2_RESEARCH" },
        },
        config,
      );
      const loaded = await createEffectiveConfigFixtureLoader(config)(lease);
      if (!loaded.ok) throw new Error("fixture failed");
      const contextReceipt = (loaded.value as { context_receipt: ContextReceiptBinding })
        .context_receipt;
      const current = {
        message_id: config.run_id,
        role: "user" as const,
        type: "text" as const,
        content: "其中下降最多的几个呢？",
        run_id: config.run_id,
      };
      const messages = [
        { ...current, content_hash: await computeProviderTaskVisibleMessageHash(current) },
      ];
      const task = await buildProviderTaskArtifactDocument({
        schema_version: "provider-task-artifact@2.0.0",
        conversation_id: config.conversation_binding.conversation_id,
        conversation_resource_version: config.conversation_binding.resource_version,
        current_message: { message_id: current.message_id, content: current.content },
        visible_messages: messages,
        context_summary_ref: null,
        context_selection_hash: await computeProviderTaskContextSelectionHash({
          conversation_id: config.conversation_binding.conversation_id,
          conversation_resource_version: config.conversation_binding.resource_version,
          current_message_id: current.message_id,
          visible_messages: messages,
          context_summary_ref: null,
        }),
      });
      const reference = {
        artifact_id: current.message_id,
        artifact_type: "ProviderTaskArtifact" as const,
        ...scope,
        run_id: config.run_id,
        revision: 1,
        content_hash: task.content_hash,
      };
      if (mode !== "research") {
        lease = {
          ...lease,
          command_kind: "START_DATA_AGENT_TEAM",
          payload: {
            schema_version: "effective-config-team-lease@3.0.0",
            kind: "START_DATA_AGENT_TEAM",
            executor_version: "ROOT_HARNESS@1",
            effective_config_ref: contextReceipt.config_ref,
            catalog_snapshot: await buildSubagentCapabilityCatalogSnapshot({
              schema_version: "subagent-capability-catalog-snapshot@1.0.0",
              catalog_id: config.run_id,
              scope,
              run_id: config.run_id,
              principal_id: principalId,
              policy_version: "root-harness@1.0.0",
              items: [],
            }),
            visible_message_refs: [mode === "history-mismatch" ? principalId : current.message_id],
          },
        };
      }
      const order: string[] = [];
      const commit = vi.fn(async () => {
        order.push("task");
        return mode === "task-failure"
          ? {
              ok: false as const,
              error: {
                code: "TASK_AUTHORITY_UNAVAILABLE",
                message: "unavailable",
                retryable: false,
              },
            }
          : {
              ok: true as const,
              value: {
                schema_version: "provider-task-artifact-commit-result@1.0.0" as const,
                disposition: "CREATED" as const,
                reference,
                document: task,
                committed_at: "2026-08-17T10:00:00.000Z",
              },
            };
      });
      const service = vi.fn(async (_capability: unknown, request: unknown) => {
        order.push("semantic");
        return { ok: true as const, value: { request } as never };
      });
      const resolver = createRunBoundSemanticContextResolver({
        capability: { authority: "test" },
        service: { resolve: service },
        task_artifacts: { commit },
      });
      if (mode === "task-failure" || mode === "history-mismatch") {
        await expect(
          resolver.resolve({ lease, effective_config: config, context_receipt: contextReceipt }),
        ).resolves.toMatchObject({
          ok: false,
          error: {
            code:
              mode === "task-failure"
                ? "TASK_AUTHORITY_UNAVAILABLE"
                : "SEMANTIC_CONTEXT_ROOT_TASK_MISMATCH",
          },
        });
        expect(service).not.toHaveBeenCalled();
        return;
      }
      await expect(
        resolver.resolve({
          lease,
          effective_config: config,
          context_receipt: contextReceipt,
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(order).toEqual(mode === "root" ? ["task", "semantic"] : ["semantic"]);
      if (mode === "root")
        expect(commit).toHaveBeenCalledWith({
          worker_lease: lease,
          conversation_binding: config.conversation_binding,
        });
      expect(service).toHaveBeenCalledWith(
        { authority: "test" },
        expect.objectContaining({
          request_id: contextReceipt.receipt_id,
          request_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          basis: {
            consumer: "RUN",
            run_id: lease.run_id,
            config_ref: contextReceipt.config_ref,
            context_receipt_ref: {
              receipt_id: contextReceipt.receipt_id,
              receipt_hash: contextReceipt.receipt_hash,
            },
            ...(mode === "root" ? { provider_task_ref: reference } : {}),
          },
        }),
      );
    },
  );

  it("rejects config substitution before invoking the authority service", async () => {
    const service = vi.fn();
    const resolver = createRunBoundSemanticContextResolver({
      capability: {},
      service: { resolve: service },
      task_artifacts: { commit: vi.fn() },
    });
    const result = await resolver.resolve({
      lease: { run_id: "87000000-0000-4000-8000-000000000010" } as never,
      effective_config: { run_id: "87000000-0000-4000-8000-000000000011" } as never,
      context_receipt: {} as never,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_CONTEXT_WORKER_AUTHORITY_MISMATCH" },
    });
    expect(service).not.toHaveBeenCalled();
  });
});
