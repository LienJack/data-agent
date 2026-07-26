import {
  type ArtifactReference,
  artifactReferenceSchema,
  canonicalizeJson,
  computeSqlArtifactQueryHash,
  deepFreeze,
  queryContractSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { isPostgresqlCompilation, type PostgresqlCompilation } from "../compiler/types.js";
import { type GroundingPackageDraft, groundingPackageDraftSchema } from "../grounding/types.js";
import {
  isValidatedLogicalPlan,
  type ValidatedLogicalPlan,
  validateLogicalPlan,
} from "../planning/validate-logical-plan.js";
import { type SemanticQueryDraft, semanticQueryDraftSchema } from "../semantic/types.js";
import {
  createTrustedGateEvaluation,
  isTrustedGateArtifactAuthority,
  isTrustedResourceAdmission,
  registerTrustedPreExecutionGateSuite,
  type TrustedGateArtifactAuthority,
} from "./internal.js";
import type {
  IntentGateReasonCode,
  PolicyGateReasonCode,
  ResourceGateReasonCode,
  SemanticGateReasonCode,
  StructuralGateReasonCode,
} from "./reason-codes.js";
import type {
  PreExecutionGateSuite,
  TrustedGateEvaluation,
  TrustedResourceAdmission,
} from "./types.js";

export interface EvaluatePreExecutionGatesInput {
  readonly artifact_authority: unknown;
  readonly sql_artifact_ref: unknown;
  readonly query_contract: unknown;
  readonly grounding: unknown;
  readonly semantic_query: unknown;
  readonly logical_plan: unknown;
  readonly compilation: unknown;
  readonly resource_admission?: unknown;
}

interface ParsedPreExecutionInput {
  readonly authority: TrustedGateArtifactAuthority;
  readonly sqlArtifactReference: ArtifactReference;
  readonly queryContract: ReturnType<typeof queryContractSchema.parse> | null;
  readonly grounding: GroundingPackageDraft | null;
  readonly semanticQuery: SemanticQueryDraft | null;
  readonly logicalPlan: ValidatedLogicalPlan | null;
  readonly compilation: PostgresqlCompilation | null;
  readonly resourceAdmission: TrustedResourceAdmission | null;
  readonly resourceAdmissionProvided: boolean;
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

function parseInput(input: EvaluatePreExecutionGatesInput): ParsedPreExecutionInput {
  if (!isTrustedGateArtifactAuthority(input.artifact_authority)) {
    throw new TypeError("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_REQUIRED");
  }
  const sqlArtifactReference = artifactReferenceSchema.parse(input.sql_artifact_ref);
  if (sqlArtifactReference.artifact_type !== "SqlArtifact") {
    throw new TypeError("TEXT2SQL_SQL_ARTIFACT_REFERENCE_REQUIRED");
  }
  return {
    authority: input.artifact_authority,
    sqlArtifactReference,
    queryContract: safeParse(() => queryContractSchema.parse(input.query_contract)),
    grounding: safeParse(() => groundingPackageDraftSchema.parse(input.grounding)),
    semanticQuery: safeParse(() => semanticQueryDraftSchema.parse(input.semantic_query)),
    logicalPlan: isValidatedLogicalPlan(input.logical_plan) ? input.logical_plan : null,
    compilation: isPostgresqlCompilation(input.compilation) ? input.compilation : null,
    resourceAdmission: isTrustedResourceAdmission(input.resource_admission)
      ? input.resource_admission
      : null,
    resourceAdmissionProvided: input.resource_admission !== undefined,
  };
}

function validatePlanLineage(
  parsed: ParsedPreExecutionInput,
): ReturnType<typeof validateLogicalPlan> | null {
  if (!parsed.queryContract || !parsed.grounding || !parsed.semanticQuery || !parsed.logicalPlan) {
    return null;
  }
  return validateLogicalPlan({
    query_contract: parsed.queryContract,
    grounding: parsed.grounding,
    semantic_query: parsed.semanticQuery,
    logical_plan: parsed.logicalPlan,
  });
}

function policyParameterCount(logicalPlan: ValidatedLogicalPlan | null): number {
  if (!logicalPlan) return 0;
  return Object.values(logicalPlan.parameters).filter(({ source }) => source === "policy").length;
}

function hasPolicyPredicateCoverage(
  logicalPlan: ValidatedLogicalPlan,
  grounding: GroundingPackageDraft,
): boolean {
  const observed = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "filter"
      ? operation.predicates.flatMap((predicate) => {
          if (predicate.authority !== "policy") return [];
          const field = predicate.kind === "comparison" ? predicate.left : predicate.field;
          const parameterKey =
            predicate.kind === "comparison"
              ? logicalPlan.parameters[predicate.right.parameter_key]
              : null;
          return [
            canonicalizeJson({
              table_id: field.table_id,
              column_id: field.column_id,
              operator: predicate.operator,
              ...(predicate.kind === "null-check"
                ? {}
                : {
                    parameter_key:
                      parameterKey?.source === "policy" ? parameterKey.policy_key : null,
                  }),
            }),
          ];
        })
      : [],
  );
  const expected = grounding.mandatory_predicates.map((predicate) => canonicalizeJson(predicate));
  const sortedObserved = [...observed].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedObserved.length === sortedExpected.length &&
    sortedObserved.every((value, index) => value === sortedExpected[index])
  );
}

function identifierProofMatchesGrounding(
  compilation: PostgresqlCompilation,
  grounding: GroundingPackageDraft,
): boolean {
  const allowed = new Set<string>();
  for (const table of grounding.allowed_schema.tables) {
    allowed.add(canonicalizeJson(["table", table.table_id, table.physical_name]));
    for (const column of table.columns) {
      allowed.add(canonicalizeJson(["column", column.column_id, column.physical_name]));
    }
  }
  return compilation.proof.identifiers.every((identifier) =>
    allowed.has(
      canonicalizeJson([identifier.kind, identifier.logical_id, identifier.physical_name]),
    ),
  );
}

function parameterProofIsClosed(compilation: PostgresqlCompilation): boolean {
  const order = compilation.parameter_order;
  const parameterKeys = Object.keys(compilation.sql_artifact.parameters).sort();
  if (parameterKeys.length !== order.length) return false;
  for (const [index, entry] of order.entries()) {
    const position = index + 1;
    if (
      entry.position !== position ||
      entry.placeholder !== `$${position}` ||
      !parameterKeys.includes(entry.placeholder)
    ) {
      return false;
    }
  }
  return true;
}

async function evaluateIntent(
  parsed: ParsedPreExecutionInput,
  planValidation: ReturnType<typeof validateLogicalPlan> | null,
): Promise<TrustedGateEvaluation<"INTENT">> {
  const queryContractHash = await sha256ContentHash(parsed.queryContract);
  const semanticSignatureHash = await sha256ContentHash(
    parsed.logicalPlan?.semantic_signature ?? null,
  );
  let verdict: "PASS" | "FAIL" | "UNAVAILABLE" = "PASS";
  let reasonCode: IntentGateReasonCode = "INTENT_VERIFIED";
  if (
    !parsed.queryContract ||
    !parsed.semanticQuery ||
    !parsed.logicalPlan ||
    !parsed.grounding ||
    !parsed.compilation
  ) {
    verdict = "UNAVAILABLE";
    reasonCode = "INTENT_INPUT_UNAVAILABLE";
  } else if (parsed.compilation.proof.grounding_hash !== parsed.grounding.grounding_hash) {
    verdict = "FAIL";
    reasonCode = "INTENT_LINEAGE_MISMATCH";
  } else if (planValidation?.state !== "VALID") {
    verdict = "FAIL";
    reasonCode = "INTENT_CONTRACT_MISMATCH";
  }
  return createTrustedGateEvaluation(parsed.authority, {
    gate: "INTENT",
    sql_artifact_ref: parsed.sqlArtifactReference,
    execution_receipt_ref: null,
    evidence_refs: [parsed.sqlArtifactReference],
    verdict,
    reason_code: reasonCode,
    input_material: {
      query_contract: parsed.queryContract,
      logical_plan: parsed.logicalPlan,
      compilation_query_hash: parsed.compilation?.sql_artifact.query_hash ?? null,
    },
    observations: {
      query_contract_hash: queryContractHash,
      intent_signature_hash: semanticSignatureHash,
    },
  });
}

async function evaluateSemantic(
  parsed: ParsedPreExecutionInput,
  planValidation: ReturnType<typeof validateLogicalPlan> | null,
): Promise<TrustedGateEvaluation<"SEMANTIC">> {
  const semanticQueryHash = await sha256ContentHash(parsed.semanticQuery);
  const logicalPlanHash = await sha256ContentHash(parsed.logicalPlan);
  const groundingHash = await sha256ContentHash(parsed.grounding);
  let verdict: "PASS" | "FAIL" | "UNAVAILABLE" = "PASS";
  let reasonCode: SemanticGateReasonCode = "SEMANTIC_VERIFIED";
  if (!parsed.semanticQuery || !parsed.logicalPlan || !parsed.grounding) {
    verdict = "UNAVAILABLE";
    reasonCode = "SEMANTIC_INPUT_UNAVAILABLE";
  } else if (parsed.logicalPlan.operations.some(({ operation }) => operation === "preaggregate")) {
    verdict = "FAIL";
    reasonCode = "SEMANTIC_FANOUT_UNSAFE";
  } else if (!parsed.compilation) {
    verdict = "UNAVAILABLE";
    reasonCode = "SEMANTIC_INPUT_UNAVAILABLE";
  } else if (planValidation?.state !== "VALID") {
    verdict = "FAIL";
    reasonCode =
      planValidation?.reason_code === "LOGICAL_PLAN_PREDICATE_COVERAGE_MISMATCH"
        ? "SEMANTIC_PREDICATE_MISMATCH"
        : "SEMANTIC_PLAN_MISMATCH";
  }
  return createTrustedGateEvaluation(parsed.authority, {
    gate: "SEMANTIC",
    sql_artifact_ref: parsed.sqlArtifactReference,
    execution_receipt_ref: null,
    evidence_refs: [parsed.sqlArtifactReference],
    verdict,
    reason_code: reasonCode,
    input_material: {
      semantic_query: parsed.semanticQuery,
      logical_plan: parsed.logicalPlan,
      grounding_hash: parsed.grounding?.grounding_hash ?? null,
      compilation_proof: parsed.compilation?.proof ?? null,
    },
    observations: {
      logical_plan_hash: logicalPlanHash,
      semantic_hash: semanticQueryHash,
      grounding_hash: groundingHash,
    },
  });
}

async function evaluateStructural(
  parsed: ParsedPreExecutionInput,
): Promise<TrustedGateEvaluation<"STRUCTURAL">> {
  const compilation = parsed.compilation;
  const astHash = await sha256ContentHash(compilation?.ast ?? null);
  const logicalPlanHash = await sha256ContentHash(parsed.logicalPlan);
  const queryHash = compilation
    ? asContentHash(compilation.sql_artifact.query_hash)
    : await sha256ContentHash(null);
  let verdict: "PASS" | "FAIL" | "UNAVAILABLE" = "PASS";
  let reasonCode: StructuralGateReasonCode = "STRUCTURAL_VERIFIED";
  if (!compilation || !parsed.grounding || !parsed.logicalPlan) {
    verdict = "UNAVAILABLE";
    reasonCode = "STRUCTURAL_COMPILER_UNAVAILABLE";
  } else if (
    (await computeSqlArtifactQueryHash(compilation.sql_artifact)) !==
    compilation.sql_artifact.query_hash
  ) {
    verdict = "FAIL";
    reasonCode = "STRUCTURAL_HASH_MISMATCH";
  } else if (compilation.proof.logical_plan_hash !== logicalPlanHash) {
    verdict = "FAIL";
    reasonCode = "STRUCTURAL_HASH_MISMATCH";
  } else if (!parameterProofIsClosed(compilation)) {
    verdict = "FAIL";
    reasonCode = "STRUCTURAL_PARAMETER_MISMATCH";
  } else if (compilation.parameter_order.length === 0) {
    verdict = "FAIL";
    reasonCode = "STRUCTURAL_PARAMETER_MISMATCH";
  } else if (!identifierProofMatchesGrounding(compilation, parsed.grounding)) {
    verdict = "FAIL";
    reasonCode = "STRUCTURAL_REFERENCE_UNRESOLVED";
  } else if (compilation.ast.kind !== "postgresql-query") {
    verdict = "FAIL";
    reasonCode = "STRUCTURAL_NOT_READ_ONLY";
  }
  return createTrustedGateEvaluation(parsed.authority, {
    gate: "STRUCTURAL",
    sql_artifact_ref: parsed.sqlArtifactReference,
    execution_receipt_ref: null,
    evidence_refs: [parsed.sqlArtifactReference],
    verdict,
    reason_code: reasonCode,
    input_material: {
      compilation,
      grounding_hash: parsed.grounding?.grounding_hash ?? null,
    },
    observations: {
      compiler_version: compilation?.proof.compiler_version ?? "UNAVAILABLE",
      ast_hash: astHash,
      query_hash: queryHash,
      parameter_count: compilation?.parameter_order.length ?? 0,
      statement_kind: compilation ? "SELECT" : "UNAVAILABLE",
      read_only: compilation !== null,
    },
  });
}

async function evaluatePolicy(
  parsed: ParsedPreExecutionInput,
): Promise<TrustedGateEvaluation<"POLICY">> {
  const mandatoryPredicateCount = parsed.grounding?.mandatory_predicates.length ?? 0;
  const resolvedPolicyParameterCount =
    parsed.compilation?.parameter_order.filter(({ source }) => source === "policy").length ?? 0;
  const hasCoverage =
    parsed.logicalPlan && parsed.grounding
      ? hasPolicyPredicateCoverage(parsed.logicalPlan, parsed.grounding)
      : false;
  const resolvedBindingCount =
    hasCoverage && resolvedPolicyParameterCount === policyParameterCount(parsed.logicalPlan)
      ? mandatoryPredicateCount
      : resolvedPolicyParameterCount;
  let verdict: "PASS" | "FAIL" | "UNAVAILABLE" = "PASS";
  let reasonCode: PolicyGateReasonCode = "POLICY_VERIFIED";
  if (!parsed.grounding || !parsed.logicalPlan || !parsed.compilation) {
    verdict = "UNAVAILABLE";
    reasonCode = "POLICY_RECEIPT_UNAVAILABLE";
  } else if (parsed.compilation.proof.policy_version !== parsed.grounding.policy_version) {
    verdict = "FAIL";
    reasonCode = "POLICY_VERSION_MISMATCH";
  } else if (
    resolvedPolicyParameterCount !== policyParameterCount(parsed.logicalPlan) ||
    !hasCoverage
  ) {
    verdict = "FAIL";
    reasonCode = "POLICY_PREDICATE_MISSING";
  } else if (!identifierProofMatchesGrounding(parsed.compilation, parsed.grounding)) {
    verdict = "FAIL";
    reasonCode = "POLICY_OBJECT_DENIED";
  }
  return createTrustedGateEvaluation(parsed.authority, {
    gate: "POLICY",
    sql_artifact_ref: parsed.sqlArtifactReference,
    execution_receipt_ref: null,
    evidence_refs: [parsed.sqlArtifactReference],
    verdict,
    reason_code: reasonCode,
    input_material: {
      grounding: parsed.grounding,
      logical_plan_parameters: parsed.logicalPlan?.parameters ?? null,
      compilation_proof: parsed.compilation?.proof ?? null,
    },
    observations: {
      policy_version: parsed.grounding?.policy_version ?? "UNAVAILABLE",
      mandatory_predicate_count: mandatoryPredicateCount,
      resolved_binding_count: resolvedBindingCount,
    },
  });
}

async function evaluateResource(
  parsed: ParsedPreExecutionInput,
): Promise<TrustedGateEvaluation<"RESOURCE">> {
  const admission = parsed.resourceAdmission;
  const estimate = admission?.estimate ?? null;
  const policy = admission?.policy ?? null;
  const estimateHash = asContentHash(
    admission?.receipt.estimate_hash ?? (await sha256ContentHash(null)),
  );
  const expectedRelationNames = [
    ...new Set(
      parsed.compilation?.proof.identifiers.flatMap(({ kind, physical_name: physicalName }) =>
        kind === "table" ? [physicalName] : [],
      ) ?? [],
    ),
  ].sort();
  const plannedBytes =
    estimate && Number.isSafeInteger(estimate.plan_rows * estimate.plan_width)
      ? estimate.plan_rows * estimate.plan_width
      : Number.MAX_SAFE_INTEGER;
  let verdict: "PASS" | "FAIL" | "UNAVAILABLE" = "PASS";
  let reasonCode: ResourceGateReasonCode = "RESOURCE_VERIFIED";
  if (!admission) {
    verdict = parsed.resourceAdmissionProvided ? "FAIL" : "UNAVAILABLE";
    reasonCode = parsed.resourceAdmissionProvided
      ? "RESOURCE_ESTIMATE_MISMATCH"
      : "RESOURCE_EXPLAIN_UNAVAILABLE";
  } else if (!policy) {
    verdict = "FAIL";
    reasonCode = "RESOURCE_LIMITS_MISSING";
  } else if (!parsed.compilation || !parsed.queryContract) {
    verdict = "UNAVAILABLE";
    reasonCode = "RESOURCE_EXPLAIN_UNAVAILABLE";
  } else if (!estimate) {
    verdict = "UNAVAILABLE";
    reasonCode = "RESOURCE_EXPLAIN_UNAVAILABLE";
  } else if (
    estimate.query_hash !== parsed.compilation.sql_artifact.query_hash ||
    estimate.datasource_id !== parsed.queryContract.datasource_id ||
    estimate.schema_version !== admission.expected_schema_version ||
    estimate.settings_hash !== admission.expected_settings_hash ||
    admission.expected_relation_names.length !== expectedRelationNames.length ||
    admission.expected_relation_names.some(
      (relationName, index) => relationName !== expectedRelationNames[index],
    ) ||
    estimate.relation_names.length !== admission.expected_relation_names.length ||
    estimate.relation_names.some(
      (relationName, index) => relationName !== admission.expected_relation_names[index],
    )
  ) {
    verdict = "FAIL";
    reasonCode = "RESOURCE_ESTIMATE_MISMATCH";
  } else if (
    estimate.has_cartesian_join ||
    estimate.node_types.some((nodeType) => policy.forbidden_node_types.includes(nodeType))
  ) {
    verdict = "FAIL";
    reasonCode = "RESOURCE_PLAN_SHAPE_FORBIDDEN";
  } else if (
    estimate.total_cost <= 0 ||
    estimate.plan_rows <= 0 ||
    estimate.plan_width <= 0 ||
    !Number.isSafeInteger(estimate.plan_rows * estimate.plan_width) ||
    plannedBytes <= 0 ||
    estimate.total_cost > policy.max_total_cost ||
    estimate.plan_rows > policy.max_plan_rows ||
    plannedBytes > policy.max_plan_bytes ||
    estimate.plan_rows > policy.max_rows ||
    plannedBytes > policy.max_bytes
  ) {
    verdict = "FAIL";
    reasonCode = "RESOURCE_BUDGET_EXCEEDED";
  }
  return createTrustedGateEvaluation(parsed.authority, {
    gate: "RESOURCE",
    sql_artifact_ref: parsed.sqlArtifactReference,
    execution_receipt_ref: null,
    evidence_refs: admission
      ? [parsed.sqlArtifactReference, admission.receipt.receipt_ref]
      : [parsed.sqlArtifactReference],
    verdict,
    reason_code: reasonCode,
    input_material: {
      query_hash: parsed.compilation?.sql_artifact.query_hash ?? null,
      estimate,
      policy,
      expected_schema_version: admission?.expected_schema_version ?? null,
      expected_settings_hash: admission?.expected_settings_hash ?? null,
      expected_relation_names: admission?.expected_relation_names ?? null,
    },
    observations: {
      estimate_hash: estimateHash,
      policy_version: policy?.policy_version ?? "UNAVAILABLE",
      total_cost: estimate?.total_cost ?? 0,
      plan_rows: estimate?.plan_rows ?? 0,
      plan_width: estimate?.plan_width ?? 0,
      planned_bytes: plannedBytes === Number.MAX_SAFE_INTEGER ? 0 : plannedBytes,
      timeout_ms: policy?.statement_timeout_ms ?? 0,
      lock_timeout_ms: policy?.lock_timeout_ms ?? 0,
      max_rows: policy?.max_rows ?? 0,
      max_bytes: policy?.max_bytes ?? 0,
      max_memory_mb: policy?.max_memory_mb ?? 0,
    },
  });
}

export async function evaluatePreExecutionGates(
  input: EvaluatePreExecutionGatesInput,
): Promise<PreExecutionGateSuite> {
  const parsed = parseInput(input);
  const planValidation = validatePlanLineage(parsed);
  const [intent, semantic, structural, policy, resource] = await Promise.all([
    evaluateIntent(parsed, planValidation),
    evaluateSemantic(parsed, planValidation),
    evaluateStructural(parsed),
    evaluatePolicy(parsed),
    evaluateResource(parsed),
  ]);
  const gates = [intent, semantic, structural, policy, resource] as const;
  return registerTrustedPreExecutionGateSuite(
    deepFreeze({
      state: "EVALUATED" as const,
      gates,
      permit_eligible: gates.every(({ verdict }) => verdict === "PASS"),
    }),
  );
}
