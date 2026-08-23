import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  type ArtifactReference,
  AUTHORITY_ROLE_POLICY_VERSION,
  type AuthorityIdentity,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  authorityIdentitySchema,
  type ContentHash,
  canonicalizeJson,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  contentHashSchema,
  deepFreeze,
  l2ArtifactDocumentSchema,
  type ResolvedContextText2SqlBinding,
  sandboxAuthorityRevalidationSchema,
  sandboxExecutionRequestSchema,
  sandboxResultSchema,
  sha256ContentHash,
  successfulSandboxExecutionReceiptSchema,
} from "@data-agent/contracts";
import {
  computeExecutionGrantHash,
  executionGrantSchema,
  registerSandboxServerAuthority,
  SandboxExecutionAuthorityError,
  type SandboxExecutionAuthorityReasonCode,
  type SandboxExecutionAuthorityStore,
  type SandboxExecutionCancelRequest,
  type SandboxExecutionClaim,
  type SandboxExecutionImmutableIdentity,
  type SandboxExecutionOutcome,
  type SandboxExecutionRecoveryRequest,
  type SandboxServerAuthority,
  type SnapshotDescriptor,
  sandboxExecutionAuthorityReasonCodeSchema,
  sandboxExecutionClaimSchema,
  sandboxExecutionImmutableIdentitySchema,
  sandboxExecutionOutcomeSchema,
  sandboxExecutionPermitBindingSchema,
  sandboxExecutionPrepareResultSchema,
  sandboxExecutionTransitionResultSchema,
  sandboxSqlArtifactBindingSchema,
  snapshotDescriptorSchema,
} from "@data-agent/contracts/server";
import { z } from "zod";
import {
  type SqlClient,
  type SqlPool,
  type SqlQueryResult,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { AppCapability } from "../tenancy/capability.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";
import {
  assertPostgresqlSandboxSqlPolicy,
  PostgresqlSandboxSqlPolicyError,
} from "./postgresql-sql-policy.internal.js";

const stableOwnerId = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const authorityResultVersion = "sandbox-execution-authority-result@1.0.0" as const;
const supportedPostgresqlCompilerVersion = "postgresql-compiler@1.1.0";

const databaseTimestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );

const persistedPreparationSchema = z.strictObject({
  request: sandboxExecutionRequestSchema,
  permit: sandboxExecutionPermitBindingSchema,
  sql_artifact: sandboxSqlArtifactBindingSchema,
  authority_revalidation: sandboxAuthorityRevalidationSchema,
});

const snapshotRelationManifestSchema = z.strictObject({
  snapshot_descriptor_hash: contentHashSchema,
  sealed_schema: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/)
    .nullable(),
  allowed_relations: z.array(
    z.strictObject({
      schema_name: z
        .string()
        .min(1)
        .max(63)
        .regex(/^[a-z][a-z0-9_]*$/),
      relation_name: z
        .string()
        .min(1)
        .max(63)
        .regex(/^[a-z][a-z0-9_]*$/),
    }),
  ),
});

type SnapshotRelationManifest = z.infer<typeof snapshotRelationManifestSchema>;

const databaseClaimSchema = z.object({
  scope: z
    .strictObject({
      app_id: z.uuid(),
      tenant_id: z.uuid(),
      environment: z.string().min(1).max(64),
    })
    .optional(),
  run_id: z.uuid().optional(),
  principal_id: z.string().min(1).max(256).optional(),
  idempotency_key: z.string().min(1).max(256).optional(),
  input_hash: contentHashSchema.optional(),
  execution_id: z.uuid().optional(),
  state: z.enum([
    "CLAIMED",
    "EXECUTING",
    "CANCEL_REQUESTED",
    "FAILED",
    "COMPLETED",
    "RECOVERY_PENDING",
    "CANCELLED",
    "REPLAY_UNAVAILABLE",
  ]),
  branch_version: z.coerce.number().int().positive(),
  attempt_id: z.uuid(),
  attempt: z.coerce.number().int().positive(),
  owner_id: z.string().regex(stableOwnerId),
  fencing_token: z.coerce.number().int().positive(),
  lease_id: z.uuid().nullable(),
  lease_expires_at: databaseTimestampSchema.nullable(),
  cancel_epoch: z.coerce.number().int().nonnegative(),
  cancel_requested_at: databaseTimestampSchema.nullable().optional(),
  grant_hash: contentHashSchema.nullable().optional(),
  grant_cancel_epoch: z.coerce.number().int().nonnegative().nullable().optional(),
  snapshot_descriptor: snapshotDescriptorSchema.nullable().optional(),
  result_ref: artifactReferenceSchema.nullable().optional(),
  receipt_ref: artifactReferenceSchema.nullable().optional(),
  terminal_reason_code: z.string().nullable().optional(),
  recovery_deadline: databaseTimestampSchema.nullable().optional(),
  updated_at: databaseTimestampSchema.optional(),
  request_json: z.unknown().optional(),
});

type DatabaseClaim = z.infer<typeof databaseClaimSchema>;

const databaseClaimResultSchema = z.strictObject({
  disposition: z.enum([
    "ACCEPTED",
    "REPLAYED",
    "IN_PROGRESS",
    "CANCEL_ACCEPTED",
    "CANCEL_ALREADY_TERMINAL",
    "REPLAY_UNAVAILABLE",
  ]),
  claim: databaseClaimSchema,
  cancel_disposition: z.string().optional(),
});

const databaseClaimRowSchema = z.object({
  app_id: z.uuid(),
  tenant_id: z.uuid(),
  environment: z.string().min(1).max(64),
  run_id: z.uuid(),
  principal_id: z.string().min(1).max(256),
  idempotency_key: z.string().min(1).max(256),
  execution_id: z.uuid(),
  input_hash: contentHashSchema,
  request_json: z.unknown(),
  state: databaseClaimSchema.shape.state,
  branch_version: z.coerce.number().int().positive(),
  attempt_id: z.uuid(),
  attempt_sequence: z.coerce.number().int().positive(),
  owner_id: z.string().regex(stableOwnerId),
  fence: z.coerce.number().int().positive(),
  lease_id: z.uuid().nullable(),
  lease_expires_at: databaseTimestampSchema.nullable(),
  cancel_epoch: z.coerce.number().int().nonnegative(),
  cancel_requested_at: databaseTimestampSchema.nullable(),
  grant_hash: contentHashSchema.nullable(),
  grant_cancel_epoch: z.coerce.number().int().nonnegative().nullable(),
  snapshot_descriptor_json: snapshotDescriptorSchema.nullable(),
  result_ref: artifactReferenceSchema.nullable(),
  receipt_ref: artifactReferenceSchema.nullable(),
  terminal_reason_code: z.string().nullable(),
  recovery_deadline: databaseTimestampSchema.nullable(),
  updated_at: databaseTimestampSchema,
});

interface JsonValueRow {
  readonly value: unknown;
}

interface DocumentRow {
  readonly document_json: unknown;
}

interface SystemArtifactRow {
  readonly value: unknown;
}

interface TransactionContext {
  readonly client: SqlClient;
  readonly capability: AppCapability;
}

export interface PostgresText2SqlSandboxAuthorityOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: unknown;
  readonly identity: AuthorityIdentity;
  readonly owner_id: string;
  readonly snapshot_descriptors: readonly unknown[];
  /**
   * Server-owned physical-relation allowlists, sealed one-for-one to the
   * descriptor hash. They are deliberately not derived from request SQL.
   */
  readonly snapshot_relation_manifests: readonly unknown[];
  readonly require_resolved_context_binding?: boolean;
  readonly resolved_context_binding_authority?: Readonly<{
    verify(input: {
      readonly binding: ResolvedContextText2SqlBinding;
      readonly scope: AppCapability["scope"];
      readonly run_id: string;
      readonly sql_artifact_ref: ArtifactReference;
    }): Promise<boolean>;
  }>;
  readonly lease_duration_ms?: number;
  readonly now?: () => Date;
}

function canonicalHashSync(value: unknown): ContentHash {
  return contentHashSchema.parse(
    `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}`,
  ) as ContentHash;
}

function snapshotDescriptorMaterial(descriptor: SnapshotDescriptor): unknown {
  const { descriptor_hash: _descriptorHash, ...material } = descriptor;
  return material;
}

function snapshotIdentityKey(input: {
  readonly scope_hash: string;
  readonly run_id: string;
  readonly execution_id: string;
  readonly principal_id: string;
  readonly datasource_id: string;
  readonly schema_version: string;
}): string {
  return canonicalizeJson([
    input.scope_hash,
    input.run_id,
    input.execution_id,
    input.principal_id,
    input.datasource_id,
    input.schema_version,
  ]);
}

function referenceValues(reference: ArtifactReference, principalId: string): readonly unknown[] {
  return [
    reference.app_id,
    reference.tenant_id,
    reference.environment,
    reference.run_id,
    reference.artifact_id,
    reference.artifact_type,
    reference.revision,
    reference.content_hash,
    principalId,
  ];
}

function markerOf(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "";
}

function markerReasonCode(marker: string): SandboxExecutionAuthorityReasonCode | null {
  switch (marker) {
    case "SANDBOX_IDEMPOTENCY_CONFLICT":
      return "SANDBOX_IDEMPOTENCY_CONFLICT";
    case "SANDBOX_STALE_FENCE":
    case "SANDBOX_CLAIM_CAS_MISMATCH":
      return "SANDBOX_STALE_EXECUTION_FENCE";
    case "SANDBOX_OUTCOME_BINDING_MISMATCH":
    case "SANDBOX_OUTCOME_INVALID":
    case "SANDBOX_GRANT_INVALID":
      return "SANDBOX_OUTCOME_BINDING_MISMATCH";
    case "SANDBOX_SNAPSHOT_AUTHORITY_BREACH":
      return "SANDBOX_SNAPSHOT_AUTHORITY_BREACH";
    case "SANDBOX_UNSUPPORTED_RESULT_TYPE":
      return "SANDBOX_UNSUPPORTED_RESULT_TYPE";
    case "SANDBOX_CLAIM_NOT_FOUND":
    case "SANDBOX_SCOPE_FORBIDDEN":
    case "SANDBOX_COMMAND_INVALID":
    case "SANDBOX_FINALIZE_ARTIFACTS_INVALID":
    case "SANDBOX_FINALIZE_NOT_COMPLETED":
    case "SANDBOX_FAILURE_INVALID":
      return "SANDBOX_AUTHORITY_REJECTED";
    default:
      return null;
  }
}

function authorityFailure(error: unknown): never {
  if (error instanceof SandboxExecutionAuthorityError) throw error;
  const marker = markerOf(error);
  const code = markerReasonCode(marker);
  if (code) {
    throw new SandboxExecutionAuthorityError(`PostgreSQL Sandbox Authority 拒绝：${marker}`, code);
  }
  throw error;
}

async function queryAuthority<Row extends object>(
  client: SqlClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<SqlQueryResult<Row>> {
  try {
    return await client.query<Row>(text, values);
  } catch (error) {
    authorityFailure(error);
  }
}

function transitionReason(
  disposition: z.infer<typeof databaseClaimResultSchema>["disposition"],
  claim: SandboxExecutionClaim,
): SandboxExecutionAuthorityReasonCode {
  switch (disposition) {
    case "REPLAYED":
      return "SANDBOX_EXECUTION_COMPLETED";
    case "IN_PROGRESS":
      return "SANDBOX_EXECUTION_IN_PROGRESS";
    case "CANCEL_ACCEPTED":
    case "CANCEL_ALREADY_TERMINAL":
      return claim.terminal_reason_code === "SANDBOX_CANCEL_UNCONFIRMED"
        ? "SANDBOX_CANCEL_UNCONFIRMED"
        : "SANDBOX_CANCELLED";
    case "REPLAY_UNAVAILABLE":
      return "SANDBOX_REPLAY_UNAVAILABLE";
    case "ACCEPTED":
      return claim.terminal_reason_code ?? "SANDBOX_EXECUTION_IN_PROGRESS";
  }
}

function toContractClaim(
  rawInput: unknown,
  identity: SandboxExecutionImmutableIdentity,
  fallbackUpdatedAt: string,
): SandboxExecutionClaim {
  const raw = databaseClaimSchema.parse(rawInput);
  const terminalReason =
    raw.state === "COMPLETED"
      ? "SANDBOX_EXECUTION_COMPLETED"
      : raw.state === "REPLAY_UNAVAILABLE"
        ? "SANDBOX_REPLAY_UNAVAILABLE"
        : raw.terminal_reason_code;
  return sandboxExecutionClaimSchema.parse({
    identity,
    state: raw.state,
    attempt_id: raw.attempt_id,
    attempt: raw.attempt,
    fencing_token: raw.fencing_token,
    lease_id: raw.lease_id,
    lease_expires_at: raw.lease_expires_at,
    cancel_epoch: raw.cancel_epoch,
    grant_cancel_epoch: raw.grant_cancel_epoch ?? raw.cancel_epoch,
    cancel_requested_at: raw.cancel_requested_at ?? null,
    recovery_deadline: raw.recovery_deadline ?? null,
    snapshot_descriptor: raw.snapshot_descriptor ?? null,
    grant_hash: raw.grant_hash ?? null,
    result_ref: raw.result_ref ?? null,
    receipt_ref: raw.receipt_ref ?? null,
    terminal_reason_code: terminalReason,
    updated_at: raw.updated_at ?? fallbackUpdatedAt,
  });
}

function rawRowToDatabaseClaim(rowInput: unknown): DatabaseClaim {
  const row = databaseClaimRowSchema.parse(rowInput);
  return databaseClaimSchema.parse({
    scope: {
      app_id: row.app_id,
      tenant_id: row.tenant_id,
      environment: row.environment,
    },
    run_id: row.run_id,
    principal_id: row.principal_id,
    idempotency_key: row.idempotency_key,
    input_hash: row.input_hash,
    execution_id: row.execution_id,
    state: row.state,
    branch_version: row.branch_version,
    attempt_id: row.attempt_id,
    attempt: row.attempt_sequence,
    owner_id: row.owner_id,
    fencing_token: row.fence,
    lease_id: row.lease_id,
    lease_expires_at: row.lease_expires_at,
    cancel_epoch: row.cancel_epoch,
    cancel_requested_at: row.cancel_requested_at,
    grant_hash: row.grant_hash,
    grant_cancel_epoch: row.grant_cancel_epoch,
    snapshot_descriptor: row.snapshot_descriptor_json,
    result_ref: row.result_ref,
    receipt_ref: row.receipt_ref,
    terminal_reason_code: row.terminal_reason_code,
    recovery_deadline: row.recovery_deadline,
    updated_at: row.updated_at,
    request_json: row.request_json,
  });
}

function claimCommandIdentity(identity: SandboxExecutionImmutableIdentity) {
  return {
    scope: identity.scope,
    run_id: identity.run_id,
    principal_id: identity.principal_id,
    idempotency_key: identity.idempotency_key,
    execution_id: identity.execution_id,
    input_hash: identity.input_hash,
  };
}

async function assertSandboxSqlPolicy(input: {
  readonly sql: string;
  readonly allowed_relations?: SnapshotRelationManifest["allowed_relations"];
}): Promise<void> {
  try {
    await assertPostgresqlSandboxSqlPolicy(input);
  } catch (error) {
    if (error instanceof PostgresqlSandboxSqlPolicyError) {
      throw new SandboxExecutionAuthorityError(error.message, error.code);
    }
    throw error;
  }
}

export function createPostgresText2SqlSandboxAuthority(
  options: PostgresText2SqlSandboxAuthorityOptions,
): SandboxServerAuthority {
  const identity = authorityIdentitySchema.parse(options.identity);
  if (!stableOwnerId.test(options.owner_id)) {
    throw new TypeError("SANDBOX_OWNER_ID_INVALID");
  }
  const leaseDurationMs = options.lease_duration_ms ?? 30_000;
  if (
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1_000 ||
    leaseDurationMs > 300_000
  ) {
    throw new TypeError("SANDBOX_LEASE_DURATION_INVALID");
  }
  const snapshotDescriptors = new Map<string, SnapshotDescriptor>();
  const snapshotDescriptorsByHash = new Map<string, SnapshotDescriptor>();
  for (const candidate of options.snapshot_descriptors) {
    const descriptor = snapshotDescriptorSchema.parse(candidate);
    if (canonicalHashSync(snapshotDescriptorMaterial(descriptor)) !== descriptor.descriptor_hash) {
      throw new TypeError("SANDBOX_SNAPSHOT_DESCRIPTOR_HASH_INVALID");
    }
    const key = snapshotIdentityKey(descriptor);
    if (snapshotDescriptors.has(key)) {
      throw new TypeError("SANDBOX_SNAPSHOT_DESCRIPTOR_DUPLICATE");
    }
    snapshotDescriptors.set(key, deepFreeze(descriptor));
    snapshotDescriptorsByHash.set(descriptor.descriptor_hash, descriptor);
  }
  const snapshotRelationManifests = new Map<string, SnapshotRelationManifest>();
  for (const candidate of options.snapshot_relation_manifests) {
    const manifest = snapshotRelationManifestSchema.parse(candidate);
    if (!snapshotDescriptorsByHash.has(manifest.snapshot_descriptor_hash)) {
      throw new TypeError("SANDBOX_SNAPSHOT_RELATION_MANIFEST_EXTRA");
    }
    if (snapshotRelationManifests.has(manifest.snapshot_descriptor_hash)) {
      throw new TypeError("SANDBOX_SNAPSHOT_RELATION_MANIFEST_DUPLICATE");
    }
    const relationKeys = new Set<string>();
    for (const relation of manifest.allowed_relations) {
      const relationKey = canonicalizeJson([relation.schema_name, relation.relation_name]);
      if (relationKeys.has(relationKey)) {
        throw new TypeError("SANDBOX_SNAPSHOT_RELATION_DUPLICATE");
      }
      relationKeys.add(relationKey);
    }
    const descriptor = snapshotDescriptorsByHash.get(manifest.snapshot_descriptor_hash);
    if (
      descriptor?.strategy === "NONE" &&
      (manifest.sealed_schema !== null || manifest.allowed_relations.length > 0)
    ) {
      throw new TypeError("SANDBOX_NONE_SNAPSHOT_RELATION_MANIFEST_NOT_EMPTY");
    }
    if (
      descriptor?.strategy === "CONTROLLED_REVISION" &&
      (manifest.sealed_schema === null ||
        manifest.allowed_relations.some(
          (relation) => relation.schema_name !== manifest.sealed_schema,
        ))
    ) {
      throw new TypeError("SANDBOX_CONTROLLED_SNAPSHOT_RELATION_MANIFEST_INVALID");
    }
    snapshotRelationManifests.set(manifest.snapshot_descriptor_hash, deepFreeze(manifest));
  }
  for (const descriptor of snapshotDescriptors.values()) {
    if (!snapshotRelationManifests.has(descriptor.descriptor_hash)) {
      throw new TypeError("SANDBOX_SNAPSHOT_RELATION_MANIFEST_MISSING");
    }
  }

  const transactionStorage = new AsyncLocalStorage<TransactionContext>();
  const now = options.now ?? (() => new Date());

  async function inAuthorityTransaction<T>(work: (context: TransactionContext) => Promise<T>) {
    const active = transactionStorage.getStore();
    if (active) return work(active);
    const result = await withAppTransaction(
      options.pool,
      options.authorizer,
      options.capability,
      {
        access: "WRITE",
        operation_name: "text2sql.sandbox.authority",
        map_database_error: (error) => {
          if (error instanceof SandboxExecutionAuthorityError) {
            return {
              ok: false,
              error: {
                code: error.code,
                message: error.message,
                retryable: error.code === "SANDBOX_STALE_EXECUTION_FENCE",
              },
            };
          }
          const code = markerReasonCode(markerOf(error));
          return code
            ? {
                ok: false,
                error: {
                  code,
                  message: "PostgreSQL Sandbox Authority 拒绝状态转换。",
                  retryable: code === "SANDBOX_STALE_EXECUTION_FENCE",
                },
              }
            : null;
        },
      },
      (context) => transactionStorage.run(context, () => work(context)),
    );
    if (!result.ok) {
      const code = sandboxExecutionAuthorityReasonCode(result.error.code);
      throw new SandboxExecutionAuthorityError(result.error.message, code);
    }
    return result.value;
  }

  function sandboxExecutionAuthorityReasonCode(value: string): SandboxExecutionAuthorityReasonCode {
    const parsed = sandboxExecutionAuthorityReasonCodeSchema.safeParse(value);
    return parsed.success ? parsed.data : (markerReasonCode(value) ?? "SANDBOX_AUTHORITY_REJECTED");
  }

  async function resolveL2Document(
    reference: ArtifactReference,
    client: SqlClient,
    principalId: string,
  ) {
    const result = await queryAuthority<DocumentRow>(
      client,
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
      referenceValues(reference, principalId),
    );
    const document = l2ArtifactDocumentSchema.safeParse(result.rows[0]?.document_json);
    if (
      !document.success ||
      artifactReferenceIdentity({
        artifact_id: document.data.envelope.artifact_id,
        artifact_type: document.data.envelope.artifact_type,
        app_id: document.data.envelope.app_id,
        tenant_id: document.data.envelope.tenant_id,
        environment: document.data.envelope.environment,
        run_id: document.data.envelope.run_id,
        revision: document.data.envelope.revision,
        content_hash: document.data.envelope.content_hash,
      }) !== artifactReferenceIdentity(reference)
    ) {
      return null;
    }
    return document.data;
  }

  async function loadRawClaim(
    client: SqlClient,
    identityInput: SandboxExecutionImmutableIdentity,
  ): Promise<DatabaseClaim | null> {
    const identityValue = sandboxExecutionImmutableIdentitySchema.parse(identityInput);
    const result = await queryAuthority(
      client,
      `select
         app_id,
         tenant_id,
         environment,
         run_id,
         principal_id,
         idempotency_key,
         execution_id,
         input_hash,
         request_json,
         state,
         branch_version,
         attempt_id,
         attempt_sequence,
         owner_id,
         fence,
         lease_id,
         lease_expires_at,
         cancel_epoch,
         cancel_requested_at,
         grant_hash,
         grant_cancel_epoch,
         snapshot_descriptor_json,
         result_ref,
         receipt_ref,
         terminal_reason_code,
         recovery_deadline,
         updated_at
       from text2sql_sandbox_claims
       where app_id = $1
         and tenant_id = $2
         and environment = $3
         and run_id = $4
         and principal_id = $5::uuid
         and idempotency_key = $6
         and execution_id = $7::uuid
         and input_hash = $8`,
      [
        identityValue.scope.app_id,
        identityValue.scope.tenant_id,
        identityValue.scope.environment,
        identityValue.run_id,
        identityValue.principal_id,
        identityValue.idempotency_key,
        identityValue.execution_id,
        identityValue.input_hash,
      ],
    );
    return result.rows[0] ? rawRowToDatabaseClaim(result.rows[0]) : null;
  }

  async function callClaimFunction(
    client: SqlClient,
    functionName:
      | "claim_text2sql_sandbox_execution"
      | "mark_text2sql_sandbox_executing"
      | "request_text2sql_sandbox_cancel"
      | "fail_text2sql_sandbox_execution",
    command: unknown,
  ) {
    const result = await queryAuthority<JsonValueRow>(
      client,
      `select app_data_agent.${functionName}($1::jsonb) as value`,
      [JSON.stringify(command)],
    );
    return databaseClaimResultSchema.parse(result.rows[0]?.value);
  }

  async function resolveAudienceContextHash(
    client: SqlClient,
    executionIdentity: SandboxExecutionImmutableIdentity,
  ) {
    const result = await queryAuthority<JsonValueRow>(
      client,
      `select app_data_agent.text2sql_audience_context_hash(
         $1::uuid,
         $2::uuid,
         $3::text,
         $4::uuid,
         $5::uuid
       ) as value`,
      [
        executionIdentity.scope.app_id,
        executionIdentity.scope.tenant_id,
        executionIdentity.scope.environment,
        executionIdentity.run_id,
        executionIdentity.principal_id,
      ],
    );
    return contentHashSchema.parse(result.rows[0]?.value);
  }

  async function prepareClaim(
    input: Parameters<SandboxExecutionAuthorityStore["prepareExecution"]>[0],
    recovery?: Pick<
      SandboxExecutionRecoveryRequest,
      "expected_attempt_id" | "expected_fencing_token"
    >,
  ) {
    return inAuthorityTransaction(async ({ client }) => {
      const binding = input.request.payload.resolved_context_binding;
      if (
        binding !== undefined &&
        input.sql_artifact.resolved_context_binding_hash !== binding.binding_hash
      ) {
        throw new SandboxExecutionAuthorityError(
          "SqlArtifact and Resolved Context binding hashes do not match.",
          "SANDBOX_AUTHORITY_REJECTED",
        );
      }
      const bindingVerified =
        binding === undefined
          ? false
          : options.resolved_context_binding_authority
            ? await options.resolved_context_binding_authority.verify({
                binding,
                scope: input.request.scope,
                run_id: input.request.run_id,
                sql_artifact_ref: input.request.payload.sql_artifact_ref,
              })
            : (
                await queryAuthority<{ readonly value: unknown }>(
                  client,
                  "select app_data_agent.verify_resolved_context_text2sql_binding($1::jsonb,$2::uuid) as value",
                  [JSON.stringify(binding), input.request.run_id],
                )
              ).rows[0]?.value === true;
      if ((options.require_resolved_context_binding || binding !== undefined) && !bindingVerified) {
        throw new SandboxExecutionAuthorityError(
          "Resolved Context Text2SQL binding is not authoritative for this execution.",
          "SANDBOX_AUTHORITY_REJECTED",
        );
      }
      const persistedPreparation = persistedPreparationSchema.parse({
        request: input.request,
        permit: input.permit,
        sql_artifact: input.sql_artifact,
        authority_revalidation: input.authority_revalidation,
      });
      const requestChecksum = await sha256ContentHash(persistedPreparation);
      const leaseExpiresAt = new Date(
        Math.min(
          Date.parse(input.identity.execution_permit_expires_at),
          Date.parse(input.requested_at) + leaseDurationMs,
        ),
      ).toISOString();
      if (Date.parse(leaseExpiresAt) <= Date.parse(input.requested_at)) {
        throw new SandboxExecutionAuthorityError(
          "ExecutionPermit 已无法覆盖新的 Sandbox Lease。",
          "SANDBOX_AUTHORITY_REJECTED",
        );
      }
      let claimed: z.infer<typeof databaseClaimResultSchema>;
      try {
        claimed = await callClaimFunction(client, "claim_text2sql_sandbox_execution", {
          schema_version: "text2sql_sandbox_claim@1.0.0",
          ...claimCommandIdentity(input.identity),
          request_json: persistedPreparation,
          request_checksum: requestChecksum,
          owner_id: options.owner_id,
          attempt_id: randomUUID(),
          lease_id: randomUUID(),
          event_id: randomUUID(),
          lease_expires_at: leaseExpiresAt,
          ...(recovery
            ? {
                expected_attempt_id: recovery.expected_attempt_id,
                expected_fencing_token: recovery.expected_fencing_token,
                recovery_requested_at: input.requested_at,
              }
            : {}),
        });
      } catch (error) {
        if (
          error instanceof SandboxExecutionAuthorityError &&
          error.code === "SANDBOX_IDEMPOTENCY_CONFLICT"
        ) {
          return sandboxExecutionPrepareResultSchema.parse({
            schema_version: authorityResultVersion,
            disposition: "IDEMPOTENCY_CONFLICT",
            reason_code: "SANDBOX_IDEMPOTENCY_CONFLICT",
            claim: null,
            grant: null,
          });
        }
        throw error;
      }
      const claimedRaw = databaseClaimSchema.parse(claimed.claim);
      if (claimed.disposition !== "ACCEPTED") {
        const claimedContract = toContractClaim(claimedRaw, input.identity, input.requested_at);
        return sandboxExecutionPrepareResultSchema.parse({
          schema_version: authorityResultVersion,
          disposition: claimed.disposition,
          reason_code: transitionReason(claimed.disposition, claimedContract),
          claim: claimedContract,
          grant: null,
        });
      }
      const grantDraft = {
        protocol_version: "sandbox-execution-grant@1.0.0" as const,
        identity: input.identity,
        attempt_id: claimedRaw.attempt_id,
        attempt: claimedRaw.attempt,
        fencing_token: claimedRaw.fencing_token,
        lease_id: claimedRaw.lease_id,
        lease_expires_at: claimedRaw.lease_expires_at,
        cancel_epoch: claimedRaw.cancel_epoch,
        snapshot_descriptor: input.snapshot_descriptor,
        fixture_manifest_hash: input.snapshot_descriptor.fixture_manifest_hash,
        budget: input.identity.budget,
        issued_at: input.requested_at,
        grant_hash: input.identity.input_hash,
      };
      const grant = deepFreeze(
        executionGrantSchema.parse({
          ...grantDraft,
          grant_hash: await computeExecutionGrantHash(grantDraft),
        }),
      );
      const marked = await callClaimFunction(client, "mark_text2sql_sandbox_executing", {
        ...claimCommandIdentity(input.identity),
        expected_branch_version: claimed.claim.branch_version,
        attempt_id: grant.attempt_id,
        lease_id: grant.lease_id,
        event_id: randomUUID(),
        owner_id: options.owner_id,
        fence: grant.fencing_token,
        grant_hash: grant.grant_hash,
        grant_cancel_epoch: grant.cancel_epoch,
        sql_artifact_hash: input.identity.sql_artifact_ref.content_hash,
        ordered_parameters_hash: input.identity.ordered_parameters_hash,
        fixture_manifest_hash: grant.fixture_manifest_hash,
        snapshot_descriptor_json: grant.snapshot_descriptor,
        snapshot_descriptor_checksum: await sha256ContentHash(grant.snapshot_descriptor),
      });
      const claim = toContractClaim(marked.claim, input.identity, input.requested_at);
      return sandboxExecutionPrepareResultSchema.parse({
        schema_version: authorityResultVersion,
        disposition: "ACCEPTED",
        reason_code: "SANDBOX_EXECUTION_IN_PROGRESS",
        claim,
        grant,
      });
    });
  }

  async function cancelClaim(input: SandboxExecutionCancelRequest) {
    return inAuthorityTransaction(async ({ client }) => {
      const raw = await loadRawClaim(client, input.identity);
      if (!raw) {
        throw new SandboxExecutionAuthorityError(
          "Sandbox Cancel 找不到当前 Claim。",
          "SANDBOX_AUTHORITY_REJECTED",
        );
      }
      if (raw.cancel_epoch !== input.expected_cancel_epoch) {
        throw new SandboxExecutionAuthorityError(
          "Sandbox Cancel 的 expected_cancel_epoch 已过期。",
          "SANDBOX_OUTCOME_BINDING_MISMATCH",
        );
      }
      const result = await callClaimFunction(client, "request_text2sql_sandbox_cancel", {
        ...claimCommandIdentity(input.identity),
        expected_branch_version: raw.branch_version,
        expected_cancel_epoch: input.expected_cancel_epoch,
        event_id: randomUUID(),
        reason_code: "SANDBOX_CANCELLED",
      });
      const claim = toContractClaim(result.claim, input.identity, input.requested_at);
      return sandboxExecutionTransitionResultSchema.parse({
        schema_version: authorityResultVersion,
        disposition: result.disposition,
        reason_code: transitionReason(result.disposition, claim),
        claim,
        grant: null,
      });
    });
  }

  async function buildSuccessfulArtifacts(
    outcome: Extract<SandboxExecutionOutcome, { readonly terminal: "COMPLETED" }>,
    preparation: z.infer<typeof persistedPreparationSchema>,
    descriptor: SnapshotDescriptor,
  ) {
    const columns = outcome.result.columns;
    const rows = outcome.result.rows;
    const resultId = randomUUID();
    const resultDraft = {
      schema_version: outcome.identity.schema_version,
      result_ref: {
        artifact_id: resultId,
        artifact_type: "SandboxResult" as const,
        ...outcome.identity.scope,
        run_id: outcome.identity.run_id,
        revision: 1,
        content_hash: outcome.input_hash,
      },
      scope: outcome.identity.scope,
      run_id: outcome.identity.run_id,
      execution_id: outcome.identity.execution_id,
      columns,
      rows,
      row_count: rows.length,
      bytes: computeSandboxResultBytes({ columns, rows }),
      result_hash: outcome.input_hash,
    };
    const resultHash = await computeSandboxResultHash(resultDraft);
    const result = sandboxResultSchema.parse({
      ...resultDraft,
      result_ref: { ...resultDraft.result_ref, content_hash: resultHash },
      result_hash: resultHash,
    });
    if (
      outcome.resource_facts.observed_rows !== result.row_count ||
      outcome.resource_facts.observed_bytes !== result.bytes
    ) {
      throw new SandboxExecutionAuthorityError(
        "Sandbox Outcome Resource Facts 与规范 Result 不一致。",
        "SANDBOX_OUTCOME_BINDING_MISMATCH",
      );
    }
    const receiptId = randomUUID();
    const receiptDraft = {
      schema_version: outcome.identity.schema_version,
      language: "sql" as const,
      executor: identity,
      executor_role: "SANDBOX_EXECUTION" as const,
      authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
      receipt_id: receiptId,
      receipt_ref: {
        artifact_id: receiptId,
        artifact_type: "SandboxExecutionReceipt" as const,
        ...outcome.identity.scope,
        run_id: outcome.identity.run_id,
        revision: 1,
        content_hash: outcome.input_hash,
      },
      scope: outcome.identity.scope,
      run_id: outcome.identity.run_id,
      execution_id: outcome.identity.execution_id,
      idempotency_key: outcome.identity.idempotency_key,
      input_hash: outcome.input_hash,
      execution_hash: outcome.input_hash,
      terminal: "COMPLETED" as const,
      reason_code: "EXECUTION_COMPLETED" as const,
      started_at: outcome.started_at,
      completed_at: outcome.completed_at,
      result_artifact_ref: result.result_ref,
      sql_artifact_ref: outcome.identity.sql_artifact_ref,
      execution_permit_ref: outcome.identity.execution_permit_ref,
      resource_admission_ref: outcome.identity.resource_admission_ref,
      datasource_id: outcome.identity.datasource_id,
      settings_hash: outcome.identity.settings_hash,
      execution_settings: outcome.applied_execution_settings,
      transaction: outcome.transaction,
      authority_revalidation: preparation.authority_revalidation,
      snapshot_token: descriptor.snapshot_token,
      watermark: null,
      replay_state: descriptor.replay_state,
      resource_usage: {
        elapsed_ms: outcome.resource_facts.elapsed_ms,
        rows: outcome.resource_facts.observed_rows,
        bytes: outcome.resource_facts.observed_bytes,
        peak_memory_mb: outcome.resource_facts.peak_memory_mb,
      },
    };
    const receiptHash = await computeSandboxExecutionReceiptHash(receiptDraft);
    const receipt = successfulSandboxExecutionReceiptSchema.parse({
      ...receiptDraft,
      receipt_ref: { ...receiptDraft.receipt_ref, content_hash: receiptHash },
      execution_hash: receiptHash,
    });
    return { receipt, result };
  }

  async function settleClaim(
    input: {
      readonly identity: SandboxExecutionImmutableIdentity;
      readonly outcome: SandboxExecutionOutcome;
    },
    failure: boolean,
  ) {
    return inAuthorityTransaction(async ({ client }) => {
      const outcome = sandboxExecutionOutcomeSchema.parse(input.outcome);
      const persistedOutcome = outcome;
      const persistedOutcomePayloadChecksum = await sha256ContentHash(persistedOutcome);
      const command = {
        ...claimCommandIdentity(input.identity),
        attempt_id: outcome.attempt_id,
        lease_id: outcome.lease_id,
        record_id: randomUUID(),
        event_id: randomUUID(),
        owner_id: options.owner_id,
        authority: identity,
        grant_hash: outcome.grant_hash,
        fence: outcome.execution_fence,
        outcome_json: persistedOutcome,
        outcome_payload_checksum: persistedOutcomePayloadChecksum,
      };
      let result: z.infer<typeof databaseClaimResultSchema>;
      if (failure || outcome.terminal !== "COMPLETED") {
        const authorityState =
          outcome.terminal === "REPLAY_UNAVAILABLE" ? "REPLAY_UNAVAILABLE" : outcome.terminal;
        result = await callClaimFunction(client, "fail_text2sql_sandbox_execution", {
          ...command,
          authority_state_at_record: authorityState,
          terminal_reason_code: outcome.reason_code,
        });
      } else {
        const raw = await loadRawClaim(client, input.identity);
        if (!raw) {
          throw new SandboxExecutionAuthorityError(
            "Sandbox Finalize 找不到当前 Claim。",
            "SANDBOX_AUTHORITY_REJECTED",
          );
        }
        const preparation = persistedPreparationSchema.parse(raw.request_json);
        const descriptor = snapshotDescriptorSchema.parse(raw.snapshot_descriptor);
        const artifacts = await buildSuccessfulArtifacts(outcome, preparation, descriptor);
        const audienceContextHash = await resolveAudienceContextHash(client, input.identity);
        const artifactItems = await Promise.all(
          [
            { reference: artifacts.result.result_ref, payload: artifacts.result },
            { reference: artifacts.receipt.receipt_ref, payload: artifacts.receipt },
          ].map(async ({ reference, payload }) => ({
            reference,
            payload_json: payload,
            payload_checksum: await sha256ContentHash(payload),
            authority: identity,
            producer_principal_id: input.identity.principal_id,
            audience_context_hash: audienceContextHash,
            worker_fence: outcome.execution_fence,
          })),
        );
        const queryResult = await queryAuthority<JsonValueRow>(
          client,
          `select app_data_agent.finalize_text2sql_sandbox_execution(
             $1::jsonb,
             $2::jsonb
           ) as value`,
          [JSON.stringify(command), JSON.stringify(artifactItems)],
        );
        result = databaseClaimResultSchema.parse(queryResult.rows[0]?.value);
      }
      const claim = toContractClaim(result.claim, input.identity, outcome.completed_at);
      return sandboxExecutionTransitionResultSchema.parse({
        schema_version: authorityResultVersion,
        disposition: result.disposition,
        reason_code: transitionReason(result.disposition, claim),
        claim,
        grant: null,
      });
    });
  }

  const executionAuthority: SandboxExecutionAuthorityStore = {
    prepareExecution: prepareClaim,
    finalizeExecution: (input) => settleClaim(input, false),
    failExecution: (input) => settleClaim(input, true),
    cancelExecution: cancelClaim,
    async recoverExecution(input: SandboxExecutionRecoveryRequest) {
      return inAuthorityTransaction(async ({ client }) => {
        const raw = await loadRawClaim(client, input.identity);
        if (!raw) {
          return sandboxExecutionPrepareResultSchema.parse({
            schema_version: authorityResultVersion,
            disposition: "REJECTED",
            reason_code: "SANDBOX_AUTHORITY_REJECTED",
            claim: null,
            grant: null,
          });
        }
        const preparation = persistedPreparationSchema.parse(raw.request_json);
        if (preparation.request.language !== "sql") {
          throw new SandboxExecutionAuthorityError(
            "Sandbox Recovery 持久化的 Preparation 不是 SQL 请求。",
            "SANDBOX_AUTHORITY_REJECTED",
          );
        }
        const descriptor = snapshotDescriptors.get(snapshotIdentityKey(input.identity));
        if (!descriptor) {
          throw new SandboxExecutionAuthorityError(
            "Sandbox Recovery 找不到精确固定 Snapshot Descriptor。",
            "SANDBOX_REPLAY_UNAVAILABLE",
          );
        }
        return prepareClaim(
          {
            identity: input.identity,
            ...preparation,
            request: preparation.request,
            snapshot_descriptor: descriptor,
            requested_at: input.requested_at,
          },
          input,
        );
      });
    },
    resolveExecutionClaim(identityInput) {
      return inAuthorityTransaction(async ({ client }) => {
        const raw = await loadRawClaim(client, identityInput);
        return raw ? toContractClaim(raw, identityInput, now().toISOString()) : null;
      });
    },
  };

  return registerSandboxServerAuthority({
    identity,
    executionAuthority,
    resolveSnapshotDescriptor: async (context) => {
      const descriptor = snapshotDescriptors.get(snapshotIdentityKey(context.identity));
      if (!descriptor) return null;
      const relationManifest = snapshotRelationManifests.get(descriptor.descriptor_hash);
      if (!relationManifest) {
        throw new SandboxExecutionAuthorityError(
          "Sandbox Snapshot Descriptor 缺少精确绑定的 Relation Manifest。",
          "SANDBOX_SNAPSHOT_AUTHORITY_BREACH",
        );
      }
      const expectedSearchPath =
        descriptor.strategy === "CONTROLLED_REVISION" && relationManifest.sealed_schema
          ? [relationManifest.sealed_schema, "pg_catalog"]
          : descriptor.strategy === "NONE"
            ? ["pg_catalog"]
            : null;
      if (
        expectedSearchPath === null ||
        canonicalizeJson(context.permit.execution_settings.search_path) !==
          canonicalizeJson(expectedSearchPath)
      ) {
        throw new SandboxExecutionAuthorityError(
          "Snapshot 必须精确使用服务端绑定的 Search Path：CONTROLLED_REVISION=[sealed_schema, pg_catalog]，NONE=[pg_catalog]。",
          "SANDBOX_SNAPSHOT_AUTHORITY_BREACH",
        );
      }
      await assertSandboxSqlPolicy({
        sql: context.sql_artifact.sql,
        allowed_relations: relationManifest.allowed_relations,
      });
      return structuredClone(descriptor);
    },
    resolveCommitted: (reference) =>
      inAuthorityTransaction(async ({ client, capability }) => {
        if (
          reference.artifact_type === "SandboxExecutionReceipt" ||
          reference.artifact_type === "SandboxResult"
        ) {
          const result = await queryAuthority<SystemArtifactRow>(
            client,
            "select app_data_agent.resolve_text2sql_system_artifact($1::jsonb) as value",
            [JSON.stringify(reference)],
          );
          return result.rows[0]?.value ?? null;
        }
        return (await resolveL2Document(reference, client, capability.principal))?.payload ?? null;
      }),
    verifyCommitted: (reference) =>
      inAuthorityTransaction(async ({ client, capability }) => {
        if (
          reference.artifact_type === "SandboxExecutionReceipt" ||
          reference.artifact_type === "SandboxResult"
        ) {
          const result = await queryAuthority<SystemArtifactRow>(
            client,
            "select app_data_agent.verify_text2sql_system_artifact($1::jsonb) as value",
            [JSON.stringify(reference)],
          );
          return result.rows[0]?.value === true;
        }
        return (await resolveL2Document(reference, client, capability.principal)) !== null;
      }),
    resolveAuthoritativeExecutionPermit: (reference) =>
      inAuthorityTransaction(async ({ client, capability }) => {
        const document = await resolveL2Document(reference, client, capability.principal);
        return document?.payload.artifact_type === "ExecutionPermit" ? document.payload : null;
      }),
    resolveAuthoritativeSqlArtifact: (reference) =>
      inAuthorityTransaction(async ({ client, capability }) => {
        const document = await resolveL2Document(reference, client, capability.principal);
        if (document?.payload.artifact_type !== "SqlArtifact") return null;
        if (document.payload.compiler_version !== supportedPostgresqlCompilerVersion) {
          throw new SandboxExecutionAuthorityError(
            "Sandbox Authority 不接受未知版本的 PostgreSQL Compiler Artifact。",
            "SANDBOX_SQL_SHAPE_REJECTED",
          );
        }
        await assertSandboxSqlPolicy({ sql: document.payload.sql });
        return document.payload;
      }),
    verifyExactArtifactRevision: (reference, artifact) =>
      inAuthorityTransaction(async ({ client, capability }) => {
        const document = await resolveL2Document(reference, client, capability.principal);
        return (
          document !== null && canonicalizeJson(document.payload) === canonicalizeJson(artifact)
        );
      }),
    revalidateExecutionAuthority: (input) =>
      inAuthorityTransaction(async ({ capability }) => {
        if (
          capability.principal !== input.effective_principal_id ||
          input.policy_receipt_ref.app_id !== capability.scope.app_id ||
          input.policy_receipt_ref.tenant_id !== capability.scope.tenant_id ||
          input.policy_receipt_ref.environment !== capability.scope.environment
        ) {
          return null;
        }
        return {
          effective_principal_id: capability.principal,
          policy_receipt_ref: input.policy_receipt_ref,
          revalidated_at: input.transaction_started_at,
          authority_epoch: 0,
        };
      }),
    assertAuthorityFence: () => Promise.resolve(transactionStorage.getStore() !== undefined),
    withSqlTransaction: (operation) => inAuthorityTransaction(() => operation()),
    claimOrLoadExecution: async () => {
      throw new SandboxExecutionAuthorityError(
        "PostgreSQL Sandbox Authority 只支持 prepare/execute/finalize 三阶段 API。",
        "SANDBOX_AUTHORITY_REJECTED",
      );
    },
    resolveExecutionRecord: (inputHash) =>
      inAuthorityTransaction(async ({ client, capability }) => {
        const result = await queryAuthority(
          client,
          `select
             claim.request_json,
             record.outcome_json,
             claim.result_ref,
             claim.snapshot_descriptor_json
           from text2sql_sandbox_execution_records as record
           join text2sql_sandbox_claims as claim
             on claim.app_id = record.app_id
            and claim.tenant_id = record.tenant_id
            and claim.environment = record.environment
            and claim.run_id = record.run_id
            and claim.principal_id = record.principal_id
            and claim.execution_id = record.execution_id
           where record.app_id = $1
             and record.tenant_id = $2
             and record.environment = $3
             and record.principal_id = $4::uuid
             and record.input_hash = $5
             and record.authority_state_at_record = 'COMPLETED'
           order by record.attempt_sequence desc
           limit 1`,
          [
            capability.scope.app_id,
            capability.scope.tenant_id,
            capability.scope.environment,
            capability.principal,
            inputHash,
          ],
        );
        const row = result.rows[0] as
          | {
              readonly request_json?: unknown;
              readonly outcome_json?: unknown;
              readonly result_ref?: unknown;
              readonly snapshot_descriptor_json?: unknown;
            }
          | undefined;
        if (!row) return null;
        const preparation = persistedPreparationSchema.parse(row.request_json);
        const outcome = sandboxExecutionOutcomeSchema.parse(row.outcome_json);
        const descriptor = snapshotDescriptorSchema.parse(row.snapshot_descriptor_json);
        return {
          request: preparation.request,
          started_at: outcome.started_at,
          completed_at: outcome.completed_at,
          result_artifact_ref: artifactReferenceSchema.parse(row.result_ref),
          datasource_id: outcome.identity.datasource_id,
          schema_version: outcome.identity.schema_version,
          settings_hash: outcome.identity.settings_hash,
          applied_execution_settings: outcome.applied_execution_settings,
          transaction: outcome.transaction,
          authority_revalidation: preparation.authority_revalidation,
          snapshot: {
            snapshot_token: descriptor.snapshot_token,
            watermark: null,
            replay_state: descriptor.replay_state,
          },
          resource_usage: {
            elapsed_ms: outcome.resource_facts.elapsed_ms,
            rows: outcome.resource_facts.observed_rows,
            bytes: outcome.resource_facts.observed_bytes,
            peak_memory_mb: outcome.resource_facts.peak_memory_mb,
          },
        };
      }),
    now,
  });
}
