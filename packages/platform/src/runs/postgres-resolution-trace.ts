import { createHash } from "node:crypto";
import {
  type AnalysisOracleReceipt,
  type AnalysisSandboxExecutionReceipt,
  type AppScope,
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV2,
  type ArtifactWorkspaceChartDocumentV3,
  analysisResultChartIntentSchema,
  analysisResultChartTemplateIdSchema,
  analysisResultStageArtifactSchema,
  analysisResultValueTypeSchema,
  analysisSandboxExecutionReceiptSchema,
  appScopeSchema,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  buildResolutionTrace,
  buildResolutionTraceDetail,
  buildSqlHistoryEntry,
  canonicalizeJson,
  computeGroundingAuthorityDocumentHash,
  computeL2ArtifactContentHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultHash,
  contentHashSchema,
  e1AnalysisPublicationReceiptSchema,
  hasDuplicateArtifactReferenceIdentities,
  immutableIdSchema,
  l2ArtifactDocumentSchema,
  type PortResult,
  type PublicRunEventV2,
  parseAndHashL2ResearchDocumentCandidate,
  type parseL2ResearchDocumentCandidate,
  productTeamArtifactDocumentSchema,
  type ResolutionTrace,
  type ResolutionTraceDetail,
  type ResolutionTraceEdge,
  type ResolutionTraceNode,
  type RunRuntimeEvent,
  redactPublicDisplayText,
  type SandboxResult,
  type SchemaSnapshotDocument,
  type SqlHistoryEntry,
  type SqlHistoryResult,
  type SuccessfulSandboxExecutionReceipt,
  sandboxResultSchema,
  schemaSnapshotDocumentSchema,
  sha256ContentHash,
  successfulSandboxExecutionReceiptSchema,
  timestampSchema,
  toPublicRunEvent,
  verifyArtifactWorkspaceChartDocumentV2,
  verifyArtifactWorkspaceChartDocumentV3,
  verifyE1AnalysisPublicationCommand,
  verifyEffectiveRunConfigReceiptCandidate,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts";
import { z } from "zod";
import { loadVerifiedRunEvents } from "../events/postgres-run-event-store.js";
import {
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const traceLookupSchema = z.strictObject({ scope: appScopeSchema, run_id: immutableIdSchema });
const traceDetailLookupSchema = traceLookupSchema.extend({
  expected_trace_hash: contentHashSchema,
  node_id: z
    .string()
    .min(1)
    .max(320)
    .regex(/^(?:event|artifact|context|config):/),
});
const sqlHistoryLookupSchema = z
  .strictObject({
    scope: appScopeSchema,
    run_id: immutableIdSchema.optional(),
    conversation_id: immutableIdSchema.optional(),
    occurred_after: timestampSchema.optional(),
    occurred_before: timestampSchema.optional(),
    limit: z.number().int().positive().max(500).safe().default(100),
  })
  .superRefine((lookup, ctx) => {
    if (
      lookup.occurred_after &&
      lookup.occurred_before &&
      lookup.occurred_after >= lookup.occurred_before
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SQL History occurred_after 必须早于 occurred_before。",
        path: ["occurred_before"],
      });
    }
  });

const analysisIdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u);
const analysisFieldSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u);
const analysisMetricBindingSchema = z.strictObject({
  semantic_metric_id: analysisIdentifierSchema,
  field: analysisFieldSchema,
  unit: z.string().trim().min(1).max(64).nullable(),
  aggregation: z.enum(["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX", "RATIO", "NONE"]),
  formula_hash: contentHashSchema.nullable(),
});
const analysisDimensionBindingSchema = z.strictObject({
  semantic_dimension_id: analysisIdentifierSchema,
  field: analysisFieldSchema,
});
const analysisLineageBindingSchema = z.strictObject({
  field: analysisFieldSchema,
  source_semantic_object_ids: z.array(analysisIdentifierSchema).min(1).max(32),
  source_physical_fields: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}\.[A-Za-z_][A-Za-z0-9_]{0,127}$/u))
    .min(1)
    .max(64),
  transformation: z.enum(["DIRECT", "AGGREGATION", "FORMULA", "STATISTICAL_OPERATOR"]),
});
const analysisPublishedTableColumnSchema = z.strictObject({
  key: analysisFieldSchema,
  label_zh: z.string().trim().min(1).max(80),
  data_type: analysisResultValueTypeSchema.exclude(["JSON"]),
  nullable: z.boolean(),
  semantic_object_id: analysisIdentifierSchema,
  semantic_role: z.enum(["METRIC", "DIMENSION", "DERIVED", "QUALITY"]),
});
const analysisPublishedTableDataShape = {
  table_id: analysisIdentifierSchema,
  columns: z.array(analysisPublishedTableColumnSchema).min(1).max(128),
  rows: z.array(z.record(z.string(), z.json())).max(5_000),
  total_rows: z.number().int().nonnegative().max(5_000),
} as const;
function addAnalysisPublishedTableIssues(
  document: {
    readonly columns: readonly { readonly key: string }[];
    readonly rows: readonly Readonly<Record<string, unknown>>[];
    readonly total_rows: number;
  },
  context: z.RefinementCtx,
): void {
  const columnKeys = document.columns.map(({ key }) => key);
  if (
    new Set(columnKeys).size !== columnKeys.length ||
    document.total_rows !== document.rows.length ||
    document.rows.some((row) => {
      const rowKeys = Object.keys(row);
      return (
        rowKeys.length !== columnKeys.length || columnKeys.some((key) => !Object.hasOwn(row, key))
      );
    })
  ) {
    context.addIssue({
      code: "custom",
      message: "Analysis published table must exactly close columns and rows.",
    });
  }
}
const analysisPublishedTableBodySchema = z
  .strictObject({
    ...analysisPublishedTableDataShape,
    title_zh: z.string().trim().min(1).max(160),
  })
  .superRefine(addAnalysisPublishedTableIssues);
const analysisPublishedChartDatasetSchema = z
  .strictObject(analysisPublishedTableDataShape)
  .superRefine(addAnalysisPublishedTableIssues);
const analysisPublishedResultSchema = z.strictObject({
  schema_version: z.literal("analysis-published-result@1.0.0"),
  contract_id: analysisIdentifierSchema,
  contract_hash: contentHashSchema,
  semantic_context_hash: contentHashSchema,
  metrics: z.array(analysisMetricBindingSchema).max(128),
  dimensions: z.array(analysisDimensionBindingSchema).max(128),
  grain: z.strictObject({
    dimension_ids: z.array(analysisIdentifierSchema).max(32),
    time_dimension_id: analysisIdentifierSchema.nullable(),
    time_grain: z.enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "NONE"]),
  }),
  lineage: z.array(analysisLineageBindingSchema).min(1).max(256),
  data: z.record(z.string(), z.json()),
});
const analysisPublishedTableSchema = analysisPublishedTableBodySchema.safeExtend({
  schema_version: z.literal("analysis-published-table@1.0.0"),
});
const analysisPublishedChartSchema = z.strictObject({
  schema_version: z.literal("analysis-published-chart@1.0.0"),
  chart_id: analysisIdentifierSchema,
  title_zh: z.string().trim().min(1).max(160),
  intent: analysisResultChartIntentSchema,
  template_id: analysisResultChartTemplateIdSchema,
  bindings: z.strictObject({
    x_field: analysisFieldSchema,
    y_fields: z.array(analysisFieldSchema).min(1).max(128),
    series_field: analysisFieldSchema.nullable(),
    lower_bound_field: analysisFieldSchema.nullable(),
    upper_bound_field: analysisFieldSchema.nullable(),
  }),
  dataset: analysisPublishedChartDatasetSchema,
});
const analysisPublishedDocumentSchema = z.discriminatedUnion("schema_version", [
  analysisPublishedResultSchema,
  analysisPublishedTableSchema,
  analysisPublishedChartSchema,
]);
const analysisSystemResultMetadataSchema = z.strictObject({
  stage_id: immutableIdSchema,
  artifact: analysisResultStageArtifactSchema,
});

interface RunAuthorityRow {
  readonly run_id: string;
  readonly principal_id: string;
  readonly conversation_id: string | null;
  readonly conversation_title: string | null;
  readonly conversation_resource_version: string | number | null;
  readonly conversation_message_count: string | number;
  readonly datasource_id: string | null;
  readonly config_id: string | null;
  readonly config_revision: string | number | null;
  readonly config_hash: string | null;
  readonly schema_snapshot_hash: string | null;
  readonly config_committed_at: Date | string | null;
  readonly effective_config_json: unknown | null;
  readonly question: string;
  readonly run_status: string;
  readonly active_fence: string | number;
  readonly active_attempt_id: string | null;
  readonly attempt_count: string | number;
  readonly run_created_at: Date | string;
  readonly run_updated_at: Date | string;
  readonly authority_epoch: string;
  readonly authority_baseline_id: string;
  readonly authority_baseline_hash: string;
  readonly authority_activation_attempt_id: string;
  readonly current_authority_epoch: string | null;
  readonly current_baseline_id: string | null;
  readonly current_baseline_hash: string | null;
  readonly current_activation_attempt_id: string | null;
}

interface ArtifactRow {
  readonly source_store: "ARTIFACTS" | "ANALYSIS_SYSTEM" | "TEXT2SQL_SYSTEM";
  readonly is_active: boolean;
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly revision: string | number;
  readonly content_hash: string;
  readonly document_json: unknown | null;
  readonly payload_json: unknown | null;
  readonly content_bytes: Uint8Array | null;
  readonly created_at: Date | string;
  readonly authority_epoch: string | null;
  readonly authority_baseline_id: string | null;
  readonly authority_baseline_hash: string | null;
  readonly authority_activation_attempt_id: string | null;
}

interface E1PublicationRow {
  readonly publication_hash: string;
  readonly public_event_id: string;
  readonly command_json: unknown;
  readonly receipt_json: unknown;
  readonly committed_at: Date | string;
  readonly outbox_publication_hash: string;
  readonly outbox_payload_json: unknown;
  readonly artifact_bindings: unknown;
}

type AnalysisPublishedDocument =
  | z.infer<typeof analysisPublishedResultSchema>
  | z.infer<typeof analysisPublishedTableSchema>
  | z.infer<typeof analysisPublishedChartSchema>;

interface VerifiedArtifact {
  readonly reference: ArtifactReference;
  readonly document:
    | z.infer<typeof l2ArtifactDocumentSchema>
    | ReturnType<typeof parseL2ResearchDocumentCandidate>
    | z.infer<typeof productTeamArtifactDocumentSchema>
    | ArtifactWorkspaceChartDocumentV2
    | ArtifactWorkspaceChartDocumentV3
    | SchemaSnapshotDocument
    | SandboxResult
    | AnalysisSandboxExecutionReceipt
    | SuccessfulSandboxExecutionReceipt
    | AnalysisPublishedDocument;
  readonly source_store: ArtifactRow["source_store"];
  readonly created_at: string;
}

interface VerifiedRunAuthority {
  readonly scope: AppScope;
  readonly run_id: string;
  readonly principal_id: string;
  readonly conversation_id: string | null;
  readonly conversation_title: string | null;
  readonly conversation_resource_version: number | null;
  readonly conversation_message_count: number;
  readonly datasource_id: string | null;
  readonly config_ref: {
    readonly config_id: string;
    readonly config_revision: number;
    readonly config_hash: string;
  } | null;
  readonly schema_snapshot_hash: string | null;
  readonly config_committed_at: string | null;
  readonly effective_config_json: unknown | null;
  readonly question: string;
  readonly run_status: string;
  readonly active_fence: number;
  readonly active_attempt_id: string | null;
  readonly attempt_count: number;
  readonly run_created_at: string;
  readonly run_updated_at: string;
  readonly authority: {
    readonly epoch: "E1";
    readonly baseline_id: string;
    readonly baseline_hash: string;
    readonly activation_attempt_id: string;
  };
}

interface VerifiedE1Publication {
  readonly publication_hash: string;
  readonly public_event_id: string;
  readonly committed_at: string;
  readonly oracle_receipts: readonly AnalysisOracleReceipt[];
  readonly analysis_program_ref: ArtifactReference;
  readonly published_references: readonly ArtifactReference[];
}

const e1PublicationArtifactBindingsSchema = z
  .array(
    z.strictObject({
      ordinal: z.number().int().positive().safe(),
      role: z.enum([
        "SANDBOX_RESULT",
        "SANDBOX_RECEIPT",
        "DERIVED_EVIDENCE",
        "COMPLETION_READY",
        "CHART",
        "REPORT",
      ]),
      reference: artifactReferenceSchema,
    }),
  )
  .min(7)
  .max(256);
const e1PublicationOutboxPayloadSchema = z.strictObject({
  event_name: z.literal("e1_analysis_publication_committed"),
  publication_hash: contentHashSchema,
  references: z.array(artifactReferenceSchema).min(7).max(256),
});

function invalid<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_AUTHORITY_CORRUPT",
      "Authority timestamp 无效。",
    );
  }
  return parsed.toISOString();
}

function assertScope(requested: AppScope, authorized: AppScope): void {
  if (
    requested.app_id !== authorized.app_id ||
    requested.tenant_id !== authorized.tenant_id ||
    requested.environment !== authorized.environment
  ) {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_NOT_FOUND_OR_DENIED",
      "Run 不存在或当前 Principal 无权访问。",
    );
  }
}

function effectiveConfigCandidate(document: unknown, configHash: string | null): unknown | null {
  if (document === null) return null;
  if (configHash === null || typeof document !== "object" || Array.isArray(document)) {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_CONFIG_CORRUPT",
      "Effective Config relational/document identity 不完整。",
    );
  }
  return { ...document, config_hash: contentHashSchema.parse(configHash) };
}

async function verifiedEffectiveConfig(authority: VerifiedRunAuthority) {
  if (!authority.effective_config_json) return null;
  try {
    return await verifyEffectiveRunConfigReceiptCandidate(authority.effective_config_json);
  } catch {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_CONFIG_CORRUPT",
      "Effective Config 未通过当前契约与 content hash 校验。",
    );
  }
}

async function loadRunAuthority(
  client: SqlClient,
  scope: AppScope,
  principalId: string,
  runId?: string,
  conversationId?: string,
): Promise<VerifiedRunAuthority[]> {
  const result = await client.query<RunAuthorityRow>(
    `select
       run.run_id,
       run.principal_id,
       binding.conversation_id,
       conversation.title as conversation_title,
       conversation.resource_version as conversation_resource_version,
       binding.datasource_id,
       (select pg_catalog.count(*)
        from qa_messages as message
        where message.app_id = binding.app_id
          and message.tenant_id = binding.tenant_id
          and message.environment = binding.environment
          and message.conversation_id = binding.conversation_id) as conversation_message_count,
       config.config_id,
       config.config_revision,
       config.config_hash,
       config.schema_snapshot_hash,
       config.committed_at as config_committed_at,
       config.effective_config_json,
       run.question,
       coalesce(projection.status, run.status) as run_status,
       run.active_fence,
       run.authority_epoch,
       run.authority_baseline_id,
       run.authority_baseline_hash,
       run.authority_activation_attempt_id,
       current_epoch.authority_epoch as current_authority_epoch,
       current_epoch.baseline_id as current_baseline_id,
       current_epoch.baseline_hash as current_baseline_hash,
       current_epoch.activation_attempt_id as current_activation_attempt_id,
       active_attempt.attempt_id as active_attempt_id,
       (select pg_catalog.count(*)
        from run_attempts as attempt
        where attempt.app_id = run.app_id
          and attempt.tenant_id = run.tenant_id
          and attempt.environment = run.environment
          and attempt.run_id = run.run_id) as attempt_count,
       run.created_at as run_created_at,
       run.updated_at as run_updated_at
     from runs as run
     left join workspace_run_bindings as binding
       on binding.app_id = run.app_id
      and binding.tenant_id = run.tenant_id
      and binding.environment = run.environment
      and binding.run_id = run.run_id
     left join qa_conversations as conversation
       on conversation.app_id = binding.app_id
      and conversation.tenant_id = binding.tenant_id
      and conversation.environment = binding.environment
      and conversation.conversation_id = binding.conversation_id
      and conversation.owner_principal_id = binding.principal_id
     left join effective_run_config_receipts as config
       on config.app_id = run.app_id
      and config.tenant_id = run.tenant_id
      and config.environment = run.environment
      and config.run_id = run.run_id
     left join falcon24_current_authority_epoch as current_epoch
       on current_epoch.app_id = run.app_id
      and current_epoch.tenant_id = run.tenant_id
      and current_epoch.environment = run.environment
     left join lateral (
       select candidate.status
       from run_projections as candidate
       where candidate.app_id = run.app_id
         and candidate.tenant_id = run.tenant_id
         and candidate.environment = run.environment
         and candidate.run_id = run.run_id
       order by candidate.version desc
       limit 1
     ) as projection on true
     left join lateral (
       select active_candidate.attempt_id
       from run_attempts as active_candidate
       where active_candidate.app_id = run.app_id
         and active_candidate.tenant_id = run.tenant_id
         and active_candidate.environment = run.environment
         and active_candidate.run_id = run.run_id
         and active_candidate.status = 'ACTIVE'
       order by active_candidate.attempt_no desc
       limit 1
     ) as active_attempt on true
     where run.app_id = $1
       and run.tenant_id = $2
       and run.environment = $3
       and run.principal_id = $4
       and ($5::uuid is null or run.run_id = $5)
       and ($6::uuid is null or binding.conversation_id = $6)
     order by run.created_at desc, run.run_id desc`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      principalId,
      runId ?? null,
      conversationId ?? null,
    ],
  );
  return result.rows.map((row) => {
    if (
      row.authority_epoch !== "E1" ||
      row.current_authority_epoch !== "E1" ||
      row.current_baseline_id === null ||
      row.current_baseline_hash === null ||
      row.current_activation_attempt_id === null ||
      row.authority_baseline_id !== row.current_baseline_id ||
      row.authority_baseline_hash !== row.current_baseline_hash ||
      row.authority_activation_attempt_id !== row.current_activation_attempt_id
    ) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_E1_AUTHORITY_MISMATCH",
        "Run 未绑定当前 E1 authority baseline。",
      );
    }
    const hasAnyConfig =
      row.config_id !== null ||
      row.config_revision !== null ||
      row.config_hash !== null ||
      row.schema_snapshot_hash !== null ||
      row.config_committed_at !== null;
    const hasCompleteConfig =
      row.config_id !== null &&
      row.config_revision !== null &&
      row.config_hash !== null &&
      row.schema_snapshot_hash !== null &&
      row.config_committed_at !== null;
    if (hasAnyConfig !== hasCompleteConfig) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_AUTHORITY_CORRUPT",
        "Effective Config identity closure 不完整。",
      );
    }
    return {
      scope,
      run_id: immutableIdSchema.parse(row.run_id),
      principal_id: immutableIdSchema.parse(row.principal_id),
      conversation_id:
        row.conversation_id === null ? null : immutableIdSchema.parse(row.conversation_id),
      conversation_title:
        row.conversation_title === null
          ? null
          : z.string().min(1).max(255).parse(row.conversation_title),
      conversation_resource_version:
        row.conversation_resource_version === null
          ? null
          : z.coerce.number().int().positive().safe().parse(row.conversation_resource_version),
      conversation_message_count: z.coerce
        .number()
        .int()
        .nonnegative()
        .safe()
        .parse(row.conversation_message_count),
      datasource_id: row.datasource_id === null ? null : immutableIdSchema.parse(row.datasource_id),
      config_ref: hasCompleteConfig
        ? {
            config_id: immutableIdSchema.parse(row.config_id),
            config_revision: z.coerce.number().int().positive().safe().parse(row.config_revision),
            config_hash: contentHashSchema.parse(row.config_hash),
          }
        : null,
      schema_snapshot_hash: hasCompleteConfig
        ? contentHashSchema.parse(row.schema_snapshot_hash)
        : null,
      config_committed_at: hasCompleteConfig ? iso(row.config_committed_at as Date | string) : null,
      effective_config_json: hasCompleteConfig
        ? effectiveConfigCandidate(row.effective_config_json, row.config_hash)
        : null,
      question: z.string().min(1).max(4_000).parse(row.question),
      run_status: z.string().min(1).max(64).parse(row.run_status),
      active_fence: z.coerce.number().int().nonnegative().safe().parse(row.active_fence),
      active_attempt_id:
        row.active_attempt_id === null ? null : immutableIdSchema.parse(row.active_attempt_id),
      attempt_count: z.coerce.number().int().nonnegative().safe().parse(row.attempt_count),
      run_created_at: iso(row.run_created_at),
      run_updated_at: iso(row.run_updated_at),
      authority: {
        epoch: "E1",
        baseline_id: immutableIdSchema.parse(row.authority_baseline_id),
        baseline_hash: contentHashSchema.parse(row.authority_baseline_hash),
        activation_attempt_id: immutableIdSchema.parse(row.authority_activation_attempt_id),
      },
    };
  });
}

function referenceFromRow(scope: AppScope, runId: string, row: ArtifactRow): ArtifactReference {
  return artifactReferenceSchema.parse({
    artifact_id: immutableIdSchema.parse(row.artifact_id),
    artifact_type: row.artifact_type,
    ...scope,
    run_id: immutableIdSchema.parse(runId),
    revision: z.coerce.number().int().positive().parse(row.revision),
    content_hash: contentHashSchema.parse(row.content_hash),
  });
}

function parseStoredArtifactRelation(
  scope: AppScope,
  runId: string,
  row: ArtifactRow,
): { readonly reference: ArtifactReference; readonly created_at: string } {
  try {
    return {
      reference: referenceFromRow(scope, runId, row),
      created_at: iso(row.created_at),
    };
  } catch {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
      "Stored Artifact relational identity 不符合 strict contract。",
    );
  }
}

function exactReferenceMatches(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function rawSha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  );
}

async function verifyOrdinaryArtifactDocument(
  row: ArtifactRow,
  reference: ArtifactReference,
): Promise<Exclude<VerifiedArtifact["document"], null>> {
  try {
    if (row.source_store !== "ARTIFACTS" || row.document_json === null) {
      throw new TypeError("RESOLUTION_TRACE_ARTIFACT_STORE_MISMATCH");
    }
    if (reference.artifact_type === "SchemaSnapshot") {
      const document = schemaSnapshotDocumentSchema.parse(row.document_json);
      if (
        !exactReferenceMatches(document.artifact_ref, reference) ||
        document.document_hash !== reference.content_hash ||
        (await computeGroundingAuthorityDocumentHash(document)) !== reference.content_hash
      ) {
        throw new TypeError("RESOLUTION_TRACE_SCHEMA_SNAPSHOT_HASH_MISMATCH");
      }
      return document;
    }
    if (reference.artifact_type === "SandboxResult") {
      const document = sandboxResultSchema.parse(row.document_json);
      if (
        !exactReferenceMatches(document.result_ref, reference) ||
        document.result_hash !== reference.content_hash ||
        (await computeSandboxResultHash(document)) !== reference.content_hash
      ) {
        throw new TypeError("RESOLUTION_TRACE_SANDBOX_RESULT_HASH_MISMATCH");
      }
      return document;
    }
    if (reference.artifact_type === "SandboxExecutionReceipt") {
      throw new TypeError("RESOLUTION_TRACE_SYSTEM_ARTIFACT_MIRROR_FORBIDDEN");
    }
    const l2Result = l2ArtifactDocumentSchema.safeParse(row.document_json);
    const productResult = productTeamArtifactDocumentSchema.safeParse(row.document_json);
    let document: Exclude<VerifiedArtifact["document"], null>;
    let computedHash: string;
    if (l2Result.success && l2Result.data.envelope.status === "COMMITTED") {
      document = l2Result.data;
      computedHash = await computeL2ArtifactContentHash(document);
    } else if (productResult.success) {
      document = await verifyProductTeamArtifactDocument(productResult.data);
      computedHash = document.artifact_ref.content_hash;
    } else if (reference.artifact_type === "ArtifactWorkspaceDocument") {
      try {
        document = await verifyArtifactWorkspaceChartDocumentV2(row.document_json);
      } catch {
        document = await verifyArtifactWorkspaceChartDocumentV3(row.document_json);
      }
      computedHash = contentHashSchema.parse(document.document_ref.content_hash);
    } else {
      const research = await parseAndHashL2ResearchDocumentCandidate(row.document_json);
      if (research.document.envelope.status !== "COMMITTED") {
        throw new TypeError("RESOLUTION_TRACE_RESEARCH_ARTIFACT_NOT_COMMITTED");
      }
      document = research.document;
      computedHash = research.content_hash;
    }
    const documentReference =
      "envelope" in document
        ? document.envelope
        : "artifact_ref" in document
          ? document.artifact_ref
          : document.document_ref;
    if (
      documentReference.artifact_id !== reference.artifact_id ||
      documentReference.artifact_type !== reference.artifact_type ||
      documentReference.app_id !== reference.app_id ||
      documentReference.tenant_id !== reference.tenant_id ||
      documentReference.environment !== reference.environment ||
      documentReference.run_id !== reference.run_id ||
      documentReference.revision !== reference.revision ||
      documentReference.content_hash !== reference.content_hash ||
      computedHash !== reference.content_hash
    ) {
      throw new TypeError("RESOLUTION_TRACE_ARTIFACT_IDENTITY_MISMATCH");
    }
    return document;
  } catch {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
      "Stored Artifact document 未通过 strict schema、identity 与 content hash 校验。",
    );
  }
}

async function verifyText2SqlSystemArtifactDocument(
  row: ArtifactRow,
  reference: ArtifactReference,
): Promise<SandboxResult | SuccessfulSandboxExecutionReceipt> {
  try {
    if (row.source_store !== "TEXT2SQL_SYSTEM" || row.payload_json === null) {
      throw new TypeError("RESOLUTION_TRACE_SYSTEM_ARTIFACT_STORE_MISMATCH");
    }
    if (reference.artifact_type === "SandboxResult") {
      const document = sandboxResultSchema.parse(row.payload_json);
      if (
        !exactReferenceMatches(document.result_ref, reference) ||
        (await computeSandboxResultHash(document)) !== reference.content_hash
      ) {
        throw new TypeError("RESOLUTION_TRACE_SANDBOX_RESULT_HASH_MISMATCH");
      }
      return document;
    }
    if (reference.artifact_type === "SandboxExecutionReceipt") {
      const document = successfulSandboxExecutionReceiptSchema.parse(row.payload_json);
      if (
        !exactReferenceMatches(document.receipt_ref, reference) ||
        (await computeSandboxExecutionReceiptHash(document)) !== reference.content_hash
      ) {
        throw new TypeError("RESOLUTION_TRACE_SANDBOX_RECEIPT_HASH_MISMATCH");
      }
      return document;
    }
    throw new TypeError("RESOLUTION_TRACE_SYSTEM_ARTIFACT_TYPE_INVALID");
  } catch {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
      "Text2SQL System Artifact 未通过唯一 Store、strict schema 与 canonical hash 校验。",
    );
  }
}

async function verifyAnalysisSystemArtifactDocument(
  row: ArtifactRow,
  reference: ArtifactReference,
): Promise<AnalysisSandboxExecutionReceipt | AnalysisPublishedDocument> {
  try {
    if (row.source_store !== "ANALYSIS_SYSTEM" || row.payload_json === null) {
      throw new TypeError("RESOLUTION_TRACE_ANALYSIS_ARTIFACT_STORE_MISMATCH");
    }
    if (reference.artifact_type === "SandboxExecutionReceipt") {
      if (row.content_bytes !== null) {
        throw new TypeError("RESOLUTION_TRACE_ANALYSIS_RECEIPT_BYTES_FORBIDDEN");
      }
      const document = analysisSandboxExecutionReceiptSchema.parse(row.payload_json);
      const { execution_hash: observedExecutionHash, ...material } = document;
      if (
        (await sha256ContentHash({
          hash_domain: "analysis-sandbox-execution-receipt@1.0.0",
          value: material,
        })) !== observedExecutionHash ||
        (await sha256ContentHash(document)) !== reference.content_hash
      ) {
        throw new TypeError("RESOLUTION_TRACE_ANALYSIS_RECEIPT_HASH_MISMATCH");
      }
      return document;
    }
    if (reference.artifact_type !== "SandboxResult" || row.content_bytes === null) {
      throw new TypeError("RESOLUTION_TRACE_ANALYSIS_RESULT_BYTES_REQUIRED");
    }
    const metadata = analysisSystemResultMetadataSchema.parse(row.payload_json);
    if (
      metadata.artifact.content_sha256 !== reference.content_hash ||
      metadata.artifact.bytes !== row.content_bytes.byteLength ||
      rawSha256(row.content_bytes) !== reference.content_hash
    ) {
      throw new TypeError("RESOLUTION_TRACE_ANALYSIS_RESULT_HASH_MISMATCH");
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(row.content_bytes);
    const document = analysisPublishedDocumentSchema.parse(JSON.parse(decoded));
    const expectedSchema = {
      RESULT: "analysis-published-result@1.0.0",
      TABLE: "analysis-published-table@1.0.0",
      CHART: "analysis-published-chart@1.0.0",
    }[metadata.artifact.artifact_kind];
    const canonicalBytes = new TextEncoder().encode(canonicalizeJson(document));
    if (
      document.schema_version !== expectedSchema ||
      !exactBytes(canonicalBytes, row.content_bytes)
    ) {
      throw new TypeError("RESOLUTION_TRACE_ANALYSIS_RESULT_CANONICAL_MISMATCH");
    }
    return document;
  } catch {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
      "Analysis System Artifact 未通过唯一 Store、strict schema 与 canonical hash 校验。",
    );
  }
}

const traceArtifactTypes = new Set<ArtifactReference["artifact_type"]>([
  "SqlArtifact",
  "ExecutionReceipt",
  "QueryEvidence",
  "AnalysisProgram",
  "DerivedAnalysisEvidence",
  "AnalysisCompletionReceipt",
  "AnalysisReport",
  "ArtifactWorkspaceDocument",
  "SchemaSnapshot",
  "SandboxExecutionReceipt",
  "SandboxResult",
]);

function referenceLocation(reference: ArtifactReference): string {
  return `${reference.artifact_id}\0${reference.revision}`;
}

function artifactInputReferences(
  document: VerifiedArtifact["document"],
): readonly ArtifactReference[] {
  if ("envelope" in document) return document.envelope.input_refs;
  if ("source_refs" in document) {
    return Array.isArray(document.source_refs)
      ? document.source_refs
      : [...document.source_refs.query_evidence_refs, document.source_refs.derived_evidence_ref];
  }
  if ("analysis_program_ref" in document && "outputs" in document) {
    return [
      document.analysis_program_ref,
      ...document.inputs.flatMap((input) => [
        input.query_evidence_ref,
        input.input_ref,
        input.materialization_receipt_ref,
      ]),
      ...document.outputs.map(({ reference }) => reference),
    ];
  }
  if (
    "receipt_ref" in document &&
    document.receipt_ref.artifact_type === "SandboxExecutionReceipt"
  ) {
    return [
      document.result_artifact_ref,
      document.sql_artifact_ref,
      document.execution_permit_ref,
      document.resource_admission_ref,
      document.authority_revalidation.policy_receipt_ref,
    ];
  }
  if ("parent_ref" in document && document.parent_ref !== null) return [document.parent_ref];
  return [];
}

function analysisSystemReferences(
  document: VerifiedArtifact["document"],
): readonly ArtifactReference[] {
  if ("envelope" in document && document.payload.artifact_type === "DerivedAnalysisEvidence") {
    return [
      document.payload.sandbox_execution_receipt_ref,
      ...document.payload.sandbox_result_refs,
    ];
  }
  if ("analysis_program_ref" in document && "outputs" in document) {
    return document.outputs.map(({ reference }) => reference);
  }
  return [];
}

function assertAnalysisSystemReferenceClosure(artifacts: readonly VerifiedArtifact[]): void {
  const verifiedByIdentity = new Map(
    artifacts.map((artifact) => [artifactReferenceIdentity(artifact.reference), artifact]),
  );
  for (const source of artifacts) {
    for (const reference of analysisSystemReferences(source.document)) {
      const target = verifiedByIdentity.get(artifactReferenceIdentity(reference));
      if (!target) {
        throw new PersistenceBoundaryError(
          "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING",
          "Analysis Artifact reference 无法在同一权威快照中验证。",
        );
      }
      if (target.source_store !== "ANALYSIS_SYSTEM") {
        throw new PersistenceBoundaryError(
          "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
          "Analysis receipt/result 只能由 analysis_system_artifacts 提供权威内容。",
        );
      }
    }
  }
}

async function loadVerifiedArtifacts(
  client: SqlClient,
  authority: VerifiedRunAuthority,
  events: readonly RunRuntimeEvent[],
): Promise<VerifiedArtifact[]> {
  const result = await client.query<ArtifactRow>(
    `select
       'ARTIFACTS'::text as source_store,
       is_active,
       artifact_id, artifact_type, revision, content_hash,
       document_json, null::jsonb as payload_json, null::bytea as content_bytes,
       authority_epoch, authority_baseline_id, authority_baseline_hash,
       authority_activation_attempt_id,
       created_at
     from artifacts
     where app_id = $1 and tenant_id = $2 and environment = $3 and run_id = $4
     union all
     select
       'ANALYSIS_SYSTEM'::text as source_store,
       true as is_active,
       artifact_id, artifact_type, revision, content_hash,
       null::jsonb as document_json, payload_json, content_bytes,
       null::text as authority_epoch, null::uuid as authority_baseline_id,
       null::text as authority_baseline_hash, null::uuid as authority_activation_attempt_id,
       committed_at as created_at
     from analysis_system_artifacts
     where app_id = $1 and tenant_id = $2 and environment = $3 and run_id = $4
     union all
     select
       'TEXT2SQL_SYSTEM'::text as source_store,
       true as is_active,
       artifact_id, artifact_type, revision, content_hash,
       null::jsonb as document_json, payload_json, null::bytea as content_bytes,
       null::text as authority_epoch, null::uuid as authority_baseline_id,
       null::text as authority_baseline_hash, null::uuid as authority_activation_attempt_id,
       committed_at as created_at
     from text2sql_system_artifacts
     where app_id = $1 and tenant_id = $2 and environment = $3 and run_id = $4
     order by created_at, artifact_id, revision`,
    [
      authority.scope.app_id,
      authority.scope.tenant_id,
      authority.scope.environment,
      authority.run_id,
    ],
  );
  const artifacts: VerifiedArtifact[] = [];
  const locations = new Map<string, ArtifactRow["source_store"]>();
  const storedRows = result.rows.map((row) => ({
    row,
    stored: parseStoredArtifactRelation(authority.scope, authority.run_id, row),
  }));
  for (const { row, stored } of storedRows) {
    const { reference } = stored;
    if (
      row.source_store === "ARTIFACTS" &&
      (row.authority_epoch !== authority.authority.epoch ||
        row.authority_baseline_id !== authority.authority.baseline_id ||
        row.authority_baseline_hash !== authority.authority.baseline_hash ||
        row.authority_activation_attempt_id !== authority.authority.activation_attempt_id)
    ) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_E1_ARTIFACT_AUTHORITY_MISMATCH",
        "Artifact 未绑定 Run 的 exact E1 authority baseline。",
      );
    }
    const location = referenceLocation(reference);
    if (locations.has(location)) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_AUTHORITY_AMBIGUOUS",
        "同一 exact Artifact Revision 只能存在于一个权威 Store，禁止 active/inactive 镜像兼容。",
      );
    }
    locations.set(location, row.source_store);
  }
  const projectedRows = storedRows.filter(
    ({ row }) => row.source_store !== "ARTIFACTS" || row.is_active,
  );
  const references = new Map(
    projectedRows.map(({ stored }) => [
      artifactReferenceIdentity(stored.reference),
      stored.reference,
    ]),
  );
  for (const { row, stored } of projectedRows) {
    const { reference } = stored;
    if (!traceArtifactTypes.has(reference.artifact_type)) continue;
    const document =
      row.source_store === "ARTIFACTS"
        ? await verifyOrdinaryArtifactDocument(row, reference)
        : row.source_store === "ANALYSIS_SYSTEM"
          ? await verifyAnalysisSystemArtifactDocument(row, reference)
          : await verifyText2SqlSystemArtifactDocument(row, reference);
    artifacts.push({
      reference,
      document,
      source_store: row.source_store,
      created_at: stored.created_at,
    });
  }
  assertAnalysisSystemReferenceClosure(artifacts);
  const verifiedReferences = new Set(
    artifacts.map(({ reference }) => artifactReferenceIdentity(reference)),
  );
  const requiredReferences = [
    ...events.flatMap((event) => {
      const eventReferences = eventNode(event).artifact_refs;
      if (hasDuplicateArtifactReferenceIdentities(eventReferences)) {
        throw new PersistenceBoundaryError(
          "RESOLUTION_TRACE_ARTIFACT_REFERENCE_DUPLICATE",
          "Run Event 的 ArtifactReference identity 不能重复。",
        );
      }
      return eventReferences;
    }),
    ...artifacts.flatMap(({ document }) => artifactInputReferences(document)),
  ];
  for (const reference of requiredReferences) {
    const identity = artifactReferenceIdentity(reference);
    if (!references.has(identity)) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING",
        "Artifact reference 不存在或 active exact identity 漂移。",
      );
    }
    if (traceArtifactTypes.has(reference.artifact_type) && !verifiedReferences.has(identity)) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
        "Artifact reference 存在但正文未通过对应权威 Store 的 strict 校验。",
      );
    }
  }
  return artifacts;
}

function sameReferenceSequence(
  left: readonly ArtifactReference[],
  right: readonly ArtifactReference[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (reference, index) =>
        artifactReferenceIdentity(reference) ===
        artifactReferenceIdentity(right[index] as ArtifactReference),
    )
  );
}

async function loadVerifiedE1Publication(
  client: SqlClient,
  authority: VerifiedRunAuthority,
  artifacts: readonly VerifiedArtifact[],
): Promise<VerifiedE1Publication | null> {
  const completionPresent = artifacts.some(
    ({ reference }) => reference.artifact_type === "AnalysisCompletionReceipt",
  );
  if (!completionPresent) return null;
  const result = await client.query<E1PublicationRow>(
    `select
       publication.publication_hash,
       publication.public_event_id,
       publication.command_json,
       publication.receipt_json,
       publication.committed_at,
       outbox.publication_hash as outbox_publication_hash,
       outbox.payload_json as outbox_payload_json,
       coalesce(bindings.items, '[]'::jsonb) as artifact_bindings
     from e1_analysis_publication_current as current_publication
     join e1_analysis_publications as publication
       on publication.app_id = current_publication.app_id
      and publication.tenant_id = current_publication.tenant_id
      and publication.environment = current_publication.environment
      and publication.run_id = current_publication.run_id
      and publication.publication_hash = current_publication.publication_hash
      and publication.public_event_id = current_publication.public_event_id
      and publication.committed_at = current_publication.committed_at
     join e1_analysis_publication_outbox as outbox
       on outbox.app_id = publication.app_id
      and outbox.tenant_id = publication.tenant_id
      and outbox.environment = publication.environment
      and outbox.run_id = publication.run_id
      and outbox.public_event_id = publication.public_event_id
      and outbox.publication_hash = publication.publication_hash
     left join lateral (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'ordinal', binding.ordinal,
           'role', binding.role,
           'reference', binding.reference_json
         ) order by binding.ordinal
       ) as items
       from e1_analysis_publication_artifacts as binding
       where binding.app_id = publication.app_id
         and binding.tenant_id = publication.tenant_id
         and binding.environment = publication.environment
         and binding.run_id = publication.run_id
         and binding.publication_hash = publication.publication_hash
     ) as bindings on true
     where publication.app_id = $1
       and publication.tenant_id = $2
       and publication.environment = $3
       and publication.run_id = $4
       and publication.principal_id = $5`,
    [
      authority.scope.app_id,
      authority.scope.tenant_id,
      authority.scope.environment,
      authority.run_id,
      authority.principal_id,
    ],
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_E1_PUBLICATION_MISSING",
      "READY AnalysisCompletionReceipt 缺少唯一 current E1 publication。",
    );
  }
  try {
    const row = result.rows[0];
    const command = await verifyE1AnalysisPublicationCommand(row.command_json);
    const receipt = e1AnalysisPublicationReceiptSchema.parse(row.receipt_json);
    const publishedReferences = receipt.references.map((reference) =>
      artifactReferenceSchema.parse(reference),
    );
    const outbox = e1PublicationOutboxPayloadSchema.parse(row.outbox_payload_json);
    const bindings = e1PublicationArtifactBindingsSchema.parse(row.artifact_bindings);
    const bindingReferences = bindings.map(({ reference }) => reference);
    const ordinalSequenceValid = bindings.every(({ ordinal }, index) => ordinal === index + 1);
    const exactProgram = artifacts.some(
      ({ reference }) =>
        artifactReferenceIdentity(reference) ===
        artifactReferenceIdentity(command.analysis_program_ref),
    );
    const artifactIdentities = new Set(
      artifacts.map(({ reference }) => artifactReferenceIdentity(reference)),
    );
    const exactPublishedClosure = publishedReferences.every((reference) =>
      artifactIdentities.has(artifactReferenceIdentity(reference)),
    );
    if (
      row.publication_hash !== command.publication_hash ||
      row.outbox_publication_hash !== command.publication_hash ||
      row.public_event_id !== command.public_event_id ||
      receipt.created !== true ||
      receipt.publication_hash !== command.publication_hash ||
      receipt.public_event_id !== command.public_event_id ||
      outbox.publication_hash !== command.publication_hash ||
      command.scope.app_id !== authority.scope.app_id ||
      command.scope.tenant_id !== authority.scope.tenant_id ||
      command.scope.environment !== authority.scope.environment ||
      command.run_id !== authority.run_id ||
      command.principal_id !== authority.principal_id ||
      command.worker_fence < 1 ||
      !ordinalSequenceValid ||
      hasDuplicateArtifactReferenceIdentities(publishedReferences) ||
      !sameReferenceSequence(bindingReferences, publishedReferences) ||
      !sameReferenceSequence(outbox.references, publishedReferences) ||
      !exactProgram ||
      !exactPublishedClosure
    ) {
      throw new TypeError("RESOLUTION_TRACE_E1_PUBLICATION_CLOSURE_INVALID");
    }
    return {
      publication_hash: command.publication_hash,
      public_event_id: command.public_event_id,
      committed_at: iso(row.committed_at),
      oracle_receipts: command.nodes.map(({ oracle_receipt: oracle }) => oracle),
      analysis_program_ref: command.analysis_program_ref,
      published_references: publishedReferences,
    };
  } catch (error) {
    if (error instanceof PersistenceBoundaryError) throw error;
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_E1_PUBLICATION_CORRUPT",
      "E1 publication 未通过 command、Oracle、current、outbox 与 Artifact closure 校验。",
    );
  }
}

function assertContinuousEvents(events: readonly RunRuntimeEvent[]): void {
  events.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_EVENT_GAP",
        "Run Event sequence 不连续。",
      );
    }
  });
}

function eventNode(event: RunRuntimeEvent): ResolutionTraceNode {
  const publicEvent = toPublicRunEvent(event);
  switch (publicEvent.type) {
    case "lifecycle":
      return {
        node_id: `event:${event.event_id}`,
        kind: "LIFECYCLE",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: publicEvent.payload.status,
        title: publicEvent.payload.name,
        summary: publicEvent.payload.summary,
        duration_ms: null,
        artifact_refs: [],
      };
    case "progress":
      return {
        node_id: `event:${event.event_id}`,
        kind: "PROGRESS",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: publicEvent.payload.status,
        title: publicEvent.payload.title,
        summary: redactPublicDisplayText(publicEvent.payload.summary).slice(0, 2_000),
        duration_ms: null,
        artifact_refs: [],
      };
    case "tool":
      return {
        node_id: `event:${event.event_id}`,
        kind: "TOOL",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: publicEvent.payload.status,
        title: publicEvent.payload.title,
        summary: redactPublicDisplayText(
          `${publicEvent.payload.summary}${publicEvent.payload.error_code ? ` · ${publicEvent.payload.error_code}` : ""}`,
        ).slice(0, 2_000),
        duration_ms: publicEvent.payload.duration_ms,
        artifact_refs: publicEvent.payload.artifact_refs,
      };
    case "agent":
      return {
        node_id: `event:${event.event_id}`,
        kind: "AGENT",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: publicEvent.payload.status,
        title: publicEvent.payload.title,
        summary: redactPublicDisplayText(
          `${publicEvent.payload.summary}${publicEvent.payload.error_code ? ` · ${publicEvent.payload.error_code}` : ""}`,
        ).slice(0, 2_000),
        duration_ms: publicEvent.payload.duration_ms,
        artifact_refs: [],
      };
    case "answer":
      return {
        node_id: `event:${event.event_id}`,
        kind: "ANSWER",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: "RUNNING",
        title: "Answer",
        summary: redactPublicDisplayText(publicEvent.payload.delta).slice(0, 2_000),
        duration_ms: null,
        artifact_refs: [],
      };
    case "reasoning":
      return {
        node_id: `event:${event.event_id}`,
        kind: "REASONING",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: publicEvent.payload.phase === "END" ? "COMPLETED" : "RUNNING",
        title: publicEvent.payload.phase === "START" ? publicEvent.payload.title : "思考摘要",
        summary:
          publicEvent.payload.phase === "DELTA"
            ? redactPublicDisplayText(publicEvent.payload.delta).slice(0, 2_000)
            : publicEvent.payload.phase === "END"
              ? redactPublicDisplayText(publicEvent.payload.summary).slice(0, 2_000)
              : "正在整理分析路径",
        duration_ms: publicEvent.payload.phase === "END" ? publicEvent.payload.duration_ms : null,
        artifact_refs: [],
      };
    case "terminal":
      return {
        node_id: `event:${event.event_id}`,
        kind: "TERMINAL",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: publicEvent.payload.status,
        title: "Run terminal",
        summary: redactPublicDisplayText(
          `${publicEvent.payload.summary}${publicEvent.payload.error_code ? ` · ${publicEvent.payload.error_code}` : ""}`,
        ).slice(0, 2_000),
        duration_ms: null,
        artifact_refs: [],
      };
  }
}

function artifactPublicSummary(artifact: VerifiedArtifact): string {
  const document = artifact.document;
  if ("projection" in document) {
    switch (document.projection.kind) {
      case "SQL":
        return redactPublicDisplayText(document.projection.sql).slice(0, 2_000);
      case "TABLE":
        return `${document.projection.total_rows} 行 · ${document.projection.columns
          .map(({ label }) => label)
          .join("、")}`.slice(0, 2_000);
      case "MARKDOWN":
        return redactPublicDisplayText(document.projection.plain_text).slice(0, 2_000);
      case "REPORT":
        return `${document.projection.title} · ${document.projection.sections.length} 个章节`;
      case "CHART":
        return `${document.projection.title} · ${"mark" in document.projection ? document.projection.mark : document.projection.chart_type} · ${document.projection.table.total_rows} 行`;
    }
  }
  if ("payload" in document && "protocol_version" in document.payload) {
    if (
      document.payload.artifact_type === "QueryEvidence" &&
      document.payload.protocol_version === "query-evidence@2.0.0"
    ) {
      return `${document.payload.observation.row_count} 行 · ${document.payload.protocol_version} · 结果已绑定`;
    }
    return `${document.payload.artifact_type} · ${document.payload.protocol_version} · current Research L2`;
  }
  if ("payload" in document) {
    switch (document.payload.artifact_type) {
      case "SqlArtifact":
        return redactPublicDisplayText(document.payload.sql).slice(0, 2_000);
      case "ExecutionReceipt":
        return `${document.payload.row_count} 行 · ${document.payload.replay_state} · ${document.payload.observed_at}`;
      case "QueryEvidence": {
        if (!("invariant_verdicts" in document.payload)) {
          return `${artifact.reference.artifact_type} 内容可通过 exact preview 查看`;
        }
        const passed = document.payload.invariant_verdicts.filter(
          ({ verdict }) => verdict === "PASS",
        ).length;
        return `${passed}/${document.payload.invariant_verdicts.length} 项结果不变量通过`;
      }
      case "AnalysisReport": {
        if (!("claim_refs" in document.payload) || !("limitations" in document.payload)) {
          return `${artifact.reference.artifact_type} 内容可通过 exact preview 查看`;
        }
        return `${document.payload.title} · ${document.payload.claim_refs.length} 项声明${document.payload.limitations[0] ? ` · 限制：${document.payload.limitations[0]}` : ""}`.slice(
          0,
          2_000,
        );
      }
      default:
        return `${artifact.reference.artifact_type} 内容可通过 exact preview 查看`;
    }
  }
  if ("contract_id" in document && "data" in document)
    return `治理分析结果 · ${Object.keys(document.data).length} 个字段`;
  if ("table_id" in document && "title_zh" in document && "total_rows" in document)
    return `${document.title_zh} · ${document.total_rows} 行`;
  if ("chart_id" in document && "title_zh" in document && "dataset" in document)
    return `${document.title_zh} · ${document.intent} · ${document.dataset.total_rows} 行`;
  if ("analysis_program_ref" in document && "cells" in document && "outputs" in document)
    return `OpenSandbox 执行完成 · ${document.cells.length} cells · ${document.outputs.length} outputs`;
  if ("receipt_ref" in document)
    return `SQL Sandbox 执行完成 · ${document.resource_usage.rows} 行 · ${document.resource_usage.elapsed_ms} ms`;
  if ("result_ref" in document)
    return `${document.row_count} 行 · ${document.columns.length} 列 · SandboxResult 已校验`;
  if ("artifact_type" in document && document.artifact_type === "SchemaSnapshot")
    return `${document.tables.length} 张表 · ${document.relationships.length} 条关系 · SchemaSnapshot 已校验`;
  return `${artifact.reference.artifact_type} 内容可通过 exact preview 查看`;
}

function artifactNode(artifact: VerifiedArtifact): ResolutionTraceNode {
  const type = artifact.reference.artifact_type;
  return {
    node_id: `artifact:${artifact.reference.artifact_id}:${artifact.reference.revision}`,
    kind: type === "SqlArtifact" ? "SQL" : "ARTIFACT",
    source_event_id: null,
    sequence: null,
    occurred_at: artifact.created_at,
    status: "AVAILABLE",
    title:
      "schema_version" in artifact.document &&
      artifact.document.schema_version.startsWith("analysis-published-")
        ? `${type} · ${artifact.document.schema_version.split("@")[0]}`
        : type,
    summary: artifactPublicSummary(artifact),
    duration_ms: null,
    artifact_refs: [artifact.reference],
  };
}

function e1PublicationNodes(publication: VerifiedE1Publication): ResolutionTraceNode[] {
  return [
    ...publication.oracle_receipts.map(
      (oracle): ResolutionTraceNode => ({
        node_id: `context:oracle:${oracle.oracle_id}`,
        kind: "CONTEXT",
        source_event_id: null,
        sequence: null,
        occurred_at: oracle.verified_at,
        status: "AVAILABLE",
        title: `Oracle · ${oracle.node_id}`,
        summary: `${oracle.verdict} · ${oracle.implementation_id} · coverage ${oracle.coverage_ratio}`,
        duration_ms: null,
        artifact_refs: [],
      }),
    ),
    {
      node_id: `context:publisher:${publication.public_event_id}`,
      kind: "CONTEXT",
      source_event_id: null,
      sequence: null,
      occurred_at: publication.committed_at,
      status: "AVAILABLE",
      title: "E1 Publisher",
      summary: `Atomic publication · ${publication.published_references.length} exact artifacts`,
      duration_ms: null,
      artifact_refs: [],
    },
  ];
}

function e1PublicationEdges(
  publication: VerifiedE1Publication,
  artifacts: readonly VerifiedArtifact[],
): ResolutionTraceEdge[] {
  const nodeByReference = new Map(
    artifacts.map(({ reference }) => [
      artifactReferenceIdentity(reference),
      `artifact:${reference.artifact_id}:${reference.revision}`,
    ]),
  );
  const programNode = nodeByReference.get(
    artifactReferenceIdentity(publication.analysis_program_ref),
  );
  if (!programNode) {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_E1_PROGRAM_NODE_MISSING",
      "E1 publication 的 AnalysisProgram 未解析到 exact Trace node。",
    );
  }
  const publisherNode = `context:publisher:${publication.public_event_id}`;
  const edges: ResolutionTraceEdge[] = [];
  for (const oracle of publication.oracle_receipts) {
    const oracleNode = `context:oracle:${oracle.oracle_id}`;
    edges.push({ from_node_id: programNode, to_node_id: oracleNode, kind: "EVIDENCE" });
    for (const reference of oracle.input_binding.query_evidence_refs) {
      const queryEvidenceNode = nodeByReference.get(artifactReferenceIdentity(reference));
      if (!queryEvidenceNode) {
        throw new PersistenceBoundaryError(
          "RESOLUTION_TRACE_E1_ORACLE_INPUT_MISSING",
          "Oracle QueryEvidence 未解析到 exact Trace node。",
        );
      }
      edges.push({ from_node_id: queryEvidenceNode, to_node_id: oracleNode, kind: "EVIDENCE" });
    }
    const derivedEvidenceNodes = artifacts.flatMap((artifact) =>
      "envelope" in artifact.document &&
      artifact.document.payload.artifact_type === "DerivedAnalysisEvidence" &&
      artifact.document.payload.node_id === oracle.node_id
        ? [`artifact:${artifact.reference.artifact_id}:${artifact.reference.revision}`]
        : [],
    );
    if (derivedEvidenceNodes.length !== 1 || !derivedEvidenceNodes[0]) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_E1_ORACLE_EVIDENCE_MISSING",
        "Oracle 必须绑定唯一 DerivedAnalysisEvidence node。",
      );
    }
    edges.push({
      from_node_id: derivedEvidenceNodes[0],
      to_node_id: oracleNode,
      kind: "EVIDENCE",
    });
    edges.push({ from_node_id: oracleNode, to_node_id: publisherNode, kind: "EVIDENCE" });
  }
  for (const reference of publication.published_references) {
    const target = nodeByReference.get(artifactReferenceIdentity(reference));
    if (!target) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_E1_PUBLISHED_NODE_MISSING",
        "Publisher exact Artifact 未解析到 Trace node。",
      );
    }
    edges.push({ from_node_id: publisherNode, to_node_id: target, kind: "EVIDENCE" });
  }
  return edges;
}

async function projectTrace(
  authority: VerifiedRunAuthority,
  events: readonly RunRuntimeEvent[],
  artifacts: readonly VerifiedArtifact[],
  publication: VerifiedE1Publication | null,
): Promise<ResolutionTrace> {
  assertContinuousEvents(events);
  const eventNodes = events.map(eventNode);
  const artifactNodes = artifacts.map(artifactNode);
  const nodes: ResolutionTraceNode[] = [
    ...eventNodes,
    ...artifactNodes,
    ...(publication ? e1PublicationNodes(publication) : []),
  ];
  if (authority.config_ref && authority.config_committed_at) {
    nodes.push({
      node_id: `config:${authority.config_ref.config_id}:${authority.config_ref.config_revision}`,
      kind: "CONTEXT",
      source_event_id: null,
      sequence: null,
      occurred_at: authority.config_committed_at,
      status: "AVAILABLE",
      title: "Effective config",
      summary: `Effective config revision ${authority.config_ref.config_revision}`,
      duration_ms: null,
      artifact_refs: [],
    });
  }
  const edges: ResolutionTraceEdge[] = [];
  for (let index = 1; index < eventNodes.length; index += 1) {
    const previous = eventNodes[index - 1];
    const node = eventNodes[index];
    if (previous && node) {
      edges.push({ from_node_id: previous.node_id, to_node_id: node.node_id, kind: "SEQUENCE" });
    }
  }
  const nodeByReference = new Map(
    artifacts.map((artifact) => [
      artifactReferenceIdentity(artifact.reference),
      `artifact:${artifact.reference.artifact_id}:${artifact.reference.revision}`,
    ]),
  );
  for (const eventNodeValue of eventNodes) {
    for (const reference of eventNodeValue.artifact_refs) {
      const target = nodeByReference.get(artifactReferenceIdentity(reference));
      if (!target) {
        throw new PersistenceBoundaryError(
          "RESOLUTION_TRACE_EVENT_ARTIFACT_NODE_MISSING",
          "Event ArtifactReference 必须解析到同一 Trace 快照中的唯一 Artifact node。",
        );
      }
      edges.push({ from_node_id: eventNodeValue.node_id, to_node_id: target, kind: "PRODUCED" });
    }
  }
  for (const artifact of artifacts) {
    const target = nodeByReference.get(artifactReferenceIdentity(artifact.reference));
    const inputReferences = new Map(
      artifactInputReferences(artifact.document).map((reference) => [
        artifactReferenceIdentity(reference),
        reference,
      ]),
    ).values();
    for (const input of inputReferences) {
      const source = nodeByReference.get(artifactReferenceIdentity(input));
      if (source && target)
        edges.push({ from_node_id: source, to_node_id: target, kind: "EVIDENCE" });
    }
  }
  if (publication) edges.push(...e1PublicationEdges(publication, artifacts));
  if (authority.config_ref && eventNodes[0]) {
    edges.push({
      from_node_id: `config:${authority.config_ref.config_id}:${authority.config_ref.config_revision}`,
      to_node_id: eventNodes[0].node_id,
      kind: "CONTEXT",
    });
  }
  try {
    return await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope: authority.scope,
      run_id: authority.run_id,
      conversation_id: authority.conversation_id,
      config_ref: authority.config_ref,
      nodes,
      edges,
    });
  } catch {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_PROJECTION_CORRUPT",
      "Resolution Trace 投影未通过 strict graph contract。",
    );
  }
}

type DetailSection = ResolutionTraceDetail["payload"];

function unavailableSection(reasonCode: string, message: string): DetailSection {
  return { state: "UNAVAILABLE", reason_code: reasonCode, message };
}

function textSection(text: string | null): DetailSection {
  const publicText = text
    ? redactPublicDisplayText(text).replace(
        /\b(?:reasoning_content|chain[- ]of[- ]thought|secretref|provider[_ -]?payload)\b/gi,
        "[REDACTED]",
      )
    : text;
  return publicText === null || publicText.length === 0
    ? unavailableSection("PUBLIC_CONTENT_UNAVAILABLE", "该记录没有发布可展示的公共内容。")
    : { state: "AVAILABLE", format: "TEXT", text: publicText, fields: [] };
}

function fieldsSection(fields: readonly { label: string; value: string }[]): DetailSection {
  return fields.length === 0
    ? unavailableSection("PUBLIC_CONTENT_UNAVAILABLE", "该记录没有发布可展示的公共字段。")
    : {
        state: "AVAILABLE",
        format: "FIELDS",
        text: null,
        fields: fields.map((field) => ({
          ...field,
          value: redactPublicDisplayText(field.value).replace(
            /\b(?:reasoning_content|chain[- ]of[- ]thought|secretref|provider[_ -]?payload)\b/gi,
            "[REDACTED]",
          ),
        })),
      };
}

function detailRelations(
  trace: ResolutionTrace,
  nodeId: string,
): ResolutionTraceDetail["relations"] {
  const relations: ResolutionTraceDetail["relations"][number][] = [];
  for (const edge of trace.edges) {
    if (edge.from_node_id === nodeId)
      relations.push({ direction: "OUTGOING", kind: edge.kind, node_id: edge.to_node_id });
    if (edge.to_node_id === nodeId)
      relations.push({ direction: "INCOMING", kind: edge.kind, node_id: edge.from_node_id });
  }
  return relations;
}

function detailIdentity(
  label: string,
  value: string | number | null,
  valueKind: ResolutionTraceDetail["identity"][number]["value_kind"],
): ResolutionTraceDetail["identity"][number][] {
  return value === null ? [] : [{ label, value: String(value), value_kind: valueKind }];
}

function detailSchema(
  name: string,
  version: string,
  fields: readonly string[],
): ResolutionTraceDetail["schema"] {
  return {
    state: "AVAILABLE",
    schema_name: name,
    schema_version: version,
    fields: fields.map((field) => ({ name: field, type: "public", availability: "AVAILABLE" })),
  };
}

async function projectDetail(
  authority: VerifiedRunAuthority,
  trace: ResolutionTrace,
  events: readonly RunRuntimeEvent[],
  artifacts: readonly VerifiedArtifact[],
  publication: VerifiedE1Publication | null,
  nodeId: string,
): Promise<ResolutionTraceDetail | null> {
  const node = trace.nodes.find((candidate) => candidate.node_id === nodeId);
  if (!node) return null;
  const effectiveConfig = await verifiedEffectiveConfig(authority);
  const answerSummary = events
    .map(toPublicRunEvent)
    .flatMap((event) => (event.type === "answer" ? [event.payload.delta] : []))
    .join("")
    .trim();
  const relations = detailRelations(trace, node.node_id);
  const baseIdentity: ResolutionTraceDetail["identity"] = [
    ...detailIdentity("Run ID", trace.run_id, "ID"),
    ...detailIdentity("Node ID", node.node_id, "ID"),
    ...detailIdentity("Sequence", node.sequence, "VERSION"),
  ];
  const runContext = fieldsSection([
    { label: "用户问题", value: authority.question },
    { label: "Run 状态", value: authority.run_status },
    { label: "创建时间", value: authority.run_created_at },
    { label: "更新时间", value: authority.run_updated_at },
    { label: "当前执行尝试", value: authority.active_attempt_id ?? "当前没有 active attempt" },
    { label: "尝试次数", value: String(authority.attempt_count) },
    { label: "Worker fence", value: String(authority.active_fence) },
    { label: "Authority epoch", value: authority.authority.epoch },
    { label: "Authority baseline", value: authority.authority.baseline_id },
    { label: "Baseline hash", value: authority.authority.baseline_hash },
    { label: "所属对话", value: authority.conversation_title ?? "对话标题不可用" },
    { label: "对话绑定", value: authority.conversation_id ?? "该 Run 没有 Conversation binding" },
    {
      label: "对话资源版本",
      value: authority.conversation_resource_version
        ? String(authority.conversation_resource_version)
        : "不可用",
    },
    { label: "对话消息数", value: String(authority.conversation_message_count) },
    {
      label: "数据源绑定",
      value: authority.datasource_id
        ? `${authority.datasource_id} · 历史显示名未冻结`
        : "该 Run 没有 Datasource binding",
    },
    { label: "公开回答摘要", value: answerSummary || "尚未发布公开回答" },
    {
      label: "冻结模型",
      value: effectiveConfig
        ? `${effectiveConfig.model.provider} / ${effectiveConfig.model.model_id} · ${effectiveConfig.model.profile_version}`
        : "该 Run 没有 Effective Config",
    },
    {
      label: "冻结配置",
      value: authority.config_ref
        ? `${authority.config_ref.config_id} · r${authority.config_ref.config_revision}`
        : "该 Run 没有 Effective Config",
    },
  ]);
  let identity = baseIdentity;
  let payload: DetailSection = fieldsSection([
    { label: "问题", value: authority.question },
    { label: "Run 状态", value: authority.run_status },
  ]);
  let result: DetailSection = unavailableSection(
    "PUBLIC_RESULT_UNAVAILABLE",
    "该记录尚未发布公共结果。",
  );
  let schema: ResolutionTraceDetail["schema"] = {
    state: "UNAVAILABLE",
    reason_code: "PUBLIC_SCHEMA_UNAVAILABLE",
    message: "该记录没有发布公共 Schema。",
  };
  let sourceEventIds: string[] = node.source_event_id ? [node.source_event_id] : [];
  let startedAt: string | null = null;
  let completedAt: string | null = null;
  let durationMs = node.duration_ms;

  if (node.source_event_id) {
    const source = events.find((event) => event.event_id === node.source_event_id);
    if (!source) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_EVENT_CORRUPT",
        "Trace node 的 source event 无法在同一权威快照中解析。",
      );
    }
    const publicEvent = toPublicRunEvent(source);
    schema = detailSchema(
      "public-run-event",
      publicEvent.schema_version,
      Object.keys(publicEvent.payload).map((key) => `payload.${key}`),
    );
    switch (publicEvent.type) {
      case "tool": {
        const related = events
          .map(toPublicRunEvent)
          .filter(
            (event): event is Extract<PublicRunEventV2, { type: "tool" }> =>
              event.type === "tool" && event.payload.call_id === publicEvent.payload.call_id,
          );
        const start = related.find(
          (event) => event.type === "tool" && event.payload.status === "RUNNING",
        );
        const terminal = related.find(
          (event) => event.type === "tool" && event.payload.status !== "RUNNING",
        );
        if (
          related.some(
            (event) =>
              event.payload.tool_name !== publicEvent.payload.tool_name ||
              event.payload.profile_id !== publicEvent.payload.profile_id ||
              event.payload.task_id !== publicEvent.payload.task_id,
          )
        ) {
          throw new PersistenceBoundaryError(
            "RESOLUTION_TRACE_TOOL_IDENTITY_MISMATCH",
            "同一 Tool call 的公开 identity 不一致。",
          );
        }
        sourceEventIds = related.map(({ event_id }) => event_id);
        startedAt = start?.occurred_at ?? null;
        completedAt = terminal?.occurred_at ?? null;
        durationMs = terminal?.payload.duration_ms ?? node.duration_ms;
        identity = [
          ...baseIdentity,
          ...detailIdentity("Tool", publicEvent.payload.tool_name, "NAME"),
          ...detailIdentity("Call ID", publicEvent.payload.call_id, "ID"),
          ...detailIdentity("Agent Profile", publicEvent.payload.profile_id, "NAME"),
          ...detailIdentity("Task ID", publicEvent.payload.task_id, "ID"),
          ...detailIdentity("Error code", terminal?.payload.error_code ?? null, "STATUS"),
        ];
        payload = textSection(start?.payload.input ?? publicEvent.payload.input);
        result = terminal?.payload.output
          ? textSection(terminal.payload.output)
          : node.artifact_refs.length > 0
            ? {
                state: "AVAILABLE",
                format: "ARTIFACTS",
                text: `${node.artifact_refs.length} 个可预览 Artifact`,
                fields: node.artifact_refs.map((reference) => ({
                  label: reference.artifact_type,
                  value: `${reference.artifact_id} · r${reference.revision}`,
                })),
              }
            : terminal?.payload.error_code
              ? fieldsSection([
                  { label: "错误码", value: terminal.payload.error_code },
                  { label: "摘要", value: terminal.payload.summary },
                ])
              : unavailableSection("PUBLIC_RESULT_UNAVAILABLE", "Tool 尚未发布公共结果。");
        break;
      }
      case "agent": {
        const related = publicEvent.payload.task_id
          ? events
              .map(toPublicRunEvent)
              .filter(
                (event): event is Extract<PublicRunEventV2, { type: "agent" }> =>
                  event.type === "agent" &&
                  event.payload.profile_id === publicEvent.payload.profile_id &&
                  event.payload.task_id === publicEvent.payload.task_id,
              )
          : [publicEvent];
        const start = related.find(({ payload: candidate }) =>
          ["PENDING", "RUNNING"].includes(candidate.status),
        );
        const terminal = related.find(({ payload: candidate }) =>
          ["COMPLETED", "FAILED", "INTERRUPTED", "SKIPPED", "BLOCKED"].includes(candidate.status),
        );
        sourceEventIds = related.map(({ event_id }) => event_id);
        startedAt = start?.occurred_at ?? null;
        completedAt = terminal?.occurred_at ?? null;
        durationMs = terminal?.payload.duration_ms ?? node.duration_ms;
        identity = [
          ...baseIdentity,
          ...detailIdentity("Agent Profile", publicEvent.payload.profile_id, "NAME"),
          ...detailIdentity("Task ID", publicEvent.payload.task_id, "ID"),
          ...detailIdentity("Phase", publicEvent.payload.phase, "VERSION"),
          ...detailIdentity("Error code", publicEvent.payload.error_code, "STATUS"),
        ];
        payload = fieldsSection([
          { label: "阶段", value: publicEvent.payload.phase },
          { label: "公开摘要", value: publicEvent.payload.summary },
        ]);
        result =
          terminal?.payload.status === "COMPLETED"
            ? textSection(terminal.payload.summary)
            : unavailableSection("AGENT_RESULT_NOT_COMPLETED", "Agent 尚未发布完成结果。");
        break;
      }
      case "progress":
        identity = [
          ...baseIdentity,
          ...detailIdentity("Phase", publicEvent.payload.phase, "VERSION"),
        ];
        payload = fieldsSection([
          { label: "阶段", value: publicEvent.payload.phase },
          { label: "公开摘要", value: publicEvent.payload.summary },
        ]);
        break;
      case "answer":
        payload = unavailableSection("ANSWER_PAYLOAD_NOT_PUBLIC", "Answer 只发布公共正文增量。");
        result = textSection(publicEvent.payload.delta);
        break;
      case "reasoning": {
        const related = events
          .map(toPublicRunEvent)
          .filter(
            (event): event is Extract<PublicRunEventV2, { type: "reasoning" }> =>
              event.type === "reasoning" && event.payload.block_id === publicEvent.payload.block_id,
          );
        const start = related.find(({ payload: candidate }) => candidate.phase === "START");
        const end = related.find(({ payload: candidate }) => candidate.phase === "END");
        const deltas = related.flatMap(({ payload: candidate }) =>
          candidate.phase === "DELTA" ? [candidate.delta] : [],
        );
        sourceEventIds = related.map(({ event_id }) => event_id);
        startedAt = start?.occurred_at ?? null;
        completedAt = end?.occurred_at ?? null;
        durationMs = end?.payload.phase === "END" ? end.payload.duration_ms : node.duration_ms;
        identity = [
          ...baseIdentity,
          ...detailIdentity("Block ID", publicEvent.payload.block_id, "ID"),
          ...detailIdentity("Phase", publicEvent.payload.phase, "STATUS"),
        ];
        payload = textSection(
          start?.payload.phase === "START" ? start.payload.title : node.summary,
        );
        result =
          end?.payload.phase === "END"
            ? textSection(end.payload.summary)
            : deltas.length > 0
              ? textSection(deltas.join("\n"))
              : unavailableSection("REASONING_RESULT_INCOMPLETE", "公开思考摘要尚未结束。");
        break;
      }
      case "lifecycle":
        identity = [
          ...baseIdentity,
          ...detailIdentity("Lifecycle event", publicEvent.payload.name, "NAME"),
          ...detailIdentity("Active fence", authority.active_fence, "VERSION"),
        ];
        payload = fieldsSection([
          { label: "用户问题", value: authority.question },
          { label: "权威 Run 状态", value: authority.run_status },
          { label: "事件说明", value: publicEvent.payload.summary },
        ]);
        break;
      case "terminal":
        identity = [
          ...baseIdentity,
          ...detailIdentity("Error code", publicEvent.payload.error_code, "STATUS"),
        ];
        payload = fieldsSection([
          { label: "用户问题", value: authority.question },
          { label: "权威 Run 状态", value: authority.run_status },
        ]);
        result = textSection(publicEvent.payload.summary);
        break;
    }
  } else if (node.node_id.startsWith("config:") && effectiveConfig) {
    const config = effectiveConfig;
    identity = [
      ...baseIdentity,
      ...detailIdentity("Config ID", config.config_id, "ID"),
      ...detailIdentity("Config revision", config.config_revision, "VERSION"),
      ...detailIdentity("Config hash", config.config_hash, "HASH"),
    ];
    payload = fieldsSection([
      { label: "模型", value: config.model.model_id },
      { label: "Provider", value: config.model.provider },
      { label: "Model profile version", value: config.model.profile_version },
      {
        label: "数据源",
        value: `${config.datasource.resource_id} · r${config.datasource.resource_revision} · 历史显示名未冻结`,
      },
      {
        label: "Semantic Release",
        value: `${config.semantic_release.resource_id} · generation ${config.semantic_release.semantic_generation} · 历史显示名未冻结`,
      },
      {
        label: "Schema Snapshot",
        value: `${config.schema_snapshot.resource_id} · r${config.schema_snapshot.resource_revision} · 历史显示名未冻结`,
      },
      {
        label: "Context Policy",
        value: `${config.context_policy.resource_id} · r${config.context_policy.resource_revision} · 历史显示名未冻结`,
      },
      {
        label: "Egress Policy",
        value: `${config.egress_policy.resource_id} · r${config.egress_policy.resource_revision} · 历史显示名未冻结`,
      },
      {
        label: "Safety Policy",
        value: `${config.execution_safety_policy.resource_id} · r${config.execution_safety_policy.resource_revision} · 历史显示名未冻结`,
      },
      {
        label: "历史名称状态",
        value: "HISTORICAL_DISPLAY_NAME_UNAVAILABLE",
      },
    ]);
    result = fieldsSection([
      { label: "提交时间", value: authority.config_committed_at ?? node.occurred_at },
      { label: "Resource bindings", value: String(config.resource_bindings.length) },
    ]);
    schema = detailSchema("effective-run-config-receipt", config.schema_version, [
      "model",
      "datasource",
      "semantic_release",
      "schema_snapshot",
      "context_policy",
      "egress_policy",
      "execution_safety_policy",
      "resource_bindings",
    ]);
  } else if (node.node_id.startsWith("config:")) {
    identity = [
      ...baseIdentity,
      ...(authority.config_ref
        ? [
            ...detailIdentity("Config ID", authority.config_ref.config_id, "ID"),
            ...detailIdentity("Config revision", authority.config_ref.config_revision, "VERSION"),
            ...detailIdentity("Config hash", authority.config_ref.config_hash, "HASH"),
          ]
        : []),
    ];
    payload = unavailableSection(
      "HISTORICAL_CONFIG_CONTENT_UNAVAILABLE",
      "该 Run 保留了 exact Config 身份，但没有可公开读取的历史配置内容。",
    );
    result = unavailableSection(
      "HISTORICAL_DISPLAY_NAME_UNAVAILABLE",
      "禁止从当前 Catalog 回查名称冒充历史绑定。",
    );
  } else if (node.node_id.startsWith("context:oracle:") && publication) {
    const oracle = publication.oracle_receipts.find(
      ({ oracle_id: oracleId }) => node.node_id === `context:oracle:${oracleId}`,
    );
    if (!oracle) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_E1_ORACLE_NODE_CORRUPT",
        "Oracle node 无法解析到同一 E1 publication。",
      );
    }
    identity = [
      ...baseIdentity,
      ...detailIdentity("Oracle ID", oracle.oracle_id, "ID"),
      ...detailIdentity("Analysis node", oracle.node_id, "NAME"),
      ...detailIdentity("Receipt hash", oracle.receipt_hash, "HASH"),
      ...detailIdentity("Publication hash", publication.publication_hash, "HASH"),
    ];
    payload = fieldsSection([
      { label: "实现", value: oracle.implementation_id },
      { label: "实现 hash", value: oracle.implementation_hash },
      { label: "样本数", value: String(oracle.sample_size) },
      { label: "覆盖率", value: String(oracle.coverage_ratio) },
      { label: "QueryEvidence 数", value: String(oracle.input_binding.query_evidence_refs.length) },
    ]);
    result = fieldsSection([
      { label: "独立判定", value: oracle.verdict },
      { label: "Expected terminal", value: oracle.expected_terminal },
      { label: "限制码", value: oracle.limitation_codes.join(" · ") || "无" },
      { label: "披露码", value: oracle.disclosure_codes.join(" · ") || "无" },
    ]);
    schema = detailSchema("analysis-oracle-receipt", oracle.schema_version, [
      "oracle_id",
      "node_id",
      "implementation_id",
      "input_binding",
      "verdict",
      "expected_terminal",
      "receipt_hash",
    ]);
  } else if (node.node_id.startsWith("context:publisher:") && publication) {
    if (node.node_id !== `context:publisher:${publication.public_event_id}`) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_E1_PUBLISHER_NODE_CORRUPT",
        "Publisher node 无法解析到同一 E1 publication。",
      );
    }
    identity = [
      ...baseIdentity,
      ...detailIdentity("Public event ID", publication.public_event_id, "ID"),
      ...detailIdentity("Publication hash", publication.publication_hash, "HASH"),
      ...detailIdentity("Baseline hash", authority.authority.baseline_hash, "HASH"),
    ];
    payload = fieldsSection([
      { label: "发布模式", value: "ATOMIC" },
      { label: "Authority epoch", value: authority.authority.epoch },
      { label: "Exact artifact 数", value: String(publication.published_references.length) },
    ]);
    result = fieldsSection([
      { label: "状态", value: "COMMITTED" },
      { label: "提交时间", value: publication.committed_at },
    ]);
    schema = detailSchema("e1-analysis-publication", "e1-analysis-publication@1.0.0", [
      "publication_hash",
      "public_event_id",
      "analysis_program_ref",
      "references",
    ]);
  } else if (node.artifact_refs.length > 0) {
    const verifiedReferences = node.artifact_refs.filter((reference) =>
      artifacts.some(
        (artifact) =>
          artifactReferenceIdentity(artifact.reference) === artifactReferenceIdentity(reference),
      ),
    );
    if (verifiedReferences.length !== node.artifact_refs.length) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING",
        "Trace detail Artifact reference 无法在同一权威快照中验证。",
      );
    }
    const first = verifiedReferences[0];
    identity = [
      ...baseIdentity,
      ...(first ? detailIdentity("Artifact ID", first.artifact_id, "ID") : []),
      ...(first ? detailIdentity("Artifact type", first.artifact_type, "NAME") : []),
      ...(first ? detailIdentity("Revision", first.revision, "VERSION") : []),
      ...(first ? detailIdentity("Content hash", first.content_hash, "HASH") : []),
    ];
    const matchingArtifacts = verifiedReferences.flatMap((reference) => {
      const artifact = artifacts.find(
        (candidate) =>
          artifactReferenceIdentity(candidate.reference) === artifactReferenceIdentity(reference),
      );
      return artifact ? [artifact] : [];
    });
    payload = {
      state: "AVAILABLE",
      format: "TEXT",
      text: matchingArtifacts.map(artifactPublicSummary).join("\n\n"),
      fields: verifiedReferences.map((reference) => ({
        label: reference.artifact_type,
        value: `revision ${reference.revision} · exact preview`,
      })),
    };
    result = {
      state: "AVAILABLE",
      format: "ARTIFACTS",
      text: `${verifiedReferences.length} 个 exact Artifact 可安全预览`,
      fields: [],
    };
    const firstDocument = matchingArtifacts[0]?.document;
    if (
      firstDocument &&
      "envelope" in firstDocument &&
      firstDocument.payload.artifact_type === "DerivedAnalysisEvidence"
    ) {
      identity = [
        ...identity,
        ...detailIdentity("Analysis node", firstDocument.payload.node_id, "NAME"),
        ...detailIdentity(
          "Program hash",
          firstDocument.payload.analysis_program_ref.content_hash,
          "HASH",
        ),
      ];
    }
    if (firstDocument && "schema_version" in firstDocument) {
      const schemaName =
        "artifact_ref" in firstDocument
          ? "product-team-artifact"
          : firstDocument.schema_version.startsWith("artifact-workspace-chart-document@")
            ? "artifact-workspace-chart-document"
            : "artifact-reference";
      schema = detailSchema(schemaName, firstDocument.schema_version, [
        "artifact_id",
        "artifact_type",
        "revision",
        "content_hash",
        "source_refs",
      ]);
    } else {
      schema = detailSchema("artifact-reference", "artifact-reference@1.0.0", [
        "artifact_id",
        "artifact_type",
        "revision",
        "content_hash",
        "scope",
        "run_id",
      ]);
    }
  }

  return buildResolutionTraceDetail({
    schema_version: "resolution-trace-detail@3.0.0",
    trace_hash: trace.trace_hash,
    scope: trace.scope,
    run_id: trace.run_id,
    node_id: node.node_id,
    kind: node.kind,
    sequence: node.sequence,
    source_event_ids: sourceEventIds,
    title: node.title,
    status: node.status,
    summary: node.summary,
    hierarchy: {
      parent_node_ids: relations
        .filter(({ direction }) => direction === "INCOMING")
        .map(({ node_id }) => node_id),
      child_node_ids: relations
        .filter(({ direction }) => direction === "OUTGOING")
        .map(({ node_id }) => node_id),
    },
    run_context: runContext,
    identity,
    payload,
    result,
    schema,
    timing: {
      occurred_at: node.occurred_at,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
      source: node.source_event_id ? "SESSION_TIMESTAMPS" : "ARTIFACT_TIMESTAMP",
    },
    relations,
    artifact_refs: node.artifact_refs,
  });
}

async function projectSqlHistory(
  authority: VerifiedRunAuthority,
  artifacts: readonly VerifiedArtifact[],
): Promise<SqlHistoryEntry[]> {
  if (!authority.schema_snapshot_hash) {
    if (artifacts.some(({ reference }) => reference.artifact_type === "SqlArtifact")) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_CONFIG_MISSING",
        "SQL Artifact 缺少 Effective Config Schema Snapshot binding。",
      );
    }
    return [];
  }
  if (
    authority.conversation_id === null &&
    artifacts.some(({ reference }) => reference.artifact_type === "SqlArtifact")
  ) {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_CONVERSATION_MISSING",
      "SQL Artifact 缺少权威 Conversation binding。",
    );
  }
  const byIdentity = new Map(
    artifacts.map((artifact) => [artifactReferenceIdentity(artifact.reference), artifact]),
  );
  const l2Document = (artifact: VerifiedArtifact) =>
    artifact.document && "envelope" in artifact.document ? artifact.document : null;
  const executions = artifacts.filter(
    (artifact) => l2Document(artifact)?.payload.artifact_type === "ExecutionReceipt",
  );
  const evidences = artifacts.filter(
    (artifact) => l2Document(artifact)?.payload.artifact_type === "QueryEvidence",
  );
  const entries: SqlHistoryEntry[] = [];
  for (const artifact of artifacts) {
    const sqlDocument = l2Document(artifact);
    if (sqlDocument?.payload.artifact_type !== "SqlArtifact") continue;
    const sql = sqlDocument.payload;
    const execution = executions.find((candidate) => {
      const candidateDocument = l2Document(candidate);
      return (
        candidateDocument?.payload.artifact_type === "ExecutionReceipt" &&
        artifactReferenceIdentity(candidateDocument.payload.sql_artifact_ref) ===
          artifactReferenceIdentity(artifact.reference)
      );
    });
    const executionDocument = execution ? l2Document(execution) : null;
    const executionPayload =
      executionDocument?.payload.artifact_type === "ExecutionReceipt"
        ? executionDocument.payload
        : null;
    const evidence = execution
      ? evidences.find((candidate) => {
          const candidateDocument = l2Document(candidate);
          return (
            candidateDocument?.payload.artifact_type === "QueryEvidence" &&
            artifactReferenceIdentity(candidateDocument.payload.execution_receipt_ref) ===
              artifactReferenceIdentity(execution.reference)
          );
        })
      : undefined;
    const resultRef = executionPayload?.result_artifact_ref ?? null;
    if (resultRef && !byIdentity.has(artifactReferenceIdentity(resultRef))) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING",
        "ExecutionReceipt result Artifact 引用无法验证。",
      );
    }
    const schemaSnapshot = artifacts.find(
      ({ reference }) =>
        reference.artifact_type === "SchemaSnapshot" &&
        reference.content_hash === authority.schema_snapshot_hash,
    );
    entries.push(
      await buildSqlHistoryEntry({
        schema_version: "sql-history-entry@1.0.0",
        scope: authority.scope,
        run_id: authority.run_id,
        conversation_id: authority.conversation_id,
        sql_artifact_ref: artifact.reference as Extract<
          ArtifactReference,
          { artifact_type: "SqlArtifact" }
        >,
        execution_receipt_ref: execution
          ? (execution.reference as Extract<
              ArtifactReference,
              { artifact_type: "ExecutionReceipt" }
            >)
          : null,
        query_evidence_ref: evidence
          ? (evidence.reference as Extract<ArtifactReference, { artifact_type: "QueryEvidence" }>)
          : null,
        result_ref: resultRef,
        schema_snapshot_ref: schemaSnapshot
          ? (schemaSnapshot.reference as Extract<
              ArtifactReference,
              { artifact_type: "SchemaSnapshot" }
            >)
          : null,
        schema_snapshot_hash: authority.schema_snapshot_hash,
        compiler_version: sql.compiler_version,
        ast_hash: sql.ast_hash,
        statement_hash: await sha256ContentHash(sql.sql),
        parameter_hash: await sha256ContentHash(sql.parameters),
        query_hash: sql.query_hash,
        status: evidence ? "VALIDATED" : execution ? "EXECUTED" : "COMPILED",
        occurred_at: artifact.created_at,
        conversation_href: `/w/${authority.scope.tenant_id}/qa?conversation=${authority.conversation_id}&run=${authority.run_id}&tab=conversation`,
      }),
    );
  }
  return entries;
}

export interface PostgresResolutionTraceProjectorOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

export function createPostgresResolutionTraceProjector(
  options: PostgresResolutionTraceProjectorOptions,
) {
  return {
    async loadTrace(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<ResolutionTrace | null>> {
      const lookup = traceLookupSchema.safeParse(input);
      if (!lookup.success)
        return invalid("RESOLUTION_TRACE_LOOKUP_INVALID", "Resolution Trace lookup 不符合契约。");
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          snapshot: "REPEATABLE_READ",
          operation_name: "resolution-trace.load",
        },
        async ({ capability, client }) => {
          assertScope(lookup.data.scope, capability.scope);
          const [authority] = await loadRunAuthority(
            client,
            capability.scope,
            capability.principal,
            lookup.data.run_id,
          );
          if (!authority) return null;
          const events = await loadVerifiedRunEvents(client, capability.scope, authority.run_id);
          const artifacts = await loadVerifiedArtifacts(client, authority, events);
          const publication = await loadVerifiedE1Publication(client, authority, artifacts);
          return projectTrace(authority, events, artifacts, publication);
        },
      );
    },

    async loadDetail(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<ResolutionTraceDetail | null>> {
      const lookup = traceDetailLookupSchema.safeParse(input);
      if (!lookup.success)
        return invalid(
          "RESOLUTION_TRACE_DETAIL_LOOKUP_INVALID",
          "Resolution Trace detail lookup 不符合契约。",
        );
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          snapshot: "REPEATABLE_READ",
          operation_name: "resolution-trace.detail.load",
        },
        async ({ capability, client }) => {
          assertScope(lookup.data.scope, capability.scope);
          const [authority] = await loadRunAuthority(
            client,
            capability.scope,
            capability.principal,
            lookup.data.run_id,
          );
          if (!authority) return null;
          const events = await loadVerifiedRunEvents(client, capability.scope, authority.run_id);
          const artifacts = await loadVerifiedArtifacts(client, authority, events);
          const publication = await loadVerifiedE1Publication(client, authority, artifacts);
          const trace = await projectTrace(authority, events, artifacts, publication);
          if (trace.trace_hash !== lookup.data.expected_trace_hash) {
            throw new PersistenceBoundaryError(
              "RESOLUTION_TRACE_SNAPSHOT_STALE",
              "Trace detail 请求绑定的快照已变化。",
            );
          }
          return projectDetail(
            authority,
            trace,
            events,
            artifacts,
            publication,
            lookup.data.node_id,
          );
        },
      );
    },

    async listSqlHistory(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<SqlHistoryResult>> {
      const lookup = sqlHistoryLookupSchema.safeParse(input);
      if (!lookup.success)
        return invalid("SQL_HISTORY_LOOKUP_INVALID", "SQL History lookup 不符合契约。");
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        { access: "READ", snapshot: "REPEATABLE_READ", operation_name: "sql-history.list" },
        async ({ capability, client }) => {
          assertScope(lookup.data.scope, capability.scope);
          const authorities = await loadRunAuthority(
            client,
            capability.scope,
            capability.principal,
            lookup.data.run_id,
            lookup.data.conversation_id,
          );
          const entries: SqlHistoryEntry[] = [];
          for (const authority of authorities)
            entries.push(
              ...(await projectSqlHistory(
                authority,
                await loadVerifiedArtifacts(client, authority, []),
              )),
            );
          const filteredEntries = entries.filter(
            (entry) =>
              (!lookup.data.occurred_after || entry.occurred_at >= lookup.data.occurred_after) &&
              (!lookup.data.occurred_before || entry.occurred_at < lookup.data.occurred_before),
          );
          filteredEntries.sort(
            (left, right) =>
              right.occurred_at.localeCompare(left.occurred_at) ||
              right.entry_hash.localeCompare(left.entry_hash),
          );
          return {
            schema_version: "sql-history-result@1.0.0",
            items: filteredEntries.slice(0, lookup.data.limit),
            next_cursor:
              filteredEntries.length > lookup.data.limit
                ? (filteredEntries.at(lookup.data.limit - 1)?.entry_hash ?? null)
                : null,
          };
        },
      );
    },
  };
}

export type PostgresResolutionTraceProjector = ReturnType<
  typeof createPostgresResolutionTraceProjector
>;
