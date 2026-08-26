import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import {
  contentHashSchema,
  deepFreeze,
  environmentSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { effectiveRunConfigReferenceSchema } from "./effective-config.js";

const traceNodeIdSchema = z
  .string()
  .min(1)
  .max(320)
  .regex(/^(?:event|artifact|context|config):/);
const traceTextSchema = z.string().min(1).max(2_000);
const traceStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "PENDING",
  "INTERRUPTED",
  "SKIPPED",
  "BLOCKED",
  "AVAILABLE",
]);

export const resolutionTraceNodeSchema = z.strictObject({
  node_id: traceNodeIdSchema,
  kind: z.enum([
    "LIFECYCLE",
    "PROGRESS",
    "AGENT",
    "REASONING",
    "TOOL",
    "ANSWER",
    "TERMINAL",
    "ARTIFACT",
    "SQL",
    "CONTEXT",
  ]),
  source_event_id: immutableIdSchema.nullable(),
  sequence: z.number().int().positive().safe().nullable(),
  occurred_at: timestampSchema,
  status: traceStatusSchema,
  title: z.string().min(1).max(160),
  summary: traceTextSchema,
  duration_ms: z.number().int().nonnegative().safe().nullable(),
  artifact_refs: z.array(artifactReferenceSchema).max(64),
});

export const resolutionTraceEdgeSchema = z.strictObject({
  from_node_id: traceNodeIdSchema,
  to_node_id: traceNodeIdSchema,
  kind: z.enum(["SEQUENCE", "PRODUCED", "EVIDENCE", "CONTEXT"]),
});

const resolutionTraceDraftSchema = z.strictObject({
  schema_version: z.literal("resolution-trace@1.0.0"),
  scope: z.strictObject({
    app_id: immutableIdSchema,
    tenant_id: immutableIdSchema,
    environment: environmentSchema,
  }),
  run_id: immutableIdSchema,
  conversation_id: immutableIdSchema.nullable(),
  config_ref: effectiveRunConfigReferenceSchema.nullable(),
  nodes: z.array(resolutionTraceNodeSchema).max(10_000),
  edges: z.array(resolutionTraceEdgeSchema).max(20_000),
});

function compareNodes(
  left: z.infer<typeof resolutionTraceNodeSchema>,
  right: z.infer<typeof resolutionTraceNodeSchema>,
): number {
  const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || left.node_id.localeCompare(right.node_id);
}

function edgeIdentity(edge: z.infer<typeof resolutionTraceEdgeSchema>): string {
  return `${edge.from_node_id}\0${edge.to_node_id}\0${edge.kind}`;
}

function compareEdges(
  left: z.infer<typeof resolutionTraceEdgeSchema>,
  right: z.infer<typeof resolutionTraceEdgeSchema>,
): number {
  return edgeIdentity(left).localeCompare(edgeIdentity(right));
}

export function hasDuplicateArtifactReferenceIdentities(
  references: readonly ArtifactReference[],
): boolean {
  const identities = new Set<string>();
  for (const reference of references) {
    const identity = artifactReferenceIdentity(reference);
    if (identities.has(identity)) return true;
    identities.add(identity);
  }
  return false;
}

function addTraceIssues(
  trace: z.infer<typeof resolutionTraceDraftSchema>,
  ctx: z.RefinementCtx,
): void {
  const nodeIds = new Set<string>();
  const eventSequences = new Set<number>();
  trace.nodes.forEach((node, index) => {
    if (nodeIds.has(node.node_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Resolution Trace node_id 必须唯一。",
        path: ["nodes", index, "node_id"],
      });
    }
    nodeIds.add(node.node_id);
    if ((node.source_event_id === null) !== (node.sequence === null)) {
      ctx.addIssue({
        code: "custom",
        message: "Event node 必须同时携带 source_event_id 与 sequence。",
        path: ["nodes", index],
      });
    }
    if (node.sequence !== null) {
      if (eventSequences.has(node.sequence)) {
        ctx.addIssue({
          code: "custom",
          message: "同一 Run 的 Event sequence 不能重复。",
          path: ["nodes", index, "sequence"],
        });
      }
      eventSequences.add(node.sequence);
    }
    if (
      node.artifact_refs.some(
        (reference) =>
          reference.app_id !== trace.scope.app_id ||
          reference.tenant_id !== trace.scope.tenant_id ||
          reference.environment !== trace.scope.environment ||
          reference.run_id !== trace.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Trace Artifact 必须属于同一 Scope/Run。",
        path: ["nodes", index, "artifact_refs"],
      });
    }
    if (hasDuplicateArtifactReferenceIdentities(node.artifact_refs)) {
      ctx.addIssue({
        code: "custom",
        message: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_DUPLICATE",
        path: ["nodes", index, "artifact_refs"],
      });
    }
    const previous = trace.nodes[index - 1];
    if (previous && compareNodes(previous, node) >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Resolution Trace nodes 必须按 sequence/node_id 规范升序排列。",
        path: ["nodes", index],
      });
    }
  });

  const edges = new Set<string>();
  trace.edges.forEach((edge, index) => {
    const identity = edgeIdentity(edge);
    if (edges.has(identity)) {
      ctx.addIssue({
        code: "custom",
        message: "Resolution Trace edge 不能重复。",
        path: ["edges", index],
      });
    }
    edges.add(identity);
    if (!nodeIds.has(edge.from_node_id) || !nodeIds.has(edge.to_node_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Resolution Trace edge 端点必须存在。",
        path: ["edges", index],
      });
    }
    const previous = trace.edges[index - 1];
    if (previous && compareEdges(previous, edge) >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Resolution Trace edges 必须使用规范顺序。",
        path: ["edges", index],
      });
    }
  });

  const nodesById = new Map(trace.nodes.map((node) => [node.node_id, node]));
  for (const [edgeIndex, edge] of trace.edges.entries()) {
    if (edge.kind !== "PRODUCED") continue;
    const source = nodesById.get(edge.from_node_id);
    const target = nodesById.get(edge.to_node_id);
    const targetReference =
      target && ["ARTIFACT", "SQL"].includes(target.kind) && target.artifact_refs.length === 1
        ? target.artifact_refs[0]
        : undefined;
    if (
      !source ||
      source.source_event_id === null ||
      !targetReference ||
      !source.artifact_refs.some(
        (reference) =>
          artifactReferenceIdentity(reference) === artifactReferenceIdentity(targetReference),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "RESOLUTION_TRACE_EVENT_ARTIFACT_PRODUCED_EDGE_INVALID",
        path: ["edges", edgeIndex],
      });
    }
  }

  for (const [nodeIndex, node] of trace.nodes.entries()) {
    if (node.source_event_id === null || node.artifact_refs.length === 0) continue;
    for (const [referenceIndex, reference] of node.artifact_refs.entries()) {
      const referenceIdentity = artifactReferenceIdentity(reference);
      const artifactNodes = trace.nodes.filter(
        (candidate) =>
          ["ARTIFACT", "SQL"].includes(candidate.kind) &&
          candidate.artifact_refs.length === 1 &&
          artifactReferenceIdentity(candidate.artifact_refs[0] as ArtifactReference) ===
            referenceIdentity,
      );
      const producedEdges = trace.edges.filter(
        (edge) =>
          edge.kind === "PRODUCED" &&
          edge.from_node_id === node.node_id &&
          artifactNodes.some((artifactNode) => artifactNode.node_id === edge.to_node_id),
      );
      if (artifactNodes.length !== 1 || producedEdges.length !== 1) {
        ctx.addIssue({
          code: "custom",
          message: "RESOLUTION_TRACE_EVENT_ARTIFACT_PRODUCED_EDGE_INVALID",
          path: ["nodes", nodeIndex, "artifact_refs", referenceIndex],
        });
      }
    }
  }
}

export const resolutionTraceSchema = resolutionTraceDraftSchema
  .extend({ trace_hash: contentHashSchema })
  .superRefine(addTraceIssues);

const detailReasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const resolutionTraceDetailIdentitySchema = z.strictObject({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(2_000),
  value_kind: z.enum(["NAME", "ID", "HASH", "VERSION", "STATUS", "TIME"]),
});

export const resolutionTraceDetailSectionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("AVAILABLE"),
    format: z.enum(["TEXT", "MARKDOWN", "JSON", "FIELDS", "ARTIFACTS"]),
    text: z.string().max(200_000).nullable(),
    fields: z
      .array(
        z.strictObject({
          label: z.string().min(1).max(80),
          value: z.string().max(20_000),
        }),
      )
      .max(256),
  }),
  z.strictObject({
    state: z.enum(["UNAVAILABLE", "FORBIDDEN", "UNSUPPORTED", "STALE"]),
    reason_code: detailReasonCodeSchema,
    message: z.string().min(1).max(512),
  }),
]);

export const resolutionTraceDetailSchemaSectionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("AVAILABLE"),
    schema_name: z.string().min(1).max(128),
    schema_version: z.string().min(1).max(128),
    fields: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(256),
          type: z.string().min(1).max(256),
          availability: z.enum(["AVAILABLE", "UNAVAILABLE", "FORBIDDEN"]),
        }),
      )
      .max(256),
  }),
  z.strictObject({
    state: z.enum(["UNAVAILABLE", "FORBIDDEN", "UNSUPPORTED", "STALE"]),
    reason_code: detailReasonCodeSchema,
    message: z.string().min(1).max(512),
  }),
]);

export const resolutionTraceDetailSchema = z.strictObject({
  schema_version: z.literal("resolution-trace-detail@2.0.0"),
  scope: z.strictObject({
    app_id: immutableIdSchema,
    tenant_id: immutableIdSchema,
    environment: environmentSchema,
  }),
  run_id: immutableIdSchema,
  node_id: traceNodeIdSchema,
  kind: resolutionTraceNodeSchema.shape.kind,
  sequence: z.number().int().positive().safe().nullable(),
  source_event_ids: z.array(immutableIdSchema).max(64),
  title: z.string().min(1).max(160),
  status: traceStatusSchema,
  summary: traceTextSchema,
  hierarchy: z.strictObject({
    parent_node_ids: z.array(traceNodeIdSchema).max(20_000),
    child_node_ids: z.array(traceNodeIdSchema).max(20_000),
  }),
  run_context: resolutionTraceDetailSectionSchema,
  identity: z.array(resolutionTraceDetailIdentitySchema).max(256),
  payload: resolutionTraceDetailSectionSchema,
  result: resolutionTraceDetailSectionSchema,
  schema: resolutionTraceDetailSchemaSectionSchema,
  timing: z.strictObject({
    occurred_at: timestampSchema,
    started_at: timestampSchema.nullable(),
    completed_at: timestampSchema.nullable(),
    duration_ms: z.number().int().nonnegative().safe().nullable(),
    source: z.enum(["EVENT_TIMESTAMP", "SESSION_TIMESTAMPS", "ARTIFACT_TIMESTAMP"]),
  }),
  relations: z
    .array(
      z.strictObject({
        direction: z.enum(["INCOMING", "OUTGOING"]),
        kind: resolutionTraceEdgeSchema.shape.kind,
        node_id: traceNodeIdSchema,
      }),
    )
    .max(20_000),
  artifact_refs: z.array(artifactReferenceSchema).max(64),
});

export function verifyResolutionTraceDetail(input: unknown): ResolutionTraceDetail {
  try {
    return deepFreeze(resolutionTraceDetailSchema.parse(input));
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("RESOLUTION_TRACE_")) throw error;
    throw new TypeError("RESOLUTION_TRACE_DETAIL_SCHEMA_INVALID");
  }
}

export async function buildResolutionTrace(
  input: z.input<typeof resolutionTraceDraftSchema>,
): Promise<ResolutionTrace> {
  const parsed = resolutionTraceDraftSchema.parse(input);
  const material = resolutionTraceDraftSchema.superRefine(addTraceIssues).parse({
    ...parsed,
    nodes: [...parsed.nodes].sort(compareNodes),
    edges: [...parsed.edges].sort(compareEdges),
  });
  return deepFreeze(
    resolutionTraceSchema.parse({ ...material, trace_hash: await sha256ContentHash(material) }),
  );
}

export async function verifyResolutionTrace(input: unknown): Promise<ResolutionTrace> {
  let trace: ResolutionTrace;
  try {
    trace = resolutionTraceSchema.parse(input);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("RESOLUTION_TRACE_")) throw error;
    throw new TypeError("RESOLUTION_TRACE_SCHEMA_INVALID");
  }
  const { trace_hash, ...material } = trace;
  if ((await sha256ContentHash(material)) !== trace_hash)
    throw new TypeError("RESOLUTION_TRACE_HASH_MISMATCH");
  return deepFreeze(trace);
}

const sqlHistoryEntryDraftSchema = z.strictObject({
  schema_version: z.literal("sql-history-entry@1.0.0"),
  scope: z.strictObject({
    app_id: immutableIdSchema,
    tenant_id: immutableIdSchema,
    environment: environmentSchema,
  }),
  run_id: immutableIdSchema,
  conversation_id: immutableIdSchema.nullable(),
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  execution_receipt_ref: artifactReferenceFor("ExecutionReceipt").nullable(),
  query_evidence_ref: artifactReferenceFor("QueryEvidence").nullable(),
  result_ref: artifactReferenceFor("SandboxResult").nullable(),
  schema_snapshot_ref: artifactReferenceFor("SchemaSnapshot").nullable(),
  schema_snapshot_hash: contentHashSchema,
  compiler_version: versionIdentifierSchema,
  ast_hash: contentHashSchema,
  statement_hash: contentHashSchema,
  parameter_hash: contentHashSchema,
  query_hash: contentHashSchema,
  status: z.enum(["COMPILED", "EXECUTED", "VALIDATED", "FAILED"]),
  occurred_at: timestampSchema,
  conversation_href: z
    .string()
    .min(1)
    .max(1_024)
    .regex(/^\/w\/[0-9a-f-]+\/qa\?/),
});

function addSqlHistoryIssues(
  entry: z.infer<typeof sqlHistoryEntryDraftSchema>,
  ctx: z.RefinementCtx,
): void {
  const expectedConversationHref = entry.conversation_id
    ? `/w/${entry.scope.tenant_id}/qa?conversation=${entry.conversation_id}&run=${entry.run_id}&tab=conversation`
    : null;
  if (!expectedConversationHref || entry.conversation_href !== expectedConversationHref) {
    ctx.addIssue({
      code: "custom",
      message: "SQL History 必须绑定同一 Workspace/Conversation/Run 的规范 deep link。",
      path: ["conversation_href"],
    });
  }
  for (const [field, reference] of [
    ["sql_artifact_ref", entry.sql_artifact_ref],
    ["execution_receipt_ref", entry.execution_receipt_ref],
    ["query_evidence_ref", entry.query_evidence_ref],
    ["result_ref", entry.result_ref],
    ["schema_snapshot_ref", entry.schema_snapshot_ref],
  ] as const) {
    if (
      reference &&
      (reference.app_id !== entry.scope.app_id ||
        reference.tenant_id !== entry.scope.tenant_id ||
        reference.environment !== entry.scope.environment ||
        reference.run_id !== entry.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SQL History Artifact 必须属于同一 Scope/Run。",
        path: [field],
      });
    }
  }
  if (entry.status === "VALIDATED" && (!entry.execution_receipt_ref || !entry.query_evidence_ref)) {
    ctx.addIssue({
      code: "custom",
      message: "VALIDATED SQL History 必须绑定 ExecutionReceipt 与 QueryEvidence。",
      path: ["status"],
    });
  }
}

export const sqlHistoryEntrySchema = sqlHistoryEntryDraftSchema
  .extend({ entry_hash: contentHashSchema })
  .superRefine(addSqlHistoryIssues);

export const sqlHistoryResultSchema = z.strictObject({
  schema_version: z.literal("sql-history-result@1.0.0"),
  items: z
    .array(sqlHistoryEntrySchema)
    .max(500)
    .superRefine((items, ctx) => {
      items.forEach((item, index) => {
        const previous = items[index - 1];
        if (
          previous &&
          (previous.occurred_at < item.occurred_at ||
            (previous.occurred_at === item.occurred_at && previous.entry_hash >= item.entry_hash))
        ) {
          ctx.addIssue({
            code: "custom",
            message: "SQL History 必须按 occurred_at/entry_hash 倒序排列。",
            path: [index],
          });
        }
      });
    }),
  next_cursor: z.string().min(1).max(2_048).nullable(),
});

export async function buildSqlHistoryEntry(
  input: z.input<typeof sqlHistoryEntryDraftSchema>,
): Promise<SqlHistoryEntry> {
  const material = sqlHistoryEntryDraftSchema.superRefine(addSqlHistoryIssues).parse(input);
  return deepFreeze(
    sqlHistoryEntrySchema.parse({ ...material, entry_hash: await sha256ContentHash(material) }),
  );
}

export async function verifySqlHistoryEntry(input: unknown): Promise<SqlHistoryEntry> {
  const entry = sqlHistoryEntrySchema.parse(input);
  const { entry_hash, ...material } = entry;
  if ((await sha256ContentHash(material)) !== entry_hash)
    throw new TypeError("SQL_HISTORY_ENTRY_HASH_MISMATCH");
  return deepFreeze(entry);
}

export async function verifySqlHistoryResult(input: unknown): Promise<SqlHistoryResult> {
  const result = sqlHistoryResultSchema.parse(input);
  await Promise.all(result.items.map(verifySqlHistoryEntry));
  return deepFreeze(result);
}

export type ResolutionTraceNode = z.infer<typeof resolutionTraceNodeSchema>;
export type ResolutionTraceEdge = z.infer<typeof resolutionTraceEdgeSchema>;
export type ResolutionTrace = z.infer<typeof resolutionTraceSchema>;
export type ResolutionTraceDetail = z.infer<typeof resolutionTraceDetailSchema>;
export type ResolutionTraceDetailSection = z.infer<typeof resolutionTraceDetailSectionSchema>;
export type SqlHistoryEntry = z.infer<typeof sqlHistoryEntrySchema>;
export type SqlHistoryResult = z.infer<typeof sqlHistoryResultSchema>;
