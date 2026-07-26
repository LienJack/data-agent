import {
  type ArtifactReference,
  type AuthoritativeSandboxExecutionReceipt,
  type AuthoritativeSandboxResult,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  canonicalizeJson,
  computeResultOracleEvidenceHash as computePersistedResultOracleEvidenceHash,
  computeResultOracleReceiptHash,
  deepFreeze,
  EXECUTABLE_QUERY_LIMITS,
  type ExecutionPermitPayload,
  type ExecutionReceiptPayload,
  executionPermitSchema,
  executionReceiptSchema,
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
  queryContractSchema,
  type ResultOracleReceipt,
  resultOracleReceiptSchema,
  type SandboxExecutionRequest,
  sandboxExecutionRequestSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { isPostgresqlCompilation, type PostgresqlCompilation } from "../compiler/types.js";
import {
  createTrustedGateEvaluation,
  isTrustedGateArtifactAuthority,
  isTrustedResultOracleAuthority,
  registerTrustedPostExecutionGateSuite,
  resolveCommittedArtifact,
  type TrustedGateArtifactAuthority,
  type TrustedResultOracleAuthority,
} from "./internal.js";
import type { ExecutionGateReasonCode, ResultGateReasonCode } from "./reason-codes.js";
import type {
  PostExecutionGateSuite,
  ResultOracleVerdict,
  TrustedGateEvaluation,
} from "./types.js";

export const TEXT2SQL_SQL_SANDBOX_MAX_MEMORY_MB = EXECUTABLE_QUERY_LIMITS.max_memory_mb;

export interface EvaluatePostExecutionGatesInput {
  readonly artifact_authority: unknown;
  readonly query_contract: unknown;
  readonly compilation: unknown;
  readonly sql_artifact_ref: unknown;
  readonly execution_receipt_ref: unknown;
  readonly sandbox_request: unknown;
  readonly sandbox_receipt: unknown;
  readonly sandbox_result: unknown;
  readonly result_oracle_authority?: unknown;
}

interface ParsedPostExecutionInput {
  readonly authority: TrustedGateArtifactAuthority;
  readonly queryContract: ReturnType<typeof queryContractSchema.parse> | null;
  readonly compilation: PostgresqlCompilation | null;
  readonly sqlArtifactReference: ArtifactReference;
  readonly executionReceiptReference: ArtifactReference;
  readonly executionPermit: ExecutionPermitPayload | null;
  readonly executionPermitReference: ArtifactReference | null;
  readonly executionReceipt: ExecutionReceiptPayload | null;
  readonly sandboxRequest: SandboxExecutionRequest | null;
  readonly sandboxReceipt: AuthoritativeSandboxExecutionReceipt | null;
  readonly sandboxResult: AuthoritativeSandboxResult | null;
  readonly resultOracleAuthority: TrustedResultOracleAuthority | null;
}

function asContentHash(value: string): `sha256:${string}` {
  return value as `sha256:${string}`;
}

function safeParse<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch {
    return null;
  }
}

function parseTypedReference(
  value: unknown,
  artifactType: ArtifactReference["artifact_type"],
): ArtifactReference | null {
  const reference = safeParse(() => artifactReferenceSchema.parse(value));
  return reference?.artifact_type === artifactType ? reference : null;
}

async function parseInput(
  input: EvaluatePostExecutionGatesInput,
): Promise<ParsedPostExecutionInput> {
  const sqlArtifactReference = artifactReferenceSchema.parse(input.sql_artifact_ref);
  if (sqlArtifactReference.artifact_type !== "SqlArtifact") {
    throw new TypeError("TEXT2SQL_SQL_ARTIFACT_REFERENCE_REQUIRED");
  }
  const executionReceiptReference = artifactReferenceSchema.parse(input.execution_receipt_ref);
  if (executionReceiptReference.artifact_type !== "ExecutionReceipt") {
    throw new TypeError("TEXT2SQL_EXECUTION_RECEIPT_REFERENCE_REQUIRED");
  }
  if (!isTrustedGateArtifactAuthority(input.artifact_authority)) {
    throw new TypeError("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_REQUIRED");
  }
  const authority = input.artifact_authority;
  const executionReceiptPayload = await resolveCommittedArtifact(
    authority,
    executionReceiptReference,
  );
  const executionReceipt = safeParse(() => executionReceiptSchema.parse(executionReceiptPayload));
  const executionPermitReference = executionReceipt
    ? parseTypedReference(executionReceipt.execution_permit_ref, "ExecutionPermit")
    : null;
  const executionPermitPayload = executionPermitReference
    ? await resolveCommittedArtifact(authority, executionPermitReference)
    : null;
  return {
    authority,
    queryContract: safeParse(() => queryContractSchema.parse(input.query_contract)),
    compilation: isPostgresqlCompilation(input.compilation) ? input.compilation : null,
    sqlArtifactReference,
    executionReceiptReference,
    executionPermit: safeParse(() => executionPermitSchema.parse(executionPermitPayload)),
    executionPermitReference,
    executionReceipt,
    sandboxRequest: safeParse(() => sandboxExecutionRequestSchema.parse(input.sandbox_request)),
    sandboxReceipt: isAuthoritativeSandboxExecutionReceipt(input.sandbox_receipt)
      ? input.sandbox_receipt
      : null,
    sandboxResult: isAuthoritativeSandboxResult(input.sandbox_result) ? input.sandbox_result : null,
    resultOracleAuthority: isTrustedResultOracleAuthority(input.result_oracle_authority)
      ? input.result_oracle_authority
      : null,
  };
}

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function sameScope(
  reference: ArtifactReference,
  scope: Readonly<{ app_id: string; tenant_id: string; environment: string }>,
  runId: string,
): boolean {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment &&
    reference.run_id === runId
  );
}

function sqlSandboxRequestIsBound(parsed: ParsedPostExecutionInput): boolean {
  const request = parsed.sandboxRequest;
  const receipt = parsed.sandboxReceipt;
  const permit = parsed.executionPermit;
  const compilation = parsed.compilation;
  if (
    request?.language !== "sql" ||
    !receipt ||
    !permit ||
    !compilation ||
    !parsed.executionPermitReference
  ) {
    return false;
  }
  return (
    request.scope.app_id === receipt.scope.app_id &&
    request.scope.tenant_id === receipt.scope.tenant_id &&
    request.scope.environment === receipt.scope.environment &&
    request.run_id === receipt.run_id &&
    request.execution_id === receipt.execution_id &&
    request.idempotency_key === receipt.idempotency_key &&
    request.schema_version === receipt.schema_version &&
    sameReference(request.payload.sql_artifact_ref, parsed.sqlArtifactReference) &&
    canonicalizeJson(request.payload.parameters) ===
      canonicalizeJson(compilation.sql_artifact.parameters) &&
    request.budget.timeout_ms === permit.budget.timeout_ms &&
    request.budget.max_rows === permit.budget.max_rows &&
    request.budget.max_bytes === permit.budget.max_bytes &&
    request.budget.max_memory_mb <= TEXT2SQL_SQL_SANDBOX_MAX_MEMORY_MB
  );
}

function executionBindingsAreClosed(parsed: ParsedPostExecutionInput): boolean {
  const {
    sqlArtifactReference,
    executionPermit,
    executionPermitReference,
    executionReceipt,
    sandboxReceipt,
    sandboxResult,
    executionReceiptReference,
  } = parsed;
  if (
    !executionPermit ||
    !executionPermitReference ||
    !executionReceipt ||
    !sandboxReceipt ||
    !sandboxResult
  ) {
    return false;
  }
  return (
    sameScope(executionReceiptReference, sandboxReceipt.scope, sandboxReceipt.run_id) &&
    sameScope(sqlArtifactReference, sandboxReceipt.scope, sandboxReceipt.run_id) &&
    sameReference(executionPermit.sql_artifact_ref, sqlArtifactReference) &&
    sameReference(executionReceipt.sql_artifact_ref, sqlArtifactReference) &&
    sameReference(executionReceipt.execution_permit_ref, executionPermitReference) &&
    sameReference(executionReceipt.sandbox_execution_receipt_ref, sandboxReceipt.receipt_ref) &&
    sameReference(executionReceipt.result_artifact_ref, sandboxReceipt.result_artifact_ref) &&
    sameReference(executionReceipt.result_artifact_ref, sandboxResult.result_ref) &&
    sandboxReceipt.execution_id === sandboxResult.execution_id &&
    sandboxReceipt.schema_version === sandboxResult.schema_version &&
    sqlSandboxRequestIsBound(parsed)
  );
}

function executionTimesAreAuthorized(parsed: ParsedPostExecutionInput): boolean {
  const permit = parsed.executionPermit;
  const sandbox = parsed.sandboxReceipt;
  const execution = parsed.executionReceipt;
  if (!permit || !sandbox || !execution) return false;
  const issuedAt = Date.parse(permit.issued_at);
  const startedAt = Date.parse(sandbox.started_at);
  const completedAt = Date.parse(sandbox.completed_at);
  const observedAt = Date.parse(execution.observed_at);
  const expiresAt = Date.parse(permit.expires_at);
  return (
    [issuedAt, startedAt, completedAt, observedAt, expiresAt].every(Number.isFinite) &&
    issuedAt <= startedAt &&
    startedAt < expiresAt &&
    startedAt <= completedAt &&
    completedAt <= observedAt
  );
}

export async function computeSqlSandboxInputHash(input: unknown): Promise<`sha256:${string}`> {
  const request = sandboxExecutionRequestSchema.parse(input);
  if (request.language !== "sql") {
    throw new TypeError("TEXT2SQL_SQL_SANDBOX_REQUEST_REQUIRED");
  }
  return sha256ContentHash(request);
}

async function evaluateExecution(
  parsed: ParsedPostExecutionInput,
): Promise<TrustedGateEvaluation<"EXECUTION">> {
  const sandbox = parsed.sandboxReceipt;
  const result = parsed.sandboxResult;
  const receipt = parsed.executionReceipt;
  const permit = parsed.executionPermit;
  const compilation = parsed.compilation;
  const unavailableHash = await sha256ContentHash(null);
  let verdict: "PASS" | "FAIL" | "UNAVAILABLE" = "PASS";
  let reasonCode: ExecutionGateReasonCode = "EXECUTION_VERIFIED";
  if (
    !parsed.authority ||
    !sandbox ||
    !result ||
    !receipt ||
    !compilation ||
    !parsed.queryContract ||
    !parsed.executionPermitReference ||
    !parsed.sandboxRequest
  ) {
    verdict = "UNAVAILABLE";
    reasonCode = "EXECUTION_SANDBOX_UNAVAILABLE";
  } else if (
    !permit ||
    !executionBindingsAreClosed(parsed) ||
    !executionTimesAreAuthorized(parsed)
  ) {
    verdict = "FAIL";
    reasonCode = "EXECUTION_PERMIT_INVALID";
  } else if (
    sandbox.input_hash !== (await computeSqlSandboxInputHash(parsed.sandboxRequest)) ||
    receipt.query_hash !== compilation.sql_artifact.query_hash ||
    receipt.datasource_id !== parsed.queryContract.datasource_id ||
    receipt.schema_version !== sandbox.schema_version
  ) {
    verdict = "FAIL";
    reasonCode = "EXECUTION_HASH_MISMATCH";
  } else if (
    sandbox.resource_usage.elapsed_ms > permit.budget.timeout_ms ||
    Date.parse(sandbox.completed_at) - Date.parse(sandbox.started_at) > permit.budget.timeout_ms
  ) {
    verdict = "FAIL";
    reasonCode = "EXECUTION_TIMEOUT";
  } else if (
    sandbox.resource_usage.rows > permit.budget.max_rows ||
    sandbox.resource_usage.bytes > permit.budget.max_bytes
  ) {
    verdict = "FAIL";
    reasonCode = "EXECUTION_RESULT_CAP_EXCEEDED";
  } else if (
    sandbox.resource_usage.peak_memory_mb > parsed.sandboxRequest.budget.max_memory_mb ||
    receipt.row_count !== sandbox.resource_usage.rows ||
    receipt.row_count !== result.row_count ||
    receipt.result_hash !== result.result_hash ||
    sandbox.resource_usage.bytes !== result.bytes
  ) {
    verdict = "FAIL";
    reasonCode = "EXECUTION_FAILED";
  }
  return createTrustedGateEvaluation(parsed.authority, {
    gate: "EXECUTION",
    sql_artifact_ref: parsed.sqlArtifactReference,
    execution_receipt_ref: parsed.executionReceiptReference,
    evidence_refs:
      sandbox && result
        ? [sandbox.receipt_ref, result.result_ref]
        : [parsed.executionReceiptReference],
    verdict,
    reason_code: reasonCode,
    input_material: {
      query_hash: compilation?.sql_artifact.query_hash ?? null,
      sql_artifact_ref: parsed.sqlArtifactReference,
      execution_permit: permit,
      execution_permit_ref: parsed.executionPermitReference,
      execution_receipt: receipt,
      sandbox_request: parsed.sandboxRequest,
      sandbox_receipt: sandbox,
      sandbox_result: result,
    },
    observations: {
      query_hash: compilation
        ? asContentHash(compilation.sql_artifact.query_hash)
        : unavailableHash,
      sandbox_execution_hash: sandbox ? asContentHash(sandbox.execution_hash) : unavailableHash,
      elapsed_ms: sandbox?.resource_usage.elapsed_ms ?? 0,
      rows: sandbox?.resource_usage.rows ?? 0,
      bytes: sandbox?.resource_usage.bytes ?? 0,
    },
  });
}

async function resolveOracleVerdict(
  parsed: ParsedPostExecutionInput,
): Promise<ResultOracleReceipt | null> {
  if (
    !parsed.resultOracleAuthority ||
    !parsed.queryContract ||
    !parsed.executionReceipt ||
    !parsed.sandboxResult
  ) {
    return null;
  }
  try {
    const referenceInput = await parsed.resultOracleAuthority.evaluate({
      query_contract: parsed.queryContract,
      execution_receipt: parsed.executionReceipt,
      sandbox_result: parsed.sandboxResult,
    });
    const reference = referenceInput
      ? parseTypedReference(referenceInput, "ResultOracleReceipt")
      : null;
    if (!reference) return null;
    const receipt = resultOracleReceiptSchema.parse(
      await resolveCommittedArtifact(parsed.authority, reference),
    );
    if (
      !sameReference(receipt.receipt_ref, reference) ||
      (await computeResultOracleReceiptHash(receipt)) !== receipt.receipt_hash ||
      (await computePersistedResultOracleEvidenceHash(receipt)) !== receipt.evidence_hash
    ) {
      return null;
    }
    return receipt;
  } catch {
    return null;
  }
}

function exactStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function computeResultOracleEvidenceHash(
  input: Readonly<{
    verdict: Omit<ResultOracleVerdict, "evidence_hash">;
    result_artifact_ref: ArtifactReference;
  }>,
): Promise<`sha256:${string}`> {
  return computePersistedResultOracleEvidenceHash({
    ...input.verdict,
    result_artifact_ref: input.result_artifact_ref,
  });
}

async function evaluateResult(
  parsed: ParsedPostExecutionInput,
  executionGate: TrustedGateEvaluation<"EXECUTION">,
): Promise<TrustedGateEvaluation<"RESULT">> {
  const oracle = executionGate.verdict === "PASS" ? await resolveOracleVerdict(parsed) : null;
  const expectedInvariants = parsed.queryContract?.result_contract.invariant_ids ?? [];
  const observedInvariants =
    oracle?.invariant_verdicts.map(({ invariant_id }) => invariant_id) ?? [];
  const unavailableHash = await sha256ContentHash(null);
  const expectedEvidenceHash =
    oracle && parsed.sandboxResult
      ? await computeResultOracleEvidenceHash({
          verdict: {
            oracle_version: oracle.oracle_version,
            query_hash: oracle.query_hash,
            result_hash: oracle.result_hash,
            result_columns: oracle.result_columns,
            row_count: oracle.row_count,
            invariant_verdicts: oracle.invariant_verdicts,
            oracle_verdict: oracle.oracle_verdict,
          },
          result_artifact_ref: parsed.sandboxResult.result_ref,
        })
      : unavailableHash;
  let verdict: "PASS" | "FAIL" | "UNAVAILABLE" = "PASS";
  let reasonCode: ResultGateReasonCode = "RESULT_VERIFIED";
  if (
    executionGate.verdict !== "PASS" ||
    !oracle ||
    !parsed.executionReceipt ||
    !parsed.sandboxResult
  ) {
    verdict = "UNAVAILABLE";
    reasonCode = "RESULT_ORACLE_UNAVAILABLE";
  } else if (
    !sameReference(oracle.sql_artifact_ref, parsed.sqlArtifactReference) ||
    !sameReference(oracle.execution_receipt_ref, parsed.executionReceiptReference) ||
    !sameReference(oracle.result_artifact_ref, parsed.sandboxResult.result_ref) ||
    Date.parse(oracle.evaluated_at) < Date.parse(parsed.executionReceipt.observed_at) ||
    Date.parse(oracle.evaluated_at) > Date.parse(parsed.authority.now()) ||
    oracle.query_hash !== parsed.executionReceipt.query_hash ||
    oracle.result_hash !== parsed.executionReceipt.result_hash ||
    oracle.result_hash !== parsed.sandboxResult.result_hash
  ) {
    verdict = "FAIL";
    reasonCode = "RESULT_BINDING_MISMATCH";
  } else if (
    !parsed.queryContract ||
    !exactStringArray(oracle.result_columns, parsed.queryContract.result_contract.columns) ||
    !exactStringArray(
      parsed.sandboxResult.columns.map(({ name }) => name),
      parsed.queryContract.result_contract.columns,
    )
  ) {
    verdict = "FAIL";
    reasonCode = "RESULT_SCHEMA_MISMATCH";
  } else if (
    oracle.row_count !== parsed.executionReceipt.row_count ||
    oracle.row_count !== parsed.sandboxResult.row_count
  ) {
    verdict = "FAIL";
    reasonCode = "RESULT_CARDINALITY_MISMATCH";
  } else if (
    !exactStringArray(observedInvariants, expectedInvariants) ||
    oracle.invariant_verdicts.some(({ verdict: state }) => state !== "PASS")
  ) {
    verdict = "FAIL";
    reasonCode = "RESULT_INVARIANT_FAILED";
  } else if (oracle.oracle_verdict !== "PASS" || oracle.evidence_hash !== expectedEvidenceHash) {
    verdict = "FAIL";
    reasonCode = "RESULT_ORACLE_FAILED";
  }
  return createTrustedGateEvaluation(parsed.authority, {
    gate: "RESULT",
    sql_artifact_ref: parsed.sqlArtifactReference,
    execution_receipt_ref: parsed.executionReceiptReference,
    evidence_refs:
      oracle && parsed.sandboxResult
        ? [parsed.sandboxResult.result_ref, oracle.receipt_ref]
        : [parsed.executionReceiptReference],
    verdict,
    reason_code: reasonCode,
    input_material: {
      execution_gate_hash: executionGate.evaluation_hash,
      execution_receipt: parsed.executionReceipt,
      sandbox_result: parsed.sandboxResult,
      result_contract: parsed.queryContract?.result_contract ?? null,
      oracle,
    },
    observations: {
      result_hash: oracle ? asContentHash(oracle.result_hash) : unavailableHash,
      oracle_version: oracle?.oracle_version ?? "UNAVAILABLE",
      invariant_ids: observedInvariants,
      oracle_evidence_hash: oracle ? asContentHash(oracle.evidence_hash) : unavailableHash,
    },
  });
}

export async function evaluatePostExecutionGates(
  input: EvaluatePostExecutionGatesInput,
): Promise<PostExecutionGateSuite> {
  const parsed = await parseInput(input);
  const execution = await evaluateExecution(parsed);
  const result = await evaluateResult(parsed, execution);
  const gates = [execution, result] as const;
  return registerTrustedPostExecutionGateSuite(
    deepFreeze({
      state: "EVALUATED" as const,
      gates,
      validation_eligible: gates.every(({ verdict }) => verdict === "PASS"),
    }),
  );
}
