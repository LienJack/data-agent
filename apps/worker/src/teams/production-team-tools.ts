import {
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV2,
  artifactReferenceFor,
  artifactReferenceIdentity,
  buildProductTeamArtifactDocument,
  canonicalizeJson,
  type PortResult,
  type ProductTeamArtifactDocument,
  type QueryEvidenceSemanticBinding,
  sha256ContentHash,
  type Text2SqlQueryCandidate,
  text2sqlQueryCandidateSchema,
  text2sqlRepairContextSchema,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts";
import {
  buildSemanticQueryContext,
  type SemanticQueryContext,
  type SemanticQuerySelectionIntent,
  semanticQuerySelectionIntentSchema,
} from "@data-agent/contracts/artifacts";
import { buildQueryEvidenceChartDocument } from "@data-agent/platform/artifacts";
import { POSTGRESQL_REQUEST_DERIVATION_REPAIR_HINTS } from "@data-agent/platform/datasource-adapters";
import { z } from "zod";
import type { GovernedAgentAnalysisPort } from "../analysis/governed-agent-analysis-port.js";
import { hasRunProviderDispatchCapability } from "../runs/run-execution-context.js";
import type {
  FrozenSemanticReleaseCatalog,
  FrozenSemanticReleaseReadPort,
} from "../semantic/semantic-release-read-port.js";
import type {
  ProductProfileToolPort,
  ProductProfileToolResult,
} from "./mastra-profile-composition.js";
import type {
  PreparedText2SqlContext,
  Text2SqlQueryRuntimePort,
} from "./postgresql-text2sql-query-runtime.js";
import {
  type ProductionTeamToolFactoryInput,
  productionTeamRuntimeInternals,
} from "./production-team-runtime.js";
import { resolveReportEvidence } from "./report-evidence.js";

const reportAnswerSchema = z.strictObject({ answer: z.string().trim().min(1).max(20_000) });

export interface ProductionTeamArtifactPort {
  commit(
    capability: unknown,
    lease: ProductionTeamToolFactoryInput["lease"],
    document: ProductTeamArtifactDocument,
  ): Promise<PortResult<ArtifactReference>>;
  commitWorkspaceChart(
    capability: unknown,
    lease: ProductionTeamToolFactoryInput["lease"],
    document: ArtifactWorkspaceChartDocumentV2,
  ): Promise<PortResult<ArtifactReference>>;
  resolveCommitted(
    capability: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
}

export interface ProductionTeamToolsDependencies {
  readonly capability: unknown;
  readonly artifacts: ProductionTeamArtifactPort;
  readonly text2sql: Text2SqlQueryRuntimePort;
  readonly semantic_release: FrozenSemanticReleaseReadPort;
  readonly governed_analysis?: GovernedAgentAnalysisPort | null;
}

class ProductionTeamToolError extends Error {
  override readonly name = "ProductionTeamToolError";

  constructor(readonly code: string) {
    super(code);
  }
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new ProductionTeamToolError(result.error.code);
  return result.value;
}

function toolResult(
  outputRef: ArtifactReference | null,
  publicArtifactRefs: readonly ArtifactReference[] = outputRef ? [outputRef] : [],
): ProductProfileToolResult {
  return Object.freeze({ output_ref: outputRef, public_artifact_refs: publicArtifactRefs });
}

function committedAt(lease: ProductionTeamToolFactoryInput["lease"]): string {
  return new Date(Date.parse(lease.expires_at) - lease.lease_duration_ms).toISOString();
}

function visualizationIntent(
  candidate: Text2SqlQueryCandidate,
): "TREND" | "COMPARISON" | "COMPOSITION" | null {
  if (candidate.presentation.visualization === "LINE") return "TREND";
  if (candidate.presentation.visualization === "BAR") return "COMPARISON";
  if (candidate.presentation.visualization === "PIE") return "COMPOSITION";
  const xColumn = candidate.result_columns.find(({ semantic_type: type }) =>
    ["STRING", "DATE", "DATETIME"].includes(type),
  );
  const hasNumericColumn = candidate.result_columns.some(
    ({ semantic_type: type }) => type === "NUMBER",
  );
  if (xColumn && hasNumericColumn) {
    return ["DATE", "DATETIME"].includes(xColumn.semantic_type) ? "TREND" : "COMPARISON";
  }
  return null;
}

function projectionDataType(
  semanticType: Text2SqlQueryCandidate["result_columns"][number]["semantic_type"],
): "STRING" | "NUMBER" | "BOOLEAN" {
  if (semanticType === "NUMBER") return "NUMBER";
  if (semanticType === "BOOLEAN") return "BOOLEAN";
  return "STRING";
}

function normalizedQueryEvidenceRows(input: {
  readonly candidate: Text2SqlQueryCandidate;
  readonly binding: QueryEvidenceSemanticBinding;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}): Readonly<Record<string, string | number | boolean | null>>[] {
  const candidateNames = input.candidate.result_columns.map(({ name }) => name);
  const bindings = input.binding.columns;
  if (
    bindings.length !== candidateNames.length ||
    bindings.some(
      (binding, index) =>
        binding.output_name !== candidateNames[index] ||
        binding.logical_type !== input.candidate.result_columns[index]?.semantic_type,
    )
  ) {
    throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_BINDING_INVALID");
  }
  const expectedKeys = [...candidateNames].sort();
  return input.rows.map((row) => {
    const observedKeys = Object.keys(row).sort();
    if (
      observedKeys.length !== expectedKeys.length ||
      observedKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_COLUMN_INVALID");
    }
    return Object.fromEntries(
      bindings.map((binding) => {
        const value = row[binding.output_name];
        if (value === null) {
          if (!binding.nullable) {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_NULLABILITY_INVALID");
          }
          return [binding.output_name, null];
        }
        if (binding.logical_type === "NUMBER") {
          const integerString = typeof value === "string" && /^-?(?:0|[1-9]\d*)$/u.test(value);
          const numeric =
            typeof value === "number"
              ? value
              : typeof value === "string" &&
                  /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)
                ? Number(value)
                : Number.NaN;
          if (!Number.isFinite(numeric) || (integerString && !Number.isSafeInteger(numeric))) {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
          }
          return [binding.output_name, numeric];
        }
        if (binding.logical_type === "BOOLEAN") {
          if (typeof value !== "boolean") {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
          }
          return [binding.output_name, value];
        }
        if (typeof value !== "string") {
          throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
        }
        if (
          (binding.logical_type === "DATE" &&
            (!/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
              !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)))) ||
          (binding.logical_type === "DATETIME" && !Number.isFinite(Date.parse(value)))
        ) {
          throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
        }
        return [binding.output_name, value];
      }),
    );
  });
}

function specialistProviderLogicalCallId(input: {
  readonly run_id: string;
  readonly task_id: string;
  readonly stage: "SEMANTIC" | "TEXT2SQL" | "REPORT";
  readonly call_index: number;
}): string {
  return productionTeamRuntimeInternals.identity(
    input.run_id,
    [
      "specialist-provider-call@2",
      input.task_id,
      input.stage.toLowerCase(),
      String(input.call_index),
    ].join(":"),
  );
}

const ROOT_VISIBLE_TEXT2SQL_POLICY_CODES = new Set([
  ...Object.keys(POSTGRESQL_REQUEST_DERIVATION_REPAIR_HINTS),
  "TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH",
  "TEXT2SQL_SQL_TIME_COVERAGE_REQUIRED",
  "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED",
  "TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE",
  "TEXT2SQL_SEMANTIC_RESULT_BINDING_OUT_OF_RANGE",
  "TEXT2SQL_SEMANTIC_TIME_BINDING_OUT_OF_RANGE",
  "TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH",
  "QUERY_EVIDENCE_FORMULA_BINDING_INVALID",
  "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
  "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH",
  "TEXT2SQL_SQL_DANGEROUS",
  "TEXT2SQL_SQL_SHAPE_REJECTED",
  "TEXT2SQL_SQL_INPUT_REJECTED",
  "TEXT2SQL_SQL_PARAMETERIZATION_REJECTED",
  "TEXT2SQL_SQL_STATEMENT_SHAPE_REJECTED",
  "TEXT2SQL_SQL_SELECT_SHAPE_REJECTED",
  "TEXT2SQL_SQL_SELECT_KEYS_REJECTED",
  "TEXT2SQL_SQL_TARGET_LIST_REJECTED",
  "TEXT2SQL_SQL_LIMIT_SHAPE_REJECTED",
  "TEXT2SQL_SQL_SET_OPERATION_REJECTED",
  "TEXT2SQL_SQL_FROM_SHAPE_REJECTED",
  "TEXT2SQL_SQL_WITH_SHAPE_REJECTED",
  "TEXT2SQL_SQL_DISTINCT_SHAPE_REJECTED",
  "TEXT2SQL_SQL_CTE_SHAPE_REJECTED",
  "TEXT2SQL_SQL_RELATION_BINDING_REJECTED",
  "TEXT2SQL_SQL_RELATION_SET_DUPLICATE",
  "TEXT2SQL_SQL_RELATION_SHAPE_REJECTED",
  "TEXT2SQL_SQL_RELATION_ALIAS_REQUIRED",
  "TEXT2SQL_SQL_RELATION_UNQUALIFIED",
  "TEXT2SQL_SQL_RELATION_NOT_ALLOWED",
  "TEXT2SQL_SQL_JOIN_SHAPE_REJECTED",
  "TEXT2SQL_SQL_PROJECTION_SHAPE_REJECTED",
  "TEXT2SQL_SQL_PRIMITIVE_DENIED",
  "TEXT2SQL_SQL_AST_NODE_DENIED",
  "TEXT2SQL_SQL_FUNCTION_DENIED",
  "TEXT2SQL_SQL_OPERATOR_DENIED",
  "TEXT2SQL_SQL_CAST_DENIED",
  "TEXT2SQL_SQL_TARGET_ALIAS_REQUIRED",
  "TEXT2SQL_SQL_COLUMN_REFERENCE_REJECTED",
  "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED",
  "TEXT2SQL_SQL_LITERAL_POLICY_REJECTED",
  "TEXT2SQL_SQL_ORDERING_SHAPE_REJECTED",
  "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED",
]);

function text2SqlCandidateFailureCode(code: string | null): string {
  return code && ROOT_VISIBLE_TEXT2SQL_POLICY_CODES.has(code)
    ? code
    : "TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED";
}

function text2SqlCandidateDiagnosticCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "diagnostic_code" in error &&
    typeof error.diagnostic_code === "string" &&
    ROOT_VISIBLE_TEXT2SQL_POLICY_CODES.has(error.diagnostic_code)
  ) {
    return error.diagnostic_code;
  }
  return safeErrorCode(error, "TEXT2SQL_CANDIDATE_POLICY_REJECTED");
}

async function specialistProviderJson(input: {
  readonly factory: ProductionTeamToolFactoryInput;
  readonly task_id: string;
  readonly stage: "SEMANTIC" | "TEXT2SQL" | "REPORT";
  readonly context_text: string;
  readonly call_index?: number;
}): Promise<unknown> {
  const expectedProfile = {
    SEMANTIC: "semantic-management-agent",
    TEXT2SQL: "governed-text2sql-agent",
    REPORT: "report-writing-agent",
  } as const;
  const delegation = input.factory.delegation;
  if (!delegation) throw new ProductionTeamToolError("ROOT_AGENT_DELEGATION_REQUIRED");
  if (delegation.profile.revision.profile_id !== expectedProfile[input.stage]) {
    throw new ProductionTeamToolError("TEAM_SPECIALIST_STAGE_PROFILE_MISMATCH");
  }
  const provider = input.factory.execution_context.getProviderDispatchCapability();
  if (!hasRunProviderDispatchCapability(provider)) {
    throw new ProductionTeamToolError("PROVIDER_DISPATCH_AUTHORITY_NOT_CONFIGURED");
  }
  const result = portValue(
    await provider.invoke({
      logical_call_id: specialistProviderLogicalCallId({
        run_id: input.factory.lease.run_id,
        task_id: input.task_id,
        stage: input.stage,
        call_index: input.call_index ?? 0,
      }),
      turn: {
        kind: "SPECIALIST",
        stage: input.stage,
        profile_id: delegation.profile.revision.profile_id,
        objective: delegation.call.objective,
        context_text: input.context_text,
      },
    }),
  );
  try {
    return JSON.parse(result.output_text);
  } catch {
    throw new ProductionTeamToolError("TEAM_PROVIDER_RESPONSE_INVALID");
  }
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}

function repairableQueryExecutionFailure(code: string): boolean {
  return [
    "DATASOURCE_ADAPTER_EXECUTION_FAILED",
    "DATASOURCE_ADAPTER_SQL_COLUMN_NOT_FOUND",
    "DATASOURCE_ADAPTER_SQL_DATA_ERROR",
    "DATASOURCE_ADAPTER_SQL_GROUPING_ERROR",
    "DATASOURCE_ADAPTER_SQL_RELATION_NOT_FOUND",
    "DATASOURCE_ADAPTER_SQL_REJECTED",
    "DATASOURCE_ADAPTER_SQL_TYPE_ERROR",
    "QUERY_EVIDENCE_RESULT_BINDING_MISMATCH",
    "QUERY_EVIDENCE_SEMANTIC_OBJECT_NOT_SELECTED",
    "QUERY_EVIDENCE_TIME_WINDOW_OUT_OF_RANGE",
    "TEXT2SQL_RESULT_SHAPE_MISMATCH",
  ].includes(code);
}

function queryResultTypeFeedback(
  error: unknown,
  expectedColumnCount: number,
): readonly Text2SqlQueryCandidate["result_columns"][number]["semantic_type"][] | null {
  if (
    safeErrorCode(error, "") !== "QUERY_EVIDENCE_RESULT_BINDING_MISMATCH" ||
    typeof error !== "object" ||
    error === null ||
    !("observed_result_types" in error)
  ) {
    return null;
  }
  const parsed = z
    .array(text2sqlQueryCandidateSchema.shape.result_columns.element.shape.semantic_type)
    .length(expectedColumnCount)
    .safeParse(error.observed_result_types);
  return parsed.success ? parsed.data : null;
}

async function commitArtifact(
  dependencies: ProductionTeamToolsDependencies,
  factoryInput: ProductionTeamToolFactoryInput,
  input: {
    readonly artifact_type:
      | "SqlArtifact"
      | "QueryEvidence"
      | "AnalysisReport"
      | "SemanticQueryContext";
    readonly profile_id:
      | "governed-analysis-agent"
      | "governed-text2sql-agent"
      | "report-writing-agent"
      | "semantic-management-agent";
    readonly task_id: string;
    readonly source_refs: readonly ArtifactReference[];
    readonly provenance: ProductTeamArtifactDocument["provenance"];
    readonly projection: ProductTeamArtifactDocument["projection"];
  },
): Promise<ArtifactReference> {
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: productionTeamRuntimeInternals.identity(
        factoryInput.lease.run_id,
        `artifact:${input.task_id}:${input.artifact_type}`,
      ),
      artifact_type: input.artifact_type,
      ...factoryInput.lease.scope,
      run_id: factoryInput.lease.run_id,
      revision: 1,
      content_hash: `sha256:${"0".repeat(64)}`,
    },
    profile_id: input.profile_id,
    task_id: input.task_id,
    source_refs: input.source_refs,
    provenance: input.provenance,
    projection: input.projection,
    committed_at: committedAt(factoryInput.lease),
  });
  return portValue(
    await dependencies.artifacts.commit(dependencies.capability, factoryInput.lease, document),
  );
}

function stringCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function semanticSelectionIds(intent: SemanticQuerySelectionIntent): readonly string[] {
  return [
    ...intent.selected_metric_ids,
    ...intent.selected_dimension_ids,
    ...intent.selected_formula_ids,
    ...intent.selected_relationship_ids,
    ...intent.selected_time_domain_ids,
    ...intent.selected_quality_constraint_ids,
    ...intent.unresolved_ambiguities.flatMap(({ candidate_ids: candidateIds }) => candidateIds),
  ].sort(stringCompare);
}

async function buildRequestScopedInterpretations(input: {
  readonly run_id: string;
  readonly intent: SemanticQuerySelectionIntent;
  readonly metric_names: ReadonlyMap<string, string>;
  readonly dimension_names: ReadonlyMap<string, string>;
}) {
  const operations = input.intent.request_scoped_operations ?? [];
  const interpretations = await Promise.all(
    operations.map(async (operation) => {
      const operator = operation.operator;
      const sourceObjectIds = (
        operator.kind !== "AGGREGATE_RATIO"
          ? [operator.metric_id, operator.time_dimension_id]
          : [operator.denominator_metric_id, operator.numerator_metric_id]
      ).sort(stringCompare);
      let userExplanation: string;
      if (operator.kind === "RECENT_COMPLETE_PERIODS") {
        const metricName = input.metric_names.get(operator.metric_id);
        const dimensionName = input.dimension_names.get(operator.time_dimension_id);
        if (!metricName || !dimensionName)
          throw new ProductionTeamToolError("TEAM_REQUEST_SCOPED_INTERPRETATION_INVALID");
        userExplanation = `${operation.requested_term}使用${metricName}的已发布完整月份上界，以${dimensionName}向前计算${operator.period_count}个完整日历月；服务端计算半开区间，不使用运行时日期、不缩短月份数量，也不发布全局定义。`;
      } else if (operator.kind === "PERIOD_COMPARISON_RATE") {
        const metricName = input.metric_names.get(operator.metric_id);
        const dimensionName = input.dimension_names.get(operator.time_dimension_id);
        if (!metricName || !dimensionName) {
          throw new ProductionTeamToolError("TEAM_REQUEST_SCOPED_INTERPRETATION_INVALID");
        }
        userExplanation = `${operation.requested_term}按${dimensionName}汇总${metricName}后，与上年同期比较，计算公式为（本期值-上年同期值）/上年同期值；上年同期值为0时返回空值。该解释只用于当前请求，不会发布为全局语义定义。`;
      } else {
        const numeratorName = input.metric_names.get(operator.numerator_metric_id);
        const denominatorName = input.metric_names.get(operator.denominator_metric_id);
        if (!numeratorName || !denominatorName) {
          throw new ProductionTeamToolError("TEAM_REQUEST_SCOPED_INTERPRETATION_INVALID");
        }
        userExplanation =
          operator.numerator_adjustment === "SUBTRACT_DENOMINATOR"
            ? `${operation.requested_term}先分别汇总${numeratorName}与${denominatorName}，再按（${numeratorName}-${denominatorName}）/${denominatorName}计算；分母为0时返回空值。该解释只用于当前请求，不会发布为全局语义定义。`
            : `${operation.requested_term}先分别汇总${numeratorName}与${denominatorName}，再按${numeratorName}/${denominatorName}计算；分母为0时返回空值。该解释只用于当前请求，不会发布为全局语义定义。`;
      }
      const operationHash = await sha256ContentHash({
        hash_domain: "request-scoped-semantic-interpretation@1.0.0",
        run_id: input.run_id,
        requested_term: operation.requested_term,
        operator,
      });
      return {
        interpretation_id: `request-scoped.${operationHash.slice("sha256:".length, 39)}`,
        requested_term: operation.requested_term,
        scope: "REQUEST_ONLY" as const,
        source_object_ids: sourceObjectIds,
        operator,
        user_explanation: userExplanation,
        publication_effect: "NONE" as const,
      };
    }),
  );
  return interpretations.sort((left, right) =>
    stringCompare(left.interpretation_id, right.interpretation_id),
  );
}

function requiredSemanticObject<T>(
  objects: ReadonlyMap<string, T>,
  id: string,
  errorCode: string,
): T {
  const value = objects.get(id);
  if (!value) throw new ProductionTeamToolError(errorCode);
  return value;
}

function projectSemanticSpecialistCatalog(input: {
  readonly catalog: FrozenSemanticReleaseCatalog;
  readonly retrieval: ProductionTeamToolFactoryInput["semantic_context_package"]["retrieval_receipt"];
  readonly inference: ProductionTeamToolFactoryInput["semantic_context_package"]["inference_receipt"];
}) {
  const allowedObjectIds = new Set([
    ...input.retrieval.selected_object_ids,
    ...input.inference.mandatory_object_ids,
  ]);
  const allowedRelationshipIds = new Set([
    ...allowedObjectIds,
    ...input.inference.mandatory_relationship_ids,
  ]);
  const metrics = input.catalog.executable.metrics.filter((metric) =>
    allowedObjectIds.has(metric.metric_id),
  );
  const dimensions = input.catalog.executable.dimensions.filter((dimension) =>
    allowedObjectIds.has(dimension.dimension_id),
  );
  const formulaIds = new Set(
    input.catalog.executable.formulas
      .filter((formula) => allowedObjectIds.has(formula.node_id))
      .map((formula) => formula.node_id),
  );
  const timeDomainIds = new Set(allowedObjectIds);
  for (const metric of metrics) {
    if (metric.formula) formulaIds.add(metric.formula.formula_id);
    if (metric.time_domain) timeDomainIds.add(metric.time_domain.time_domain_id);
  }

  return Object.freeze({
    metrics,
    dimensions,
    formulas: input.catalog.executable.formulas.filter((formula) =>
      formulaIds.has(formula.node_id),
    ),
    relationships: input.catalog.relationships.relationships.filter((relationship) =>
      allowedRelationshipIds.has(relationship.relationship_id),
    ),
    restrictions: Object.freeze({
      ...input.catalog.restrictions,
      quality_constraints: input.catalog.restrictions.quality_constraints.filter((constraint) =>
        allowedObjectIds.has(constraint.constraint_id),
      ),
      time_semantics: input.catalog.restrictions.time_semantics.filter((timeDomain) =>
        timeDomainIds.has(timeDomain.time_domain_id),
      ),
    }),
  });
}

async function projectSemanticQueryContext(input: {
  readonly factory: ProductionTeamToolFactoryInput;
  readonly catalog: FrozenSemanticReleaseCatalog;
  readonly intent: SemanticQuerySelectionIntent;
}): Promise<SemanticQueryContext> {
  const packageDocument = input.factory.semantic_context_package;
  const allowedObjectIds = new Set([
    ...packageDocument.retrieval_receipt.selected_object_ids,
    ...packageDocument.inference_receipt.mandatory_object_ids,
  ]);
  const allowedRelationshipIds = new Set(
    packageDocument.inference_receipt.mandatory_relationship_ids,
  );
  const metricById = new Map(
    input.catalog.executable.metrics.map((metric) => [metric.metric_id, metric]),
  );
  const dimensionById = new Map(
    input.catalog.executable.dimensions.map((dimension) => [dimension.dimension_id, dimension]),
  );
  const formulaById = new Map(
    input.catalog.executable.formulas.map((formula) => [formula.node_id, formula]),
  );
  const relationshipById = new Map(
    input.catalog.relationships.relationships.map((relationship) => [
      relationship.relationship_id,
      relationship,
    ]),
  );
  const timeDomainById = new Map(
    input.catalog.restrictions.time_semantics.map((timeDomain) => [
      timeDomain.time_domain_id,
      timeDomain,
    ]),
  );
  const qualityById = new Map(
    input.catalog.restrictions.quality_constraints.map((constraint) => [
      constraint.constraint_id,
      constraint,
    ]),
  );

  const assertSelected = (
    ids: readonly string[],
    available: ReadonlyMap<string, unknown>,
    allowed: ReadonlySet<string>,
  ): void => {
    if (ids.some((id) => !allowed.has(id) || !available.has(id))) {
      throw new ProductionTeamToolError("TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE");
    }
  };
  assertSelected(input.intent.selected_metric_ids, metricById, allowedObjectIds);
  assertSelected(input.intent.selected_dimension_ids, dimensionById, allowedObjectIds);
  assertSelected(input.intent.selected_formula_ids, formulaById, allowedObjectIds);
  assertSelected(
    input.intent.selected_relationship_ids,
    relationshipById,
    new Set([...allowedObjectIds, ...allowedRelationshipIds]),
  );
  const allowedTimeDomainIds = new Set(allowedObjectIds);
  for (const metricId of input.intent.selected_metric_ids) {
    const timeDomainId = metricById.get(metricId)?.time_domain?.time_domain_id;
    if (timeDomainId) allowedTimeDomainIds.add(timeDomainId);
  }
  assertSelected(input.intent.selected_time_domain_ids, timeDomainById, allowedTimeDomainIds);
  assertSelected(input.intent.selected_quality_constraint_ids, qualityById, allowedObjectIds);
  for (const ambiguity of input.intent.unresolved_ambiguities) {
    const available = {
      DIMENSION: dimensionById,
      FORMULA: formulaById,
      METRIC: metricById,
      QUALITY: qualityById,
      RELATIONSHIP: relationshipById,
      TIME: timeDomainById,
    }[ambiguity.object_kind];
    const allowed =
      ambiguity.object_kind === "RELATIONSHIP"
        ? new Set([...allowedObjectIds, ...allowedRelationshipIds])
        : allowedObjectIds;
    if (ambiguity.candidate_ids.some((id) => !allowed.has(id) || !available.has(id))) {
      throw new ProductionTeamToolError("TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE");
    }
  }

  const metrics = input.intent.selected_metric_ids.map((id) =>
    requiredSemanticObject(metricById, id, "TEAM_SEMANTIC_METRIC_CLOSURE_INVALID"),
  );
  const selectedDimensionIds = new Set(input.intent.selected_dimension_ids);
  for (let changed = true; changed; ) {
    changed = false;
    for (const dimensionId of [...selectedDimensionIds]) {
      const parentId = dimensionById.get(dimensionId)?.parent_dimension_id;
      if (parentId && !selectedDimensionIds.has(parentId)) {
        if (!dimensionById.has(parentId)) {
          throw new ProductionTeamToolError("TEAM_SEMANTIC_DIMENSION_CLOSURE_INVALID");
        }
        selectedDimensionIds.add(parentId);
        changed = true;
      }
    }
  }
  const dimensions = [...selectedDimensionIds]
    .map((id) =>
      requiredSemanticObject(dimensionById, id, "TEAM_SEMANTIC_DIMENSION_CLOSURE_INVALID"),
    )
    .sort((left, right) => stringCompare(left.dimension_id, right.dimension_id));
  const selectedFormulaIds = new Set(input.intent.selected_formula_ids);
  for (const metric of metrics) {
    if (metric.formula) selectedFormulaIds.add(metric.formula.formula_id);
  }
  const formulas = [...selectedFormulaIds]
    .map((id) => formulaById.get(id))
    .filter((formula): formula is NonNullable<typeof formula> => formula !== undefined)
    .sort((left, right) => stringCompare(left.node_id, right.node_id));
  if (formulas.length !== selectedFormulaIds.size) {
    throw new ProductionTeamToolError("TEAM_SEMANTIC_FORMULA_CLOSURE_INVALID");
  }
  const relationshipIds = new Set([
    ...input.intent.selected_relationship_ids,
    ...packageDocument.inference_receipt.mandatory_relationship_ids.filter((id) =>
      relationshipById.has(id),
    ),
  ]);
  const relationships = [...relationshipIds]
    .map((id) =>
      requiredSemanticObject(relationshipById, id, "TEAM_SEMANTIC_RELATIONSHIP_CLOSURE_INVALID"),
    )
    .sort((left, right) => stringCompare(left.relationship_id, right.relationship_id));
  const selectedTimeIds = new Set(input.intent.selected_time_domain_ids);
  for (const metric of metrics) {
    if (metric.time_domain) selectedTimeIds.add(metric.time_domain.time_domain_id);
  }
  const timeSemantics = [...selectedTimeIds]
    .map((id) => timeDomainById.get(id))
    .filter((timeDomain): timeDomain is NonNullable<typeof timeDomain> => timeDomain !== undefined)
    .sort((left, right) => stringCompare(left.time_domain_id, right.time_domain_id));
  if (timeSemantics.length !== selectedTimeIds.size) {
    throw new ProductionTeamToolError("TEAM_SEMANTIC_TIME_CLOSURE_INVALID");
  }
  const qualityConstraints = input.intent.selected_quality_constraint_ids.map((id) =>
    requiredSemanticObject(qualityById, id, "TEAM_SEMANTIC_QUALITY_CLOSURE_INVALID"),
  );
  const requestScopedInterpretations = await buildRequestScopedInterpretations({
    run_id: input.factory.lease.run_id,
    intent: input.intent,
    metric_names: new Map(metrics.map((metric) => [metric.metric_id, metric.name])),
    dimension_names: new Map(
      dimensions.map((dimension) => [dimension.dimension_id, dimension.name]),
    ),
  });

  const relevantBindingIds = new Set<string>([
    ...metrics.flatMap((metric) => [
      metric.metric_id,
      metric.table_id,
      metric.column_id,
      ...metric.dependency_column_ids,
      ...(metric.time_column_id ? [metric.time_column_id] : []),
    ]),
    ...dimensions.flatMap((dimension) => [
      dimension.dimension_id,
      dimension.table_id,
      dimension.column_id,
    ]),
    ...formulas.map(({ node_id: id }) => id),
    ...relationships.flatMap((relationship) => [
      relationship.relationship_id,
      relationship.left_table_id,
      relationship.right_table_id,
      ...relationship.left_column_ids,
      ...relationship.right_column_ids,
    ]),
  ]);
  const physicalBindings = input.catalog.executable.physical_bindings
    .filter((binding) => relevantBindingIds.has(binding.logical_object_id))
    .sort((left, right) =>
      stringCompare(
        [
          left.logical_object_id,
          left.logical_object_type,
          left.schema_name,
          left.table_name,
          left.column_name ?? "",
        ].join("\0"),
        [
          right.logical_object_id,
          right.logical_object_type,
          right.schema_name,
          right.table_name,
          right.column_name ?? "",
        ].join("\0"),
      ),
    );

  const effectiveConfig = input.factory.execution_context.getEffectiveConfig();
  if (
    packageDocument.scope.app_id !== input.factory.lease.scope.app_id ||
    packageDocument.scope.tenant_id !== input.factory.lease.scope.tenant_id ||
    packageDocument.scope.environment !== input.factory.lease.scope.environment ||
    input.catalog.release_identity.release_id !== packageDocument.semantic_release.resource_id ||
    input.catalog.release_identity.release_digest !==
      packageDocument.semantic_release.resource_hash ||
    input.catalog.release_identity.release_generation !==
      packageDocument.semantic_release.semantic_generation ||
    input.catalog.release_identity.datasource_id !== effectiveConfig.datasource.resource_id
  ) {
    throw new ProductionTeamToolError("TEAM_SEMANTIC_AUTHORITY_BINDING_INVALID");
  }

  return buildSemanticQueryContext({
    schema_version: "semantic-query-context@1.0.0",
    answer_scope: input.intent.answer_scope,
    scope: input.factory.lease.scope,
    run_id: input.factory.lease.run_id,
    semantic_domain: packageDocument.semantic_domain,
    semantic_release: packageDocument.semantic_release,
    schema_snapshot: packageDocument.schema_snapshot,
    datasource: effectiveConfig.datasource,
    semantic_context_ref: {
      package_id: input.factory.semantic_context_ref.package_id,
      package_hash: input.factory.semantic_context_ref.package_hash,
      receipt_id: input.factory.semantic_context_ref.receipt_id,
      receipt_hash: input.factory.semantic_context_ref.receipt_hash,
      retrieval_receipt_hash: packageDocument.retrieval_receipt.receipt_hash,
      inference_receipt_hash: packageDocument.inference_receipt.receipt_hash,
    },
    requested_object_ids: semanticSelectionIds(input.intent),
    metrics: [...metrics].sort((left, right) => stringCompare(left.metric_id, right.metric_id)),
    dimensions,
    formulas,
    relationships,
    physical_bindings: physicalBindings,
    time_semantics: timeSemantics,
    quality_constraints: qualityConstraints,
    unresolved_ambiguities: input.intent.unresolved_ambiguities,
    ...(requestScopedInterpretations.length > 0
      ? { request_scoped_interpretations: requestScopedInterpretations }
      : {}),
  });
}

async function resolveAcceptedSemanticQueryContext(
  dependencies: ProductionTeamToolsDependencies,
  factoryInput: ProductionTeamToolFactoryInput,
): Promise<SemanticQueryContext | null> {
  const reference = factoryInput.accepted_semantic_query_context_ref;
  if (!reference) return null;
  const parsedReference = artifactReferenceFor("SemanticQueryContext").safeParse(reference);
  if (!parsedReference.success) {
    throw new ProductionTeamToolError("TEAM_ACCEPTED_SEMANTIC_CONTEXT_REF_INVALID");
  }
  const resolved = portValue(
    await dependencies.artifacts.resolveCommitted(dependencies.capability, parsedReference.data),
  );
  if (!resolved) {
    throw new ProductionTeamToolError("TEAM_ACCEPTED_SEMANTIC_CONTEXT_NOT_COMMITTED");
  }
  let document: ProductTeamArtifactDocument;
  try {
    document = await verifyProductTeamArtifactDocument(resolved);
  } catch {
    throw new ProductionTeamToolError("TEAM_ACCEPTED_SEMANTIC_CONTEXT_INVALID");
  }
  if (
    artifactReferenceIdentity(document.artifact_ref) !==
      artifactReferenceIdentity(parsedReference.data) ||
    document.artifact_ref.artifact_type !== "SemanticQueryContext" ||
    document.profile_id !== "semantic-management-agent" ||
    document.projection.kind !== "SEMANTIC_CONTEXT"
  ) {
    throw new ProductionTeamToolError("TEAM_ACCEPTED_SEMANTIC_CONTEXT_CORRELATION_INVALID");
  }
  const context = document.projection.context;
  const config = factoryInput.execution_context.getEffectiveConfig();
  const packageDocument = factoryInput.semantic_context_package;
  if (
    context.run_id !== factoryInput.lease.run_id ||
    context.scope.app_id !== factoryInput.lease.scope.app_id ||
    context.scope.tenant_id !== factoryInput.lease.scope.tenant_id ||
    context.scope.environment !== factoryInput.lease.scope.environment ||
    context.semantic_domain !== packageDocument.semantic_domain ||
    context.semantic_release.resource_id !== config.semantic_release.resource_id ||
    context.semantic_release.resource_revision !== config.semantic_release.resource_revision ||
    context.semantic_release.resource_hash !== config.semantic_release.resource_hash ||
    context.semantic_release.datasource_id !== config.semantic_release.datasource_id ||
    context.semantic_release.semantic_generation !== config.semantic_release.semantic_generation ||
    context.datasource.resource_id !== config.datasource.resource_id ||
    context.datasource.resource_revision !== config.datasource.resource_revision ||
    context.datasource.resource_hash !== config.datasource.resource_hash ||
    context.schema_snapshot.resource_id !== config.schema_snapshot.resource_id ||
    context.schema_snapshot.resource_revision !== config.schema_snapshot.resource_revision ||
    context.schema_snapshot.resource_hash !== config.schema_snapshot.resource_hash ||
    context.schema_snapshot.datasource_id !== config.schema_snapshot.datasource_id ||
    context.schema_snapshot.semantic_release_id !== config.schema_snapshot.semantic_release_id ||
    context.schema_snapshot.semantic_generation !== config.schema_snapshot.semantic_generation ||
    context.semantic_context_ref.package_id !== factoryInput.semantic_context_ref.package_id ||
    context.semantic_context_ref.package_hash !== factoryInput.semantic_context_ref.package_hash ||
    context.semantic_context_ref.receipt_id !== factoryInput.semantic_context_ref.receipt_id ||
    context.semantic_context_ref.receipt_hash !== factoryInput.semantic_context_ref.receipt_hash ||
    context.semantic_context_ref.retrieval_receipt_hash !==
      packageDocument.retrieval_receipt.receipt_hash ||
    context.semantic_context_ref.inference_receipt_hash !==
      packageDocument.inference_receipt.receipt_hash
  ) {
    throw new ProductionTeamToolError("TEAM_ACCEPTED_SEMANTIC_CONTEXT_BINDING_STALE");
  }
  return context;
}

export function createProductionTeamTools(
  dependencies: ProductionTeamToolsDependencies,
  factoryInput: ProductionTeamToolFactoryInput,
): ProductProfileToolPort {
  const maxText2SqlCandidateAttempts =
    factoryInput.lease.execution_policy.max_text2sql_candidate_attempts;
  const state: {
    prepared: PreparedText2SqlContext | null;
    candidate: Text2SqlQueryCandidate | null;
    sql_ref: ArtifactReference | null;
    semantic_ref: ArtifactReference | null;
    provider_attempt_count: number;
    rejected_candidate: Text2SqlQueryCandidate | null;
    rejection_code: string | null;
    observed_result_types: ReturnType<typeof queryResultTypeFeedback>;
  } = {
    prepared: null,
    candidate: null,
    sql_ref: null,
    semantic_ref: null,
    provider_attempt_count: 0,
    rejected_candidate: null,
    rejection_code: null,
    observed_result_types: null,
  };

  const recordCandidateRejection = async (
    taskId: string,
    stage: "COMPILE" | "EXECUTE",
    candidate: Text2SqlQueryCandidate,
    code: string,
    observedResultTypes: ReturnType<typeof queryResultTypeFeedback> = null,
  ): Promise<void> => {
    const context = factoryInput.execution_context;
    if (!context.emitDisplayEvent) return;
    const reasonCode =
      ROOT_VISIBLE_TEXT2SQL_POLICY_CODES.has(code) || repairableQueryExecutionFailure(code)
        ? code
        : "TEAM_TEXT2SQL_CANDIDATE_REJECTED";
    portValue(
      await context.emitDisplayEvent({
        kind: "progress",
        key: `text2sql.rejected:${taskId}:${stage}:${state.provider_attempt_count}`,
        phase: "text2sql.candidate.rejected",
        title: "SQL 候选校验未通过",
        status: "COMPLETED",
        summary: canonicalizeJson({
          stage,
          attempt: state.provider_attempt_count,
          reason_code: reasonCode,
          candidate_hash: await sha256ContentHash(candidate),
          parameter_types: candidate.parameters.map((value) =>
            value === null ? "null" : typeof value,
          ),
          result_types: candidate.result_columns.map((column) => column.semantic_type),
          ...(observedResultTypes ? { observed_result_types: observedResultTypes } : {}),
        }),
      }),
    );
  };

  const generateValidatedText2SqlCandidate = async (
    taskId: string,
  ): Promise<Text2SqlQueryCandidate> => {
    if (!state.prepared) throw new ProductionTeamToolError("TEAM_TEXT2SQL_CONTEXT_REQUIRED");
    while (state.provider_attempt_count < maxText2SqlCandidateAttempts) {
      const callIndex = state.provider_attempt_count;
      const contextText =
        callIndex === 0
          ? state.prepared.context_text
          : canonicalizeJson(
              text2sqlRepairContextSchema.parse({
                schema_version: "text2sql-repair-context@1.0.0",
                frozen_query_context: JSON.parse(state.prepared.context_text) as z.infer<
                  ReturnType<typeof z.json>
                >,
                rejection: {
                  attempt: callIndex,
                  diagnostic_code: state.rejection_code ?? "TEXT2SQL_CANDIDATE_POLICY_REJECTED",
                  rejected_candidate: state.rejected_candidate,
                  ...(state.observed_result_types
                    ? { observed_result_types: state.observed_result_types }
                    : {}),
                },
              }),
            );
      const parsed = text2sqlQueryCandidateSchema.safeParse(
        await specialistProviderJson({
          factory: factoryInput,
          task_id: taskId,
          stage: "TEXT2SQL",
          context_text: contextText,
          call_index: callIndex,
        }),
      );
      state.provider_attempt_count += 1;
      if (!parsed.success) {
        throw new ProductionTeamToolError("TEAM_TEXT2SQL_CANDIDATE_INVALID");
      }
      try {
        const compiled = await dependencies.text2sql.compileCandidate({
          prepared: state.prepared,
          candidate: parsed.data,
        });
        state.candidate = compiled;
        state.rejected_candidate = null;
        state.rejection_code = null;
        state.observed_result_types = null;
        return compiled;
      } catch (error) {
        state.rejected_candidate = parsed.data;
        state.rejection_code = text2SqlCandidateDiagnosticCode(error);
        state.observed_result_types = null;
        await recordCandidateRejection(taskId, "COMPILE", parsed.data, state.rejection_code);
        if (state.provider_attempt_count >= maxText2SqlCandidateAttempts) {
          throw new ProductionTeamToolError(text2SqlCandidateFailureCode(state.rejection_code));
        }
      }
    }
    throw new ProductionTeamToolError("TEAM_TEXT2SQL_CANDIDATE_REPAIR_EXHAUSTED");
  };

  return Object.freeze({
    async invoke(input: Parameters<ProductProfileToolPort["invoke"]>[0]) {
      if (
        input.profile.revision.profile_id !== input.task.profile_id ||
        input.task.run_id !== factoryInput.lease.run_id
      ) {
        throw new ProductionTeamToolError("TEAM_TOOL_TASK_CORRELATION_INVALID");
      }

      if (input.task.profile_id === "semantic-management-agent") {
        if (input.tool_id !== "semantic.catalog.read") {
          throw new ProductionTeamToolError("SEMANTIC_AGENT_TOOL_DENIED");
        }
        const catalog = portValue(
          await dependencies.semantic_release.read({
            capability: dependencies.capability,
            package: factoryInput.semantic_context_package,
          }),
        );
        const packageDocument = factoryInput.semantic_context_package;
        const retrieval = packageDocument.retrieval_receipt;
        const inference = packageDocument.inference_receipt;
        const specialistCatalog = projectSemanticSpecialistCatalog({
          catalog,
          retrieval,
          inference,
        });
        const semanticSelection = semanticQuerySelectionIntentSchema.safeParse(
          await specialistProviderJson({
            factory: factoryInput,
            task_id: input.task.task_id,
            stage: "SEMANTIC",
            context_text: canonicalizeJson({
              release_identity: catalog.release_identity,
              route_decision: packageDocument.route_decision,
              retrieval: {
                route_states: retrieval.route_states,
                hits: retrieval.hits,
                expansions: retrieval.expansions,
                selected_object_ids: retrieval.selected_object_ids,
                pruned_object_count: retrieval.pruned_object_ids.length,
              },
              inference,
              metrics: specialistCatalog.metrics,
              dimensions: specialistCatalog.dimensions,
              formulas: specialistCatalog.formulas,
              relationships: specialistCatalog.relationships,
              restrictions: specialistCatalog.restrictions,
            }),
          }),
        );
        if (!semanticSelection.success) {
          throw new ProductionTeamToolError("TEAM_SEMANTIC_RESPONSE_INVALID");
        }
        const semanticContext = await projectSemanticQueryContext({
          factory: factoryInput,
          catalog,
          intent: semanticSelection.data,
        });
        state.semantic_ref = await commitArtifact(dependencies, factoryInput, {
          artifact_type: "SemanticQueryContext",
          profile_id: "semantic-management-agent",
          task_id: input.task.task_id,
          source_refs: [],
          provenance: null,
          projection: {
            kind: "SEMANTIC_CONTEXT",
            context: semanticContext,
          },
        });
        return toolResult(state.semantic_ref);
      }

      if (input.task.profile_id === "governed-analysis-agent") {
        if (input.tool_id !== "analysis.program.execute") {
          throw new ProductionTeamToolError("GOVERNED_ANALYSIS_AGENT_TOOL_DENIED");
        }
        const analysis = dependencies.governed_analysis;
        if (!analysis) {
          throw new ProductionTeamToolError("GOVERNED_ANALYSIS_RUNTIME_REQUIRED");
        }
        const evidenceRef = artifactReferenceFor("QueryEvidence").safeParse(
          factoryInput.accepted_evidence_ref,
        );
        if (!evidenceRef.success) {
          throw new ProductionTeamToolError("TEAM_ACCEPTED_QUERY_EVIDENCE_REQUIRED");
        }
        const provider = factoryInput.execution_context.getProviderDispatchCapability();
        if (!hasRunProviderDispatchCapability(provider)) {
          throw new ProductionTeamToolError("PROVIDER_DISPATCH_AUTHORITY_NOT_CONFIGURED");
        }
        const result = await analysis.analyze({
          lease: factoryInput.lease,
          authority: factoryInput.authority,
          task_id: input.task.task_id,
          max_context_bytes: input.task.bounds.max_context_bytes,
          accepted_query_evidence_ref: evidenceRef.data,
          question:
            factoryInput.delegation?.call.objective ?? "Analyze the accepted QueryEvidence.",
          semantic_context: factoryInput.semantic_context,
          effective_config: factoryInput.execution_context.getEffectiveConfig(),
          provider_dispatch: provider,
          fence_guard: {
            async isCurrent(fence) {
              if (
                fence.run_id !== factoryInput.lease.run_id ||
                fence.attempt_id !== factoryInput.lease.attempt_id ||
                fence.worker_fence !== factoryInput.lease.worker_fence ||
                fence.fence_token !==
                  `${factoryInput.lease.attempt_id}:${factoryInput.lease.worker_fence}`
              ) {
                return false;
              }
              return (await factoryInput.execution_context.heartbeat()).ok;
            },
          },
        });
        const derivedEvidence = result.accepted_artifact_refs.find(
          ({ artifact_type: artifactType }) => artifactType === "DerivedAnalysisEvidence",
        );
        const chart = result.public_artifact_refs.find(
          ({ artifact_type: artifactType }) => artifactType === "ArtifactWorkspaceDocument",
        );
        const reportRef = result.accepted_artifact_refs.find(
          ({ artifact_type: artifactType }) => artifactType === "AnalysisReport",
        );
        if (!derivedEvidence || !chart || !reportRef) {
          throw new ProductionTeamToolError("GOVERNED_ANALYSIS_EVIDENCE_CLOSURE_REQUIRED");
        }
        return toolResult(reportRef, [chart, reportRef]);
      }

      if (input.task.profile_id === "governed-text2sql-agent") {
        if (input.tool_id === "semantic.release.read") {
          const semanticQueryContext = await resolveAcceptedSemanticQueryContext(
            dependencies,
            factoryInput,
          );
          const semanticCatalog = portValue(
            await dependencies.semantic_release.read({
              capability: dependencies.capability,
              package: factoryInput.semantic_context_package,
            }),
          );
          state.prepared = await dependencies.text2sql.prepare({
            effective_config: factoryInput.execution_context.getEffectiveConfig(),
            semantic_context: factoryInput.semantic_context,
            semantic_catalog: semanticCatalog,
            semantic_query_context: semanticQueryContext,
            max_context_bytes: input.task.bounds.max_context_bytes,
          });
          return toolResult(null);
        }
        if (input.tool_id === "sql.compiler.compile") {
          await generateValidatedText2SqlCandidate(input.task.task_id);
          return toolResult(null);
        }
        if (input.tool_id === "sql.sandbox.execute") {
          if (!state.prepared || !state.candidate) {
            throw new ProductionTeamToolError("TEAM_TEXT2SQL_COMPILE_REQUIRED");
          }
          const executeCandidate = async (candidate: Text2SqlQueryCandidate) => {
            try {
              return await dependencies.text2sql.execute({
                effective_config: factoryInput.execution_context.getEffectiveConfig(),
                prepared: state.prepared as PreparedText2SqlContext,
                candidate,
                timeout_ms: Math.max(100, Math.min(30_000, input.task.bounds.timeout_ms)),
                max_rows: 10_000,
                max_bytes: Math.min(10_000_000, input.task.bounds.max_context_bytes * 64),
                ...(input.signal ? { signal: input.signal } : {}),
              });
            } catch (error) {
              await recordCandidateRejection(
                input.task.task_id,
                "EXECUTE",
                candidate,
                safeErrorCode(error, "TEXT2SQL_QUERY_EXECUTION_FAILED"),
                queryResultTypeFeedback(error, candidate.result_columns.length),
              );
              throw error;
            }
          };
          let execution: Awaited<ReturnType<typeof executeCandidate>>;
          try {
            execution = await executeCandidate(state.candidate);
          } catch (error) {
            const code = safeErrorCode(error, "TEXT2SQL_QUERY_EXECUTION_FAILED");
            if (
              state.provider_attempt_count >= maxText2SqlCandidateAttempts ||
              !repairableQueryExecutionFailure(code)
            ) {
              throw error;
            }
            state.rejected_candidate = state.candidate;
            state.rejection_code = code;
            state.observed_result_types = queryResultTypeFeedback(
              error,
              state.candidate.result_columns.length,
            );
            state.candidate = await generateValidatedText2SqlCandidate(input.task.task_id);
            execution = await executeCandidate(state.candidate);
          }
          const result = execution.result;
          const columns = state.candidate.result_columns.map((column) => ({
            key: column.name,
            label: column.label,
            data_type: projectionDataType(column.semantic_type),
          }));
          const rows = normalizedQueryEvidenceRows({
            candidate: state.candidate,
            binding: execution.semantic_binding,
            rows: result.rows,
          });
          const effectiveConfig = factoryInput.execution_context.getEffectiveConfig();
          const [candidateHash, parametersHash] = await Promise.all([
            sha256ContentHash(state.candidate),
            sha256ContentHash(state.candidate.parameters),
          ]);
          state.sql_ref = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "SqlArtifact",
            profile_id: "governed-text2sql-agent",
            task_id: input.task.task_id,
            source_refs: [],
            provenance: {
              kind: "TEXT2SQL_CANDIDATE",
              candidate_hash: candidateHash,
              parameters_hash: parametersHash,
              parameter_count: state.candidate.parameters.length,
              datasource_ref: effectiveConfig.datasource,
              schema_snapshot_ref: {
                resource_id: state.prepared.schema_snapshot_id,
                resource_hash: state.prepared.schema_snapshot_hash,
              },
              semantic_context_ref: {
                package_id: factoryInput.semantic_context_ref.package_id,
                package_hash: factoryInput.semantic_context_ref.package_hash,
              },
              semantic_query_context_ref:
                factoryInput.accepted_semantic_query_context_ref === null
                  ? null
                  : artifactReferenceFor("SemanticQueryContext").parse(
                      factoryInput.accepted_semantic_query_context_ref,
                    ),
              semantic_query_context_hash: state.prepared.semantic_query_context_hash,
              target_binding_hash: state.prepared.target_capability_hash,
            },
            projection: { kind: "SQL", dialect: "postgresql", sql: state.candidate.sql },
          });
          const evidenceRef = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "QueryEvidence",
            profile_id: "governed-text2sql-agent",
            task_id: input.task.task_id,
            source_refs: [state.sql_ref],
            provenance: {
              kind: "GOVERNED_QUERY_RESULT",
              query_id: result.query_id,
              request_hash: result.request_hash,
              result_hash: result.result_hash,
              row_count: result.row_count,
              byte_count: result.byte_count,
              elapsed_ms: result.elapsed_ms,
              truncated: result.truncated,
              semantic_binding: execution.semantic_binding,
            },
            projection: {
              kind: "TABLE",
              columns,
              rows,
              total_rows: result.row_count,
            },
          });
          const intent = visualizationIntent(state.candidate);
          if (!intent) return toolResult(evidenceRef);
          const evidence = portValue(
            await dependencies.artifacts.resolveCommitted(dependencies.capability, evidenceRef),
          );
          if (!evidence) throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_NOT_COMMITTED");
          const chartDocument = await buildQueryEvidenceChartDocument({
            intent,
            document_ref: {
              artifact_id: productionTeamRuntimeInternals.identity(
                factoryInput.lease.run_id,
                "artifact:ArtifactWorkspaceDocument",
              ),
              artifact_type: "ArtifactWorkspaceDocument",
              ...factoryInput.lease.scope,
              run_id: factoryInput.lease.run_id,
              revision: 1,
              content_hash: `sha256:${"0".repeat(64)}`,
            },
            evidence,
            semantic_context: {
              package_id: factoryInput.semantic_context_ref.package_id,
              package_hash: factoryInput.semantic_context_ref.package_hash,
              receipt_id: factoryInput.semantic_context_ref.receipt_id,
              receipt_hash: factoryInput.semantic_context_ref.receipt_hash,
            },
            title: state.candidate.presentation.title,
            description: state.candidate.presentation.summary,
            unit: null,
          });
          if (!chartDocument) return toolResult(evidenceRef);
          const chartRef = portValue(
            await dependencies.artifacts.commitWorkspaceChart(
              dependencies.capability,
              factoryInput.lease,
              chartDocument,
            ),
          );
          return toolResult(evidenceRef, [evidenceRef, chartRef]);
        }
        throw new ProductionTeamToolError("TEXT2SQL_AGENT_TOOL_DENIED");
      }

      if (input.task.profile_id === "report-writing-agent") {
        const references = factoryInput.delegation?.receipt.input_artifact_refs;
        if (!references) throw new ProductionTeamToolError("ROOT_AGENT_DELEGATION_REQUIRED");
        const evidence = await resolveReportEvidence({
          references,
          scope: factoryInput.lease.scope,
          run_id: factoryInput.lease.run_id,
          resolve: async (reference) =>
            portValue(
              await dependencies.artifacts.resolveCommitted(dependencies.capability, reference),
            ),
        });
        if (Buffer.byteLength(evidence.context_text, "utf8") > input.task.bounds.max_context_bytes)
          throw new ProductionTeamToolError("TEAM_REPORT_CONTEXT_BUDGET_EXCEEDED");
        if (input.tool_id === "evidence.read") return toolResult(references[0] ?? null, references);
        if (input.tool_id === "report.project") {
          const parsed = reportAnswerSchema.safeParse(
            await specialistProviderJson({
              factory: factoryInput,
              task_id: input.task.task_id,
              stage: "REPORT",
              context_text: evidence.context_text,
            }),
          );
          if (!parsed.success) {
            throw new ProductionTeamToolError("TEAM_REPORT_RESPONSE_INVALID");
          }
          const reportRef = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "AnalysisReport",
            profile_id: "report-writing-agent",
            task_id: input.task.task_id,
            source_refs: evidence.source_refs,
            provenance: null,
            projection: {
              kind: "REPORT",
              title: "受治理数据分析报告",
              sections: [
                {
                  heading: "结论",
                  body_text: parsed.data.answer,
                  source_refs: [...references],
                },
                ...evidence.retained_sections,
              ],
            },
          });
          return toolResult(reportRef);
        }
        throw new ProductionTeamToolError("REPORT_AGENT_TOOL_DENIED");
      }
      throw new ProductionTeamToolError("TEAM_TOOL_PROFILE_DENIED");
    },
  });
}

export const productionTeamToolsInternals = Object.freeze({
  buildRequestScopedInterpretations,
  normalizedQueryEvidenceRows,
  queryResultTypeFeedback,
  repairableQueryExecutionFailure,
  resolveAcceptedSemanticQueryContext,
  safeErrorCode,
  specialistProviderLogicalCallId,
  text2SqlCandidateDiagnosticCode,
  text2SqlCandidateFailureCode,
  visualizationIntent,
});
