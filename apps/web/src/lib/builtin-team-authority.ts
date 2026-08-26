import {
  type BuiltinTeamMaterializationInput,
  DATA_AGENT_SPECIALIST_PROFILE_IDS,
  type DataAgentSpecialistProfileId,
  verifyBuiltinTeamProfileSet,
} from "@data-agent/agent-runtime";
import type { AgentProductProfileRegistryItemV2 } from "@data-agent/contracts/agents";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { VersionedResourceReference } from "@data-agent/contracts/workspaces";
import type { SqlPool } from "@data-agent/platform/persistence";
import type { AppCapability } from "@data-agent/platform/tenancy";
import { deriveIdempotentOperationId } from "./run-command-identity";

export const BUILTIN_TEAM_ROLE_MODEL_IDS = Object.freeze({
  "governed-analysis-agent": "00000000-0000-4000-8000-000000005a04",
  "governed-text2sql-agent": "00000000-0000-4000-8000-000000005a01",
  "report-writing-agent": "00000000-0000-4000-8000-000000005a02",
  "semantic-management-agent": "00000000-0000-4000-8000-000000005a03",
} as const satisfies Readonly<Record<DataAgentSpecialistProfileId, string>>);

function operationId(capability: AppCapability, kind: string, key: string): string {
  return deriveIdempotentOperationId({
    operation_kind: kind,
    workspace_id: capability.scope.tenant_id,
    principal_id: capability.principal,
    idempotency_key: key,
  });
}

async function specialistPolicyReferences(
  capability: AppCapability,
  kind: "context" | "safety",
  source: VersionedResourceReference,
): Promise<Readonly<Record<DataAgentSpecialistProfileId, VersionedResourceReference>>> {
  const entries = await Promise.all(
    DATA_AGENT_SPECIALIST_PROFILE_IDS.map(
      async (profileId) =>
        [
          profileId,
          {
            resource_id: operationId(capability, `qa-readiness-${kind}-policy`, `${profileId}:v1`),
            resource_revision: 1,
            resource_hash: await sha256ContentHash({
              schema_version: "specialist-policy-binding@1.0.0",
              kind,
              profile_id: profileId,
              source,
            }),
          },
        ] as const,
    ),
  );
  return Object.freeze(Object.fromEntries(entries)) as Readonly<
    Record<DataAgentSpecialistProfileId, VersionedResourceReference>
  >;
}

export async function resolveBuiltinTeamMaterializationInput(input: {
  readonly pool: SqlPool;
  readonly capability: AppCapability;
  readonly deployment_id: string;
  readonly context_policy_ref: VersionedResourceReference;
  readonly execution_safety_policy_ref: VersionedResourceReference;
}): Promise<BuiltinTeamMaterializationInput> {
  const client = await input.pool.connect();
  let rows: readonly {
    readonly model_profile_id: string;
    readonly resource_revision: string;
    readonly resource_hash: string;
  }[];
  try {
    const result = await client.query<{
      readonly model_profile_id: string;
      readonly resource_revision: string;
      readonly resource_hash: string;
    }>(
      `select catalog.model_profile_id::text,
              catalog.config_version::text as resource_revision,
              app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(catalog)-'credential_ref')
                as resource_hash
         from platform.list_model_catalog($1::uuid,$2::uuid) catalog
        where catalog.model_profile_id=any($3::uuid[])
        order by catalog.model_profile_id`,
      [input.deployment_id, input.capability.principal, Object.values(BUILTIN_TEAM_ROLE_MODEL_IDS)],
    );
    rows = result.rows;
  } finally {
    client.release();
  }
  const byId = new Map(rows.map((row) => [row.model_profile_id, row] as const));
  const modelProfileRefs = Object.fromEntries(
    DATA_AGENT_SPECIALIST_PROFILE_IDS.map((profileId) => {
      const row = byId.get(BUILTIN_TEAM_ROLE_MODEL_IDS[profileId]);
      if (!row) throw new TypeError("BUILTIN_TEAM_MODEL_PROFILE_REQUIRED");
      return [
        profileId,
        {
          resource_id: row.model_profile_id,
          resource_revision: Number(row.resource_revision),
          resource_hash: row.resource_hash,
        },
      ];
    }),
  ) as Readonly<Record<DataAgentSpecialistProfileId, VersionedResourceReference>>;
  return Object.freeze({
    scope: input.capability.scope,
    model_profile_refs: modelProfileRefs,
    context_policy_refs: await specialistPolicyReferences(
      input.capability,
      "context",
      input.context_policy_ref,
    ),
    execution_safety_policy_refs: await specialistPolicyReferences(
      input.capability,
      "safety",
      input.execution_safety_policy_ref,
    ),
  });
}

export async function verifyCurrentBuiltinTeamAuthority(input: {
  readonly materialization_input: BuiltinTeamMaterializationInput;
  readonly profile_items: readonly AgentProductProfileRegistryItemV2[];
  readonly skill_items: Parameters<typeof verifyBuiltinTeamProfileSet>[2];
}) {
  return verifyBuiltinTeamProfileSet(
    input.materialization_input,
    input.profile_items,
    input.skill_items,
  );
}
