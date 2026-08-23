import {
  type AppScope,
  type AvailableModelProfile,
  authorizeAvailableModelProfile,
  computeModelProfileHash,
  type ModelProfile,
} from "@data-agent/contracts";

export const modelFixtureIds = {
  app: "10000000-0000-4000-8000-000000000001",
  tenant: "10000000-0000-4000-8000-000000000002",
  run: "10000000-0000-4000-8000-000000000003",
  profile: "10000000-0000-4000-8000-000000000004",
  profileFallback: "10000000-0000-4000-8000-000000000005",
  receipt: "10000000-0000-4000-8000-000000000006",
  receiptFallback: "10000000-0000-4000-8000-000000000007",
  task: "10000000-0000-4000-8000-000000000008",
  attempt: "10000000-0000-4000-8000-000000000009",
  request: "10000000-0000-4000-8000-000000000010",
} as const;

export const modelFixtureScope = {
  app_id: modelFixtureIds.app,
  tenant_id: modelFixtureIds.tenant,
  environment: "test",
} as const satisfies AppScope;

export const certifiedModelOperationalConstraints = {
  context_window: {
    verification_status: "VERIFIED",
    max_context_tokens: 128_000,
    max_output_tokens: 8_192,
  },
  region_privacy: {
    verification_status: "VERIFIED",
    processing_regions: ["fixture-region"],
    privacy_tags: ["no-training", "tenant-isolated"],
  },
  fallback_compatibility: {
    verification_status: "VERIFIED",
    tags: ["json-v1", "tool-contract-v1"],
  },
} satisfies ModelProfile["operational_constraints"];

const probeHash = `sha256:${"a".repeat(64)}` as const;

export async function makeAvailableProfile(
  input: Partial<ModelProfile> & Pick<ModelProfile, "provider" | "model_id">,
): Promise<AvailableModelProfile> {
  const profileId = input.profile_id ?? modelFixtureIds.profile;
  const receiptId =
    profileId === modelFixtureIds.profileFallback
      ? modelFixtureIds.receiptFallback
      : modelFixtureIds.receipt;
  const scope = input.scope ?? modelFixtureScope;
  const profile = {
    profile_id: profileId,
    scope,
    provider: input.provider,
    model_id: input.model_id,
    profile_version: input.profile_version ?? "1.0.0",
    capabilities: input.capabilities ?? {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: false,
    },
    operational_constraints: input.operational_constraints ?? certifiedModelOperationalConstraints,
    certification_status: "AVAILABLE",
    certification_receipt_ref: {
      artifact_id: receiptId,
      artifact_type: "ModelCertificationReceipt",
      app_id: scope.app_id,
      tenant_id: scope.tenant_id,
      environment: scope.environment,
      run_id: modelFixtureIds.run,
      revision: 1,
      content_hash: probeHash,
    },
    certified_model_id: input.model_id,
  } as const satisfies ModelProfile;
  const profileHash = await computeModelProfileHash(profile);

  return authorizeAvailableModelProfile(profile, {
    verifyCommitted: async () => true,
    resolve: async (reference) => ({
      schema_version: "1.0.0",
      receipt_ref: reference,
      profile_id: profile.profile_id,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      probe_hash: probeHash,
      verdict: "PASS",
    }),
  });
}
