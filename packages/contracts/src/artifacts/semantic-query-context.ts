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

const canonicalIdsSchema = (max: number) =>
  z
    .array(versionIdentifierSchema)
    .max(max)
    .superRefine((values, ctx) => {
      values.forEach((value, index) => {
        if (index > 0 && value <= (values[index - 1] ?? "")) {
          ctx.addIssue({
            code: "custom",
            message: "Semantic query ids must be unique and canonically sorted.",
            path: [index],
          });
        }
      });
    });

export const semanticQueryAmbiguitySchema = z.strictObject({
  object_kind: semanticQueryObjectKindSchema,
  candidate_ids: canonicalIdsSchema(32).min(2),
});

const semanticQuerySelectionIntentDraftSchema = z
  .strictObject({
    schema_version: z.literal("semantic-query-selection-intent@1.0.0"),
    selected_metric_ids: canonicalIdsSchema(64),
    selected_dimension_ids: canonicalIdsSchema(64),
    selected_formula_ids: canonicalIdsSchema(64),
    selected_relationship_ids: canonicalIdsSchema(128),
    selected_time_domain_ids: canonicalIdsSchema(64),
    selected_quality_constraint_ids: canonicalIdsSchema(64),
    unresolved_ambiguities: z.array(semanticQueryAmbiguitySchema).max(16),
  })
  .superRefine((intent, ctx) => {
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
  });

export const semanticQuerySelectionIntentSchema = semanticQuerySelectionIntentDraftSchema;
export type SemanticQuerySelectionIntent = z.infer<typeof semanticQuerySelectionIntentSchema>;

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
