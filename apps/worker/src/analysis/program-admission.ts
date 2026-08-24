import { createHash } from "node:crypto";
import {
  type AnalysisProgramPayload,
  type AnalysisSandboxProgramPayload,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  analysisProgramRefSchema,
  analysisSandboxProgramPayloadSchema,
  artifactReferenceFor,
  artifactReferenceIdentity,
  canonicalizeJson,
  queryEvidenceRefSchema,
} from "@data-agent/contracts";
import {
  computeAnalysisSandboxProgramHash,
  verifyAnalysisSandboxProgram,
} from "@data-agent/research";
import {
  ANALYSIS_RUNTIME_ATTESTATIONS,
  type AnalysisSkillCatalog,
  DEFAULT_ANALYSIS_SKILL_CATALOG,
} from "./skill-catalog.js";

export const ANALYSIS_PROGRAM_POLICY_VERSION = "python-policy@1.0.0" as const;
const MAX_SOURCE_BYTES = 100_000;

export type ProgramAdmissionFailure =
  | "PROGRAM_PLAN_INVALID"
  | "PROGRAM_NODE_NOT_FOUND"
  | "PROGRAM_MODE_INVALID"
  | "PROGRAM_SOURCE_SCOPE_MISMATCH"
  | "PROGRAM_SOURCE_HASH_MISMATCH"
  | "PROGRAM_INPUT_SCOPE_MISMATCH"
  | "PROGRAM_INPUT_NOT_QUERY_EVIDENCE"
  | "PROGRAM_SOURCE_TOO_LARGE"
  | "PROGRAM_ENTRYPOINT_POLICY_REJECTED"
  | "PROGRAM_HOST_POLICY_REJECTED"
  | "PROGRAM_OUTPUT_CONTRACT_MISMATCH"
  | "PROGRAM_OPERATOR_REGISTRY_ATTESTATION_MISMATCH"
  | "PROGRAM_VERIFICATION_FAILED"
  | "PROGRAM_REPAIR_LIMIT_EXCEEDED"
  | "PROGRAM_REPAIR_EXPANDED_AUTHORITY";

export type ProgramAdmissionVerdict =
  | { readonly ok: true; readonly program: AnalysisSandboxProgramPayload }
  | { readonly ok: false; readonly failure: ProgramAdmissionFailure };

function sha256Text(source: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function imports(source: string): ReadonlySet<string> {
  const values = new Set<string>();
  for (const match of source.matchAll(/(?:^|\n)\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gu)) {
    const root = match[1]?.split(".")[0];
    if (root) values.add(root);
  }
  return values;
}

function hostPolicyAllows(source: string): boolean {
  const deniedSensitiveContent = [
    /(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'][^"']{4,}["']/iu,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/u,
    /(?:https?|file):\/\//iu,
  ];
  return !deniedSensitiveContent.some((pattern) => pattern.test(source));
}

function entrypointPolicyAllows(source: string): boolean {
  const declarations = source.match(
    /(?:^|\n)\s*(?:async\s+)?def\s+main\s*\([^\n]*\)\s*(?:->[^:\n]+)?\s*:/gu,
  );
  return declarations?.length === 1 && /(?:^|\n)def main\(context\):/u.test(source);
}

function derivedSeed(analysisProgramRef: ArtifactReference, nodeId: string): number {
  return createHash("sha256")
    .update(`${artifactReferenceIdentity(analysisProgramRef)}\0${nodeId}`)
    .digest()
    .readUInt32BE(0);
}

export async function admitAnalysisSandboxProgram(input: {
  readonly analysis_program: AnalysisProgramPayload;
  readonly analysis_program_ref: ArtifactReference;
  readonly node_id: string;
  readonly source_text: string;
  readonly source_text_ref: ArtifactReference;
  readonly query_evidence_refs: readonly ArtifactReference[];
  readonly input_refs: readonly ArtifactReference[];
  readonly input_materialization_receipt_refs: readonly ArtifactReference[];
  readonly catalog?: AnalysisSkillCatalog;
}): Promise<ProgramAdmissionVerdict> {
  const parsedProgram = analysisProgramPayloadSchema.safeParse(input.analysis_program);
  const parsedProgramRef = analysisProgramRefSchema.safeParse(input.analysis_program_ref);
  if (!parsedProgram.success || !parsedProgramRef.success) {
    return { ok: false, failure: "PROGRAM_PLAN_INVALID" };
  }
  const analysisProgram = parsedProgram.data;
  const analysisProgramRef = parsedProgramRef.data;
  const node = analysisProgram.nodes.find(({ node_id: nodeId }) => nodeId === input.node_id);
  if (!node) return { ok: false, failure: "PROGRAM_NODE_NOT_FOUND" };
  const catalog = input.catalog ?? DEFAULT_ANALYSIS_SKILL_CATALOG;
  const descriptor = catalog.resolve(node.skill_id);
  if (
    (node.execution_mode === "FROZEN_TEMPLATE" && descriptor.standard_program === null) ||
    (node.execution_mode === "MODEL_GENERATED" && descriptor.program_mode === "FROZEN_TEMPLATE")
  ) {
    return { ok: false, failure: "PROGRAM_MODE_INVALID" };
  }
  const sourceHash = sha256Text(input.source_text);
  if (
    input.source_text_ref.artifact_type !== "SensitiveExecutionArtifact" ||
    input.source_text_ref.app_id !== analysisProgramRef.app_id ||
    input.source_text_ref.tenant_id !== analysisProgramRef.tenant_id ||
    input.source_text_ref.environment !== analysisProgramRef.environment ||
    input.source_text_ref.run_id !== analysisProgramRef.run_id
  ) {
    return { ok: false, failure: "PROGRAM_SOURCE_SCOPE_MISMATCH" };
  }
  if (input.source_text_ref.content_hash !== sourceHash) {
    return { ok: false, failure: "PROGRAM_SOURCE_HASH_MISMATCH" };
  }
  const sourceTextRef = artifactReferenceFor("SensitiveExecutionArtifact").parse(
    input.source_text_ref,
  );
  const queryEvidenceRefs = input.query_evidence_refs.map((reference) =>
    queryEvidenceRefSchema.parse(reference),
  );
  if (
    [
      ...input.query_evidence_refs,
      ...input.input_refs,
      ...input.input_materialization_receipt_refs,
    ].some(
      (reference) =>
        reference.app_id !== analysisProgramRef.app_id ||
        reference.tenant_id !== analysisProgramRef.tenant_id ||
        reference.environment !== analysisProgramRef.environment ||
        reference.run_id !== analysisProgramRef.run_id,
    )
  ) {
    return { ok: false, failure: "PROGRAM_INPUT_SCOPE_MISMATCH" };
  }
  if (
    input.query_evidence_refs.length !== input.input_refs.length ||
    input.input_materialization_receipt_refs.length !== input.input_refs.length ||
    input.query_evidence_refs.some(
      ({ artifact_type: artifactType }) => artifactType !== "QueryEvidence",
    ) ||
    input.input_materialization_receipt_refs.some(
      ({ artifact_type: artifactType }) => artifactType !== "AnalysisInputMaterializationReceipt",
    )
  ) {
    return { ok: false, failure: "PROGRAM_INPUT_NOT_QUERY_EVIDENCE" };
  }
  if (Buffer.byteLength(input.source_text, "utf8") > MAX_SOURCE_BYTES) {
    return { ok: false, failure: "PROGRAM_SOURCE_TOO_LARGE" };
  }
  if (!entrypointPolicyAllows(input.source_text)) {
    return { ok: false, failure: "PROGRAM_ENTRYPOINT_POLICY_REJECTED" };
  }
  if (!hostPolicyAllows(input.source_text)) {
    return { ok: false, failure: "PROGRAM_HOST_POLICY_REJECTED" };
  }
  if (
    node.output_contract === null ||
    canonicalizeJson(node.output_contract) !== canonicalizeJson(descriptor.output_contract)
  ) {
    return { ok: false, failure: "PROGRAM_OUTPUT_CONTRACT_MISMATCH" };
  }
  const attestation = ANALYSIS_RUNTIME_ATTESTATIONS[descriptor.python_import_profile];
  if (analysisProgram.operator_registry_digest !== attestation.operator_registry_digest) {
    return { ok: false, failure: "PROGRAM_OPERATOR_REGISTRY_ATTESTATION_MISMATCH" };
  }
  const material: Omit<AnalysisSandboxProgramPayload, "program_hash"> = {
    artifact_type: "SandboxProgram",
    protocol_version: "analysis-sandbox-program@2.0.0",
    analysis_program_ref: analysisProgramRef,
    node_id: input.node_id,
    language: "PYTHON_3_12",
    entrypoint: "main",
    source_sha256: sourceHash,
    source_text_ref: sourceTextRef,
    query_evidence_refs: queryEvidenceRefs,
    input_refs: [...input.input_refs],
    input_materialization_receipt_refs: input.input_materialization_receipt_refs.map((reference) =>
      artifactReferenceFor("AnalysisInputMaterializationReceipt").parse(reference),
    ),
    output_contract: node.output_contract,
    generated_source_policy: node.generated_source_policy,
    operator_registry_digest: attestation.operator_registry_digest,
    operator_obligations: node.operator_obligations,
    import_profile: descriptor.python_import_profile,
    random_seed: derivedSeed(analysisProgramRef, input.node_id),
    runtime_digest: attestation.runtime_digest,
    dependency_lock_digest: attestation.dependency_lock_digest,
    policy_version: ANALYSIS_PROGRAM_POLICY_VERSION,
  };
  const program = analysisSandboxProgramPayloadSchema.parse({
    ...material,
    program_hash: await computeAnalysisSandboxProgramHash(material),
  });
  const verification = await verifyAnalysisSandboxProgram({
    analysisProgram,
    analysisProgramRef,
    program,
    sourceText: input.source_text,
    allowedProfiles: [descriptor.python_import_profile],
  });
  return verification.ok
    ? { ok: true, program }
    : { ok: false, failure: "PROGRAM_VERIFICATION_FAILED" };
}

export async function admitAnalysisSandboxProgramSourceRepair(input: {
  readonly attempt: number;
  readonly previous_source_text: string;
  readonly repaired_source_text: string;
  readonly repaired_source_text_ref: ArtifactReference;
  readonly analysis_program: AnalysisProgramPayload;
  readonly analysis_program_ref: ArtifactReference;
  readonly node_id: string;
  readonly query_evidence_refs: readonly ArtifactReference[];
  readonly input_refs: readonly ArtifactReference[];
  readonly input_materialization_receipt_refs: readonly ArtifactReference[];
  readonly catalog?: AnalysisSkillCatalog;
}): Promise<ProgramAdmissionVerdict> {
  if (input.attempt !== 1) return { ok: false, failure: "PROGRAM_REPAIR_LIMIT_EXCEEDED" };
  const previousImports = imports(input.previous_source_text);
  if ([...imports(input.repaired_source_text)].some((name) => !previousImports.has(name))) {
    return { ok: false, failure: "PROGRAM_REPAIR_EXPANDED_AUTHORITY" };
  }
  return admitAnalysisSandboxProgram({
    analysis_program: input.analysis_program,
    analysis_program_ref: input.analysis_program_ref,
    node_id: input.node_id,
    source_text: input.repaired_source_text,
    source_text_ref: input.repaired_source_text_ref,
    query_evidence_refs: input.query_evidence_refs,
    input_refs: input.input_refs,
    input_materialization_receipt_refs: input.input_materialization_receipt_refs,
    ...(input.catalog ? { catalog: input.catalog } : {}),
  });
}

export async function admitAnalysisSandboxProgramRepair(input: {
  readonly attempt: number;
  readonly previous_program: AnalysisSandboxProgramPayload;
  readonly previous_source_text: string;
  readonly repaired_source_text: string;
  readonly repaired_source_text_ref: ArtifactReference;
  readonly analysis_program: AnalysisProgramPayload;
  readonly analysis_program_ref: ArtifactReference;
  readonly catalog?: AnalysisSkillCatalog;
}): Promise<ProgramAdmissionVerdict> {
  const repaired = await admitAnalysisSandboxProgramSourceRepair({
    attempt: input.attempt,
    previous_source_text: input.previous_source_text,
    repaired_source_text: input.repaired_source_text,
    repaired_source_text_ref: input.repaired_source_text_ref,
    analysis_program: input.analysis_program,
    analysis_program_ref: input.analysis_program_ref,
    node_id: input.previous_program.node_id,
    query_evidence_refs: input.previous_program.query_evidence_refs,
    input_refs: input.previous_program.input_refs,
    input_materialization_receipt_refs: input.previous_program.input_materialization_receipt_refs,
    ...(input.catalog ? { catalog: input.catalog } : {}),
  });
  if (!repaired.ok) return repaired;
  if (
    repaired.program.import_profile !== input.previous_program.import_profile ||
    repaired.program.runtime_digest !== input.previous_program.runtime_digest ||
    repaired.program.dependency_lock_digest !== input.previous_program.dependency_lock_digest ||
    repaired.program.policy_version !== input.previous_program.policy_version ||
    repaired.program.random_seed !== input.previous_program.random_seed ||
    canonicalizeJson(repaired.program.query_evidence_refs) !==
      canonicalizeJson(input.previous_program.query_evidence_refs) ||
    canonicalizeJson(repaired.program.input_refs) !==
      canonicalizeJson(input.previous_program.input_refs) ||
    canonicalizeJson(repaired.program.input_materialization_receipt_refs) !==
      canonicalizeJson(input.previous_program.input_materialization_receipt_refs) ||
    canonicalizeJson(repaired.program.output_contract) !==
      canonicalizeJson(input.previous_program.output_contract)
  ) {
    return { ok: false, failure: "PROGRAM_REPAIR_EXPANDED_AUTHORITY" };
  }
  return repaired;
}

export const analysisProgramAdmissionInternals = Object.freeze({
  hostPolicyAllows,
});
