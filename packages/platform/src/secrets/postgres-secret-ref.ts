import type { PortResult } from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const uuid = z.uuid();
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{1,126}$/);
const secretRefLocator = z
  .string()
  .regex(/^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const status = z.enum(["ACTIVE", "ROTATION_PENDING", "REVOCATION_PENDING", "REVOKED"]);
const databaseRowSchema = z.object({
  secret_ref_id: uuid,
  secret_name: name,
  version: z.coerce.number().int().positive().safe(),
  status,
});
const registerSchema = z.strictObject({
  secret_ref_id: uuid,
  secret_name: name,
  provider_ref_hash: hash,
});
const locatorSchema = z.strictObject({
  ref: secretRefLocator,
  expected_version: z.number().int().positive().safe().optional(),
});
const effectRequestSchema = z.strictObject({
  ref: secretRefLocator,
  expected_version: z.number().int().positive().safe(),
  request_id: uuid,
  operation: z.enum(["ROTATE", "REVOKE"]),
});
const finalizeSchema = z.strictObject({
  ref: secretRefLocator,
  expected_version: z.number().int().positive().safe(),
  provider_receipt_id: uuid,
});

export type PersistedSecretRef = Readonly<{
  ref: `secretref:${string}`;
  name: string;
  version: number;
  status: z.infer<typeof status>;
}>;

interface JsonResultRow {
  readonly value: unknown;
}

function invalidInput<T>(message: string): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "SECRET_REF_INPUT_INVALID",
      message,
      retryable: false,
    },
  };
}

function secretRefId(ref: string): string {
  return ref.slice("secretref:".length);
}

function persisted(value: unknown): PersistedSecretRef {
  const row = databaseRowSchema.safeParse(value);
  if (!row.success) {
    throw new PersistenceBoundaryError(
      "SECRET_REF_DATABASE_CONTRACT_INVALID",
      "PostgreSQL 返回的 SecretRef Metadata 不符合契约。",
    );
  }
  return Object.freeze({
    ref: `secretref:${row.data.secret_ref_id}`,
    name: row.data.secret_name,
    version: row.data.version,
    status: row.data.status,
  });
}

export function createPostgresSecretRefRepository(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
) {
  return {
    async register(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedSecretRef>> {
      const parsed = registerSchema.safeParse(input);
      if (!parsed.success) {
        return invalidInput("SecretRef 只能登记 opaque ID、名称与 Provider Locator Hash。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE" },
        async ({ client }) => {
          const result = await client.query<JsonResultRow>(
            `select app_data_agent.register_secret_ref(
               $1::uuid,
               $2::text,
               $3::text
             ) as value`,
            [parsed.data.secret_ref_id, parsed.data.secret_name, parsed.data.provider_ref_hash],
          );
          return persisted(result.rows[0]?.value);
        },
      );
    },

    async get(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedSecretRef | null>> {
      const parsed = locatorSchema.safeParse(input);
      if (!parsed.success) return invalidInput("SecretRef Locator 或 Version 非法。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ" },
        async ({ capability, client }) => {
          const result = await client.query(
            `select secret_ref_id, secret_name, version, status
             from secret_refs
             where app_id = $1
               and tenant_id = $2
               and environment = $3
               and secret_ref_id = $4::uuid
               and (
                 owner_principal_id = $5::uuid
                 or $6::text = 'OWNER'
               )`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              secretRefId(parsed.data.ref),
              capability.principal,
              capability.role,
            ],
          );
          const row = result.rows[0];
          if (!row) return null;
          const value = persisted(row);
          if (
            parsed.data.expected_version !== undefined &&
            parsed.data.expected_version !== value.version
          ) {
            throw new PersistenceBoundaryError(
              "SECRET_REF_VERSION_STALE",
              "SecretRef Version 已过期。",
            );
          }
          return value;
        },
      );
    },

    async requestProviderEffect(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedSecretRef>> {
      const parsed = effectRequestSchema.safeParse(input);
      if (!parsed.success) return invalidInput("Secret Provider Effect Request 非法。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE" },
        async ({ client }) => {
          const result = await client.query<JsonResultRow>(
            `select app_data_agent.request_secret_provider_effect(
               $1::uuid,
               $2::bigint,
               $3::uuid,
               $4::text
             ) as value`,
            [
              secretRefId(parsed.data.ref),
              parsed.data.expected_version,
              parsed.data.request_id,
              parsed.data.operation,
            ],
          );
          return persisted(result.rows[0]?.value);
        },
      );
    },

    async finalizeProviderEffect(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedSecretRef>> {
      const parsed = finalizeSchema.safeParse(input);
      if (!parsed.success) return invalidInput("Secret Provider Receipt Reference 非法。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE" },
        async ({ client }) => {
          const result = await client.query<JsonResultRow>(
            `select app_data_agent.finalize_secret_provider_effect(
               $1::uuid,
               $2::bigint,
               $3::uuid
             ) as value`,
            [
              secretRefId(parsed.data.ref),
              parsed.data.expected_version,
              parsed.data.provider_receipt_id,
            ],
          );
          return persisted(result.rows[0]?.value);
        },
      );
    },
  };
}
