import { describe, expect, it } from "vitest";
import {
  actionsForWorkspaceRole,
  agentProductProfileListResultSchema,
  agentProductProfileRegistryItemSchema,
  buildAgentProductProfileCommitCommand,
  buildAgentProductProfileRevision,
  effectiveConfigRunLeasePayloadSchema,
  verifyAgentProductProfileCommitCommand,
  verifyAgentProductProfileRevision,
} from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

async function revision() {
  return buildAgentProductProfileRevision({
    schema_version: "agent-product-profile-revision@1.0.0",
    scope,
    profile_id: "governed-text2sql-agent",
    revision: 1,
    runtime_profile_ref: {
      profile_id: "governed-text2sql-agent",
      revision: 1,
      profile_hash: hash("1"),
    },
    model_profile_ref: { resource_id: id(3), resource_revision: 2, resource_hash: hash("2") },
    prompt_ref: { prompt_id: "prompt.text2sql", revision: 1, prompt_hash: hash("3") },
    workflow_ref: {
      workflow_id: "workflow.text2sql",
      revision: 1,
      workflow_hash: hash("4"),
    },
    direct_tool_allowlist: [
      "context.resolve",
      "sql.compiler.compile",
      "sql.firewall.validate",
      "sql.sandbox.execute",
      "task.complete",
    ],
    skill_refs: [
      { skill_id: id(10), revision: 1, revision_hash: hash("a") },
      { skill_id: id(11), revision: 1, revision_hash: hash("b") },
      { skill_id: id(12), revision: 1, revision_hash: hash("c") },
    ],
    context_policy_ref: { resource_id: id(4), resource_revision: 1, resource_hash: hash("5") },
    execution_safety_policy_ref: {
      resource_id: id(5),
      resource_revision: 1,
      resource_hash: hash("6"),
    },
    expected_output_artifact_types: ["QueryEvidence"],
    verifier_contract_hash: hash("7"),
    approval_status: "APPROVED",
  });
}

describe("Agent product profile contracts", () => {
  it("hashes one immutable specialist profile and rejects material drift", async () => {
    const value = await revision();
    await expect(verifyAgentProductProfileRevision(value)).resolves.toEqual(value);
    await expect(
      verifyAgentProductProfileRevision({ ...value, verifier_contract_hash: hash("f") }),
    ).rejects.toThrow("AGENT_PRODUCT_PROFILE_REVISION_HASH_MISMATCH");
    await expect(
      buildAgentProductProfileRevision({
        ...value,
        revision_hash: undefined,
        profile_id: "data-agent-orchestrator",
      }),
    ).rejects.toThrow();
  });

  it("binds commit actor, expected Head version and exact revision hash", async () => {
    const value = await revision();
    const command = await buildAgentProductProfileCommitCommand({
      schema_version: "agent-product-profile-commit-command@1.0.0",
      operation_id: id(20),
      idempotency_key: "agent-profile:commit:1",
      actor_principal_id: id(21),
      revision: value,
      expected_head_version: 0,
      target_lifecycle: "ENABLED",
    });
    await expect(verifyAgentProductProfileCommitCommand(command)).resolves.toEqual(command);
    await expect(
      verifyAgentProductProfileCommitCommand({ ...command, actor_principal_id: id(22) }),
    ).rejects.toThrow("AGENT_PRODUCT_PROFILE_COMMIT_HASH_MISMATCH");
  });

  it("closes mutable Head identity over the immutable revision", async () => {
    const value = await revision();
    const item = agentProductProfileRegistryItemSchema.parse({
      schema_version: "agent-product-profile-registry-item@1.0.0",
      revision: value,
      head: {
        schema_version: "agent-product-profile-head@1.0.0",
        scope,
        profile_id: value.profile_id,
        active_revision: value.revision,
        active_revision_hash: value.revision_hash,
        lifecycle: "ENABLED",
        version: 1,
        updated_at: "2026-08-18T12:00:00.000Z",
      },
    });
    expect(item.head.lifecycle).toBe("ENABLED");
    expect(() =>
      agentProductProfileListResultSchema.parse({
        schema_version: "agent-product-profile-list-result@1.0.0",
        items: [item, item],
      }),
    ).toThrow();
  });

  it("grants profile management only to workspace/system admins", () => {
    expect(actionsForWorkspaceRole("WORKSPACE_ADMIN", "USER")).toContain("AGENT_PROFILE_MANAGE");
    expect(actionsForWorkspaceRole("ANALYST", "USER")).not.toContain("AGENT_PROFILE_MANAGE");
    expect(actionsForWorkspaceRole("VIEWER", "USER")).not.toContain("AGENT_PROFILE_MANAGE");
    expect(actionsForWorkspaceRole("VIEWER", "SUPER_ADMIN")).toContain("AGENT_PROFILE_MANAGE");
  });

  it("double-reads legacy and exact three-profile Team lease payloads", () => {
    const effectiveConfigRef = {
      config_id: id(30),
      config_revision: 1,
      config_hash: hash("8"),
    };
    expect(
      effectiveConfigRunLeasePayloadSchema.parse({
        kind: "START_L2_RESEARCH",
        effective_config_ref: effectiveConfigRef,
      }).kind,
    ).toBe("START_L2_RESEARCH");

    const profileRefs = [
      { profile_id: "governed-text2sql-agent", revision: 1, revision_hash: hash("a") },
      { profile_id: "report-writing-agent", revision: 1, revision_hash: hash("b") },
      { profile_id: "semantic-management-agent", revision: 1, revision_hash: hash("c") },
    ];
    expect(
      effectiveConfigRunLeasePayloadSchema.parse({
        kind: "START_DATA_AGENT_TEAM",
        effective_config_ref: effectiveConfigRef,
        profile_refs: profileRefs,
      }).kind,
    ).toBe("START_DATA_AGENT_TEAM");
    expect(
      effectiveConfigRunLeasePayloadSchema.parse({
        schema_version: "effective-config-team-lease@1.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "LEGACY_FIXED@1",
        effective_config_ref: effectiveConfigRef,
        profile_refs: profileRefs,
      }),
    ).toMatchObject({ schema_version: "effective-config-team-lease@1.0.0" });
    expect(() =>
      effectiveConfigRunLeasePayloadSchema.parse({
        kind: "START_DATA_AGENT_TEAM",
        effective_config_ref: effectiveConfigRef,
        profile_refs: profileRefs.slice(1),
      }),
    ).toThrow();
  });
});
