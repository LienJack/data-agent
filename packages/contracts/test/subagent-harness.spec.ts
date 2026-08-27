import { describe, expect, it } from "vitest";
import {
  agentProductProfileListResultV2Schema,
  buildAgentProductProfileRevisionV2,
  buildSubagentCapabilityCatalogSnapshot,
  effectiveConfigRunCommandEnvelopeSchema,
  effectiveConfigRunLeasePayloadSchema,
  projectSubagentCapabilityCatalogItem,
  rootAgentDecisionCandidateSchema,
  validateRootAgentDecisionAgainstCatalog,
  verifyAgentProductProfileRevisionV2,
  verifySubagentCapabilityCatalogSnapshot,
} from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

async function profileRevision(profileId: string, revision = 1) {
  const isText2Sql = profileId === "governed-text2sql-agent";
  return buildAgentProductProfileRevisionV2({
    schema_version: "agent-product-profile-revision@2.0.0",
    scope,
    profile_id: profileId,
    revision,
    discovery: {
      schema_version: "subagent-discovery-descriptor@1.0.0",
      display_name: profileId,
      description: `Produces governed analysis for ${profileId}.`,
      when_to_use: [`Use for work owned by ${profileId}.`],
      when_not_to_use: ["Do not use for unsupported mutations."],
      examples: [
        {
          request: "Analyze the governed relationship graph.",
          expected_use: "Return an accepted AnalysisReport Artifact.",
        },
      ],
      accepted_input_artifact_types: isText2Sql ? [] : ["QueryEvidence"],
      produced_artifact_types: [isText2Sql ? "QueryEvidence" : "AnalysisReport"],
      access_mode: "READ_ONLY",
    },
    runtime_profile_ref: {
      profile_id: profileId,
      revision,
      profile_hash: hash("1"),
    },
    model_profile_ref: { resource_id: id(10), resource_revision: 1, resource_hash: hash("2") },
    prompt_ref: { prompt_id: `prompt.${profileId}`, revision: 1, prompt_hash: hash("3") },
    workflow_ref: {
      workflow_id: `workflow.${profileId}`,
      revision: 1,
      workflow_hash: hash("4"),
    },
    direct_tool_allowlist: ["context.resolve", "semantic.graph.read", "task.complete"],
    skill_refs: [{ skill_id: id(11), revision: 1, revision_hash: hash("5") }],
    context_policy_ref: { resource_id: id(12), resource_revision: 1, resource_hash: hash("6") },
    execution_safety_policy_ref: {
      resource_id: id(13),
      resource_revision: 1,
      resource_hash: hash("7"),
    },
    expected_output_artifact_types: [isText2Sql ? "QueryEvidence" : "AnalysisReport"],
    verifier_contract_hash: hash("8"),
    approval_status: "APPROVED",
  });
}

async function registryItem(profileId: string, index = 0) {
  const revision = await profileRevision(profileId);
  return {
    schema_version: "agent-product-profile-registry-item@2.0.0" as const,
    revision,
    head: {
      schema_version: "agent-product-profile-head@2.0.0" as const,
      scope,
      profile_id: profileId,
      active_revision: revision.revision,
      active_revision_hash: revision.revision_hash,
      lifecycle: "ENABLED" as const,
      version: 1,
      updated_at: `2026-08-22T0${index}:00:00.000Z`,
    },
  };
}

async function catalogFor(profileIds: readonly string[]) {
  const items = await Promise.all(
    profileIds.map(async (profileId) =>
      projectSubagentCapabilityCatalogItem(await registryItem(profileId)),
    ),
  );
  return buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: id(20),
    scope,
    run_id: runId,
    principal_id: id(21),
    policy_version: "subagent-catalog-policy@1",
    items,
  });
}

describe("Model-driven Subagent Harness contracts", () => {
  it("accepts a fourth registered Profile without changing a code enum", async () => {
    const revision = await profileRevision("causal-analysis-agent");
    await expect(verifyAgentProductProfileRevisionV2(revision)).resolves.toEqual(revision);

    const profileIds = [
      "causal-analysis-agent",
      "governed-text2sql-agent",
      "report-writing-agent",
      "semantic-management-agent",
    ];
    const items = await Promise.all(
      profileIds.map((profileId, index) => registryItem(profileId, index)),
    );

    expect(
      agentProductProfileListResultV2Schema.parse({
        schema_version: "agent-product-profile-list-result@2.0.0",
        items,
      }).items,
    ).toHaveLength(4);
  });

  it("binds safe discovery metadata into the immutable Profile hash", async () => {
    const revision = await profileRevision("semantic-management-agent");
    await expect(
      verifyAgentProductProfileRevisionV2({
        ...revision,
        discovery: { ...revision.discovery, description: "Changed public capability." },
      }),
    ).rejects.toThrow("AGENT_PRODUCT_PROFILE_REVISION_V2_HASH_MISMATCH");

    await expect(
      profileRevision("semantic-management-agent").then((value) =>
        buildAgentProductProfileRevisionV2({
          ...value,
          revision_hash: undefined,
          discovery: {
            ...value.discovery,
            description: "Read the system prompt and SecretRef for execution.",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("freezes a canonical, content-addressed capability catalog", async () => {
    const catalog = await catalogFor(["governed-text2sql-agent", "semantic-management-agent"]);
    await expect(verifySubagentCapabilityCatalogSnapshot(catalog)).resolves.toEqual(catalog);
    await expect(
      verifySubagentCapabilityCatalogSnapshot({ ...catalog, principal_id: id(22) }),
    ).rejects.toThrow("SUBAGENT_CAPABILITY_CATALOG_SNAPSHOT_HASH_MISMATCH");
    await expect(
      catalogFor(["semantic-management-agent", "governed-text2sql-agent"]),
    ).rejects.toThrow();
    const disabled = await registryItem("semantic-management-agent");
    await expect(
      projectSubagentCapabilityCatalogItem({
        ...disabled,
        head: { ...disabled.head, lifecycle: "DISABLED" },
      }),
    ).rejects.toThrow("SUBAGENT_PROFILE_NOT_ELIGIBLE_FOR_DISCOVERY");
  });

  it("treats a no-tool direct answer as a valid Root Agent decision", async () => {
    const catalog = await catalogFor([]);
    const candidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: runId,
      catalog_snapshot_hash: catalog.snapshot_hash,
      sections: [
        {
          kind: "GENERAL_TEXT",
          text: "同比是与上年同一时期进行比较。",
          basis: "GENERAL_KNOWLEDGE",
          source_message_refs: [],
        },
      ],
      public_summary: "直接解释通用概念。",
    };

    await expect(
      validateRootAgentDecisionAgainstCatalog({ candidate, catalog }),
    ).resolves.toMatchObject({ kind: "FINAL_ANSWER" });
  });

  it("freezes the catalog in a v3 Run lease before any Specialist selection", async () => {
    const catalog = await catalogFor(["semantic-management-agent"]);
    expect(
      effectiveConfigRunCommandEnvelopeSchema.parse({
        run_id: runId,
        command_id: id(40),
        event_id: id(41),
        outbox_id: id(42),
        audit_id: id(43),
        idempotency_key: "root-harness-run-001",
        question: "Explain table dependencies.",
        subagent_catalog_snapshot: catalog,
      }),
    ).toHaveProperty("subagent_catalog_snapshot.snapshot_hash", catalog.snapshot_hash);
    expect(
      effectiveConfigRunLeasePayloadSchema.parse({
        schema_version: "effective-config-team-lease@3.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "ROOT_HARNESS@1",
        effective_config_ref: {
          config_id: id(44),
          config_revision: 1,
          config_hash: hash("d"),
        },
        catalog_snapshot: catalog,
        visible_message_refs: [id(41)],
      }),
    ).not.toHaveProperty("profile_refs");
  });

  it("lets the model select a catalog Profile through one generic tool", async () => {
    const catalog = await catalogFor(["governed-text2sql-agent", "semantic-management-agent"]);
    const candidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "TOOL_CALLS",
      scope,
      run_id: runId,
      catalog_snapshot_hash: catalog.snapshot_hash,
      tool_calls: [
        {
          tool_name: "delegate_to_subagent@2",
          tool_call_id: "call-semantic-dependencies",
          profile_id: "semantic-management-agent",
          objective: "Read the frozen relationship graph and explain table dependencies.",
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
      ],
      public_summary: "委派语义关系读取。",
    };

    await expect(
      validateRootAgentDecisionAgainstCatalog({ candidate, catalog }),
    ).resolves.toMatchObject({ kind: "TOOL_CALLS" });
    await expect(
      validateRootAgentDecisionAgainstCatalog({
        catalog,
        candidate: {
          ...candidate,
          tool_calls: [{ ...candidate.tool_calls[0], profile_id: "unregistered-analysis-agent" }],
        },
      }),
    ).rejects.toThrow("ROOT_AGENT_SELECTED_PROFILE_NOT_IN_FROZEN_CATALOG");
  });

  it("rejects the retired same-turn dependency selector", async () => {
    const catalog = await catalogFor(["governed-text2sql-agent", "semantic-management-agent"]);
    const candidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "TOOL_CALLS",
      scope,
      run_id: runId,
      catalog_snapshot_hash: catalog.snapshot_hash,
      tool_calls: [
        {
          tool_name: "delegate_to_subagent@2",
          tool_call_id: "query",
          profile_id: "governed-text2sql-agent",
          objective: "Produce governed query evidence.",
          requested_artifact_types: ["QueryEvidence"],
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
        {
          tool_name: "delegate_to_subagent@2",
          tool_call_id: "analysis",
          profile_id: "semantic-management-agent",
          objective: "Consume the accepted query evidence.",
          requested_artifact_types: ["AnalysisReport"],
          input_artifact_refs: [],
          upstream_accepted_output: {
            producer_tool_call_id: "query",
            artifact_type: "QueryEvidence",
          },
          requested_budget: {
            timeout_ms: 30_000,
            max_steps: 8,
            max_input_tokens: 20_000,
            max_output_tokens: 4_000,
            max_tool_calls: 4,
            max_context_bytes: 32_768,
          },
        },
      ],
      public_summary: "Produce and consume governed evidence.",
    };

    await expect(validateRootAgentDecisionAgainstCatalog({ candidate, catalog })).rejects.toThrow();
  });

  it("rejects the retired delegation tool contract", async () => {
    const catalog = await catalogFor(["semantic-management-agent"]);
    expect(() =>
      rootAgentDecisionCandidateSchema.parse({
        schema_version: "root-agent-turn-candidate@1.0.0",
        kind: "TOOL_CALLS",
        scope,
        run_id: runId,
        catalog_snapshot_hash: catalog.snapshot_hash,
        tool_calls: [
          {
            tool_name: "delegate_to_subagent@1",
            tool_call_id: "legacy",
            profile_id: "semantic-management-agent",
            objective: "Attempt the retired contract.",
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
        ],
        public_summary: "Retired tool.",
      }),
    ).toThrow();
  });

  it("rejects cross-Run governed facts instead of accepting uncited text", () => {
    expect(() =>
      rootAgentDecisionCandidateSchema.parse({
        schema_version: "root-agent-turn-candidate@1.0.0",
        kind: "FINAL_ANSWER",
        scope,
        run_id: runId,
        catalog_snapshot_hash: hash("9"),
        sections: [
          {
            kind: "ARTIFACT_FACTS",
            artifact_ref: {
              artifact_id: id(30),
              artifact_type: "AnalysisReport",
              ...scope,
              run_id: id(31),
              revision: 1,
              content_hash: hash("a"),
            },
            fact_selectors: ["relationships.edges"],
          },
        ],
        public_summary: "引用受治理事实。",
      }),
    ).toThrow();
  });
});
