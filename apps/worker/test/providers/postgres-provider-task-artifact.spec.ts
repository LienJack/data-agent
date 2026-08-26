import {
  buildProviderTaskArtifactDocument,
  DEFAULT_RUN_EXECUTION_POLICY,
} from "@data-agent/contracts";
import type { AppCapability, PostgresProviderInvocationStore } from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";
import { createPostgresProviderTaskArtifactAuthority } from "../../src/providers/postgres-provider-task-artifact.js";

const ids = {
  app: "87000000-0000-4000-8000-000000000001",
  workspace: "87000000-0000-4000-8000-000000000002",
  principal: "87000000-0000-4000-8000-000000000003",
  run: "87000000-0000-4000-8000-000000000004",
  command: "87000000-0000-4000-8000-000000000005",
  event: "87000000-0000-4000-8000-000000000006",
  conversation: "87000000-0000-4000-8000-000000000007",
  outbox: "87000000-0000-4000-8000-000000000008",
  attempt: "87000000-0000-4000-8000-000000000009",
  config: "87000000-0000-4000-8000-000000000010",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const workerLease = {
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
  expires_at: "2026-08-16T10:05:00.000Z",
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
  payload: {
    kind: "START_L2_RESEARCH",
    effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: hash("a") },
  },
} as const;

describe("Postgres ProviderTaskArtifact authority adapter", () => {
  it("submits only lease-bound identities and accepts the DB-resolved protected question", async () => {
    const document = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@1.0.0",
      message_id: ids.event,
      accepted_event_id: ids.event,
      conversation_id: ids.conversation,
      conversation_resource_version: 3,
      command_id: ids.command,
      run_id: ids.run,
      message_role: "user",
      message_type: "text",
      question: "What is governed revenue?",
    });
    const reference = {
      artifact_id: ids.event,
      artifact_type: "ProviderTaskArtifact",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: document.content_hash,
    } as const;
    const commitTaskArtifact = vi.fn(
      async (_capability: unknown, _lease: unknown, _command: unknown) => ({
        ok: true as const,
        value: {
          schema_version: "provider-task-artifact-commit-result@1.0.0",
          disposition: "CREATED",
          reference,
          document,
          committed_at: "2026-08-16T10:00:00.000Z",
        },
      }),
    );
    const authority = createPostgresProviderTaskArtifactAuthority({
      store: { commitTaskArtifact } as unknown as PostgresProviderInvocationStore,
      capability: {} as AppCapability,
    });

    const result = await authority.commit({
      worker_lease: workerLease,
      conversation_binding: { conversation_id: ids.conversation, resource_version: 3 },
    });

    expect(result).toMatchObject({ ok: true, value: { reference, document } });
    expect(commitTaskArtifact).toHaveBeenCalledWith(expect.anything(), workerLease, {
      schema_version: "provider-task-artifact-commit@1.0.0",
      scope: {
        ...workerLease.scope,
        workspace_id: ids.workspace,
        principal_id: ids.principal,
      },
      run_id: ids.run,
      conversation_binding: { conversation_id: ids.conversation, resource_version: 3 },
    });
    expect(JSON.stringify(commitTaskArtifact.mock.calls[0]?.[2])).not.toContain(document.question);
  });
});
