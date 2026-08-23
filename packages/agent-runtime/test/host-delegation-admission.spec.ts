import {
  buildAgentProductProfileRevisionV2,
  buildSubagentCapabilityCatalogSnapshot,
  projectSubagentCapabilityCatalogItem,
  type RootAgentDecisionCandidate,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { admitRootAgentDelegations } from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

async function profileItem() {
  const revision = await buildAgentProductProfileRevisionV2({
    schema_version: "agent-product-profile-revision@2.0.0",
    scope,
    profile_id: "semantic-management-agent",
    revision: 3,
    discovery: {
      schema_version: "subagent-discovery-descriptor@1.0.0",
      display_name: "Semantic Graph Reader",
      description: "Reads the governed semantic graph and explains relationships.",
      when_to_use: ["Use for governed semantic dependency questions."],
      when_not_to_use: ["Do not use for row-level measures."],
      examples: [],
      accepted_input_artifact_types: ["QueryEvidence"],
      produced_artifact_types: ["AnalysisReport"],
      access_mode: "READ_ONLY",
    },
    runtime_profile_ref: {
      profile_id: "semantic-management-agent",
      revision: 2,
      profile_hash: hash("1"),
    },
    model_profile_ref: { resource_id: id(10), resource_revision: 1, resource_hash: hash("2") },
    prompt_ref: { prompt_id: "prompt.semantic", revision: 1, prompt_hash: hash("3") },
    workflow_ref: { workflow_id: "workflow.semantic", revision: 1, workflow_hash: hash("4") },
    direct_tool_allowlist: ["semantic.catalog.read"],
    skill_refs: [{ skill_id: id(11), revision: 1, revision_hash: hash("5") }],
    context_policy_ref: { resource_id: id(12), resource_revision: 1, resource_hash: hash("6") },
    execution_safety_policy_ref: {
      resource_id: id(13),
      resource_revision: 1,
      resource_hash: hash("7"),
    },
    expected_output_artifact_types: ["AnalysisReport"],
    verifier_contract_hash: hash("8"),
    approval_status: "APPROVED",
  });
  return {
    schema_version: "agent-product-profile-registry-item@2.0.0" as const,
    revision,
    head: {
      schema_version: "agent-product-profile-head@2.0.0" as const,
      scope,
      profile_id: revision.profile_id,
      active_revision: revision.revision,
      active_revision_hash: revision.revision_hash,
      lifecycle: "ENABLED" as const,
      version: 1,
      updated_at: "2026-08-22T12:00:00.000Z",
    },
  };
}

async function fixture() {
  const profile = await profileItem();
  const catalog = await buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: id(20),
    scope,
    run_id: runId,
    principal_id: id(21),
    policy_version: "subagent-catalog@1",
    items: [await projectSubagentCapabilityCatalogItem(profile)],
  });
  const decision: RootAgentDecisionCandidate = {
    schema_version: "root-agent-turn-candidate@1.0.0",
    kind: "TOOL_CALLS",
    scope,
    run_id: runId,
    catalog_snapshot_hash: catalog.snapshot_hash,
    public_summary: "选择语义图读取能力。",
    tool_calls: [
      {
        tool_name: "delegate_to_subagent@1",
        tool_call_id: "semantic-call-1",
        profile_id: "semantic-management-agent",
        objective: "读取冻结语义图并解释表之间的依赖关系。",
        requested_artifact_types: ["AnalysisReport"],
        input_artifact_refs: [
          {
            artifact_id: id(30),
            artifact_type: "QueryEvidence",
            ...scope,
            run_id: runId,
            revision: 1,
            content_hash: hash("9"),
          },
        ],
        requested_budget: {
          timeout_ms: 120_000,
          max_steps: 20,
          max_input_tokens: 40_000,
          max_output_tokens: 8_000,
          max_tool_calls: 8,
          max_context_bytes: 65_536,
        },
      },
    ],
  };
  return { profile, catalog, decision };
}

const runCeiling = {
  timeout_ms: 60_000,
  max_steps: 10,
  max_input_tokens: 24_000,
  max_output_tokens: 4_000,
  max_tool_calls: 4,
  max_context_bytes: 32_768,
} as const;

describe("Host Subagent delegation admission", () => {
  it("binds the exact frozen Profile and monotonically narrows budget and tools", async () => {
    const { profile, catalog, decision } = await fixture();
    const admitted = await admitRootAgentDelegations({
      decision,
      catalog,
      profiles: [profile],
      run_ceiling: runCeiling,
      profile_ceiling: () => ({ ...runCeiling, max_tool_calls: 1, max_steps: 2 }),
      artifact_is_accepted: async () => true,
    });

    expect(admitted).toHaveLength(1);
    expect(admitted[0]?.receipt).toMatchObject({
      profile_ref: catalog.items[0]?.profile_ref,
      effective_budget: {
        timeout_ms: 60_000,
        max_steps: 2,
        max_input_tokens: 24_000,
        max_output_tokens: 4_000,
        max_tool_calls: 1,
        max_context_bytes: 32_768,
      },
      tool_allowlist: ["semantic.catalog.read"],
    });

    const replay = await admitRootAgentDelegations({
      decision,
      catalog,
      profiles: [profile],
      run_ceiling: runCeiling,
      profile_ceiling: () => ({ ...runCeiling, max_tool_calls: 1, max_steps: 2 }),
      artifact_is_accepted: async () => true,
    });
    expect(replay[0]?.receipt).toEqual(admitted[0]?.receipt);
  });

  it("fails closed for a stale Profile binding or unaccepted input Artifact", async () => {
    const { profile, catalog, decision } = await fixture();
    await expect(
      admitRootAgentDelegations({
        decision,
        catalog,
        profiles: [{ ...profile, head: { ...profile.head, lifecycle: "DISABLED" as const } }],
        run_ceiling: runCeiling,
        profile_ceiling: () => runCeiling,
        artifact_is_accepted: async () => false,
      }),
    ).rejects.toMatchObject({
      code: "SUBAGENT_PROFILE_CATALOG_BINDING_STALE",
    });
    await expect(
      admitRootAgentDelegations({
        decision,
        catalog,
        profiles: [profile],
        run_ceiling: runCeiling,
        profile_ceiling: () => runCeiling,
        artifact_is_accepted: async () => false,
      }),
    ).rejects.toMatchObject({
      code: "SUBAGENT_INPUT_ARTIFACT_NOT_ACCEPTED",
    });
  });
});
