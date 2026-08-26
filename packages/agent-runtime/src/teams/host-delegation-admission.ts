import { createHash } from "node:crypto";
import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactReference,
  artifactReferenceIdentity,
  buildSubagentDelegationReceipt,
  canonicalizeJson,
  type DelegateToSubagentCall,
  deepFreeze,
  projectSubagentCapabilityCatalogItem,
  type RootAgentDecisionCandidate,
  type SubagentCapabilityCatalogSnapshot,
  type SubagentDelegationReceipt,
  sha256ContentHash,
  subagentRequestedBudgetSchema,
  validateRootAgentDecisionAgainstCatalog,
  verifyAgentProductProfileRevisionV2,
  verifySubagentCapabilityCatalogSnapshot,
} from "@data-agent/contracts";

export type SubagentAdmissionBudget = ReturnType<typeof subagentRequestedBudgetSchema.parse>;

export type AdmittedSubagentDelegation = Readonly<{
  call: DelegateToSubagentCall;
  profile: AgentProductProfileRegistryItemV2;
  receipt: SubagentDelegationReceipt;
}>;

export class SubagentDelegationAdmissionError extends Error {
  override readonly name = "SubagentDelegationAdmissionError";

  constructor(readonly code: string) {
    super(code);
  }
}

function deterministicUuid(material: unknown): string {
  const bytes = createHash("sha256")
    .update(`data-agent/subagent-admission@1\0${canonicalizeJson(material)}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function intersectBudget(
  requested: SubagentAdmissionBudget,
  runCeiling: SubagentAdmissionBudget,
  profileCeiling: SubagentAdmissionBudget,
): SubagentAdmissionBudget {
  return subagentRequestedBudgetSchema.parse({
    timeout_ms: Math.min(requested.timeout_ms, runCeiling.timeout_ms, profileCeiling.timeout_ms),
    max_steps: Math.min(requested.max_steps, runCeiling.max_steps, profileCeiling.max_steps),
    max_input_tokens: Math.min(
      requested.max_input_tokens,
      runCeiling.max_input_tokens,
      profileCeiling.max_input_tokens,
    ),
    max_output_tokens: Math.min(
      requested.max_output_tokens,
      runCeiling.max_output_tokens,
      profileCeiling.max_output_tokens,
    ),
    max_tool_calls: Math.min(
      requested.max_tool_calls,
      runCeiling.max_tool_calls,
      profileCeiling.max_tool_calls,
    ),
    max_context_bytes: Math.min(
      requested.max_context_bytes,
      runCeiling.max_context_bytes,
      profileCeiling.max_context_bytes,
    ),
  });
}

function exactProfile(
  catalog: SubagentCapabilityCatalogSnapshot,
  call: DelegateToSubagentCall,
  profiles: readonly AgentProductProfileRegistryItemV2[],
): AgentProductProfileRegistryItemV2 {
  const catalogItem = catalog.items.find(
    ({ profile_ref: ref }) => ref.profile_id === call.profile_id,
  );
  const profile = profiles.find(({ revision }) => revision.profile_id === call.profile_id);
  if (
    !catalogItem ||
    !profile ||
    profile.head.lifecycle !== "ENABLED" ||
    profile.revision.approval_status !== "APPROVED" ||
    profile.revision.revision !== catalogItem.profile_ref.revision ||
    profile.revision.revision_hash !== catalogItem.profile_ref.revision_hash ||
    profile.head.active_revision !== catalogItem.profile_ref.revision ||
    profile.head.active_revision_hash !== catalogItem.profile_ref.revision_hash
  ) {
    throw new SubagentDelegationAdmissionError("SUBAGENT_PROFILE_CATALOG_BINDING_STALE");
  }
  return profile;
}

export async function verifyFrozenSubagentCatalogProfiles(input: {
  readonly catalog: SubagentCapabilityCatalogSnapshot;
  readonly profiles: readonly AgentProductProfileRegistryItemV2[];
}): Promise<readonly AgentProductProfileRegistryItemV2[]> {
  const catalog = await verifySubagentCapabilityCatalogSnapshot(input.catalog);
  const profileIds = input.profiles.map(({ revision }) => revision.profile_id);
  if (new Set(profileIds).size !== profileIds.length) {
    throw new SubagentDelegationAdmissionError("SUBAGENT_PROFILE_AUTHORITY_DUPLICATE");
  }
  const verified: AgentProductProfileRegistryItemV2[] = [];
  for (const item of catalog.items) {
    const profile = input.profiles.find(
      ({ revision }) => revision.profile_id === item.profile_ref.profile_id,
    );
    if (!profile) {
      throw new SubagentDelegationAdmissionError("SUBAGENT_PROFILE_CATALOG_BINDING_STALE");
    }
    await verifyAgentProductProfileRevisionV2(profile.revision);
    if (
      profile.head.lifecycle !== "ENABLED" ||
      profile.revision.approval_status !== "APPROVED" ||
      profile.revision.revision !== item.profile_ref.revision ||
      profile.revision.revision_hash !== item.profile_ref.revision_hash ||
      profile.head.active_revision !== item.profile_ref.revision ||
      profile.head.active_revision_hash !== item.profile_ref.revision_hash ||
      canonicalizeJson(await projectSubagentCapabilityCatalogItem(profile)) !==
        canonicalizeJson(item)
    ) {
      throw new SubagentDelegationAdmissionError("SUBAGENT_PROFILE_CATALOG_BINDING_STALE");
    }
    verified.push(profile);
  }
  return deepFreeze(verified);
}

export async function admitRootAgentDelegations(input: {
  readonly decision: RootAgentDecisionCandidate;
  readonly catalog: SubagentCapabilityCatalogSnapshot;
  readonly profiles: readonly AgentProductProfileRegistryItemV2[];
  readonly run_ceiling: SubagentAdmissionBudget;
  readonly profile_ceiling: (profile: AgentProductProfileRegistryItemV2) => SubagentAdmissionBudget;
  readonly artifact_is_accepted: (reference: ArtifactReference) => Promise<boolean>;
}): Promise<readonly AdmittedSubagentDelegation[]> {
  const catalog = await verifySubagentCapabilityCatalogSnapshot(input.catalog);
  const decision = await validateRootAgentDecisionAgainstCatalog({
    candidate: input.decision,
    catalog,
  });
  if (decision.kind !== "TOOL_CALLS") return deepFreeze([]);

  const selectedProfileIds = decision.tool_calls.map(({ profile_id: profileId }) => profileId);
  if (new Set(selectedProfileIds).size !== selectedProfileIds.length) {
    throw new SubagentDelegationAdmissionError("SUBAGENT_PROFILE_DUPLICATE_IN_BATCH");
  }

  await verifyFrozenSubagentCatalogProfiles({ catalog, profiles: input.profiles });

  const admitted: AdmittedSubagentDelegation[] = [];
  for (const call of decision.tool_calls) {
    const profile = exactProfile(catalog, call, input.profiles);
    for (const reference of call.input_artifact_refs) {
      if (!(await input.artifact_is_accepted(reference))) {
        throw new SubagentDelegationAdmissionError("SUBAGENT_INPUT_ARTIFACT_NOT_ACCEPTED");
      }
    }
    const effectiveBudget = intersectBudget(
      call.requested_budget,
      input.run_ceiling,
      input.profile_ceiling(profile),
    );
    const objectiveHash = await sha256ContentHash({ objective: call.objective });
    const identityMaterial = {
      run_id: decision.run_id,
      catalog_snapshot_hash: decision.catalog_snapshot_hash,
      tool_call_id: call.tool_call_id,
    };
    const receipt = await buildSubagentDelegationReceipt({
      schema_version: "subagent-delegation-receipt@2.0.0",
      delegation_id: deterministicUuid({ ...identityMaterial, kind: "delegation" }),
      scope: decision.scope,
      run_id: decision.run_id,
      catalog_snapshot_hash: decision.catalog_snapshot_hash,
      tool_call_id: call.tool_call_id,
      profile_ref: catalog.items.find(({ profile_ref: ref }) => ref.profile_id === call.profile_id)
        ?.profile_ref,
      task_id: deterministicUuid({ ...identityMaterial, kind: "task" }),
      attempt_id: deterministicUuid({ ...identityMaterial, kind: "attempt" }),
      objective_hash: objectiveHash,
      input_artifact_refs: [...call.input_artifact_refs].sort((left, right) =>
        artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
      ),
      upstream_accepted_output: call.upstream_accepted_output,
      requested_artifact_types: call.requested_artifact_types,
      effective_budget: effectiveBudget,
      tool_allowlist: [...profile.revision.direct_tool_allowlist].sort(),
      idempotency_key: `root:${decision.run_id}:${call.tool_call_id}`,
    });
    admitted.push(deepFreeze({ call, profile, receipt }));
  }
  return deepFreeze(admitted);
}

export const hostDelegationAdmissionInternals = Object.freeze({ intersectBudget });
