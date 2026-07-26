import { z } from "zod";
import {
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type ArtifactCommitterCapabilityClaim,
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  l2ArtifactEnvelopeSchema,
} from "./envelope.js";
import {
  type GroundingAuthorityDocument,
  GroundingAuthorityError,
  type GroundingAuthorityReference,
  verifyGroundingAuthorityDocument,
} from "./grounding-authority.js";
import {
  catalogRelationshipContractSchema,
  catalogTableContractSchema,
  dimensionBindingSchema,
  joinTypeForPreservedTable,
  mandatoryPredicateContractSchema,
  metricBindingSchema,
  qualifiedColumnBelongsToTable,
  qualifiedColumnIdSchema,
} from "./text2sql-primitives.js";

const questionFrameSchema = z.strictObject({
  artifact_type: z.literal("QuestionFrame"),
  raw_question: z.string().min(1).max(10_000),
  normalized_question: z.string().min(1).max(10_000),
  authorized_datasource_ids: z.array(immutableIdSchema).min(1),
  expected_output: z.string().min(1).max(500),
});

const researchBriefSchema = z.strictObject({
  artifact_type: z.literal("ResearchBrief"),
  question_frame_ref: artifactReferenceFor("QuestionFrame"),
  research_goal: z.string().min(1).max(2_000),
  success_criteria: z.array(z.string().min(1).max(500)).min(1),
  budget: z.strictObject({
    max_steps: z.number().int().positive(),
    max_model_calls: z.number().int().nonnegative(),
    max_sql_executions: z.number().int().nonnegative(),
  }),
});

const hypothesisSetSchema = z
  .strictObject({
    artifact_type: z.literal("HypothesisSet"),
    research_brief_ref: artifactReferenceFor("ResearchBrief"),
    hypotheses: z
      .array(
        z.strictObject({
          hypothesis_id: immutableIdSchema,
          statement: z.string().min(1).max(2_000),
          differentiating_prediction: z.string().min(1).max(2_000),
        }),
      )
      .min(2),
  })
  .superRefine((hypothesisSet, ctx) => {
    const observed = new Set<string>();
    for (const [index, hypothesis] of hypothesisSet.hypotheses.entries()) {
      if (observed.has(hypothesis.hypothesis_id)) {
        ctx.addIssue({
          code: "custom",
          message: "HypothesisSet 中的 hypothesis_id 必须唯一。",
          path: ["hypotheses", index, "hypothesis_id"],
        });
      }
      observed.add(hypothesis.hypothesis_id);
    }
  });

const evidencePlanSchema = z
  .strictObject({
    artifact_type: z.literal("EvidencePlan"),
    hypothesis_set_ref: artifactReferenceFor("HypothesisSet"),
    obligations: z
      .array(
        z.strictObject({
          obligation_id: immutableIdSchema,
          hypothesis_id: immutableIdSchema,
          question: z.string().min(1).max(2_000),
          source_kind: z.enum(["sql", "document", "benchmark"]),
        }),
      )
      .min(1),
  })
  .superRefine((evidencePlan, ctx) => {
    const observed = new Set<string>();
    for (const [index, obligation] of evidencePlan.obligations.entries()) {
      if (observed.has(obligation.obligation_id)) {
        ctx.addIssue({
          code: "custom",
          message: "EvidencePlan 中的 obligation_id 必须唯一。",
          path: ["obligations", index, "obligation_id"],
        });
      }
      observed.add(obligation.obligation_id);
    }
  });

const nonNullJsonSchema = z.json().refine((value) => value !== null, {
  message: "普通比较不能使用 NULL；必须使用 is_null/is_not_null。",
});

export const queryFilterSchema = z.discriminatedUnion("operator", [
  z.strictObject({
    field: qualifiedColumnIdSchema,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: nonNullJsonSchema,
  }),
  z.strictObject({
    field: qualifiedColumnIdSchema,
    operator: z.literal("in"),
    value: z.array(nonNullJsonSchema).min(1),
  }),
  z.strictObject({
    field: qualifiedColumnIdSchema,
    operator: z.enum(["is_null", "is_not_null"]),
    value: z.null(),
  }),
]);

export const queryContractSchema = z
  .strictObject({
    artifact_type: z.literal("QueryContract"),
    evidence_plan_ref: artifactReferenceFor("EvidencePlan"),
    metric: versionIdentifierSchema,
    dimensions: z.array(versionIdentifierSchema),
    grain: versionIdentifierSchema,
    time_range: z.strictObject({
      start: timestampSchema,
      end: timestampSchema,
      timezone: z.string().min(1).max(64),
      semantics: z.literal("HALF_OPEN"),
    }),
    unit: versionIdentifierSchema,
    filters: z.array(queryFilterSchema),
    datasource_id: immutableIdSchema,
    result_contract: z.strictObject({
      columns: z.array(versionIdentifierSchema).min(1),
      invariant_ids: z.array(versionIdentifierSchema).min(1),
    }),
  })
  .superRefine((contract, ctx) => {
    if (Date.parse(contract.time_range.start) >= Date.parse(contract.time_range.end)) {
      ctx.addIssue({
        code: "custom",
        message: "QueryContract 时间范围必须满足 start < end 的半开区间。",
        path: ["time_range"],
      });
    }
    if (new Set(contract.dimensions).size !== contract.dimensions.length) {
      ctx.addIssue({
        code: "custom",
        message: "QueryContract.dimensions 必须唯一。",
        path: ["dimensions"],
      });
    }
    if (contract.dimensions.includes(contract.metric)) {
      ctx.addIssue({
        code: "custom",
        message: "QueryContract 的 Metric 与 Dimension 身份必须互斥。",
        path: ["dimensions"],
      });
    }
    const expectedColumns = [...contract.dimensions, contract.metric];
    if (!sameStringArray(contract.result_contract.columns, expectedColumns)) {
      ctx.addIssue({
        code: "custom",
        message: "QueryContract.result_contract.columns 必须按 Dimension 顺序后接 Metric。",
        path: ["result_contract", "columns"],
      });
    }
    const observedInvariantIds = new Set(contract.result_contract.invariant_ids);
    if (observedInvariantIds.size !== contract.result_contract.invariant_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "QueryContract.result_contract.invariant_ids 必须唯一。",
        path: ["result_contract", "invariant_ids"],
      });
    }
  });

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalRelationshipJoinSignature(
  relationship: z.infer<typeof catalogRelationshipContractSchema>,
): string {
  const joinPairs = relationship.left_column_ids.map((leftColumnId, index) => {
    const endpoints = [
      [relationship.left_table_id, leftColumnId],
      [relationship.right_table_id, relationship.right_column_ids[index] ?? ""],
    ].map((endpoint) => canonicalizeJson(endpoint));
    return canonicalizeJson(endpoints.sort());
  });
  return canonicalizeJson(joinPairs.sort());
}

const groundingContentShape = {
  catalog_version: versionIdentifierSchema,
  policy_version: versionIdentifierSchema,
  datasource_id: immutableIdSchema,
  allowed_schema: z.strictObject({
    tables: z.array(catalogTableContractSchema).min(1),
  }),
  metric: metricBindingSchema,
  dimensions: z.array(dimensionBindingSchema),
  required_column_ids: z.array(qualifiedColumnIdSchema).min(1),
  mandatory_predicates: z.array(mandatoryPredicateContractSchema),
  join_closure: z
    .strictObject({
      root_table_id: versionIdentifierSchema,
      table_ids: z.array(versionIdentifierSchema).min(1),
      edges: z.array(catalogRelationshipContractSchema),
      preaggregations: z.array(
        z
          .strictObject({
            table_id: versionIdentifierSchema,
            group_by_column_ids: z.array(qualifiedColumnIdSchema).min(1),
            measure_column_ids: z.array(qualifiedColumnIdSchema).length(1),
            reason_code: z.literal("FANOUT_PREAGG_REQUIRED"),
          })
          .superRefine((preaggregation, ctx) => {
            if (
              new Set(preaggregation.group_by_column_ids).size !==
              preaggregation.group_by_column_ids.length
            ) {
              ctx.addIssue({
                code: "custom",
                message: "Preaggregation Group Column 必须唯一。",
                path: ["group_by_column_ids"],
              });
            }
            for (const [groupIndex, columnId] of preaggregation.group_by_column_ids.entries()) {
              if (!qualifiedColumnBelongsToTable(columnId, preaggregation.table_id)) {
                ctx.addIssue({
                  code: "custom",
                  message: "Preaggregation Group Column 必须属于其 table_id。",
                  path: ["group_by_column_ids", groupIndex],
                });
              }
            }
            for (const [measureIndex, columnId] of preaggregation.measure_column_ids.entries()) {
              if (!qualifiedColumnBelongsToTable(columnId, preaggregation.table_id)) {
                ctx.addIssue({
                  code: "custom",
                  message: "Preaggregation Measure Column 必须属于其 table_id。",
                  path: ["measure_column_ids", measureIndex],
                });
              }
            }
          }),
      ),
    })
    .superRefine((joinClosure, ctx) => {
      const relationshipIds = new Set<string>();
      const relationshipSignatures = new Set<string>();
      for (const [edgeIndex, edge] of joinClosure.edges.entries()) {
        if (relationshipIds.has(edge.relationship_id)) {
          ctx.addIssue({
            code: "custom",
            message: "GroundingPackage Join Closure 的 relationship_id 必须唯一。",
            path: ["edges", edgeIndex, "relationship_id"],
          });
        }
        relationshipIds.add(edge.relationship_id);

        const signature = canonicalRelationshipJoinSignature(edge);
        if (relationshipSignatures.has(signature)) {
          ctx.addIssue({
            code: "custom",
            message: "GroundingPackage Join Closure 不能重复或反向重复同一关系。",
            path: ["edges", edgeIndex],
          });
        }
        relationshipSignatures.add(signature);
      }
    }),
  accepted_candidate_ids: z.array(versionIdentifierSchema),
  conflict_set: z.array(versionIdentifierSchema).length(0),
  grounding_hash: contentHashSchema,
} as const;

function validateGroundingRoot(
  grounding: {
    readonly metric: { readonly metric_id: string; readonly table_id: string };
    readonly dimensions: readonly { readonly dimension_id: string }[];
    readonly allowed_schema: {
      readonly tables: readonly { readonly table_id: string }[];
    };
    readonly required_column_ids: readonly string[];
    readonly mandatory_predicates: readonly {
      readonly table_id: string;
      readonly column_id: string;
      readonly operator: string;
      readonly parameter_key: string;
    }[];
    readonly join_closure: {
      readonly root_table_id: string;
      readonly table_ids: readonly string[];
      readonly preaggregations: readonly { readonly table_id: string }[];
    };
    readonly accepted_candidate_ids: readonly string[];
  },
  ctx: z.RefinementCtx,
): void {
  if (grounding.join_closure.root_table_id !== grounding.metric.table_id) {
    ctx.addIssue({
      code: "custom",
      message: "GroundingPackage Join Closure Root 必须是 Metric 所在事实表。",
      path: ["join_closure", "root_table_id"],
    });
  }
  if (
    grounding.dimensions.some(({ dimension_id }) => dimension_id === grounding.metric.metric_id)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "GroundingPackage 的 Metric 与 Dimension 身份必须互斥。",
      path: ["dimensions"],
    });
  }
  const uniqueCollections: ReadonlyArray<{
    readonly values: readonly string[];
    readonly path: PropertyKey[];
    readonly message: string;
  }> = [
    {
      values: grounding.allowed_schema.tables.map(({ table_id }) => table_id),
      path: ["allowed_schema", "tables"],
      message: "GroundingPackage AllowedSchema 的 Table 必须唯一。",
    },
    {
      values: grounding.dimensions.map(({ dimension_id }) => dimension_id),
      path: ["dimensions"],
      message: "GroundingPackage Dimension 必须唯一。",
    },
    {
      values: grounding.required_column_ids,
      path: ["required_column_ids"],
      message: "GroundingPackage Required Column 必须唯一。",
    },
    {
      values: grounding.mandatory_predicates.map(
        ({ table_id, column_id, operator, parameter_key }) =>
          `${table_id}\u0000${column_id}\u0000${operator}\u0000${parameter_key}`,
      ),
      path: ["mandatory_predicates"],
      message: "GroundingPackage Mandatory Predicate 必须唯一。",
    },
    {
      values: grounding.join_closure.table_ids,
      path: ["join_closure", "table_ids"],
      message: "GroundingPackage Join Closure 的 Table 必须唯一。",
    },
    {
      values: grounding.join_closure.preaggregations.map(({ table_id }) => table_id),
      path: ["join_closure", "preaggregations"],
      message: "GroundingPackage 每个 Table 最多声明一份 Preaggregation。",
    },
    {
      values: grounding.accepted_candidate_ids,
      path: ["accepted_candidate_ids"],
      message: "GroundingPackage Accepted Candidate 必须唯一。",
    },
  ];
  for (const collection of uniqueCollections) {
    if (new Set(collection.values).size !== collection.values.length) {
      ctx.addIssue({
        code: "custom",
        message: collection.message,
        path: collection.path,
      });
    }
  }
}

export const groundingContentSchema = z
  .strictObject(groundingContentShape)
  .superRefine(validateGroundingRoot);

export const groundingHashMaterialSchema = z
  .strictObject(groundingContentShape)
  .omit({ grounding_hash: true })
  .superRefine(validateGroundingRoot);

export const groundingPackageSchema = z
  .strictObject({
    artifact_type: z.literal("GroundingPackage"),
    query_contract_ref: artifactReferenceFor("QueryContract"),
    semantic_release_ref: artifactReferenceFor("SemanticRelease"),
    schema_snapshot_ref: artifactReferenceFor("SchemaSnapshot"),
    policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
    ...groundingContentShape,
  })
  .superRefine(validateGroundingRoot);

export const fieldReferenceSchema = z
  .strictObject({
    table_id: versionIdentifierSchema,
    column_id: qualifiedColumnIdSchema,
  })
  .superRefine((field, ctx) => {
    if (!field.column_id.startsWith(`${field.table_id}.`)) {
      ctx.addIssue({
        code: "custom",
        message: "Field Reference 的 column_id 必须属于其 table_id。",
        path: ["column_id"],
      });
    }
  });

export const parameterReferenceSchema = z.strictObject({
  parameter_key: versionIdentifierSchema,
});

export const typedPredicateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("comparison"),
    left: fieldReferenceSchema,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    right: parameterReferenceSchema,
    authority: z.enum(["query-contract", "policy", "time"]),
  }),
  z.strictObject({
    kind: z.literal("membership"),
    field: fieldReferenceSchema,
    operator: z.literal("in"),
    values: z.array(parameterReferenceSchema).min(1),
    authority: z.literal("query-contract"),
  }),
  z.strictObject({
    kind: z.literal("null-check"),
    field: fieldReferenceSchema,
    operator: z.enum(["is_null", "is_not_null"]),
    authority: z.enum(["query-contract", "policy"]),
  }),
]);

export const boundParameterSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("literal"), value: nonNullJsonSchema }),
  z.strictObject({
    source: z.literal("policy"),
    policy_key: versionIdentifierSchema,
  }),
  z.strictObject({
    source: z.literal("time"),
    value: timestampSchema,
  }),
]);

const semanticQueryContentShape = {
  metric: metricBindingSchema,
  dimensions: z.array(dimensionBindingSchema),
  predicates: z.array(typedPredicateSchema),
  time_predicate: z.strictObject({
    field: fieldReferenceSchema,
    lower: z.strictObject({
      parameter_key: versionIdentifierSchema,
      inclusive: z.literal(true),
    }),
    upper: z.strictObject({
      parameter_key: versionIdentifierSchema,
      inclusive: z.literal(false),
    }),
    timezone: z.string().min(1).max(64),
  }),
  parameters: z.record(versionIdentifierSchema, boundParameterSchema),
  grounding_hash: contentHashSchema,
  result_contract: queryContractSchema.shape.result_contract,
} as const;

function validateSemanticQueryIdentities(
  semanticQuery: {
    readonly metric: { readonly metric_id: string };
    readonly dimensions: readonly { readonly dimension_id: string }[];
  },
  ctx: z.RefinementCtx,
): void {
  const dimensionIds = semanticQuery.dimensions.map(({ dimension_id }) => dimension_id);
  if (new Set(dimensionIds).size !== dimensionIds.length) {
    ctx.addIssue({
      code: "custom",
      message: "SemanticQuery Dimension 身份必须唯一。",
      path: ["dimensions"],
    });
  }
  if (dimensionIds.includes(semanticQuery.metric.metric_id)) {
    ctx.addIssue({
      code: "custom",
      message: "SemanticQuery 的 Metric 与 Dimension 身份必须互斥。",
      path: ["dimensions"],
    });
  }
}

export const semanticQueryContentSchema = z
  .strictObject(semanticQueryContentShape)
  .superRefine(validateSemanticQueryIdentities);

export const semanticQuerySchema = z
  .strictObject({
    artifact_type: z.literal("SemanticQuery"),
    query_contract_ref: artifactReferenceFor("QueryContract"),
    grounding_package_ref: artifactReferenceFor("GroundingPackage"),
    ...semanticQueryContentShape,
  })
  .superRefine(validateSemanticQueryIdentities);

const measureSchema = z.strictObject({
  metric_id: versionIdentifierSchema,
  function: z.enum(["sum", "count", "count_distinct", "avg", "min", "max"]),
  field: fieldReferenceSchema,
  alias: versionIdentifierSchema,
  unit: versionIdentifierSchema,
  null_policy: z.enum(["preserve", "coalesce-zero", "exclude"]),
  distinct: z.boolean(),
});

export const logicalOperationSchema = z
  .discriminatedUnion("operation", [
    z.strictObject({
      operation: z.literal("scan"),
      operation_id: versionIdentifierSchema,
      table_id: versionIdentifierSchema,
      alias: versionIdentifierSchema,
      column_ids: z.array(qualifiedColumnIdSchema).min(1),
    }),
    z.strictObject({
      operation: z.literal("filter"),
      operation_id: versionIdentifierSchema,
      input_id: versionIdentifierSchema,
      predicates: z.array(typedPredicateSchema).min(1),
    }),
    z.strictObject({
      operation: z.literal("join"),
      operation_id: versionIdentifierSchema,
      left_input_id: versionIdentifierSchema,
      right_input_id: versionIdentifierSchema,
      relationship: catalogRelationshipContractSchema,
      join_type: z.enum(["inner", "left"]),
    }),
    z.strictObject({
      operation: z.literal("preaggregate"),
      operation_id: versionIdentifierSchema,
      input_id: versionIdentifierSchema,
      group_by: z.array(fieldReferenceSchema).min(1),
      measures: z.array(measureSchema).length(1),
      reason_code: z.literal("FANOUT_PREAGG_REQUIRED"),
    }),
    z.strictObject({
      operation: z.literal("aggregate"),
      operation_id: versionIdentifierSchema,
      input_id: versionIdentifierSchema,
      group_by: z.array(fieldReferenceSchema),
      measures: z.array(measureSchema).length(1),
    }),
    z.strictObject({
      operation: z.literal("project"),
      operation_id: versionIdentifierSchema,
      input_id: versionIdentifierSchema,
      columns: z
        .array(
          z.strictObject({
            source_kind: z.enum(["group", "measure"]),
            source_id: versionIdentifierSchema,
            alias: versionIdentifierSchema,
          }),
        )
        .min(1),
    }),
  ])
  .superRefine((operation, ctx) => {
    if (operation.operation === "scan") {
      if (new Set(operation.column_ids).size !== operation.column_ids.length) {
        ctx.addIssue({
          code: "custom",
          message: "Scan Column 必须唯一。",
          path: ["column_ids"],
        });
      }
      for (const [columnIndex, columnId] of operation.column_ids.entries()) {
        if (!qualifiedColumnBelongsToTable(columnId, operation.table_id)) {
          ctx.addIssue({
            code: "custom",
            message: "Scan Column 必须属于其 table_id。",
            path: ["column_ids", columnIndex],
          });
        }
      }
    }
    if (
      operation.operation === "project" &&
      new Set(operation.columns.map(({ alias }) => alias)).size !== operation.columns.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Project 输出 Alias 必须唯一。",
        path: ["columns"],
      });
    }
  });

export const logicalPlanContentSchema = z.strictObject({
  operations: z.array(logicalOperationSchema).min(3),
  root_operation_id: versionIdentifierSchema,
  parameters: z.record(versionIdentifierSchema, boundParameterSchema),
  grounding_hash: contentHashSchema,
  semantic_signature: z.strictObject({
    metric_id: versionIdentifierSchema,
    dimension_ids: z.array(versionIdentifierSchema),
    grain: versionIdentifierSchema,
    unit: versionIdentifierSchema,
    time_semantics: z.literal("HALF_OPEN"),
  }),
});

export const logicalPlanSchema = z.strictObject({
  artifact_type: z.literal("LogicalPlan"),
  semantic_query_ref: artifactReferenceFor("SemanticQuery"),
  ...logicalPlanContentSchema.shape,
});

export const sqlArtifactSchema = z.strictObject({
  artifact_type: z.literal("SqlArtifact"),
  logical_plan_ref: artifactReferenceFor("LogicalPlan"),
  dialect: z.literal("postgresql"),
  sql: z.string().min(1).max(100_000),
  parameters: z.record(z.string(), z.json()),
  query_hash: contentHashSchema,
});

export const TEXT2SQL_GATES = [
  "INTENT",
  "SEMANTIC",
  "STRUCTURAL",
  "POLICY",
  "RESOURCE",
  "EXECUTION",
  "RESULT",
] as const;

export const TEXT2SQL_PRE_EXECUTION_GATES = [
  "INTENT",
  "SEMANTIC",
  "STRUCTURAL",
  "POLICY",
  "RESOURCE",
] as const;

const gateVerdictSchema = z.enum(["PASS", "FAIL", "UNAVAILABLE"]);

export const gateReceiptSchema = z
  .strictObject({
    artifact_type: z.literal("GateReceipt"),
    sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
    execution_receipt_ref: artifactReferenceFor("ExecutionReceipt").nullable(),
    gate: z.enum(TEXT2SQL_GATES),
    gate_version: versionIdentifierSchema,
    verdict: gateVerdictSchema,
    reason_code: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    evidence_refs: z.array(artifactReferenceSchema).min(1),
    evaluated_at: timestampSchema,
  })
  .superRefine((receipt, ctx) => {
    const executionBound = receipt.execution_receipt_ref !== null;
    const requiresExecution = receipt.gate === "EXECUTION" || receipt.gate === "RESULT";
    if (executionBound !== requiresExecution) {
      ctx.addIssue({
        code: "custom",
        message: requiresExecution
          ? "EXECUTION/RESULT GateReceipt 必须绑定真实 ExecutionReceipt。"
          : "执行前 GateReceipt 不能绑定尚未发生的 ExecutionReceipt。",
        path: ["execution_receipt_ref"],
      });
    }
  });

export const executionPermitSchema = z
  .strictObject({
    artifact_type: z.literal("ExecutionPermit"),
    sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
    gate_receipt_refs: z.array(artifactReferenceFor("GateReceipt")).length(5),
    budget: z.strictObject({
      timeout_ms: z.number().int().positive().max(300_000),
      max_rows: z.number().int().positive().max(100_000),
      max_bytes: z.number().int().positive().max(100_000_000),
    }),
    expires_at: timestampSchema,
  })
  .superRefine((permit, ctx) => {
    const observed = new Set(permit.gate_receipt_refs.map(artifactReferenceIdentity));
    if (observed.size !== permit.gate_receipt_refs.length) {
      ctx.addIssue({
        code: "custom",
        message: "ExecutionPermit 不能重复消费同一个 GateReceipt。",
        path: ["gate_receipt_refs"],
      });
    }
  });

export const executionReceiptSchema = z
  .strictObject({
    artifact_type: z.literal("ExecutionReceipt"),
    sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
    execution_permit_ref: artifactReferenceFor("ExecutionPermit"),
    sandbox_execution_receipt_ref: artifactReferenceFor("SandboxExecutionReceipt"),
    datasource_id: immutableIdSchema,
    schema_version: versionIdentifierSchema,
    snapshot_token: versionIdentifierSchema.nullable(),
    watermark: versionIdentifierSchema.nullable(),
    observed_at: timestampSchema,
    query_hash: contentHashSchema,
    result_hash: contentHashSchema,
    replay_state: z.enum(["REPLAYABLE", "LIMITED", "REPLAY_UNAVAILABLE"]),
    row_count: z.number().int().nonnegative(),
  })
  .superRefine((receipt, ctx) => {
    if (receipt.replay_state === "REPLAYABLE" && receipt.snapshot_token === null) {
      ctx.addIssue({
        code: "custom",
        message: "REPLAYABLE ExecutionReceipt 必须绑定 Snapshot Token。",
        path: ["snapshot_token"],
      });
    }
    if (receipt.replay_state === "LIMITED" && receipt.watermark === null) {
      ctx.addIssue({
        code: "custom",
        message: "LIMITED ExecutionReceipt 必须绑定 Watermark。",
        path: ["watermark"],
      });
    }
  });

export const validationReceiptSchema = z
  .strictObject({
    artifact_type: z.literal("ValidationReceipt"),
    sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
    execution_receipt_ref: artifactReferenceFor("ExecutionReceipt"),
    gate_receipt_refs: z.array(artifactReferenceFor("GateReceipt")).length(7),
    validation_version: versionIdentifierSchema,
    sealed_at: timestampSchema,
  })
  .superRefine((receipt, ctx) => {
    const observed = new Set(receipt.gate_receipt_refs.map(artifactReferenceIdentity));
    if (observed.size !== receipt.gate_receipt_refs.length) {
      ctx.addIssue({
        code: "custom",
        message: "ValidationReceipt 不能重复消费同一个 GateReceipt。",
        path: ["gate_receipt_refs"],
      });
    }
  });

export const queryEvidenceSchema = z
  .strictObject({
    artifact_type: z.literal("QueryEvidence"),
    execution_receipt_ref: artifactReferenceFor("ExecutionReceipt"),
    validation_receipt_ref: artifactReferenceFor("ValidationReceipt"),
    result_hash: contentHashSchema,
    invariant_verdicts: z
      .array(
        z.strictObject({
          invariant_id: versionIdentifierSchema,
          verdict: z.enum(["PASS", "FAIL"]),
        }),
      )
      .min(1),
  })
  .superRefine((evidence, ctx) => {
    const observedInvariantIds = new Set<string>();
    for (const [index, verdict] of evidence.invariant_verdicts.entries()) {
      if (observedInvariantIds.has(verdict.invariant_id)) {
        ctx.addIssue({
          code: "custom",
          message: "QueryEvidence.invariant_verdicts 中的 invariant_id 必须唯一。",
          path: ["invariant_verdicts", index, "invariant_id"],
        });
      }
      observedInvariantIds.add(verdict.invariant_id);
    }
  });

const atomicClaimSchema = z.strictObject({
  artifact_type: z.literal("AtomicClaim"),
  claim_id: immutableIdSchema,
  statement: z.string().min(1).max(5_000),
  evidence_refs: z.array(artifactReferenceFor("QueryEvidence")).min(1),
  support_state: z.enum(["SUPPORTED", "CONFLICTED", "UNSUPPORTED"]),
  limitations: z.array(z.string().min(1).max(2_000)),
});

const evidenceRelationSchema = z.strictObject({
  artifact_type: z.literal("EvidenceRelation"),
  claim_ref: artifactReferenceFor("AtomicClaim"),
  evidence_ref: artifactReferenceFor("QueryEvidence"),
  relation: z.enum(["SUPPORTS", "CONFLICTS", "RELATED_ONLY"]),
});

const analysisReportSchema = z.strictObject({
  artifact_type: z.literal("AnalysisReport"),
  title: z.string().min(1).max(500),
  claim_refs: z.array(artifactReferenceFor("AtomicClaim")).min(1),
  limitations: z.array(z.string().min(1).max(2_000)),
  projection_hash: contentHashSchema,
});

export const L2_REPORT_READY_GATES = [
  "SUPPORT",
  "CONFLICT",
  "FRESHNESS",
  "SOURCE_INDEPENDENCE",
] as const;

const reportReadyCertificateSchema = z
  .strictObject({
    artifact_type: z.literal("ReportReadyCertificate"),
    report_ref: artifactReferenceFor("AnalysisReport"),
    gate_version: versionIdentifierSchema,
    gate_results: z.array(
      z.strictObject({
        gate: z.enum(L2_REPORT_READY_GATES),
        verdict: z.literal("PASS"),
        reason_code: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z][A-Z0-9_]*$/),
      }),
    ),
    evidence_refs: z.array(artifactReferenceFor("QueryEvidence")).min(1),
    decision: z.literal("READY"),
    certificate_hash: contentHashSchema,
  })
  .superRefine((certificate, ctx) => {
    const observed = new Set(certificate.gate_results.map(({ gate }) => gate));
    if (
      certificate.gate_results.length !== L2_REPORT_READY_GATES.length ||
      observed.size !== L2_REPORT_READY_GATES.length ||
      L2_REPORT_READY_GATES.some((gate) => !observed.has(gate))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ReportReadyCertificate 必须且只能包含四道 L2 Evidence Gate 的 PASS。",
        path: ["gate_results"],
      });
    }
  });

export const l2ArtifactPayloadSchema = z.discriminatedUnion("artifact_type", [
  questionFrameSchema,
  researchBriefSchema,
  hypothesisSetSchema,
  evidencePlanSchema,
  queryContractSchema,
  groundingPackageSchema,
  semanticQuerySchema,
  logicalPlanSchema,
  sqlArtifactSchema,
  gateReceiptSchema,
  executionPermitSchema,
  executionReceiptSchema,
  validationReceiptSchema,
  queryEvidenceSchema,
  atomicClaimSchema,
  evidenceRelationSchema,
  analysisReportSchema,
  reportReadyCertificateSchema,
]);

type L2ArtifactPayload = z.infer<typeof l2ArtifactPayloadSchema>;

type SqlArtifactPayload = Extract<L2ArtifactPayload, { artifact_type: "SqlArtifact" }>;
export type QueryContractPayload = z.infer<typeof queryContractSchema>;
export type GroundingPackagePayload = z.infer<typeof groundingPackageSchema>;
export type SemanticQueryPayload = z.infer<typeof semanticQuerySchema>;
export type LogicalPlanPayload = z.infer<typeof logicalPlanSchema>;
export type SqlArtifactPayloadContract = z.infer<typeof sqlArtifactSchema>;
export type GateReceiptPayload = z.infer<typeof gateReceiptSchema>;
export type ExecutionPermitPayload = z.infer<typeof executionPermitSchema>;
export type ExecutionReceiptPayload = z.infer<typeof executionReceiptSchema>;
export type ValidationReceiptPayload = z.infer<typeof validationReceiptSchema>;
export type QueryEvidencePayload = z.infer<typeof queryEvidenceSchema>;

export async function computeGroundingHash(input: unknown): Promise<`sha256:${string}`> {
  return sha256ContentHash(groundingHashMaterialSchema.parse(input));
}

export async function computeSqlArtifactQueryHash(
  sqlArtifact: Pick<SqlArtifactPayload, "dialect" | "sql" | "parameters">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    dialect: sqlArtifact.dialect,
    sql: sqlArtifact.sql,
    parameters: sqlArtifact.parameters,
  });
}

function payloadArtifactReferences(payload: L2ArtifactPayload): ArtifactReference[] {
  switch (payload.artifact_type) {
    case "ResearchBrief":
      return [payload.question_frame_ref];
    case "HypothesisSet":
      return [payload.research_brief_ref];
    case "EvidencePlan":
      return [payload.hypothesis_set_ref];
    case "QueryContract":
      return [payload.evidence_plan_ref];
    case "GroundingPackage":
      return [
        payload.query_contract_ref,
        payload.semantic_release_ref,
        payload.schema_snapshot_ref,
        payload.policy_receipt_ref,
      ];
    case "SemanticQuery":
      return [payload.query_contract_ref, payload.grounding_package_ref];
    case "LogicalPlan":
      return [payload.semantic_query_ref];
    case "SqlArtifact":
      return [payload.logical_plan_ref];
    case "GateReceipt":
      return [
        payload.sql_artifact_ref,
        ...(payload.execution_receipt_ref ? [payload.execution_receipt_ref] : []),
        ...payload.evidence_refs,
      ];
    case "ExecutionPermit":
      return [payload.sql_artifact_ref, ...payload.gate_receipt_refs];
    case "ExecutionReceipt":
      return [
        payload.sql_artifact_ref,
        payload.execution_permit_ref,
        payload.sandbox_execution_receipt_ref,
      ];
    case "ValidationReceipt":
      return [
        payload.sql_artifact_ref,
        payload.execution_receipt_ref,
        ...payload.gate_receipt_refs,
      ];
    case "QueryEvidence":
      return [payload.execution_receipt_ref, payload.validation_receipt_ref];
    case "AtomicClaim":
      return payload.evidence_refs;
    case "EvidenceRelation":
      return [payload.claim_ref, payload.evidence_ref];
    case "AnalysisReport":
      return payload.claim_refs;
    case "ReportReadyCertificate":
      return [payload.report_ref, ...payload.evidence_refs];
    case "QuestionFrame":
      return [];
  }
}

export const l2ArtifactDocumentSchema = z
  .strictObject({
    envelope: l2ArtifactEnvelopeSchema,
    payload: l2ArtifactPayloadSchema,
  })
  .superRefine((document, ctx) => {
    if (document.envelope.artifact_type !== document.payload.artifact_type) {
      ctx.addIssue({
        code: "custom",
        message: "Envelope 与 Payload 的 artifact_type 必须一致。",
        path: ["payload", "artifact_type"],
      });
    }

    const declaredInputReferences = new Set(
      document.envelope.input_refs.map(artifactReferenceIdentity),
    );
    for (const [index, reference] of payloadArtifactReferences(document.payload).entries()) {
      if (
        reference.app_id !== document.envelope.app_id ||
        reference.tenant_id !== document.envelope.tenant_id ||
        reference.environment !== document.envelope.environment ||
        reference.run_id !== document.envelope.run_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Payload Reference 必须与 Envelope 属于同一 App/Tenant/Environment/Run。",
          path: ["payload", index],
        });
      }

      if (!declaredInputReferences.has(artifactReferenceIdentity(reference))) {
        ctx.addIssue({
          code: "custom",
          message: "Payload Reference 必须在 Envelope input_refs 中声明。",
          path: ["payload", index],
        });
      }
    }
  });

function artifactIntegrityMaterial(document: L2ArtifactDocument) {
  const {
    content_hash: _contentHash,
    created_at: _createdAt,
    status: _status,
    ...versionedEnvelope
  } = document.envelope;

  return {
    envelope: versionedEnvelope,
    payload: document.payload,
  };
}

export async function computeL2ArtifactContentHash(
  document: L2ArtifactDocument,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(artifactIntegrityMaterial(document));
}

export class ArtifactIntegrityError extends Error {
  override readonly name = "ArtifactIntegrityError";
  readonly code = "ARTIFACT_CONTENT_HASH_MISMATCH";
}

export class ArtifactAuthorityError extends Error {
  override readonly name = "ArtifactAuthorityError";
  readonly code = "ARTIFACT_NOT_AUTHORITATIVE";
}

export class ArtifactInputAuthorityError extends Error {
  override readonly name = "ArtifactInputAuthorityError";
  readonly code = "ARTIFACT_INPUT_NOT_COMMITTED";
}

export class ArtifactSemanticAuthorityError extends Error {
  override readonly name = "ArtifactSemanticAuthorityError";
  readonly code = "ARTIFACT_SEMANTIC_AUTHORITY_INVALID";
}

export interface L2ArtifactAuthorityContext {
  readonly principalId: string;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolveL2(reference: ArtifactReference): Promise<unknown | null>;
  resolveGroundingAuthority?(reference: GroundingAuthorityReference): Promise<unknown | null>;
  verifyCommitterCapability(claim: ArtifactCommitterCapabilityClaim): Promise<boolean>;
}

export type L2ArtifactPersistenceAuthority = L2ArtifactAuthorityContext;

interface L2ArtifactVerificationState {
  readonly verified: Map<string, L2ArtifactDocument>;
  readonly path: ReadonlySet<string>;
}

const l2ArtifactVerificationStates = new WeakMap<
  L2ArtifactAuthorityContext,
  L2ArtifactVerificationState
>();

function scopeL2ArtifactAuthority(
  authority: L2ArtifactAuthorityContext,
  state: L2ArtifactVerificationState,
  currentIdentity: string,
): L2ArtifactAuthorityContext {
  const scopedAuthority: L2ArtifactAuthorityContext = Object.freeze({
    principalId: authority.principalId,
    verifyCommitted: (reference: ArtifactReference) => authority.verifyCommitted(reference),
    resolveL2: (reference: ArtifactReference) => authority.resolveL2(reference),
    ...(authority.resolveGroundingAuthority
      ? {
          resolveGroundingAuthority: (reference: GroundingAuthorityReference) =>
            authority.resolveGroundingAuthority?.(reference) ?? Promise.resolve(null),
        }
      : {}),
    verifyCommitterCapability: (claim: ArtifactCommitterCapabilityClaim) =>
      authority.verifyCommitterCapability(claim),
  });
  l2ArtifactVerificationStates.set(scopedAuthority, {
    verified: state.verified,
    path: new Set([...state.path, currentIdentity]),
  });
  return scopedAuthority;
}

function artifactReferenceFromDocument(document: L2ArtifactDocument): ArtifactReference {
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  };
}

async function resolveAuthoritativeL2(
  reference: ArtifactReference,
  authority: L2ArtifactAuthorityContext,
): Promise<L2ArtifactDocument> {
  const resolved = await authority.resolveL2(reference);
  const parsed = l2ArtifactDocumentSchema.safeParse(resolved);
  if (
    !parsed.success ||
    artifactReferenceIdentity(artifactReferenceFromDocument(parsed.data)) !==
      artifactReferenceIdentity(reference)
  ) {
    throw new ArtifactSemanticAuthorityError(
      `Artifact ${reference.artifact_type} 没有匹配的权威 L2 文档。`,
    );
  }
  return verifyL2ArtifactDocument(parsed.data, authority);
}

async function resolveAuthoritativeGroundingSource<
  T extends GroundingAuthorityDocument["artifact_type"],
>(
  reference: GroundingAuthorityReference,
  artifactType: T,
  authority: L2ArtifactAuthorityContext,
): Promise<Extract<GroundingAuthorityDocument, { artifact_type: T }>> {
  const resolveCommitted = authority.resolveGroundingAuthority;
  if (!resolveCommitted) {
    throw new ArtifactSemanticAuthorityError(
      `GroundingPackage 缺少匹配的权威 ${artifactType} Document。`,
    );
  }
  try {
    const document = await verifyGroundingAuthorityDocument(reference, {
      principalId: authority.principalId,
      resolveCommitted,
      verifyCommitted: authority.verifyCommitted,
    });
    if (document.artifact_type !== artifactType) {
      throw new ArtifactSemanticAuthorityError(
        `GroundingPackage 缺少匹配的权威 ${artifactType} Document。`,
      );
    }
    return document as Extract<GroundingAuthorityDocument, { artifact_type: T }>;
  } catch (error) {
    if (
      error instanceof GroundingAuthorityError ||
      error instanceof ArtifactSemanticAuthorityError
    ) {
      throw new ArtifactSemanticAuthorityError(
        `GroundingPackage 缺少匹配的权威 ${artifactType} Document。`,
      );
    }
    throw error;
  }
}

function requireArtifactType<T extends L2ArtifactPayload["artifact_type"]>(
  document: L2ArtifactDocument,
  artifactType: T,
): Extract<L2ArtifactPayload, { artifact_type: T }> {
  if (document.payload.artifact_type !== artifactType) {
    throw new ArtifactSemanticAuthorityError(
      `期望 ${artifactType}，实际解析到 ${document.payload.artifact_type}。`,
    );
  }
  return document.payload as Extract<L2ArtifactPayload, { artifact_type: T }>;
}

async function requirePassingEvidence(
  evidenceReference: ArtifactReference,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const evidence = requireArtifactType(
    await resolveAuthoritativeL2(evidenceReference, authority),
    "QueryEvidence",
  );
  if (evidence.invariant_verdicts.some(({ verdict }) => verdict !== "PASS")) {
    throw new ArtifactSemanticAuthorityError(
      "SUPPORTED Claim 不能消费不变量失败的 QueryEvidence。",
    );
  }

  await verifyQueryEvidenceSemantics(evidence, authority);
}

function requireSameReference(
  left: ArtifactReference,
  right: ArtifactReference,
  message: string,
): void {
  if (artifactReferenceIdentity(left) !== artifactReferenceIdentity(right)) {
    throw new ArtifactSemanticAuthorityError(message);
  }
}

async function verifyEvidencePlanSemantics(
  evidencePlan: Extract<L2ArtifactPayload, { artifact_type: "EvidencePlan" }>,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const hypothesisSet = requireArtifactType(
    await resolveAuthoritativeL2(evidencePlan.hypothesis_set_ref, authority),
    "HypothesisSet",
  );
  const hypothesisIds = new Set(hypothesisSet.hypotheses.map(({ hypothesis_id }) => hypothesis_id));
  const coveredHypothesisIds = new Set<string>();
  for (const obligation of evidencePlan.obligations) {
    if (!hypothesisIds.has(obligation.hypothesis_id)) {
      throw new ArtifactSemanticAuthorityError(
        `EvidencePlan obligation ${obligation.obligation_id} 引用了不属于上游 HypothesisSet 的 hypothesis_id。`,
      );
    }
    coveredHypothesisIds.add(obligation.hypothesis_id);
  }
  if (
    hypothesisSet.hypotheses.some(({ hypothesis_id }) => !coveredHypothesisIds.has(hypothesis_id))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "EvidencePlan 必须为上游 HypothesisSet 的每个竞争假设定义至少一项证据义务。",
    );
  }
}

async function verifyQueryContractSemantics(
  queryContract: QueryContractPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const evidencePlan = requireArtifactType(
    await resolveAuthoritativeL2(queryContract.evidence_plan_ref, authority),
    "EvidencePlan",
  );
  const hypothesisSet = requireArtifactType(
    await resolveAuthoritativeL2(evidencePlan.hypothesis_set_ref, authority),
    "HypothesisSet",
  );
  const researchBrief = requireArtifactType(
    await resolveAuthoritativeL2(hypothesisSet.research_brief_ref, authority),
    "ResearchBrief",
  );
  const questionFrame = requireArtifactType(
    await resolveAuthoritativeL2(researchBrief.question_frame_ref, authority),
    "QuestionFrame",
  );
  if (!questionFrame.authorized_datasource_ids.includes(queryContract.datasource_id)) {
    throw new ArtifactSemanticAuthorityError(
      "QueryContract.datasource_id 必须属于上游 QuestionFrame.authorized_datasource_ids。",
    );
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

async function verifyGroundingPackageSemantics(
  groundingPackage: GroundingPackagePayload,
  authority: L2ArtifactAuthorityContext,
): Promise<QueryContractPayload> {
  const [queryContract, semanticRelease, schemaSnapshot, policyReceipt] = await Promise.all([
    resolveAuthoritativeL2(groundingPackage.query_contract_ref, authority).then((document) =>
      requireArtifactType(document, "QueryContract"),
    ),
    resolveAuthoritativeGroundingSource(
      groundingPackage.semantic_release_ref,
      "SemanticRelease",
      authority,
    ),
    resolveAuthoritativeGroundingSource(
      groundingPackage.schema_snapshot_ref,
      "SchemaSnapshot",
      authority,
    ),
    resolveAuthoritativeGroundingSource(
      groundingPackage.policy_receipt_ref,
      "PolicyReceipt",
      authority,
    ),
  ]);
  requireSameReference(
    policyReceipt.semantic_release_ref,
    groundingPackage.semantic_release_ref,
    "PolicyReceipt 与 GroundingPackage 必须绑定同一 SemanticRelease。",
  );
  requireSameReference(
    policyReceipt.schema_snapshot_ref,
    groundingPackage.schema_snapshot_ref,
    "PolicyReceipt 与 GroundingPackage 必须绑定同一 SchemaSnapshot。",
  );
  if (groundingPackage.datasource_id !== queryContract.datasource_id) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.datasource_id 必须与 QueryContract.datasource_id 一致。",
    );
  }
  if (
    semanticRelease.datasource_id !== groundingPackage.datasource_id ||
    schemaSnapshot.datasource_id !== groundingPackage.datasource_id ||
    policyReceipt.datasource_id !== groundingPackage.datasource_id ||
    semanticRelease.catalog_version !== groundingPackage.catalog_version ||
    schemaSnapshot.catalog_version !== groundingPackage.catalog_version ||
    policyReceipt.policy_version !== groundingPackage.policy_version
  ) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage 的 Datasource/Catalog/Policy Version 必须与三份权威来源一致。",
    );
  }
  const {
    artifact_type: _artifactType,
    query_contract_ref: _queryContractRef,
    semantic_release_ref: _semanticReleaseRef,
    schema_snapshot_ref: _schemaSnapshotRef,
    policy_receipt_ref: _policyReceiptRef,
    grounding_hash: _groundingHash,
    ...groundingMaterial
  } = groundingPackage;
  const hashMaterial = groundingHashMaterialSchema.parse(groundingMaterial);
  if ((await computeGroundingHash(hashMaterial)) !== groundingPackage.grounding_hash) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.grounding_hash 与 ACL Grounding 规范内容不匹配。",
    );
  }
  if (
    groundingPackage.metric.metric_id !== queryContract.metric ||
    groundingPackage.metric.grain !== queryContract.grain ||
    groundingPackage.metric.unit !== queryContract.unit
  ) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.metric 必须与 QueryContract 的 Metric/Grain/Unit 一致。",
    );
  }
  const releasedMetric = semanticRelease.metrics.find(
    ({ metric_id }) => metric_id === groundingPackage.metric.metric_id,
  );
  if (!releasedMetric || !sameCanonicalJson(releasedMetric, groundingPackage.metric)) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.metric 必须来自当前 SemanticRelease。",
    );
  }
  const releasedDimensions = new Map(
    semanticRelease.dimensions.map((dimension) => [dimension.dimension_id, dimension]),
  );
  if (
    groundingPackage.dimensions.some((dimension) => {
      const released = releasedDimensions.get(dimension.dimension_id);
      return !released || !sameCanonicalJson(released, dimension);
    })
  ) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.dimensions 必须来自当前 SemanticRelease。",
    );
  }
  if (
    !sameCanonicalJson(
      groundingPackage.dimensions.map(({ dimension_id }) => dimension_id),
      queryContract.dimensions,
    )
  ) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.dimensions 必须与 QueryContract.dimensions 一致。",
    );
  }

  const requiredColumnIds = new Set(groundingPackage.required_column_ids);
  const semanticallyRequiredColumnIds = new Set([
    groundingPackage.metric.column_id,
    ...groundingPackage.metric.dependency_column_ids,
    ...(groundingPackage.metric.time_column_id ? [groundingPackage.metric.time_column_id] : []),
    ...groundingPackage.dimensions.map(({ column_id }) => column_id),
    ...queryContract.filters.map(({ field }) => field),
    ...groundingPackage.mandatory_predicates.map(({ column_id }) => column_id),
    ...groundingPackage.join_closure.edges.flatMap((edge) => [
      ...edge.left_column_ids,
      ...edge.right_column_ids,
    ]),
  ]);
  if ([...semanticallyRequiredColumnIds].some((columnId) => !requiredColumnIds.has(columnId))) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.required_column_ids 缺少 Metric/Filter/Policy/Join Closure 必要字段。",
    );
  }
  const allowedColumnIds = new Set(
    groundingPackage.allowed_schema.tables.flatMap((table) =>
      table.columns.map(({ column_id }) => column_id),
    ),
  );
  if (groundingPackage.required_column_ids.some((columnId) => !allowedColumnIds.has(columnId))) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage.required_column_ids 必须全部属于 ACL Allowed Schema。",
    );
  }
  const snapshotTables = new Map(schemaSnapshot.tables.map((table) => [table.table_id, table]));
  const policyTables = new Map(
    policyReceipt.allowed_schema.tables.map((table) => [table.table_id, new Set(table.column_ids)]),
  );
  for (const table of groundingPackage.allowed_schema.tables) {
    const snapshotTable = snapshotTables.get(table.table_id);
    const policyColumns = policyTables.get(table.table_id);
    if (!snapshotTable || snapshotTable.physical_name !== table.physical_name || !policyColumns) {
      throw new ArtifactSemanticAuthorityError(
        "GroundingPackage Allowed Table 必须同时来自 SchemaSnapshot 与 PolicyReceipt。",
      );
    }
    const snapshotColumns = new Map(
      snapshotTable.columns.map((column) => [column.column_id, column]),
    );
    if (
      table.columns.some((column) => {
        const snapshotColumn = snapshotColumns.get(column.column_id);
        return (
          !snapshotColumn ||
          !policyColumns.has(column.column_id) ||
          !sameCanonicalJson(snapshotColumn, column)
        );
      })
    ) {
      throw new ArtifactSemanticAuthorityError(
        "GroundingPackage Allowed Column 不能超出 SchemaSnapshot 与 PolicyReceipt 交集。",
      );
    }
  }
  const releasedRelationships = new Map(
    schemaSnapshot.relationships.map((relationship) => [
      relationship.relationship_id,
      relationship,
    ]),
  );
  if (
    groundingPackage.join_closure.edges.some((edge) => {
      const released = releasedRelationships.get(edge.relationship_id);
      return !released || !sameCanonicalJson(released, edge);
    })
  ) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage Join Closure 只能消费当前 SchemaSnapshot Relationship。",
    );
  }
  const selectedTableIds = new Set(
    groundingPackage.allowed_schema.tables.map(({ table_id }) => table_id),
  );
  if (
    groundingPackage.join_closure.root_table_id !== groundingPackage.metric.table_id ||
    !sameCanonicalJson(
      [...selectedTableIds].sort(),
      [...groundingPackage.join_closure.table_ids].sort(),
    ) ||
    !selectedTableIds.has(groundingPackage.join_closure.root_table_id)
  ) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage Join Closure 的 Table 集合必须与 Allowed Schema 精确一致。",
    );
  }
  const expectedMandatoryPredicates = policyReceipt.mandatory_predicates.filter(({ table_id }) =>
    selectedTableIds.has(table_id),
  );
  if (
    !sameCanonicalJson(
      sortedCanonical(groundingPackage.mandatory_predicates),
      sortedCanonical(expectedMandatoryPredicates),
    )
  ) {
    throw new ArtifactSemanticAuthorityError(
      "GroundingPackage Mandatory Predicate 必须完整消费当前 PolicyReceipt。",
    );
  }
  return queryContract;
}

type SemanticPredicate = SemanticQueryPayload["predicates"][number];

function fieldReferenceFromColumnId(columnId: string): z.infer<typeof fieldReferenceSchema> {
  const separator = columnId.indexOf(".");
  return {
    table_id: separator === -1 ? "" : columnId.slice(0, separator),
    column_id: columnId,
  };
}

function semanticPredicateFact(
  predicate: SemanticPredicate,
  parameters: SemanticQueryPayload["parameters"],
): unknown {
  if (predicate.kind === "null-check") {
    return {
      authority: predicate.authority,
      field: predicate.field,
      operator: predicate.operator,
    };
  }
  if (predicate.kind === "membership") {
    return {
      authority: predicate.authority,
      field: predicate.field,
      operator: predicate.operator,
      values: predicate.values.map(({ parameter_key }) => {
        const parameter = parameters[parameter_key];
        if (parameter?.source !== "literal") {
          throw new ArtifactSemanticAuthorityError(
            "SemanticQuery membership 参数必须绑定 QueryContract literal。",
          );
        }
        return parameter.value;
      }),
    };
  }
  const parameter = parameters[predicate.right.parameter_key];
  if (!parameter) {
    throw new ArtifactSemanticAuthorityError("SemanticQuery Predicate 引用了未绑定参数。");
  }
  if (predicate.authority === "query-contract") {
    if (parameter.source !== "literal") {
      throw new ArtifactSemanticAuthorityError(
        "SemanticQuery QueryContract Predicate 必须绑定 literal 参数。",
      );
    }
    return {
      authority: predicate.authority,
      field: predicate.left,
      operator: predicate.operator,
      value: parameter.value,
    };
  }
  if (predicate.authority === "policy") {
    if (parameter.source !== "policy") {
      throw new ArtifactSemanticAuthorityError(
        "SemanticQuery Policy Predicate 必须绑定 policy 参数。",
      );
    }
    return {
      authority: predicate.authority,
      field: predicate.left,
      operator: predicate.operator,
      policy_key: parameter.policy_key,
    };
  }
  throw new ArtifactSemanticAuthorityError(
    "SemanticQuery 时间约束必须由专用半开 time_predicate 表达。",
  );
}

function expectedSemanticPredicateFacts(
  queryContract: QueryContractPayload,
  groundingPackage: GroundingPackagePayload,
): unknown[] {
  return [
    ...queryContract.filters.map((filter) => {
      if (filter.operator === "is_null" || filter.operator === "is_not_null") {
        return {
          authority: "query-contract",
          field: fieldReferenceFromColumnId(filter.field),
          operator: filter.operator,
        };
      }
      if (filter.operator === "in") {
        return {
          authority: "query-contract",
          field: fieldReferenceFromColumnId(filter.field),
          operator: filter.operator,
          values: filter.value,
        };
      }
      return {
        authority: "query-contract",
        field: fieldReferenceFromColumnId(filter.field),
        operator: filter.operator,
        value: filter.value,
      };
    }),
    ...groundingPackage.mandatory_predicates.map((predicate) =>
      predicate.operator === "is_null" || predicate.operator === "is_not_null"
        ? {
            authority: "policy",
            field: {
              table_id: predicate.table_id,
              column_id: predicate.column_id,
            },
            operator: predicate.operator,
          }
        : {
            authority: "policy",
            field: {
              table_id: predicate.table_id,
              column_id: predicate.column_id,
            },
            operator: predicate.operator,
            policy_key: predicate.parameter_key,
          },
    ),
  ];
}

function sortedCanonical(values: readonly unknown[]): string[] {
  return values.map(canonicalizeJson).sort();
}

async function verifySemanticQueryLineage(
  semanticQuery: Extract<L2ArtifactPayload, { artifact_type: "SemanticQuery" }>,
  authority: L2ArtifactAuthorityContext,
): Promise<Extract<L2ArtifactPayload, { artifact_type: "QueryContract" }>> {
  const [queryContract, groundingPackage] = await Promise.all([
    resolveAuthoritativeL2(semanticQuery.query_contract_ref, authority).then((document) =>
      requireArtifactType(document, "QueryContract"),
    ),
    resolveAuthoritativeL2(semanticQuery.grounding_package_ref, authority).then((document) =>
      requireArtifactType(document, "GroundingPackage"),
    ),
  ]);
  requireSameReference(
    groundingPackage.query_contract_ref,
    semanticQuery.query_contract_ref,
    "SemanticQuery 与 GroundingPackage 必须绑定同一 QueryContract。",
  );
  await verifyGroundingPackageSemantics(groundingPackage, authority);
  if (
    semanticQuery.grounding_hash !== groundingPackage.grounding_hash ||
    !sameCanonicalJson(semanticQuery.metric, groundingPackage.metric) ||
    !sameCanonicalJson(semanticQuery.dimensions, groundingPackage.dimensions)
  ) {
    throw new ArtifactSemanticAuthorityError(
      "SemanticQuery.metric/dimensions/grounding_hash 必须与 GroundingPackage 一致。",
    );
  }
  if (!sameCanonicalJson(semanticQuery.result_contract, queryContract.result_contract)) {
    throw new ArtifactSemanticAuthorityError(
      "SemanticQuery.result_contract 必须与 QueryContract 一致。",
    );
  }
  const timeColumnId = groundingPackage.metric.time_column_id;
  if (
    !timeColumnId ||
    !sameCanonicalJson(
      semanticQuery.time_predicate.field,
      fieldReferenceFromColumnId(timeColumnId),
    ) ||
    semanticQuery.time_predicate.timezone !== queryContract.time_range.timezone
  ) {
    throw new ArtifactSemanticAuthorityError(
      "SemanticQuery.time_predicate 必须绑定 Grounding Metric 的时间字段与 QueryContract 时区。",
    );
  }
  const lower = semanticQuery.parameters[semanticQuery.time_predicate.lower.parameter_key];
  const upper = semanticQuery.parameters[semanticQuery.time_predicate.upper.parameter_key];
  if (
    lower?.source !== "time" ||
    upper?.source !== "time" ||
    lower.value !== queryContract.time_range.start ||
    upper.value !== queryContract.time_range.end
  ) {
    throw new ArtifactSemanticAuthorityError(
      "SemanticQuery.time_predicate 必须绑定 QueryContract 的半开时间参数。",
    );
  }
  const expectedFacts = sortedCanonical(
    expectedSemanticPredicateFacts(queryContract, groundingPackage),
  );
  const observedFacts = sortedCanonical(
    semanticQuery.predicates.map((predicate) =>
      semanticPredicateFact(predicate, semanticQuery.parameters),
    ),
  );
  if (!sameCanonicalJson(observedFacts, expectedFacts)) {
    throw new ArtifactSemanticAuthorityError(
      "SemanticQuery.predicates 必须完整且仅表达 QueryContract 与 Policy Predicate。",
    );
  }

  const referencedParameterKeys = new Set([
    semanticQuery.time_predicate.lower.parameter_key,
    semanticQuery.time_predicate.upper.parameter_key,
  ]);
  for (const predicate of semanticQuery.predicates) {
    if (predicate.kind === "comparison") {
      referencedParameterKeys.add(predicate.right.parameter_key);
    } else if (predicate.kind === "membership") {
      for (const value of predicate.values) referencedParameterKeys.add(value.parameter_key);
    }
  }
  if (
    Object.keys(semanticQuery.parameters).some((key) => !referencedParameterKeys.has(key)) ||
    [...referencedParameterKeys].some((key) => !(key in semanticQuery.parameters))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "SemanticQuery.parameters 必须与 Predicate 引用精确闭合。",
    );
  }
  return queryContract;
}

type LogicalOperation = LogicalPlanPayload["operations"][number];

function logicalOperationInputs(operation: LogicalOperation): readonly string[] {
  switch (operation.operation) {
    case "scan":
      return [];
    case "filter":
    case "preaggregate":
    case "aggregate":
    case "project":
      return [operation.input_id];
    case "join":
      return [operation.left_input_id, operation.right_input_id];
  }
}

function assertRootedTopologicalDag(logicalPlan: LogicalPlanPayload): void {
  const operationIds = logicalPlan.operations.map(({ operation_id }) => operation_id);
  if (new Set(operationIds).size !== operationIds.length) {
    throw new ArtifactSemanticAuthorityError("LogicalPlan DAG 的 operation_id 必须唯一。");
  }
  const operationsById = new Map(
    logicalPlan.operations.map((operation) => [operation.operation_id, operation]),
  );
  if (!operationsById.has(logicalPlan.root_operation_id)) {
    throw new ArtifactSemanticAuthorityError("LogicalPlan DAG 的 Root 必须存在。");
  }
  const operationIndexes = new Map(operationIds.map((operationId, index) => [operationId, index]));
  for (const [operationIndex, operation] of logicalPlan.operations.entries()) {
    for (const inputId of logicalOperationInputs(operation)) {
      const inputIndex = operationIndexes.get(inputId);
      if (inputIndex === undefined || inputIndex >= operationIndex) {
        throw new ArtifactSemanticAuthorityError(
          "LogicalPlan DAG 的输入必须存在且使用确定性拓扑顺序。",
        );
      }
    }
  }
  const reachable = new Set<string>();
  const pending = [logicalPlan.root_operation_id];
  while (pending.length > 0) {
    const operationId = pending.pop();
    if (!operationId || reachable.has(operationId)) continue;
    reachable.add(operationId);
    const operation = operationsById.get(operationId);
    if (operation) pending.push(...logicalOperationInputs(operation));
  }
  if (reachable.size !== logicalPlan.operations.length) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan DAG 不能包含未被 Root 消费的孤立 Operation。",
    );
  }
}

function operationFieldReferences(
  operation: LogicalOperation,
): z.infer<typeof fieldReferenceSchema>[] {
  switch (operation.operation) {
    case "scan":
      return operation.column_ids.map((columnId) => ({
        table_id: operation.table_id,
        column_id: columnId,
      }));
    case "filter":
      return operation.predicates.map((predicate) =>
        predicate.kind === "comparison" ? predicate.left : predicate.field,
      );
    case "join":
      return [
        ...operation.relationship.left_column_ids.map((columnId) => ({
          table_id: operation.relationship.left_table_id,
          column_id: columnId,
        })),
        ...operation.relationship.right_column_ids.map((columnId) => ({
          table_id: operation.relationship.right_table_id,
          column_id: columnId,
        })),
      ];
    case "preaggregate":
    case "aggregate":
      return [...operation.group_by, ...operation.measures.map(({ field }) => field)];
    case "project":
      return [];
  }
}

export function hasLogicalPlanDataflow(
  operations: readonly LogicalOperation[],
  trustedRootTableId: string,
): boolean {
  const fieldKey = (tableId: string, columnId: string) =>
    `field:${canonicalizeJson([tableId, columnId])}`;
  const resultKey = (sourceId: string) => `result:${canonicalizeJson(sourceId)}`;
  type DataflowState = {
    readonly fields: Set<string>;
    readonly tableIds: Set<string>;
    readonly relationshipIds: Set<string>;
  };
  const outputs = new Map<string, DataflowState>();
  const consumedRelationshipIds = new Set<string>();
  let observedRootScan = false;
  for (const operation of operations) {
    switch (operation.operation) {
      case "scan":
        if (operation.table_id === trustedRootTableId) observedRootScan = true;
        outputs.set(operation.operation_id, {
          fields: new Set(
            operation.column_ids.map((columnId) => fieldKey(operation.table_id, columnId)),
          ),
          tableIds: new Set([operation.table_id]),
          relationshipIds: new Set(),
        });
        break;
      case "filter": {
        const input = outputs.get(operation.input_id);
        if (
          !input ||
          operation.predicates.some((predicate) => {
            const field = predicate.kind === "comparison" ? predicate.left : predicate.field;
            return !input.fields.has(fieldKey(field.table_id, field.column_id));
          })
        ) {
          return false;
        }
        outputs.set(operation.operation_id, input);
        break;
      }
      case "join": {
        const left = outputs.get(operation.left_input_id);
        const right = outputs.get(operation.right_input_id);
        if (!left || !right) return false;

        const hasOverlappingTableLineage = [...left.tableIds].some((tableId) =>
          right.tableIds.has(tableId),
        );
        const hasOverlappingEdgeOwnership = [...left.relationshipIds].some((relationshipId) =>
          right.relationshipIds.has(relationshipId),
        );
        if (
          hasOverlappingTableLineage ||
          hasOverlappingEdgeOwnership ||
          !left.tableIds.has(trustedRootTableId) ||
          right.tableIds.has(trustedRootTableId) ||
          consumedRelationshipIds.has(operation.relationship.relationship_id)
        ) {
          return false;
        }

        const directOrientation =
          left.tableIds.has(operation.relationship.left_table_id) &&
          !right.tableIds.has(operation.relationship.left_table_id) &&
          right.tableIds.has(operation.relationship.right_table_id) &&
          !left.tableIds.has(operation.relationship.right_table_id) &&
          operation.relationship.left_column_ids.every((columnId) =>
            left.fields.has(fieldKey(operation.relationship.left_table_id, columnId)),
          ) &&
          operation.relationship.right_column_ids.every((columnId) =>
            right.fields.has(fieldKey(operation.relationship.right_table_id, columnId)),
          );
        const reverseOrientation =
          left.tableIds.has(operation.relationship.right_table_id) &&
          !right.tableIds.has(operation.relationship.right_table_id) &&
          right.tableIds.has(operation.relationship.left_table_id) &&
          !left.tableIds.has(operation.relationship.left_table_id) &&
          operation.relationship.right_column_ids.every((columnId) =>
            left.fields.has(fieldKey(operation.relationship.right_table_id, columnId)),
          ) &&
          operation.relationship.left_column_ids.every((columnId) =>
            right.fields.has(fieldKey(operation.relationship.left_table_id, columnId)),
          );
        const directJoinTypeValid =
          directOrientation &&
          operation.join_type ===
            joinTypeForPreservedTable(operation.relationship, operation.relationship.left_table_id);
        const reverseJoinTypeValid =
          reverseOrientation &&
          operation.join_type ===
            joinTypeForPreservedTable(
              operation.relationship,
              operation.relationship.right_table_id,
            );
        if (!directJoinTypeValid && !reverseJoinTypeValid) {
          return false;
        }
        consumedRelationshipIds.add(operation.relationship.relationship_id);
        outputs.set(operation.operation_id, {
          fields: new Set([...left.fields, ...right.fields]),
          tableIds: new Set([...left.tableIds, ...right.tableIds]),
          relationshipIds: new Set([
            ...left.relationshipIds,
            ...right.relationshipIds,
            operation.relationship.relationship_id,
          ]),
        });
        break;
      }
      case "preaggregate":
      case "aggregate": {
        const input = outputs.get(operation.input_id);
        if (
          !input ||
          operation.group_by.some(
            ({ table_id, column_id }) => !input.fields.has(fieldKey(table_id, column_id)),
          ) ||
          operation.measures.some(
            ({ field }) => !input.fields.has(fieldKey(field.table_id, field.column_id)),
          )
        ) {
          return false;
        }
        outputs.set(operation.operation_id, {
          fields: new Set([
            ...operation.group_by.flatMap(({ table_id, column_id }) => [
              fieldKey(table_id, column_id),
              resultKey(column_id),
            ]),
            ...operation.measures.map(({ alias }) => resultKey(alias)),
          ]),
          tableIds: input.tableIds,
          relationshipIds: input.relationshipIds,
        });
        break;
      }
      case "project": {
        const input = outputs.get(operation.input_id);
        if (
          !input ||
          operation.columns.some(({ source_id }) => !input.fields.has(resultKey(source_id)))
        ) {
          return false;
        }
        outputs.set(operation.operation_id, {
          fields: new Set(operation.columns.map(({ alias }) => resultKey(alias))),
          tableIds: input.tableIds,
          relationshipIds: input.relationshipIds,
        });
        break;
      }
    }
  }
  return observedRootScan;
}

async function verifyLogicalPlanLineage(
  logicalPlan: LogicalPlanPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<QueryContractPayload> {
  const semanticQuery = requireArtifactType(
    await resolveAuthoritativeL2(logicalPlan.semantic_query_ref, authority),
    "SemanticQuery",
  );
  const queryContract = await verifySemanticQueryLineage(semanticQuery, authority);
  const groundingPackage = requireArtifactType(
    await resolveAuthoritativeL2(semanticQuery.grounding_package_ref, authority),
    "GroundingPackage",
  );
  assertRootedTopologicalDag(logicalPlan);
  if (
    logicalPlan.grounding_hash !== semanticQuery.grounding_hash ||
    !sameCanonicalJson(logicalPlan.parameters, semanticQuery.parameters)
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan.grounding_hash/parameters 必须与 SemanticQuery 一致。",
    );
  }
  const expectedSignature = {
    metric_id: semanticQuery.metric.metric_id,
    dimension_ids: semanticQuery.dimensions.map(({ dimension_id }) => dimension_id),
    grain: queryContract.grain,
    unit: queryContract.unit,
    time_semantics: queryContract.time_range.semantics,
  };
  if (!sameCanonicalJson(logicalPlan.semantic_signature, expectedSignature)) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan.semantic_signature 必须与 SemanticQuery/QueryContract 一致。",
    );
  }
  const expectedPredicates: SemanticPredicate[] = [
    ...semanticQuery.predicates,
    {
      kind: "comparison",
      left: semanticQuery.time_predicate.field,
      operator: "gte",
      right: { parameter_key: semanticQuery.time_predicate.lower.parameter_key },
      authority: "time",
    },
    {
      kind: "comparison",
      left: semanticQuery.time_predicate.field,
      operator: "lt",
      right: { parameter_key: semanticQuery.time_predicate.upper.parameter_key },
      authority: "time",
    },
  ];
  const observedPredicates = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "filter" ? operation.predicates : [],
  );
  if (
    !sameCanonicalJson(sortedCanonical(observedPredicates), sortedCanonical(expectedPredicates))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan Filter 必须完整且仅消费 SemanticQuery 与半开时间 Predicate。",
    );
  }
  const measures = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "aggregate" || operation.operation === "preaggregate"
      ? operation.measures
      : [],
  );
  if (
    measures.length === 0 ||
    measures.some(
      (measure) =>
        !sameCanonicalJson(measure, {
          metric_id: semanticQuery.metric.metric_id,
          function: semanticQuery.metric.aggregation,
          field: {
            table_id: semanticQuery.metric.table_id,
            column_id: semanticQuery.metric.column_id,
          },
          alias: semanticQuery.metric.metric_id,
          unit: semanticQuery.metric.unit,
          null_policy: semanticQuery.metric.null_policy,
          distinct: semanticQuery.metric.aggregation === "count_distinct",
        }),
    )
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan Measure 必须与 SemanticQuery.metric 的聚合/Unit/Null/Distinct 语义一致。",
    );
  }
  const allowedFields = new Set(
    groundingPackage.allowed_schema.tables.flatMap((table) =>
      table.columns.map((column) =>
        canonicalizeJson({
          table_id: table.table_id,
          column_id: column.column_id,
        }),
      ),
    ),
  );
  if (
    logicalPlan.operations
      .flatMap(operationFieldReferences)
      .some((field) => !allowedFields.has(canonicalizeJson(field)))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan Operation 的字段必须全部属于 GroundingPackage Allowed Schema。",
    );
  }
  const observedRelationships = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "join" ? [operation.relationship] : [],
  );
  if (
    !sameCanonicalJson(
      sortedCanonical(observedRelationships),
      sortedCanonical(groundingPackage.join_closure.edges),
    )
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan Join 必须精确消费 GroundingPackage Join Closure。",
    );
  }
  const observedPreaggregations = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "preaggregate"
      ? [
          {
            table_id: operation.measures[0]?.field.table_id ?? "",
            group_by_column_ids: operation.group_by.map(({ column_id }) => column_id),
            measure_column_ids: operation.measures.map(({ field }) => field.column_id),
            reason_code: operation.reason_code,
          },
        ]
      : [],
  );
  if (
    !sameCanonicalJson(
      sortedCanonical(observedPreaggregations),
      sortedCanonical(groundingPackage.join_closure.preaggregations),
    )
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan Preaggregation 必须精确消费 GroundingPackage Fan-out Proof。",
    );
  }
  if (
    !hasLogicalPlanDataflow(logicalPlan.operations, groundingPackage.join_closure.root_table_id)
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan Operation Dataflow 引用了上游未产生的字段或结果。",
    );
  }
  const finalAggregates = logicalPlan.operations.filter(
    (operation) => operation.operation === "aggregate",
  );
  const expectedGroupBy = semanticQuery.dimensions.map((dimension) => ({
    table_id: dimension.table_id,
    column_id: dimension.column_id,
  }));
  const rootOperation = logicalPlan.operations.find(
    ({ operation_id }) => operation_id === logicalPlan.root_operation_id,
  );
  const expectedProjection = [
    ...semanticQuery.dimensions.map((dimension) => ({
      source_kind: "group",
      source_id: dimension.column_id,
      alias: dimension.dimension_id,
    })),
    {
      source_kind: "measure",
      source_id: semanticQuery.metric.metric_id,
      alias: semanticQuery.metric.metric_id,
    },
  ];
  if (
    finalAggregates.length !== 1 ||
    !finalAggregates[0] ||
    !sameCanonicalJson(finalAggregates[0].group_by, expectedGroupBy) ||
    rootOperation?.operation !== "project" ||
    rootOperation.input_id !== finalAggregates[0].operation_id ||
    !sameCanonicalJson(rootOperation.columns, expectedProjection)
  ) {
    throw new ArtifactSemanticAuthorityError(
      "LogicalPlan Group/Project 必须与 SemanticQuery 结果绑定一致。",
    );
  }
  return queryContract;
}

async function verifySqlArtifactLineage(
  sqlArtifact: SqlArtifactPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<Extract<L2ArtifactPayload, { artifact_type: "QueryContract" }>> {
  const observedQueryHash = await computeSqlArtifactQueryHash(sqlArtifact);
  if (observedQueryHash !== sqlArtifact.query_hash) {
    throw new ArtifactSemanticAuthorityError(
      "SqlArtifact.query_hash 与 dialect/sql/parameters 的规范内容不匹配。",
    );
  }
  const logicalPlan = requireArtifactType(
    await resolveAuthoritativeL2(sqlArtifact.logical_plan_ref, authority),
    "LogicalPlan",
  );
  return verifyLogicalPlanLineage(logicalPlan, authority);
}

async function verifyGateReceiptSemantics(
  gateReceipt: GateReceiptPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<SqlArtifactPayload> {
  const sqlArtifact = requireArtifactType(
    await resolveAuthoritativeL2(gateReceipt.sql_artifact_ref, authority),
    "SqlArtifact",
  );
  await verifySqlArtifactLineage(sqlArtifact, authority);
  if (gateReceipt.execution_receipt_ref) {
    const execution = requireArtifactType(
      await resolveAuthoritativeL2(gateReceipt.execution_receipt_ref, authority),
      "ExecutionReceipt",
    );
    await verifyExecutionReceiptSemantics(execution, authority);
    requireSameReference(
      execution.sql_artifact_ref,
      gateReceipt.sql_artifact_ref,
      `${gateReceipt.gate} GateReceipt 与 ExecutionReceipt 必须绑定同一 SqlArtifact。`,
    );
  }
  return sqlArtifact;
}

async function verifyExecutionPermitSemantics(
  permit: ExecutionPermitPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<SqlArtifactPayload> {
  const sqlArtifact = requireArtifactType(
    await resolveAuthoritativeL2(permit.sql_artifact_ref, authority),
    "SqlArtifact",
  );
  await verifySqlArtifactLineage(sqlArtifact, authority);
  const gateReceipts = await Promise.all(
    permit.gate_receipt_refs.map(async (reference) => {
      const receipt = requireArtifactType(
        await resolveAuthoritativeL2(reference, authority),
        "GateReceipt",
      );
      await verifyGateReceiptSemantics(receipt, authority);
      return receipt;
    }),
  );
  const observedGates = new Set(gateReceipts.map(({ gate }) => gate));
  if (
    gateReceipts.length !== TEXT2SQL_PRE_EXECUTION_GATES.length ||
    observedGates.size !== TEXT2SQL_PRE_EXECUTION_GATES.length ||
    TEXT2SQL_PRE_EXECUTION_GATES.some((gate) => !observedGates.has(gate))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "ExecutionPermit 必须且只能消费五道执行前 GateReceipt。",
    );
  }
  for (const receipt of gateReceipts) {
    requireSameReference(
      receipt.sql_artifact_ref,
      permit.sql_artifact_ref,
      "ExecutionPermit 的全部 GateReceipt 必须绑定同一 SqlArtifact。",
    );
    if (receipt.verdict !== "PASS") {
      throw new ArtifactSemanticAuthorityError(
        "ExecutionPermit 只能消费五道全部 PASS 的执行前 GateReceipt。",
      );
    }
  }
  return sqlArtifact;
}

async function verifyExecutionReceiptSemantics(
  execution: ExecutionReceiptPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const permit = requireArtifactType(
    await resolveAuthoritativeL2(execution.execution_permit_ref, authority),
    "ExecutionPermit",
  );
  const sqlArtifact = await verifyExecutionPermitSemantics(permit, authority);
  requireSameReference(
    permit.sql_artifact_ref,
    execution.sql_artifact_ref,
    "ExecutionReceipt 与 ExecutionPermit 必须绑定同一 SqlArtifact。",
  );
  const queryContract = await verifySqlArtifactLineage(sqlArtifact, authority);
  if (execution.query_hash !== sqlArtifact.query_hash) {
    throw new ArtifactSemanticAuthorityError(
      "ExecutionReceipt.query_hash 必须与已验证 SqlArtifact.query_hash 一致。",
    );
  }
  if (execution.datasource_id !== queryContract.datasource_id) {
    throw new ArtifactSemanticAuthorityError(
      "ExecutionReceipt.datasource_id 必须与上游 QueryContract.datasource_id 一致。",
    );
  }
}

async function verifyValidationReceiptSemantics(
  validation: ValidationReceiptPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<ExecutionReceiptPayload> {
  const execution = requireArtifactType(
    await resolveAuthoritativeL2(validation.execution_receipt_ref, authority),
    "ExecutionReceipt",
  );
  await verifyExecutionReceiptSemantics(execution, authority);
  requireSameReference(
    execution.sql_artifact_ref,
    validation.sql_artifact_ref,
    "ValidationReceipt 与 ExecutionReceipt 必须绑定同一 SqlArtifact。",
  );
  const gateReceipts = await Promise.all(
    validation.gate_receipt_refs.map(async (reference) => {
      const receipt = requireArtifactType(
        await resolveAuthoritativeL2(reference, authority),
        "GateReceipt",
      );
      await verifyGateReceiptSemantics(receipt, authority);
      return receipt;
    }),
  );
  const observedGates = new Set(gateReceipts.map(({ gate }) => gate));
  if (
    gateReceipts.length !== TEXT2SQL_GATES.length ||
    observedGates.size !== TEXT2SQL_GATES.length ||
    TEXT2SQL_GATES.some((gate) => !observedGates.has(gate))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "ValidationReceipt 必须且只能消费七道当前 GateReceipt。",
    );
  }
  for (const receipt of gateReceipts) {
    requireSameReference(
      receipt.sql_artifact_ref,
      validation.sql_artifact_ref,
      "ValidationReceipt 的全部 GateReceipt 必须绑定同一 SqlArtifact。",
    );
    if (receipt.verdict !== "PASS") {
      throw new ArtifactSemanticAuthorityError(
        "ValidationReceipt 只能在七道 Gate 全部 PASS 后封口。",
      );
    }
    if (
      (receipt.gate === "EXECUTION" || receipt.gate === "RESULT") &&
      receipt.execution_receipt_ref &&
      artifactReferenceIdentity(receipt.execution_receipt_ref) !==
        artifactReferenceIdentity(validation.execution_receipt_ref)
    ) {
      throw new ArtifactSemanticAuthorityError(
        `${receipt.gate} GateReceipt 必须绑定当前 ValidationReceipt 的 ExecutionReceipt。`,
      );
    }
  }
  return execution;
}

async function verifyQueryEvidenceSemantics(
  evidence: QueryEvidencePayload,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const validation = requireArtifactType(
    await resolveAuthoritativeL2(evidence.validation_receipt_ref, authority),
    "ValidationReceipt",
  );
  const execution = await verifyValidationReceiptSemantics(validation, authority);
  requireSameReference(
    validation.execution_receipt_ref,
    evidence.execution_receipt_ref,
    "QueryEvidence 与 ValidationReceipt 必须绑定同一 ExecutionReceipt。",
  );
  if (evidence.result_hash !== execution.result_hash) {
    throw new ArtifactSemanticAuthorityError(
      "QueryEvidence.result_hash 必须与 ExecutionReceipt.result_hash 一致。",
    );
  }
  const sqlArtifact = requireArtifactType(
    await resolveAuthoritativeL2(validation.sql_artifact_ref, authority),
    "SqlArtifact",
  );
  const queryContract = await verifySqlArtifactLineage(sqlArtifact, authority);
  const expectedInvariantIds = new Set(queryContract.result_contract.invariant_ids);
  const observedInvariantIds = new Set(
    evidence.invariant_verdicts.map(({ invariant_id }) => invariant_id),
  );
  if (
    observedInvariantIds.size !== expectedInvariantIds.size ||
    [...expectedInvariantIds].some((invariantId) => !observedInvariantIds.has(invariantId))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "QueryEvidence.invariant_verdicts 必须与上游 QueryContract.result_contract.invariant_ids 精确闭合。",
    );
  }
}

async function verifyArtifactSuccessSemantics(
  document: L2ArtifactDocument,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  switch (document.payload.artifact_type) {
    case "ResearchBrief":
      requireArtifactType(
        await resolveAuthoritativeL2(document.payload.question_frame_ref, authority),
        "QuestionFrame",
      );
      return;
    case "HypothesisSet":
      requireArtifactType(
        await resolveAuthoritativeL2(document.payload.research_brief_ref, authority),
        "ResearchBrief",
      );
      return;
    case "EvidencePlan":
      await verifyEvidencePlanSemantics(document.payload, authority);
      return;
    case "QueryContract":
      await verifyQueryContractSemantics(document.payload, authority);
      return;
    case "GroundingPackage":
      await verifyGroundingPackageSemantics(document.payload, authority);
      return;
    case "SemanticQuery":
      await verifySemanticQueryLineage(document.payload, authority);
      return;
    case "LogicalPlan":
      await verifyLogicalPlanLineage(document.payload, authority);
      return;
    case "SqlArtifact":
      await verifySqlArtifactLineage(document.payload, authority);
      return;
    case "GateReceipt":
      await verifyGateReceiptSemantics(document.payload, authority);
      return;
    case "ExecutionPermit":
      await verifyExecutionPermitSemantics(document.payload, authority);
      return;
    case "ExecutionReceipt":
      await verifyExecutionReceiptSemantics(document.payload, authority);
      return;
    case "ValidationReceipt":
      await verifyValidationReceiptSemantics(document.payload, authority);
      return;
    case "QueryEvidence":
      await verifyQueryEvidenceSemantics(document.payload, authority);
      return;
    case "AtomicClaim": {
      if (document.payload.support_state === "SUPPORTED") {
        await Promise.all(
          document.payload.evidence_refs.map((reference) =>
            requirePassingEvidence(reference, authority),
          ),
        );
      } else {
        await Promise.all(
          document.payload.evidence_refs.map((reference) =>
            resolveAuthoritativeL2(reference, authority).then((evidence) =>
              requireArtifactType(evidence, "QueryEvidence"),
            ),
          ),
        );
      }
      return;
    }
    case "EvidenceRelation":
      await Promise.all([
        resolveAuthoritativeL2(document.payload.claim_ref, authority).then((claim) =>
          requireArtifactType(claim, "AtomicClaim"),
        ),
        resolveAuthoritativeL2(document.payload.evidence_ref, authority).then((evidence) =>
          requireArtifactType(evidence, "QueryEvidence"),
        ),
      ]);
      return;
    case "AnalysisReport":
      await Promise.all(
        document.payload.claim_refs.map((reference) =>
          resolveAuthoritativeL2(reference, authority).then((claim) =>
            requireArtifactType(claim, "AtomicClaim"),
          ),
        ),
      );
      return;
    case "ReportReadyCertificate": {
      const report = requireArtifactType(
        await resolveAuthoritativeL2(document.payload.report_ref, authority),
        "AnalysisReport",
      );
      const claims = await Promise.all(
        report.claim_refs.map(async (reference) =>
          requireArtifactType(await resolveAuthoritativeL2(reference, authority), "AtomicClaim"),
        ),
      );
      if (claims.some(({ support_state }) => support_state !== "SUPPORTED")) {
        throw new ArtifactSemanticAuthorityError(
          "ReportReadyCertificate 不能覆盖 CONFLICTED 或 UNSUPPORTED Claim。",
        );
      }
      const certificateEvidence = new Set(
        document.payload.evidence_refs.map(artifactReferenceIdentity),
      );
      const claimEvidence = claims.flatMap(({ evidence_refs }) => evidence_refs);
      if (
        claimEvidence.some(
          (reference) => !certificateEvidence.has(artifactReferenceIdentity(reference)),
        )
      ) {
        throw new ArtifactSemanticAuthorityError(
          "ReportReadyCertificate 必须覆盖 Report 中全部 Claim Evidence。",
        );
      }
      await Promise.all(
        claimEvidence.map((reference) => requirePassingEvidence(reference, authority)),
      );
      return;
    }
    case "QuestionFrame":
      return;
  }
}

function committerCapabilityClaimFromDocument(
  document: L2ArtifactDocument,
): ArtifactCommitterCapabilityClaim {
  return {
    kind: "artifact-committer",
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    attempt_id: document.envelope.attempt_id,
    artifact_type: document.envelope.artifact_type,
    producer_id: document.envelope.producer.id,
    policy_version: document.envelope.policy_version,
  };
}

/**
 * 在调用者提供的当前持久化上下文中递归核验一条 L2 Artifact Revision。
 *
 * 返回值是深冻结的普通快照，不携带可被其他 API 当作跨事务 Authority 的品牌。
 */
async function verifyL2ArtifactDocumentRevision(
  document: L2ArtifactDocument,
  authority: L2ArtifactAuthorityContext,
): Promise<L2ArtifactDocument> {
  if (document.envelope.status !== "COMMITTED") {
    throw new ArtifactAuthorityError(
      `${document.envelope.status} 不是当前权威 Artifact，只有 COMMITTED Revision 可以授权。`,
    );
  }
  const observedHash = await computeL2ArtifactContentHash(document);
  if (observedHash !== document.envelope.content_hash) {
    throw new ArtifactIntegrityError(
      `Artifact ${document.envelope.artifact_id} 的声明 Hash 与规范化内容不匹配。`,
    );
  }
  const currentReference = artifactReferenceFromDocument(document);
  if (!(await authority.verifyCommitted(currentReference))) {
    throw new ArtifactAuthorityError(
      `Artifact ${document.envelope.artifact_id} 的当前 Revision 尚未由持久化 Authority 提交。`,
    );
  }
  if (
    !(await authority.verifyCommitterCapability(committerCapabilityClaimFromDocument(document)))
  ) {
    throw new ArtifactAuthorityError(
      `Artifact ${document.envelope.artifact_id} 的服务端提交者能力无效或不匹配。`,
    );
  }
  const authorityReferences = [
    ...(document.envelope.parent_ref ? [document.envelope.parent_ref] : []),
    ...document.envelope.input_refs,
  ];
  const inputVerdicts = await Promise.all(
    authorityReferences.map((reference) => authority.verifyCommitted(reference)),
  );
  if (inputVerdicts.some((verdict) => !verdict)) {
    throw new ArtifactInputAuthorityError("Artifact 引用了未提交或不存在的输入。");
  }
  await verifyArtifactSuccessSemantics(document, authority);
  return deepFreeze(document);
}

/**
 * 在调用者提供的当前持久化上下文中递归核验一条 L2 Artifact Revision。
 *
 * 返回值是深冻结的普通快照，不携带可被其他 API 当作跨事务 Authority 的品牌。
 * 同一次根校验只复用本次调用内已核验的 Content-Addressed Revision；缓存不会跨根调用或事务。
 */
export async function verifyL2ArtifactDocument(
  input: unknown,
  authority: L2ArtifactAuthorityContext,
): Promise<L2ArtifactDocument> {
  const document = l2ArtifactDocumentSchema.parse(input);
  const identity = artifactReferenceIdentity(artifactReferenceFromDocument(document));
  const state = l2ArtifactVerificationStates.get(authority) ?? {
    verified: new Map<string, L2ArtifactDocument>(),
    path: new Set<string>(),
  };
  if (state.path.has(identity)) {
    throw new ArtifactSemanticAuthorityError("L2 Artifact 的 Parent/Input 引用不能形成循环。");
  }
  const verified = state.verified.get(identity);
  if (verified) return verified;

  const scopedAuthority = scopeL2ArtifactAuthority(authority, state, identity);
  const snapshot = await verifyL2ArtifactDocumentRevision(document, scopedAuthority);
  state.verified.set(identity, snapshot);
  return snapshot;
}

export type { L2ArtifactPayload };
export type L2ArtifactDocument = z.infer<typeof l2ArtifactDocumentSchema>;
