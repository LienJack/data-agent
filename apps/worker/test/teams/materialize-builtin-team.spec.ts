import { describe, expect, it, vi } from "vitest";
import { buildBuiltinTeamMaterialization } from "../../src/teams/builtin-profile-assets.js";
import {
  materializeBuiltinTeamProfiles,
  verifyBuiltinTeamProfileSet,
} from "../../src/teams/materialize-builtin-team.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const profiles = [
  "governed-analysis-agent",
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
  const idsByMaterial = new Map<string, string>();
  return {
    scope: { app_id: id(1), tenant_id: id(2), environment: "test" } as const,
    model_profile_refs: refs(10),
    context_policy_refs: refs(20),
    execution_safety_policy_refs: refs(30),
    capability_input: {},
    actor_principal_id: id(3),
    create_operation_id: (material: string) => {
      const existing = idsByMaterial.get(material);
      if (existing) return existing;
      nextId += 1;
      const value = id(nextId);
      idsByMaterial.set(material, value);
      return value;
    },
    idempotency_prefix: "builtin-team-v2",
  };
}

function skillItems(
  materialized: Awaited<ReturnType<typeof buildBuiltinTeamMaterialization>>,
  request: ReturnType<typeof input>,
) {
  return materialized.skill_revisions.map((revision, index) => ({
    schema_version: "skill-registry-item@1.0.0" as const,
    revision,
    head: {
      schema_version: "skill-head@1.0.0" as const,
      scope: request.scope,
      skill_id: revision.skill_id,
      active_revision: revision.revision,
      active_revision_hash: revision.revision_hash,
      lifecycle: "ENABLED" as const,
      signer_revocation_version: 0,
      version: index + 1,
      updated_at: "2026-08-18T12:00:00.000Z",
    },
  }));
}

describe("built-in Team materialization", () => {
  it("verifies the exact enabled built-in Profile set and freezes one set hash", async () => {
    const request = input();
    const materialized = await buildBuiltinTeamMaterialization(request);
    const items = materialized.profile_revisions.map((revision, index) => ({
      schema_version: "agent-product-profile-registry-item@2.0.0" as const,
      revision,
      head: {
        schema_version: "agent-product-profile-head@2.0.0" as const,
        scope: request.scope,
        profile_id: revision.profile_id,
        active_revision: revision.revision,
        active_revision_hash: revision.revision_hash,
        lifecycle: "ENABLED" as const,
        version: index + 1,
        updated_at: "2026-08-18T12:00:00.000Z",
      },
    }));

    const skills = skillItems(materialized, request);
    await expect(verifyBuiltinTeamProfileSet(request, items, skills)).resolves.toMatchObject({
      schema_version: "builtin-team-profile-set@1.0.0",
      materialization_manifest_hash: materialized.manifest_hash,
      profile_refs: materialized.profile_revisions.map((revision) => ({
        profile_id: revision.profile_id,
        revision: revision.revision,
        revision_hash: revision.revision_hash,
      })),
      skill_refs: materialized.skill_revisions.map((revision) => ({
        skill_id: revision.skill_id,
        revision: revision.revision,
        revision_hash: revision.revision_hash,
      })),
      profile_set_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("rejects a stale discovery contract even when all four Profile ids exist", async () => {
    const request = input();
    const materialized = await buildBuiltinTeamMaterialization(request);
    const items = materialized.profile_revisions.map((revision, index) => ({
      schema_version: "agent-product-profile-registry-item@2.0.0" as const,
      revision:
        revision.profile_id === "governed-analysis-agent"
          ? {
              ...revision,
              revision: 1,
              revision_hash: hash("f"),
              discovery: {
                ...revision.discovery,
                accepted_input_artifact_types: [],
              },
            }
          : revision,
      head: {
        schema_version: "agent-product-profile-head@2.0.0" as const,
        scope: request.scope,
        profile_id: revision.profile_id,
        active_revision: revision.profile_id === "governed-analysis-agent" ? 1 : revision.revision,
        active_revision_hash:
          revision.profile_id === "governed-analysis-agent" ? hash("f") : revision.revision_hash,
        lifecycle: "ENABLED" as const,
        version: index + 1,
        updated_at: "2026-08-18T12:00:00.000Z",
      },
    }));

    await expect(
      verifyBuiltinTeamProfileSet(request, items as never, skillItems(materialized, request)),
    ).rejects.toThrow("BUILTIN_TEAM_PROFILE_SET_STALE");
  });

  it("commits all ten Skills before the four product Profiles", async () => {
    const order: string[] = [];
    const profileCommands: unknown[] = [];
    const result = await materializeBuiltinTeamProfiles(input(), {
      skills: {
        list: vi.fn(async () => ({ ok: true as const, value: [] })),
        commit: vi.fn(async (_capability, command) => {
          order.push(`skill:${command.revision.skill_id}`);
          return { ok: true as const, value: {} as never };
        }),
      },
      profiles: {
        listManagedV2: vi.fn(async () => ({ ok: true as const, value: [] })),
        commitV2: vi.fn(async (_capability, command) => {
          order.push(`profile:${command.revision.profile_id}`);
          profileCommands.push(command);
          return {
            ok: true as const,
            value: {
              schema_version: "agent-product-profile-registry-item@2.0.0" as const,
              revision: command.revision,
              head: {
                schema_version: "agent-product-profile-head@2.0.0" as const,
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
    expect(result.ok && result.value).toHaveLength(4);
    expect(order.slice(0, 10).every((entry) => entry.startsWith("skill:"))).toBe(true);
    expect(order.slice(10).every((entry) => entry.startsWith("profile:"))).toBe(true);
    expect(order.filter((entry) => entry === "profile:semantic-management-agent")).toHaveLength(1);
    expect(profileCommands).toContainEqual(
      expect.objectContaining({
        expected_head_version: 0,
        revision: expect.objectContaining({
          profile_id: "semantic-management-agent",
          revision: 5,
          runtime_profile_ref: expect.objectContaining({ revision: 3 }),
        }),
      }),
    );
  });

  it("reads managed heads before mutation and CAS-advances analysis Skill r1/Profile r1", async () => {
    const request = input();
    const materialized = await buildBuiltinTeamMaterialization(request);
    const targetSkill = materialized.skill_revisions.find(
      ({ skill_id: skillId }) => skillId === "00000000-0000-4000-8000-000000002401",
    );
    const targetProfile = materialized.profile_revisions.find(
      ({ profile_id: profileId }) => profileId === "governed-analysis-agent",
    );
    if (!targetSkill || !targetProfile) throw new TypeError("missing analysis fixtures");
    const order: string[] = [];
    const skillCommands: unknown[] = [];
    const profileCommands: unknown[] = [];
    const staleSkill = {
      schema_version: "skill-registry-item@1.0.0" as const,
      revision: { ...targetSkill, revision: 1, revision_hash: hash("d") },
      head: {
        schema_version: "skill-head@1.0.0" as const,
        scope: request.scope,
        skill_id: targetSkill.skill_id,
        active_revision: 1,
        active_revision_hash: hash("d"),
        lifecycle: "ENABLED" as const,
        signer_revocation_version: 0,
        version: 7,
        updated_at: "2026-08-18T12:00:00.000Z",
      },
    };
    const staleProfile = {
      schema_version: "agent-product-profile-registry-item@2.0.0" as const,
      revision: { ...targetProfile, revision: 1, revision_hash: hash("e") },
      head: {
        schema_version: "agent-product-profile-head@2.0.0" as const,
        scope: request.scope,
        profile_id: targetProfile.profile_id,
        active_revision: 1,
        active_revision_hash: hash("e"),
        lifecycle: "ENABLED" as const,
        version: 9,
        updated_at: "2026-08-18T12:00:00.000Z",
      },
    };

    const result = await materializeBuiltinTeamProfiles(request, {
      skills: {
        list: vi.fn(async () => {
          order.push("list:skills");
          return { ok: true as const, value: [staleSkill] as never };
        }),
        commit: vi.fn(async (_capability, command) => {
          order.push("commit:skill");
          skillCommands.push(command);
          return { ok: true as const, value: {} as never };
        }),
      },
      profiles: {
        listManagedV2: vi.fn(async () => {
          order.push("list:profiles");
          return { ok: true as const, value: [staleProfile] as never };
        }),
        commitV2: vi.fn(async (_capability, command) => {
          order.push("commit:profile");
          profileCommands.push(command);
          return {
            ok: true as const,
            value: {
              ...staleProfile,
              revision: command.revision,
              head: {
                ...staleProfile.head,
                profile_id: command.revision.profile_id,
                active_revision: command.revision.revision,
                active_revision_hash: command.revision.revision_hash,
              },
            },
          };
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(order.slice(0, 2).sort()).toEqual(["list:profiles", "list:skills"]);
    expect(skillCommands).toContainEqual(
      expect.objectContaining({
        expected_head_version: 7,
        revision: expect.objectContaining({ skill_id: targetSkill.skill_id, revision: 2 }),
      }),
    );
    expect(profileCommands).toContainEqual(
      expect.objectContaining({
        expected_head_version: 9,
        revision: expect.objectContaining({ profile_id: targetProfile.profile_id, revision: 4 }),
      }),
    );
  });

  it("CAS-reactivates exact disabled Skill and Product Profile heads", async () => {
    const request = input();
    const materialized = await buildBuiltinTeamMaterialization(request);
    const currentSkills = skillItems(materialized, request).map((item) =>
      item.revision.skill_id === "00000000-0000-4000-8000-000000002401"
        ? { ...item, head: { ...item.head, lifecycle: "DISABLED" as const, version: 11 } }
        : item,
    );
    const currentProfiles = materialized.profile_revisions.map((revision, index) => ({
      schema_version: "agent-product-profile-registry-item@2.0.0" as const,
      revision,
      head: {
        schema_version: "agent-product-profile-head@2.0.0" as const,
        scope: request.scope,
        profile_id: revision.profile_id,
        active_revision: revision.revision,
        active_revision_hash: revision.revision_hash,
        lifecycle:
          revision.profile_id === "governed-analysis-agent"
            ? ("DISABLED" as const)
            : ("ENABLED" as const),
        version: revision.profile_id === "governed-analysis-agent" ? 13 : index + 1,
        updated_at: "2026-08-18T12:00:00.000Z",
      },
    }));
    const skillCommands: unknown[] = [];
    const profileCommands: unknown[] = [];

    const result = await materializeBuiltinTeamProfiles(request, {
      skills: {
        list: vi.fn(async () => ({ ok: true as const, value: currentSkills })),
        commit: vi.fn(async (_capability, command) => {
          skillCommands.push(command);
          return { ok: true as const, value: {} as never };
        }),
      },
      profiles: {
        listManagedV2: vi.fn(async () => ({ ok: true as const, value: currentProfiles })),
        commitV2: vi.fn(async (_capability, command) => {
          profileCommands.push(command);
          const current = currentProfiles.find(
            ({ revision }) => revision.profile_id === command.revision.profile_id,
          );
          if (!current) throw new TypeError("missing profile fixture");
          return {
            ok: true as const,
            value: { ...current, head: { ...current.head, lifecycle: "ENABLED" as const } },
          };
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(skillCommands).toEqual([
      expect.objectContaining({
        expected_head_version: 11,
        target_lifecycle: "ENABLED",
        revision: expect.objectContaining({ revision: 2 }),
      }),
    ]);
    expect(profileCommands).toEqual([
      expect.objectContaining({
        expected_head_version: 13,
        target_lifecycle: "ENABLED",
        revision: expect.objectContaining({
          profile_id: "governed-analysis-agent",
          revision: 4,
        }),
      }),
    ]);
  });

  it("does not commit any Profile after a Skill failure", async () => {
    let skillCalls = 0;
    const profileCommit = vi.fn();
    const result = await materializeBuiltinTeamProfiles(input(), {
      skills: {
        list: vi.fn(async () => ({ ok: true as const, value: [] })),
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
      profiles: {
        listManagedV2: vi.fn(async () => ({ ok: true as const, value: [] })),
        commitV2: profileCommit,
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "SKILL_REJECTED" } });
    expect(profileCommit).not.toHaveBeenCalled();
  });

  it("reuses an exact enabled immutable Product Profile without advancing its head", async () => {
    const request = input();
    const analysisRevision = (
      await buildBuiltinTeamMaterialization({
        scope: request.scope,
        model_profile_refs: refs(10),
        context_policy_refs: refs(20),
        execution_safety_policy_refs: refs(30),
      })
    ).profile_revisions.find(({ profile_id }) => profile_id === "governed-analysis-agent");
    expect(analysisRevision).toBeDefined();
    if (!analysisRevision) throw new TypeError("missing analysis fixture");
    const exactItem = {
      schema_version: "agent-product-profile-registry-item@2.0.0" as const,
      revision: analysisRevision,
      head: {
        schema_version: "agent-product-profile-head@2.0.0" as const,
        scope: request.scope,
        profile_id: analysisRevision.profile_id,
        active_revision: analysisRevision.revision,
        active_revision_hash: analysisRevision.revision_hash,
        lifecycle: "ENABLED" as const,
        version: 4,
        updated_at: "2026-08-18T12:00:00.000Z",
      },
    };
    const profileCommit = vi.fn(async (_capability, command) => ({
      ok: true as const,
      value: {
        ...exactItem,
        revision: command.revision,
        head: {
          ...exactItem.head,
          profile_id: command.revision.profile_id,
          active_revision: command.revision.revision,
          active_revision_hash: command.revision.revision_hash,
        },
      },
    }));
    const result = await materializeBuiltinTeamProfiles(request, {
      skills: {
        list: vi.fn(async () => ({ ok: true as const, value: [] })),
        commit: vi.fn(async () => ({ ok: true as const, value: {} as never })),
      },
      profiles: {
        listManagedV2: vi.fn(async () => ({ ok: true as const, value: [exactItem] })),
        commitV2: profileCommit,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value[0]).toEqual(exactItem);
    expect(
      profileCommit.mock.calls.some(
        ([, command]) => command.revision.profile_id === "governed-analysis-agent",
      ),
    ).toBe(false);
  });

  it("uses the current Product Profile head version when activating the E1 semantic revision", async () => {
    const request = input();
    const semanticRevision = (
      await buildBuiltinTeamMaterialization({
        scope: request.scope,
        model_profile_refs: refs(10),
        context_policy_refs: refs(20),
        execution_safety_policy_refs: refs(30),
      })
    ).profile_revisions.find(({ profile_id }) => profile_id === "semantic-management-agent");
    expect(semanticRevision).toBeDefined();
    if (!semanticRevision) throw new TypeError("missing semantic fixture");
    const profileCommit = vi.fn(async (_capability, command) => ({
      ok: true as const,
      value: {
        schema_version: "agent-product-profile-registry-item@2.0.0" as const,
        revision: command.revision,
        head: {
          schema_version: "agent-product-profile-head@2.0.0" as const,
          scope: command.revision.scope,
          profile_id: command.revision.profile_id,
          active_revision: command.revision.revision,
          active_revision_hash: command.revision.revision_hash,
          lifecycle: "ENABLED" as const,
          version: 8,
          updated_at: "2026-08-18T12:00:00.000Z",
        },
      },
    }));
    const existing = await materializeBuiltinTeamProfiles(request, {
      skills: {
        list: vi.fn(async () => ({ ok: true as const, value: [] })),
        commit: vi.fn(async () => ({ ok: true as const, value: {} as never })),
      },
      profiles: {
        listManagedV2: vi.fn(async () => ({
          ok: true as const,
          value: [
            {
              schema_version: "agent-product-profile-registry-item@2.0.0" as const,
              revision: {
                ...semanticRevision,
                revision: 3,
              },
              head: {
                schema_version: "agent-product-profile-head@2.0.0" as const,
                scope: request.scope,
                profile_id: "semantic-management-agent" as const,
                active_revision: 3,
                active_revision_hash: hash("a"),
                lifecycle: "ENABLED" as const,
                version: 7,
                updated_at: "2026-08-18T12:00:00.000Z",
              },
            },
          ],
        })),
        commitV2: profileCommit,
      },
    });
    expect(existing.ok).toBe(true);
    const semanticCommand = profileCommit.mock.calls
      .map(([, command]) => command)
      .find(({ revision }) => revision.profile_id === "semantic-management-agent");
    expect(semanticCommand).toMatchObject({
      expected_head_version: 7,
      revision: { revision: 5, runtime_profile_ref: { revision: 3 } },
    });
  });
});
