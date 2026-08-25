import {
  type AppScope,
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV2,
  type ArtifactWorkspaceChartDocumentV3,
  appScopeSchema,
  artifactReferenceIdentity,
  buildResolutionTrace,
  buildSqlHistoryEntry,
  computeL2ArtifactContentHash,
  computeProductTeamArtifactHash,
  contentHashSchema,
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
  resolutionTraceDetailSchema,
  type SqlHistoryEntry,
  type SqlHistoryResult,
  sha256ContentHash,
  timestampSchema,
  toPublicRunEvent,
  verifyArtifactWorkspaceChartDocumentV2,
  verifyArtifactWorkspaceChartDocumentV3,
  verifyEffectiveRunConfigReceiptCandidate,
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
}

interface ArtifactRow {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly revision: string | number;
  readonly content_hash: string;
  readonly document_json: unknown;
  readonly created_at: Date | string;
}

interface VerifiedArtifact {
  readonly reference: ArtifactReference;
  readonly document:
    | z.infer<typeof l2ArtifactDocumentSchema>
    | ReturnType<typeof parseL2ResearchDocumentCandidate>
    | z.infer<typeof productTeamArtifactDocumentSchema>
    | ArtifactWorkspaceChartDocumentV2
    | ArtifactWorkspaceChartDocumentV3
    | null;
  readonly created_at: string;
}

interface VerifiedRunAuthority {
  readonly scope: AppScope;
  readonly run_id: string;
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
}

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
    };
  });
}

function referenceFromRow(scope: AppScope, runId: string, row: ArtifactRow): ArtifactReference {
  return {
    artifact_id: immutableIdSchema.parse(row.artifact_id),
    artifact_type: z
      .enum([
        "SqlArtifact",
        "ExecutionReceipt",
        "QueryEvidence",
        "DerivedAnalysisEvidence",
        "AnalysisReport",
        "ArtifactWorkspaceDocument",
        "SchemaSnapshot",
        "SandboxResult",
      ])
      .parse(row.artifact_type),
    ...scope,
    run_id: immutableIdSchema.parse(runId),
    revision: z.coerce.number().int().positive().parse(row.revision),
    content_hash: contentHashSchema.parse(row.content_hash),
  };
}

async function requireStoredArtifactReference(
  client: SqlClient,
  reference: ArtifactReference,
): Promise<void> {
  const exists = await client.query(
    `select 1
     from artifacts
     where app_id = $1
       and tenant_id = $2
       and environment = $3
       and run_id = $4
       and artifact_id = $5
       and artifact_type = $6
       and revision = $7
       and content_hash = $8
     limit 1`,
    [
      reference.app_id,
      reference.tenant_id,
      reference.environment,
      reference.run_id,
      reference.artifact_id,
      reference.artifact_type,
      reference.revision,
      reference.content_hash,
    ],
  );
  if (exists.rowCount !== 1) {
    throw new PersistenceBoundaryError(
      "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING",
      "Artifact reference 不存在或 exact identity 漂移。",
    );
  }
}

async function verifyEventArtifactReferences(
  client: SqlClient,
  events: readonly RunRuntimeEvent[],
): Promise<void> {
  const verified = new Set<string>();
  for (const event of events) {
    for (const reference of eventNode(event).artifact_refs) {
      const identity = artifactReferenceIdentity(reference);
      if (verified.has(identity)) continue;
      await requireStoredArtifactReference(client, reference);
      verified.add(identity);
    }
  }
}

async function loadVerifiedArtifacts(
  client: SqlClient,
  authority: VerifiedRunAuthority,
): Promise<VerifiedArtifact[]> {
  const result = await client.query<ArtifactRow>(
    `select artifact_id, artifact_type, revision, content_hash, document_json, created_at
     from artifacts
     where app_id = $1
       and tenant_id = $2
       and environment = $3
       and run_id = $4
       and is_active = true
       and artifact_type = any($5::text[])
     order by created_at, artifact_id, revision`,
    [
      authority.scope.app_id,
      authority.scope.tenant_id,
      authority.scope.environment,
      authority.run_id,
      [
        "SqlArtifact",
        "ExecutionReceipt",
        "QueryEvidence",
        "DerivedAnalysisEvidence",
        "AnalysisReport",
        "ArtifactWorkspaceDocument",
        "SchemaSnapshot",
        "SandboxResult",
      ],
    ],
  );
  const artifacts: VerifiedArtifact[] = [];
  for (const row of result.rows) {
    const reference = referenceFromRow(authority.scope, authority.run_id, row);
    if (
      reference.artifact_type === "SchemaSnapshot" ||
      reference.artifact_type === "SandboxResult"
    ) {
      artifacts.push({
        reference,
        document: null,
        created_at: iso(row.created_at),
      });
      continue;
    }
    const l2Result = l2ArtifactDocumentSchema.safeParse(row.document_json);
    const productResult = productTeamArtifactDocumentSchema.safeParse(row.document_json);
    let document: Exclude<VerifiedArtifact["document"], null>;
    let computedHash: string;
    if (l2Result.success && l2Result.data.envelope.status === "COMMITTED") {
      document = l2Result.data;
      computedHash = await computeL2ArtifactContentHash(document);
    } else if (productResult.success) {
      document = productResult.data;
      computedHash = await computeProductTeamArtifactHash(document);
    } else if (reference.artifact_type === "ArtifactWorkspaceDocument") {
      try {
        document = await verifyArtifactWorkspaceChartDocumentV2(row.document_json);
        computedHash = contentHashSchema.parse(document.document_ref.content_hash);
      } catch {
        try {
          document = await verifyArtifactWorkspaceChartDocumentV3(row.document_json);
          computedHash = contentHashSchema.parse(document.document_ref.content_hash);
        } catch {
          throw new PersistenceBoundaryError(
            "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
            "Stored Chart document 未通过 strict schema、dataset hash 与 document hash 校验。",
          );
        }
      }
    } else {
      try {
        const research = await parseAndHashL2ResearchDocumentCandidate(row.document_json);
        if (research.document.envelope.status !== "COMMITTED") {
          throw new TypeError("RESOLUTION_TRACE_RESEARCH_ARTIFACT_NOT_COMMITTED");
        }
        document = research.document;
        computedHash = research.content_hash;
      } catch {
        throw new PersistenceBoundaryError(
          "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
          "Stored Artifact document 不符合 current committed L2、Research L2 或 Product Team 契约。",
        );
      }
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
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
        "Stored Artifact relational/document/hash identity 不一致。",
      );
    }
    const inputReferences =
      "envelope" in document
        ? document.envelope.input_refs
        : Array.isArray(document.source_refs)
          ? document.source_refs
          : [
              ...document.source_refs.query_evidence_refs,
              document.source_refs.derived_evidence_ref,
            ];
    for (const input of inputReferences) {
      await requireStoredArtifactReference(client, input);
    }
    artifacts.push({
      reference,
      document,
      created_at: iso(row.created_at),
    });
  }
  return artifacts;
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
  if (!document) return `${artifact.reference.artifact_type} 内容可通过 exact preview 查看`;
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
  if ("protocol_version" in document.payload) {
    if (
      document.payload.artifact_type === "QueryEvidence" &&
      document.payload.protocol_version === "query-evidence@2.0.0"
    ) {
      return `${document.payload.observation.row_count} 行 · ${document.payload.protocol_version} · 结果已绑定`;
    }
    return `${document.payload.artifact_type} · ${document.payload.protocol_version} · current Research L2`;
  }
  switch (document.payload.artifact_type) {
    case "SqlArtifact":
      return redactPublicDisplayText(document.payload.sql).slice(0, 2_000);
    case "ExecutionReceipt":
      return `${document.payload.row_count} 行 · ${document.payload.replay_state} · ${document.payload.observed_at}`;
    case "QueryEvidence": {
      const passed = document.payload.invariant_verdicts.filter(
        ({ verdict }) => verdict === "PASS",
      ).length;
      return `${passed}/${document.payload.invariant_verdicts.length} 项结果不变量通过`;
    }
    case "AnalysisReport":
      return `${document.payload.title} · ${document.payload.claim_refs.length} 项声明${document.payload.limitations[0] ? ` · 限制：${document.payload.limitations[0]}` : ""}`.slice(
        0,
        2_000,
      );
    default:
      return `${artifact.reference.artifact_type} 内容可通过 exact preview 查看`;
  }
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
    title: type,
    summary: artifactPublicSummary(artifact),
    duration_ms: null,
    artifact_refs: [artifact.reference],
  };
}

async function projectTrace(
  authority: VerifiedRunAuthority,
  events: readonly RunRuntimeEvent[],
  artifacts: readonly VerifiedArtifact[],
): Promise<ResolutionTrace> {
  assertContinuousEvents(events);
  const eventNodes = events.map(eventNode);
  const artifactNodes = artifacts.map(artifactNode);
  const nodes: ResolutionTraceNode[] = [...eventNodes, ...artifactNodes];
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
  for (const artifact of artifacts) {
    if (!artifact.document) continue;
    const target = nodeByReference.get(artifactReferenceIdentity(artifact.reference));
    const inputReferences =
      "envelope" in artifact.document
        ? artifact.document.envelope.input_refs
        : Array.isArray(artifact.document.source_refs)
          ? artifact.document.source_refs
          : [
              ...artifact.document.source_refs.query_evidence_refs,
              artifact.document.source_refs.derived_evidence_ref,
            ];
    for (const input of inputReferences) {
      const source = nodeByReference.get(artifactReferenceIdentity(input));
      if (source && target)
        edges.push({ from_node_id: source, to_node_id: target, kind: "EVIDENCE" });
    }
  }
  if (authority.config_ref && eventNodes[0]) {
    edges.push({
      from_node_id: `config:${authority.config_ref.config_id}:${authority.config_ref.config_revision}`,
      to_node_id: eventNodes[0].node_id,
      kind: "CONTEXT",
    });
  }
  return buildResolutionTrace({
    schema_version: "resolution-trace@1.0.0",
    scope: authority.scope,
    run_id: authority.run_id,
    conversation_id: authority.conversation_id,
    config_ref: authority.config_ref,
    nodes,
    edges,
  });
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

  return resolutionTraceDetailSchema.parse({
    schema_version: "resolution-trace-detail@2.0.0",
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
        { access: "READ", operation_name: "resolution-trace.load" },
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
          await verifyEventArtifactReferences(client, events);
          const artifacts = await loadVerifiedArtifacts(client, authority);
          return projectTrace(authority, events, artifacts);
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
        { access: "READ", operation_name: "resolution-trace.detail.load" },
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
          await verifyEventArtifactReferences(client, events);
          const artifacts = await loadVerifiedArtifacts(client, authority);
          const trace = await projectTrace(authority, events, artifacts);
          return projectDetail(authority, trace, events, artifacts, lookup.data.node_id);
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
        { access: "READ", operation_name: "sql-history.list" },
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
                await loadVerifiedArtifacts(client, authority),
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
