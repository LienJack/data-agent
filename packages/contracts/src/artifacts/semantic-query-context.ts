import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { versionedResourceReferenceSchema } from "../workspaces/defaults.js";
import {
  physicalBindingEntrySchema,
  semanticDimensionSchema,
  semanticMetricSchema,
  semanticRelationshipSchema,
  timeDomainSchema,
} from "./semantic-governance.js";
import { formulaNodeSchema } from "./semantic-graph-v2.js";

const semanticQueryObjectKindSchema = z.enum([
  "DIMENSION",
  "FORMULA",
  "METRIC",
  "QUALITY",
  "RELATIONSHIP",
  "TIME",
]);

export const semanticQueryAnswerScopeSchema = z.enum([
  "SEMANTIC_FACTS_ONLY",
  "DATA_RESULT_REQUIRED",
]);

const positiveRevisionSchema = z.number().int().positive().safe();
const semanticQueryReleaseReferenceSchema = versionedResourceReferenceSchema.extend({
  datasource_id: immutableIdSchema,
  semantic_generation: positiveRevisionSchema,
  publication_status: z.literal("PUBLISHED"),
});
const semanticQuerySchemaSnapshotReferenceSchema = versionedResourceReferenceSchema.extend({
  datasource_id: immutableIdSchema,
  semantic_release_id: immutableIdSchema,
  semantic_generation: positiveRevisionSchema,
});

const uniqueIdsSchema = (max: number) =>
  z
    .array(versionIdentifierSchema)
    .max(max)
    .superRefine((values, ctx) => {
      values.forEach((value, index) => {
        if (values.indexOf(value) !== index) {
          ctx.addIssue({
            code: "custom",
            message: "Semantic query ids must be unique.",
            path: [index],
          });
        }
      });
    });

const canonicalIdsSchema = (max: number) =>
  uniqueIdsSchema(max).superRefine((values, ctx) => {
    values.forEach((value, index) => {
      if (index > 0 && value < (values[index - 1] ?? "")) {
        ctx.addIssue({
          code: "custom",
          message: "Semantic query ids must be canonically sorted.",
          path: [index],
        });
      }
    });
  });

// Provider selection arrays are mathematical sets. Canonicalize only their
// representation before the final strict artifact schema validates them. This
// never adds, removes, or substitutes a provider-selected semantic object.
const canonicalizingIdsSchema = (max: number) =>
  uniqueIdsSchema(max).overwrite((values) => [...values].sort());

export const semanticRequestScopedOperatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("RECENT_COMPLETE_PERIODS"),
    metric_id: versionIdentifierSchema,
    time_dimension_id: versionIdentifierSchema,
    period_unit: z.literal("MONTH"),
    period_count: z.number().int().min(1).max(120),
    anchor: z.literal("PUBLISHED_COMPLETE_FRONTIER"),
  }),
  z.strictObject({
    kind: z.literal("PERIOD_COMPARISON_RATE"),
    metric_id: versionIdentifierSchema,
    time_dimension_id: versionIdentifierSchema,
    comparison_offset: z.strictObject({ unit: z.literal("YEAR"), value: z.literal(1) }),
    formula: z.literal("(current_value - comparison_value) / NULLIF(comparison_value, 0)"),
  }),
  z.strictObject({
    kind: z.literal("AGGREGATE_RATIO"),
    numerator_metric_id: versionIdentifierSchema,
    denominator_metric_id: versionIdentifierSchema,
    numerator_adjustment: z.enum(["NONE", "SUBTRACT_DENOMINATOR"]),
    aggregation: z.literal("SUM_BEFORE_RATIO"),
    zero_denominator: z.literal("NULL"),
  }),
]);

const semanticRequestScopedOperationSchema = z.strictObject({
  requested_term: z.string().trim().min(1).max(256),
  operator: semanticRequestScopedOperatorSchema,
});

function requestScopedOperatorObjectIds(
  operator: z.infer<typeof semanticRequestScopedOperatorSchema>,
): readonly string[] {
  return operator.kind !== "AGGREGATE_RATIO"
    ? [operator.metric_id, operator.time_dimension_id].sort()
    : [operator.denominator_metric_id, operator.numerator_metric_id].sort();
}

export const semanticRequestScopedInterpretationSchema = z
  .strictObject({
    interpretation_id: versionIdentifierSchema.regex(/^request-scoped\./u),
    requested_term: z.string().trim().min(1).max(256),
    scope: z.literal("REQUEST_ONLY"),
    source_object_ids: canonicalIdsSchema(16).min(2),
    operator: semanticRequestScopedOperatorSchema,
    user_explanation: z.string().trim().min(1).max(2_048),
    publication_effect: z.literal("NONE"),
  })
  .superRefine((interpretation, ctx) => {
    const expectedIds = requestScopedOperatorObjectIds(interpretation.operator);
    if (
      interpretation.source_object_ids.length !== expectedIds.length ||
      interpretation.source_object_ids.some((id, index) => id !== expectedIds[index])
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Request-scoped interpretation sources must exactly match its governed operator.",
        path: ["source_object_ids"],
      });
    }
    if (
      /(?:索引.*(?:未找到|未命中)|未受治理定义|INDEX_NOT_FOUND|NOT_GOVERNED)/iu.test(
        interpretation.user_explanation,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Request-scoped interpretation must not expose internal retrieval failures.",
        path: ["user_explanation"],
      });
    }
  });

export const semanticQueryAmbiguitySchema = z.strictObject({
  object_kind: semanticQueryObjectKindSchema,
  // Zero candidates keeps a required mapping unresolved; it does not prove
  // global absence or authorize inventing a binding. One candidate is not ambiguous.
  candidate_ids: canonicalIdsSchema(32).refine((ids) => ids.length !== 1, {
    message: "Unresolved semantic selection needs zero or at least two candidates.",
  }),
});

const semanticQuerySelectionIntentShape = {
  schema_version: z.literal("semantic-query-selection-intent@1.0.0"),
  answer_scope: semanticQueryAnswerScopeSchema,
  selected_metric_ids: canonicalIdsSchema(64),
  selected_dimension_ids: canonicalIdsSchema(64),
  selected_formula_ids: canonicalIdsSchema(64),
  selected_relationship_ids: canonicalIdsSchema(128),
  selected_time_domain_ids: canonicalIdsSchema(64),
  selected_quality_constraint_ids: canonicalIdsSchema(64),
  unresolved_ambiguities: z.array(semanticQueryAmbiguitySchema).max(16),
  request_scoped_operations: z.array(semanticRequestScopedOperationSchema).max(16).optional(),
};

const semanticQuerySelectionIntentObjectSchema = z.strictObject(semanticQuerySelectionIntentShape);
type SemanticQuerySelectionIntentShape = z.infer<typeof semanticQuerySelectionIntentObjectSchema>;

function addSemanticQuerySelectionIntentIssues(
  intent: SemanticQuerySelectionIntentShape,
  ctx: z.RefinementCtx,
): void {
  const selectedCount =
    intent.selected_metric_ids.length +
    intent.selected_dimension_ids.length +
    intent.selected_formula_ids.length +
    intent.selected_relationship_ids.length +
    intent.selected_time_domain_ids.length +
    intent.selected_quality_constraint_ids.length;
  if (selectedCount === 0 && intent.unresolved_ambiguities.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "Semantic query selection intent cannot be empty.",
    });
  }
  const ambiguityKeys = intent.unresolved_ambiguities.map(
    (ambiguity) => `${ambiguity.object_kind}:${ambiguity.candidate_ids.join("\0")}`,
  );
  ambiguityKeys.forEach((key, index) => {
    if (index > 0 && key <= (ambiguityKeys[index - 1] ?? "")) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic query ambiguities must be unique and canonically sorted.",
        path: ["unresolved_ambiguities", index],
      });
    }
  });
  const operationKeys = (intent.request_scoped_operations ?? []).map((operation) =>
    JSON.stringify(operation),
  );
  operationKeys.forEach((key, index) => {
    if (operationKeys.indexOf(key) !== index) {
      ctx.addIssue({
        code: "custom",
        message:
          "Request-scoped operations must be unique; the Host canonicalizes interpretations.",
        path: ["request_scoped_operations", index],
      });
    }
  });
  (intent.request_scoped_operations ?? []).forEach((operation, index) => {
    const operator = operation.operator;
    const metricIds =
      operator.kind !== "AGGREGATE_RATIO"
        ? [operator.metric_id]
        : [operator.numerator_metric_id, operator.denominator_metric_id];
    const dimensionIds = operator.kind !== "AGGREGATE_RATIO" ? [operator.time_dimension_id] : [];
    if (
      metricIds.some((id) => !intent.selected_metric_ids.includes(id)) ||
      dimensionIds.some((id) => !intent.selected_dimension_ids.includes(id))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Request-scoped operations must bind selected governed primitives.",
        path: ["request_scoped_operations", index],
      });
    }
  });
}

const semanticQuerySelectionIntentDraftSchema =
  semanticQuerySelectionIntentObjectSchema.superRefine(addSemanticQuerySelectionIntentIssues);

export const semanticQuerySelectionIntentSchema = semanticQuerySelectionIntentDraftSchema;
export type SemanticQuerySelectionIntent = z.infer<typeof semanticQuerySelectionIntentSchema>;

const semanticQueryProviderAmbiguitySchema = z.strictObject({
  object_kind: semanticQueryObjectKindSchema,
  candidate_ids: canonicalizingIdsSchema(32).refine((ids) => ids.length !== 1, {
    message: "Unresolved semantic selection needs zero or at least two candidates.",
  }),
});

const semanticQueryProviderAmbiguitiesSchema = z
  .array(semanticQueryProviderAmbiguitySchema)
  .max(16)
  .overwrite((ambiguities) =>
    [...ambiguities].sort((left, right) => {
      const leftKey = `${left.object_kind}:${left.candidate_ids.join("\0")}`;
      const rightKey = `${right.object_kind}:${right.candidate_ids.join("\0")}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  );

/**
 * Provider-only boundary for JSON_TEXT delivery. It canonicalizes set ordering
 * without repairing semantic membership, then applies the same cross-field
 * invariants as the final immutable selection intent.
 */
export const semanticQuerySelectionProviderResponseSchema = z
  .strictObject({
    ...semanticQuerySelectionIntentShape,
    selected_metric_ids: canonicalizingIdsSchema(64),
    selected_dimension_ids: canonicalizingIdsSchema(64),
    selected_formula_ids: canonicalizingIdsSchema(64),
    selected_relationship_ids: canonicalizingIdsSchema(128),
    selected_time_domain_ids: canonicalizingIdsSchema(64),
    selected_quality_constraint_ids: canonicalizingIdsSchema(64),
    unresolved_ambiguities: semanticQueryProviderAmbiguitiesSchema,
  })
  .superRefine(addSemanticQuerySelectionIntentIssues);

export interface ResolvedSemanticRequestTimeWindow {
  readonly dimension_id: string;
  readonly start: string;
  readonly end: string;
  readonly semantics: "HALF_OPEN";
  readonly timezone: string;
  readonly period_unit: "MONTH";
  readonly period_count: number;
}

const COMPLETE_MONTH_BOUNDARY = /^(\d{4})-(\d{2})-01(T00:00:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2}))?$/u;

export function resolveSemanticRequestTimeWindow(input: {
  readonly metrics: readonly z.infer<typeof semanticMetricSchema>[];
  readonly dimensions: readonly z.infer<typeof semanticDimensionSchema>[];
  readonly request_scoped_interpretations?:
    | readonly {
        readonly operator: z.infer<typeof semanticRequestScopedOperatorSchema>;
      }[]
    | undefined;
}): ResolvedSemanticRequestTimeWindow | null {
  const requests = (input.request_scoped_interpretations ?? [])
    .map(({ operator }) => operator)
    .filter((operator) => operator.kind === "RECENT_COMPLETE_PERIODS");
  if (requests.length === 0) return null;
  const request = requests[0];
  if (!request || requests.length !== 1)
    throw new TypeError("SEMANTIC_REQUEST_TIME_WINDOW_AMBIGUOUS");
  const metric = input.metrics.find(({ metric_id }) => metric_id === request.metric_id);
  const dimension = input.dimensions.find(
    ({ dimension_id }) => dimension_id === request.time_dimension_id,
  );
  const domain = metric?.time_domain;
  if (
    !metric ||
    !dimension ||
    metric.table_id !== dimension.table_id ||
    metric.time_column_id !== dimension.column_id ||
    dimension.grain.granularity !== "month"
  ) {
    throw new TypeError("SEMANTIC_REQUEST_TIME_BINDING_INVALID");
  }
  const end = domain?.max_time;
  // Preserve the published calendar-boundary encoding, including its explicit offset.
  const boundary = end?.match(COMPLETE_MONTH_BOUNDARY);
  if (
    domain?.calendar !== "gregorian" ||
    !domain.timezone ||
    !end ||
    !boundary ||
    !Number.isFinite(Date.parse(end))
  ) {
    throw new TypeError("SEMANTIC_REQUEST_TIME_FRONTIER_UNAVAILABLE");
  }
  const startDate = new Date(0);
  startDate.setUTCFullYear(Number(boundary[1]), Number(boundary[2]) - 1 - request.period_count, 1);
  const start = `${startDate.toISOString().slice(0, 10)}${boundary[3] ?? ""}`;
  if (
    !/^\d{4}-/u.test(start) ||
    Date.parse(start) >= Date.parse(end) ||
    (domain.min_time !== null &&
      (!Number.isFinite(Date.parse(domain.min_time)) ||
        Date.parse(start) < Date.parse(domain.min_time)))
  ) {
    throw new TypeError("SEMANTIC_REQUEST_TIME_COVERAGE_UNAVAILABLE");
  }
  return Object.freeze({
    dimension_id: dimension.dimension_id,
    start,
    end,
    semantics: "HALF_OPEN",
    timezone: domain.timezone,
    period_unit: "MONTH",
    period_count: request.period_count,
  });
}

export interface ResolvedSemanticComparisonTimeWindow {
  readonly metric_id: string;
  readonly dimension_id: string;
  readonly requested_start: string;
  readonly requested_end: string;
  readonly start: string;
  readonly end: string;
  readonly empty: boolean;
  readonly semantics: "HALF_OPEN";
  readonly timezone: string;
  readonly comparison_offset: Readonly<{ unit: "YEAR"; value: 1 }>;
}

export function resolveSemanticComparisonTimeWindows(
  input: Parameters<typeof resolveSemanticRequestTimeWindow>[0],
): readonly ResolvedSemanticComparisonTimeWindow[] {
  const current = resolveSemanticRequestTimeWindow(input);
  if (!current) return Object.freeze([]);
  const operators = (input.request_scoped_interpretations ?? []).map(({ operator }) => operator);
  const relative = operators.find((operator) => operator.kind === "RECENT_COMPLETE_PERIODS");
  const result = new Map<string, ResolvedSemanticComparisonTimeWindow>();
  for (const operator of operators) {
    if (operator.kind !== "PERIOD_COMPARISON_RATE") continue;
    if (
      operator.metric_id !== relative?.metric_id ||
      operator.time_dimension_id !== current.dimension_id
    ) {
      throw new TypeError("SEMANTIC_COMPARISON_TIME_BINDING_INVALID");
    }
    const domain = input.metrics.find(
      ({ metric_id }) => metric_id === operator.metric_id,
    )?.time_domain;
    if (
      !domain ||
      (domain.min_time !== null &&
        (!COMPLETE_MONTH_BOUNDARY.test(domain.min_time) ||
          !Number.isFinite(Date.parse(domain.min_time))))
    ) {
      throw new TypeError("SEMANTIC_COMPARISON_TIME_COVERAGE_UNAVAILABLE");
    }
    const shiftYear = (boundary: string): string => {
      const year = Number(boundary.slice(0, 4)) - operator.comparison_offset.value;
      if (year < 1) throw new TypeError("SEMANTIC_COMPARISON_TIME_COVERAGE_UNAVAILABLE");
      return `${String(year).padStart(4, "0")}${boundary.slice(4)}`;
    };
    const requestedStart = shiftYear(current.start);
    const requestedEnd = shiftYear(current.end);
    const start =
      domain.min_time !== null && Date.parse(domain.min_time) > Date.parse(requestedStart)
        ? domain.min_time
        : requestedStart;
    const end =
      domain.max_time !== null && Date.parse(domain.max_time) < Date.parse(requestedEnd)
        ? domain.max_time
        : requestedEnd;
    const empty = Date.parse(start) >= Date.parse(end);
    result.set(
      operator.metric_id,
      Object.freeze({
        metric_id: operator.metric_id,
        dimension_id: operator.time_dimension_id,
        requested_start: requestedStart,
        requested_end: requestedEnd,
        start,
        end: empty ? start : end,
        empty,
        semantics: "HALF_OPEN",
        timezone: current.timezone,
        comparison_offset: Object.freeze({ unit: "YEAR", value: 1 }),
      }),
    );
  }
  return Object.freeze([...result.values()]);
}

export const semanticQueryQualityConstraintSchema = z.strictObject({
  constraint_id: versionIdentifierSchema,
  expression: z.string().min(1).max(4_096),
  severity: z.enum(["WARN", "ERROR"]),
  sensitivity: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"]),
});

const semanticContextReferenceSchema = z.strictObject({
  package_id: immutableIdSchema,
  package_hash: contentHashSchema,
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
  retrieval_receipt_hash: contentHashSchema,
  inference_receipt_hash: contentHashSchema,
});

function canonicalObjectArray<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  identity: (value: T) => string,
  max: number,
) {
  return z
    .array(schema)
    .max(max)
    .superRefine((values, ctx) => {
      const identities = values.map(identity);
      identities.forEach((value, index) => {
        if (index > 0 && value <= (identities[index - 1] ?? "")) {
          ctx.addIssue({
            code: "custom",
            message: "Semantic query context objects must be unique and canonically sorted.",
            path: [index],
          });
        }
      });
    });
}

const semanticQueryContextDraftSchema = z
  .strictObject({
    schema_version: z.literal("semantic-query-context@1.0.0"),
    answer_scope: semanticQueryAnswerScopeSchema.default("DATA_RESULT_REQUIRED"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    semantic_domain: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
    semantic_release: semanticQueryReleaseReferenceSchema,
    schema_snapshot: semanticQuerySchemaSnapshotReferenceSchema,
    datasource: versionedResourceReferenceSchema,
    semantic_context_ref: semanticContextReferenceSchema,
    requested_object_ids: canonicalIdsSchema(256),
    metrics: canonicalObjectArray(semanticMetricSchema, (metric) => metric.metric_id, 128),
    dimensions: canonicalObjectArray(
      semanticDimensionSchema,
      (dimension) => dimension.dimension_id,
      256,
    ),
    formulas: canonicalObjectArray(formulaNodeSchema, (formula) => formula.node_id, 256),
    relationships: canonicalObjectArray(
      semanticRelationshipSchema,
      (relationship) => relationship.relationship_id,
      512,
    ),
    physical_bindings: canonicalObjectArray(
      physicalBindingEntrySchema,
      (binding) =>
        [
          binding.logical_object_id,
          binding.logical_object_type,
          binding.schema_name,
          binding.table_name,
          binding.column_name ?? "",
        ].join("\0"),
      2_048,
    ),
    time_semantics: canonicalObjectArray(
      timeDomainSchema,
      (timeDomain) => timeDomain.time_domain_id,
      128,
    ),
    quality_constraints: canonicalObjectArray(
      semanticQueryQualityConstraintSchema,
      (constraint) => constraint.constraint_id,
      256,
    ),
    unresolved_ambiguities: z.array(semanticQueryAmbiguitySchema).max(16),
    request_scoped_interpretations: z
      .array(semanticRequestScopedInterpretationSchema)
      .max(16)
      .optional(),
  })
  .superRefine((context, ctx) => {
    if (
      context.semantic_release.datasource_id !== context.datasource.resource_id ||
      context.schema_snapshot.datasource_id !== context.datasource.resource_id ||
      context.schema_snapshot.semantic_release_id !== context.semantic_release.resource_id ||
      context.schema_snapshot.semantic_generation !== context.semantic_release.semantic_generation
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic query authority resources must form one exact binding.",
        path: ["semantic_release"],
      });
    }
    context.physical_bindings.forEach((binding, index) => {
      if (binding.datasource_id !== context.datasource.resource_id) {
        ctx.addIssue({
          code: "custom",
          message: "Semantic query physical bindings must use the exact datasource.",
          path: ["physical_bindings", index, "datasource_id"],
        });
      }
    });

    const projectedIds = new Set([
      ...context.metrics.map(({ metric_id: id }) => id),
      ...context.dimensions.map(({ dimension_id: id }) => id),
      ...context.formulas.map(({ node_id: id }) => id),
      ...context.relationships.map(({ relationship_id: id }) => id),
      ...context.time_semantics.map(({ time_domain_id: id }) => id),
      ...context.quality_constraints.map(({ constraint_id: id }) => id),
      ...context.unresolved_ambiguities.flatMap(({ candidate_ids: ids }) => ids),
    ]);
    context.requested_object_ids.forEach((id, index) => {
      if (!projectedIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: "Requested semantic object is absent from the projected context.",
          path: ["requested_object_ids", index],
        });
      }
    });

    const formulaIds = new Set(context.formulas.map(({ node_id: id }) => id));
    const timeDomainIds = new Set(context.time_semantics.map(({ time_domain_id: id }) => id));
    context.metrics.forEach((metric, index) => {
      if (metric.formula && !formulaIds.has(metric.formula.formula_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Metric formula must be present in the semantic query closure.",
          path: ["metrics", index, "formula", "formula_id"],
        });
      }
      if (metric.time_domain && !timeDomainIds.has(metric.time_domain.time_domain_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Metric time domain must be present in the semantic query closure.",
          path: ["metrics", index, "time_domain", "time_domain_id"],
        });
      }
    });
    const dimensionIds = new Set(context.dimensions.map(({ dimension_id: id }) => id));
    context.dimensions.forEach((dimension, index) => {
      if (dimension.parent_dimension_id && !dimensionIds.has(dimension.parent_dimension_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Dimension parent must be present in the semantic query closure.",
          path: ["dimensions", index, "parent_dimension_id"],
        });
      }
    });

    const ambiguityKeys = context.unresolved_ambiguities.map(
      (ambiguity) => `${ambiguity.object_kind}:${ambiguity.candidate_ids.join("\0")}`,
    );
    ambiguityKeys.forEach((key, index) => {
      if (index > 0 && key <= (ambiguityKeys[index - 1] ?? "")) {
        ctx.addIssue({
          code: "custom",
          message: "Semantic query ambiguities must be unique and canonically sorted.",
          path: ["unresolved_ambiguities", index],
        });
      }
    });
    const interpretations = context.request_scoped_interpretations ?? [];
    interpretations.forEach((interpretation, index) => {
      if (
        index > 0 &&
        interpretation.interpretation_id <= (interpretations[index - 1]?.interpretation_id ?? "")
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Request-scoped interpretations must be unique and canonically sorted.",
          path: ["request_scoped_interpretations", index],
        });
      }
      if (interpretation.source_object_ids.some((id) => !projectedIds.has(id))) {
        ctx.addIssue({
          code: "custom",
          message: "Request-scoped interpretation escaped the projected governed closure.",
          path: ["request_scoped_interpretations", index, "source_object_ids"],
        });
      }
    });
    try {
      resolveSemanticRequestTimeWindow(context);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "SEMANTIC_REQUEST_TIME_WINDOW_INVALID",
        path: ["request_scoped_interpretations"],
      });
    }
  });

export const semanticQueryContextSchema = semanticQueryContextDraftSchema.extend({
  context_hash: contentHashSchema,
});
export type SemanticQueryContext = z.infer<typeof semanticQueryContextSchema>;

export async function buildSemanticQueryContext(input: unknown) {
  const draft = semanticQueryContextDraftSchema.parse(input);
  return deepFreeze(
    semanticQueryContextSchema.parse({
      ...draft,
      context_hash: await sha256ContentHash({
        hash_domain: "semantic-query-context@1.0.0",
        value: draft,
      }),
    }),
  );
}

export async function verifySemanticQueryContext(input: unknown) {
  const context = semanticQueryContextSchema.parse(input);
  const { context_hash: observedHash, ...draft } = context;
  const expectedHash = await sha256ContentHash({
    hash_domain: "semantic-query-context@1.0.0",
    value: semanticQueryContextDraftSchema.parse(draft),
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("SEMANTIC_QUERY_CONTEXT_HASH_MISMATCH");
  }
  return deepFreeze(context);
}
