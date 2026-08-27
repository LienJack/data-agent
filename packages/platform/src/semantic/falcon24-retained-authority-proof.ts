import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24SemanticReleaseAuthorityProofV2,
  type Falcon24RetainedAssetsManifest,
  type Falcon24SemanticReleaseAuthorityProofV2,
  falcon24RetainedLlmConfigSchema,
} from "@data-agent/contracts/evals";
import type {
  GlobalModelCredentialRef,
  ModelCatalogEntry,
  ModelCertificationPublicView,
  ModelProviderConnection,
} from "@data-agent/contracts/models";
import {
  loadInitialSemanticReleaseResultSchema,
  type SemanticRuntimeClosureValidationReceipt,
  type SemanticRuntimeSmokeReceipt,
  type SemanticSuccessorStage,
  verifyPublishedInitialSemanticReleaseBundle,
  verifySemanticRuntimeClosureValidationReceipt,
  verifySemanticRuntimeSmokeReceipt,
  verifySemanticSuccessorStage,
} from "@data-agent/contracts/semantic";

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
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

export async function buildFalcon24HistoricalSemanticReleaseAuthorityProof(input: {
  readonly retained_semantics: Falcon24RetainedAssetsManifest["semantics"];
  readonly definition_keys: readonly string[];
  readonly loaded_release: unknown;
}) {
  if (
    input.retained_semantics.source_bundle_hash !== input.retained_semantics.database_export_hash ||
    input.retained_semantics.semantic_diff.status !== "MATCH" ||
    (await sha256ContentHash(input.retained_semantics.semantic_diff.differences)) !==
      input.retained_semantics.semantic_diff.diff_hash
  ) {
    throw new TypeError("FALCON24_SEMANTIC_RETAINED_EXPORT_INVALID");
  }
  const definitionKeys = [...input.definition_keys];
  const sorted = [...definitionKeys].sort();
  if (
    definitionKeys.length !== input.retained_semantics.expected_definition_count ||
    new Set(definitionKeys).size !== definitionKeys.length ||
    definitionKeys.some((key, index) => key !== sorted[index])
  ) {
    throw new TypeError("FALCON24_SEMANTIC_DEFINITION_SET_INVALID");
  }
  const loaded = loadInitialSemanticReleaseResultSchema.parse(input.loaded_release);
  await verifyPublishedInitialSemanticReleaseBundle(loaded);
  if (
    loaded.release_set.generation !== 1 ||
    loaded.release_set.base_release_id !== null ||
    loaded.release_set.packages.length !== 1 ||
    loaded.release_set.semantic_domain !== "falcon24"
  ) {
    throw new TypeError("FALCON24_SEMANTIC_RELEASE_IDENTITY_INVALID");
  }
  return Object.freeze({
    release_set_id: loaded.release_set.release_set_id,
    release_id: loaded.release_set.release_id,
    generation: loaded.release_set.generation,
    subject_hash: loaded.release_set.release_set_hash,
    evidence_hash: await sha256ContentHash({
      source_bundle_hash: input.retained_semantics.source_bundle_hash,
      definition_keys: definitionKeys,
      validation_receipt_hash: loaded.release_set.validation_ref.receipt_hash,
      first_release_receipt_hash: loaded.first_release_receipt.receipt_hash,
    }),
  });
}

/**
 * Historical generation-1 proof compatibility only. E4 and later must use
 * buildFalcon24SemanticSuccessorAuthorityProof so predecessor equality cannot
 * be mistaken for successor evidence.
 */
export async function buildFalcon24SemanticReleaseAuthorityProof(input: {
  readonly retained_semantics: Falcon24RetainedAssetsManifest["semantics"];
  readonly definition_keys: readonly string[];
  readonly loaded_release: unknown;
}) {
  return buildFalcon24HistoricalSemanticReleaseAuthorityProof(input);
}

function exactSuccessorReceiptClosure(input: {
  readonly stage: SemanticSuccessorStage;
  readonly validation: SemanticRuntimeClosureValidationReceipt;
  readonly smoke: SemanticRuntimeSmokeReceipt;
}): boolean {
  const { stage, validation, smoke } = input;
  return (
    validation.stage_id === stage.stage_id &&
    validation.stage_digest === stage.stage_digest &&
    canonicalEqual(validation.candidate_release, stage.candidate_release) &&
    canonicalEqual(validation.projection_refs, stage.projection_refs) &&
    smoke.stage_id === stage.stage_id &&
    smoke.stage_digest === stage.stage_digest &&
    canonicalEqual(smoke.candidate_release, stage.candidate_release) &&
    canonicalEqual(smoke.projection_refs, stage.projection_refs) &&
    canonicalEqual(smoke.validator_identity, validation.validator_identity)
  );
}

export async function buildFalcon24SemanticSuccessorAuthorityProof(input: {
  readonly stage: unknown;
  readonly validation_receipt: unknown;
  readonly smoke_receipt: unknown;
  readonly expected_versions: Falcon24SemanticReleaseAuthorityProofV2["expected_versions"];
}): Promise<Falcon24SemanticReleaseAuthorityProofV2> {
  const [stage, validation, smoke] = await Promise.all([
    verifySemanticSuccessorStage(input.stage),
    verifySemanticRuntimeClosureValidationReceipt(input.validation_receipt),
    verifySemanticRuntimeSmokeReceipt(input.smoke_receipt),
  ]);
  if (
    stage.status !== "SMOKE_PASSED" ||
    validation.outcome !== "PASS" ||
    smoke.outcome !== "PASS" ||
    input.expected_versions.semantic_pointer !== stage.expected_pointer_version
  ) {
    throw new TypeError("FALCON24_SEMANTIC_SUCCESSOR_NOT_ACTIVATABLE");
  }
  if (!exactSuccessorReceiptClosure({ stage, validation, smoke })) {
    throw new TypeError("FALCON24_SEMANTIC_SUCCESSOR_RECEIPT_CLOSURE_INVALID");
  }
  return buildFalcon24SemanticReleaseAuthorityProofV2({
    schema_version: "falcon24-semantic-release-authority-proof@2.0.0",
    authority_epoch: "E4",
    predecessor_release: {
      ...stage.predecessor_release,
      datasource_id: stage.candidate_release.datasource_id,
    },
    candidate_release: stage.candidate_release,
    projections: stage.projection_refs,
    change_set_ref: stage.change_set_ref,
    review_ref: stage.review_ref,
    source_snapshot_ref: stage.source_snapshot_ref,
    compiler_bundle_ref: stage.compiler_bundle_ref,
    validation_receipt_ref: {
      schema_version: validation.schema_version,
      receipt_id: validation.receipt_id,
      validation_receipt_hash: validation.validation_receipt_hash,
    },
    smoke_receipt_ref: {
      schema_version: smoke.schema_version,
      receipt_id: smoke.receipt_id,
      smoke_receipt_hash: smoke.smoke_receipt_hash,
    },
    expected_versions: input.expected_versions,
  });
}

export async function buildFalcon24ModelAuthorityProof(input: {
  readonly retained_llm: Falcon24RetainedAssetsManifest["llm"];
  readonly llm_manifest: unknown;
  readonly provider: ModelProviderConnection;
  readonly model: ModelCatalogEntry;
  readonly credential_ref: GlobalModelCredentialRef | null;
  readonly certification?: ModelCertificationPublicView;
  readonly require_ready: boolean;
}) {
  const llm = falcon24RetainedLlmConfigSchema.parse(input.llm_manifest);
  if (!canonicalEqual(llm.profiles, input.retained_llm.profiles) || llm.profiles.length !== 1) {
    throw new TypeError("FALCON24_LLM_MANIFEST_MISMATCH");
  }
  const profile = llm.profiles[0];
  if (!profile) throw new TypeError("FALCON24_LLM_PROFILE_REQUIRED");
  const expectedCapabilities = modelCapabilities(profile.capabilities);
  const expectedStatus = input.credential_ref ? "ACTIVE" : "DRAFT";
  if (
    input.provider.vendor_id !== profile.vendor_id ||
    input.provider.runtime_provider !== profile.runtime_provider ||
    input.provider.display_name !== profile.display_name ||
    input.provider.base_url !== profile.base_url ||
    input.provider.status !== "ACTIVE" ||
    !canonicalEqual(input.provider.credential_ref, input.credential_ref) ||
    input.model.provider_connection_id !== input.provider.provider_connection_id ||
    input.model.provider !== profile.runtime_provider ||
    input.model.model_id !== profile.model_id ||
    input.model.display_name !== profile.display_name ||
    input.model.base_url !== profile.base_url ||
    !canonicalEqual(input.model.capabilities, expectedCapabilities) ||
    !canonicalEqual(input.model.credential_ref, input.credential_ref) ||
    input.model.status !== expectedStatus ||
    input.model.is_system_default !== profile.default
  ) {
    throw new TypeError("FALCON24_MODEL_AUTHORITY_MISMATCH");
  }
  const certificationState = input.certification?.state ?? "NOT_CERTIFIED";
  if (
    input.certification &&
    (input.certification.model_profile_id !== input.model.model_profile_id ||
      input.certification.model_config_version !== input.model.config_version)
  ) {
    throw new TypeError("FALCON24_MODEL_CERTIFICATION_MISMATCH");
  }
  if (input.require_ready && (input.credential_ref === null || certificationState !== "PASS")) {
    throw new TypeError("FALCON24_MODEL_CERTIFICATION_REQUIRED");
  }
  const safeProjection = {
    provider_connection_id: input.provider.provider_connection_id,
    provider_config_version: input.provider.config_version,
    model_profile_id: input.model.model_profile_id,
    model_config_version: input.model.config_version,
    provider: input.model.provider,
    model_id: input.model.model_id,
    capabilities: input.model.capabilities,
    credential_bound: input.credential_ref !== null,
    certification_state: certificationState,
  } as const;
  return Object.freeze({
    ...safeProjection,
    readiness: certificationState === "PASS" ? ("READY" as const) : ("HOLD" as const),
    subject_hash: await sha256ContentHash(llm),
    evidence_hash: await sha256ContentHash(safeProjection),
    projection_hash: await sha256ContentHash({
      model_profile_id: input.model.model_profile_id,
      model_config_version: input.model.config_version,
      provider: input.model.provider,
      model_id: input.model.model_id,
      capabilities: input.model.capabilities,
    }),
  });
}
