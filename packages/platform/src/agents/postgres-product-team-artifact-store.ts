import {
  type ArtifactReference,
  canonicalizeJson,
  type PortResult,
  type ProductTeamArtifactDocument,
  runWorkLeaseSchema,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts";
import {
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

export interface PostgresProductTeamArtifactStoreOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

function invalid<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

async function sourceExists(
  client: SqlClient,
  reference: ArtifactReference,
  principalId: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1
       from artifacts artifact
       join runs run
         on run.app_id=artifact.app_id
        and run.tenant_id=artifact.tenant_id
        and run.environment=artifact.environment
        and run.run_id=artifact.run_id
      where artifact.app_id=$1::uuid
        and artifact.tenant_id=$2::uuid
        and artifact.environment=$3::text
        and artifact.run_id=$4::uuid
        and artifact.artifact_id=$5::uuid
        and artifact.artifact_type=$6::text
        and artifact.revision=$7::integer
        and artifact.content_hash=$8::text
        and run.principal_id=$9::uuid`,
    [
      reference.app_id,
      reference.tenant_id,
      reference.environment,
      reference.run_id,
      reference.artifact_id,
      reference.artifact_type,
      reference.revision,
      reference.content_hash,
      principalId,
    ],
  );
  return result.rowCount === 1;
}

export function createPostgresProductTeamArtifactStore(
  options: PostgresProductTeamArtifactStoreOptions,
) {
  return Object.freeze({
    async commit(
      capabilityInput: unknown,
      leaseInput: unknown,
      documentInput: unknown,
    ): Promise<PortResult<ArtifactReference>> {
      const lease = runWorkLeaseSchema.safeParse(leaseInput);
      let document: ProductTeamArtifactDocument;
      try {
        document = await verifyProductTeamArtifactDocument(documentInput);
      } catch {
        return invalid(
          "PRODUCT_TEAM_ARTIFACT_INVALID",
          "Product Team Artifact 未通过 strict schema/hash 校验。",
        );
      }
      if (!lease.success || containsPotentialPlaintextSecret(document)) {
        return invalid(
          "PRODUCT_TEAM_ARTIFACT_INVALID",
          "Product Team Artifact lease 或公开内容不符合安全契约。",
        );
      }
      const reference = document.artifact_ref;
      if (
        reference.app_id !== lease.data.scope.app_id ||
        reference.tenant_id !== lease.data.scope.tenant_id ||
        reference.environment !== lease.data.scope.environment ||
        reference.run_id !== lease.data.run_id
      ) {
        return invalid(
          "PRODUCT_TEAM_ARTIFACT_SCOPE_MISMATCH",
          "Product Team Artifact 与 Worker lease 不属于同一 Scope/Run。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "agent-team.commit-product-artifact",
          correlation_id: reference.artifact_id,
        },
        async ({ capability, client }) => {
          if (
            capability.principal !== lease.data.principal_id ||
            capability.scope.app_id !== reference.app_id ||
            capability.scope.tenant_id !== reference.tenant_id ||
            capability.scope.environment !== reference.environment
          ) {
            throw new PersistenceBoundaryError(
              "PRODUCT_TEAM_ARTIFACT_SCOPE_MISMATCH",
              "Artifact capability 与 Worker lease 不一致。",
            );
          }
          const fence = await client.query<{ readonly active_fence: number | string | null }>(
            "select app_data_agent.lock_owned_run_fence($1::uuid) as active_fence",
            [reference.run_id],
          );
          if (BigInt(fence.rows[0]?.active_fence ?? 0) !== BigInt(lease.data.worker_fence)) {
            throw new PersistenceBoundaryError(
              "WORKER_FENCE_STALE",
              "过期 Worker Fence 不能提交 Product Team Artifact。",
              true,
            );
          }
          for (const source of document.source_refs) {
            if (!(await sourceExists(client, source, capability.principal))) {
              throw new PersistenceBoundaryError(
                "ARTIFACT_INPUT_NOT_COMMITTED",
                "Product Team Artifact 引用了尚未提交的 source ref。",
              );
            }
          }
          const inserted = await client.query(
            `insert into artifacts (
               app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
               content_hash,document_json,worker_fence,is_active,parent_revision,
               parent_content_hash,created_at
             ) values (
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::text,$7::integer,
               $8::text,$9::jsonb,$10::bigint,true,null,null,$11::timestamptz
             ) on conflict do nothing`,
            [
              reference.app_id,
              reference.tenant_id,
              reference.environment,
              reference.run_id,
              reference.artifact_id,
              reference.artifact_type,
              reference.revision,
              reference.content_hash,
              canonicalizeJson(document),
              lease.data.worker_fence,
              document.committed_at,
            ],
          );
          if (inserted.rowCount === 1) return reference;
          const existing = await client.query<{
            readonly content_hash: string;
            readonly document_json: unknown;
            readonly worker_fence: number | string;
          }>(
            `select content_hash,document_json,worker_fence
               from artifacts
              where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
                and run_id=$4::uuid and artifact_id=$5::uuid and artifact_type=$6::text
                and revision=$7::integer`,
            [
              reference.app_id,
              reference.tenant_id,
              reference.environment,
              reference.run_id,
              reference.artifact_id,
              reference.artifact_type,
              reference.revision,
            ],
          );
          const row = existing.rows[0];
          if (
            !row ||
            row.content_hash !== reference.content_hash ||
            canonicalizeJson(row.document_json) !== canonicalizeJson(document)
          ) {
            throw new PersistenceBoundaryError(
              "PRODUCT_TEAM_ARTIFACT_IDEMPOTENCY_CONFLICT",
              "同一 Product Team Artifact identity 已绑定不同内容。",
            );
          }
          return reference;
        },
      );
    },

    async verifyCommitted(
      capabilityInput: unknown,
      reference: ArtifactReference,
    ): Promise<PortResult<boolean>> {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        { access: "READ", operation_name: "agent-team.verify-product-artifact" },
        ({ capability, client }) => sourceExists(client, reference, capability.principal),
      );
    },

    async resolveCommitted(
      capabilityInput: unknown,
      reference: ArtifactReference,
    ): Promise<PortResult<ProductTeamArtifactDocument | null>> {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        { access: "READ", operation_name: "agent-team.resolve-product-artifact" },
        async ({ capability, client }) => {
          const result = await client.query<{ readonly document_json: unknown }>(
            `select artifact.document_json
               from artifacts artifact
               join runs run
                 on run.app_id=artifact.app_id and run.tenant_id=artifact.tenant_id
                and run.environment=artifact.environment and run.run_id=artifact.run_id
              where artifact.app_id=$1::uuid and artifact.tenant_id=$2::uuid
                and artifact.environment=$3::text and artifact.run_id=$4::uuid
                and artifact.artifact_id=$5::uuid and artifact.artifact_type=$6::text
                and artifact.revision=$7::integer and artifact.content_hash=$8::text
                and run.principal_id=$9::uuid`,
            [
              reference.app_id,
              reference.tenant_id,
              reference.environment,
              reference.run_id,
              reference.artifact_id,
              reference.artifact_type,
              reference.revision,
              reference.content_hash,
              capability.principal,
            ],
          );
          const value = result.rows[0]?.document_json;
          return value === undefined ? null : verifyProductTeamArtifactDocument(value);
        },
      );
    },
  });
}

export type PostgresProductTeamArtifactStore = ReturnType<
  typeof createPostgresProductTeamArtifactStore
>;
