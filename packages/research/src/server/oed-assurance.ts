import {
  type ArtifactReference,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  type ContentHash,
  contentHashSchema,
  OBLIGATION_SEMANTIC_CHECKS,
  type ObligationExecutionDecisionPayload,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import {
  registerTransientOedAssuranceMetadata,
  type TransientOedAssurance,
} from "../internal/transient-oed-assurance.js";

export type {
  TransientOedAssurance,
  TransientOedAssuranceMetadata,
} from "../internal/transient-oed-assurance.js";

export interface TransientOedAssuranceBinding {
  readonly brief_ref: ArtifactReference;
  readonly evidence_plan_ref: ArtifactReference;
  readonly query_contract_ref: ArtifactReference;
  readonly sql_artifact_ref: ArtifactReference;
  readonly semantic_release_ref: ArtifactReference;
  readonly policy_receipt_ref: ArtifactReference;
}

export interface ExactOedVerifierResult {
  readonly profile: "CONTROLLED_EXACT" | "FROZEN_QUERY_REGISTRY";
  readonly compiler_verifier_version: string;
  readonly compiler_evidence_hash: string;
  readonly policy_verifier_version: string;
  readonly policy_evidence_hash: string;
  readonly semantic_checks: Readonly<Record<(typeof OBLIGATION_SEMANTIC_CHECKS)[number], boolean>>;
}

export interface IssueTransientExactOedAssuranceInput {
  readonly binding: TransientOedAssuranceBinding;
  readonly verifier_result: ExactOedVerifierResult;
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const accepted = new Set(expected);
  return actual.length === accepted.size && actual.every((key) => accepted.has(key));
}

function exactReferenceTypes(binding: TransientOedAssuranceBinding): boolean {
  const references = Object.values(binding);
  const anchor = binding.evidence_plan_ref;
  return (
    references.every((reference) => artifactReferenceSchema.safeParse(reference).success) &&
    references.every(
      (reference) =>
        reference.app_id === anchor.app_id &&
        reference.tenant_id === anchor.tenant_id &&
        reference.environment === anchor.environment &&
        reference.run_id === anchor.run_id,
    ) &&
    binding.brief_ref.artifact_type === "ResearchBrief" &&
    binding.evidence_plan_ref.artifact_type === "EvidencePlan" &&
    binding.query_contract_ref.artifact_type === "QueryContract" &&
    binding.sql_artifact_ref.artifact_type === "SqlArtifact" &&
    binding.semantic_release_ref.artifact_type === "SemanticRelease" &&
    binding.policy_receipt_ref.artifact_type === "PolicyReceipt"
  );
}

/**
 * Internal issuer for the deterministic controlled profile only.
 *
 * It is intentionally absent from both package export maps. The returned
 * object carries no usable metadata: acceptance depends on WeakMap identity,
 * so clone/spread/JSON round trips cannot manufacture or transfer assurance.
 */
export function issueTransientOedAssuranceFromExactVerifier(
  input: IssueTransientExactOedAssuranceInput,
): TransientOedAssurance {
  if (
    !exactKeys(input, ["binding", "verifier_result"]) ||
    !exactKeys(input.binding, [
      "brief_ref",
      "evidence_plan_ref",
      "query_contract_ref",
      "sql_artifact_ref",
      "semantic_release_ref",
      "policy_receipt_ref",
    ]) ||
    !exactKeys(input.verifier_result, [
      "profile",
      "compiler_verifier_version",
      "compiler_evidence_hash",
      "policy_verifier_version",
      "policy_evidence_hash",
      "semantic_checks",
    ]) ||
    !exactKeys(input.verifier_result.semantic_checks, OBLIGATION_SEMANTIC_CHECKS) ||
    !Object.values(input.verifier_result.semantic_checks).every(
      (verdict) => typeof verdict === "boolean",
    ) ||
    !["CONTROLLED_EXACT", "FROZEN_QUERY_REGISTRY"].includes(input.verifier_result.profile) ||
    !exactReferenceTypes(input.binding) ||
    !versionIdentifierSchema.safeParse(input.verifier_result.compiler_verifier_version).success ||
    !versionIdentifierSchema.safeParse(input.verifier_result.policy_verifier_version).success
  ) {
    throw new TypeError("EXACT_OED_ASSURANCE_INPUT_INVALID");
  }
  const compilerEvidenceHash = contentHashSchema.safeParse(
    input.verifier_result.compiler_evidence_hash,
  );
  const policyEvidenceHash = contentHashSchema.safeParse(
    input.verifier_result.policy_evidence_hash,
  );
  if (!compilerEvidenceHash.success || !policyEvidenceHash.success) {
    throw new TypeError("EXACT_OED_ASSURANCE_INPUT_INVALID");
  }
  const verifiedCompilerEvidenceHash = compilerEvidenceHash.data as ContentHash;
  const verifiedPolicyEvidenceHash = policyEvidenceHash.data as ContentHash;

  const semanticChecks = Object.fromEntries(
    OBLIGATION_SEMANTIC_CHECKS.map((check) => [
      check,
      input.verifier_result.semantic_checks[check] ? "MATCH" : "MISMATCH",
    ]),
  ) as ObligationExecutionDecisionPayload["checks"];
  const token = Object.freeze({
    boundary: "KERNEL_CANDIDATE_ONLY",
    persistence_authority: "NONE",
    can_authorize_execution: false,
  }) satisfies TransientOedAssurance;
  registerTransientOedAssuranceMetadata(token, {
    boundary: token.boundary,
    persistence_authority: token.persistence_authority,
    can_authorize_execution: token.can_authorize_execution,
    binding_identities: {
      brief_ref: artifactReferenceIdentity(input.binding.brief_ref),
      evidence_plan_ref: artifactReferenceIdentity(input.binding.evidence_plan_ref),
      query_contract_ref: artifactReferenceIdentity(input.binding.query_contract_ref),
      sql_artifact_ref: artifactReferenceIdentity(input.binding.sql_artifact_ref),
      semantic_release_ref: artifactReferenceIdentity(input.binding.semantic_release_ref),
      policy_receipt_ref: artifactReferenceIdentity(input.binding.policy_receipt_ref),
    },
    compiler_verifier_version: input.verifier_result.compiler_verifier_version,
    compiler_evidence_hash: verifiedCompilerEvidenceHash,
    policy_verifier_version: input.verifier_result.policy_verifier_version,
    policy_evidence_hash: verifiedPolicyEvidenceHash,
    semantic_checks: semanticChecks,
  });
  return token;
}
