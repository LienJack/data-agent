import { z } from "zod";
import { agentProfileIdSchema } from "../agents/subagent-discovery.js";
import {
  canonicalizeJson,
  contentHashSchema,
  immutableIdSchema,
  postgresqlOutputAliasSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { artifactReferenceFor, artifactReferenceSchema } from "./envelope.js";
import {
  artifactWorkspaceProjectionSchema,
  artifactWorkspaceTableProjectionSchema,
} from "./export-receipt.js";
import { verifySemanticQueryContext } from "./semantic-query-context.js";

const productArtifactReferenceSchema = z.union([
  artifactReferenceFor("SqlArtifact"),
  artifactReferenceFor("QueryEvidence"),
  artifactReferenceFor("AnalysisReport"),
  artifactReferenceFor("SemanticQueryContext"),
]);

const queryEvidenceResourceRefSchema = z.strictObject({
  resource_id: immutableIdSchema,
  resource_revision: z.number().int().positive().safe(),
  resource_hash: contentHashSchema,
});

const queryEvidencePhysicalSourceSchema = z.strictObject({
  schema_name: z.string().min(1).max(256),
  relation_name: z.string().min(1).max(256),
  column_name: z.string().min(1).max(256),
  formatted_type: z.string().min(1).max(2_048),
  nullable: z.boolean(),
});

const queryEvidenceColumnBindingSchema = z
  .strictObject({
    output_name: postgresqlOutputAliasSchema,
    logical_type: z.enum(["NUMBER", "STRING", "DATE", "DATETIME", "BOOLEAN"]),
    nullable: z.boolean(),
    semantic_role: z.enum(["METRIC", "DIMENSION", "PHYSICAL_COLUMN"]),
    semantic_object_id: versionIdentifierSchema,
    formula_hash: contentHashSchema.nullable(),
    aggregate: z.enum(["sum", "count", "count_distinct", "avg", "min", "max"]).nullable(),
    grain: z.strictObject({
      grain_id: versionIdentifierSchema,
      granularity: z.enum(["atomic", "hour", "day", "week", "month", "quarter", "year"]),
    }),
    physical_sources: z.array(queryEvidencePhysicalSourceSchema).min(1).max(64),
  })
  .superRefine((column, ctx) => {
    if (
      (column.semantic_role === "METRIC" &&
        (column.formula_hash === null || column.aggregate === null)) ||
      ((column.semantic_role === "DIMENSION" || column.semantic_role === "PHYSICAL_COLUMN") &&
        (column.formula_hash !== null || column.aggregate !== null))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "QueryEvidence metric/dimension binding shape is invalid.",
      });
    }
    const identities = column.physical_sources.map((source) =>
      canonicalizeJson([source.schema_name, source.relation_name, source.column_name]),
    );
    if (
      identities.some((identity, index) => index > 0 && identity <= (identities[index - 1] ?? ""))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "QueryEvidence physical sources must be unique and canonically sorted.",
      });
    }
  });

const queryEvidenceSemanticBindingDraftSchema = z
  .strictObject({
    protocol_version: z.literal("query-evidence-semantic-binding@1.0.0"),
    semantic_release_ref: queryEvidenceResourceRefSchema.extend({
      datasource_id: immutableIdSchema,
      semantic_generation: z.number().int().positive().safe(),
      publication_status: z.literal("PUBLISHED"),
    }),
    semantic_context_ref: z.strictObject({
      package_id: immutableIdSchema,
      package_hash: contentHashSchema,
      receipt_id: immutableIdSchema,
      receipt_hash: contentHashSchema,
    }),
    schema_snapshot_ref: queryEvidenceResourceRefSchema.extend({
      datasource_id: immutableIdSchema,
      semantic_release_id: immutableIdSchema,
      semantic_generation: z.number().int().positive().safe(),
    }),
    datasource_ref: queryEvidenceResourceRefSchema,
    target_binding_hash: contentHashSchema,
    columns: z.array(queryEvidenceColumnBindingSchema).min(1).max(128),
    time_window: z
      .strictObject({
        dimension_id: versionIdentifierSchema,
        start: z.string().min(1).max(128),
        end: z.string().min(1).max(128),
        semantics: z.literal("HALF_OPEN"),
        timezone: z.string().min(1).max(64).nullable(),
      })
      .nullable(),
  })
  .superRefine((binding, ctx) => {
    if (
      binding.semantic_release_ref.datasource_id !== binding.datasource_ref.resource_id ||
      binding.schema_snapshot_ref.datasource_id !== binding.datasource_ref.resource_id ||
      binding.schema_snapshot_ref.semantic_release_id !==
        binding.semantic_release_ref.resource_id ||
      binding.schema_snapshot_ref.semantic_generation !==
        binding.semantic_release_ref.semantic_generation
    ) {
      ctx.addIssue({
        code: "custom",
        message: "QueryEvidence authority resources must form one exact binding.",
      });
    }
    const outputNames = binding.columns.map(({ output_name: outputName }) => outputName);
    if (new Set(outputNames).size !== outputNames.length) {
      ctx.addIssue({ code: "custom", message: "QueryEvidence output bindings must be unique." });
    }
  });

export const queryEvidenceSemanticBindingSchema = queryEvidenceSemanticBindingDraftSchema.extend({
  binding_hash: contentHashSchema,
});
export type QueryEvidenceSemanticBinding = z.infer<typeof queryEvidenceSemanticBindingSchema>;

export async function buildQueryEvidenceSemanticBinding(input: unknown) {
  const material = queryEvidenceSemanticBindingDraftSchema.parse(input);
  return queryEvidenceSemanticBindingSchema.parse({
    ...material,
    binding_hash: await sha256ContentHash({
      hash_domain: "query-evidence-semantic-binding@1.0.0",
      value: material,
    }),
  });
}

export async function verifyQueryEvidenceSemanticBinding(input: unknown) {
  const binding = queryEvidenceSemanticBindingSchema.parse(input);
  const { binding_hash: observedHash, ...material } = binding;
  if (
    observedHash !==
    (await sha256ContentHash({
      hash_domain: "query-evidence-semantic-binding@1.0.0",
      value: queryEvidenceSemanticBindingDraftSchema.parse(material),
    }))
  ) {
    throw new TypeError("QUERY_EVIDENCE_SEMANTIC_BINDING_HASH_MISMATCH");
  }
  return binding;
}

export function computePublishedMetricFormulaHash(input: {
  readonly semantic_release_hash: string;
  readonly metric: Readonly<{
    metric_id: string;
    aggregation: string;
    formula: unknown;
    dependency_column_ids: readonly string[];
  }>;
  readonly formula: unknown | null;
}) {
  return sha256ContentHash({
    semantic_release_hash: input.semantic_release_hash,
    metric: {
      metric_id: input.metric.metric_id,
      aggregation: input.metric.aggregation,
      formula: input.metric.formula,
      dependency_column_ids: input.metric.dependency_column_ids,
    },
    formula: input.formula,
  });
}

const productTeamArtifactProvenanceSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("TEXT2SQL_CANDIDATE"),
      candidate_hash: contentHashSchema,
      parameters_hash: contentHashSchema,
      parameter_count: z.number().int().nonnegative().max(256),
      datasource_ref: z.strictObject({
        resource_id: immutableIdSchema,
        resource_revision: z.number().int().positive().safe(),
        resource_hash: contentHashSchema,
      }),
      schema_snapshot_ref: z.strictObject({
        resource_id: immutableIdSchema,
        resource_hash: contentHashSchema,
      }),
      semantic_context_ref: z.strictObject({
        package_id: immutableIdSchema,
        package_hash: contentHashSchema,
      }),
      semantic_query_context_ref: artifactReferenceFor("SemanticQueryContext")
        .nullable()
        .optional(),
      semantic_query_context_hash: contentHashSchema.nullable().optional(),
      target_binding_hash: contentHashSchema,
    })
    .superRefine((provenance, ctx) => {
      const hasReference = Object.hasOwn(provenance, "semantic_query_context_ref");
      const hasHash = Object.hasOwn(provenance, "semantic_query_context_hash");
      if (
        hasReference !== hasHash ||
        (hasReference &&
          (provenance.semantic_query_context_ref === null) !==
            (provenance.semantic_query_context_hash === null))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Text2SQL semantic query context reference and hash must be bound together.",
        });
      }
    }),
  z.strictObject({
    kind: z.literal("GOVERNED_QUERY_RESULT"),
    query_id: immutableIdSchema,
    request_hash: contentHashSchema,
    result_hash: contentHashSchema,
    row_count: z.number().int().nonnegative().safe(),
    byte_count: z.number().int().nonnegative().safe(),
    elapsed_ms: z.number().nonnegative().finite(),
    truncated: z.literal(false),
    semantic_binding: queryEvidenceSemanticBindingSchema,
  }),
  z.strictObject({
    kind: z.literal("ACCEPTED_TABLE_INPUT"),
    acceptance_id: immutableIdSchema,
    accepted_by_principal_id: immutableIdSchema,
    accepted_at: timestampSchema,
    table_hash: contentHashSchema,
    row_count: z.number().int().nonnegative().safe(),
  }),
]);

const acceptedTableInputProvenanceMaterialSchema = z.strictObject({
  acceptance_id: immutableIdSchema,
  accepted_by_principal_id: immutableIdSchema,
  accepted_at: timestampSchema,
  projection: artifactWorkspaceTableProjectionSchema,
});

export async function computeAcceptedTableInputHash(input: unknown) {
  const material = acceptedTableInputProvenanceMaterialSchema.parse(input);
  return sha256ContentHash({
    hash_domain: "accepted-table-input@1.0.0",
    value: material.projection,
  });
}

export async function buildAcceptedTableInputProvenance(input: unknown) {
  const material = acceptedTableInputProvenanceMaterialSchema.parse(input);
  return productTeamArtifactProvenanceSchema.parse({
    kind: "ACCEPTED_TABLE_INPUT",
    acceptance_id: material.acceptance_id,
    accepted_by_principal_id: material.accepted_by_principal_id,
    accepted_at: material.accepted_at,
    table_hash: await computeAcceptedTableInputHash(material),
    row_count: material.projection.total_rows,
  });
}

async function verifyAcceptedTableInput(document: ProductTeamArtifactDocument): Promise<void> {
  if (
    document.artifact_ref.artifact_type !== "QueryEvidence" ||
    document.provenance?.kind !== "ACCEPTED_TABLE_INPUT" ||
    document.projection.kind !== "TABLE"
  ) {
    return;
  }
  if (
    document.provenance.table_hash !==
      (await computeAcceptedTableInputHash({
        acceptance_id: document.provenance.acceptance_id,
        accepted_by_principal_id: document.provenance.accepted_by_principal_id,
        accepted_at: document.provenance.accepted_at,
        projection: document.projection,
      })) ||
    document.provenance.row_count !== document.projection.total_rows ||
    document.projection.rows.length !== document.projection.total_rows
  ) {
    throw new TypeError("ACCEPTED_TABLE_INPUT_HASH_MISMATCH");
  }
}

const productTeamArtifactDraftSchema = z
  .strictObject({
    schema_version: z.literal("product-team-artifact@2.0.0"),
    artifact_ref: productArtifactReferenceSchema,
    profile_id: agentProfileIdSchema,
    task_id: immutableIdSchema,
    source_refs: z.array(artifactReferenceSchema).max(16),
    provenance: productTeamArtifactProvenanceSchema.nullable(),
    projection: artifactWorkspaceProjectionSchema,
    committed_at: timestampSchema,
  })
  .superRefine((document, ctx) => {
    const expectedKind =
      document.artifact_ref.artifact_type === "SqlArtifact"
        ? "SQL"
        : document.artifact_ref.artifact_type === "QueryEvidence"
          ? "TABLE"
          : document.artifact_ref.artifact_type === "SemanticQueryContext"
            ? "SEMANTIC_CONTEXT"
            : "REPORT";
    if (document.projection.kind !== expectedKind) {
      ctx.addIssue({
        code: "custom",
        message: "Product Team Artifact type 与安全 Preview projection 不匹配。",
        path: ["projection", "kind"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "SqlArtifact" &&
      (document.provenance?.kind !== "TEXT2SQL_CANDIDATE" || document.source_refs.length !== 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SqlArtifact 必须封存 Text2SQL candidate provenance 且不得伪造上游来源。",
        path: ["provenance"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "SqlArtifact" &&
      document.provenance?.kind === "TEXT2SQL_CANDIDATE" &&
      document.provenance.semantic_query_context_ref &&
      (document.provenance.semantic_query_context_ref.app_id !== document.artifact_ref.app_id ||
        document.provenance.semantic_query_context_ref.tenant_id !==
          document.artifact_ref.tenant_id ||
        document.provenance.semantic_query_context_ref.environment !==
          document.artifact_ref.environment ||
        document.provenance.semantic_query_context_ref.run_id !== document.artifact_ref.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Text2SQL semantic query context must belong to the same Scope and Run.",
        path: ["provenance", "semantic_query_context_ref"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "QueryEvidence" &&
      !(
        (document.provenance?.kind === "GOVERNED_QUERY_RESULT" &&
          document.source_refs.length === 1 &&
          document.source_refs[0]?.artifact_type === "SqlArtifact") ||
        (document.provenance?.kind === "ACCEPTED_TABLE_INPUT" && document.source_refs.length === 0)
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "QueryEvidence 必须封存查询 receipt 并引用一个 SqlArtifact，或封存完整的已验收表格输入。",
        path: ["provenance"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "QueryEvidence" &&
      document.projection.kind === "TABLE" &&
      document.provenance?.kind === "GOVERNED_QUERY_RESULT"
    ) {
      const projectionColumns = document.projection.columns;
      const bindingColumns = document.provenance.semantic_binding.columns;
      const orderedColumnNames = projectionColumns.map(({ key }) => key);
      const sortedColumnNames = [...orderedColumnNames].sort();
      const bindingMatchesProjection =
        projectionColumns.length === bindingColumns.length &&
        projectionColumns.every((column, index) => {
          const binding = bindingColumns[index];
          const expectedProjectionType =
            binding?.logical_type === "NUMBER"
              ? "NUMBER"
              : binding?.logical_type === "BOOLEAN"
                ? "BOOLEAN"
                : "STRING";
          return binding?.output_name === column.key && expectedProjectionType === column.data_type;
        });
      const rowsMatchBinding = document.projection.rows.every((row) => {
        const rowKeys = Object.keys(row).sort();
        if (
          rowKeys.length !== orderedColumnNames.length ||
          rowKeys.some((key, index) => key !== sortedColumnNames[index])
        ) {
          return false;
        }
        return bindingColumns.every((binding) => {
          const value = row[binding.output_name];
          if (value === null) return binding.nullable;
          if (value === undefined) return false;
          if (binding.logical_type === "NUMBER") {
            return typeof value === "number" && Number.isFinite(value);
          }
          if (binding.logical_type === "BOOLEAN") return typeof value === "boolean";
          return typeof value === "string";
        });
      });
      if (
        !bindingMatchesProjection ||
        !rowsMatchBinding ||
        document.provenance.row_count !== document.projection.total_rows ||
        document.projection.rows.length !== document.provenance.row_count
      ) {
        ctx.addIssue({
          code: "custom",
          message: "QueryEvidence projection must match its exact semantic binding and receipt.",
          path: ["provenance", "semantic_binding"],
        });
      }
    }
    if (document.artifact_ref.artifact_type === "AnalysisReport" && document.provenance !== null) {
      ctx.addIssue({
        code: "custom",
        message: "AnalysisReport 的数值来源只由 source_refs 表达。",
        path: ["provenance"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "SemanticQueryContext" &&
      (document.provenance !== null || document.source_refs.length !== 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SemanticQueryContext authority is carried by its exact resource binding.",
        path: ["provenance"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "SemanticQueryContext" &&
      document.projection.kind === "SEMANTIC_CONTEXT" &&
      (document.projection.context.run_id !== document.artifact_ref.run_id ||
        document.projection.context.scope.app_id !== document.artifact_ref.app_id ||
        document.projection.context.scope.tenant_id !== document.artifact_ref.tenant_id ||
        document.projection.context.scope.environment !== document.artifact_ref.environment)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SemanticQueryContext must bind the Product Team Artifact Scope and Run.",
        path: ["projection", "context"],
      });
    }
    for (const [index, reference] of document.source_refs.entries()) {
      if (
        reference.app_id !== document.artifact_ref.app_id ||
        reference.tenant_id !== document.artifact_ref.tenant_id ||
        reference.environment !== document.artifact_ref.environment ||
        reference.run_id !== document.artifact_ref.run_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Product Team Artifact source ref 必须属于同一 Scope/Run。",
          path: ["source_refs", index],
        });
      }
    }
  });

export const productTeamArtifactDocumentSchema = productTeamArtifactDraftSchema;
export type ProductTeamArtifactDocument = z.infer<typeof productTeamArtifactDocumentSchema>;

export async function computeProductTeamArtifactHash(input: unknown) {
  const document = productTeamArtifactDocumentSchema.parse(input);
  const { content_hash: _contentHash, ...reference } = document.artifact_ref;
  return sha256ContentHash({
    schema_version: document.schema_version,
    artifact_ref: reference,
    profile_id: document.profile_id,
    task_id: document.task_id,
    source_refs: document.source_refs,
    provenance: document.provenance,
    projection: document.projection,
    committed_at: document.committed_at,
  });
}

export async function buildProductTeamArtifactDocument(input: unknown) {
  const document = productTeamArtifactDocumentSchema.parse(input);
  await verifyAcceptedTableInput(document);
  if (document.projection.kind === "SEMANTIC_CONTEXT") {
    await verifySemanticQueryContext(document.projection.context);
  }
  return productTeamArtifactDocumentSchema.parse({
    ...document,
    artifact_ref: {
      ...document.artifact_ref,
      content_hash: await computeProductTeamArtifactHash(document),
    },
  });
}

export async function verifyProductTeamArtifactDocument(input: unknown) {
  const document = productTeamArtifactDocumentSchema.parse(input);
  await verifyAcceptedTableInput(document);
  if (document.projection.kind === "SEMANTIC_CONTEXT") {
    await verifySemanticQueryContext(document.projection.context);
  }
  if ((await computeProductTeamArtifactHash(document)) !== document.artifact_ref.content_hash) {
    throw new TypeError("PRODUCT_TEAM_ARTIFACT_HASH_MISMATCH");
  }
  if (new Set(document.source_refs.map(canonicalizeJson)).size !== document.source_refs.length) {
    throw new TypeError("PRODUCT_TEAM_ARTIFACT_SOURCE_DUPLICATE");
  }
  return document;
}
