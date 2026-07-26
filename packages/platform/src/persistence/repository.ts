import {
  type ArtifactReference,
  artifactReferenceSchema,
  canonicalizeJson,
  computeL2ArtifactContentHash,
  type L2ArtifactDocument,
  l2ArtifactDocumentSchema,
  type PortResult,
  runRuntimeEventSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";
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
const commandPayloadSchema = z.strictObject({
  kind: z.literal("START_L2_RESEARCH"),
  mode: z.literal("L2").optional(),
  question_version: stableCommandValue.optional(),
  dataset_id: stableCommandValue.optional(),
  secret_refs: z.array(commandSecretRef).min(1).max(32).optional(),
});
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

function validateArtifactAncestry(
  document: L2ArtifactDocument,
  expectedActiveRevision: number,
  active: ActiveArtifactRow | null,
): void {
  const { envelope } = document;
  if (envelope.revision !== expectedActiveRevision + 1) {
    throw new PersistenceBoundaryError(
      "ARTIFACT_REVISION_CONFLICT",
      "Artifact Revision 与调用方声明的 Active Revision 不连续。",
    );
  }

  if (expectedActiveRevision === 0) {
    if (active || envelope.parent_ref !== null) {
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
    envelope.parent_ref?.revision !== active.revision ||
    envelope.parent_ref.content_hash !== active.content_hash
  ) {
    throw new PersistenceBoundaryError(
      "ARTIFACT_REVISION_CONFLICT",
      "Artifact Parent Reference 不匹配当前 Active Revision。",
    );
  }
}

export function createPostgresRepository(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
) {
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

      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE" },
        async ({ capability, client }) => {
          assertReferenceScope(reference, capability.scope);

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
              "Artifact 所属 Run 不存在或不属于当前 Principal。",
            );
          }
          if (BigInt(activeFence) !== BigInt(parsedOptions.data.worker_fence)) {
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
              reference.run_id,
              reference.artifact_id,
              reference.artifact_type,
            ],
          );
          const active = activeResult.rows[0] ?? null;
          validateArtifactAncestry(document, parsedOptions.data.expected_active_revision, active);

          const authorityReferences = [
            ...(document.envelope.parent_ref ? [document.envelope.parent_ref] : []),
            ...document.envelope.input_refs,
          ];
          for (const inputReference of authorityReferences) {
            assertReferenceScope(inputReference, capability.scope);
            if (!(await referenceExists(client, inputReference, capability.principal))) {
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
                reference.run_id,
                reference.artifact_id,
                reference.artifact_type,
                active.revision,
              ],
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
               parent_content_hash,
               created_at
             )
             values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, true, $11, $12, $13
             )`,
            [
              ...scopeValues(capability.scope),
              reference.run_id,
              reference.artifact_id,
              reference.artifact_type,
              reference.revision,
              reference.content_hash,
              canonicalizeJson(document),
              parsedOptions.data.worker_fence,
              document.envelope.parent_ref?.revision ?? null,
              document.envelope.parent_ref?.content_hash ?? null,
              document.envelope.created_at,
            ],
          );
          return reference;
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
              parsed.data.app_id,
              parsed.data.tenant_id,
              parsed.data.environment,
              parsed.data.run_id,
              parsed.data.artifact_id,
              parsed.data.artifact_type,
              parsed.data.revision,
              parsed.data.content_hash,
              capability.principal,
            ],
          );
          return result.rows[0]?.document_json ?? null;
        },
      );
    },
  };
}
