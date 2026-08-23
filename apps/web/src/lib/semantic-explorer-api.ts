import {
  type SemanticExplorerCandidateComparison,
  type SemanticExplorerDiff,
  type SemanticExplorerDomainSummary,
  type SemanticExplorerLineage,
  type SemanticExplorerObjectIdentity,
  type SemanticExplorerReleaseTimeline,
  type SemanticExplorerSnapshot,
  type SemanticRelationshipSearchRequest,
  type SemanticRelationshipSearchResult,
  semanticExplorerCandidateComparisonSchema,
  semanticExplorerDiffSchema,
  semanticExplorerDomainSummarySchema,
  semanticExplorerLineageSchema,
  semanticExplorerReleaseTimelineSchema,
  semanticExplorerSnapshotSchema,
  semanticRelationshipSearchResultSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { workspaceRequestHeaders } from "./api-client";

const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(512),
    retryable: z.boolean(),
  }),
});

const EXPLORER_FETCH_TIMEOUT_MS = 15_000;

export class SemanticExplorerApiError extends Error {
  override readonly name = "SemanticExplorerApiError";

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getData<T>(
  workspaceId: string,
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(EXPLORER_FETCH_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(path, {
    cache: "no-store",
    headers: workspaceRequestHeaders(workspaceId),
    signal: requestSignal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorEnvelopeSchema.safeParse(body);
    throw new SemanticExplorerApiError(
      error.success ? error.data.error.code : "SEMANTIC_EXPLORER_UNAVAILABLE",
      error.success ? error.data.error.message : "语义 Explorer 暂时不可用。",
      error.success ? error.data.error.retryable : true,
      response.status,
    );
  }
  const envelope = z
    .strictObject({
      data: schema,
      meta: z.strictObject({ authority: z.literal("POSTGRESQL") }),
    })
    .safeParse(body);
  if (!envelope.success) {
    throw new SemanticExplorerApiError(
      "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
      "语义 Explorer 响应不符合公开契约。",
      false,
      503,
    );
  }
  return envelope.data.data;
}

async function postData<T>(
  workspaceId: string,
  path: string,
  payload: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(EXPLORER_FETCH_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: workspaceRequestHeaders(workspaceId),
    body: JSON.stringify(payload),
    signal: requestSignal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorEnvelopeSchema.safeParse(body);
    throw new SemanticExplorerApiError(
      error.success ? error.data.error.code : "SEMANTIC_EXPLORER_UNAVAILABLE",
      error.success ? error.data.error.message : "语义 Explorer 暂时不可用。",
      error.success ? error.data.error.retryable : true,
      response.status,
    );
  }
  const envelope = z
    .strictObject({
      data: schema,
      meta: z.strictObject({ authority: z.literal("POSTGRESQL") }),
    })
    .safeParse(body);
  if (!envelope.success) {
    throw new SemanticExplorerApiError(
      "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
      "语义 Explorer 响应不符合公开契约。",
      false,
      503,
    );
  }
  return envelope.data.data;
}

function query(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

export function getExplorerDomains(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<SemanticExplorerDomainSummary[]> {
  return getData(
    workspaceId,
    "/api/semantic/domains",
    z.array(semanticExplorerDomainSummarySchema),
    signal,
  );
}

export function getActiveExplorerSnapshot(
  workspaceId: string,
  domain: string,
  signal?: AbortSignal,
): Promise<SemanticExplorerSnapshot> {
  return getData(
    workspaceId,
    `/api/semantic/releases/active?${query({ domain })}`,
    semanticExplorerSnapshotSchema,
    signal,
  );
}

export function getExplorerRelease(
  workspaceId: string,
  domain: string,
  releaseId: string,
  signal?: AbortSignal,
): Promise<SemanticExplorerSnapshot> {
  return getData(
    workspaceId,
    `/api/semantic/releases/${encodeURIComponent(releaseId)}?${query({ domain })}`,
    semanticExplorerSnapshotSchema,
    signal,
  );
}

export function getExplorerTimeline(
  workspaceId: string,
  domain: string,
  signal?: AbortSignal,
): Promise<SemanticExplorerReleaseTimeline> {
  return getExplorerTimelinePage(workspaceId, domain, null, signal);
}

export function getExplorerTimelinePage(
  workspaceId: string,
  domain: string,
  generationCursor: number | null,
  signal?: AbortSignal,
): Promise<SemanticExplorerReleaseTimeline> {
  return getData(
    workspaceId,
    `/api/semantic/releases?${query({ domain, limit: 50, cursor: generationCursor })}`,
    semanticExplorerReleaseTimelineSchema,
    signal,
  );
}

export function getExplorerDiff(
  workspaceId: string,
  domain: string,
  targetReleaseId: string,
  baseReleaseId: string,
  signal?: AbortSignal,
): Promise<SemanticExplorerDiff> {
  return getData(
    workspaceId,
    `/api/semantic/releases/${encodeURIComponent(targetReleaseId)}/diff?${query({
      domain,
      base: baseReleaseId,
    })}`,
    semanticExplorerDiffSchema,
    signal,
  );
}

export function getExplorerLineage(
  workspaceId: string,
  domain: string,
  releaseId: string,
  identity: SemanticExplorerObjectIdentity,
  signal?: AbortSignal,
): Promise<SemanticExplorerLineage> {
  return getData(
    workspaceId,
    `/api/semantic/objects/${encodeURIComponent(identity.object_id)}/lineage?${query({
      domain,
      releaseId,
      kind: identity.kind,
      direction: "both",
      hops: 3,
    })}`,
    semanticExplorerLineageSchema,
    signal,
  );
}

export function getExplorerCandidateComparison(
  workspaceId: string,
  domain: string,
  candidateId: string,
  revisionId: string,
  signal?: AbortSignal,
): Promise<SemanticExplorerCandidateComparison> {
  return getData(
    workspaceId,
    `/api/semantic/candidates/${encodeURIComponent(candidateId)}/comparison?${query({
      domain,
      revisionId,
    })}`,
    semanticExplorerCandidateComparisonSchema,
    signal,
  );
}

export function searchExplorerRelationships(
  workspaceId: string,
  request: SemanticRelationshipSearchRequest,
  signal?: AbortSignal,
): Promise<SemanticRelationshipSearchResult> {
  return postData(
    workspaceId,
    "/api/semantic/relationships/search",
    request,
    semanticRelationshipSearchResultSchema,
    signal,
  );
}
