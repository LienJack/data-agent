import {
  type AppScope,
  type ArtifactReference,
  appScopeSchema,
  artifactReferenceIdentity,
  buildResolutionTrace,
  buildSqlHistoryEntry,
  computeL2ArtifactContentHash,
  contentHashSchema,
  immutableIdSchema,
  l2ArtifactDocumentSchema,
  type PortResult,
  type ResolutionTrace,
  type ResolutionTraceEdge,
  type ResolutionTraceNode,
  type RunRuntimeEvent,
  redactPublicDisplayText,
  type SqlHistoryEntry,
  type SqlHistoryResult,
  sha256ContentHash,
  timestampSchema,
  toPublicRunEvent,
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
  readonly config_id: string | null;
  readonly config_revision: string | number | null;
  readonly config_hash: string | null;
  readonly schema_snapshot_hash: string | null;
  readonly config_committed_at: Date | string | null;
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
  readonly document: z.infer<typeof l2ArtifactDocumentSchema> | null;
  readonly created_at: string;
}

interface VerifiedRunAuthority {
  readonly scope: AppScope;
  readonly run_id: string;
  readonly conversation_id: string | null;
  readonly config_ref: {
    readonly config_id: string;
    readonly config_revision: number;
    readonly config_hash: string;
  } | null;
  readonly schema_snapshot_hash: string | null;
  readonly config_committed_at: string | null;
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
       config.config_id,
       config.config_revision,
       config.config_hash,
       config.schema_snapshot_hash,
       config.committed_at as config_committed_at
     from runs as run
     left join workspace_run_bindings as binding
       on binding.app_id = run.app_id
      and binding.tenant_id = run.tenant_id
      and binding.environment = run.environment
      and binding.run_id = run.run_id
     left join effective_run_config_receipts as config
       on config.app_id = run.app_id
      and config.tenant_id = run.tenant_id
      and config.environment = run.environment
      and config.run_id = run.run_id
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
    };
  });
}

function referenceFromRow(scope: AppScope, runId: string, row: ArtifactRow): ArtifactReference {
  return {
    artifact_id: immutableIdSchema.parse(row.artifact_id),
    artifact_type: z
      .enum(["SqlArtifact", "ExecutionReceipt", "QueryEvidence", "SchemaSnapshot", "SandboxResult"])
      .parse(row.artifact_type),
    ...scope,
    run_id: immutableIdSchema.parse(runId),
    revision: z.coerce.number().int().positive().parse(row.revision),
    content_hash: contentHashSchema.parse(row.content_hash),
  };
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
      ["SqlArtifact", "ExecutionReceipt", "QueryEvidence", "SchemaSnapshot", "SandboxResult"],
    ],
  );
  const artifacts: VerifiedArtifact[] = [];
  for (const row of result.rows) {
    const reference = referenceFromRow(authority.scope, authority.run_id, row);
    if (
      reference.artifact_type === "SchemaSnapshot" ||
      reference.artifact_type === "SandboxResult"
    ) {
      artifacts.push({ reference, document: null, created_at: iso(row.created_at) });
      continue;
    }
    const document = l2ArtifactDocumentSchema.safeParse(row.document_json);
    if (!document.success || document.data.envelope.status !== "COMMITTED") {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
        "Stored Artifact document 不符合 committed L2 契约。",
      );
    }
    const envelope = document.data.envelope;
    if (
      envelope.artifact_id !== reference.artifact_id ||
      envelope.artifact_type !== reference.artifact_type ||
      envelope.app_id !== reference.app_id ||
      envelope.tenant_id !== reference.tenant_id ||
      envelope.environment !== reference.environment ||
      envelope.run_id !== reference.run_id ||
      envelope.revision !== reference.revision ||
      envelope.content_hash !== reference.content_hash ||
      (await computeL2ArtifactContentHash(document.data)) !== reference.content_hash
    ) {
      throw new PersistenceBoundaryError(
        "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
        "Stored Artifact relational/document/hash identity 不一致。",
      );
    }
    for (const input of document.data.envelope.input_refs) {
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
          input.app_id,
          input.tenant_id,
          input.environment,
          input.run_id,
          input.artifact_id,
          input.artifact_type,
          input.revision,
          input.content_hash,
        ],
      );
      if (exists.rowCount !== 1) {
        throw new PersistenceBoundaryError(
          "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING",
          "Artifact lineage 引用不存在或 identity 不匹配。",
        );
      }
    }
    artifacts.push({ reference, document: document.data, created_at: iso(row.created_at) });
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
        summary: redactPublicDisplayText(publicEvent.payload.summary).slice(0, 2_000),
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
    case "terminal":
      return {
        node_id: `event:${event.event_id}`,
        kind: "TERMINAL",
        source_event_id: event.event_id,
        sequence: event.sequence,
        occurred_at: event.occurred_at,
        status: publicEvent.payload.status,
        title: "Run terminal",
        summary: publicEvent.payload.summary,
        duration_ms: null,
        artifact_refs: [],
      };
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
    summary: `${type} revision ${artifact.reference.revision}`,
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
    for (const input of artifact.document.envelope.input_refs) {
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
  const executions = artifacts.filter(
    (artifact) => artifact.document?.payload.artifact_type === "ExecutionReceipt",
  );
  const evidences = artifacts.filter(
    (artifact) => artifact.document?.payload.artifact_type === "QueryEvidence",
  );
  const entries: SqlHistoryEntry[] = [];
  for (const artifact of artifacts) {
    if (artifact.document?.payload.artifact_type !== "SqlArtifact") continue;
    const sql = artifact.document.payload;
    const execution = executions.find(
      (candidate) =>
        candidate.document?.payload.artifact_type === "ExecutionReceipt" &&
        artifactReferenceIdentity(candidate.document.payload.sql_artifact_ref) ===
          artifactReferenceIdentity(artifact.reference),
    );
    const executionPayload =
      execution?.document?.payload.artifact_type === "ExecutionReceipt"
        ? execution.document.payload
        : null;
    const evidence = execution
      ? evidences.find(
          (candidate) =>
            candidate.document?.payload.artifact_type === "QueryEvidence" &&
            artifactReferenceIdentity(candidate.document.payload.execution_receipt_ref) ===
              artifactReferenceIdentity(execution.reference),
        )
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
          const artifacts = await loadVerifiedArtifacts(client, authority);
          return projectTrace(authority, events, artifacts);
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
