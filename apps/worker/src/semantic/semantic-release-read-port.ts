import { deepFreeze, sha256ContentHash } from "@data-agent/contracts/common";
import {
  type SemanticContextPackage,
  verifySemanticContextPackage,
} from "@data-agent/contracts/context";
import type { PortResult } from "@data-agent/contracts/ports";
import type { PostgresSemanticExplorerReader } from "@data-agent/platform/semantic-postgres";
import {
  type SemanticExecutablePublicationProjection,
  type SemanticRelationshipPublicationProjection,
  type SemanticRuntimeRestrictionPublicationProjection,
  semanticExecutablePublicationProjectionSchema,
  semanticRelationshipPublicationProjectionSchema,
  semanticRuntimeRestrictionPublicationProjectionSchema,
} from "@data-agent/semantic/production";

export interface FrozenSemanticReleaseCatalog {
  readonly release_identity: {
    readonly semantic_domain: string;
    readonly release_id: string;
    readonly release_digest: string;
    readonly release_generation: number;
    readonly datasource_id: string;
  };
  readonly executable: SemanticExecutablePublicationProjection;
  readonly relationships: SemanticRelationshipPublicationProjection;
  readonly restrictions: SemanticRuntimeRestrictionPublicationProjection;
}

export interface FrozenSemanticReleaseReadPort {
  read(input: {
    readonly capability: unknown;
    readonly package: SemanticContextPackage;
  }): Promise<PortResult<FrozenSemanticReleaseCatalog>>;
}

function failure<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

export function createFrozenSemanticReleaseReadPort(
  reader: PostgresSemanticExplorerReader,
): FrozenSemanticReleaseReadPort {
  return Object.freeze({
    async read(
      input: Parameters<FrozenSemanticReleaseReadPort["read"]>[0],
    ): Promise<PortResult<FrozenSemanticReleaseCatalog>> {
      let packageDocument: SemanticContextPackage;
      try {
        packageDocument = await verifySemanticContextPackage(input.package);
      } catch {
        return failure(
          "SEMANTIC_CONTEXT_PACKAGE_INVALID",
          "Frozen Semantic Context Package could not be verified.",
        );
      }
      const source = await reader.getReleaseSource(input.capability, {
        semantic_domain: packageDocument.semantic_domain,
        release_id: packageDocument.semantic_release.resource_id,
      });
      if (!source.ok) return source;
      const envelope = source.value;
      if (
        envelope.source_kind !== "HISTORICAL" ||
        envelope.release.semantic_domain !== packageDocument.semantic_domain ||
        envelope.release.release_id !== packageDocument.semantic_release.resource_id ||
        envelope.release.release_generation !==
          packageDocument.semantic_release.resource_revision ||
        envelope.release.release_digest !== packageDocument.semantic_release.resource_hash ||
        envelope.executable_projection.projection_id !==
          envelope.release.executable_projection_ref ||
        envelope.executable_projection.projection_digest !==
          envelope.release.executable_projection_hash ||
        envelope.relationship_projection.projection_id !==
          envelope.release.relationship_projection_ref ||
        envelope.relationship_projection.projection_digest !==
          envelope.release.relationship_projection_hash ||
        envelope.runtime_restriction_projection.projection_id !==
          envelope.release.runtime_restriction_projection_ref ||
        envelope.runtime_restriction_projection.projection_digest !==
          envelope.release.runtime_restriction_projection_hash ||
        envelope.relationship_projection.datasource_id !==
          packageDocument.semantic_release.datasource_id
      ) {
        return failure(
          "SEMANTIC_RELEASE_SOURCE_BINDING_MISMATCH",
          "Published semantic projections do not match the frozen Semantic Context Package.",
        );
      }
      const executable = semanticExecutablePublicationProjectionSchema.safeParse(
        envelope.executable_projection.projection_payload,
      );
      const relationships = semanticRelationshipPublicationProjectionSchema.safeParse(
        envelope.relationship_projection.projection_payload,
      );
      const restrictions = semanticRuntimeRestrictionPublicationProjectionSchema.safeParse(
        envelope.runtime_restriction_projection.projection_payload,
      );
      if (!executable.success || !relationships.success || !restrictions.success) {
        return failure(
          "SEMANTIC_RELEASE_PROJECTION_INVALID",
          "Published semantic projection payload is not the current production contract.",
        );
      }
      const [executableHash, relationshipHash, restrictionHash] = await Promise.all([
        sha256ContentHash(envelope.executable_projection.projection_payload),
        sha256ContentHash(envelope.relationship_projection.projection_payload),
        sha256ContentHash(envelope.runtime_restriction_projection.projection_payload),
      ]);
      if (
        executableHash !== envelope.executable_projection.projection_digest ||
        relationshipHash !== envelope.relationship_projection.projection_digest ||
        restrictionHash !== envelope.runtime_restriction_projection.projection_digest
      ) {
        return failure(
          "SEMANTIC_RELEASE_PROJECTION_HASH_MISMATCH",
          "Published semantic projection integrity verification failed.",
        );
      }
      return {
        ok: true,
        value: deepFreeze({
          release_identity: {
            semantic_domain: envelope.release.semantic_domain,
            release_id: envelope.release.release_id,
            release_digest: envelope.release.release_digest,
            release_generation: envelope.release.release_generation,
            datasource_id: envelope.relationship_projection.datasource_id,
          },
          executable: executable.data,
          relationships: relationships.data,
          restrictions: restrictions.data,
        }),
      };
    },
  });
}
