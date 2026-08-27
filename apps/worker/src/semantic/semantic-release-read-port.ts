import { deepFreeze } from "@data-agent/contracts/common";
import {
  type SemanticContextPackage,
  verifySemanticContextPackage,
} from "@data-agent/contracts/context";
import type { PortResult } from "@data-agent/contracts/ports";
import type {
  PostgresSemanticExplorerReader,
  PostgresSemanticSuccessorSmokeAuthority,
} from "@data-agent/platform/semantic-postgres";
import {
  type SemanticExecutablePublicationProjection,
  type SemanticRelationshipPublicationProjection,
  type SemanticRuntimeRestrictionPublicationProjection,
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
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
  successors: Pick<PostgresSemanticSuccessorSmokeAuthority, "loadPromotedRelease">,
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
        envelope.relationship_projection.datasource_id !==
          packageDocument.semantic_release.datasource_id
      ) {
        return failure(
          "SEMANTIC_RELEASE_SOURCE_BINDING_MISMATCH",
          "Published semantic projections do not match the frozen Semantic Context Package.",
        );
      }
      const promoted = await successors.loadPromotedRelease(input.capability, {
        semantic_domain: packageDocument.semantic_domain,
        release_id: packageDocument.semantic_release.resource_id,
      });
      if (!promoted.ok) {
        return failure(
          "SEMANTIC_RELEASE_PROJECTION_INVALID",
          "Published semantic release is not backed by a verified promoted successor envelope.",
        );
      }
      let verified: Awaited<ReturnType<typeof verifySemanticReleaseEnvelope>>;
      try {
        verified = await verifySemanticReleaseEnvelope(promoted.value);
      } catch {
        return failure(
          "SEMANTIC_RELEASE_PROJECTION_INVALID",
          "Published semantic successor envelope failed shared integrity verification.",
        );
      }
      const validation = await validateSemanticRuntimeClosure(verified);
      if (
        validation.outcome !== "PASS" ||
        verified.stage.status !== "PROMOTED" ||
        verified.stage.scope.semantic_domain !== envelope.release.semantic_domain ||
        verified.stage.candidate_release.release_id !== envelope.release.release_id ||
        verified.stage.candidate_release.generation !== envelope.release.release_generation ||
        verified.stage.candidate_release.release_digest !== envelope.release.release_digest ||
        verified.stage.candidate_release.datasource_id !==
          packageDocument.semantic_release.datasource_id ||
        verified.stage.projection_refs.executable.projection_id !==
          envelope.release.executable_projection_ref ||
        verified.stage.projection_refs.executable.projection_digest !==
          envelope.release.executable_projection_hash ||
        verified.stage.projection_refs.relationship.projection_id !==
          envelope.release.relationship_projection_ref ||
        verified.stage.projection_refs.relationship.projection_digest !==
          envelope.release.relationship_projection_hash ||
        verified.stage.projection_refs.runtime_restriction.projection_id !==
          envelope.release.runtime_restriction_projection_ref ||
        verified.stage.projection_refs.runtime_restriction.projection_digest !==
          envelope.release.runtime_restriction_projection_hash ||
        verified.projections.executable.projection_id !==
          envelope.executable_projection.projection_id ||
        verified.projections.executable.projection_digest !==
          envelope.executable_projection.projection_digest ||
        envelope.executable_projection.release_id !== envelope.release.release_id ||
        verified.projections.relationship.projection_id !==
          envelope.relationship_projection.projection_id ||
        verified.projections.relationship.projection_digest !==
          envelope.relationship_projection.projection_digest ||
        envelope.relationship_projection.release_id !== envelope.release.release_id ||
        verified.projections.runtime_restriction.projection_id !==
          envelope.runtime_restriction_projection.projection_id ||
        verified.projections.runtime_restriction.projection_digest !==
          envelope.runtime_restriction_projection.projection_digest ||
        envelope.runtime_restriction_projection.release_id !== envelope.release.release_id
      ) {
        return failure(
          "SEMANTIC_RELEASE_SOURCE_BINDING_MISMATCH",
          "Published semantic projections do not match the verified promoted successor.",
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
          executable: verified.projections.executable.projection_payload,
          relationships: verified.projections.relationship.projection_payload,
          restrictions: verified.projections.runtime_restriction.projection_payload,
        }),
      };
    },
  });
}
