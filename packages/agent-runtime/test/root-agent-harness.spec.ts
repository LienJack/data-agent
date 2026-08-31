import { buildSubagentCapabilityCatalogSnapshot, sha256ContentHash } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildRootAgentSystemMessage,
  normalizeRootAgentProviderTurn,
  ROOT_AGENT_TOOL_ALLOWLIST,
  rootAgentFinalAnswerOutputSchema,
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
  it("supplies the executable final-answer schema for AUTO text completion", async () => {
    const message = await buildRootAgentSystemMessage(await catalog(["semantic-management-agent"]));
    const prefix = "Root final-answer JSON Schema: ";
    const schemaLine = message.split("\n").find((line) => line.startsWith(prefix));
    expect(schemaLine).toBeDefined();
    expect(JSON.parse(schemaLine?.slice(prefix.length) ?? "null")).toEqual(
      z.toJSONSchema(rootAgentFinalAnswerOutputSchema),
    );
    expect(message).toContain("a possible future user request is not remaining work");
    expect(message).toContain("Do not emit a placeholder or no-op delegation");
    expect(message).toContain("CONTINUATION_INPUT does not force another delegation");
  });

  it("asks for clarification from accepted unresolved semantics without repeating lookup or SQL", async () => {
    const message = await buildRootAgentSystemMessage(await catalog(["semantic-management-agent"]));
    expect(message).toContain("non-empty unresolved_ambiguities");
    expect(message).toContain("projection.context.unresolved_ambiguities");
    expect(message).toContain("ask a concise clarification question");
    expect(message).toContain("Do not repeat the same lookup or delegate Text2SQL");
    expect(message).toContain("not proof of global absence or empty query results");
  });

  it("allows a terminal answer to cite the accepted AnalysisReport", () => {
    expect(
      rootAgentFinalAnswerOutputSchema.safeParse({
        kind: "FINAL_ANSWER",
        sections: [
          {
            kind: "ARTIFACT_FACTS",
            artifact_ref: {
              artifact_id: id(6),
              artifact_type: "AnalysisReport",
              ...scope,
              run_id: runId,
              revision: 1,
              content_hash: hash("b"),
            },
            fact_selectors: ["projection.sections", "projection.title"],
          },
        ],
        public_summary: "基于已验收分析报告回答。",
      }).success,
    ).toBe(true);
  });

  it("rejects the retired same-turn dependency arguments", async () => {
    const frozenCatalog = await buildSubagentCapabilityCatalogSnapshot({
      schema_version: "subagent-capability-catalog-snapshot@1.0.0",
      catalog_id: id(4),
      scope,
      run_id: runId,
      principal_id: id(5),
      policy_version: "root-harness@1.0.0",
      items: [
        {
          profile_ref: {
            profile_id: "governed-text2sql-agent",
            revision: 3,
            revision_hash: hash("a"),
          },
          discovery: {
            schema_version: "subagent-discovery-descriptor@1.0.0",
            display_name: "Text2SQL",
            description: "Produces accepted QueryEvidence.",
            when_to_use: ["Use for governed database values."],
            when_not_to_use: ["Do not use for prose-only work."],
            examples: [],
            accepted_input_artifact_types: [],
            produced_artifact_types: ["QueryEvidence"],
            access_mode: "READ_ONLY",
          },
        },
        {
          profile_ref: {
            profile_id: "governed-analysis-agent",
            revision: 1,
            revision_hash: hash("b"),
          },
          discovery: {
            schema_version: "subagent-discovery-descriptor@1.0.0",
            display_name: "Analysis",
            description: "Runs governed statistical analysis.",
            when_to_use: ["Use for multi-step analysis."],
            when_not_to_use: ["Do not use for simple lookups."],
            examples: [],
            accepted_input_artifact_types: [],
            produced_artifact_types: ["AnalysisReport"],
            access_mode: "READ_ONLY",
          },
        },
      ].sort((left, right) =>
        left.profile_ref.profile_id.localeCompare(right.profile_ref.profile_id),
      ),
    });
    const budget = {
      timeout_ms: 30_000,
      max_steps: 8,
      max_input_tokens: 20_000,
      max_output_tokens: 4_000,
      max_tool_calls: 4,
      max_context_bytes: 32_768,
    };
    const promise = normalizeRootAgentProviderTurn({
      scope,
      run_id: runId,
      catalog: frozenCatalog,
      output_text: "",
      tool_calls: [
        {
          tool_call_id: "query",
          tool_name: "delegate_to_subagent@2",
          arguments: {
            profile_id: "governed-text2sql-agent",
            objective: "Prepare accepted evidence.",
            requested_artifact_types: ["QueryEvidence"],
            input_artifact_refs: [],
            upstream_accepted_output: {
              producer_tool_call_id: "not-authoritative",
              artifact_type: "QueryEvidence",
            },
            requested_budget: budget,
          },
        },
      ],
    });

    await expect(promise).rejects.toMatchObject({
      code: "ROOT_AGENT_TOOL_CALL_INVALID",
    });
  });

  it("keeps one canonical delegation Tool schema as catalog inventory changes", async () => {
    const before = await sha256ContentHash(
      z.toJSONSchema(SUBAGENT_DELEGATION_TOOL_DESCRIPTOR.input_schema),
    );
    await catalog(["semantic-management-agent"]);
    await catalog(["causal-analysis-agent", "semantic-management-agent"]);
    const after = await sha256ContentHash(
      z.toJSONSchema(SUBAGENT_DELEGATION_TOOL_DESCRIPTOR.input_schema),
    );

    expect(ROOT_AGENT_TOOL_ALLOWLIST).toEqual(["delegate_to_subagent@2"]);
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
            tool_name: "delegate_to_subagent@2",
            arguments: {
              profile_id: "semantic-management-agent",
              objective: "Read the frozen graph and explain table dependencies.",
              output_usage: "FINAL_ANSWER_EVIDENCE",
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

  it("accepts a no-tool direct answer and treats a native tool call as authoritative", async () => {
    const frozenCatalog = await catalog(["semantic-management-agent"]);
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
        output_text: "This provider-side preamble is non-authoritative.",
        tool_calls: [
          {
            tool_call_id: "call-1",
            tool_name: "delegate_to_subagent@2",
            arguments: {
              profile_id: "semantic-management-agent",
              objective: "Explain the frozen semantic definition.",
              output_usage: "FINAL_ANSWER_EVIDENCE",
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
      tool_calls: [
        {
          profile_id: "semantic-management-agent",
          output_usage: "FINAL_ANSWER_EVIDENCE",
        },
      ],
    });
  });

  it("projects only public Catalog metadata into the Root system message", async () => {
    const frozenCatalog = await catalog(["semantic-management-agent"]);
    const message = await buildRootAgentSystemMessage(frozenCatalog);
    expect(z.toJSONSchema(SUBAGENT_DELEGATION_TOOL_DESCRIPTOR.input_schema).required).toContain(
      "output_usage",
    );
    expect(message).toContain("semantic-management-agent");
    expect(message).toContain("Never route by keyword lists");
    expect(message).toContain("frozen Agent Card descriptions");
    expect(message).toContain("generic textbook answer");
    expect(message).toContain("no accepted result Artifact is visible");
    expect(message).toContain("Never invent an Artifact reference");
    expect(message).toContain("native tool call");
    expect(message).toContain("Decide only the next useful action");
    expect(message).toContain("only through input_artifact_refs");
    expect(message).toContain("Multiple calls in one response");
    expect(message).toContain("FINAL_ANSWER_EVIDENCE");
    expect(message).toContain("CONTINUATION_INPUT");
    expect(message).toContain("simple database lookup");
    expect(message).toContain(
      "depends on a governed metric, derived formula, period comparison, ratio, complete-period boundary, or relationship contract",
    );
    expect(message).toContain(
      "delegate Semantic with CONTINUATION_INPUT before delegating Text2SQL",
    );
    expect(message).toContain(
      "A physical-row lookup of explicit fields does not require this semantic prerequisite",
    );
    expect(message).toContain("completed governed-analysis-agent observation");
    expect(message).toContain("AnalysisReport with CONTINUATION_INPUT is not terminal");
    expect(message).toContain("distinct management synthesis from accepted analytical findings");
    expect(message).toContain('fact_selectors:["projection.sections","projection.title"]');
    expect(message).toContain("must not delegate another analysis");
    expect(message).toContain("request_scoped_interpretation");
    expect(message).toContain("current Run only");
    expect(message).toContain("Historical assistant messages are not current-Run Tool Results");
    expect(message).toContain("re-establish inherited comparison and time-window semantics");
    expect(message).toContain("Do not copy historical month rankings or dates into SQL objectives");
    expect(message).toContain("asks only for the governed definition, formula, time grain");
    expect(message).toContain("Do not delegate Text2SQL unless the user also requests actual rows");
    expect(message).toContain(
      "A future intention to view a metric does not itself request current values",
    );
    expect(message).toContain(
      "delegating Text2SQL is invalid even when the interpretation is executable",
    );
    expect(message).toContain("Do not expose internal index");
    expect(message).not.toContain("upstream_accepted_output");
    expect(message).not.toContain("producer_delegation_key");
    expect(message).toContain('{"kind":"FINAL_ANSWER","sections"');
    expect(message).toContain('Never output a "final_answer" wrapper');
    expect(message).not.toMatch(/prompt_ref|prompt_hash|secret_ref/);
  });
});
