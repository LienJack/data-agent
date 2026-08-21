import {
  type AgentProductProfileRegistryItem,
  type AppScope,
  buildAgentProductProfileCommitCommand,
  type PortResult,
  type VersionedResourceReference,
} from "@data-agent/contracts";
import {
  type BuiltinTeamMaterializationInput,
  buildBuiltinTeamMaterialization,
} from "./builtin-profile-assets.js";

export interface MaterializeBuiltinTeamInput extends BuiltinTeamMaterializationInput {
  readonly capability_input: unknown;
  readonly actor_principal_id: string;
  readonly create_id: () => string;
  readonly idempotency_prefix: string;
}

interface SkillCommitPort {
  commit(capabilityInput: unknown, command: unknown): Promise<PortResult<unknown>>;
}

interface ProfileCommitPort {
  list(
    capabilityInput: unknown,
    enabledOnly?: boolean,
  ): Promise<PortResult<readonly AgentProductProfileRegistryItem[]>>;
  commit(
    capabilityInput: unknown,
    command: unknown,
  ): Promise<PortResult<AgentProductProfileRegistryItem>>;
}

export async function materializeBuiltinTeamProfiles(
  input: MaterializeBuiltinTeamInput,
  dependencies: {
    readonly skills: SkillCommitPort;
    readonly profiles: ProfileCommitPort;
  },
): Promise<PortResult<readonly AgentProductProfileRegistryItem[]>> {
  const materialized = await buildBuiltinTeamMaterialization(input);
  for (const revision of materialized.skill_revisions) {
    const result = await dependencies.skills.commit(input.capability_input, {
      operation_id: input.create_id(),
      idempotency_key: `${input.idempotency_prefix}:skill:${revision.skill_id}:${revision.revision}`,
      expected_head_version: null,
      target_lifecycle: "ENABLED",
      revision,
    });
    if (!result.ok) return result;
  }

  const listed = await dependencies.profiles.list(input.capability_input, false);
  if (!listed.ok) return listed;
  const headsByProfileId = new Map(
    listed.value.map((item) => [item.head.profile_id, item.head] as const),
  );
  const committed: AgentProductProfileRegistryItem[] = [];
  for (const revision of materialized.profile_revisions) {
    const command = await buildAgentProductProfileCommitCommand({
      schema_version: "agent-product-profile-commit-command@1.0.0",
      operation_id: input.create_id(),
      idempotency_key: `${input.idempotency_prefix}:profile:${revision.profile_id}:${revision.revision}`,
      actor_principal_id: input.actor_principal_id,
      revision,
      expected_head_version: headsByProfileId.get(revision.profile_id)?.version ?? 0,
      target_lifecycle: "ENABLED",
    });
    const result = await dependencies.profiles.commit(input.capability_input, command);
    if (!result.ok) return result;
    committed.push(result.value);
  }
  return { ok: true, value: Object.freeze(committed) };
}

export type { AppScope, VersionedResourceReference };
