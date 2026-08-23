import {
  isAuthoritativeExecutionCertificationReceiptDraft,
  isAuthoritativeModelCertificationReceiptDraft,
} from "@data-agent/agent-runtime";
import {
  type ArtifactReference,
  canonicalizeJson,
  computeModelExecutionCertificationContentHash,
  type ModelCertificationClaims,
  modelCertificationClaimsSchema,
  modelExecutionCertificationBasisSchema,
  modelExecutionCertificationClaimsSchema,
  type PortResult,
  verifyModelExecutionCertificationClaims,
} from "@data-agent/contracts";
import {
  type AppCapability,
  type CapabilityQueryClient,
  containsPotentialPlaintextSecret,
  createPostgresRepository,
  PersistenceBoundaryError,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
  withAppTransaction,
} from "@data-agent/platform";
import type { ModelCertificationReceiptStore } from "./credentialed-provider-certification.internal.js";

interface FenceRow {
  readonly active_fence: string | number | null;
}

interface ExistingReceiptRow {
  readonly content_hash: string;
  readonly document_json: unknown;
}

type ModelExecutionCertificationClaims = Awaited<
  ReturnType<typeof verifyModelExecutionCertificationClaims>
>;

export interface CommittedGoalPreflightEvidenceAuthority {
  resolveCommitted(
    input: Readonly<{
      scope: AppCapability["scope"];
      run_id: string;
      goal_execution_id: string;
      plan_commit: string;
    }>,
    context: Readonly<{
      capability: AppCapability;
      client: CapabilityQueryClient;
    }>,
  ): Promise<unknown | null>;
}

function invalidInput(message: string): PortResult<never> {
  return {
    ok: false,
    error: {
      code: "PERSISTENCE_INPUT_INVALID",
      message,
      retryable: false,
    },
  };
}

function sameScope(reference: ArtifactReference, capability: AppCapability): boolean {
  return (
    reference.app_id === capability.scope.app_id &&
    reference.tenant_id === capability.scope.tenant_id &&
    reference.environment === capability.scope.environment
  );
}

declare const authoritativeModelCertificationReceiptStore: unique symbol;
const authoritativeStores = new WeakSet<object>();

export type AuthoritativeModelCertificationReceiptStore = ModelCertificationReceiptStore & {
  readonly [authoritativeModelCertificationReceiptStore]: true;
};

export function isAuthoritativeModelCertificationReceiptStore(
  input: unknown,
): input is AuthoritativeModelCertificationReceiptStore {
  return typeof input === "object" && input !== null && authoritativeStores.has(input);
}

/**
 * 把真实 Credential Smoke Draft 与 U2 PostgreSQL Authority 绑定为唯一生产提交口。
 * Capability、Authorizer 与 Pool 均在创建时封闭，调用方不能在单次 Commit 中替换。
 */
export function createPostgresModelCertificationReceiptStore(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
  readonly goal_preflight_evidence_authority?: CommittedGoalPreflightEvidenceAuthority;
}): AuthoritativeModelCertificationReceiptStore {
  const repository = createPostgresRepository(input.pool, input.authorizer);
  const store: ModelCertificationReceiptStore = Object.freeze({
    async commit(
      claimsInput: ModelCertificationClaims | ModelExecutionCertificationClaims,
      options: { readonly worker_fence: number },
    ): Promise<PortResult<ArtifactReference>> {
      const legacyDraft = isAuthoritativeModelCertificationReceiptDraft(claimsInput);
      const executionDraft = isAuthoritativeExecutionCertificationReceiptDraft(claimsInput);
      if (!legacyDraft && !executionDraft) {
        return invalidInput(
          "Model Certification Receipt 只接受真实 Smoke/Preflight 生成的权威 Draft。",
        );
      }
      if (!Number.isSafeInteger(options.worker_fence) || options.worker_fence < 0) {
        return invalidInput("Model Certification Receipt Commit 输入不符合契约。");
      }
      let claims: ModelCertificationClaims | ModelExecutionCertificationClaims;
      let expectedContentHash: string;
      if (legacyDraft) {
        const parsed = modelCertificationClaimsSchema.safeParse(claimsInput);
        if (!parsed.success) {
          return invalidInput("Legacy Certification Claims 不符合严格合同。");
        }
        claims = parsed.data;
        expectedContentHash = claims.probe_hash;
      } else {
        const parsed = modelExecutionCertificationClaimsSchema.safeParse(claimsInput);
        if (!parsed.success) {
          return invalidInput("Execution Certification Claims 不符合严格合同。");
        }
        try {
          claims = await verifyModelExecutionCertificationClaims(parsed.data);
          expectedContentHash = await computeModelExecutionCertificationContentHash(claims);
        } catch {
          return invalidInput("Execution Certification Claims 的 profile snapshot/hash 不一致。");
        }
      }
      const reference = claims.receipt_ref;
      if (
        reference.revision !== 1 ||
        reference.content_hash !== expectedContentHash ||
        containsPotentialPlaintextSecret(claims)
      ) {
        return invalidInput(
          "Model Certification Receipt 必须无明文凭据，并绑定 canonical Claims Hash。",
        );
      }
      const canonicalClaims = canonicalizeJson(claims);

      return withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        { access: "WRITE" },
        async ({ capability, client }) => {
          if (!sameScope(reference, capability)) {
            throw new PersistenceBoundaryError(
              "MODEL_CERTIFICATION_SCOPE_MISMATCH",
              "Model Certification Receipt 与 Authority Scope 不一致。",
            );
          }
          if (
            "execution_profile_snapshot" in claims &&
            (claims.execution_profile_snapshot.scope.app_id !== capability.scope.app_id ||
              claims.execution_profile_snapshot.scope.tenant_id !== capability.scope.tenant_id ||
              claims.execution_profile_snapshot.scope.environment !== capability.scope.environment)
          ) {
            throw new PersistenceBoundaryError(
              "MODEL_CERTIFICATION_SCOPE_MISMATCH",
              "Execution Certification snapshot 与 Authority Scope 不一致。",
            );
          }

          const run = await client.query<FenceRow>(
            `select app_data_agent.lock_owned_run_fence(
               $1::uuid
             ) as active_fence`,
            [reference.run_id],
          );
          const activeFence = run.rows[0]?.active_fence;
          if (activeFence === undefined || activeFence === null) {
            throw new PersistenceBoundaryError(
              "RUN_NOT_FOUND_OR_DENIED",
              "Certification Receipt 所属 Run 不存在或不属于当前 Principal。",
            );
          }
          if (BigInt(activeFence) !== BigInt(options.worker_fence)) {
            throw new PersistenceBoundaryError(
              "WORKER_FENCE_STALE",
              "Worker Fence 已过期，不能提交 Model Certification Receipt。",
            );
          }

          if (
            "certification_basis" in claims &&
            claims.certification_basis.kind === "GOAL_PREFLIGHT_ATTESTATION"
          ) {
            const authority = input.goal_preflight_evidence_authority;
            let resolvedEvidence: unknown = null;
            if (authority) {
              try {
                resolvedEvidence = await authority.resolveCommitted(
                  {
                    scope: capability.scope,
                    run_id: reference.run_id,
                    goal_execution_id: claims.certification_basis.goal_execution_id,
                    plan_commit: claims.certification_basis.plan_commit,
                  },
                  { capability, client },
                );
              } catch {
                resolvedEvidence = null;
              }
            }
            const committed = modelExecutionCertificationBasisSchema.safeParse(resolvedEvidence);
            if (
              !committed.success ||
              committed.data.kind !== "GOAL_PREFLIGHT_ATTESTATION" ||
              canonicalizeJson(committed.data) !== canonicalizeJson(claims.certification_basis)
            ) {
              throw new PersistenceBoundaryError(
                "MODEL_CERTIFICATION_GOAL_EVIDENCE_NOT_COMMITTED",
                "Goal Preflight Certification 必须精确绑定已提交的 plan/manifest/checkpoint evidence。",
              );
            }
          }

          const existing = await client.query<ExistingReceiptRow>(
            `select content_hash, document_json
             from artifacts
             where app_id = $1
               and tenant_id = $2
               and environment = $3
               and run_id = $4
               and artifact_id = $5
               and artifact_type = 'ModelCertificationReceipt'
               and revision = 1
             for update`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              reference.run_id,
              reference.artifact_id,
            ],
          );
          const existingReceipt = existing.rows[0];
          if (existingReceipt) {
            if (
              existingReceipt.content_hash === reference.content_hash &&
              canonicalizeJson(existingReceipt.document_json) === canonicalClaims
            ) {
              return reference;
            }
            throw new PersistenceBoundaryError(
              "MODEL_CERTIFICATION_RECEIPT_CONFLICT",
              "同一 Model Certification Receipt ID 已绑定不同内容。",
            );
          }

          await client.query(
            `insert into artifacts (
               app_id,
               tenant_id,
               environment,
               run_id,
               artifact_id,
               artifact_type,
               revision,
               content_hash,
               document_json,
               worker_fence,
               is_active,
               parent_revision,
               parent_content_hash
             )
             values (
               $1, $2, $3, $4, $5, 'ModelCertificationReceipt', 1, $6, $7::jsonb, $8,
               true, null, null
             )`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              reference.run_id,
              reference.artifact_id,
              reference.content_hash,
              canonicalClaims,
              options.worker_fence,
            ],
          );
          return reference;
        },
      );
    },
    resolve: (reference: ArtifactReference) =>
      repository.resolveArtifact(input.capability, reference),
    verify: (reference: ArtifactReference) =>
      repository.verifyCommitted(input.capability, reference),
  });
  authoritativeStores.add(store);
  return store as AuthoritativeModelCertificationReceiptStore;
}
