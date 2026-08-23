import {
  type AnalysisProgramPayload,
  type AnalysisSandboxProgramPayload,
  type ArtifactReference,
  artifactReferenceIdentity,
  type DerivedAnalysisEvidencePayload,
  derivedAnalysisEvidencePayloadSchema,
  type PythonSandboxReceiptV2,
  sha256ContentHash,
} from "@data-agent/contracts";
import { verifyAnalysisSandboxProgram } from "./program-verifier.js";
import { verifyAnalysisResult } from "./result-oracles.js";

export type DerivationFailure =
  | "PROGRAM_VERIFICATION_FAILED"
  | "PROGRAM_REFERENCE_CLOSURE_FAILED"
  | "PLAN_NODE_MISMATCH"
  | "RECEIPT_NOT_SUCCESSFUL"
  | "RECEIPT_REFERENCE_CLOSURE_FAILED"
  | "RECEIPT_HARD_CONTROL_MISMATCH"
  | "RECEIPT_RUNTIME_MISMATCH"
  | "RECEIPT_SCOPE_MISMATCH"
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
    hash_domain: "derived-analysis-evidence@1.0.0",
    value: evidence,
  });
}

export async function verifyAnalysisDerivation(input: {
  plan: AnalysisProgramPayload;
  planRef: ArtifactReference;
  program: AnalysisSandboxProgramPayload;
  programRef: ArtifactReference;
  sourceText: string;
  receipt: PythonSandboxReceiptV2;
  receiptRef: ArtifactReference;
  evidence: DerivedAnalysisEvidencePayload;
  materializedResultRefs: readonly ArtifactReference[];
  materializedQueryRefs: readonly ArtifactReference[];
  materializedInputRefs: readonly ArtifactReference[];
  allowedProfiles: readonly AnalysisSandboxProgramPayload["import_profile"][];
}): Promise<{ ok: true } | { ok: false; failures: readonly DerivationFailure[] }> {
  const evidenceParse = derivedAnalysisEvidencePayloadSchema.safeParse(input.evidence);
  if (!evidenceParse.success) return { ok: false, failures: ["EVIDENCE_SCHEMA_INVALID"] };
  const evidence = evidenceParse.data;
  const failures: DerivationFailure[] = [];
  const programVerdict = await verifyAnalysisSandboxProgram({
    analysisProgram: input.plan,
    analysisProgramRef: input.planRef,
    program: input.program,
    sourceText: input.sourceText,
    allowedProfiles: input.allowedProfiles,
  });
  if (!programVerdict.ok) failures.push("PROGRAM_VERIFICATION_FAILED");
  if (
    artifactReferenceIdentity(evidence.sandbox_program_ref) !==
    artifactReferenceIdentity(input.programRef)
  ) {
    failures.push("PROGRAM_REFERENCE_CLOSURE_FAILED");
  }
  if (
    artifactReferenceIdentity(evidence.sandbox_execution_receipt_ref) !==
    artifactReferenceIdentity(input.receiptRef)
  ) {
    failures.push("RECEIPT_REFERENCE_CLOSURE_FAILED");
  }
  if (
    input.program.node_id !== evidence.node_id ||
    artifactReferenceIdentity(input.program.analysis_program_ref) !==
      artifactReferenceIdentity(evidence.analysis_program_ref)
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
  if (Object.values(input.receipt.hard_controls).some((enforced) => !enforced)) {
    failures.push("RECEIPT_HARD_CONTROL_MISMATCH");
  }
  if (
    input.receipt.dependency_lock_digest !== evidence.dependency_lock_digest ||
    input.program.runtime_digest !== evidence.runtime_digest ||
    input.program.dependency_lock_digest !== evidence.dependency_lock_digest ||
    input.receipt.policy_version !== input.program.policy_version
  ) {
    failures.push("RECEIPT_RUNTIME_MISMATCH");
  }
  if (
    !sameReferenceSet(evidence.sandbox_result_refs, input.materializedResultRefs) ||
    !sameReferenceSet(input.receipt.output_refs, input.materializedResultRefs)
  ) {
    failures.push("RESULT_REFERENCE_CLOSURE_FAILED");
  }
  if (
    !sameReferenceSet(evidence.query_evidence_refs, input.materializedQueryRefs) ||
    !sameReferenceSet(input.program.query_evidence_refs, input.materializedQueryRefs)
  ) {
    failures.push("QUERY_REFERENCE_CLOSURE_FAILED");
  }
  if (!sameReferenceSet(input.program.input_refs, input.materializedInputRefs)) {
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
