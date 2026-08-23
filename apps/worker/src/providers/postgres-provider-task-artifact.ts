import {
  commitProviderTaskArtifactResultSchema,
  loadProviderTaskArtifactResultSchema,
  type PortResult,
  type RunWorkLease,
} from "@data-agent/contracts";
import type { AppCapability, PostgresProviderInvocationStore } from "@data-agent/platform";
import type { z } from "zod";

export type CommittedProviderTaskArtifact = z.infer<typeof commitProviderTaskArtifactResultSchema>;
export type LoadedProviderTaskArtifact = z.infer<typeof loadProviderTaskArtifactResultSchema>;

export interface ProviderTaskArtifactAuthority {
  commit(input: {
    readonly worker_lease: RunWorkLease;
    readonly conversation_binding: {
      readonly conversation_id: string;
      readonly resource_version: number;
    };
  }): Promise<PortResult<CommittedProviderTaskArtifact>>;
  load(input: {
    readonly worker_lease: RunWorkLease;
    readonly reference: CommittedProviderTaskArtifact["reference"];
  }): Promise<PortResult<LoadedProviderTaskArtifact>>;
}

function invalid<T>(message: string): PortResult<T> {
  return {
    ok: false,
    error: { code: "PROVIDER_TASK_ARTIFACT_DATABASE_CONTRACT_INVALID", message, retryable: false },
  };
}

export function createPostgresProviderTaskArtifactAuthority(input: {
  readonly store: PostgresProviderInvocationStore;
  readonly capability: AppCapability;
}): ProviderTaskArtifactAuthority {
  return Object.freeze({
    async commit({
      worker_lease: workerLease,
      conversation_binding: conversationBinding,
    }: Parameters<ProviderTaskArtifactAuthority["commit"]>[0]): Promise<
      PortResult<CommittedProviderTaskArtifact>
    > {
      const result = await input.store.commitTaskArtifact(input.capability, workerLease, {
        schema_version: "provider-task-artifact-commit@1.0.0",
        scope: {
          ...workerLease.scope,
          workspace_id: workerLease.scope.tenant_id,
          principal_id: workerLease.principal_id,
        },
        run_id: workerLease.run_id,
        conversation_binding: conversationBinding,
      });
      if (result.ok !== true) return { ok: false, error: result.error };
      const parsed = commitProviderTaskArtifactResultSchema.safeParse(result.value);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : invalid<CommittedProviderTaskArtifact>("Provider Task commit result 未通过严格合同。");
    },

    async load({
      worker_lease: workerLease,
      reference,
    }: Parameters<ProviderTaskArtifactAuthority["load"]>[0]): Promise<
      PortResult<LoadedProviderTaskArtifact>
    > {
      const result = await input.store.loadTaskArtifact(input.capability, {
        schema_version: "provider-task-artifact-load@1.0.0",
        scope: {
          ...workerLease.scope,
          workspace_id: workerLease.scope.tenant_id,
          principal_id: workerLease.principal_id,
        },
        run_id: workerLease.run_id,
        reference,
      });
      if (result.ok !== true) return { ok: false, error: result.error };
      const parsed = loadProviderTaskArtifactResultSchema.safeParse(result.value);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : invalid<LoadedProviderTaskArtifact>("Provider Task load result 未通过严格合同。");
    },
  });
}
