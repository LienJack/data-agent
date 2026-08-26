import {
  type AgentProductProfileRegistryItemV2,
  type AppScope,
  buildAgentProductProfileCommitCommandV2,
  type PortResult,
  type SkillRegistryItem,
  sha256ContentHash,
  type VersionedResourceReference,
} from "@data-agent/contracts";
import {
  DATA_AGENT_SPECIALIST_PROFILE_IDS,
  type DataAgentSpecialistProfileId,
} from "./agent-profiles.js";
import {
  type BuiltinTeamMaterializationInput,
  buildBuiltinTeamMaterialization,
} from "./builtin-profile-assets.js";

export interface BuiltinTeamProfileSetSnapshot {
  readonly schema_version: "builtin-team-profile-set@1.0.0";
  readonly materialization_manifest_hash: string;
  readonly profile_refs: readonly {
    readonly profile_id: DataAgentSpecialistProfileId;
    readonly revision: number;
    readonly revision_hash: string;
  }[];
  readonly skill_refs: readonly {
    readonly skill_id: string;
    readonly revision: number;
    readonly revision_hash: string;
  }[];
  readonly profile_set_hash: string;
}

function sameScope(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

/**
 * Rebuilds the source-owned built-in Team from the active registry bindings and
 * requires every immutable Product Profile contract to match exactly. Profile
 * ids alone are not readiness evidence because discovery I/O is part of Root
 * routing authority.
 */
export async function verifyBuiltinTeamProfileSet(
  input: BuiltinTeamMaterializationInput,
  profileItems: readonly AgentProductProfileRegistryItemV2[],
  skillItems: readonly SkillRegistryItem[],
): Promise<BuiltinTeamProfileSetSnapshot> {
  try {
    const byProfileId = new Map(
      profileItems
        .filter((item) =>
          DATA_AGENT_SPECIALIST_PROFILE_IDS.includes(
            item.revision.profile_id as DataAgentSpecialistProfileId,
          ),
        )
        .map((item) => [item.revision.profile_id, item] as const),
    );
    if (byProfileId.size !== DATA_AGENT_SPECIALIST_PROFILE_IDS.length) {
      throw new TypeError("BUILTIN_TEAM_PROFILE_SET_STALE");
    }
    const orderedItems = DATA_AGENT_SPECIALIST_PROFILE_IDS.map((profileId) => {
      const item = byProfileId.get(profileId);
      if (!item) throw new TypeError("BUILTIN_TEAM_PROFILE_SET_STALE");
      return item;
    });
    if (
      orderedItems.some(
        (item) =>
          item.head.lifecycle !== "ENABLED" ||
          !sameScope(item.revision.scope, input.scope) ||
          !sameScope(item.head.scope, input.scope) ||
          item.head.profile_id !== item.revision.profile_id ||
          item.head.active_revision !== item.revision.revision ||
          item.head.active_revision_hash !== item.revision.revision_hash,
      )
    ) {
      throw new TypeError("BUILTIN_TEAM_PROFILE_SET_STALE");
    }
    const materialized = await buildBuiltinTeamMaterialization(input);
    const expectedByProfileId = new Map(
      materialized.profile_revisions.map((revision) => [revision.profile_id, revision] as const),
    );
    if (
      orderedItems.some((item) => {
        const expected = expectedByProfileId.get(item.revision.profile_id);
        return (
          !expected ||
          item.revision.revision !== expected.revision ||
          item.revision.revision_hash !== expected.revision_hash
        );
      })
    ) {
      throw new TypeError("BUILTIN_TEAM_PROFILE_SET_STALE");
    }
    const expectedSkillsById = new Map(
      materialized.skill_revisions.map((revision) => [revision.skill_id, revision] as const),
    );
    const actualSkillsById = new Map(
      skillItems
        .filter((item) => expectedSkillsById.has(item.revision.skill_id))
        .map((item) => [item.revision.skill_id, item] as const),
    );
    if (
      actualSkillsById.size !== materialized.skill_revisions.length ||
      materialized.skill_revisions.some((expected) => {
        const item = actualSkillsById.get(expected.skill_id);
        if (!item) return true;
        return (
          item.head.lifecycle !== "ENABLED" ||
          !sameScope(item.revision.scope, input.scope) ||
          !sameScope(item.head.scope, input.scope) ||
          item.head.skill_id !== item.revision.skill_id ||
          item.head.active_revision !== item.revision.revision ||
          item.head.active_revision_hash !== item.revision.revision_hash ||
          item.revision.revision !== expected.revision ||
          item.revision.revision_hash !== expected.revision_hash
        );
      })
    ) {
      throw new TypeError("BUILTIN_TEAM_PROFILE_SET_STALE");
    }
    const profileRefs = Object.freeze(
      DATA_AGENT_SPECIALIST_PROFILE_IDS.map((profileId) => {
        const revision = expectedByProfileId.get(profileId);
        if (!revision) throw new TypeError("BUILTIN_TEAM_PROFILE_SET_STALE");
        return Object.freeze({
          profile_id: profileId,
          revision: revision.revision,
          revision_hash: revision.revision_hash,
        });
      }),
    );
    const skillRefs = Object.freeze(
      materialized.skill_revisions.map((revision) =>
        Object.freeze({
          skill_id: revision.skill_id,
          revision: revision.revision,
          revision_hash: revision.revision_hash,
        }),
      ),
    );
    const profileSetHash = await sha256ContentHash({
      schema_version: "builtin-team-profile-set@1.0.0",
      materialization_manifest_hash: materialized.manifest_hash,
      profile_refs: profileRefs,
      skill_refs: skillRefs,
    });
    return Object.freeze({
      schema_version: "builtin-team-profile-set@1.0.0",
      materialization_manifest_hash: materialized.manifest_hash,
      profile_refs: profileRefs,
      skill_refs: skillRefs,
      profile_set_hash: profileSetHash,
    });
  } catch (error) {
    if (error instanceof TypeError && error.message === "BUILTIN_TEAM_PROFILE_SET_STALE") {
      throw error;
    }
    throw new TypeError("BUILTIN_TEAM_PROFILE_SET_STALE", { cause: error });
  }
}

export interface MaterializeBuiltinTeamInput extends BuiltinTeamMaterializationInput {
  readonly capability_input: unknown;
  readonly actor_principal_id: string;
  readonly create_operation_id: (material: string) => string;
  readonly idempotency_prefix: string;
}

interface SkillCommitPort {
  list(
    capabilityInput: unknown,
    enabledOnly?: boolean,
  ): Promise<PortResult<readonly SkillRegistryItem[]>>;
  commit(capabilityInput: unknown, command: unknown): Promise<PortResult<unknown>>;
}

interface ProfileCommitPort {
  listManagedV2(
    capabilityInput: unknown,
  ): Promise<PortResult<readonly AgentProductProfileRegistryItemV2[]>>;
  commitV2(
    capabilityInput: unknown,
    command: unknown,
  ): Promise<PortResult<AgentProductProfileRegistryItemV2>>;
}

export async function materializeBuiltinTeamProfiles(
  input: MaterializeBuiltinTeamInput,
  dependencies: {
    readonly skills: SkillCommitPort;
    readonly profiles: ProfileCommitPort;
  },
): Promise<PortResult<readonly AgentProductProfileRegistryItemV2[]>> {
  const materialized = await buildBuiltinTeamMaterialization(input);
  const [listedSkills, listedProfiles] = await Promise.all([
    dependencies.skills.list(input.capability_input, false),
    dependencies.profiles.listManagedV2(input.capability_input),
  ]);
  if (!listedSkills.ok) return listedSkills;
  if (!listedProfiles.ok) return listedProfiles;
  const skillItemsById = new Map(
    listedSkills.value.map((item) => [item.revision.skill_id, item] as const),
  );
  const itemsByProfileId = new Map(
    listedProfiles.value.map((item) => [item.head.profile_id, item] as const),
  );
  for (const revision of materialized.skill_revisions) {
    const current = skillItemsById.get(revision.skill_id);
    const operationMaterial = `skill:${revision.skill_id}:${revision.revision}:${revision.revision_hash}:head:${current?.head.version ?? 0}:ENABLED`;
    const operationId = input.create_operation_id(operationMaterial);
    const operationHash = await sha256ContentHash(operationMaterial);
    if (
      current?.head.lifecycle === "ENABLED" &&
      current.revision.revision === revision.revision &&
      current.revision.revision_hash === revision.revision_hash
    ) {
      continue;
    }
    if (
      current &&
      (current.revision.revision > revision.revision ||
        (current.revision.revision === revision.revision &&
          current.revision.revision_hash !== revision.revision_hash))
    ) {
      return {
        ok: false,
        error: {
          code: "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
          message: "Built-in Skill immutable revision conflicts with the active registry head.",
          retryable: false,
        },
      };
    }
    const result = await dependencies.skills.commit(input.capability_input, {
      operation_id: operationId,
      idempotency_key: `${input.idempotency_prefix}:${operationHash}`,
      expected_head_version: current?.head.version ?? null,
      target_lifecycle: "ENABLED",
      revision,
    });
    if (!result.ok) return result;
  }

  const committed: AgentProductProfileRegistryItemV2[] = [];
  for (const revision of materialized.profile_revisions) {
    const current = itemsByProfileId.get(revision.profile_id);
    const operationMaterial = `profile:${revision.profile_id}:${revision.revision}:${revision.revision_hash}:head:${current?.head.version ?? 0}:ENABLED`;
    const operationId = input.create_operation_id(operationMaterial);
    const operationHash = await sha256ContentHash(operationMaterial);
    if (
      current?.head.lifecycle === "ENABLED" &&
      current.revision.revision === revision.revision &&
      current.revision.revision_hash === revision.revision_hash
    ) {
      committed.push(current);
      continue;
    }
    if (
      current &&
      (current.revision.revision > revision.revision ||
        (current.revision.revision === revision.revision &&
          current.revision.revision_hash !== revision.revision_hash))
    ) {
      return {
        ok: false,
        error: {
          code: "BUILTIN_TEAM_PROFILE_REVISION_CONFLICT",
          message: "Built-in Product Profile immutable revision conflicts with the registry head.",
          retryable: false,
        },
      };
    }
    const command = await buildAgentProductProfileCommitCommandV2({
      schema_version: "agent-product-profile-commit-command@2.0.0",
      operation_id: operationId,
      idempotency_key: `${input.idempotency_prefix}:${operationHash}`,
      actor_principal_id: input.actor_principal_id,
      revision,
      expected_head_version: current?.head.version ?? 0,
      target_lifecycle: "ENABLED",
    });
    const result = await dependencies.profiles.commitV2(input.capability_input, command);
    if (!result.ok) return result;
    committed.push(result.value);
  }
  return { ok: true, value: Object.freeze(committed) };
}

export type { AppScope, VersionedResourceReference };
