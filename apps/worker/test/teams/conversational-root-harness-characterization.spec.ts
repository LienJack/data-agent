import { describe, expect, it } from "vitest";
import { buildBuiltinTeamMaterialization } from "../../src/teams/builtin-profile-assets.js";

const id = (suffix: number) => `87000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const profileIds = [
  "governed-analysis-agent",
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

function references(offset: number) {
  return Object.fromEntries(
    profileIds.map((profileId, index) => [
      profileId,
      {
        resource_id: id(offset + index),
        resource_revision: 1,
        resource_hash: hash(String(index)),
      },
    ]),
  ) as Record<
    (typeof profileIds)[number],
    { resource_id: string; resource_revision: number; resource_hash: string }
  >;
}

describe("Conversational Root Harness specialist handoff gap", () => {
  it.fails("allows Text2SQL to optionally consume SemanticQueryContext", async () => {
    const materialized = await buildBuiltinTeamMaterialization({
      scope,
      model_profile_refs: references(10),
      context_policy_refs: references(20),
      execution_safety_policy_refs: references(30),
    });
    const text2sql = materialized.profile_revisions.find(
      ({ profile_id: profileId }) => profileId === "governed-text2sql-agent",
    );

    expect(text2sql?.discovery.accepted_input_artifact_types).toContain("SemanticQueryContext");
  });
});
