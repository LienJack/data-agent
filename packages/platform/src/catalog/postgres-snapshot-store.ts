import {
  contentHashSchema,
  immutableIdSchema,
  type PhysicalSchemaSnapshot,
  type PortResult,
  physicalSchemaSnapshotSchema,
  type SchemaDriftCommitResult,
  type SchemaDriftEvent,
  type SchemaScanCommitResult,
  type SchemaScanErrorCode,
  type SchemaScanRequest,
  type SchemaScanRun,
  schemaDriftCommitResultSchema,
  schemaDriftEventSchema,
  schemaScanCommitResultSchema,
  schemaScanErrorCodeSchema,
  schemaScanRequestSchema,
  schemaScanRunSchema,
  sha256ContentHash,
  timestampSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const successReceiptSchema = z.strictObject({
  scan_run_id: immutableIdSchema,
  snapshot_id: immutableIdSchema,
  snapshot_content_hash: contentHashSchema,
  terminal: z.literal("SUCCEEDED"),
  created: z.boolean(),
});
const failureReceiptSchema = z.strictObject({
  scan_run_id: immutableIdSchema,
  terminal: schemaScanErrorCodeSchema,
  created: z.boolean(),
});
const driftReceiptSchema = z.strictObject({
  drift_event_id: immutableIdSchema,
  event_storage_digest: contentHashSchema,
  created: z.boolean(),
});
const databaseScanRunSchema = schemaScanRunSchema.omit({ schema_version: true });
const databaseTimestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );

interface JsonValueRow {
  readonly value: unknown;
}

export interface SchemaScanFailureInput {
  readonly datasource_fingerprint: string;
  readonly scan_run_id: string;
  readonly captured_at: string;
  readonly error_code: SchemaScanErrorCode;
}

export interface PostgresSchemaSnapshotStore {
  commitSuccess(
    capability: unknown,
    request: SchemaScanRequest,
    snapshot: PhysicalSchemaSnapshot,
  ): Promise<PortResult<SchemaScanCommitResult>>;
  commitFailure(
    capability: unknown,
    request: SchemaScanRequest,
    failure: SchemaScanFailureInput,
  ): Promise<PortResult<SchemaScanCommitResult>>;
  commitDrift(
    capability: unknown,
    event: SchemaDriftEvent,
  ): Promise<PortResult<SchemaDriftCommitResult>>;
  getScan(
    capability: unknown,
    datasourceId: string,
    scanRunId: string,
  ): Promise<PortResult<SchemaScanRun>>;
  getSnapshot(capability: unknown, snapshotId: string): Promise<PortResult<PhysicalSchemaSnapshot>>;
  getDrift(
    capability: unknown,
    datasourceId: string,
    driftEventId: string,
  ): Promise<PortResult<SchemaDriftEvent>>;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  switch (message) {
    case "SCHEMA_SCAN_SCOPE_FORBIDDEN":
      return {
        ok: false,
        error: {
          code: "SCHEMA_SCAN_SCOPE_FORBIDDEN",
          message: "当前 Authority 不允许访问该 datasource 物理结构。",
          retryable: false,
        },
      };
    case "SCHEMA_SCAN_IDEMPOTENCY_CONFLICT":
      return {
        ok: false,
        error: {
          code: "SCHEMA_SCAN_IDEMPOTENCY_CONFLICT",
          message: "幂等键已绑定到不同的 schema scan 输入或结果。",
          retryable: false,
        },
      };
    case "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID":
    case "SCHEMA_SCAN_CONTENT_HASH_COLLISION":
      return {
        ok: false,
        error: {
          code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
          message: "物理结构数据不符合权威持久化契约。",
          retryable: false,
        },
      };
    case "SCHEMA_SCAN_SNAPSHOT_NOT_FOUND":
      return {
        ok: false,
        error: {
          code: "SCHEMA_SCAN_SNAPSHOT_NOT_FOUND",
          message: "Drift 引用的物理快照不存在。",
          retryable: false,
        },
      };
    default:
      return null;
  }
}

function resultValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SCHEMA_SCAN_DATABASE_CONTRACT_INVALID",
      "Schema Discovery RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

function notFound<T>(resource: string): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "SCHEMA_SCAN_NOT_FOUND",
      message: `${resource} 不存在或不在当前 Authority scope 内。`,
      retryable: false,
    },
  };
}

function datasourceId(value: unknown): string {
  return schemaScanRequestSchema.shape.datasource_id.parse(value);
}

export function createPostgresSchemaSnapshotStore(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
): PostgresSchemaSnapshotStore {
  return {
    async commitSuccess(capabilityInput, requestInput, snapshotInput) {
      const request = schemaScanRequestSchema.parse(requestInput);
      const snapshot = physicalSchemaSnapshotSchema.parse(snapshotInput);
      if (request.datasource_id !== snapshot.content.datasource_id) {
        return {
          ok: false,
          error: {
            code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
            message: "Scan request 与物理快照 datasource identity 不一致。",
            retryable: false,
          },
        };
      }
      if ((await sha256ContentHash(snapshot.content)) !== snapshot.snapshot_content_hash) {
        return {
          ok: false,
          error: {
            code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
            message: "物理快照 content hash 与内容不一致。",
            retryable: false,
          },
        };
      }
      const requestDigest = await sha256ContentHash(request);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "catalog.commit_schema_scan_success",
          correlation_id: snapshot.scan_run_id,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<JsonValueRow>(
            `select catalog.commit_schema_scan_success(
               $1::uuid, $2::uuid, $3::text, $4::uuid,
               $5::text, $6::uuid, $7::text, $8::jsonb
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              request.datasource_id,
              request.idempotency_key,
              requestDigest,
              snapshot,
            ],
          );
          const receipt = successReceiptSchema.parse(resultValue(query.rows));
          return schemaScanCommitResultSchema.parse({
            schema_version: "schema-scan-commit-result@1.0.0",
            authority: "POSTGRESQL",
            ...receipt,
          });
        },
      );
    },

    async commitFailure(capabilityInput, requestInput, failureInput) {
      const request = schemaScanRequestSchema.parse(requestInput);
      const failure = z
        .strictObject({
          datasource_fingerprint: contentHashSchema,
          scan_run_id: immutableIdSchema,
          captured_at: timestampSchema,
          error_code: schemaScanErrorCodeSchema,
        })
        .parse(failureInput);
      const requestDigest = await sha256ContentHash(request);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "catalog.commit_schema_scan_failure",
          correlation_id: failure.scan_run_id,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<JsonValueRow>(
            `select catalog.commit_schema_scan_failure(
               $1::uuid, $2::uuid, $3::text, $4::uuid,
               $5::text, $6::text, $7::uuid, $8::uuid,
               $9::text, $10::text, $11::timestamptz
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              request.datasource_id,
              failure.datasource_fingerprint,
              failure.scan_run_id,
              request.idempotency_key,
              requestDigest,
              failure.error_code,
              failure.captured_at,
            ],
          );
          const receipt = failureReceiptSchema.parse(resultValue(query.rows));
          return schemaScanCommitResultSchema.parse({
            schema_version: "schema-scan-commit-result@1.0.0",
            authority: "POSTGRESQL",
            snapshot_id: null,
            snapshot_content_hash: null,
            ...receipt,
          });
        },
      );
    },

    async commitDrift(capabilityInput, eventInput) {
      const event = schemaDriftEventSchema.parse(eventInput);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "catalog.commit_schema_drift",
          correlation_id: event.drift_event_id,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<JsonValueRow>(
            `select catalog.commit_schema_drift(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::jsonb
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              event,
            ],
          );
          const receipt = driftReceiptSchema.parse(resultValue(query.rows));
          return schemaDriftCommitResultSchema.parse({
            schema_version: "schema-drift-commit-result@1.0.0",
            authority: "POSTGRESQL",
            ...receipt,
          });
        },
      );
    },

    async getScan(capabilityInput, datasourceIdInput, scanRunIdInput) {
      const parsedDatasourceId = datasourceId(datasourceIdInput);
      const scanRunId = immutableIdSchema.parse(scanRunIdInput);
      const result = await withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "catalog.get_schema_scan",
          correlation_id: scanRunId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<JsonValueRow>(
            `select catalog.get_schema_scan(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              parsedDatasourceId,
              scanRunId,
            ],
          );
          const value = resultValue(query.rows);
          if (value === null) return null;
          const parsed = databaseScanRunSchema.parse(value);
          return schemaScanRunSchema.parse({
            schema_version: "schema-scan-run@1.0.0",
            ...parsed,
            captured_at: databaseTimestampSchema.parse(parsed.captured_at),
          });
        },
      );
      if (!result.ok) return result;
      return result.value === null ? notFound("Schema scan") : { ok: true, value: result.value };
    },

    async getSnapshot(capabilityInput, snapshotIdInput) {
      const snapshotId = immutableIdSchema.parse(snapshotIdInput);
      const result = await withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "catalog.get_physical_schema_snapshot",
          correlation_id: snapshotId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<JsonValueRow>(
            `select catalog.get_physical_schema_snapshot(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              snapshotId,
            ],
          );
          const value = resultValue(query.rows);
          return value === null ? null : physicalSchemaSnapshotSchema.parse(value);
        },
      );
      if (!result.ok) return result;
      return result.value === null
        ? notFound("Physical schema snapshot")
        : { ok: true, value: result.value };
    },

    async getDrift(capabilityInput, datasourceIdInput, driftEventIdInput) {
      const parsedDatasourceId = datasourceId(datasourceIdInput);
      const driftEventId = immutableIdSchema.parse(driftEventIdInput);
      const result = await withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "catalog.get_schema_drift",
          correlation_id: driftEventId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<JsonValueRow>(
            `select catalog.get_schema_drift(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              parsedDatasourceId,
              driftEventId,
            ],
          );
          const value = resultValue(query.rows);
          return value === null ? null : schemaDriftEventSchema.parse(value);
        },
      );
      if (!result.ok) return result;
      return result.value === null ? notFound("Schema drift") : { ok: true, value: result.value };
    },
  };
}
