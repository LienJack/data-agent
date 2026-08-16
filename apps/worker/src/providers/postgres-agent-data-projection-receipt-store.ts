import {
  type AgentDataProjectionReceiptV2,
  type ArtifactReference,
  agentDataProjectionReceiptReferenceSchema,
  canonicalizeJson,
  type PortResult,
  runWorkLeaseSchema,
  verifyAgentDataProjectionReceiptV2Candidate,
} from "@data-agent/contracts";
import {
  type AppCapability,
  containsPotentialPlaintextSecret,
  PersistenceBoundaryError,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
  withAppTransaction,
} from "@data-agent/platform";
import {
  type InternalAgentDataProjectionReceipt,
  isInternalAgentDataProjectionReceipt,
} from "./agent-data-projection-receipt.internal.js";

interface ExistingArtifactRow {
  readonly content_hash: string;
  readonly document_json: unknown;
}

export interface CommittedProjectionReceiptResolver {
  resolve_committed(reference: ArtifactReference): Promise<unknown | null>;
}

function invalid(message: string): PortResult<never> {
  return {
    ok: false,
    error: { code: "AGENT_DATA_PROJECTION_RECEIPT_INVALID", message, retryable: false },
  };
}

function containsProjectionPlaintextSecret(receipt: AgentDataProjectionReceiptV2): boolean {
  // These two fields are strict, hash-covered capacity evidence.  The generic
  // secret scanner deliberately treats every `token`-named key as sensitive,
  // so pass only the remaining material through it after the Contract verifier
  // has established the exact Option B wire.
  const {
    token_bound_policy_version: _tokenBoundPolicyVersion,
    trusted_input_token_upper_bound: _trustedInputTokenUpperBound,
    ...secretBearingMaterial
  } = receipt;
  return containsPotentialPlaintextSecret(secretBearingMaterial);
}

function referenceFor(receipt: AgentDataProjectionReceiptV2): ArtifactReference {
  return {
    artifact_id: receipt.receipt_id,
    artifact_type: "AgentDataProjectionReceipt",
    app_id: receipt.scope.app_id,
    tenant_id: receipt.scope.tenant_id,
    environment: receipt.scope.environment,
    run_id: receipt.run_id,
    revision: 1,
    content_hash: receipt.receipt_hash,
  };
}

export interface PostgresAgentDataProjectionReceiptStore {
  commit(
    lease: unknown,
    receipt: InternalAgentDataProjectionReceipt,
  ): Promise<PortResult<ArtifactReference>>;
  committedResolverForLease(lease: unknown): CommittedProjectionReceiptResolver;
}

export function createPostgresAgentDataProjectionReceiptStore(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
}): PostgresAgentDataProjectionReceiptStore {
  return Object.freeze({
    committedResolverForLease(leaseInput: unknown): CommittedProjectionReceiptResolver {
      const lease = runWorkLeaseSchema.safeParse(leaseInput);
      return Object.freeze({
        async resolve_committed(referenceInput: ArtifactReference) {
          const reference = agentDataProjectionReceiptReferenceSchema.safeParse(referenceInput);
          if (
            !lease.success ||
            !reference.success ||
            reference.data.app_id !== lease.data.scope.app_id ||
            reference.data.tenant_id !== lease.data.scope.tenant_id ||
            reference.data.environment !== lease.data.scope.environment ||
            reference.data.run_id !== lease.data.run_id ||
            input.capability.principal !== lease.data.principal_id
          ) {
            return null;
          }

          const resolved = await withAppTransaction(
            input.pool,
            input.authorizer,
            input.capability,
            {
              access: "WRITE",
              allowed_roles: ["OWNER", "ANALYST"],
              operation_name: "provider_invocation.resolve_projection_receipt",
              correlation_id: reference.data.artifact_id,
            },
            async ({ capability, client }) => {
              if (
                capability.scope.app_id !== reference.data.app_id ||
                capability.scope.tenant_id !== reference.data.tenant_id ||
                capability.scope.environment !== reference.data.environment ||
                capability.principal !== lease.data.principal_id
              ) {
                return null;
              }
              const active = await client.query<{ readonly allowed: boolean }>(
                `select exists (
                   select 1
                   from app_data_agent.run_attempts attempt
                   join app_data_agent.outbox message
                     on message.app_id = attempt.app_id
                    and message.tenant_id = attempt.tenant_id
                    and message.environment = attempt.environment
                    and message.outbox_id = attempt.outbox_id
                    and message.run_id = attempt.run_id
                    and message.command_id = attempt.command_id
                   where attempt.app_id = $1
                     and attempt.tenant_id = $2
                     and attempt.environment = $3
                     and attempt.run_id = $4
                     and attempt.attempt_id = $5
                     and attempt.attempt_no = $6
                     and attempt.outbox_id = $7
                     and attempt.command_id = $8
                     and attempt.worker_id = $9
                     and attempt.lease_token = $10
                     and attempt.worker_fence = $11
                     and attempt.status = 'ACTIVE'
                     and attempt.lease_expires_at > pg_catalog.clock_timestamp()
                     and message.status = 'LEASED'
                     and message.lease_expires_at > pg_catalog.clock_timestamp()
                     and message.active_attempt_id = attempt.attempt_id
                     and message.lease_owner = attempt.worker_id
                     and message.lease_token = attempt.lease_token
                     and message.run_fence = attempt.worker_fence
                     and app_data_agent.lock_owned_run_fence(attempt.run_id) = attempt.worker_fence
                 ) as allowed`,
                [
                  lease.data.scope.app_id,
                  lease.data.scope.tenant_id,
                  lease.data.scope.environment,
                  lease.data.run_id,
                  lease.data.attempt_id,
                  lease.data.attempt_no,
                  lease.data.outbox_id,
                  lease.data.command_id,
                  lease.data.worker_id,
                  lease.data.lease_token,
                  lease.data.worker_fence,
                ],
              );
              if (active.rows[0]?.allowed !== true) return null;

              const artifact = await client.query<ExistingArtifactRow>(
                `select content_hash, document_json
                 from app_data_agent.artifacts
                 where app_id = $1 and tenant_id = $2 and environment = $3 and run_id = $4
                   and artifact_id = $5 and artifact_type = 'AgentDataProjectionReceipt'
                   and revision = 1 and content_hash = $6 and is_active`,
                [
                  reference.data.app_id,
                  reference.data.tenant_id,
                  reference.data.environment,
                  reference.data.run_id,
                  reference.data.artifact_id,
                  reference.data.content_hash,
                ],
              );
              const row = artifact.rows[0];
              if (!row || row.content_hash !== reference.data.content_hash) return null;
              try {
                const receipt = await verifyAgentDataProjectionReceiptV2Candidate(
                  row.document_json,
                );
                return canonicalizeJson(referenceFor(receipt)) === canonicalizeJson(reference.data)
                  ? receipt
                  : null;
              } catch {
                return null;
              }
            },
          );
          return resolved.ok ? resolved.value : null;
        },
      });
    },
    async commit(leaseInput: unknown, receiptInput: InternalAgentDataProjectionReceipt) {
      const lease = runWorkLeaseSchema.safeParse(leaseInput);
      if (!lease.success || !isInternalAgentDataProjectionReceipt(receiptInput)) {
        return invalid("Projection Receipt 需要内部 projector 与严格 Worker Lease。");
      }
      let receipt: AgentDataProjectionReceiptV2;
      try {
        receipt = await verifyAgentDataProjectionReceiptV2Candidate(receiptInput);
      } catch {
        return invalid("Projection Receipt canonical hash 校验失败。");
      }
      if (
        receipt.scope.app_id !== lease.data.scope.app_id ||
        receipt.scope.tenant_id !== lease.data.scope.tenant_id ||
        receipt.scope.environment !== lease.data.scope.environment ||
        receipt.run_id !== lease.data.run_id ||
        receipt.principal_id !== lease.data.principal_id ||
        containsProjectionPlaintextSecret(receipt)
      ) {
        return invalid("Projection Receipt 与 Worker Authority 不一致或含敏感值。");
      }
      const reference = referenceFor(receipt);
      const canonical = canonicalizeJson(receipt);

      return withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.commit_projection_receipt",
          correlation_id: receipt.receipt_id,
        },
        async ({ capability, client }) => {
          if (
            capability.scope.app_id !== receipt.scope.app_id ||
            capability.scope.tenant_id !== receipt.scope.tenant_id ||
            capability.scope.environment !== receipt.scope.environment ||
            capability.principal !== receipt.principal_id
          ) {
            throw new PersistenceBoundaryError(
              "AGENT_DATA_PROJECTION_SCOPE_MISMATCH",
              "Projection Receipt 与 PostgreSQL Capability Scope 不一致。",
            );
          }
          const active = await client.query<{ readonly allowed: boolean }>(
            `select exists (
               select 1
               from app_data_agent.run_attempts attempt
               join app_data_agent.outbox message
                 on message.app_id = attempt.app_id
                and message.tenant_id = attempt.tenant_id
                and message.environment = attempt.environment
                and message.outbox_id = attempt.outbox_id
                and message.run_id = attempt.run_id
                and message.command_id = attempt.command_id
               where attempt.app_id = $1
                 and attempt.tenant_id = $2
                 and attempt.environment = $3
                 and attempt.run_id = $4
                 and attempt.attempt_id = $5
                 and attempt.attempt_no = $6
                 and attempt.outbox_id = $7
                 and attempt.command_id = $8
                 and attempt.worker_id = $9
                 and attempt.lease_token = $10
                 and attempt.worker_fence = $11
                 and attempt.status = 'ACTIVE'
                 and attempt.lease_expires_at > pg_catalog.clock_timestamp()
                 and message.status = 'LEASED'
                 and message.lease_expires_at > pg_catalog.clock_timestamp()
                 and message.active_attempt_id = attempt.attempt_id
                 and message.lease_owner = attempt.worker_id
                 and message.lease_token = attempt.lease_token
                 and message.run_fence = attempt.worker_fence
                 and app_data_agent.lock_owned_run_fence(attempt.run_id) = attempt.worker_fence
             ) as allowed`,
            [
              receipt.scope.app_id,
              receipt.scope.tenant_id,
              receipt.scope.environment,
              receipt.run_id,
              lease.data.attempt_id,
              lease.data.attempt_no,
              lease.data.outbox_id,
              lease.data.command_id,
              lease.data.worker_id,
              lease.data.lease_token,
              lease.data.worker_fence,
            ],
          );
          if (active.rows[0]?.allowed !== true) {
            throw new PersistenceBoundaryError(
              "PROVIDER_WORKER_LEASE_STALE",
              "Projection Receipt 只能由当前 ACTIVE Worker Lease 提交。",
            );
          }

          for (const source of receipt.input_refs) {
            const committed = await client.query<{ readonly allowed: boolean }>(
              `select exists (
                 select 1 from app_data_agent.artifacts artifact
                 where artifact.app_id = $1 and artifact.tenant_id = $2
                   and artifact.environment = $3 and artifact.run_id = $4
                   and artifact.artifact_id = $5 and artifact.artifact_type = $6
                   and artifact.revision = $7 and artifact.content_hash = $8
                   and artifact.is_active
               ) as allowed`,
              [
                source.app_id,
                source.tenant_id,
                source.environment,
                source.run_id,
                source.artifact_id,
                source.artifact_type,
                source.revision,
                source.content_hash,
              ],
            );
            if (committed.rows[0]?.allowed !== true) {
              throw new PersistenceBoundaryError(
                "AGENT_DATA_PROJECTION_INPUT_NOT_COMMITTED",
                "Projection Receipt 的 input ref 尚未提交或 hash 不一致。",
              );
            }
          }

          const existing = await client.query<ExistingArtifactRow>(
            `select content_hash, document_json from app_data_agent.artifacts
             where app_id = $1 and tenant_id = $2 and environment = $3 and run_id = $4
               and artifact_id = $5 and artifact_type = 'AgentDataProjectionReceipt'
               and revision = 1 for update`,
            [
              receipt.scope.app_id,
              receipt.scope.tenant_id,
              receipt.scope.environment,
              receipt.run_id,
              receipt.receipt_id,
            ],
          );
          if (existing.rows[0]) {
            if (
              existing.rows[0].content_hash === receipt.receipt_hash &&
              canonicalizeJson(existing.rows[0].document_json) === canonical
            ) {
              return reference;
            }
            throw new PersistenceBoundaryError(
              "AGENT_DATA_PROJECTION_RECEIPT_CONFLICT",
              "Projection Receipt ID 已绑定不同内容。",
            );
          }

          await client.query(
            `insert into app_data_agent.artifacts (
               app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
               content_hash,document_json,worker_fence,is_active,parent_revision,parent_content_hash
             ) values ($1,$2,$3,$4,$5,'AgentDataProjectionReceipt',1,$6,$7::jsonb,$8,true,null,null)`,
            [
              receipt.scope.app_id,
              receipt.scope.tenant_id,
              receipt.scope.environment,
              receipt.run_id,
              receipt.receipt_id,
              receipt.receipt_hash,
              canonical,
              lease.data.worker_fence,
            ],
          );
          return reference;
        },
      );
    },
  });
}
