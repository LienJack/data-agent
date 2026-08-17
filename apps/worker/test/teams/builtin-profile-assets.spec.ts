import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEAM_SKILLS,
  BUILTIN_TEAM_WORKFLOWS,
  buildBuiltinTeamMaterialization,
} from "../../src/teams/builtin-profile-assets.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const profiles = [
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

function references(offset: number) {
  return Object.fromEntries(
    profiles.map((profile, index) => [
      profile,
      { resource_id: id(offset + index), resource_revision: 1, resource_hash: hash(String(index)) },
    ]),
  ) as Record<
    (typeof profiles)[number],
    { resource_id: string; resource_revision: number; resource_hash: string }
  >;
}

describe("built-in Team product assets", () => {
  it("materializes nine immutable Skills and three isolated product Profiles", async () => {
    const materialized = await buildBuiltinTeamMaterialization({
      scope,
      model_profile_refs: references(10),
      context_policy_refs: references(20),
      execution_safety_policy_refs: references(30),
    });

    expect(materialized.skill_revisions).toHaveLength(9);
    expect(materialized.profile_revisions.map(({ profile_id }) => profile_id)).toEqual(profiles);
    expect(
      new Set(materialized.skill_revisions.map(({ revision_hash }) => revision_hash)),
    ).toHaveLength(9);
    expect(
      new Set(materialized.profile_revisions.map(({ prompt_ref }) => prompt_ref.prompt_hash)).size,
    ).toBe(3);
    expect(
      new Set(materialized.profile_revisions.map(({ workflow_ref }) => workflow_ref.workflow_hash))
        .size,
    ).toBe(3);
    expect(
      new Set(
        materialized.profile_revisions.map(({ model_profile_ref }) =>
          JSON.stringify(model_profile_ref),
        ),
      ).size,
    ).toBe(3);
    expect(
      new Set(
        materialized.profile_revisions.map(({ context_policy_ref }) =>
          JSON.stringify(context_policy_ref),
        ),
      ).size,
    ).toBe(3);
    expect(
      new Set(
        materialized.profile_revisions.map(({ execution_safety_policy_ref }) =>
          JSON.stringify(execution_safety_policy_ref),
        ),
      ).size,
    ).toBe(3);
    expect(
      new Set(
        materialized.profile_revisions.map(({ verifier_contract_hash }) => verifier_contract_hash),
      ).size,
    ).toBe(3);
    expect(
      materialized.skill_revisions.every(({ install_scripts }) => install_scripts.length === 0),
    ).toBe(true);
  });

  it("keeps every Skill capability inside its specialist direct Tool allowlist", async () => {
    const materialized = await buildBuiltinTeamMaterialization({
      scope,
      model_profile_refs: references(10),
      context_policy_refs: references(20),
      execution_safety_policy_refs: references(30),
    });
    for (const profile of materialized.profile_revisions) {
      const allowed = new Set(profile.direct_tool_allowlist);
      const capabilities = BUILTIN_TEAM_SKILLS.filter(
        ({ profile_id }) => profile_id === profile.profile_id,
      ).flatMap(({ capabilities: values }) => values);
      expect(capabilities.every((capability) => allowed.has(capability))).toBe(true);
    }
  });

  it("freezes the exact ordered workflow steps for each specialist", () => {
    expect(BUILTIN_TEAM_WORKFLOWS["semantic-management-agent"]).toEqual([
      "resolve",
      "propose",
      "compile",
      "validate",
      "impact",
      "complete",
    ]);
    expect(BUILTIN_TEAM_WORKFLOWS["governed-text2sql-agent"]).toHaveLength(7);
    expect(BUILTIN_TEAM_WORKFLOWS["report-writing-agent"]).toHaveLength(6);
  });

  it("rejects a shared Model, Context Policy, or Safety Policy across specialists", async () => {
    const shared = references(10);
    shared["report-writing-agent"] = shared["governed-text2sql-agent"];
    await expect(
      buildBuiltinTeamMaterialization({
        scope,
        model_profile_refs: shared,
        context_policy_refs: references(20),
        execution_safety_policy_refs: references(30),
      }),
    ).rejects.toThrow("BUILTIN_TEAM_MODEL_PROFILE_ISOLATION_REQUIRED");
  });
});
