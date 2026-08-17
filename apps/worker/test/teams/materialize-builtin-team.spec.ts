import { describe, expect, it, vi } from "vitest";
import { materializeBuiltinTeamProfiles } from "../../src/teams/materialize-builtin-team.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const profiles = [
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

function refs(offset: number) {
  return Object.fromEntries(
    profiles.map((profile, index) => [
      profile,
      { resource_id: id(offset + index), resource_revision: 1, resource_hash: hash(String(index)) },
    ]),
  ) as never;
}

function input() {
  let nextId = 100;
  return {
    scope: { app_id: id(1), tenant_id: id(2), environment: "test" } as const,
    model_profile_refs: refs(10),
    context_policy_refs: refs(20),
    execution_safety_policy_refs: refs(30),
    capability_input: {},
    actor_principal_id: id(3),
    create_id: () => {
      nextId += 1;
      return id(nextId);
    },
    idempotency_prefix: "builtin-team-v1",
  };
}

describe("built-in Team materialization", () => {
  it("commits all nine Skills before the three product Profiles", async () => {
    const order: string[] = [];
    const result = await materializeBuiltinTeamProfiles(input(), {
      skills: {
        commit: vi.fn(async (_capability, command) => {
          order.push(`skill:${command.revision.skill_id}`);
          return { ok: true as const, value: {} as never };
        }),
      },
      profiles: {
        commit: vi.fn(async (_capability, command) => {
          order.push(`profile:${command.revision.profile_id}`);
          return {
            ok: true as const,
            value: {
              schema_version: "agent-product-profile-registry-item@1.0.0" as const,
              revision: command.revision,
              head: {
                schema_version: "agent-product-profile-head@1.0.0" as const,
                scope: command.revision.scope,
                profile_id: command.revision.profile_id,
                active_revision: command.revision.revision,
                active_revision_hash: command.revision.revision_hash,
                lifecycle: "ENABLED" as const,
                version: 1,
                updated_at: "2026-08-18T12:00:00.000Z",
              },
            },
          };
        }),
      },
    });
    expect(result.ok && result.value).toHaveLength(3);
    expect(order.slice(0, 9).every((entry) => entry.startsWith("skill:"))).toBe(true);
    expect(order.slice(9).every((entry) => entry.startsWith("profile:"))).toBe(true);
  });

  it("does not commit any Profile after a Skill failure", async () => {
    let skillCalls = 0;
    const profileCommit = vi.fn();
    const result = await materializeBuiltinTeamProfiles(input(), {
      skills: {
        commit: vi.fn(async () => {
          skillCalls += 1;
          return skillCalls === 4
            ? {
                ok: false as const,
                error: { code: "SKILL_REJECTED", message: "rejected", retryable: false },
              }
            : { ok: true as const, value: {} as never };
        }),
      },
      profiles: { commit: profileCommit },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "SKILL_REJECTED" } });
    expect(profileCommit).not.toHaveBeenCalled();
  });
});
