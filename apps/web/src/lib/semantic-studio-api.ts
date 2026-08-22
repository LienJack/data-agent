"use client";

import {
  type SemanticAuthoringPublicEvent,
  type SemanticAuthoringRun,
  type SemanticEdgeTypeDefinition,
  type SemanticGraphEntryStatus,
  type SemanticGraphFullResult,
  type SemanticGraphNeighborhoodResult,
  type SemanticGraphNodeListResult,
  type SemanticManualEdit,
  type SemanticNodeType,
  semanticAuthoringPublicEventSchema,
  semanticAuthoringRunSchema,
  semanticAuthoringStateSchema,
  semanticCandidateRevisionSaveResultSchema,
  semanticCandidateSelfPublishResultSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type SemanticAuthoringPublicFeed,
  semanticAuthoringPublicFeedSchema,
} from "./semantic-authoring-public";

/*
 * The SSE stream is a browser boundary, so it must parse the same strict
 * contracts used by the Worker instead of trusting a TypeScript assertion.
 */
const semanticStudioStartResultSchema = z.strictObject({
  state: z.strictObject({ run: semanticAuthoringRunSchema }),
  events: z.array(semanticAuthoringPublicEventSchema),
});

export interface SemanticStudioAuthoringState {
  readonly run: SemanticAuthoringRun;
}

export interface SemanticStudioReleaseIdentity {
  readonly release_id: string;
  readonly release_generation: number;
  readonly label: string;
}

export interface SemanticStudioSnapshot {
  readonly schema_version: "semantic-studio-snapshot@1.0.0";
  readonly semantic_domain: string;
  readonly available_domains: readonly string[];
  readonly release: SemanticStudioReleaseIdentity;
  readonly edge_type_registry: readonly SemanticEdgeTypeDefinition[];
  readonly list: SemanticGraphNodeListResult;
  readonly full: SemanticGraphFullResult;
  readonly local: SemanticGraphNeighborhoodResult | null;
  readonly authoring: {
    readonly state: SemanticStudioAuthoringState;
    readonly events: readonly SemanticAuthoringPublicEvent[];
    readonly saved_revision: z.infer<typeof semanticCandidateRevisionSaveResultSchema> | null;
  } | null;
}

export interface SemanticStudioStartResult {
  readonly state: SemanticStudioAuthoringState;
  readonly events: readonly SemanticAuthoringPublicEvent[];
}

export class SemanticStudioApiError extends Error {
  override readonly name = "SemanticStudioApiError";

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly retryable?: boolean;
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new SemanticStudioApiError(
      payload.error?.code ?? "SEMANTIC_STUDIO_UNAVAILABLE",
      payload.error?.message ?? "Semantic Studio 暂时不可用。",
      payload.error?.retryable ?? response.status >= 500,
    );
  }
  return payload.data;
}

function studioApiBase(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/semantic/studio`;
}

export function loadSemanticStudio(
  workspaceId: string,
  input: {
    readonly domain?: string;
    readonly selectedNodeId?: string;
    readonly runId?: string;
    readonly hops?: 1 | 2;
    readonly search?: string;
    readonly nodeType?: SemanticNodeType;
    readonly owner?: string;
    readonly lifecycle?: "ACTIVE" | "DEPRECATED" | "RETIRED";
    readonly status?: SemanticGraphEntryStatus;
    readonly nodeDomain?: string;
    readonly cursor?: number;
    readonly limit?: number;
  },
  signal?: AbortSignal,
): Promise<SemanticStudioSnapshot> {
  const query = new URLSearchParams();
  if (input.domain) query.set("domain", input.domain);
  if (input.selectedNodeId) query.set("selectedNodeId", input.selectedNodeId);
  if (input.runId) query.set("runId", input.runId);
  if (input.hops) query.set("hops", String(input.hops));
  if (input.search) query.set("search", input.search);
  if (input.nodeType) query.set("nodeType", input.nodeType);
  if (input.owner) query.set("owner", input.owner);
  if (input.lifecycle) query.set("lifecycle", input.lifecycle);
  if (input.status) query.set("status", input.status);
  if (input.nodeDomain) query.set("nodeDomain", input.nodeDomain);
  if (input.cursor !== undefined) query.set("cursor", String(input.cursor));
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  return api(`${studioApiBase(workspaceId)}?${query.toString()}`, { signal });
}

export function expandSemanticStudioCluster(
  workspaceId: string,
  input: { readonly domain: string; readonly clusterId: string; readonly runId?: string },
  signal?: AbortSignal,
): Promise<SemanticGraphFullResult> {
  const query = new URLSearchParams({
    domain: input.domain,
    clusterId: input.clusterId,
    view: "full",
  });
  if (input.runId) query.set("runId", input.runId);
  return api(`${studioApiBase(workspaceId)}?${query.toString()}`, { signal });
}

export function startSemanticAuthoring(
  workspaceId: string,
  input: {
    readonly semantic_domain: string;
    readonly instruction: string;
    readonly selected_node_id: string | null;
    readonly selected_edge_id: string | null;
    readonly evidence_selection_id: string | null;
    readonly idempotency_key: string;
  },
): Promise<SemanticStudioStartResult> {
  return api(`${studioApiBase(workspaceId)}/authoring-runs`, {
    method: "POST",
    body: JSON.stringify({ schema_version: "semantic-studio-authoring-intent@1.0.0", ...input }),
  });
}

export function startManualSemanticSession(workspaceId: string, semanticDomain: string) {
  return api(`${studioApiBase(workspaceId)}/manual-sessions`, {
    method: "POST",
    body: JSON.stringify({
      schema_version: "semantic-manual-session-start-request@1.0.0",
      semantic_domain: semanticDomain,
      idempotency_key: crypto.randomUUID(),
    }),
  }).then((value) => semanticAuthoringStateSchema.parse(value));
}

export function saveSemanticCandidateRevision(
  workspaceId: string,
  input: {
    readonly semantic_domain: string;
    readonly authoring_run_id: string;
    readonly expected_working_revision: number;
    readonly expected_graph_digest: string;
    readonly manual_edits: readonly SemanticManualEdit[];
    readonly evidence_selection_refs: readonly {
      readonly selection_id: string;
      readonly selection_hash: string;
    }[];
    readonly summary: string;
  },
) {
  return api(`${studioApiBase(workspaceId)}/candidate-revisions`, {
    method: "POST",
    body: JSON.stringify({
      schema_version: "semantic-candidate-revision-save-request@1.0.0",
      ...input,
      idempotency_key: crypto.randomUUID(),
    }),
  }).then((value) => semanticCandidateRevisionSaveResultSchema.parse(value));
}

export function selfPublishSemanticCandidate(
  workspaceId: string,
  input: {
    readonly semantic_domain: string;
    readonly authoring_run_id: string;
    readonly candidate_id: string;
    readonly candidate_revision_id: string;
    readonly revision_number: number;
    readonly source_revision_id: string;
    readonly review_reason: string;
  },
) {
  return api(`${studioApiBase(workspaceId)}/self-publish`, {
    method: "POST",
    body: JSON.stringify({
      schema_version: "semantic-candidate-self-publish-request@1.0.0",
      ...input,
      idempotency_key: crypto.randomUUID(),
    }),
  }).then((value) => semanticCandidateSelfPublishResultSchema.parse(value));
}

export function loadSemanticAuthoringEvents(
  workspaceId: string,
  input: { readonly semanticDomain: string; readonly runId: string; readonly after: number },
  signal?: AbortSignal,
): Promise<SemanticStudioStartResult> {
  const query = new URLSearchParams({
    semanticDomain: input.semanticDomain,
    after: String(input.after),
  });
  return api(`${studioApiBase(workspaceId)}/authoring-runs/${input.runId}?${query}`, { signal });
}

export function loadSemanticAuthoringPublicFeed(
  workspaceId: string,
  input: { readonly semanticDomain: string; readonly runId: string; readonly after: number },
  signal?: AbortSignal,
): Promise<SemanticAuthoringPublicFeed> {
  const query = new URLSearchParams({
    semanticDomain: input.semanticDomain,
    after: String(input.after),
  });
  return api(`${studioApiBase(workspaceId)}/authoring-runs/${input.runId}/feed?${query}`, {
    signal,
  });
}

export function subscribeSemanticAuthoringEvents(
  workspaceId: string,
  input: { readonly semanticDomain: string; readonly runId: string; readonly after: number },
  handlers: {
    readonly onAuthoring: (value: SemanticStudioStartResult) => void;
    readonly onError: (message: string) => void;
  },
): () => void {
  const query = new URLSearchParams({
    semanticDomain: input.semanticDomain,
    after: String(input.after),
  });
  const source = new EventSource(
    `${studioApiBase(workspaceId)}/authoring-runs/${input.runId}/events?${query}`,
  );
  source.addEventListener("authoring", (event) => {
    try {
      const result = semanticStudioStartResultSchema.parse(JSON.parse(event.data));
      handlers.onAuthoring(result);
      if (
        result.state.run.status !== "RUNNING" &&
        result.state.run.status !== "WAITING_CLARIFICATION"
      ) {
        source.close();
      }
    } catch {
      handlers.onError("Agent 事件流返回了无效数据，正在重新连接。");
    }
  });
  source.addEventListener("error", () => {
    if (source.readyState !== EventSource.CLOSED) {
      handlers.onError("Agent 事件流暂时中断，正在自动重连。");
    }
  });
  return () => source.close();
}

export function subscribeSemanticAuthoringPublicFeed(
  workspaceId: string,
  input: { readonly semanticDomain: string; readonly runId: string; readonly after: number },
  handlers: {
    readonly onAuthoring: (value: SemanticAuthoringPublicFeed) => void;
    readonly onError: (message: string) => void;
    readonly onConnectionChange?: (status: "live" | "reconnecting") => void;
  },
): () => void {
  const query = new URLSearchParams({
    semanticDomain: input.semanticDomain,
    after: String(input.after),
  });
  const source = new EventSource(
    `${studioApiBase(workspaceId)}/authoring-runs/${input.runId}/feed/events?${query}`,
  );
  source.addEventListener("open", () => handlers.onConnectionChange?.("live"));
  source.addEventListener("public-authoring", (event) => {
    try {
      const result = semanticAuthoringPublicFeedSchema.parse(JSON.parse(event.data));
      handlers.onAuthoring(result);
      if (
        result.run.status !== "QUEUED" &&
        result.run.status !== "RUNNING" &&
        result.run.status !== "WAITING_CLARIFICATION"
      ) {
        source.close();
      }
    } catch {
      handlers.onError("Agent 公开轨迹返回了无效数据，正在重新连接。");
    }
  });
  source.addEventListener("error", () => {
    if (source.readyState !== EventSource.CLOSED) {
      handlers.onConnectionChange?.("reconnecting");
      handlers.onError("Agent 公开轨迹暂时中断，正在自动重连。");
    }
  });
  return () => source.close();
}

export function resumeSemanticAuthoring(
  workspaceId: string,
  input: {
    readonly semantic_domain: string;
    readonly run_id: string;
    readonly clarification_id: string;
    readonly answer: string;
    readonly idempotency_key: string;
  },
): Promise<SemanticStudioStartResult> {
  return api(`${studioApiBase(workspaceId)}/authoring-runs/${input.run_id}/resume`, {
    method: "POST",
    body: JSON.stringify({ schema_version: "semantic-studio-clarification@1.0.0", ...input }),
  });
}
