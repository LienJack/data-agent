import { randomUUID } from "node:crypto";
import {
  type AppScope,
  appScopeSchema,
  type PortResult,
  type SemanticExplorerSnapshot,
  type SemanticRelationshipIndexReasonCode,
  semanticExplorerSnapshotSchema,
} from "@data-agent/contracts";
import type {
  PostgresRelationshipIndexStore,
  SemanticRelationshipGraphAdapter,
} from "@data-agent/platform";
import { buildSemanticRelationshipGraphManifest } from "@data-agent/semantic";
import { z } from "zod";

const runInputSchema = z.strictObject({
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  worker_id: z.uuid(),
  lease_seconds: z.number().int().min(5).max(900).default(120),
});

export interface RelationshipIndexSnapshotSource {
  getRelease(
    capabilityInput: unknown,
    semanticDomain: string,
    releaseId: string,
  ): Promise<PortResult<SemanticExplorerSnapshot>>;
}

export type RelationshipIndexerRunResult =
  | { readonly state: "IDLE"; readonly reconciled_jobs: number }
  | {
      readonly state: "INDEXED";
      readonly reconciled_jobs: number;
      readonly release_id: string;
      readonly build_id: string;
      readonly manifest_digest: string;
      readonly node_count: number;
      readonly edge_count: number;
    }
  | {
      readonly state: "FAILED";
      readonly reconciled_jobs: number;
      readonly release_id: string | null;
      readonly reason_code: SemanticRelationshipIndexReasonCode;
    };

export interface SemanticRelationshipIndexer {
  initialize(): Promise<void>;
  runOnce(
    capabilityInput: unknown,
    scope: AppScope,
    input: unknown,
  ): Promise<RelationshipIndexerRunResult>;
  close(): Promise<void>;
}

class IndexerFailure extends Error {
  constructor(readonly reasonCode: SemanticRelationshipIndexReasonCode) {
    super("Relationship indexing failed.");
    this.name = "IndexerFailure";
  }
}

function portReason(result: PortResult<unknown>): SemanticRelationshipIndexReasonCode {
  if (result.ok) return "INDEX_BUILD_FAILED";
  if (result.error.code.includes("AUTHORITY_CHANGED")) return "AUTHORITY_CHANGED";
  if (result.error.code.includes("ATTEMPT_STALE")) return "INDEX_ATTEMPT_STALE";
  if (result.error.code.includes("UNAVAILABLE")) return "INDEX_UNAVAILABLE";
  return "INDEX_BUILD_FAILED";
}

function throwOnFailure<T>(result: PortResult<T>): T {
  if (result.ok) return result.value;
  throw new IndexerFailure(portReason(result));
}

function errorReason(error: unknown): SemanticRelationshipIndexReasonCode {
  if (error instanceof IndexerFailure) return error.reasonCode;
  if (typeof error === "object" && error !== null && "reason_code" in error) {
    const reason = String(error.reason_code);
    if (
      reason === "INDEX_UNAVAILABLE" ||
      reason === "INDEX_DIGEST_MISMATCH" ||
      reason === "INDEX_NOT_READY"
    ) {
      return reason;
    }
  }
  return "INDEX_BUILD_FAILED";
}

function exactClaimSnapshot(
  claim: {
    readonly semantic_domain: string;
    readonly release_id: string;
    readonly release_generation: number;
    readonly release_digest: string;
    readonly relationship_projection_id: string;
    readonly relationship_projection_digest: string;
  },
  snapshotInput: SemanticExplorerSnapshot,
): SemanticExplorerSnapshot {
  const snapshot = semanticExplorerSnapshotSchema.parse(snapshotInput);
  const release = snapshot.release_identity;
  if (
    release.semantic_domain !== claim.semantic_domain ||
    release.release_id !== claim.release_id ||
    release.release_generation !== claim.release_generation ||
    release.release_digest !== claim.release_digest ||
    release.relationship_projection.projection_id !== claim.relationship_projection_id ||
    release.relationship_projection.projection_digest !== claim.relationship_projection_digest
  ) {
    throw new IndexerFailure("AUTHORITY_CHANGED");
  }
  return snapshot;
}

export function createSemanticRelationshipIndexer(options: {
  readonly store: PostgresRelationshipIndexStore;
  readonly graph: SemanticRelationshipGraphAdapter;
  readonly snapshots: RelationshipIndexSnapshotSource;
  readonly build_id?: () => string;
}): SemanticRelationshipIndexer {
  const indexer: SemanticRelationshipIndexer = {
    initialize: () => options.graph.initialize(),

    async runOnce(capabilityInput, scopeInput, input) {
      const scope = appScopeSchema.parse(scopeInput);
      const run = runInputSchema.parse(input);
      const reconciled = throwOnFailure(
        await options.store.reconcile(capabilityInput, run.semantic_domain),
      );
      const claim = throwOnFailure(
        await options.store.claim(capabilityInput, {
          semantic_domain: run.semantic_domain,
          worker_id: run.worker_id,
          lease_seconds: run.lease_seconds,
        }),
      );
      if (!claim) return { state: "IDLE", reconciled_jobs: reconciled };

      const attempt = {
        semantic_domain: claim.semantic_domain,
        attempt_id: claim.attempt_id,
        attempt_fence: claim.attempt_fence,
        worker_id: claim.worker_id,
      } as const;
      const heartbeat = async () => {
        throwOnFailure(
          await options.store.heartbeat(capabilityInput, {
            ...attempt,
            lease_seconds: run.lease_seconds,
          }),
        );
      };

      try {
        const snapshotResult = await options.snapshots.getRelease(
          capabilityInput,
          claim.semantic_domain,
          claim.release_id,
        );
        const snapshot = exactClaimSnapshot(claim, throwOnFailure(snapshotResult));
        const manifest = await buildSemanticRelationshipGraphManifest(scope, snapshot);
        const buildId = z.uuid().parse(options.build_id?.() ?? randomUUID());

        await heartbeat();
        await options.graph.stageBuild({
          build_id: buildId,
          manifest,
          on_progress: heartbeat,
        });
        await heartbeat();
        const receipt = await options.graph.verifyAndSeal({ build_id: buildId, manifest });
        await heartbeat();
        const checkpoint = throwOnFailure(
          await options.store.commit(capabilityInput, {
            ...attempt,
            build_id: buildId,
            manifest_digest: manifest.manifest_digest,
            release_digest: claim.release_digest,
            relationship_projection_digest: claim.relationship_projection_digest,
            node_count: receipt.node_count,
            edge_count: receipt.edge_count,
          }),
        );
        if (
          checkpoint.state !== "READY" ||
          checkpoint.build_id !== buildId ||
          checkpoint.manifest_digest !== manifest.manifest_digest
        ) {
          throw new IndexerFailure("INDEX_DIGEST_MISMATCH");
        }
        return {
          state: "INDEXED",
          reconciled_jobs: reconciled,
          release_id: claim.release_id,
          build_id: buildId,
          manifest_digest: manifest.manifest_digest,
          node_count: receipt.node_count,
          edge_count: receipt.edge_count,
        };
      } catch (error) {
        const reasonCode = errorReason(error);
        await options.store.fail(capabilityInput, {
          ...attempt,
          reason_code:
            reasonCode === "INDEX_UNAVAILABLE" ||
            reasonCode === "INDEX_DIGEST_MISMATCH" ||
            reasonCode === "INDEX_LEASE_EXPIRED" ||
            reasonCode === "INDEX_ATTEMPT_STALE" ||
            reasonCode === "AUTHORITY_CHANGED"
              ? reasonCode
              : "INDEX_BUILD_FAILED",
        });
        return {
          state: "FAILED",
          reconciled_jobs: reconciled,
          release_id: claim.release_id,
          reason_code: reasonCode,
        };
      }
    },

    close: () => options.graph.close(),
  };
  return Object.freeze(indexer);
}
