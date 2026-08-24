import {
  type AnalysisProgramPayload,
  type AnalysisSandboxExecutionReceipt,
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  type DerivedAnalysisEvidencePayload,
  derivedAnalysisEvidencePayloadSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { verifyAnalysisResult } from "./result-oracles.js";

export type DerivationFailure =
  | "PLAN_NODE_MISMATCH"
  | "RECEIPT_NOT_SUCCESSFUL"
  | "RECEIPT_REFERENCE_CLOSURE_FAILED"
  | "RECEIPT_HARD_CONTROL_MISMATCH"
  | "RECEIPT_RUNTIME_MISMATCH"
  | "RECEIPT_SCOPE_MISMATCH"
  | "OPERATOR_AUTHORITY_CLOSURE_FAILED"
  | "RESULT_REFERENCE_CLOSURE_FAILED"
  | "QUERY_REFERENCE_CLOSURE_FAILED"
  | "INPUT_REFERENCE_CLOSURE_FAILED"
  | "RESULT_ORACLE_FAILED"
  | "DERIVATION_HASH_MISMATCH"
  | "EVIDENCE_SCHEMA_INVALID";

const sameReferenceSet = (
  left: readonly ArtifactReference[],
  right: readonly ArtifactReference[],
): boolean => {
  const leftSet = new Set(left.map(artifactReferenceIdentity));
  const rightSet = new Set(right.map(artifactReferenceIdentity));
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((identity) => rightSet.has(identity))
  );
};

export async function computeAnalysisDerivationHash(
  evidence: Omit<DerivedAnalysisEvidencePayload, "derivation_hash">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: "derived-analysis-evidence@2.0.0",
    value: evidence,
  });
}

export async function verifyAnalysisDerivation(input: {
  plan: AnalysisProgramPayload;
  planRef: ArtifactReference;
  receipt: AnalysisSandboxExecutionReceipt;
  receiptRef: ArtifactReference;
  evidence: DerivedAnalysisEvidencePayload;
  materializedResultRefs: readonly ArtifactReference[];
  materializedQueryRefs: readonly ArtifactReference[];
  materializedInputRefs: readonly ArtifactReference[];
}): Promise<{ ok: true } | { ok: false; failures: readonly DerivationFailure[] }> {
  const evidenceParse = derivedAnalysisEvidencePayloadSchema.safeParse(input.evidence);
  if (!evidenceParse.success) return { ok: false, failures: ["EVIDENCE_SCHEMA_INVALID"] };
  const evidence = evidenceParse.data;
  const failures: DerivationFailure[] = [];
  if (
    artifactReferenceIdentity(evidence.sandbox_execution_receipt_ref) !==
    artifactReferenceIdentity(input.receiptRef)
  ) {
    failures.push("RECEIPT_REFERENCE_CLOSURE_FAILED");
  }
  if (
    input.receipt.node_id !== evidence.node_id ||
    artifactReferenceIdentity(input.receipt.analysis_program_ref) !==
      artifactReferenceIdentity(evidence.analysis_program_ref) ||
    !input.plan.nodes.some(({ node_id }) => node_id === evidence.node_id)
  ) {
    failures.push("PLAN_NODE_MISMATCH");
  }
  if (input.receipt.status !== "SUCCEEDED" || input.receipt.failure_code !== null) {
    failures.push("RECEIPT_NOT_SUCCESSFUL");
  }
  if (
    input.receipt.workspace_id !== input.planRef.tenant_id ||
    input.receipt.run_id !== input.planRef.run_id
  ) {
    failures.push("RECEIPT_SCOPE_MISMATCH");
  }
  if (
    !input.receipt.hard_controls.network_isolated ||
    !input.receipt.hard_controls.scoped_filesystem ||
    !input.receipt.hard_controls.separate_operator_sandbox ||
    !input.receipt.hard_controls.resource_limits_enforced
  ) {
    failures.push("RECEIPT_HARD_CONTROL_MISMATCH");
  }
  if (
    input.receipt.runtime_profile !== evidence.runtime_profile ||
    input.receipt.runtime.agent_image !== evidence.agent_image ||
    input.receipt.runtime.operator_image !== evidence.operator_image
  ) {
    failures.push("RECEIPT_RUNTIME_MISMATCH");
  }
  if (
    input.plan.operator_registry_digest !== input.receipt.operator_registry_digest ||
    input.receipt.operator_registry_digest !== evidence.operator_registry_digest ||
    input.receipt.generated_source_policy !== evidence.generated_source_policy ||
    canonicalizeJson(input.receipt.operator_obligations) !==
      canonicalizeJson(evidence.operator_obligations) ||
    input.receipt.operator_receipt_closure_hash !== evidence.operator_receipt_closure_hash
  ) {
    failures.push("OPERATOR_AUTHORITY_CLOSURE_FAILED");
  }
  if (
    !sameReferenceSet(evidence.sandbox_result_refs, input.materializedResultRefs) ||
    !sameReferenceSet(
      input.receipt.outputs.map(({ reference }) => reference),
      input.materializedResultRefs,
    )
  ) {
    failures.push("RESULT_REFERENCE_CLOSURE_FAILED");
  }
  if (
    !sameReferenceSet(evidence.query_evidence_refs, input.materializedQueryRefs) ||
    !sameReferenceSet(
      input.receipt.inputs.map(({ query_evidence_ref }) => query_evidence_ref),
      input.materializedQueryRefs,
    )
  ) {
    failures.push("QUERY_REFERENCE_CLOSURE_FAILED");
  }
  if (
    !sameReferenceSet(
      input.receipt.inputs.map(({ input_ref }) => input_ref),
      input.materializedInputRefs,
    )
  ) {
    failures.push("INPUT_REFERENCE_CLOSURE_FAILED");
  }
  if (verifyAnalysisResult(evidence.result).verdict !== "PASS") {
    failures.push("RESULT_ORACLE_FAILED");
  }
  const { derivation_hash: observedHash, ...material } = evidence;
  if ((await computeAnalysisDerivationHash(material)) !== observedHash) {
    failures.push("DERIVATION_HASH_MISMATCH");
  }
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
