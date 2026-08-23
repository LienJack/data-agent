import {
  type AppScope,
  type PortResult,
  type SemanticExplorerSnapshot,
  type SemanticRelationshipSearchResult,
  semanticRelationshipSearchResultSchema,
} from "@data-agent/contracts";
import type { PostgresSemanticExplorerReader } from "@data-agent/platform";
import { buildSemanticExplorerReadModel } from "@data-agent/semantic/read-model";
import { createSemanticRelationshipSearchService } from "@data-agent/semantic/relationship-index";

export interface FrozenSemanticRelationshipReadPort {
  read(input: {
    readonly capability: unknown;
    readonly scope: AppScope;
    readonly semantic_domain: string;
    readonly release_id: string;
    readonly release_hash: string;
  }): Promise<PortResult<SemanticRelationshipSearchResult>>;
}

function failure<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

async function snapshot(
  source: Awaited<ReturnType<PostgresSemanticExplorerReader["getReleaseSource"]>>,
): Promise<PortResult<SemanticExplorerSnapshot>> {
  if (!source.ok) return source;
  try {
    return { ok: true, value: (await buildSemanticExplorerReadModel(source.value)).snapshot };
  } catch {
    return failure(
      "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
      "Frozen Semantic Explorer source could not be verified.",
    );
  }
}

export function createFrozenSemanticRelationshipReadPort(
  reader: PostgresSemanticExplorerReader,
): FrozenSemanticRelationshipReadPort {
  const snapshots = {
    getActive: async (capability: unknown, semanticDomain: string) =>
      snapshot(await reader.getActiveSource(capability, semanticDomain)),
    getRelease: async (capability: unknown, semanticDomain: string, releaseId: string) =>
      snapshot(
        await reader.getReleaseSource(capability, {
          semantic_domain: semanticDomain,
          release_id: releaseId,
        }),
      ),
  };
  const relationships = createSemanticRelationshipSearchService({
    snapshots,
    checkpoints: null,
    graph: null,
    disabled_reason: "INDEX_NOT_CONFIGURED",
  });
  return Object.freeze({
    async read(input: {
      readonly capability: unknown;
      readonly scope: AppScope;
      readonly semantic_domain: string;
      readonly release_id: string;
      readonly release_hash: string;
    }): Promise<PortResult<SemanticRelationshipSearchResult>> {
      const result = await relationships.search(
        { capability_input: input.capability, scope: input.scope },
        {
          schema_version: "semantic-relationship-search-request@1.0.0",
          semantic_domain: input.semantic_domain,
          release: { kind: "HISTORICAL", release_id: input.release_id },
          root: null,
          term: null,
          categories: ["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"],
          direction: "both",
          hop_limit: 2,
          node_limit: 250,
          edge_limit: 500,
        },
      );
      if (!result.ok) return result;
      if (
        result.value.release_identity.release_id !== input.release_id ||
        result.value.release_identity.release_digest !== input.release_hash
      ) {
        return failure(
          "SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH",
          "Relationship result does not match the frozen Semantic Release.",
        );
      }
      return { ok: true, value: semanticRelationshipSearchResultSchema.parse(result.value) };
    },
  });
}
