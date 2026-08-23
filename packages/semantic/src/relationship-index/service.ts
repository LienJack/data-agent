import {
  type AppScope,
  appScopeSchema,
  type PortResult,
  type SemanticExplorerSnapshot,
  type SemanticRelationshipIndexCheckpoint,
  type SemanticRelationshipIndexReasonCode,
  type SemanticRelationshipSearchRequest,
  type SemanticRelationshipSearchResult,
  semanticRelationshipSearchRequestSchema,
  semanticRelationshipSearchResultSchema,
} from "@data-agent/contracts";
import {
  buildSemanticRelationshipGraphManifest,
  searchSemanticRelationshipGraphFallback,
} from "./builder.js";

export interface SemanticRelationshipSearchAuthority {
  readonly capability_input: unknown;
  readonly scope: AppScope;
}

export interface SemanticRelationshipSnapshotReader {
  getActive(
    capabilityInput: unknown,
    semanticDomain: string,
  ): Promise<PortResult<SemanticExplorerSnapshot>>;
  getRelease(
    capabilityInput: unknown,
    semanticDomain: string,
    releaseId: string,
  ): Promise<PortResult<SemanticExplorerSnapshot>>;
}

export interface SemanticRelationshipCheckpointReader {
  getCheckpoint(
    capabilityInput: unknown,
    input: { readonly semantic_domain: string; readonly release_id: string },
  ): Promise<PortResult<SemanticRelationshipIndexCheckpoint | null>>;
}

export interface SemanticRelationshipGraphSearchPort {
  search(input: {
    readonly scope: AppScope;
    readonly checkpoint: SemanticRelationshipIndexCheckpoint;
    readonly request: SemanticRelationshipSearchRequest;
  }): Promise<{
    readonly release_id: string;
    readonly release_digest: string;
    readonly relationship_projection_digest: string;
    readonly build_id: string;
    readonly manifest_digest: string;
    readonly node_keys: readonly string[];
    readonly edge_keys: readonly string[];
    readonly truncated: boolean;
    readonly truncation_reasons: readonly ("HOP_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT")[];
    readonly traversed_hops: number;
  }>;
}

export interface SemanticRelationshipSearchService {
  search(
    authority: SemanticRelationshipSearchAuthority,
    request: unknown,
  ): Promise<PortResult<SemanticRelationshipSearchResult>>;
}

function snapshotIdentity(snapshot: SemanticExplorerSnapshot): string {
  return JSON.stringify({
    release: snapshot.release_identity,
    pointer: snapshot.pointer_observation,
    is_active: snapshot.is_active,
  });
}

function portFailure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function reasonFromError(error: unknown): SemanticRelationshipIndexReasonCode {
  if (typeof error === "object" && error !== null && "reason_code" in error) {
    const value = String(error.reason_code);
    if (
      value === "INDEX_UNAVAILABLE" ||
      value === "INDEX_DIGEST_MISMATCH" ||
      value === "INDEX_NOT_READY"
    ) {
      return value;
    }
  }
  return "INDEX_UNAVAILABLE";
}

async function loadSnapshot(
  reader: SemanticRelationshipSnapshotReader,
  capabilityInput: unknown,
  request: SemanticRelationshipSearchRequest,
): Promise<PortResult<SemanticExplorerSnapshot>> {
  return request.release.kind === "ACTIVE"
    ? reader.getActive(capabilityInput, request.semantic_domain)
    : reader.getRelease(capabilityInput, request.semantic_domain, request.release.release_id);
}

async function fallback(
  snapshot: SemanticExplorerSnapshot,
  scope: AppScope,
  request: SemanticRelationshipSearchRequest,
  state: SemanticRelationshipIndexCheckpoint["state"],
  reason: SemanticRelationshipIndexReasonCode,
): Promise<PortResult<SemanticRelationshipSearchResult>> {
  try {
    const manifest = await buildSemanticRelationshipGraphManifest(scope, snapshot);
    return {
      ok: true,
      value: searchSemanticRelationshipGraphFallback(snapshot, manifest, request, {
        index_state: state,
        reason_code: reason,
        authority_revalidated: true,
      }),
    };
  } catch {
    return portFailure(
      "SEMANTIC_RELATIONSHIP_FALLBACK_INVALID",
      "PostgreSQL 权威关系图无法构建安全查询结果。",
    );
  }
}

function exactCheckpoint(
  checkpoint: SemanticRelationshipIndexCheckpoint,
  snapshot: SemanticExplorerSnapshot,
): boolean {
  const release = snapshot.release_identity;
  return (
    checkpoint.semantic_domain === release.semantic_domain &&
    checkpoint.release_identity.release_id === release.release_id &&
    checkpoint.release_identity.release_generation === release.release_generation &&
    checkpoint.release_identity.release_digest === release.release_digest &&
    checkpoint.relationship_projection_digest === release.relationship_projection.projection_digest
  );
}

export function createSemanticRelationshipSearchService(options: {
  readonly snapshots: SemanticRelationshipSnapshotReader;
  readonly checkpoints?: SemanticRelationshipCheckpointReader | null;
  readonly graph?: SemanticRelationshipGraphSearchPort | null;
  readonly disabled_reason?: "INDEX_DISABLED" | "INDEX_NOT_CONFIGURED";
}): SemanticRelationshipSearchService {
  const service: SemanticRelationshipSearchService = {
    async search(authorityInput, requestInput) {
      const parsedRequest = semanticRelationshipSearchRequestSchema.safeParse(requestInput);
      const parsedScope = appScopeSchema.safeParse(authorityInput.scope);
      if (!parsedRequest.success || !parsedScope.success) {
        return portFailure("SEMANTIC_RELATIONSHIP_REQUEST_INVALID", "关系搜索请求不符合严格契约。");
      }
      const request = parsedRequest.data;
      const scope = parsedScope.data;
      const initial = await loadSnapshot(
        options.snapshots,
        authorityInput.capability_input,
        request,
      );
      if (!initial.ok) return initial;

      if (!options.graph || !options.checkpoints) {
        return fallback(
          initial.value,
          scope,
          request,
          "DISABLED",
          options.disabled_reason ?? "INDEX_DISABLED",
        );
      }
      const checkpointResult = await options.checkpoints.getCheckpoint(
        authorityInput.capability_input,
        {
          semantic_domain: request.semantic_domain,
          release_id: initial.value.release_identity.release_id,
        },
      );
      if (!checkpointResult.ok) {
        const reason = checkpointResult.error.code.includes("AUTHORITY_CHANGED")
          ? "AUTHORITY_CHANGED"
          : "INDEX_UNAVAILABLE";
        return fallback(initial.value, scope, request, "STALE", reason);
      }
      const checkpoint = checkpointResult.value;
      if (!checkpoint) {
        return fallback(initial.value, scope, request, "PENDING", "INDEX_NOT_READY");
      }
      if (!exactCheckpoint(checkpoint, initial.value)) {
        return fallback(initial.value, scope, request, "STALE", "AUTHORITY_CHANGED");
      }
      if (checkpoint.state !== "READY") {
        return fallback(
          initial.value,
          scope,
          request,
          checkpoint.state,
          checkpoint.reason_code ?? "INDEX_NOT_READY",
        );
      }

      try {
        const slice = await options.graph.search({ scope, checkpoint, request });
        const revalidated = await loadSnapshot(
          options.snapshots,
          authorityInput.capability_input,
          request,
        );
        if (!revalidated.ok) return revalidated;
        if (snapshotIdentity(initial.value) !== snapshotIdentity(revalidated.value)) {
          return fallback(revalidated.value, scope, request, "STALE", "AUTHORITY_CHANGED");
        }
        if (
          slice.release_id !== checkpoint.release_identity.release_id ||
          slice.release_digest !== checkpoint.release_identity.release_digest ||
          slice.relationship_projection_digest !== checkpoint.relationship_projection_digest ||
          slice.build_id !== checkpoint.build_id ||
          slice.manifest_digest !== checkpoint.manifest_digest
        ) {
          return fallback(revalidated.value, scope, request, "STALE", "INDEX_DIGEST_MISMATCH");
        }
        const manifest = await buildSemanticRelationshipGraphManifest(scope, revalidated.value);
        if (manifest.manifest_digest !== slice.manifest_digest) {
          return fallback(revalidated.value, scope, request, "STALE", "INDEX_DIGEST_MISMATCH");
        }
        const nodeKeys = new Set(slice.node_keys);
        const edgeKeys = new Set(slice.edge_keys);
        const nodes = manifest.nodes.filter((node) => nodeKeys.has(node.node_key));
        const returnedNodeKeys = new Set(nodes.map((node) => node.node_key));
        const edges = manifest.edges.filter(
          (edge) =>
            edgeKeys.has(edge.edge_key) &&
            returnedNodeKeys.has(edge.source_node_key) &&
            returnedNodeKeys.has(edge.target_node_key),
        );
        if (nodes.length !== nodeKeys.size || edges.length !== edgeKeys.size) {
          return fallback(revalidated.value, scope, request, "STALE", "INDEX_DIGEST_MISMATCH");
        }
        return {
          ok: true,
          value: semanticRelationshipSearchResultSchema.parse({
            schema_version: "semantic-relationship-search-result@1.0.0",
            release_identity: revalidated.value.release_identity,
            pointer_observation: revalidated.value.pointer_observation,
            is_active: revalidated.value.is_active,
            source: "NEO4J",
            index_state: "READY",
            index_reason_code: null,
            manifest_digest: slice.manifest_digest,
            root: request.root,
            term: request.term,
            categories: request.categories,
            nodes,
            edges,
            truncated: slice.truncated,
            truncation_reasons: slice.truncation_reasons,
            explanation: {
              summary: `Neo4j sealed projection traversed ${nodes.length} nodes and ${edges.length} edges for exact release ${slice.release_id}; display fields were hydrated from PostgreSQL Authority.`,
              requested_hop_limit: request.hop_limit,
              traversed_hops: slice.traversed_hops,
              categories: request.categories,
              authority_revalidated: true,
              fallback_reason: null,
            },
          }),
        };
      } catch (error) {
        const revalidated = await loadSnapshot(
          options.snapshots,
          authorityInput.capability_input,
          request,
        );
        if (!revalidated.ok) return revalidated;
        const reason = reasonFromError(error);
        return fallback(
          revalidated.value,
          scope,
          request,
          reason === "INDEX_DIGEST_MISMATCH" ? "STALE" : "FAILED",
          reason,
        );
      }
    },
  };
  return Object.freeze(service);
}
