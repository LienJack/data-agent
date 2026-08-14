import {
  ArtifactAuthorityError,
  type ArtifactCommitterCapabilityClaim,
  ArtifactInputAuthorityError,
  ArtifactIntegrityError,
  type ArtifactReference,
  ArtifactSemanticAuthorityError,
  type AuthoritativeMetamorphicOracleReceipt,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  canonicalizeJson,
  computeGroundingAuthorityDocumentHash,
  computeL2ArtifactContentHash,
  type GroundingAuthorityDocument,
  GroundingAuthorityError,
  type GroundingAuthorityReference,
  type GroundingAuthorityVerificationContext,
  type GroundingPackagePayload,
  groundingAuthorityDocumentSchema,
  groundingAuthorityIdentityViolation,
  groundingAuthorityReferenceSchema,
  isAuthoritativeMetamorphicFixtureReceipt,
  isAuthoritativeMetamorphicOracleReceipt,
  isAuthoritativeResultOracleReceipt,
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  type LogicalPlanPayload,
  l2ArtifactDocumentSchema,
  type PortResult,
  type QueryContractPayload,
  type ResourceAdmissionReceipt,
  runRuntimeEventSchema,
  type SqlArtifactPayload,
  sha256ContentHash,
  TEXT2SQL_RUNTIME_SYSTEM_ARTIFACT_TYPES,
  verifyGroundingAuthorityDocument,
  verifyL2ArtifactDocument,
} from "@data-agent/contracts";
import { z } from "zod";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";
import type { AppCapability } from "../tenancy/capability.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";
import { mapDatabaseRuntimeFailure } from "./runtime-database-errors.js";
import {
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "./transaction.js";

const uuid = z.uuid();
const stableCommandValue = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
const commandSecretRef = z
  .string()
  .regex(/^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const commandPayloadSchema = z
  .strictObject({
    kind: z.literal("START_L2_RESEARCH"),
    mode: z.literal("L2").optional(),
    question_version: stableCommandValue.optional(),
    dataset_id: stableCommandValue.optional(),
    secret_refs: z.array(commandSecretRef).min(1).max(32).optional(),
    datasource_id: uuid.optional(),
    conversation_id: uuid.optional(),
  })
  .refine(
    (payload) => payload.conversation_id === undefined || payload.datasource_id !== undefined,
  );
const commandInputSchema = z.strictObject({
  run_id: uuid,
  command_id: uuid,
  event_id: uuid,
  outbox_id: uuid,
  audit_id: uuid,
  idempotency_key: z.string().min(1).max(256),
  question: z.string().min(1).max(4_000),
  payload: commandPayloadSchema,
});
const runLookupSchema = z.strictObject({ run_id: uuid });
const artifactCommitOptionsSchema = z.strictObject({
  expected_active_revision: z.number().int().nonnegative(),
  worker_fence: z.number().int().nonnegative().safe(),
});

const text2SqlRuntimeSystemArtifactTypes = new Set<string>(TEXT2SQL_RUNTIME_SYSTEM_ARTIFACT_TYPES);
const reservedResearchArtifactTypes = new Set<string>(
  L2_RESEARCH_WIRE_VERSION_MATRIX.map(([artifactType]) => artifactType),
);

export type CommandAcceptance = Readonly<{
  created: boolean;
  run_id: string;
  command_id: string;
  outbox_id: string | null;
  payload_hash: string;
}>;

export type PersistedRun = Readonly<{
  app_id: string;
  tenant_id: string;
  environment: string;
  run_id: string;
  principal_id: string;
  status: string;
  active_fence: number;
  question: string;
  created_at: string;
  updated_at: string;
}>;

interface RunRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly run_id: string;
  readonly principal_id: string;
  readonly status: string;
  readonly active_fence: string | number;
  readonly question: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ActiveArtifactRow {
  readonly revision: number;
  readonly content_hash: string;
}

interface FenceRow {
  readonly active_fence: string | number | null;
}

interface ArtifactDocumentRow {
  readonly document_json: unknown;
}

interface CanonicalPayloadHashRow {
  readonly payload_hash: string;
}

interface JsonResultRow {
  readonly result: unknown;
}

export interface PostgresRepositoryAuthorities {
  /**
   * 由服务端组合根注入，校验 Attempt、Artifact Type、Producer 与 Policy Version。
   * 缺失时 L2 提交失败关闭。
   */
  verifyL2ArtifactCommitterCapability?(
    claim: ArtifactCommitterCapabilityClaim,
    capability: AppCapability,
  ): Promise<boolean>;
  /** 服务端确定性 Compiler 的逐字输出核验；缺失时 SqlArtifact 提交失败关闭。 */
  verifySqlArtifactCompilation?(
    input: {
      readonly sql_artifact: SqlArtifactPayload;
      readonly logical_plan: LogicalPlanPayload;
      readonly grounding: GroundingPackagePayload;
      readonly query_contract: QueryContractPayload;
    },
    capability: AppCapability,
  ): Promise<boolean>;
  /**
   * 专用服务端 Deterministic Policy Authority。
   *
   * 查询键只包含目标 Content Address、当前 Capability 与已解析的
   * SemanticRelease/SchemaSnapshot 发行事实；
   * 候选 PolicyReceipt 的 issuer、policy_version、AllowedSchema 和 MandatoryPredicate
   * 不会传入 resolver，resolver 必须返回完整的 content-addressed 发行修订。
   */
  resolveDeterministicPolicyReceiptIssuance?(
    input: Parameters<
      NonNullable<GroundingAuthorityVerificationContext["resolvePolicyReceiptIssuance"]>
    >[0],
    capability: AppCapability,
    client: SqlClient,
  ): Promise<unknown | null>;
  /** 解析由 Sandbox/EXPLAIN/Oracle 专用 Store 提交的非 L2 运行证据。 */
  resolveText2SqlSystemArtifact?(
    reference: ArtifactReference,
    capability: AppCapability,
    client: SqlClient,
  ): Promise<unknown | null>;
  verifyText2SqlSystemArtifactCommitted?(
    reference: ArtifactReference,
    capability: AppCapability,
    client: SqlClient,
  ): Promise<boolean>;
  verifyResourceAdmissionReceipt?(
    receipt: ResourceAdmissionReceipt,
    capability: AppCapability,
  ): Promise<boolean>;
  /** 按完整 Reference 解析已由独立 Fixture/Mutation Authority 品牌化的 Receipt。 */
  resolveAuthoritativeMetamorphicFixtureReceipt?(
    reference: ArtifactReference,
    capability: AppCapability,
    client: SqlClient,
  ): ReturnType<
    NonNullable<L2ArtifactPersistenceAuthority["resolveAuthoritativeMetamorphicFixtureReceipt"]>
  >;
  /** 按完整 Reference 解析已由独立 Metamorphic Verifier 品牌化的 Receipt。 */
  resolveAuthoritativeMetamorphicOracleReceipt?(
    reference: ArtifactReference,
    capability: AppCapability,
    client: SqlClient,
  ): ReturnType<
    NonNullable<L2ArtifactPersistenceAuthority["resolveAuthoritativeMetamorphicOracleReceipt"]>
  >;
  /** 按完整 Reference 解析已由独立 Result Producer 品牌化的 Receipt。 */
  resolveAuthoritativeResultOracleReceipt?(
    reference: ArtifactReference,
    metamorphic: AuthoritativeMetamorphicOracleReceipt,
    capability: AppCapability,
    client: SqlClient,
  ): ReturnType<
    NonNullable<L2ArtifactPersistenceAuthority["resolveAuthoritativeResultOracleReceipt"]>
  >;
  /** 解析由现有 Sandbox Server Authority 品牌化的执行 Receipt。 */
  resolveAuthoritativeSandboxExecutionReceipt?(
    reference: ArtifactReference,
    capability: AppCapability,
    client: SqlClient,
  ): ReturnType<
    NonNullable<L2ArtifactPersistenceAuthority["resolveAuthoritativeSandboxExecutionReceipt"]>
  >;
  /** 解析由现有 Sandbox Server Authority 品牌化的 Result。 */
  resolveAuthoritativeSandboxResult?(
    reference: ArtifactReference,
    capability: AppCapability,
    client: SqlClient,
  ): ReturnType<NonNullable<L2ArtifactPersistenceAuthority["resolveAuthoritativeSandboxResult"]>>;
}

async function resolveExactAuthoritativeRevision<T extends object>(
  expectedReferenceIdentity: string,
  resolution: Promise<T | null>,
  isAuthoritative: (value: unknown) => value is T,
  referenceOf: (value: T) => ArtifactReference,
): Promise<T | null> {
  const resolved = await resolution;
  if (
    !isAuthoritative(resolved) ||
    artifactReferenceIdentity(referenceOf(resolved)) !== expectedReferenceIdentity
  ) {
    return null;
  }
  return resolved;
}

/**
 * @internal
 *
 * 将 Platform 事务、Capability 与完整 ArtifactReference 绑定到不可克隆的领域品牌。
 * Resolver 返回 raw object、结构克隆或 Reference A/Payload B 时统一返回 null。
 */
export function createText2SqlBrandedReceiptAuthorityContext(
  client: SqlClient,
  capability: AppCapability,
  authorities: PostgresRepositoryAuthorities,
) {
  return {
    ...(authorities.resolveAuthoritativeMetamorphicFixtureReceipt
      ? {
          resolveAuthoritativeMetamorphicFixtureReceipt: async (reference: ArtifactReference) => {
            assertReferenceScope(reference, capability.scope);
            const expectedReferenceIdentity = artifactReferenceIdentity(reference);
            return resolveExactAuthoritativeRevision(
              expectedReferenceIdentity,
              authorities.resolveAuthoritativeMetamorphicFixtureReceipt?.(
                reference,
                capability,
                client,
              ) ?? Promise.resolve(null),
              isAuthoritativeMetamorphicFixtureReceipt,
              (receipt) => receipt.receipt_ref,
            );
          },
        }
      : {}),
    ...(authorities.resolveAuthoritativeMetamorphicOracleReceipt
      ? {
          resolveAuthoritativeMetamorphicOracleReceipt: async (reference: ArtifactReference) => {
            assertReferenceScope(reference, capability.scope);
            const expectedReferenceIdentity = artifactReferenceIdentity(reference);
            return resolveExactAuthoritativeRevision(
              expectedReferenceIdentity,
              authorities.resolveAuthoritativeMetamorphicOracleReceipt?.(
                reference,
                capability,
                client,
              ) ?? Promise.resolve(null),
              isAuthoritativeMetamorphicOracleReceipt,
              (receipt) => receipt.receipt_ref,
            );
          },
        }
      : {}),
    ...(authorities.resolveAuthoritativeResultOracleReceipt
      ? {
          resolveAuthoritativeResultOracleReceipt: async (
            reference: ArtifactReference,
            metamorphic: AuthoritativeMetamorphicOracleReceipt,
          ) => {
            assertReferenceScope(reference, capability.scope);
            assertReferenceScope(metamorphic.receipt_ref, capability.scope);
            const expectedReferenceIdentity = artifactReferenceIdentity(reference);
            return resolveExactAuthoritativeRevision(
              expectedReferenceIdentity,
              authorities.resolveAuthoritativeResultOracleReceipt?.(
                reference,
                metamorphic,
                capability,
                client,
              ) ?? Promise.resolve(null),
              isAuthoritativeResultOracleReceipt,
              (receipt) => receipt.receipt_ref,
            );
          },
        }
      : {}),
    ...(authorities.resolveAuthoritativeSandboxExecutionReceipt
      ? {
          resolveAuthoritativeSandboxExecutionReceipt: async (reference: ArtifactReference) => {
            assertReferenceScope(reference, capability.scope);
            const expectedReferenceIdentity = artifactReferenceIdentity(reference);
            return resolveExactAuthoritativeRevision(
              expectedReferenceIdentity,
              authorities.resolveAuthoritativeSandboxExecutionReceipt?.(
                reference,
                capability,
                client,
              ) ?? Promise.resolve(null),
              isAuthoritativeSandboxExecutionReceipt,
              (receipt) => receipt.receipt_ref,
            );
          },
        }
      : {}),
    ...(authorities.resolveAuthoritativeSandboxResult
      ? {
          resolveAuthoritativeSandboxResult: async (reference: ArtifactReference) => {
            assertReferenceScope(reference, capability.scope);
            const expectedReferenceIdentity = artifactReferenceIdentity(reference);
            return resolveExactAuthoritativeRevision(
              expectedReferenceIdentity,
              authorities.resolveAuthoritativeSandboxResult?.(reference, capability, client) ??
                Promise.resolve(null),
              isAuthoritativeSandboxResult,
              (result) => result.result_ref,
            );
          },
        }
      : {}),
  };
}

interface ArtifactRevisionCandidate<Reference extends ArtifactReference = ArtifactReference> {
  readonly reference: Reference;
  readonly document: unknown;
  readonly created_at: string;
  readonly declared_parent_ref: ArtifactReference | null | undefined;
  readonly input_refs: readonly ArtifactReference[];
}

function invalidInput<T>(message: string): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "PERSISTENCE_INPUT_INVALID",
      message,
      retryable: false,
    },
  };
}

function rawOwnDataValue(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor?.enumerable && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function isReservedResearchArtifactInput(input: unknown): boolean {
  const envelope = rawOwnDataValue(input, "envelope");
  const artifactType = rawOwnDataValue(envelope, "artifact_type");
  return typeof artifactType === "string" && reservedResearchArtifactTypes.has(artifactType);
}

function unsupportedResearchWire<T>(): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      message: "U6 Research Artifact 只能通过专用 PostgreSQL Research Authority 提交。",
      retryable: false,
    },
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function scopeValues(scope: {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
}): readonly [string, string, string] {
  return [scope.app_id, scope.tenant_id, scope.environment];
}

function assertReferenceScope(
  reference: ArtifactReference,
  scope: { readonly app_id: string; readonly tenant_id: string; readonly environment: string },
): void {
  if (
    reference.app_id !== scope.app_id ||
    reference.tenant_id !== scope.tenant_id ||
    reference.environment !== scope.environment
  ) {
    throw new PersistenceBoundaryError(
      "ARTIFACT_SCOPE_DENIED",
      "Artifact Reference 不属于当前 App/Tenant/Environment。",
    );
  }
}

async function referenceExists(
  client: SqlClient,
  reference: ArtifactReference,
  principalId: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1
     from artifacts as artifact
     join runs as run
       on run.app_id = artifact.app_id
      and run.tenant_id = artifact.tenant_id
      and run.environment = artifact.environment
      and run.run_id = artifact.run_id
     where artifact.app_id = $1
       and artifact.tenant_id = $2
       and artifact.environment = $3
       and artifact.run_id = $4
       and artifact.artifact_id = $5
       and artifact.artifact_type = $6
       and artifact.revision = $7
       and artifact.content_hash = $8
       and run.principal_id = $9`,
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

async function resolveArtifactDocument(
  client: SqlClient,
  reference: ArtifactReference,
  principalId: string,
): Promise<unknown | null> {
  const result = await client.query<ArtifactDocumentRow>(
    `select artifact.document_json
     from artifacts as artifact
     join runs as run
       on run.app_id = artifact.app_id
      and run.tenant_id = artifact.tenant_id
      and run.environment = artifact.environment
      and run.run_id = artifact.run_id
     where artifact.app_id = $1
       and artifact.tenant_id = $2
       and artifact.environment = $3
       and artifact.run_id = $4
       and artifact.artifact_id = $5
       and artifact.artifact_type = $6
       and artifact.revision = $7
       and artifact.content_hash = $8
       and run.principal_id = $9`,
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
  return result.rows[0]?.document_json ?? null;
}

function validateArtifactAncestry(
  candidate: ArtifactRevisionCandidate,
  expectedActiveRevision: number,
  active: ActiveArtifactRow | null,
): void {
  const declaredParent = candidate.declared_parent_ref;
  if (candidate.reference.revision !== expectedActiveRevision + 1) {
    throw new PersistenceBoundaryError(
      "ARTIFACT_REVISION_CONFLICT",
      "Artifact Revision 与调用方声明的 Active Revision 不连续。",
    );
  }

  if (expectedActiveRevision === 0) {
    if (active || (declaredParent !== null && declaredParent !== undefined)) {
      throw new PersistenceBoundaryError(
        "ARTIFACT_REVISION_CONFLICT",
        "首个 Artifact Revision 不能覆盖现有 Active Revision。",
      );
    }
    return;
  }

  if (
    !active ||
    active.revision !== expectedActiveRevision ||
    (declaredParent !== undefined &&
      (!declaredParent ||
        declaredParent.revision !== active.revision ||
        declaredParent.content_hash !== active.content_hash))
  ) {
    throw new PersistenceBoundaryError(
      "ARTIFACT_REVISION_CONFLICT",
      "Artifact Parent Reference 不匹配当前 Active Revision。",
    );
  }
}

function groundingAuthorityInputReferences(
  document: GroundingAuthorityDocument,
): readonly GroundingAuthorityReference[] {
  switch (document.artifact_type) {
    case "SemanticRelease":
    case "SchemaSnapshot":
      return [];
    case "PolicyReceipt":
      return [document.semantic_release_ref, document.schema_snapshot_ref];
  }
}

function assertGroundingAuthorityCommitIdentity(
  document: GroundingAuthorityDocument,
  capability: AppCapability,
): void {
  const violation = groundingAuthorityIdentityViolation(document, capability.principal);
  if (violation === null) return;
  if (violation === "POLICY_PRINCIPAL_MISMATCH") {
    throw new PersistenceBoundaryError(
      "GROUNDING_POLICY_PRINCIPAL_MISMATCH",
      "PolicyReceipt Principal 必须与事务 App Capability Principal 一致。",
    );
  }
  throw new PersistenceBoundaryError(
    "GROUNDING_AUTHORITY_IDENTITY_DENIED",
    "Grounding Authority Document 的受信 Producer/Authority Identity 不匹配。",
  );
}

function groundingAuthorityVerificationContext(
  client: SqlClient,
  capability: AppCapability,
  authorities: PostgresRepositoryAuthorities,
  pendingDocument?: GroundingAuthorityDocument,
): GroundingAuthorityVerificationContext {
  const pendingIdentity = pendingDocument
    ? artifactReferenceIdentity(pendingDocument.artifact_ref)
    : null;
  const committedByIdentity = new Map<string, Promise<boolean>>();
  const context: GroundingAuthorityVerificationContext = {
    principalId: capability.principal,
    requirePolicyReceiptIssuance: true,
    resolveCommitted: async (reference: GroundingAuthorityReference) => {
      assertReferenceScope(reference, capability.scope);
      if (artifactReferenceIdentity(reference) === pendingIdentity) {
        return pendingDocument ?? null;
      }
      const resolved = await resolveArtifactDocument(client, reference, capability.principal);
      const parsed = groundingAuthorityDocumentSchema.safeParse(resolved);
      if (parsed.success) {
        assertGroundingAuthorityCommitIdentity(parsed.data, capability);
      }
      return resolved;
    },
    verifyCommitted: async (reference: ArtifactReference) => {
      assertReferenceScope(reference, capability.scope);
      const identity = artifactReferenceIdentity(reference);
      if (identity === pendingIdentity) return true;
      const existing = committedByIdentity.get(identity);
      if (existing) return existing;
      const verification = referenceExists(client, reference, capability.principal);
      committedByIdentity.set(identity, verification);
      return verification;
    },
    ...(authorities.resolveDeterministicPolicyReceiptIssuance
      ? {
          resolvePolicyReceiptIssuance: (
            input: Parameters<
              NonNullable<GroundingAuthorityVerificationContext["resolvePolicyReceiptIssuance"]>
            >[0],
          ) =>
            authorities.resolveDeterministicPolicyReceiptIssuance?.(input, capability, client) ??
            Promise.resolve(null),
        }
      : {}),
  };
  return context;
}

function l2ArtifactVerificationContext(
  client: SqlClient,
  capability: AppCapability,
  document: L2ArtifactDocument,
  authorities: PostgresRepositoryAuthorities,
) {
  const candidateReference = artifactReferenceSchema.parse({
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  });
  const candidateIdentity = artifactReferenceIdentity(candidateReference);

  return {
    principalId: capability.principal,
    verifyCommitted: async (reference: ArtifactReference) => {
      assertReferenceScope(reference, capability.scope);
      return artifactReferenceIdentity(reference) === candidateIdentity
        ? true
        : referenceExists(client, reference, capability.principal);
    },
    resolveL2: async (reference: ArtifactReference) => {
      assertReferenceScope(reference, capability.scope);
      return artifactReferenceIdentity(reference) === candidateIdentity
        ? document
        : resolveArtifactDocument(client, reference, capability.principal);
    },
    resolveGroundingAuthority: async (reference: GroundingAuthorityReference) => {
      assertReferenceScope(reference, capability.scope);
      return verifyGroundingAuthorityDocument(
        reference,
        groundingAuthorityVerificationContext(client, capability, authorities),
      );
    },
    ...(authorities.resolveText2SqlSystemArtifact
      ? {
          resolveSystemArtifact: (reference: ArtifactReference) => {
            assertReferenceScope(reference, capability.scope);
            return (
              authorities.resolveText2SqlSystemArtifact?.(reference, capability, client) ??
              Promise.resolve(null)
            );
          },
        }
      : {}),
    ...(authorities.verifyText2SqlSystemArtifactCommitted
      ? {
          verifySystemArtifactCommitted: (reference: ArtifactReference) => {
            assertReferenceScope(reference, capability.scope);
            return (
              authorities.verifyText2SqlSystemArtifactCommitted?.(reference, capability, client) ??
              Promise.resolve(false)
            );
          },
        }
      : {}),
    ...(authorities.verifySqlArtifactCompilation
      ? {
          verifySqlArtifactCompilation: (
            input: Parameters<
              NonNullable<PostgresRepositoryAuthorities["verifySqlArtifactCompilation"]>
            >[0],
          ) =>
            authorities.verifySqlArtifactCompilation?.(input, capability) ?? Promise.resolve(false),
        }
      : {}),
    ...(authorities.verifyResourceAdmissionReceipt
      ? {
          verifyResourceAdmissionReceipt: (receipt: ResourceAdmissionReceipt) =>
            authorities.verifyResourceAdmissionReceipt?.(receipt, capability) ??
            Promise.resolve(false),
        }
      : {}),
    ...createText2SqlBrandedReceiptAuthorityContext(client, capability, authorities),
    verifyCommitterCapability: async (claim: ArtifactCommitterCapabilityClaim) => {
      if (
        claim.app_id !== capability.scope.app_id ||
        claim.tenant_id !== capability.scope.tenant_id ||
        claim.environment !== capability.scope.environment ||
        claim.run_id !== document.envelope.run_id
      ) {
        return false;
      }
      return (await authorities.verifyL2ArtifactCommitterCapability?.(claim, capability)) ?? false;
    },
  };
}

export function createPostgresRepository(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
  authorities: PostgresRepositoryAuthorities = {},
) {
  async function commitArtifactRevision<Reference extends ArtifactReference>(
    capabilityInput: unknown,
    candidate: ArtifactRevisionCandidate<Reference>,
    options: z.infer<typeof artifactCommitOptionsSchema>,
    transactionPolicy: Readonly<{
      allowed_roles?: readonly ["OWNER"];
      validate_document?: (capability: AppCapability, client: SqlClient) => void | Promise<void>;
      verify_input_reference?: (
        reference: ArtifactReference,
        capability: AppCapability,
        client: SqlClient,
      ) => boolean | Promise<boolean>;
    }> = {},
  ): Promise<PortResult<Reference>> {
    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      {
        access: "WRITE",
        ...(transactionPolicy.allowed_roles
          ? { allowed_roles: transactionPolicy.allowed_roles }
          : {}),
      },
      async ({ capability, client }) => {
        assertReferenceScope(candidate.reference, capability.scope);
        await transactionPolicy.validate_document?.(capability, client);

        const run = await client.query<FenceRow>(
          `select app_data_agent.lock_owned_run_fence(
             $1::uuid
           ) as active_fence`,
          [candidate.reference.run_id],
        );
        const activeFence = run.rows[0]?.active_fence;
        if (activeFence === undefined || activeFence === null) {
          throw new PersistenceBoundaryError(
            "RUN_NOT_FOUND_OR_DENIED",
            "Artifact 所属 Run 不存在或不属于当前 Principal。",
          );
        }
        if (BigInt(activeFence) !== BigInt(options.worker_fence)) {
          throw new PersistenceBoundaryError(
            "WORKER_FENCE_STALE",
            "Worker Fence 已过期，迟到结果不能覆盖当前 Artifact Revision。",
          );
        }

        const activeResult = await client.query<ActiveArtifactRow>(
          `select revision, content_hash
           from artifacts
           where app_id = $1
             and tenant_id = $2
             and environment = $3
             and run_id = $4
             and artifact_id = $5
             and artifact_type = $6
             and is_active = true
           for update`,
          [
            ...scopeValues(capability.scope),
            candidate.reference.run_id,
            candidate.reference.artifact_id,
            candidate.reference.artifact_type,
          ],
        );
        const active = activeResult.rows[0] ?? null;
        validateArtifactAncestry(candidate, options.expected_active_revision, active);

        for (const inputReference of candidate.input_refs) {
          assertReferenceScope(inputReference, capability.scope);
          const inputCommitted = transactionPolicy.verify_input_reference
            ? await transactionPolicy.verify_input_reference(inputReference, capability, client)
            : await referenceExists(client, inputReference, capability.principal);
          if (!inputCommitted) {
            throw new PersistenceBoundaryError(
              "ARTIFACT_INPUT_NOT_COMMITTED",
              "Artifact 引用了尚未持久提交的 Parent 或 Input Revision。",
            );
          }
        }

        if (active) {
          await client.query(
            `update artifacts
             set is_active = false
             where app_id = $1
               and tenant_id = $2
               and environment = $3
               and run_id = $4
               and artifact_id = $5
               and artifact_type = $6
               and revision = $7
               and is_active = true`,
            [
              ...scopeValues(capability.scope),
              candidate.reference.run_id,
              candidate.reference.artifact_id,
              candidate.reference.artifact_type,
              active.revision,
            ],
          );
        }

        const persistedParent =
          candidate.declared_parent_ref === undefined ? active : candidate.declared_parent_ref;
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
             parent_content_hash,
             created_at
           )
           values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, true, $11, $12, $13
           )`,
          [
            ...scopeValues(capability.scope),
            candidate.reference.run_id,
            candidate.reference.artifact_id,
            candidate.reference.artifact_type,
            candidate.reference.revision,
            candidate.reference.content_hash,
            canonicalizeJson(candidate.document),
            options.worker_fence,
            persistedParent?.revision ?? null,
            persistedParent?.content_hash ?? null,
            candidate.created_at,
          ],
        );
        return candidate.reference;
      },
    );
  }

  return {
    async acceptCommand(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<CommandAcceptance>> {
      const parsed = commandInputSchema.safeParse(input);
      if (!parsed.success) return invalidInput("Run Command 输入不符合持久化契约。");
      if (
        containsPotentialPlaintextSecret(parsed.data.question) ||
        containsPotentialPlaintextSecret(parsed.data.payload)
      ) {
        return invalidInput(
          "Run Command 的 Question/Payload 只能引用 SecretRef，不能包含疑似明文 Credential。",
        );
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", map_database_error: mapDatabaseRuntimeFailure },
        async ({ capability, client }) => {
          if (!uuid.safeParse(capability.principal).success) {
            throw new PersistenceBoundaryError(
              "PERSISTENCE_PRINCIPAL_INVALID",
              "Supabase Auth Principal 必须是服务端解析的 UUID。",
            );
          }

          const canonicalPayload = canonicalizeJson(parsed.data.payload);
          const canonicalHash = await client.query<CanonicalPayloadHashRow>(
            "select platform.canonical_sha256($1::jsonb) as payload_hash",
            [canonicalPayload],
          );
          const payloadHash = canonicalHash.rows[0]?.payload_hash;
          if (
            canonicalHash.rowCount !== 1 ||
            !payloadHash ||
            !/^sha256:[a-f0-9]{64}$/.test(payloadHash)
          ) {
            throw new PersistenceBoundaryError(
              "PERSISTENCE_CANONICAL_HASH_INVALID",
              "PostgreSQL 未返回有效的 Canonical Payload Hash。",
            );
          }
          const initialEvent = runRuntimeEventSchema.parse({
            schema_version: "1.0.0",
            event_id: parsed.data.event_id,
            scope: capability.scope,
            run_id: parsed.data.run_id,
            sequence: 1,
            worker_fence: 0,
            idempotency_key: `event:${parsed.data.event_id}`,
            occurred_at: new Date().toISOString(),
            event_type: "run.accepted",
            payload: {
              command_id: parsed.data.command_id,
              payload_hash: payloadHash,
            },
          });
          const initialEventHash = await sha256ContentHash(initialEvent);

          const accepted = await client.query<JsonResultRow>(
            `select app_data_agent.accept_backend_run_command(
               $1::jsonb, $2::text, $3::jsonb, $4::text
             ) as result`,
            [
              canonicalizeJson(parsed.data),
              payloadHash,
              canonicalizeJson(initialEvent),
              initialEventHash,
            ],
          );
          const result = z
            .strictObject({
              created: z.boolean(),
              run_id: uuid,
              command_id: uuid,
              outbox_id: uuid,
              payload_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            })
            .safeParse(accepted.rows[0]?.result);
          if (
            !result.success ||
            result.data.run_id !== parsed.data.run_id ||
            result.data.command_id !== parsed.data.command_id ||
            (result.data.created && result.data.outbox_id !== parsed.data.outbox_id) ||
            result.data.payload_hash !== payloadHash
          ) {
            throw new PersistenceBoundaryError(
              "PERSISTENCE_DATABASE_CONTRACT_INVALID",
              "PostgreSQL 返回的 Command Acceptance 与请求不一致。",
            );
          }
          if (parsed.data.payload.datasource_id) {
            const binding = await client.query<{
              readonly datasource_id: string;
              readonly conversation_id: string | null;
              readonly principal_id: string;
            }>(
              `insert into workspace_run_bindings (
                 app_id, tenant_id, environment, run_id, datasource_id,
                 conversation_id, principal_id
               ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::uuid, $7::uuid)
               on conflict (app_id, tenant_id, environment, run_id) do nothing
               returning datasource_id, conversation_id, principal_id`,
              [
                capability.scope.app_id,
                capability.scope.tenant_id,
                capability.scope.environment,
                parsed.data.run_id,
                parsed.data.payload.datasource_id,
                parsed.data.payload.conversation_id ?? null,
                capability.principal,
              ],
            );
            const persistedBinding =
              binding.rows[0] ??
              (
                await client.query<{
                  readonly datasource_id: string;
                  readonly conversation_id: string | null;
                  readonly principal_id: string;
                }>(
                  `select datasource_id, conversation_id, principal_id
                   from workspace_run_bindings
                   where run_id = $1::uuid`,
                  [parsed.data.run_id],
                )
              ).rows[0];
            if (
              !persistedBinding ||
              persistedBinding.datasource_id !== parsed.data.payload.datasource_id ||
              persistedBinding.conversation_id !== (parsed.data.payload.conversation_id ?? null) ||
              persistedBinding.principal_id !== capability.principal
            ) {
              throw new PersistenceBoundaryError(
                "RUN_DATASOURCE_BINDING_INVALID",
                "Run 的数据源与对话归因不一致。",
              );
            }
          }
          return result.data;
        },
      );
    },

    async getRun(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedRun | null>> {
      const parsed = runLookupSchema.safeParse(input);
      if (!parsed.success) return invalidInput("Run Lookup 输入不符合持久化契约。");

      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ" },
        async ({ capability, client }) => {
          const result = await client.query<RunRow>(
            `select
               run.app_id,
               run.tenant_id,
               run.environment,
               run.run_id,
               run.principal_id,
               coalesce(projection.status, run.status) as status,
               run.active_fence,
               run.question,
               run.created_at,
               run.updated_at
             from runs as run
             left join lateral (
               select candidate.status
               from run_projections as candidate
               where candidate.app_id = run.app_id
                 and candidate.tenant_id = run.tenant_id
                 and candidate.environment = run.environment
                 and candidate.run_id = run.run_id
               order by candidate.version desc
               limit 1
             ) as projection on true
             where run.app_id = $1
               and run.tenant_id = $2
               and run.environment = $3
               and run.run_id = $4
               and run.principal_id = $5`,
            [...scopeValues(capability.scope), parsed.data.run_id, capability.principal],
          );
          const row = result.rows[0];
          return row
            ? {
                ...row,
                active_fence: Number(row.active_fence),
                created_at: iso(row.created_at),
                updated_at: iso(row.updated_at),
              }
            : null;
        },
      );
    },

    async commitL2Artifact(
      capabilityInput: unknown,
      documentInput: unknown,
      optionsInput: unknown,
    ): Promise<PortResult<ArtifactReference>> {
      if (isReservedResearchArtifactInput(documentInput)) {
        return unsupportedResearchWire();
      }
      const parsedDocument = l2ArtifactDocumentSchema.safeParse(documentInput);
      const parsedOptions = artifactCommitOptionsSchema.safeParse(optionsInput);
      if (!parsedDocument.success || !parsedOptions.success) {
        return invalidInput("Artifact Commit 输入不符合 L2 Artifact/Revision 契约。");
      }
      const document = parsedDocument.data;
      if (containsPotentialPlaintextSecret(document)) {
        return invalidInput("Artifact 不能持久化疑似明文 Credential。");
      }
      if (document.envelope.status !== "COMMITTED") {
        return invalidInput("Persistence Authority 只接受 COMMITTED Artifact Revision。");
      }
      const computedHash = await computeL2ArtifactContentHash(document);
      if (computedHash !== document.envelope.content_hash) {
        return invalidInput("Artifact Content Hash 与规范化内容不一致。");
      }

      const reference = artifactReferenceSchema.parse({
        artifact_id: document.envelope.artifact_id,
        artifact_type: document.envelope.artifact_type,
        app_id: document.envelope.app_id,
        tenant_id: document.envelope.tenant_id,
        environment: document.envelope.environment,
        run_id: document.envelope.run_id,
        revision: document.envelope.revision,
        content_hash: document.envelope.content_hash,
      });

      return commitArtifactRevision(
        capabilityInput,
        {
          reference,
          document,
          created_at: document.envelope.created_at,
          declared_parent_ref: document.envelope.parent_ref,
          input_refs: [
            ...(document.envelope.parent_ref ? [document.envelope.parent_ref] : []),
            ...document.envelope.input_refs,
          ],
        },
        parsedOptions.data,
        {
          validate_document: async (capability, client) => {
            try {
              await verifyL2ArtifactDocument(
                document,
                l2ArtifactVerificationContext(client, capability, document, authorities),
              );
            } catch (error) {
              if (
                error instanceof ArtifactAuthorityError ||
                error instanceof ArtifactInputAuthorityError ||
                error instanceof ArtifactIntegrityError ||
                error instanceof ArtifactSemanticAuthorityError
              ) {
                throw new PersistenceBoundaryError(
                  "L2_ARTIFACT_AUTHORITY_INVALID",
                  "L2 Artifact 未通过当前事务的提交者、输入与语义权威校验。",
                );
              }
              throw error;
            }
          },
          verify_input_reference: async (reference, capability, client) => {
            if (!text2SqlRuntimeSystemArtifactTypes.has(reference.artifact_type)) {
              return referenceExists(client, reference, capability.principal);
            }
            return (
              authorities.verifyText2SqlSystemArtifactCommitted?.(reference, capability, client) ??
              Promise.resolve(false)
            );
          },
        },
      );
    },

    async commitGroundingAuthorityArtifact(
      capabilityInput: unknown,
      documentInput: unknown,
      optionsInput: unknown,
    ): Promise<PortResult<GroundingAuthorityReference>> {
      const parsedDocument = groundingAuthorityDocumentSchema.safeParse(documentInput);
      const parsedOptions = artifactCommitOptionsSchema.safeParse(optionsInput);
      if (!parsedDocument.success || !parsedOptions.success) {
        return invalidInput(
          "Grounding Authority Commit 输入不符合 System Artifact/Revision 契约。",
        );
      }
      const document = parsedDocument.data;
      if (containsPotentialPlaintextSecret(document)) {
        return invalidInput("Grounding Authority Artifact 不能持久化疑似明文 Credential。");
      }
      if ((await computeGroundingAuthorityDocumentHash(document)) !== document.document_hash) {
        return invalidInput("Grounding Authority Content Hash 与规范化内容不一致。");
      }

      return commitArtifactRevision(
        capabilityInput,
        {
          reference: document.artifact_ref,
          document,
          created_at: document.created_at,
          declared_parent_ref: document.parent_ref,
          input_refs: [
            ...(document.parent_ref ? [document.parent_ref] : []),
            ...groundingAuthorityInputReferences(document),
          ],
        },
        parsedOptions.data,
        {
          allowed_roles: ["OWNER"],
          validate_document: async (capability, client) => {
            assertGroundingAuthorityCommitIdentity(document, capability);
            try {
              await verifyGroundingAuthorityDocument(
                document.artifact_ref,
                groundingAuthorityVerificationContext(client, capability, authorities, document),
              );
            } catch (error) {
              if (error instanceof GroundingAuthorityError) {
                throw new PersistenceBoundaryError(
                  error.code,
                  "Grounding Authority Artifact 与服务端发行事实或已提交上游不一致。",
                );
              }
              throw error;
            }
          },
        },
      );
    },

    async verifyCommitted(
      capabilityInput: unknown,
      referenceInput: unknown,
    ): Promise<PortResult<boolean>> {
      const parsed = artifactReferenceSchema.safeParse(referenceInput);
      if (!parsed.success) return invalidInput("Artifact Reference 不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ" },
        async ({ capability, client }) => {
          assertReferenceScope(parsed.data, capability.scope);
          return referenceExists(client, parsed.data, capability.principal);
        },
      );
    },

    async resolveArtifact(
      capabilityInput: unknown,
      referenceInput: unknown,
    ): Promise<PortResult<unknown | null>> {
      const parsed = artifactReferenceSchema.safeParse(referenceInput);
      if (!parsed.success) return invalidInput("Artifact Reference 不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ" },
        async ({ capability, client }) => {
          assertReferenceScope(parsed.data, capability.scope);
          return resolveArtifactDocument(client, parsed.data, capability.principal);
        },
      );
    },

    async resolveGroundingAuthorityArtifact(
      capabilityInput: unknown,
      referenceInput: unknown,
    ): Promise<PortResult<GroundingAuthorityDocument | null>> {
      const parsed = groundingAuthorityReferenceSchema.safeParse(referenceInput);
      if (!parsed.success) {
        return invalidInput("Grounding Authority Reference 不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ" },
        async ({ capability, client }) => {
          assertReferenceScope(parsed.data, capability.scope);

          try {
            const verification = groundingAuthorityVerificationContext(
              client,
              capability,
              authorities,
            );
            const root = await verification.resolveCommitted(parsed.data);
            if (root === null) return null;
            const rootIdentity = artifactReferenceIdentity(parsed.data);
            return await verifyGroundingAuthorityDocument(parsed.data, {
              ...verification,
              resolveCommitted: async (reference) =>
                artifactReferenceIdentity(reference) === rootIdentity
                  ? root
                  : verification.resolveCommitted(reference),
            });
          } catch (error) {
            if (error instanceof GroundingAuthorityError) {
              throw new PersistenceBoundaryError(
                error.code,
                "Grounding Authority Document 未通过持久化与内容寻址授权。",
              );
            }
            throw error;
          }
        },
      );
    },
  };
}
