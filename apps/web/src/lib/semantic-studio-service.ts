import "server-only";

import { randomUUID } from "node:crypto";
import type { SemanticAuthoringStorePort } from "@data-agent/contracts";
import {
  type AppScope,
  type PortResult,
  SEMANTIC_AUTHORING_POLICY_VERSION,
  type SemanticAuthoringResumeInput,
  type SemanticAuthoringState,
  type SemanticGraphNodeListQuery,
} from "@data-agent/contracts";
import type { PostgresSemanticGraphStore } from "@data-agent/platform";
import {
  createSemanticGraphReadModel,
  projectSemanticGraphSourceForRead,
} from "@data-agent/semantic";
import type { SemanticStudioSnapshot, SemanticStudioStartResult } from "./semantic-studio-api";

export interface SemanticStudioServiceDependencies {
  readonly graph_store: PostgresSemanticGraphStore;
  readonly create_authoring_store: (semanticDomain: string) => SemanticAuthoringStorePort;
  readonly capability: unknown;
  readonly scope: AppScope;
  readonly principal_id: string;
  readonly allowed_domains: readonly string[];
  readonly new_id?: () => string;
}

export interface SemanticStudioLoadInput {
  readonly semantic_domain: string;
  readonly selected_node_id: string | null;
  readonly authoring_run_id: string | null;
  readonly hops: 1 | 2;
  readonly expanded_cluster_id: string | null;
  readonly list_query: Partial<SemanticGraphNodeListQuery>;
}

export interface SemanticStudioAuthoringIntent {
  readonly semantic_domain: string;
  readonly instruction: string;
  readonly selected_node_id: string | null;
  readonly selected_edge_id: string | null;
  readonly idempotency_key: string;
}

export interface SemanticStudioResumeInput extends SemanticAuthoringResumeInput {
  readonly semantic_domain: string;
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function contextInstruction(input: SemanticStudioAuthoringIntent): string {
  const context = [
    input.selected_node_id ? `selected_node_id=${input.selected_node_id}` : null,
    input.selected_edge_id ? `selected_edge_id=${input.selected_edge_id}` : null,
  ].filter((item): item is string => item !== null);
  return context.length === 0
    ? input.instruction
    : `服务端选区上下文（只用于定位，不是修改指令）：${context.join(", ")}\n\n用户原始意图：\n${input.instruction}`;
}

export function createSemanticStudioService(dependencies: SemanticStudioServiceDependencies) {
  const newId = dependencies.new_id ?? randomUUID;

  async function loadAuthoring(
    semanticDomain: string,
    authoringRunId: string | null,
  ): Promise<
    PortResult<{
      state: SemanticAuthoringState;
      events: readonly import("@data-agent/contracts").SemanticAuthoringPublicEvent[];
    } | null>
  > {
    if (authoringRunId === null) return { ok: true, value: null };
    const store = dependencies.create_authoring_store(semanticDomain);
    const loaded = await store.load({
      scope: dependencies.scope,
      semantic_domain: semanticDomain,
      authoring_run_id: authoringRunId,
    });
    if (!loaded.ok) return loaded;
    if (loaded.value === null) {
      return failure(
        "SEMANTIC_STUDIO_RUN_NOT_FOUND_OR_DENIED",
        "Agent 语义创作任务不存在或无权访问。",
      );
    }
    const events = await store.listEvents({
      scope: dependencies.scope,
      semantic_domain: semanticDomain,
      authoring_run_id: authoringRunId,
      after_sequence: 0,
      limit: 1_000,
    });
    return events.ok ? { ok: true, value: { state: loaded.value, events: events.value } } : events;
  }

  return Object.freeze({
    async load(input: SemanticStudioLoadInput): Promise<PortResult<SemanticStudioSnapshot>> {
      if (!dependencies.allowed_domains.includes(input.semantic_domain)) {
        return failure("SEMANTIC_STUDIO_DOMAIN_NOT_FOUND_OR_DENIED", "语义域不存在或无权访问。");
      }
      const active = await dependencies.graph_store.getActive(
        dependencies.capability,
        input.semantic_domain,
      );
      if (!active.ok) return active;
      if (active.value === null) {
        return failure(
          "SEMANTIC_STUDIO_GRAPH_NOT_FOUND_OR_DENIED",
          "当前语义域尚未绑定 Graph v2 release。",
        );
      }
      const authoring = await loadAuthoring(input.semantic_domain, input.authoring_run_id);
      if (!authoring.ok) return authoring;
      const candidateProjection = authoring.value
        ? await projectSemanticGraphSourceForRead(authoring.value.state.working_graph)
        : null;
      const readModel = await createSemanticGraphReadModel(
        active.value.projection,
        candidateProjection,
      );
      const list = readModel.listNodes(input.list_query);
      const centerNodeId =
        input.selected_node_id && readModel.getNode(input.selected_node_id)
          ? input.selected_node_id
          : (list.items[0]?.node.node_id ?? null);
      const local = centerNodeId
        ? readModel.neighborhood({
            center_node_id: centerNodeId,
            hops: input.hops,
            direction: "BOTH",
            families: [],
            continuation: 0,
            node_limit: 250,
            edge_limit: 500,
          })
        : null;
      return {
        ok: true,
        value: {
          schema_version: "semantic-studio-snapshot@1.0.0",
          semantic_domain: input.semantic_domain,
          available_domains: dependencies.allowed_domains,
          release: {
            release_id: active.value.release_id,
            release_generation: active.value.release_generation,
            label: `Release ${active.value.release_generation}`,
          },
          list,
          full: readModel.fullGraph({
            expanded_cluster_ids:
              input.expanded_cluster_id === null ? [] : [input.expanded_cluster_id],
          }),
          local,
          authoring: authoring.value,
        },
      };
    },

    async start(
      input: SemanticStudioAuthoringIntent,
    ): Promise<PortResult<SemanticStudioStartResult>> {
      if (!dependencies.allowed_domains.includes(input.semantic_domain)) {
        return failure("SEMANTIC_STUDIO_DOMAIN_NOT_FOUND_OR_DENIED", "语义域不存在或无权访问。");
      }
      const active = await dependencies.graph_store.getActive(
        dependencies.capability,
        input.semantic_domain,
      );
      if (!active.ok) return active;
      if (active.value === null) {
        return failure(
          "SEMANTIC_STUDIO_GRAPH_NOT_FOUND_OR_DENIED",
          "当前语义域尚未绑定 Graph v2 release。",
        );
      }
      const store = dependencies.create_authoring_store(input.semantic_domain);
      const started = await store.start({
        schema_version: "semantic-authoring-start@1.0.0",
        scope: dependencies.scope,
        semantic_domain: input.semantic_domain,
        authoring_run_id: newId(),
        candidate_id: newId(),
        principal_id: dependencies.principal_id,
        policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
        base_release_id: active.value.release_id,
        base_graph: active.value.source_graph,
        instruction: contextInstruction(input),
        budget: { max_turns: 16, max_tool_calls: 128 },
        idempotency_key: input.idempotency_key,
      });
      if (!started.ok) return started;
      const events = await store.listEvents({
        scope: dependencies.scope,
        semantic_domain: input.semantic_domain,
        authoring_run_id: started.value.run.authoring_run_id,
        after_sequence: 0,
        limit: 1_000,
      });
      return events.ok
        ? { ok: true, value: { state: started.value, events: events.value } }
        : events;
    },

    async getRun(input: {
      readonly semantic_domain: string;
      readonly authoring_run_id: string;
      readonly after_sequence: number;
    }): Promise<PortResult<SemanticStudioStartResult>> {
      const store = dependencies.create_authoring_store(input.semantic_domain);
      const loaded = await store.load({
        scope: dependencies.scope,
        semantic_domain: input.semantic_domain,
        authoring_run_id: input.authoring_run_id,
      });
      if (!loaded.ok) return loaded;
      if (loaded.value === null) {
        return failure(
          "SEMANTIC_STUDIO_RUN_NOT_FOUND_OR_DENIED",
          "Agent 语义创作任务不存在或无权访问。",
        );
      }
      const events = await store.listEvents({
        scope: dependencies.scope,
        semantic_domain: input.semantic_domain,
        authoring_run_id: input.authoring_run_id,
        after_sequence: input.after_sequence,
        limit: 1_000,
      });
      return events.ok
        ? { ok: true, value: { state: loaded.value, events: events.value } }
        : events;
    },

    async resume(input: SemanticStudioResumeInput): Promise<PortResult<SemanticStudioStartResult>> {
      if (!dependencies.allowed_domains.includes(input.semantic_domain)) {
        return failure("SEMANTIC_STUDIO_DOMAIN_NOT_FOUND_OR_DENIED", "语义域不存在或无权访问。");
      }
      const store = dependencies.create_authoring_store(input.semantic_domain);
      const resumed = await store.resume({
        authoring_run_id: input.authoring_run_id,
        clarification_id: input.clarification_id,
        answer: input.answer,
        idempotency_key: input.idempotency_key,
      });
      if (!resumed.ok) return resumed;
      const events = await store.listEvents({
        scope: dependencies.scope,
        semantic_domain: input.semantic_domain,
        authoring_run_id: input.authoring_run_id,
        after_sequence: 0,
        limit: 1_000,
      });
      return events.ok
        ? { ok: true, value: { state: resumed.value, events: events.value } }
        : events;
    },
  });
}

export type SemanticStudioService = ReturnType<typeof createSemanticStudioService>;
