import type { AgentProductProfileReferenceV2 } from "@data-agent/contracts/agents";
import type { AppScope } from "@data-agent/contracts/common";
import { buildRunConfigRequestCandidate } from "@data-agent/contracts/runs";
import type { WorkspaceFileReference } from "@data-agent/contracts/workspaces";
import { createPostgresRepository } from "@data-agent/platform/persistence";
import { freezeSubagentCapabilityCatalog } from "@data-agent/platform/runs";
import { deriveRunCommandIdentities } from "@/lib/run-command-identity";
import {
  getAgentDispatchAuthority,
  getAgentProfileRegistry,
  getEffectiveConfigResolver,
  getProviderInvocationStore,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceFiles,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { workspaceRunProjection } from "@/lib/workspace-run";

type GetConversation = ReturnType<typeof getWorkspaceDataRepository>["getConversation"];
type GetWorkspaceFile = ReturnType<typeof getWorkspaceFiles>["get"];
type GetWorkspaceDefaults = ReturnType<typeof getEffectiveConfigResolver>["getWorkspaceDefaults"];
type ResolveConversationRunSelections = ReturnType<
  typeof getProviderInvocationStore
>["resolveConversationRunSelections"];
type ListDiscoverableProfiles = ReturnType<typeof getAgentProfileRegistry>["listDiscoverable"];
type ResolveRolloutPolicy = ReturnType<typeof getAgentDispatchAuthority>["resolveRolloutPolicy"];
type ResolveAndAccept = ReturnType<typeof getEffectiveConfigResolver>["resolveAndAccept"];
type GetEffectiveConfig = ReturnType<typeof getEffectiveConfigResolver>["getEffectiveConfig"];
type GetPersistedRun = ReturnType<typeof createPostgresRepository>["getRun"];

export interface StartQuestionRunDependencies {
  readonly freezeSubagentCatalog: typeof freezeSubagentCapabilityCatalog;
  readonly getConversation: GetConversation;
  readonly getEffectiveConfig: GetEffectiveConfig;
  readonly getFile: GetWorkspaceFile;
  readonly getPersistedRun: GetPersistedRun;
  readonly getWorkspaceDefaults: GetWorkspaceDefaults;
  readonly listDiscoverableProfiles: ListDiscoverableProfiles;
  readonly projectRun: typeof workspaceRunProjection;
  readonly resolveAndAccept: ResolveAndAccept;
  readonly resolveConversationRunSelections: ResolveConversationRunSelections;
  readonly resolveRolloutPolicy: ResolveRolloutPolicy;
}

export interface StartQuestionRunInput {
  readonly capability: Parameters<GetConversation>[0];
  readonly conversation_id: string;
  readonly files: readonly WorkspaceFileReference[];
  readonly idempotency_key: string;
  readonly principal_id: string;
  readonly question: string;
  readonly rollout_bootstrap_mode: string | undefined;
  readonly scope: AppScope;
  readonly workspace_id: string;
  readonly expected_subagent_profile_refs?: readonly AgentProductProfileReferenceV2[];
  readonly acceptance_fence?: {
    readonly campaign_id: string;
    readonly run_id: string;
    readonly claim_fence_token: string;
  };
}

const inherited = { mode: "INHERIT_DEFAULT" } as const;

function productionDependencies(): StartQuestionRunDependencies {
  const resolver = getEffectiveConfigResolver();
  const repository = createPostgresRepository(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
  );
  return {
    freezeSubagentCatalog: freezeSubagentCapabilityCatalog,
    getConversation: (...args) => getWorkspaceDataRepository().getConversation(...args),
    getEffectiveConfig: (...args) => resolver.getEffectiveConfig(...args),
    getFile: (...args) => getWorkspaceFiles().get(...args),
    getPersistedRun: (...args) => repository.getRun(...args),
    getWorkspaceDefaults: (...args) => resolver.getWorkspaceDefaults(...args),
    listDiscoverableProfiles: (...args) => getAgentProfileRegistry().listDiscoverable(...args),
    projectRun: workspaceRunProjection,
    resolveAndAccept: (...args) => resolver.resolveAndAccept(...args),
    resolveConversationRunSelections: (...args) =>
      getProviderInvocationStore().resolveConversationRunSelections(...args),
    resolveRolloutPolicy: (...args) => getAgentDispatchAuthority().resolveRolloutPolicy(...args),
  };
}

export function createStartQuestionRunUseCase(
  configuredDependencies?: StartQuestionRunDependencies,
) {
  return async function startQuestionRun(input: StartQuestionRunInput) {
    const dependencies = configuredDependencies ?? productionDependencies();
    const conversation = await dependencies.getConversation(
      input.capability,
      input.conversation_id,
    );
    if (!conversation.ok) return { error: conversation.error, kind: "ERROR" } as const;
    if (!conversation.value) {
      return {
        error: {
          code: "CONVERSATION_NOT_FOUND_OR_DENIED",
          message: "对话不存在或无权访问。",
          retryable: false,
        },
        kind: "ERROR",
      } as const;
    }
    const conversationVersion = conversation.value.resource_version;
    if (
      typeof conversationVersion !== "number" ||
      !Number.isSafeInteger(conversationVersion) ||
      conversationVersion <= 0
    ) {
      return {
        error: {
          code: "CONVERSATION_VERSION_REQUIRED",
          message: "对话缺少可冻结的资源版本。",
          retryable: true,
        },
        kind: "ERROR",
      } as const;
    }

    const orderedFiles = [...input.files].sort((left, right) =>
      left.file_id.localeCompare(right.file_id),
    );
    if (new Set(orderedFiles.map((file) => file.file_id)).size !== orderedFiles.length) {
      return {
        error: { code: "RUN_INPUT_INVALID", message: "附件引用不得重复。", retryable: false },
        kind: "ERROR",
      } as const;
    }
    for (const fileRef of orderedFiles) {
      const file = await dependencies.getFile(input.capability, fileRef);
      if (!file.ok) return { error: file.error, kind: "ERROR" } as const;
      if (file.value?.status !== "READY") {
        return {
          error: {
            code: "WORKSPACE_FILE_NOT_AVAILABLE",
            message: "附件尚未通过扫描或已不可用。",
            retryable: false,
          },
          kind: "ERROR",
        } as const;
      }
    }

    const [defaults, selections, profiles] = await Promise.all([
      dependencies.getWorkspaceDefaults(input.capability),
      dependencies.resolveConversationRunSelections(input.capability, {
        conversation_id: conversation.value.conversation_id,
        expected_resource_version: conversationVersion,
      }),
      dependencies.listDiscoverableProfiles(input.capability),
    ]);
    if (!defaults.ok) return { error: defaults.error, kind: "ERROR" } as const;
    if (!selections.ok) return { error: selections.error, kind: "ERROR" } as const;
    if (!profiles.ok) return { error: profiles.error, kind: "ERROR" } as const;
    if (input.expected_subagent_profile_refs) {
      const expected = [...input.expected_subagent_profile_refs].sort((left, right) =>
        left.profile_id.localeCompare(right.profile_id),
      );
      const actual = profiles.value
        .map((item) => ({
          profile_id: item.revision.profile_id,
          revision: item.revision.revision,
          revision_hash: item.revision.revision_hash,
        }))
        .sort((left, right) => left.profile_id.localeCompare(right.profile_id));
      if (
        actual.length !== expected.length ||
        actual.some(
          (item, index) =>
            item.profile_id !== expected[index]?.profile_id ||
            item.revision !== expected[index]?.revision ||
            item.revision_hash !== expected[index]?.revision_hash,
        )
      ) {
        return {
          error: {
            code: "SUBAGENT_CATALOG_PROFILE_SET_MISMATCH",
            message: "Frozen acceptance Profile set changed before Run catalog publication.",
            retryable: false,
          },
          kind: "ERROR",
        } as const;
      }
    }
    if (!defaults.value) {
      return {
        error: {
          code: "WORKSPACE_DEFAULTS_NOT_CONFIGURED",
          message: "工作空间尚未配置 Run Defaults。",
          retryable: false,
        },
        kind: "ERROR",
      } as const;
    }

    const identities = deriveRunCommandIdentities({
      workspace_id: input.workspace_id,
      principal_id: input.principal_id,
      idempotency_key: input.idempotency_key,
    });
    const rollout = await dependencies.resolveRolloutPolicy(
      input.capability,
      input.rollout_bootstrap_mode,
    );
    if (!rollout.ok) return { error: rollout.error, kind: "ERROR" } as const;
    const catalogSnapshot = await dependencies.freezeSubagentCatalog({
      run_id: identities.run_id,
      scope: input.scope,
      principal_id: input.principal_id,
      enabled_profiles: profiles.value,
      policy_version: rollout.value.policy_version,
    });
    const configRequest = await buildRunConfigRequestCandidate({
      schema_version: "run-config-request@1.0.0",
      operation: "QUESTION_RUN",
      workspace_id: input.workspace_id,
      run_id: identities.run_id,
      idempotency_key: input.idempotency_key,
      conversation_ref: {
        conversation_id: conversation.value.conversation_id,
        expected_resource_version: conversationVersion,
      },
      defaults_ref: defaults.value.defaults_ref,
      overrides: {
        model: {
          mode: "RESOURCE_IDS",
          resources: [
            {
              resource_id: selections.value.model_profile_id,
              expected_revision: selections.value.model_config_version,
            },
          ],
        },
        datasource: {
          mode: "RESOURCE_IDS",
          resources: [
            {
              resource_id: selections.value.datasource_id,
              expected_revision: selections.value.datasource_resource_version,
            },
          ],
        },
        files:
          orderedFiles.length === 0
            ? inherited
            : {
                mode: "RESOURCE_IDS",
                resources: orderedFiles.map((file) => ({
                  resource_id: file.file_id,
                  expected_revision: file.revision,
                })),
              },
        knowledge: inherited,
        mcp_servers: inherited,
        skills: inherited,
        egress: null,
      },
      mentions: [],
    });
    if (configRequest.operation !== "QUESTION_RUN") {
      throw new TypeError("QUESTION_RUN_CONFIG_BUILD_FAILED");
    }
    const accepted = await dependencies.resolveAndAccept(input.capability, {
      request: configRequest,
      ...(input.acceptance_fence ? { acceptance_fence: input.acceptance_fence } : {}),
      command: {
        run_id: identities.run_id,
        command_id: identities.command_id,
        event_id: identities.event_id,
        outbox_id: identities.outbox_id,
        audit_id: identities.audit_id,
        idempotency_key: input.idempotency_key,
        question: input.question,
        subagent_catalog_snapshot: catalogSnapshot,
      },
    });
    if (!accepted.ok) return { error: accepted.error, kind: "ERROR" } as const;
    if (accepted.value.operation !== "QUESTION_RUN" || accepted.value.admission !== "READY") {
      return { kind: "RESOLUTION_REQUIRED", resolution: accepted.value } as const;
    }

    const [persisted, effectiveConfig] = await Promise.all([
      dependencies.getPersistedRun(input.capability, { run_id: identities.run_id }),
      dependencies.getEffectiveConfig(input.capability, {
        run_id: identities.run_id,
        config_ref: accepted.value.effective_config_ref,
        conversation_ref: configRequest.conversation_ref,
      }),
    ]);
    if (!persisted.ok) return { error: persisted.error, kind: "ERROR" } as const;
    if (!effectiveConfig.ok) return { error: effectiveConfig.error, kind: "ERROR" } as const;
    if (!persisted.value) {
      return {
        error: {
          code: "PERSISTENCE_TRANSACTION_FAILED",
          message: "Run 已接受但当前无法读取权威投影。",
          retryable: true,
        },
        kind: "ERROR",
      } as const;
    }
    return {
      kind: "CREATED",
      projection: dependencies.projectRun(
        persisted.value,
        effectiveConfig.value.datasource.resource_id,
      ),
    } as const;
  };
}

export const startQuestionRun = createStartQuestionRunUseCase();
