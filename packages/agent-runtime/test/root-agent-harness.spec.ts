import { buildSubagentCapabilityCatalogSnapshot, sha256ContentHash } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildRootAgentSystemMessage,
  normalizeRootAgentProviderTurn,
  ROOT_AGENT_TOOL_ALLOWLIST,
  SUBAGENT_DELEGATION_TOOL_DESCRIPTOR,
} from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

async function catalog(profileIds: readonly string[]) {
  return buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: id(4),
    scope,
    run_id: runId,
    principal_id: id(5),
    policy_version: "root-harness@1.0.0",
    items: profileIds.map((profileId, index) => ({
      profile_ref: { profile_id: profileId, revision: index + 1, revision_hash: hash("a") },
      discovery: {
        schema_version: "subagent-discovery-descriptor@1.0.0",
        display_name: profileId,
        description: `Governed capability for ${profileId}.`,
        when_to_use: [`Use ${profileId} for its declared governed objective.`],
        when_not_to_use: ["Do not use outside the declared Artifact contract."],
        examples: [],
        accepted_input_artifact_types: [],
        produced_artifact_types: ["AnalysisReport"],
        access_mode: "READ_ONLY",
      },
    })),
  });
}

describe("Root Agent Harness", () => {
  it("keeps one canonical delegation Tool schema as catalog inventory changes", async () => {
    const before = await sha256ContentHash(
      z.toJSONSchema(SUBAGENT_DELEGATION_TOOL_DESCRIPTOR.input_schema),
    );
    await catalog(["semantic-management-agent"]);
    await catalog(["causal-analysis-agent", "semantic-management-agent"]);
    const after = await sha256ContentHash(
      z.toJSONSchema(SUBAGENT_DELEGATION_TOOL_DESCRIPTOR.input_schema),
    );

    expect(ROOT_AGENT_TOOL_ALLOWLIST).toEqual(["delegate_to_subagent@1"]);
    expect(after).toBe(before);
  });

  it("normalizes a Provider tool call into a catalog-bound candidate", async () => {
    const frozenCatalog = await catalog(["semantic-management-agent"]);
    await expect(
      normalizeRootAgentProviderTurn({
        scope,
        run_id: runId,
        catalog: frozenCatalog,
        output_text: "",
        tool_calls: [
          {
            tool_call_id: "call-semantic-dependency",
            tool_name: "delegate_to_subagent@1",
            arguments: {
              profile_id: "semantic-management-agent",
              objective: "Read the frozen graph and explain table dependencies.",
              requested_artifact_types: ["AnalysisReport"],
              input_artifact_refs: [],
              requested_budget: {
                timeout_ms: 30_000,
                max_steps: 8,
                max_input_tokens: 20_000,
                max_output_tokens: 4_000,
                max_tool_calls: 4,
                max_context_bytes: 32_768,
              },
            },
          },
        ],
      }),
    ).resolves.toMatchObject({
      kind: "TOOL_CALLS",
      tool_calls: [{ profile_id: "semantic-management-agent" }],
      catalog_snapshot_hash: frozenCatalog.snapshot_hash,
    });
  });

  it("accepts a no-tool direct answer and rejects mixed output", async () => {
    const frozenCatalog = await catalog([]);
    const direct = {
      kind: "FINAL_ANSWER",
      sections: [
        {
          kind: "GENERAL_TEXT",
          text: "同比是与上年同一时期比较。",
          basis: "GENERAL_KNOWLEDGE",
          source_message_refs: [],
        },
      ],
      public_summary: "直接解释通用概念。",
    };
    await expect(
      normalizeRootAgentProviderTurn({
        scope,
        run_id: runId,
        catalog: frozenCatalog,
        output_text: JSON.stringify(direct),
        tool_calls: [],
      }),
    ).resolves.toMatchObject({ kind: "FINAL_ANSWER" });
    await expect(
      normalizeRootAgentProviderTurn({
        scope,
        run_id: runId,
        catalog: frozenCatalog,
        output_text: JSON.stringify(direct),
        tool_calls: [
          { tool_call_id: "call-1", tool_name: "delegate_to_subagent@1", arguments: {} },
        ],
      }),
    ).rejects.toMatchObject({ code: "ROOT_AGENT_MIXED_FINAL_AND_TOOL_CALLS" });
  });

  it("projects only public Catalog metadata into the Root system message", async () => {
    const frozenCatalog = await catalog(["semantic-management-agent"]);
    const message = await buildRootAgentSystemMessage(frozenCatalog);
    expect(message).toContain("semantic-management-agent");
    expect(message).toContain("never route by keyword lists");
    expect(message).not.toMatch(/prompt_ref|prompt_hash|secret_ref/);
  });
});
