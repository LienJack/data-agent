import {
  type AgentTurnToolDescriptor,
  authorizeAgentTurnRequest,
  authorizeModelProviderInvocation,
  type ModelProviderEvent,
  type ModelProviderPort,
  SEMANTIC_AUTHORING_POLICY_VERSION,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { ModelProviderAgentTurnAdapter } from "../src/semantic-authoring/model-provider-agent-turn.js";
import { makeAvailableProfile, modelFixtureIds, modelFixtureScope } from "./model-fixtures.js";

const hash = `sha256:${"a".repeat(64)}` as const;
const candidateId = "10000000-0000-4000-8000-000000000011";
const principalId = "10000000-0000-4000-8000-000000000012";

const tools: AgentTurnToolDescriptor[] = [
  {
    name: "search_semantic_nodes",
    description: "搜索语义节点",
    input_schema: { type: "object" },
  },
];

function authorizedTurn() {
  return authorizeAgentTurnRequest(
    {
      schema_version: "semantic-agent-turn@1.0.0",
      request_id: modelFixtureIds.request,
      scope: modelFixtureScope,
      authoring_run_id: modelFixtureIds.run,
      candidate_id: candidateId,
      principal_id: principalId,
      policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
      turn_index: 1,
      messages: [{ role: "user", content: "新增成交商品数" }],
      tools,
      budget: { timeout_ms: 1_000, max_input_tokens: 100, max_output_tokens: 100 },
    },
    {
      scope: modelFixtureScope,
      authoring_run_id: modelFixtureIds.run,
      candidate_id: candidateId,
      principal_id: principalId,
      policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
      tool_names: ["search_semantic_nodes"],
    },
  );
}

function provider(events: readonly ModelProviderEvent[]): ModelProviderPort {
  return {
    async *stream() {
      for (const event of events) yield event;
    },
  };
}

describe("ModelProviderAgentTurnAdapter", () => {
  it("returns tool-call candidates without executing any Graph mutation", async () => {
    const profile = await makeAvailableProfile({ provider: "openai", model_id: "gpt-5.4-mini" });
    let invocationCount = 0;
    const commonEvent = {
      schema_version: "semantic-provider@1",
      request_id: modelFixtureIds.request,
      attempt_id: modelFixtureIds.attempt,
      scope: modelFixtureScope,
      run_id: modelFixtureIds.run,
      provider: profile.provider,
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      model_id: profile.model_id,
      observed_at: "2026-08-15T00:00:00.000Z",
    } as const;
    const adapter = new ModelProviderAgentTurnAdapter({
      provider: provider([
        { ...commonEvent, sequence: 0, event_type: "STARTED" },
        {
          ...commonEvent,
          sequence: 1,
          event_type: "TOOL_CALL_CANDIDATE",
          tool_call_id: "call-search",
          tool_name: "search_semantic_nodes",
          arguments: { query: "成交商品数", node_types: ["METRIC"], limit: 10 },
        },
        {
          ...commonEvent,
          sequence: 2,
          event_type: "COMPLETED",
          output_text: "",
          response_hash: hash,
          usage: {
            availability: "AVAILABLE",
            source: "PROVIDER_REPORTED",
            input_tokens: 10,
            output_tokens: 5,
            tool_calls: 1,
            unavailable_reason: null,
          },
        },
      ]),
      async create_invocation(material) {
        invocationCount += 1;
        return authorizeModelProviderInvocation(
          {
            schema_version: "semantic-provider@1",
            request_id: material.turn.request_id,
            attempt_id: modelFixtureIds.attempt,
            scope: material.turn.scope,
            run_id: material.turn.authoring_run_id,
            provider: profile.provider,
            profile_id: profile.profile_id,
            profile_version: profile.profile_version,
            model_id: profile.model_id,
            task_ref: {
              artifact_id: modelFixtureIds.task,
              artifact_type: "SemanticSourceBundle",
              ...material.turn.scope,
              run_id: material.turn.authoring_run_id,
              revision: material.turn.turn_index,
              content_hash: hash,
            },
            context_refs: [],
            messages: material.messages,
            tool_allowlist: material.tool_allowlist,
            response_schema_version: "semantic-agent-turn@1.0.0",
            budget: material.budget,
          },
          async () => profile,
        );
      },
    });

    const result = await adapter.turn(authorizedTurn());
    expect(result).toMatchObject({
      terminal: "TOOL_CALLS",
      tool_calls: [{ tool_name: "search_semantic_nodes" }],
    });
    expect(invocationCount).toBe(1);
    expect(adapter).not.toHaveProperty("store");
    expect(adapter).not.toHaveProperty("toolExecutor");
  });

  it("fails closed when the invocation factory expands authority", async () => {
    const profile = await makeAvailableProfile({ provider: "openai", model_id: "gpt-5.4-mini" });
    const adapter = new ModelProviderAgentTurnAdapter({
      provider: provider([]),
      async create_invocation(material) {
        return authorizeModelProviderInvocation(
          {
            schema_version: "semantic-provider@1",
            request_id: material.turn.request_id,
            attempt_id: modelFixtureIds.attempt,
            scope: material.turn.scope,
            run_id: material.turn.authoring_run_id,
            provider: profile.provider,
            profile_id: profile.profile_id,
            profile_version: profile.profile_version,
            model_id: profile.model_id,
            task_ref: {
              artifact_id: modelFixtureIds.task,
              artifact_type: "SemanticSourceBundle",
              ...material.turn.scope,
              run_id: material.turn.authoring_run_id,
              revision: 1,
              content_hash: hash,
            },
            context_refs: [],
            messages: material.messages,
            tool_allowlist: [...material.tool_allowlist, "publish_semantic_release"],
            response_schema_version: "semantic-agent-turn@1.0.0",
            budget: material.budget,
          },
          async () => profile,
        );
      },
    });
    await expect(adapter.turn(authorizedTurn())).resolves.toMatchObject({
      terminal: "FAILED",
      reason_code: "SEMANTIC_AGENT_PROVIDER_AUTHORITY_MISMATCH",
    });
  });
});
