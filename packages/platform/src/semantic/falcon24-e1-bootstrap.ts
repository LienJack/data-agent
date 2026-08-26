import { createHash } from "node:crypto";
import { canonicalizeJson, type PortResult, sha256ContentHash } from "@data-agent/contracts/common";
import {
  falcon24RetainedLlmConfigSchema,
  verifyFalcon24RetainedAssetsManifest,
} from "@data-agent/contracts/evals";
import {
  type GlobalModelCredentialRef,
  globalModelCredentialRefSchema,
  type ModelCatalogEntry,
  type ModelCertificationPublicView,
  type ModelProviderConnection,
} from "@data-agent/contracts/models";
import { buildFalcon24E1StagingReceipt } from "@data-agent/contracts/runs";
import {
  initialSemanticReleaseSetSchema,
  loadInitialSemanticReleaseResultSchema,
  publishInitialSemanticReleaseCommandSchema,
  publishInitialSemanticReleaseResultSchema,
  semanticBootstrapValidationReceiptSchema,
  verifyPublishedInitialSemanticReleaseBundle,
  verifySemanticBootstrapValidationReceipt,
} from "@data-agent/contracts/semantic";
import { z } from "zod";
import type { PostgresFalcon24AuthorityEpoch } from "../runs/postgres-authority-epoch.js";
import type { PostgresGreenfieldBootstrapReleaseAuthority } from "./greenfield-bootstrap-release-authority.js";

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const stableDefinitionKeySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u);

export const falcon24E1RuntimeAttestationProofSchema = z.strictObject({
  schema_version: z.literal("falcon24-e1-runtime-attestation-proof@1.0.0"),
  attestation_hash: hashSchema,
  operator_manifest_hash: hashSchema,
  operator_registry_digest: hashSchema,
  source_bundle_hash: hashSchema,
  attestation_evidence_hash: hashSchema,
  production_gate: z.enum(["GO", "HOLD"]),
  production_isolation_proven: z.boolean(),
});

export const falcon24E1AgentProfileBuildProofSchema = z.strictObject({
  schema_version: z.literal("falcon24-e1-agent-profile-build-proof@1.0.0"),
  source_model_profile_id: z.uuid(),
  source_model_config_version: z.number().int().positive().safe(),
  source_model_projection_hash: hashSchema,
  profile_count: z.literal(4),
  profile_bundle_hash: hashSchema,
  materialized: z.literal(false),
});

const semanticBootstrapInputSchema = z.strictObject({
  definition_keys: z.array(stableDefinitionKeySchema).min(1).max(1_000),
  source_bundle_hash: hashSchema,
  validation_receipt: semanticBootstrapValidationReceiptSchema,
  publish_command: publishInitialSemanticReleaseCommandSchema,
  forbidden_release_ids: z.array(z.uuid()).max(10_000).default([]),
  forbidden_release_hashes: z.array(hashSchema).max(10_000).default([]),
});

const bootstrapInputSchema = z.strictObject({
  capability: z.unknown(),
  admin_context: z.strictObject({ deployment_id: z.uuid(), principal_id: z.uuid() }),
  staging_id: z.uuid(),
  retained_manifest: z.unknown(),
  llm_manifest: z.unknown(),
  llm_manifest_hash: hashSchema,
  credential_ref: globalModelCredentialRefSchema.nullable(),
  semantic: semanticBootstrapInputSchema,
  forbidden_model_profile_ids: z.array(z.uuid()).max(10_000).default([]),
  forbidden_certification_refs: z
    .array(
      z.strictObject({
        model_profile_id: z.uuid(),
        model_config_version: z.number().int().positive().safe(),
      }),
    )
    .max(10_000)
    .default([]),
  runtime_attestation: falcon24E1RuntimeAttestationProofSchema,
});

type Boundary<T> = PortResult<T>;

export interface Falcon24E1ModelControlPort {
  listProviderConnections(context: unknown): Promise<Boundary<readonly ModelProviderConnection[]>>;
  listModels(context: unknown): Promise<Boundary<readonly ModelCatalogEntry[]>>;
  listModelAuthentications(
    context: unknown,
  ): Promise<Boundary<readonly ModelCertificationPublicView[]>>;
  applyProviderConnectionCommand(
    context: unknown,
    command: unknown,
  ): Promise<Boundary<ModelProviderConnection>>;
  applyProviderSelection(
    context: unknown,
    command: unknown,
  ): Promise<Boundary<readonly ModelCatalogEntry[]>>;
  applyModelCommand(context: unknown, command: unknown): Promise<Boundary<ModelCatalogEntry>>;
  recordModelAuthentication(
    context: unknown,
    command: unknown,
  ): Promise<Boundary<ModelCertificationPublicView>>;
}

export interface Falcon24E1BootstrapDependencies {
  readonly semantic_authority: Pick<
    PostgresGreenfieldBootstrapReleaseAuthority,
    "publishInitial" | "loadInitial"
  >;
  readonly model_control: Falcon24E1ModelControlPort;
  readonly epoch_authority: Pick<
    PostgresFalcon24AuthorityEpoch,
    "beginStaging" | "loadCurrent" | "recordReceipt"
  >;
  readonly authenticate_model: (input: {
    readonly model: ModelCatalogEntry;
    readonly credential_ref: GlobalModelCredentialRef;
  }) => Promise<{ readonly response_item_count: number }>;
  readonly build_agent_profiles: (input: {
    readonly model_profile_id: string;
    readonly model_config_version: number;
    readonly model_projection_hash: `sha256:${string}`;
  }) => Promise<z.infer<typeof falcon24E1AgentProfileBuildProofSchema>>;
}

export function deriveFalcon24E1BootstrapId(
  retainedAssetsHash: string,
  identityKind: string,
  logicalKey: string,
): string {
  const digits = createHash("sha256")
    .update(`falcon24-e1:${retainedAssetsHash}:${identityKind}:${logicalKey}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function requireBoundary<T>(result: Boundary<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function assertCanonicalDefinitionKeys(keys: readonly string[], expectedCount: number): void {
  const canonical = [...keys].sort();
  if (
    keys.length !== expectedCount ||
    new Set(keys).size !== keys.length ||
    keys.some((key, index) => key !== canonical[index])
  ) {
    throw new TypeError("FALCON24_E1_SEMANTIC_DEFINITION_SET_INVALID");
  }
}

async function semanticBootstrap(
  input: z.infer<typeof bootstrapInputSchema>,
  retained: Awaited<ReturnType<typeof verifyFalcon24RetainedAssetsManifest>>,
  dependencies: Falcon24E1BootstrapDependencies,
) {
  const semantic = input.semantic;
  assertCanonicalDefinitionKeys(
    semantic.definition_keys,
    retained.semantics.expected_definition_count,
  );
  if (
    semantic.source_bundle_hash !== retained.semantics.source_bundle_hash ||
    semantic.validation_receipt.source_bundle.bundle_hash !== semantic.source_bundle_hash
  ) {
    throw new TypeError("FALCON24_E1_SEMANTIC_SOURCE_MISMATCH");
  }
  await verifySemanticBootstrapValidationReceipt(semantic.validation_receipt);
  const command = publishInitialSemanticReleaseCommandSchema.parse(semantic.publish_command);
  const release = initialSemanticReleaseSetSchema.parse(command.release_set);
  if (
    release.generation !== 1 ||
    release.base_release_id !== null ||
    release.validation_ref.receipt_id !== semantic.validation_receipt.receipt_id ||
    release.validation_ref.receipt_hash !== semantic.validation_receipt.receipt_hash ||
    semantic.forbidden_release_ids.includes(release.release_id) ||
    semantic.forbidden_release_ids.includes(release.release_set_id) ||
    semantic.forbidden_release_hashes.includes(release.release_set_hash)
  ) {
    throw new TypeError("FALCON24_E1_SEMANTIC_RELEASE_IDENTITY_INVALID");
  }
  const published = publishInitialSemanticReleaseResultSchema.parse(
    requireBoundary(
      await dependencies.semantic_authority.publishInitial(input.capability, command),
    ),
  );
  await verifyPublishedInitialSemanticReleaseBundle(published);
  const loaded = loadInitialSemanticReleaseResultSchema.parse(
    requireBoundary(
      await dependencies.semantic_authority.loadInitial(input.capability, {
        schema_version: "load-initial-semantic-release-command@1.0.0",
        scope: release.scope,
        semantic_domain: release.semantic_domain,
        release_set_ref: {
          release_set_id: release.release_set_id,
          release_set_hash: release.release_set_hash,
        },
      }),
    ),
  );
  await verifyPublishedInitialSemanticReleaseBundle(loaded);
  if (
    published.release_set.release_set_hash !== loaded.release_set.release_set_hash ||
    published.first_release_receipt.receipt_hash !== loaded.first_release_receipt.receipt_hash
  ) {
    throw new TypeError("FALCON24_E1_SEMANTIC_REPLAY_MISMATCH");
  }
  return {
    release_set_id: release.release_set_id,
    release_set_hash: release.release_set_hash,
    release_id: release.release_id,
    generation: release.generation,
    publication_disposition: published.disposition,
    evidence_hash: await sha256ContentHash({
      source_bundle_hash: semantic.source_bundle_hash,
      definition_keys: semantic.definition_keys,
      validation_receipt_hash: semantic.validation_receipt.receipt_hash,
      first_release_receipt_hash: published.first_release_receipt.receipt_hash,
    }),
  } as const;
}

function exactProvider(
  provider: ModelProviderConnection,
  profile: z.infer<typeof falcon24RetainedLlmConfigSchema>["profiles"][number],
  credentialRef: GlobalModelCredentialRef | null,
): boolean {
  return (
    provider.vendor_id === profile.vendor_id &&
    provider.runtime_provider === profile.runtime_provider &&
    provider.display_name === profile.display_name &&
    provider.base_url === profile.base_url &&
    provider.status === "ACTIVE" &&
    canonicalEqual(provider.credential_ref, credentialRef)
  );
}

function exactModel(
  model: ModelCatalogEntry,
  providerId: string,
  profile: z.infer<typeof falcon24RetainedLlmConfigSchema>["profiles"][number],
  credentialRef: GlobalModelCredentialRef | null,
): boolean {
  const capabilities = modelCapabilities(profile.capabilities);
  return (
    model.provider_connection_id === providerId &&
    model.provider === profile.runtime_provider &&
    model.model_id === profile.model_id &&
    model.display_name === profile.display_name &&
    model.base_url === profile.base_url &&
    canonicalEqual(model.capabilities, capabilities) &&
    canonicalEqual(model.credential_ref, credentialRef) &&
    model.status === (credentialRef ? "ACTIVE" : "DRAFT") &&
    model.is_system_default === profile.default
  );
}

function sameModelIdentity(
  model: ModelCatalogEntry,
  providerId: string,
  profile: z.infer<typeof falcon24RetainedLlmConfigSchema>["profiles"][number],
): boolean {
  return (
    model.provider_connection_id === providerId &&
    model.provider === profile.runtime_provider &&
    model.model_id === profile.model_id &&
    model.display_name === profile.display_name &&
    model.base_url === profile.base_url &&
    canonicalEqual(model.capabilities, modelCapabilities(profile.capabilities))
  );
}

function modelCapabilities(capabilities: readonly string[]) {
  return {
    structured_output: capabilities.includes("STRUCTURED_OUTPUT"),
    tool_calling: capabilities.includes("TOOLS"),
    streaming: capabilities.includes("STREAMING"),
    reasoning: capabilities.includes("REASONING"),
    vision: capabilities.includes("VISION"),
  } as const;
}

async function modelBootstrap(
  input: z.infer<typeof bootstrapInputSchema>,
  retained: Awaited<ReturnType<typeof verifyFalcon24RetainedAssetsManifest>>,
  dependencies: Falcon24E1BootstrapDependencies,
) {
  const llm = falcon24RetainedLlmConfigSchema.parse(input.llm_manifest);
  if (
    input.llm_manifest_hash !== retained.llm.manifest_hash ||
    !canonicalEqual(llm.profiles, retained.llm.profiles) ||
    llm.profiles.length !== 1
  ) {
    throw new TypeError("FALCON24_E1_LLM_MANIFEST_MISMATCH");
  }
  const profile = llm.profiles[0];
  if (!profile) throw new TypeError("FALCON24_E1_LLM_PROFILE_REQUIRED");
  const providerId = deriveFalcon24E1BootstrapId(
    retained.manifest_hash,
    "provider-connection",
    profile.logical_profile_key,
  );
  const modelProfileId = deriveFalcon24E1BootstrapId(
    retained.manifest_hash,
    "model-profile",
    profile.logical_profile_key,
  );
  if (input.forbidden_model_profile_ids.includes(modelProfileId)) {
    throw new TypeError("FALCON24_E1_OLD_MODEL_IDENTITY_REJECTED");
  }
  const credentialRef = input.credential_ref;
  const scope = semanticBootstrapInputSchema.parse(input.semantic).publish_command.scope;
  if (
    credentialRef &&
    (credentialRef.app_id !== scope.app_id || credentialRef.environment !== scope.environment)
  ) {
    throw new TypeError("FALCON24_E1_CREDENTIAL_SCOPE_INVALID");
  }

  let provider = requireBoundary(
    await dependencies.model_control.listProviderConnections(input.admin_context),
  ).find(({ provider_connection_id: id }) => id === providerId);
  if (provider && !exactProvider(provider, profile, credentialRef)) {
    const canBindFreshCredential = provider.credential_ref === null && credentialRef !== null;
    if (
      !canBindFreshCredential ||
      !exactProvider({ ...provider, credential_ref: credentialRef }, profile, credentialRef)
    ) {
      throw new TypeError("FALCON24_E1_MODEL_PROVIDER_IDENTITY_CONFLICT");
    }
  }
  if (!provider || !exactProvider(provider, profile, credentialRef)) {
    provider = requireBoundary(
      await dependencies.model_control.applyProviderConnectionCommand(input.admin_context, {
        schema_version: "model-provider-upsert@1.0.0",
        operation_id: deriveFalcon24E1BootstrapId(
          retained.manifest_hash,
          "provider-operation",
          `${profile.logical_profile_key}:${provider?.config_version ?? 0}:${credentialRef ? "bound" : "unbound"}`,
        ),
        idempotency_key: `falcon24-e1-provider-${retained.manifest_hash.slice(7, 31)}`,
        provider_connection_id: providerId,
        vendor_id: profile.vendor_id,
        runtime_provider: profile.runtime_provider,
        display_name: profile.display_name,
        base_url: profile.base_url,
        credential_ref: credentialRef,
        expected_config_version: provider?.config_version ?? 0,
      }),
    );
  }
  if (!exactProvider(provider, profile, credentialRef)) {
    throw new TypeError("FALCON24_E1_MODEL_PROVIDER_RESULT_MISMATCH");
  }

  let model = requireBoundary(
    await dependencies.model_control.listModels(input.admin_context),
  ).find(({ model_profile_id: id }) => id === modelProfileId);
  if (model && !sameModelIdentity(model, providerId, profile)) {
    throw new TypeError("FALCON24_E1_MODEL_PROFILE_IDENTITY_CONFLICT");
  }
  if (
    model &&
    !canonicalEqual(model.credential_ref, credentialRef) &&
    !(model.credential_ref === null && credentialRef !== null)
  ) {
    throw new TypeError("FALCON24_E1_MODEL_PROFILE_IDENTITY_CONFLICT");
  }
  if (!model || !canonicalEqual(model.credential_ref, credentialRef)) {
    const selected = requireBoundary(
      await dependencies.model_control.applyProviderSelection(input.admin_context, {
        schema_version: "model-provider-selection@1.0.0",
        operation_id: deriveFalcon24E1BootstrapId(
          retained.manifest_hash,
          "model-provider-selection-operation",
          `${profile.logical_profile_key}:${model?.config_version ?? 0}:${credentialRef ? "bound" : "unbound"}`,
        ),
        idempotency_key: `falcon24-e1-select-${retained.manifest_hash.slice(7, 29)}-${model?.config_version ?? 0}`,
        provider_connection_id: providerId,
        expected_connection_version: provider.config_version,
        models: [
          {
            model_profile_id: modelProfileId,
            model_id: profile.model_id,
            display_name: profile.display_name,
            capabilities: modelCapabilities(profile.capabilities),
            enabled: false,
            expected_config_version: model?.config_version ?? 0,
          },
        ],
      }),
    );
    model = selected.find(({ model_profile_id: id }) => id === modelProfileId);
    if (
      !model ||
      !sameModelIdentity(model, providerId, profile) ||
      !canonicalEqual(model.credential_ref, credentialRef)
    ) {
      throw new TypeError("FALCON24_E1_MODEL_PROVIDER_SELECTION_MISMATCH");
    }
  }
  if (!exactModel(model, providerId, profile, credentialRef)) {
    model = requireBoundary(
      await dependencies.model_control.applyModelCommand(input.admin_context, {
        schema_version: "model-catalog-upsert@1.0.0",
        operation_id: deriveFalcon24E1BootstrapId(
          retained.manifest_hash,
          "model-operation",
          `${profile.logical_profile_key}:${model?.config_version ?? 0}:${credentialRef ? "active" : "draft"}`,
        ),
        idempotency_key: `falcon24-e1-model-${retained.manifest_hash.slice(7, 31)}`,
        model_profile_id: modelProfileId,
        provider_connection_id: providerId,
        provider: profile.runtime_provider,
        model_id: profile.model_id,
        display_name: profile.display_name,
        base_url: profile.base_url,
        capabilities: modelCapabilities(profile.capabilities),
        credential_ref: credentialRef,
        status: credentialRef ? "ACTIVE" : "DRAFT",
        is_system_default: profile.default,
        expected_config_version: model?.config_version ?? 0,
      }),
    );
  }
  if (!exactModel(model, providerId, profile, credentialRef)) {
    throw new TypeError("FALCON24_E1_MODEL_PROFILE_RESULT_MISMATCH");
  }

  let certification = requireBoundary(
    await dependencies.model_control.listModelAuthentications(input.admin_context),
  ).find(
    (candidate) =>
      candidate.model_profile_id === model?.model_profile_id &&
      candidate.model_config_version === model?.config_version &&
      candidate.state === "PASS",
  );
  if (
    certification &&
    input.forbidden_certification_refs.some(
      (forbidden) =>
        forbidden.model_profile_id === certification?.model_profile_id &&
        forbidden.model_config_version === certification?.model_config_version,
    )
  ) {
    throw new TypeError("FALCON24_E1_OLD_MODEL_CERTIFICATION_REJECTED");
  }
  if (credentialRef && !certification) {
    const authenticated = await dependencies.authenticate_model({
      model,
      credential_ref: credentialRef,
    });
    if (
      !Number.isSafeInteger(authenticated.response_item_count) ||
      authenticated.response_item_count < 1
    ) {
      throw new TypeError("FALCON24_E1_MODEL_AUTHENTICATION_INVALID");
    }
    certification = requireBoundary(
      await dependencies.model_control.recordModelAuthentication(input.admin_context, {
        schema_version: "model-api-authentication@1.0.0",
        model_profile_id: model.model_profile_id,
        expected_config_version: model.config_version,
        response_item_count: authenticated.response_item_count,
        idempotency_key: `falcon24-e1-auth-${retained.manifest_hash.slice(7, 31)}`,
      }),
    );
  }
  if (credentialRef && certification?.state !== "PASS") {
    throw new TypeError("FALCON24_E1_MODEL_CERTIFICATION_REQUIRED");
  }
  const safeProjection = {
    provider_connection_id: provider.provider_connection_id,
    provider_config_version: provider.config_version,
    model_profile_id: model.model_profile_id,
    model_config_version: model.config_version,
    provider: model.provider,
    model_id: model.model_id,
    capabilities: model.capabilities,
    credential_bound: credentialRef !== null,
    certification_state: certification?.state ?? "NOT_CERTIFIED",
  } as const;
  return {
    ...safeProjection,
    readiness: certification?.state === "PASS" ? ("READY" as const) : ("HOLD" as const),
    subject_hash: await sha256ContentHash(llm),
    evidence_hash: await sha256ContentHash(safeProjection),
    projection_hash: await sha256ContentHash({
      model_profile_id: model.model_profile_id,
      model_config_version: model.config_version,
      provider: model.provider,
      model_id: model.model_id,
      capabilities: model.capabilities,
    }),
  };
}

async function recordReceipt(
  input: z.infer<typeof bootstrapInputSchema>,
  dependencies: Falcon24E1BootstrapDependencies,
  material: {
    readonly component:
      | "AGENT_PROFILES"
      | "LLM_CONFIGURATION"
      | "OPERATOR_REGISTRY"
      | "SANDBOX_RUNTIME"
      | "SEMANTIC_RELEASE";
    readonly subject_hash: string;
    readonly evidence_hash: string;
    readonly production_isolation_proven: boolean;
  },
) {
  const receipt = await buildFalcon24E1StagingReceipt({
    schema_version: "falcon24-e1-staging-receipt@1.0.0",
    staging_id: input.staging_id,
    ...material,
  });
  return requireBoundary(
    await dependencies.epoch_authority.recordReceipt(input.capability, receipt),
  );
}

export async function bootstrapFalcon24E1(
  candidate: unknown,
  dependencies: Falcon24E1BootstrapDependencies,
) {
  const input = bootstrapInputSchema.parse(candidate);
  const retained = await verifyFalcon24RetainedAssetsManifest(input.retained_manifest);
  const currentBefore = requireBoundary(
    await dependencies.epoch_authority.loadCurrent(input.capability),
  );
  if (currentBefore !== null) throw new TypeError("FALCON24_E1_ALREADY_ACTIVE");
  requireBoundary(
    await dependencies.epoch_authority.beginStaging(input.capability, {
      staging_id: input.staging_id,
      retained_assets_hash: retained.manifest_hash,
    }),
  );

  const semantic = await semanticBootstrap(input, retained, dependencies);
  const semanticReceipt = await recordReceipt(input, dependencies, {
    component: "SEMANTIC_RELEASE",
    subject_hash: semantic.release_set_hash,
    evidence_hash: semantic.evidence_hash,
    production_isolation_proven: false,
  });
  const model = await modelBootstrap(input, retained, dependencies);
  const modelReceipt = await recordReceipt(input, dependencies, {
    component: "LLM_CONFIGURATION",
    subject_hash: model.subject_hash,
    evidence_hash: model.evidence_hash,
    production_isolation_proven: false,
  });
  const agentProfileProof = falcon24E1AgentProfileBuildProofSchema.parse(
    await dependencies.build_agent_profiles({
      model_profile_id: model.model_profile_id,
      model_config_version: model.model_config_version,
      model_projection_hash: model.projection_hash,
    }),
  );
  if (
    agentProfileProof.source_model_profile_id !== model.model_profile_id ||
    agentProfileProof.source_model_config_version !== model.model_config_version ||
    agentProfileProof.source_model_projection_hash !== model.projection_hash
  ) {
    throw new TypeError("FALCON24_E1_AGENT_PROFILE_MODEL_BINDING_MISMATCH");
  }
  const agentReceipt = await recordReceipt(input, dependencies, {
    component: "AGENT_PROFILES",
    subject_hash: agentProfileProof.profile_bundle_hash,
    evidence_hash: await sha256ContentHash(agentProfileProof),
    production_isolation_proven: false,
  });

  const runtime = falcon24E1RuntimeAttestationProofSchema.parse(input.runtime_attestation);
  if (
    runtime.attestation_hash !== retained.analysis_runtime.attestation_hash ||
    runtime.operator_manifest_hash !== retained.analysis_runtime.operator_manifest_hash ||
    runtime.operator_registry_digest !== retained.analysis_runtime.operator_registry_digest ||
    runtime.source_bundle_hash !== retained.analysis_runtime.source_bundle_hash ||
    runtime.production_gate !== retained.analysis_runtime.production_gate ||
    runtime.production_isolation_proven !== retained.analysis_runtime.production_isolation_proven ||
    runtime.production_isolation_proven !== (runtime.production_gate === "GO")
  ) {
    throw new TypeError("FALCON24_E1_RUNTIME_ATTESTATION_MISMATCH");
  }
  const operatorReceipt = await recordReceipt(input, dependencies, {
    component: "OPERATOR_REGISTRY",
    subject_hash: runtime.operator_registry_digest,
    evidence_hash: runtime.operator_manifest_hash,
    production_isolation_proven: false,
  });
  const sandboxReceipt = await recordReceipt(input, dependencies, {
    component: "SANDBOX_RUNTIME",
    subject_hash: runtime.attestation_hash,
    evidence_hash: runtime.attestation_evidence_hash,
    production_isolation_proven: runtime.production_isolation_proven,
  });
  const currentAfter = requireBoundary(
    await dependencies.epoch_authority.loadCurrent(input.capability),
  );
  if (currentAfter !== null) throw new TypeError("FALCON24_E1_BOOTSTRAP_ACTIVATED_EARLY");
  return Object.freeze({
    schema_version: "falcon24-e1-bootstrap-result@1.0.0" as const,
    terminal:
      model.readiness === "READY" && runtime.production_gate === "GO"
        ? ("STAGED_READY" as const)
        : ("STAGED_HOLD" as const),
    staging_id: input.staging_id,
    retained_assets_hash: retained.manifest_hash,
    semantic,
    model,
    agent_profiles: agentProfileProof,
    runtime_attestation: runtime,
    staging_receipts: Object.freeze({
      semantic_release: semanticReceipt.receipt_hash,
      llm_configuration: modelReceipt.receipt_hash,
      agent_profiles: agentReceipt.receipt_hash,
      operator_registry: operatorReceipt.receipt_hash,
      sandbox_runtime: sandboxReceipt.receipt_hash,
    }),
    current_epoch: null,
  });
}
