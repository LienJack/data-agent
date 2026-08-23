import {
  type ArtifactReference,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  canonicalizeJson,
  computeGateEvaluationHash,
  computeGateInputHash,
  computePostgresqlExecutionSettingsHash,
  computeResourceAdmissionReceiptHash,
  computeResourceEstimateHash,
  deepFreeze,
  type ExecutionPermitPayload,
  type ExecutionReceiptPayload,
  executionPermitSchema,
  executionReceiptSchema,
  type GateReceiptPayload,
  gateReceiptSchema,
  resourceAdmissionReceiptSchema,
  TEXT2SQL_EXECUTION_PERMIT_TTL_MS,
  TEXT2SQL_VALIDATION_VERSION,
  type ValidationReceiptPayload,
  validationReceiptSchema,
} from "@data-agent/contracts";
import {
  isTrustedGateArtifactAuthority,
  isTrustedGateEvaluation,
  isTrustedPostExecutionGateSuite,
  isTrustedPreExecutionGateSuite,
  resolveCommittedArtifact,
  type TrustedGateArtifactAuthority,
} from "./internal.js";
import type {
  PostExecutionGateSuite,
  PreExecutionGateSuite,
  Text2SqlGate,
  TrustedGateEvaluation,
} from "./types.js";

type TypedArtifactReference<T extends ArtifactReference["artifact_type"]> = ArtifactReference & {
  readonly artifact_type: T;
};

const MAX_GATE_RECEIPT_AGE_MS = 10 * 60 * 1_000;

function parseReference<T extends ArtifactReference["artifact_type"]>(
  value: unknown,
  artifactType: T,
): TypedArtifactReference<T> {
  const reference = artifactReferenceSchema.parse(value);
  if (reference.artifact_type !== artifactType) {
    throw new TypeError(`TEXT2SQL_${artifactType.toUpperCase()}_REFERENCE_REQUIRED`);
  }
  return reference as TypedArtifactReference<T>;
}

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function includesReference(
  references: readonly ArtifactReference[],
  expected: ArtifactReference,
): boolean {
  return references.some((reference) => sameReference(reference, expected));
}

function sameScope(left: ArtifactReference, right: ArtifactReference): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

function assertUniqueReferences(references: readonly ArtifactReference[]): void {
  const identities = references.map(artifactReferenceIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("TEXT2SQL_GATE_RECEIPT_REFERENCE_DUPLICATED");
  }
}

function requireAuthority(value: unknown): TrustedGateArtifactAuthority {
  if (!isTrustedGateArtifactAuthority(value)) {
    throw new TypeError("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_REQUIRED");
  }
  return value;
}

function authorityNow(authority: TrustedGateArtifactAuthority): Readonly<{
  timestamp: string;
  epoch: number;
}> {
  const epoch = Date.parse(authority.now());
  if (!Number.isFinite(epoch)) {
    throw new TypeError("TEXT2SQL_GATE_AUTHORITY_CLOCK_INVALID");
  }
  return {
    timestamp: new Date(epoch).toISOString(),
    epoch,
  };
}

function gateReceiptInputMaterial(receipt: GateReceiptPayload): Record<string, unknown> {
  return {
    artifact_type: receipt.artifact_type,
    sql_artifact_ref: receipt.sql_artifact_ref,
    execution_receipt_ref: receipt.execution_receipt_ref,
    gate: receipt.gate,
    gate_version: receipt.gate_version,
    evaluator_version: receipt.evaluator_version,
    evidence_refs: receipt.evidence_refs,
  };
}

function gateReceiptEvaluationMaterial(receipt: GateReceiptPayload): unknown {
  return {
    ...gateReceiptInputMaterial(receipt),
    input_hash: receipt.input_hash,
    evaluator_input_hash: receipt.evaluator_input_hash,
    evaluator_evaluation_hash: receipt.evaluator_evaluation_hash,
    verdict: receipt.verdict,
    reason_code: receipt.reason_code,
    observations: receipt.observations,
    evaluated_at: receipt.evaluated_at,
  };
}

async function assertCanonicalGateReceipt(receipt: GateReceiptPayload): Promise<void> {
  if ((await computeGateInputHash(gateReceiptInputMaterial(receipt))) !== receipt.input_hash) {
    throw new TypeError("TEXT2SQL_GATE_RECEIPT_INPUT_HASH_INVALID");
  }
  if (
    (await computeGateEvaluationHash(gateReceiptEvaluationMaterial(receipt))) !==
    receipt.evaluation_hash
  ) {
    throw new TypeError("TEXT2SQL_GATE_RECEIPT_EVALUATION_HASH_INVALID");
  }
}

async function resolveGateReceipts(
  authority: TrustedGateArtifactAuthority,
  references: readonly TypedArtifactReference<"GateReceipt">[],
): Promise<readonly GateReceiptPayload[]> {
  return Promise.all(
    references.map(async (reference) => {
      const payload = await resolveCommittedArtifact(authority, reference);
      if (!payload) {
        throw new TypeError("TEXT2SQL_GATE_RECEIPT_AUTHORITY_UNRESOLVED");
      }
      const receipt = gateReceiptSchema.parse(payload);
      await assertCanonicalGateReceipt(receipt);
      return receipt;
    }),
  );
}

function assertTrustedPass(
  evaluation: TrustedGateEvaluation,
  receipt: GateReceiptPayload,
  expectedGate: Text2SqlGate,
  sqlArtifactReference: ArtifactReference,
  executionReceiptReference: ArtifactReference | null,
  authorityNowEpoch: number,
): void {
  if (!isTrustedGateEvaluation(evaluation)) {
    throw new TypeError("TEXT2SQL_GATE_EVALUATION_AUTHORITY_REQUIRED");
  }
  if (evaluation.gate !== expectedGate || receipt.gate !== expectedGate) {
    throw new TypeError("TEXT2SQL_GATE_EVALUATION_ORDER_INVALID");
  }
  if (
    !sameReference(evaluation.sql_artifact_ref, sqlArtifactReference) ||
    !sameReference(receipt.sql_artifact_ref, sqlArtifactReference)
  ) {
    throw new TypeError("TEXT2SQL_GATE_EVALUATION_SQL_ARTIFACT_MISMATCH");
  }
  if (
    (evaluation.execution_receipt_ref === null) !== (executionReceiptReference === null) ||
    (receipt.execution_receipt_ref === null) !== (executionReceiptReference === null) ||
    (executionReceiptReference !== null &&
      (evaluation.execution_receipt_ref === null ||
        receipt.execution_receipt_ref === null ||
        !sameReference(evaluation.execution_receipt_ref, executionReceiptReference) ||
        !sameReference(receipt.execution_receipt_ref, executionReceiptReference)))
  ) {
    throw new TypeError("TEXT2SQL_GATE_EVALUATION_EXECUTION_RECEIPT_MISMATCH");
  }
  if (evaluation.verdict !== "PASS" || receipt.verdict !== "PASS") {
    throw new TypeError("TEXT2SQL_GATE_EVALUATION_PASS_REQUIRED");
  }
  if (
    receipt.gate_version !== evaluation.gate_version ||
    receipt.evaluator_version !== evaluation.gate_version ||
    receipt.reason_code !== evaluation.reason_code ||
    receipt.evaluated_at !== evaluation.evaluated_at ||
    canonicalizeJson(receipt.evidence_refs) !== canonicalizeJson(evaluation.evidence_refs) ||
    receipt.evaluator_input_hash !== evaluation.input_hash ||
    receipt.evaluator_evaluation_hash !== evaluation.evaluation_hash ||
    canonicalizeJson(receipt.observations) !== canonicalizeJson(evaluation.observations)
  ) {
    throw new TypeError("TEXT2SQL_GATE_RECEIPT_EVALUATION_MISMATCH");
  }
  const evaluatedAt = Date.parse(receipt.evaluated_at);
  if (
    !Number.isFinite(evaluatedAt) ||
    evaluatedAt > authorityNowEpoch ||
    authorityNowEpoch - evaluatedAt > MAX_GATE_RECEIPT_AGE_MS
  ) {
    throw new TypeError("TEXT2SQL_GATE_RECEIPT_STALE");
  }
}

async function resolveExecutionReceipt(
  authority: TrustedGateArtifactAuthority,
  reference: TypedArtifactReference<"ExecutionReceipt">,
): Promise<ExecutionReceiptPayload> {
  const payload = await resolveCommittedArtifact(authority, reference);
  if (!payload) {
    throw new TypeError("TEXT2SQL_EXECUTION_RECEIPT_AUTHORITY_UNRESOLVED");
  }
  return executionReceiptSchema.parse(payload);
}

async function resolveExecutionPermit(
  authority: TrustedGateArtifactAuthority,
  reference: TypedArtifactReference<"ExecutionPermit">,
): Promise<ExecutionPermitPayload> {
  const payload = await resolveCommittedArtifact(authority, reference);
  if (!payload) {
    throw new TypeError("TEXT2SQL_EXECUTION_PERMIT_AUTHORITY_UNRESOLVED");
  }
  return executionPermitSchema.parse(payload);
}

async function resolveResourceAdmission(
  authority: TrustedGateArtifactAuthority,
  gateReceipt: GateReceiptPayload,
) {
  const references = gateReceipt.evidence_refs.filter(
    (reference) => reference.artifact_type === "ResourceAdmissionReceipt",
  );
  const reference = references[0];
  if (references.length !== 1 || !reference) {
    throw new TypeError("TEXT2SQL_RESOURCE_ADMISSION_REFERENCE_REQUIRED");
  }
  const payload = await resolveCommittedArtifact(authority, reference);
  if (!payload) {
    throw new TypeError("TEXT2SQL_RESOURCE_ADMISSION_AUTHORITY_UNRESOLVED");
  }
  const admission = resourceAdmissionReceiptSchema.parse(payload);
  if (
    !sameReference(admission.receipt_ref, reference) ||
    (await computeResourceAdmissionReceiptHash(admission)) !== admission.receipt_hash ||
    (await computeResourceEstimateHash(admission)) !== admission.estimate_hash ||
    (await computePostgresqlExecutionSettingsHash(admission.execution_settings)) !==
      admission.settings_hash
  ) {
    throw new TypeError("TEXT2SQL_RESOURCE_ADMISSION_AUTHORITY_INVALID");
  }
  return admission;
}

export interface SealExecutionPermitInput {
  readonly authority: unknown;
  readonly sql_artifact_ref: unknown;
  readonly pre_execution_suite: PreExecutionGateSuite;
  readonly gate_receipt_refs: readonly [unknown, unknown, unknown, unknown, unknown];
}

export async function sealExecutionPermit(
  input: SealExecutionPermitInput,
): Promise<ExecutionPermitPayload> {
  const authority = requireAuthority(input.authority);
  const sqlArtifactReference = parseReference(input.sql_artifact_ref, "SqlArtifact");
  const gateReferences = input.gate_receipt_refs.map((reference) =>
    parseReference(reference, "GateReceipt"),
  );
  assertUniqueReferences(gateReferences);
  if (gateReferences.some((reference) => !sameScope(reference, sqlArtifactReference))) {
    throw new TypeError("TEXT2SQL_GATE_RECEIPT_SCOPE_MISMATCH");
  }
  if (
    !isTrustedPreExecutionGateSuite(input.pre_execution_suite) ||
    input.pre_execution_suite.state !== "EVALUATED" ||
    !input.pre_execution_suite.permit_eligible
  ) {
    throw new TypeError("TEXT2SQL_PRE_EXECUTION_GATES_NOT_ELIGIBLE");
  }
  const receipts = await resolveGateReceipts(authority, gateReferences);
  const expectedGates = ["INTENT", "SEMANTIC", "STRUCTURAL", "POLICY", "RESOURCE"] as const;
  const resource = input.pre_execution_suite.gates[4].observations;
  const resourceReceipt = receipts[4];
  if (resourceReceipt?.gate !== "RESOURCE") {
    throw new TypeError("TEXT2SQL_RESOURCE_GATE_RECEIPT_REQUIRED");
  }
  const admission = await resolveResourceAdmission(authority, resourceReceipt);
  // Gate 与 ResourceAdmission 的 Resolver/commit check 都可能发生 I/O。必须在所有
  // await 完成后才采样最终 Authority Clock，避免慢 Admission 让返回时已经过期的
  // Gate 仍被封装为一个表面新鲜的 Permit。
  const now = authorityNow(authority);
  for (const [index, expectedGate] of expectedGates.entries()) {
    const evaluation = input.pre_execution_suite.gates[index];
    const receipt = receipts[index];
    if (!evaluation || !receipt) throw new TypeError("TEXT2SQL_PRE_EXECUTION_GATE_MISSING");
    assertTrustedPass(evaluation, receipt, expectedGate, sqlArtifactReference, null, now.epoch);
    if (!includesReference(receipt.evidence_refs, sqlArtifactReference)) {
      throw new TypeError("TEXT2SQL_GATE_RECEIPT_EVIDENCE_MISMATCH");
    }
  }
  if (
    !sameReference(admission.sql_artifact_ref, sqlArtifactReference) ||
    resource.estimate_hash !== admission.estimate_hash ||
    resource.policy_version !== admission.policy_version ||
    resource.total_cost !== admission.total_cost ||
    resource.plan_rows !== admission.plan_rows ||
    resource.plan_width !== admission.plan_width ||
    resource.planned_bytes !== admission.plan_rows * admission.plan_width ||
    resource.timeout_ms !== admission.timeout_ms ||
    resource.lock_timeout_ms !== admission.lock_timeout_ms ||
    resource.max_rows !== admission.max_rows ||
    resource.max_bytes !== admission.max_bytes ||
    resource.max_memory_mb !== admission.max_memory_mb
  ) {
    throw new TypeError("TEXT2SQL_RESOURCE_ADMISSION_EVALUATION_MISMATCH");
  }
  return deepFreeze(
    executionPermitSchema.parse({
      artifact_type: "ExecutionPermit",
      sql_artifact_ref: sqlArtifactReference,
      resource_admission_ref: admission.receipt_ref,
      gate_receipt_refs: gateReferences,
      principal_id: admission.principal_id,
      policy_receipt_ref: admission.policy_receipt_ref,
      datasource_id: admission.datasource_id,
      schema_version: admission.schema_version,
      settings_hash: admission.settings_hash,
      execution_settings: admission.execution_settings,
      budget: {
        timeout_ms: resource.timeout_ms,
        lock_timeout_ms: resource.lock_timeout_ms,
        max_rows: resource.max_rows,
        max_bytes: resource.max_bytes,
        max_memory_mb: resource.max_memory_mb,
      },
      issued_at: now.timestamp,
      expires_at: new Date(now.epoch + TEXT2SQL_EXECUTION_PERMIT_TTL_MS).toISOString(),
    }),
  );
}

export interface SealValidationReceiptInput {
  readonly authority: unknown;
  readonly sql_artifact_ref: unknown;
  readonly execution_receipt_ref: unknown;
  readonly pre_execution_suite: PreExecutionGateSuite;
  readonly post_execution_suite: PostExecutionGateSuite;
  readonly gate_receipt_refs: readonly [
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
  ];
}

export async function sealValidationReceipt(
  input: SealValidationReceiptInput,
): Promise<ValidationReceiptPayload> {
  const authority = requireAuthority(input.authority);
  const sqlArtifactReference = parseReference(input.sql_artifact_ref, "SqlArtifact");
  const executionReference = parseReference(input.execution_receipt_ref, "ExecutionReceipt");
  const gateReferences = input.gate_receipt_refs.map((reference) =>
    parseReference(reference, "GateReceipt"),
  );
  assertUniqueReferences(gateReferences);
  if (
    !sameScope(executionReference, sqlArtifactReference) ||
    gateReferences.some((reference) => !sameScope(reference, sqlArtifactReference))
  ) {
    throw new TypeError("TEXT2SQL_VALIDATION_RECEIPT_SCOPE_MISMATCH");
  }
  if (
    !isTrustedPreExecutionGateSuite(input.pre_execution_suite) ||
    !isTrustedPostExecutionGateSuite(input.post_execution_suite) ||
    input.pre_execution_suite.state !== "EVALUATED" ||
    input.post_execution_suite.state !== "EVALUATED" ||
    !input.pre_execution_suite.permit_eligible ||
    !input.post_execution_suite.validation_eligible
  ) {
    throw new TypeError("TEXT2SQL_VALIDATION_GATES_NOT_ELIGIBLE");
  }

  const execution = await resolveExecutionReceipt(authority, executionReference);
  const permitReference = parseReference(execution.execution_permit_ref, "ExecutionPermit");
  const permit = await resolveExecutionPermit(authority, permitReference);
  const receipts = await resolveGateReceipts(authority, gateReferences);
  // All authoritative I/O is complete before the final clock sample. sealed_at and
  // freshness/order checks therefore share one non-backdated server time.
  const now = authorityNow(authority);
  if (
    !sameReference(execution.sql_artifact_ref, sqlArtifactReference) ||
    !sameReference(permit.sql_artifact_ref, sqlArtifactReference) ||
    permit.gate_receipt_refs.some((reference, index) => {
      const gateReference = gateReferences[index];
      return !gateReference || !sameReference(reference, gateReference);
    }) ||
    Date.parse(execution.observed_at) > now.epoch
  ) {
    throw new TypeError("TEXT2SQL_VALIDATION_RECEIPT_EXECUTION_BINDING_MISMATCH");
  }

  const allEvaluations = [
    ...input.pre_execution_suite.gates,
    ...input.post_execution_suite.gates,
  ] as const;
  const expectedGates = [
    "INTENT",
    "SEMANTIC",
    "STRUCTURAL",
    "POLICY",
    "RESOURCE",
    "EXECUTION",
    "RESULT",
  ] as const;
  for (const [index, expectedGate] of expectedGates.entries()) {
    const evaluation = allEvaluations[index];
    const receipt = receipts[index];
    if (!evaluation || !receipt) throw new TypeError("TEXT2SQL_VALIDATION_GATE_MISSING");
    assertTrustedPass(
      evaluation,
      receipt,
      expectedGate,
      sqlArtifactReference,
      index < input.pre_execution_suite.gates.length ? null : executionReference,
      now.epoch,
    );
    if (
      (index < input.pre_execution_suite.gates.length &&
        (!includesReference(receipt.evidence_refs, sqlArtifactReference) ||
          Date.parse(receipt.evaluated_at) > Date.parse(permit.issued_at))) ||
      (index >= input.pre_execution_suite.gates.length &&
        Date.parse(receipt.evaluated_at) < Date.parse(execution.observed_at)) ||
      (expectedGate === "EXECUTION" &&
        (!includesReference(receipt.evidence_refs, execution.sandbox_execution_receipt_ref) ||
          !includesReference(receipt.evidence_refs, execution.result_artifact_ref))) ||
      (expectedGate === "RESULT" &&
        !includesReference(receipt.evidence_refs, execution.result_artifact_ref))
    ) {
      throw new TypeError("TEXT2SQL_GATE_RECEIPT_EVIDENCE_MISMATCH");
    }
  }
  const executionGateEvaluatedAt = Date.parse(receipts[5]?.evaluated_at ?? "");
  const resultGateEvaluatedAt = Date.parse(receipts[6]?.evaluated_at ?? "");
  if (
    !Number.isFinite(executionGateEvaluatedAt) ||
    !Number.isFinite(resultGateEvaluatedAt) ||
    executionGateEvaluatedAt > resultGateEvaluatedAt
  ) {
    throw new TypeError("TEXT2SQL_POST_EXECUTION_GATE_TIME_ORDER_INVALID");
  }

  return deepFreeze(
    validationReceiptSchema.parse({
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: executionReference,
      gate_receipt_refs: gateReferences,
      validation_version: TEXT2SQL_VALIDATION_VERSION,
      sealed_at: now.timestamp,
    }),
  );
}
