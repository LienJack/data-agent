import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILE_REVISIONS,
  agentProfileRevisionSchema,
  assertDelegationAllowed,
  assertDirectToolAllowed,
  DATA_AGENT_PROFILE_IDS,
  getAgentProfileRevisionExact,
} from "../src/teams/index.js";

describe("Agent Team v2 profiles", () => {
  it("freezes the orchestrator and three distinct specialist revisions", () => {
    expect(DATA_AGENT_PROFILE_IDS).toEqual([
      "data-agent-orchestrator",
      "semantic-management-agent",
      "governed-text2sql-agent",
      "report-writing-agent",
    ]);
    expect(new Set(AGENT_PROFILE_REVISIONS.map((profile) => profile.profile_id))).toEqual(
      new Set(DATA_AGENT_PROFILE_IDS),
    );
    for (const profile of AGENT_PROFILE_REVISIONS) {
      expect(agentProfileRevisionSchema.parse(profile)).toEqual(profile);
      expect(profile.profile_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(
      new Set(AGENT_PROFILE_REVISIONS.map((profile) => profile.workflow.workflow_id)).size,
    ).toBe(5);
    const semanticRevisions = AGENT_PROFILE_REVISIONS.filter(
      ({ profile_id }) => profile_id === "semantic-management-agent",
    );
    expect(semanticRevisions.map(({ revision }) => revision)).toEqual([1, 2]);
    for (const semantic of semanticRevisions) {
      expect(
        getAgentProfileRevisionExact(semantic.profile_id, semantic.revision, semantic.profile_hash),
      ).toBe(semantic);
    }
  });

  it("separates direct tools from delegation and denies recursive delegation", () => {
    expect(() => assertDirectToolAllowed("data-agent-orchestrator", "sql.sandbox.execute")).toThrow(
      "TEAM_DIRECT_TOOL_DENIED",
    );
    expect(() =>
      assertDelegationAllowed("data-agent-orchestrator", "governed-text2sql-agent"),
    ).not.toThrow();
    expect(() =>
      assertDelegationAllowed("governed-text2sql-agent", "report-writing-agent"),
    ).toThrow("TEAM_RECURSIVE_DELEGATION_DENIED");
  });

  it("rejects profile hash and provenance mutation", () => {
    const profile = AGENT_PROFILE_REVISIONS[1];
    expect(profile).toBeDefined();
    expect(
      agentProfileRevisionSchema.safeParse({
        ...profile,
        direct_tool_allowlist: [...profile.direct_tool_allowlist, "sql.sandbox.execute"],
      }).success,
    ).toBe(false);
  });
});
