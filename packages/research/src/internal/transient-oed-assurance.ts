import type { ContentHash, ObligationExecutionDecisionPayload } from "@data-agent/contracts";

export interface TransientOedAssurance {
  readonly boundary: "KERNEL_CANDIDATE_ONLY";
  readonly persistence_authority: "NONE";
  readonly can_authorize_execution: false;
}

export interface TransientOedAssuranceMetadata {
  readonly boundary: "KERNEL_CANDIDATE_ONLY";
  readonly persistence_authority: "NONE";
  readonly can_authorize_execution: false;
  readonly binding_identities: Readonly<{
    readonly brief_ref: string;
    readonly evidence_plan_ref: string;
    readonly query_contract_ref: string;
    readonly sql_artifact_ref: string;
    readonly semantic_release_ref: string;
    readonly policy_receipt_ref: string;
  }>;
  readonly compiler_verifier_version: string;
  readonly compiler_evidence_hash: ContentHash;
  readonly policy_verifier_version: string;
  readonly policy_evidence_hash: ContentHash;
  readonly semantic_checks: ObligationExecutionDecisionPayload["checks"];
}

const assuranceMetadata = new WeakMap<object, TransientOedAssuranceMetadata>();

/**
 * Registers one process-local token issued by the controlled server boundary.
 *
 * The registry never exposes mutation or enumeration. Metadata is copied and
 * frozen at registration so later caller mutation cannot change an issued
 * assurance.
 */
export function registerTransientOedAssuranceMetadata(
  token: TransientOedAssurance,
  metadata: TransientOedAssuranceMetadata,
): void {
  if (
    token.boundary !== metadata.boundary ||
    token.persistence_authority !== metadata.persistence_authority ||
    token.can_authorize_execution !== metadata.can_authorize_execution ||
    assuranceMetadata.has(token)
  ) {
    throw new TypeError("TRANSIENT_OED_ASSURANCE_REGISTRATION_INVALID");
  }

  assuranceMetadata.set(
    token,
    Object.freeze({
      ...metadata,
      binding_identities: Object.freeze({ ...metadata.binding_identities }),
      semantic_checks: Object.freeze({ ...metadata.semantic_checks }),
    }),
  );
}

/**
 * Read-only identity lookup used by the pure Evidence owner.
 *
 * Clone, spread and JSON round trips are different objects and therefore
 * cannot recover registered metadata.
 */
export function lookupTransientOedAssuranceMetadata(
  candidate: unknown,
): TransientOedAssuranceMetadata | null {
  return typeof candidate === "object" && candidate !== null
    ? (assuranceMetadata.get(candidate) ?? null)
    : null;
}
