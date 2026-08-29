import {
  isAuthoritativeExecutionCertificationReceiptDraft,
  isAuthoritativeModelCertificationReceiptDraft,
} from "@data-agent/agent-runtime";
import {
  type ArtifactReference,
  buildFalcon24LlmExecutionAuthorityProof,
  canonicalizeJson,
  computeModelExecutionCertificationContentHash,
  type Falcon24LlmExecutionAuthorityProof,
  falcon24LlmExecutionAuthorityProofSchema,
  type ModelCertificationClaims,
  modelCertificationClaimsSchema,
  modelExecutionCertificationBasisSchema,
  modelExecutionCertificationClaimsSchema,
  type PortResult,
  sha256ContentHash,
  verifyModelExecutionCertificationClaims,
} from "@data-agent/contracts";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
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

interface JsonValueRow {
  readonly value: unknown;
}

interface Falcon24StagedCertificationDocument {
  readonly schema_version: "falcon24-llm-execution-stage@1.0.0";
  readonly status: "STAGED" | "PROMOTED" | "REJECTED";
  readonly proof_document: Falcon24LlmExecutionAuthorityProof;
  readonly certification_claims: ModelExecutionCertificationClaims;
  readonly certification_is_active: boolean;
  readonly staging_command_hash: string;
  readonly activation_attempt_id: string | null;
  readonly rejection_reason_code: string | null;
  readonly rejection_command_hash: string | null;
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

export type Falcon24ModelCertificationStageStore = AuthoritativeModelCertificationReceiptStore & {
  loadStagedProof(): Promise<PortResult<Falcon24LlmExecutionAuthorityProof>>;
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

function isFalcon24StagedCertificationDocument(
  value: unknown,
): value is Falcon24StagedCertificationDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Readonly<Record<string, unknown>>;
  if (
    document.schema_version !== "falcon24-llm-execution-stage@1.0.0" ||
    !["STAGED", "PROMOTED", "REJECTED"].includes(String(document.status)) ||
    typeof document.certification_is_active !== "boolean" ||
    typeof document.staging_command_hash !== "string" ||
    (document.activation_attempt_id !== null &&
      typeof document.activation_attempt_id !== "string") ||
    (document.rejection_reason_code !== null &&
      typeof document.rejection_reason_code !== "string") ||
    (document.rejection_command_hash !== null &&
      typeof document.rejection_command_hash !== "string") ||
    (document.status === "REJECTED" &&
      (!document.rejection_reason_code || !document.rejection_command_hash)) ||
    (document.status !== "REJECTED" &&
      (document.rejection_reason_code !== null || document.rejection_command_hash !== null))
  ) {
    return false;
  }
  return (
    falcon24LlmExecutionAuthorityProofSchema.safeParse(document.proof_document).success &&
    modelExecutionCertificationClaimsSchema.safeParse(document.certification_claims).success
  );
}

/**
 * E7 恢复专用提交口：真实 Credential Smoke 仍使用同一认证 Runner，但 Receipt
 * 只写入不可见的 Falcon stage。正式 profile 读路径在原子激活前看不到该候选。
 */
export function createPostgresFalcon24ModelCertificationStageStore(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
  readonly target_authority_epoch: string;
  readonly staging_id: string;
  readonly stage_id: string;
  readonly idempotency_key: string;
  readonly model_resource_hash: `sha256:${string}`;
  readonly worker_build: RuntimeBuildIdentity;
}): Falcon24ModelCertificationStageStore {
  let expectedReference: ArtifactReference | null = null;

  async function loadStage(): Promise<PortResult<Falcon24StagedCertificationDocument>> {
    return withAppTransaction(
      input.pool,
      input.authorizer,
      input.capability,
      { access: "READ" },
      async ({ client }) => {
        const result = await client.query<JsonValueRow>(
          "select app_data_agent.load_falcon24_llm_execution_certification_stage($1::uuid) as value",
          [input.stage_id],
        );
        const document = result.rows[0]?.value;
        if (!isFalcon24StagedCertificationDocument(document)) {
          throw new PersistenceBoundaryError(
            "FALCON24_LLM_EXECUTION_STAGE_CORRUPT",
            "Falcon24 LLM Execution Stage 读回不符合严格合同。",
          );
        }
        return document;
      },
    );
  }

  const store: ModelCertificationReceiptStore & {
    loadStagedProof(): Promise<PortResult<Falcon24LlmExecutionAuthorityProof>>;
  } = Object.freeze({
    async commit(
      claimsInput: ModelCertificationClaims | ModelExecutionCertificationClaims,
      options: { readonly worker_fence: number },
    ): Promise<PortResult<ArtifactReference>> {
      if (!isAuthoritativeExecutionCertificationReceiptDraft(claimsInput)) {
        return invalidInput("Falcon24 E7 Stage 只接受真实 Execution Credential Smoke Draft。");
      }
      if (!Number.isSafeInteger(options.worker_fence) || options.worker_fence < 0) {
        return invalidInput("Falcon24 E7 Stage Worker Fence 不符合契约。");
      }
      let claims: ModelExecutionCertificationClaims;
      try {
        claims = await verifyModelExecutionCertificationClaims(claimsInput);
      } catch {
        return invalidInput("Falcon24 E7 Execution Certification Claims Hash 不一致。");
      }
      const reference = claims.receipt_ref;
      const connection = claims.connection;
      if (
        claims.provider !== "deepseek" ||
        claims.model_id !== "deepseek-v4-flash" ||
        claims.certification_basis.kind !== "CREDENTIAL_SMOKE" ||
        claims.recovery_capabilities.length !== 1 ||
        claims.recovery_capabilities[0] !== "AT_LEAST_ONCE_ONLY" ||
        connection.kind !== "SYSTEM_DEPLOYMENT" ||
        reference.revision !== 1 ||
        reference.content_hash !== (await computeModelExecutionCertificationContentHash(claims)) ||
        containsPotentialPlaintextSecret(claims)
      ) {
        return invalidInput("Falcon24 E7 Stage 只接受 exact DeepSeek live certification closure。");
      }
      if (!sameScope(reference, input.capability)) {
        return invalidInput("Falcon24 E7 Certification Receipt Scope 不匹配。");
      }
      const proof = await buildFalcon24LlmExecutionAuthorityProof({
        schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
        scope: { ...input.capability.scope, semantic_domain: "falcon24" },
        target_authority_epoch: input.target_authority_epoch,
        staging_id: input.staging_id,
        stage_id: input.stage_id,
        model_profile_id: claims.profile_id,
        model_config_version: claims.model_config_version,
        model_resource_hash: input.model_resource_hash,
        provider: "deepseek",
        model_id: "deepseek-v4-flash",
        certification_receipt_ref: reference,
        execution_profile_hash: claims.execution_profile_hash,
        deployment_id: connection.deployment_id,
        deployment_hash: connection.deployment_hash,
        recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
        worker_build: {
          build_id: input.worker_build.build_id,
          generation_id: input.worker_build.generation_id,
        },
      });
      const material = {
        schema_version: "falcon24-llm-execution-stage-command@1.0.0",
        target_authority_epoch: input.target_authority_epoch,
        staging_id: input.staging_id,
        stage_id: input.stage_id,
        idempotency_key: input.idempotency_key,
        proof_document: proof,
        certification_claims: claims,
        worker_fence: options.worker_fence,
      } as const;
      const command = { ...material, command_hash: await sha256ContentHash(material) };
      const staged = await withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        { access: "WRITE" },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.stage_falcon24_llm_execution_certification($1::jsonb) as value",
            [canonicalizeJson(command)],
          );
          const serverProof = await (async () => {
            try {
              return falcon24LlmExecutionAuthorityProofSchema.parse(result.rows[0]?.value);
            } catch {
              throw new PersistenceBoundaryError(
                "FALCON24_LLM_EXECUTION_STAGE_CORRUPT",
                "Falcon24 LLM Execution Stage 返回值不符合严格合同。",
              );
            }
          })();
          if (canonicalizeJson(serverProof) !== canonicalizeJson(proof)) {
            throw new PersistenceBoundaryError(
              "FALCON24_LLM_EXECUTION_STAGE_CONFLICT",
              "Falcon24 LLM Execution Stage 与本次认证 proof 不一致。",
            );
          }
          return reference;
        },
      );
      if (staged.ok) expectedReference = reference;
      return staged;
    },
    async resolve(reference: ArtifactReference): Promise<PortResult<unknown | null>> {
      if (
        !expectedReference ||
        canonicalizeJson(reference) !== canonicalizeJson(expectedReference)
      ) {
        return invalidInput("Falcon24 E7 Stage 只允许解析当前候选 Receipt。");
      }
      const staged = await loadStage();
      if (!staged.ok) return staged;
      return { ok: true, value: staged.value.certification_claims };
    },
    async verify(reference: ArtifactReference): Promise<PortResult<boolean>> {
      if (
        !expectedReference ||
        canonicalizeJson(reference) !== canonicalizeJson(expectedReference)
      ) {
        return { ok: true, value: false };
      }
      const staged = await loadStage();
      if (!staged.ok) return staged;
      const stageReference = staged.value.proof_document.certification_receipt_ref;
      return {
        ok: true,
        value:
          staged.value.status !== "REJECTED" &&
          canonicalizeJson(stageReference) === canonicalizeJson(reference),
      };
    },
    async loadStagedProof(): Promise<PortResult<Falcon24LlmExecutionAuthorityProof>> {
      const staged = await loadStage();
      if (!staged.ok) return staged;
      return { ok: true, value: staged.value.proof_document };
    },
  });
  authoritativeStores.add(store);
  return store as Falcon24ModelCertificationStageStore;
}
