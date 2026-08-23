import {
  type ArtifactReference,
  type AuthoritativeResultOracleReceipt,
  artifactReferenceSchema,
  authorityIdentitySchema,
  computeResourceAdmissionReceiptHash,
  computeResourceEstimateHash,
  deepFreeze,
  resourceAdmissionReceiptSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  authorizeResultOracleReceipt,
  createResultOracleReceiptAuthority,
} from "@data-agent/contracts/server";
import {
  isTrustedMetamorphicOracleVerification,
  type TrustedMetamorphicOracleVerification,
  type TrustedMetamorphicOracleVerifier,
  trustedMetamorphicOracleAuthorityToken,
} from "./metamorphic.js";
import {
  type GateObservationMap,
  type GateVerdict,
  type PostExecutionGateSuite,
  type PreExecutionGateSuite,
  postgresqlExplainEstimateSchema,
  type ResultOracleAuthority,
  resourcePolicySchema,
  TEXT2SQL_GATE_EVALUATOR_VERSION,
  type Text2SqlGate,
  type TrustedGateEvaluation,
  type TrustedResourceAdmission,
} from "./types.js";

const trustedGateEvaluations = new WeakSet<object>();
const trustedPreExecutionGateSuites = new WeakSet<object>();
const trustedPostExecutionGateSuites = new WeakSet<object>();
const trustedResourceAdmissions = new WeakSet<object>();
const trustedGateArtifactAuthorities = new WeakSet<object>();
const trustedResultOracleAuthorities = new WeakSet<object>();
const trustedResultOracleAuthoritySources = new WeakMap<object, object>();
const trustedResultOracleAuthorityRegistrations = new WeakMap<
  object,
  ResultOracleAuthorityRegistration
>();

declare const gateArtifactAuthorityBrand: unique symbol;
declare const resultOracleAuthorityBrand: unique symbol;

export type TrustedGateArtifactAuthority = Readonly<{
  resolveArtifact(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  now(): string;
  readonly [gateArtifactAuthorityBrand]: true;
}>;

export type TrustedResultOracleAuthority = ResultOracleAuthority & {
  readonly [resultOracleAuthorityBrand]: true;
};

export interface ResultOracleAuthorityRegistration extends ResultOracleAuthority {
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyExactArtifactRevision(reference: ArtifactReference, artifact: unknown): Promise<boolean>;
}

export async function createTrustedGateEvaluation<G extends Text2SqlGate>(
  authority: TrustedGateArtifactAuthority,
  input: Readonly<{
    gate: G;
    sql_artifact_ref: ArtifactReference;
    execution_receipt_ref: ArtifactReference | null;
    evidence_refs: readonly ArtifactReference[];
    verdict: GateVerdict;
    reason_code: string;
    input_material: unknown;
    observations: GateObservationMap[G];
  }>,
): Promise<TrustedGateEvaluation<G>> {
  if (!isTrustedGateArtifactAuthority(authority)) {
    throw new TypeError("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_REQUIRED");
  }
  const evaluatedAtEpoch = Date.parse(authority.now());
  if (!Number.isFinite(evaluatedAtEpoch)) {
    throw new TypeError("TEXT2SQL_GATE_AUTHORITY_CLOCK_INVALID");
  }
  const evaluatedAt = new Date(evaluatedAtEpoch).toISOString();
  const evidenceReferences = input.evidence_refs.map((reference) =>
    artifactReferenceSchema.parse(reference),
  );
  const evidenceIdentities = evidenceReferences.map((reference) => JSON.stringify(reference));
  if (
    evidenceReferences.length === 0 ||
    new Set(evidenceIdentities).size !== evidenceReferences.length ||
    evidenceReferences.some(
      (reference) =>
        reference.app_id !== input.sql_artifact_ref.app_id ||
        reference.tenant_id !== input.sql_artifact_ref.tenant_id ||
        reference.environment !== input.sql_artifact_ref.environment ||
        reference.run_id !== input.sql_artifact_ref.run_id,
    )
  ) {
    throw new TypeError("TEXT2SQL_GATE_EVIDENCE_REFERENCE_INVALID");
  }
  const inputHash = await sha256ContentHash({
    sql_artifact_ref: input.sql_artifact_ref,
    execution_receipt_ref: input.execution_receipt_ref,
    evidence_refs: evidenceReferences,
    input_material: input.input_material,
  });
  const evaluationHash = await sha256ContentHash({
    gate: input.gate,
    gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    sql_artifact_ref: input.sql_artifact_ref,
    execution_receipt_ref: input.execution_receipt_ref,
    evidence_refs: evidenceReferences,
    verdict: input.verdict,
    reason_code: input.reason_code,
    evaluated_at: evaluatedAt,
    input_hash: inputHash,
    observations: input.observations,
  });
  const evaluation = deepFreeze({
    gate: input.gate,
    gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    sql_artifact_ref: input.sql_artifact_ref,
    execution_receipt_ref: input.execution_receipt_ref,
    evidence_refs: evidenceReferences,
    verdict: input.verdict,
    reason_code: input.reason_code,
    evaluated_at: evaluatedAt,
    input_hash: inputHash,
    evaluation_hash: evaluationHash,
    observations: input.observations,
  }) as unknown as TrustedGateEvaluation<G>;
  trustedGateEvaluations.add(evaluation);
  return evaluation;
}

export function isTrustedGateEvaluation(
  value: unknown,
): value is TrustedGateEvaluation<Text2SqlGate> {
  return typeof value === "object" && value !== null && trustedGateEvaluations.has(value);
}

export function registerTrustedPreExecutionGateSuite(
  value: PreExecutionGateSuite,
): PreExecutionGateSuite {
  trustedPreExecutionGateSuites.add(value);
  return value;
}

export function isTrustedPreExecutionGateSuite(value: unknown): value is PreExecutionGateSuite {
  return typeof value === "object" && value !== null && trustedPreExecutionGateSuites.has(value);
}

export function registerTrustedPostExecutionGateSuite(
  value: PostExecutionGateSuite,
): PostExecutionGateSuite {
  trustedPostExecutionGateSuites.add(value);
  return value;
}

export function isTrustedPostExecutionGateSuite(value: unknown): value is PostExecutionGateSuite {
  return typeof value === "object" && value !== null && trustedPostExecutionGateSuites.has(value);
}

/**
 * @internal 仅供 PostgreSQL EXPLAIN adapter / 测试夹具把已核验的数据库估算
 * 注册为不可伪造 admission；禁止从 package root 导出。
 */
export async function registerTrustedResourceAdmission(
  authority: TrustedGateArtifactAuthority,
  referenceInput: unknown,
): Promise<TrustedResourceAdmission> {
  if (!isTrustedGateArtifactAuthority(authority)) {
    throw new TypeError("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_REQUIRED");
  }
  const reference = artifactReferenceSchema.parse(referenceInput);
  if (reference.artifact_type !== "ResourceAdmissionReceipt") {
    throw new TypeError("TEXT2SQL_RESOURCE_ADMISSION_REFERENCE_REQUIRED");
  }
  const receipt = resourceAdmissionReceiptSchema.parse(
    await resolveCommittedArtifact(authority, reference),
  );
  if (
    JSON.stringify(receipt.receipt_ref) !== JSON.stringify(reference) ||
    (await computeResourceAdmissionReceiptHash(receipt)) !== receipt.receipt_hash ||
    (await computeResourceEstimateHash(receipt)) !== receipt.estimate_hash
  ) {
    throw new TypeError("TEXT2SQL_RESOURCE_ADMISSION_NOT_AUTHORITATIVE");
  }
  const policy = resourcePolicySchema.parse({
    policy_version: receipt.policy_version,
    max_total_cost: receipt.max_total_cost,
    max_plan_rows: receipt.max_plan_rows,
    max_plan_bytes: receipt.max_plan_bytes,
    forbidden_node_types: receipt.forbidden_node_types,
    statement_timeout_ms: receipt.timeout_ms,
    lock_timeout_ms: receipt.lock_timeout_ms,
    max_rows: receipt.max_rows,
    max_bytes: receipt.max_bytes,
    max_memory_mb: receipt.max_memory_mb,
  });
  const estimate = postgresqlExplainEstimateSchema.parse({
    query_hash: receipt.query_hash,
    datasource_id: receipt.datasource_id,
    schema_version: receipt.schema_version,
    settings_hash: receipt.settings_hash,
    explain_format: "JSON",
    analyze: false,
    total_cost: receipt.total_cost,
    plan_rows: receipt.plan_rows,
    plan_width: receipt.plan_width,
    node_types: receipt.node_types,
    relation_names: receipt.relation_names,
    has_cartesian_join: receipt.has_cartesian_join,
  });
  const admission = deepFreeze({
    receipt,
    policy,
    estimate,
    expected_schema_version: receipt.schema_version,
    expected_settings_hash: receipt.settings_hash,
    expected_relation_names: receipt.relation_names,
  }) as unknown as TrustedResourceAdmission;
  trustedResourceAdmissions.add(admission);
  return admission;
}

export function isTrustedResourceAdmission(value: unknown): value is TrustedResourceAdmission {
  return typeof value === "object" && value !== null && trustedResourceAdmissions.has(value);
}

/**
 * @internal 连接服务端 Artifact Store 与确定性 Gate；注册函数不从 package root 导出。
 * resolveArtifact 必须按完整 ArtifactReference 返回已提交 payload，而不是接受调用者回填的对象。
 */
export function registerTrustedGateArtifactAuthority(
  adapter: Readonly<{
    resolveArtifact(reference: ArtifactReference): Promise<unknown | null>;
    verifyCommitted(reference: ArtifactReference): Promise<boolean>;
    now(): string;
  }>,
): TrustedGateArtifactAuthority {
  if (
    typeof adapter.resolveArtifact !== "function" ||
    typeof adapter.verifyCommitted !== "function" ||
    typeof adapter.now !== "function"
  ) {
    throw new TypeError("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_INVALID");
  }
  const authority = Object.freeze({
    resolveArtifact: (reference: ArtifactReference) =>
      adapter.resolveArtifact(artifactReferenceSchema.parse(reference)),
    verifyCommitted: (reference: ArtifactReference) =>
      adapter.verifyCommitted(artifactReferenceSchema.parse(reference)),
    now: () => adapter.now(),
  }) as TrustedGateArtifactAuthority;
  trustedGateArtifactAuthorities.add(authority);
  return authority;
}

export function isTrustedGateArtifactAuthority(
  value: unknown,
): value is TrustedGateArtifactAuthority {
  return typeof value === "object" && value !== null && trustedGateArtifactAuthorities.has(value);
}

export async function resolveCommittedArtifact(
  authority: TrustedGateArtifactAuthority,
  reference: ArtifactReference,
): Promise<unknown | null> {
  if (!isTrustedGateArtifactAuthority(authority)) {
    throw new TypeError("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_REQUIRED");
  }
  if (!(await authority.verifyCommitted(reference))) return null;
  return authority.resolveArtifact(reference);
}

/** @internal Result Oracle adapter 注册；普通 callback 或 structuredClone 不具备权威性。 */
export function registerTrustedResultOracleAuthority(
  adapter: ResultOracleAuthorityRegistration,
): TrustedResultOracleAuthority {
  const identity = authorityIdentitySchema.safeParse(adapter.identity);
  if (
    !identity.success ||
    typeof adapter.evaluate !== "function" ||
    typeof adapter.resolveCommitted !== "function" ||
    typeof adapter.verifyCommitted !== "function" ||
    typeof adapter.verifyExactArtifactRevision !== "function"
  ) {
    throw new TypeError("TEXT2SQL_RESULT_ORACLE_AUTHORITY_INVALID");
  }
  const evaluate = adapter.evaluate.bind(adapter);
  const registration = Object.freeze({
    identity: deepFreeze(identity.data),
    evaluate,
    resolveCommitted: adapter.resolveCommitted.bind(adapter),
    verifyCommitted: adapter.verifyCommitted.bind(adapter),
    verifyExactArtifactRevision: adapter.verifyExactArtifactRevision.bind(adapter),
  }) satisfies ResultOracleAuthorityRegistration;
  const authority = Object.freeze({
    identity: registration.identity,
    evaluate: (input: Parameters<ResultOracleAuthority["evaluate"]>[0]) => evaluate(input),
  }) as TrustedResultOracleAuthority;
  trustedResultOracleAuthorities.add(authority);
  trustedResultOracleAuthoritySources.set(authority, adapter);
  trustedResultOracleAuthorityRegistrations.set(authority, registration);
  return authority;
}

export function isTrustedResultOracleAuthority(
  value: unknown,
): value is TrustedResultOracleAuthority {
  return typeof value === "object" && value !== null && trustedResultOracleAuthorities.has(value);
}

export function trustedResultOracleAuthoritySource(value: unknown): object | null {
  return typeof value === "object" && value !== null
    ? (trustedResultOracleAuthoritySources.get(value) ?? null)
    : null;
}

export function trustedResultOracleAuthorityIdentity(
  value: unknown,
): TrustedResultOracleAuthority["identity"] | null {
  return isTrustedResultOracleAuthority(value) ? value.identity : null;
}

export async function resolveTrustedResultOracleArtifact(
  authority: TrustedResultOracleAuthority,
  referenceInput: unknown,
): Promise<unknown | null> {
  const reference = artifactReferenceSchema.parse(referenceInput);
  if (
    reference.artifact_type !== "ResultOracleReceipt" ||
    !isTrustedResultOracleAuthority(authority)
  ) {
    return null;
  }
  const registration = trustedResultOracleAuthorityRegistrations.get(authority);
  if (!registration || !(await registration.verifyCommitted(reference))) return null;
  const artifact = await registration.resolveCommitted(reference);
  return artifact !== null && (await registration.verifyExactArtifactRevision(reference, artifact))
    ? artifact
    : null;
}

export async function authorizeTrustedResultOracleReceipt(
  authority: TrustedResultOracleAuthority,
  verifier: TrustedMetamorphicOracleVerifier,
  referenceInput: unknown,
  metamorphic: TrustedMetamorphicOracleVerification,
): Promise<AuthoritativeResultOracleReceipt | null> {
  if (
    !isTrustedResultOracleAuthority(authority) ||
    !isTrustedMetamorphicOracleVerification(metamorphic)
  ) {
    return null;
  }
  const registration = trustedResultOracleAuthorityRegistrations.get(authority);
  const metamorphicAuthority = trustedMetamorphicOracleAuthorityToken(verifier);
  if (!registration || !metamorphicAuthority) return null;

  try {
    const authorityToken = createResultOracleReceiptAuthority({
      identity: registration.identity,
      metamorphic_authority: metamorphicAuthority,
      resolveCommitted: registration.resolveCommitted,
      verifyCommitted: registration.verifyCommitted,
      verifyExactArtifactRevision: registration.verifyExactArtifactRevision,
    });
    return await authorizeResultOracleReceipt(referenceInput, authorityToken, metamorphic.receipt);
  } catch {
    return null;
  }
}
