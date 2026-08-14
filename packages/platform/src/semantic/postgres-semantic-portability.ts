import { randomUUID } from "node:crypto";
import {
  type PortResult,
  type SemanticDatasourceMapping,
  type SemanticImportJob,
  type SemanticImportPreview,
  type SemanticImportTarget,
  type SemanticWorkspaceExport,
  semanticImportCommandInputSchema,
  semanticImportJobSchema,
  semanticImportMappingInputSchema,
  semanticImportPreviewSchema,
  semanticImportTargetSchema,
  semanticImportUploadInputSchema,
  semanticWorkspaceExportHashMaterialSchema,
  semanticWorkspaceExportSchema,
  sha256ContentHash,
  verifySemanticWorkspaceExport,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

interface ExportRow {
  readonly semantic_domain: string;
  readonly datasource_name: string;
  readonly datasource_type: SemanticImportTarget["dialect"];
  readonly release_generation: string | number;
  readonly release_digest: string;
  readonly schema_fingerprint: string;
  readonly semantic_content: unknown;
}

interface ImportJobRow {
  readonly import_id: string;
  readonly tenant_id: string;
  readonly principal_id: string;
  readonly file_name: string;
  readonly byte_size: number;
  readonly upload_hash: string;
  readonly document_content_hash: string;
  readonly format: string;
  readonly source_document: unknown;
  readonly state: string;
  readonly reason_code: string | null;
  readonly preview: unknown;
  readonly candidate_refs: unknown;
  readonly receipt_id: string | null;
  readonly mappings: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface OperationRow {
  readonly input_hash: string;
  readonly import_id: string;
}

interface TargetRow {
  readonly datasource_id: string;
  readonly display_name: string;
  readonly dialect: SemanticImportTarget["dialect"];
  readonly semantic_domains: unknown;
}

interface CandidateResultRow {
  readonly result: unknown;
}

const candidateResultSchema = z.strictObject({
  candidate_id: z.uuid(),
  revision_id: z.uuid(),
  source_revision_id: z.uuid(),
  source_digest: z.string(),
  revision_digest: z.string(),
  idempotency_digest: z.string(),
  candidate_status: z.literal("DRAFT"),
  created: z.boolean(),
});

const jobSelect = `
  select
    job.import_id,
    job.tenant_id,
    job.principal_id,
    job.file_name,
    job.byte_size,
    job.upload_hash,
    job.document_content_hash,
    job.format,
    job.source_document,
    job.state,
    job.reason_code,
    job.preview,
    job.candidate_refs,
    job.receipt_id,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'logical_ref', mapping.logical_ref,
            'target_datasource_id', mapping.target_datasource_id,
            'target_semantic_domain', mapping.target_semantic_domain
          ) order by mapping.logical_ref
        )
        from app_data_agent.semantic_import_mappings as mapping
        where mapping.app_id = job.app_id
          and mapping.tenant_id = job.tenant_id
          and mapping.environment = job.environment
          and mapping.import_id = job.import_id
      ),
      '[]'::jsonb
    ) as mappings,
    job.created_at,
    job.updated_at
  from app_data_agent.semantic_import_jobs as job
  where job.app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and job.tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and job.environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')`;

function invalid<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapJob(row: ImportJobRow): SemanticImportJob {
  const document = semanticWorkspaceExportSchema.parse(row.source_document);
  return semanticImportJobSchema.parse({
    schema_version: "semantic-import-job@1.0.0",
    import_id: row.import_id,
    workspace_id: row.tenant_id,
    file_name: row.file_name,
    byte_size: row.byte_size,
    upload_hash: row.upload_hash,
    document_content_hash: row.document_content_hash,
    format: row.format,
    datasource_refs: document.datasource_refs,
    mappings: row.mappings,
    preview: row.preview,
    state: row.state,
    reason_code: row.reason_code,
    candidates: row.candidate_refs,
    receipt_id: row.receipt_id,
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  });
}

function mapDatabaseError(error: unknown): PortResult<never> | null {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown; readonly message?: unknown })
      : null;
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  const known: Readonly<Record<string, readonly [string, string]>> = {
    SEMANTIC_IMPORT_OPERATION_CONFLICT: [
      "SEMANTIC_IMPORT_OPERATION_CONFLICT",
      "同一幂等键已用于不同的语义导入请求。",
    ],
    SEMANTIC_IMPORT_NOT_FOUND_OR_DENIED: [
      "SEMANTIC_IMPORT_NOT_FOUND_OR_DENIED",
      "导入任务不存在或无权访问。",
    ],
    SEMANTIC_IMPORT_STATE_CONFLICT: [
      "SEMANTIC_IMPORT_STATE_CONFLICT",
      "导入任务状态已变化，请刷新后重试。",
    ],
    SEMANTIC_IMPORT_MAPPING_INVALID: [
      "SEMANTIC_IMPORT_MAPPING_INVALID",
      "数据源映射无效或不属于当前工作空间。",
    ],
  };
  for (const [marker, [code, publicMessage]] of Object.entries(known)) {
    if (message.includes(marker)) return invalid(code, publicMessage);
  }
  if (candidate?.code === "23505") {
    return invalid("SEMANTIC_IMPORT_OPERATION_CONFLICT", "导入操作发生幂等冲突。");
  }
  if (candidate?.code === "23503" || candidate?.code === "42501") {
    return invalid("SEMANTIC_IMPORT_NOT_FOUND_OR_DENIED", "导入任务或映射目标不存在或无权访问。");
  }
  return null;
}

async function databaseHash(client: SqlClient, value: unknown): Promise<string> {
  const result = await client.query<{ readonly content_hash: string }>(
    "select platform.canonical_sha256($1::jsonb) as content_hash",
    [value],
  );
  const hash = result.rows[0]?.content_hash;
  if (!hash)
    throw new PersistenceBoundaryError("SEMANTIC_IMPORT_HASH_FAILED", "无法计算导入哈希。");
  return hash;
}

async function operationReplay(
  client: SqlClient,
  principalId: string,
  operationKind: string,
  idempotencyKey: string,
  inputHash: string,
): Promise<string | null> {
  const result = await client.query<OperationRow>(
    `select input_hash, import_id
      from app_data_agent.semantic_import_operations
      where app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
        and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
        and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
        and principal_id = $1::uuid
        and operation_kind = $2
        and idempotency_key = $3::uuid
      for update`,
    [principalId, operationKind, idempotencyKey],
  );
  const existing = result.rows[0];
  if (!existing) return null;
  if (existing.input_hash !== inputHash) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_IMPORT_OPERATION_CONFLICT",
      "同一幂等键已用于不同的语义导入请求。",
    );
  }
  return existing.import_id;
}

async function recordOperation(
  client: SqlClient,
  principalId: string,
  operationId: string,
  idempotencyKey: string,
  operationKind: string,
  inputHash: string,
  importId: string,
): Promise<void> {
  await client.query(
    `insert into app_data_agent.semantic_import_operations (
       app_id, tenant_id, environment, principal_id, operation_id,
       idempotency_key, operation_kind, input_hash, import_id
     ) values (
       nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid,
       nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid,
       nullif(pg_catalog.current_setting('data_agent.environment', true), ''),
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid
     )`,
    [principalId, operationId, idempotencyKey, operationKind, inputHash, importId],
  );
}

async function loadJob(client: SqlClient, importId: string, lock = false): Promise<ImportJobRow> {
  const result = await client.query<ImportJobRow>(
    `${jobSelect} and job.import_id = $1::uuid${lock ? " for update of job" : ""}`,
    [importId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_IMPORT_NOT_FOUND_OR_DENIED",
      "导入任务不存在或无权访问。",
    );
  }
  return row;
}

async function listTargetRows(client: SqlClient): Promise<readonly TargetRow[]> {
  const result = await client.query<TargetRow>(
    `select datasource_id, display_name, dialect, semantic_domains
       from semantic.read_portability_targets(
         nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid,
         nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid,
         nullif(pg_catalog.current_setting('data_agent.environment', true), '')
       )`,
  );
  return result.rows;
}

function targets(rows: readonly TargetRow[]): readonly SemanticImportTarget[] {
  return rows.map((row) =>
    semanticImportTargetSchema.parse({
      datasource_id: row.datasource_id,
      display_name: row.display_name,
      dialect: row.dialect,
      semantic_domains: row.semantic_domains,
    }),
  );
}

function validateMappings(
  document: SemanticWorkspaceExport,
  mappings: readonly SemanticDatasourceMapping[],
  availableTargets: readonly SemanticImportTarget[],
): SemanticImportPreview {
  const required = new Set(document.datasource_refs.map((reference) => reference.logical_ref));
  const mappingByRef = new Map<string, SemanticDatasourceMapping>();
  const conflicts: Array<{ code: string; logical_ref: string | null; message: string }> = [];
  for (const mapping of mappings) {
    if (mappingByRef.has(mapping.logical_ref)) {
      conflicts.push({
        code: "SEMANTIC_IMPORT_MAPPING_DUPLICATE",
        logical_ref: mapping.logical_ref,
        message: "同一逻辑数据源只能映射一次。",
      });
    }
    mappingByRef.set(mapping.logical_ref, mapping);
    if (!required.has(mapping.logical_ref)) {
      conflicts.push({
        code: "SEMANTIC_IMPORT_MAPPING_UNKNOWN_REF",
        logical_ref: mapping.logical_ref,
        message: "映射包含文件中不存在的逻辑数据源。",
      });
    }
    const target = availableTargets.find(
      (candidate) => candidate.datasource_id === mapping.target_datasource_id,
    );
    if (!target?.semantic_domains.includes(mapping.target_semantic_domain)) {
      conflicts.push({
        code: "SEMANTIC_IMPORT_MAPPING_TARGET_INVALID",
        logical_ref: mapping.logical_ref,
        message: "目标数据源或语义域不可用。",
      });
    }
  }
  const mappedDomains = new Set<string>();
  for (const mapping of mappings) {
    if (mappedDomains.has(mapping.target_semantic_domain)) {
      conflicts.push({
        code: "SEMANTIC_IMPORT_TARGET_DOMAIN_AMBIGUOUS",
        logical_ref: mapping.logical_ref,
        message: "多个源语义域不能合并到同一目标语义域。",
      });
    }
    mappedDomains.add(mapping.target_semantic_domain);
  }
  const missing = [...required].filter((logicalRef) => !mappingByRef.has(logicalRef)).sort();
  return semanticImportPreviewSchema.parse({
    schema_version: "semantic-import-preview@1.0.0",
    compatible: missing.length === 0 && conflicts.length === 0,
    missing_logical_refs: missing,
    conflicts,
    domains: document.domains.map((domain) => {
      const mapping = mappingByRef.get(domain.datasource_logical_ref);
      const hasConflict = conflicts.some(
        (conflict) => conflict.logical_ref === domain.datasource_logical_ref,
      );
      return {
        source_semantic_domain: domain.semantic_domain,
        target_semantic_domain: mapping?.target_semantic_domain ?? null,
        target_datasource_id: mapping?.target_datasource_id ?? null,
        change_kind: !mapping ? "MAPPING_REQUIRED" : hasConflict ? "CONFLICT" : "CREATE_DRAFT",
      };
    }),
  });
}

function deterministicUuid(hash: string): string {
  const hex = hash
    .replace(/^sha256:/, "")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  const variant = Number.parseInt(hex[16] ?? "0", 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export interface PostgresSemanticPortabilityRepository {
  exportPublished(capabilityInput: unknown): Promise<PortResult<SemanticWorkspaceExport>>;
  listTargets(capabilityInput: unknown): Promise<PortResult<readonly SemanticImportTarget[]>>;
  upload(capabilityInput: unknown, input: unknown): Promise<PortResult<SemanticImportJob>>;
  listImports(capabilityInput: unknown): Promise<PortResult<readonly SemanticImportJob[]>>;
  getImport(capabilityInput: unknown, importId: unknown): Promise<PortResult<SemanticImportJob>>;
  saveMappings(capabilityInput: unknown, input: unknown): Promise<PortResult<SemanticImportJob>>;
  dryRun(capabilityInput: unknown, input: unknown): Promise<PortResult<SemanticImportJob>>;
  commit(capabilityInput: unknown, input: unknown): Promise<PortResult<SemanticImportJob>>;
  cancel(capabilityInput: unknown, input: unknown): Promise<PortResult<SemanticImportJob>>;
}

export function createPostgresSemanticPortabilityRepository(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
): PostgresSemanticPortabilityRepository {
  const transactionOptions = { map_database_error: mapDatabaseError } as const;

  return {
    async exportPublished(capabilityInput) {
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "semantic.portability.export", ...transactionOptions },
        async ({ client, capability }) => {
          const result = await client.query<ExportRow>(
            `select * from semantic.read_portable_published_semantic(
               $1::uuid, $2::uuid, $3
             )`,
            [capability.scope.app_id, capability.scope.tenant_id, capability.scope.environment],
          );
          if (result.rows.length === 0) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_EXPORT_EMPTY",
              "当前工作空间还没有可导出的已发布语义版本。",
            );
          }
          const datasourceRefs = result.rows.map((row) => ({
            logical_ref: `${row.semantic_domain}:primary`,
            display_name: row.datasource_name,
            dialect: row.datasource_type,
            schema_fingerprint: row.schema_fingerprint,
          }));
          const material = semanticWorkspaceExportHashMaterialSchema.parse({
            format: "semantic-workspace-export@1.0.0",
            compatibility: {
              semantic_protocol_version: "semantic-source-payload@1.0.0",
              minimum_importer_version: "data-agent@0.1.0",
            },
            datasource_refs: datasourceRefs,
            domains: result.rows.map((row) => ({
              semantic_domain: row.semantic_domain,
              datasource_logical_ref: `${row.semantic_domain}:primary`,
              source_release: {
                generation: String(row.release_generation),
                digest: row.release_digest,
              },
              semantic: row.semantic_content,
            })),
          });
          if (containsPotentialPlaintextSecret(material)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_EXPORT_SECRET_DETECTED",
              "已发布语义包含不可导出的敏感字段。",
            );
          }
          return semanticWorkspaceExportSchema.parse({
            ...material,
            exported_at: new Date().toISOString(),
            content_hash: await sha256ContentHash(material),
          });
        },
      );
    },

    async listTargets(capabilityInput) {
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "semantic.portability.targets", ...transactionOptions },
        async ({ client }) => targets(await listTargetRows(client)),
      );
    },

    async upload(capabilityInput, input) {
      const parsed = semanticImportUploadInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalid("SEMANTIC_IMPORT_INPUT_INVALID", "语义导入文件不符合上传契约。");
      }
      let document: SemanticWorkspaceExport;
      try {
        document = await verifySemanticWorkspaceExport(parsed.data.document);
      } catch (error) {
        const code = error instanceof Error ? error.message : "SEMANTIC_IMPORT_INPUT_INVALID";
        return invalid(
          /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "SEMANTIC_IMPORT_INPUT_INVALID",
          "语义导入文件版本、结构或内容哈希无效。",
        );
      }
      if (containsPotentialPlaintextSecret(document)) {
        return invalid("SEMANTIC_IMPORT_SECRET_DETECTED", "语义导入文件包含疑似明文凭据。");
      }
      const canonicalBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
      if (canonicalBytes > parsed.data.byte_size) {
        return invalid("SEMANTIC_IMPORT_SIZE_MISMATCH", "声明的文件大小小于实际文档大小。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "semantic.portability.upload", ...transactionOptions },
        async ({ client, capability }) => {
          const inputHash = await databaseHash(client, parsed.data);
          const replay = await operationReplay(
            client,
            capability.principal,
            "UPLOAD",
            parsed.data.idempotency_key,
            inputHash,
          );
          if (replay) return mapJob(await loadJob(client, replay));
          const importId = parsed.data.operation_id;
          const uploadHash = await sha256ContentHash(document);
          await client.query(
            `insert into app_data_agent.semantic_import_jobs (
               app_id, tenant_id, environment, import_id, principal_id,
               file_name, byte_size, upload_hash, document_content_hash,
               format, source_document, state
             ) values (
               $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
               $6, $7, $8, $9, $10, $11::jsonb, 'AWAITING_DATASOURCE_MAPPING'
             )`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              importId,
              capability.principal,
              parsed.data.file_name,
              parsed.data.byte_size,
              uploadHash,
              document.content_hash,
              document.format,
              document,
            ],
          );
          await recordOperation(
            client,
            capability.principal,
            parsed.data.operation_id,
            parsed.data.idempotency_key,
            "UPLOAD",
            inputHash,
            importId,
          );
          await client.query(
            `insert into app_data_agent.audit_log (
               app_id, tenant_id, environment, audit_id, principal_id,
               action, resource_type, resource_id, details
             ) values ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
               'SEMANTIC_IMPORT_UPLOADED', 'semantic_import', $6,
               pg_catalog.jsonb_build_object(
                 'import_id', $6,
                 'format', $7,
                 'upload_hash', $8,
                 'document_content_hash', $9,
                 'byte_size', $10
               ))`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              randomUUID(),
              capability.principal,
              importId,
              document.format,
              uploadHash,
              document.content_hash,
              parsed.data.byte_size,
            ],
          );
          return mapJob(await loadJob(client, importId));
        },
      );
    },

    async listImports(capabilityInput) {
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "semantic.portability.list", ...transactionOptions },
        async ({ client }) => {
          const result = await client.query<ImportJobRow>(
            `${jobSelect} order by job.created_at desc, job.import_id`,
          );
          return result.rows.map(mapJob);
        },
      );
    },

    async getImport(capabilityInput, importId) {
      const parsed = z.uuid().safeParse(importId);
      if (!parsed.success) {
        return invalid("SEMANTIC_IMPORT_INPUT_INVALID", "导入任务标识无效。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "semantic.portability.get", ...transactionOptions },
        async ({ client }) => mapJob(await loadJob(client, parsed.data)),
      );
    },

    async saveMappings(capabilityInput, input) {
      const parsed = semanticImportMappingInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalid("SEMANTIC_IMPORT_INPUT_INVALID", "语义数据源映射不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "semantic.portability.map", ...transactionOptions },
        async ({ client, capability }) => {
          const inputHash = await databaseHash(client, parsed.data);
          const replay = await operationReplay(
            client,
            capability.principal,
            "MAP",
            parsed.data.idempotency_key,
            inputHash,
          );
          if (replay) return mapJob(await loadJob(client, replay));
          const row = await loadJob(client, parsed.data.import_id, true);
          if (["DRAFT_CREATED", "FAILED", "CANCELLED"].includes(row.state)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_IMPORT_STATE_CONFLICT",
              "终态导入任务不能修改映射。",
            );
          }
          const document = await verifySemanticWorkspaceExport(row.source_document);
          const availableTargets = targets(await listTargetRows(client));
          const preview = validateMappings(document, parsed.data.mappings, availableTargets);
          if (preview.conflicts.length > 0) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_IMPORT_MAPPING_INVALID",
              "数据源映射包含不可用或跨工作空间目标。",
            );
          }
          await client.query(
            `delete from app_data_agent.semantic_import_mappings
              where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3
                and import_id = $4::uuid`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.import_id,
            ],
          );
          for (const mapping of [...parsed.data.mappings].sort((a, b) =>
            a.logical_ref < b.logical_ref ? -1 : a.logical_ref > b.logical_ref ? 1 : 0,
          )) {
            await client.query(
              `insert into app_data_agent.semantic_import_mappings (
                 app_id, tenant_id, environment, import_id, logical_ref,
                 target_datasource_id, target_semantic_domain, mapped_by_principal_id
               ) values ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7, $8::uuid)`,
              [
                capability.scope.app_id,
                capability.scope.tenant_id,
                capability.scope.environment,
                parsed.data.import_id,
                mapping.logical_ref,
                mapping.target_datasource_id,
                mapping.target_semantic_domain,
                capability.principal,
              ],
            );
          }
          const mappingHash = await databaseHash(
            client,
            [...parsed.data.mappings].sort((a, b) =>
              a.logical_ref < b.logical_ref ? -1 : a.logical_ref > b.logical_ref ? 1 : 0,
            ),
          );
          await client.query(
            `update app_data_agent.semantic_import_jobs
                set state = 'AWAITING_DATASOURCE_MAPPING',
                    mapping_hash = $5,
                    preview = $6::jsonb,
                    reason_code = null,
                    updated_at = pg_catalog.clock_timestamp()
              where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3
                and import_id = $4::uuid`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.import_id,
              mappingHash,
              preview,
            ],
          );
          await recordOperation(
            client,
            capability.principal,
            parsed.data.operation_id,
            parsed.data.idempotency_key,
            "MAP",
            inputHash,
            parsed.data.import_id,
          );
          return mapJob(await loadJob(client, parsed.data.import_id));
        },
      );
    },

    async dryRun(capabilityInput, input) {
      const parsed = semanticImportCommandInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalid("SEMANTIC_IMPORT_INPUT_INVALID", "语义导入预检命令不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "semantic.portability.dry_run", ...transactionOptions },
        async ({ client, capability }) => {
          const inputHash = await databaseHash(client, parsed.data);
          const replay = await operationReplay(
            client,
            capability.principal,
            "DRY_RUN",
            parsed.data.idempotency_key,
            inputHash,
          );
          if (replay) return mapJob(await loadJob(client, replay));
          const row = await loadJob(client, parsed.data.import_id, true);
          if (["DRAFT_CREATED", "FAILED", "CANCELLED"].includes(row.state)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_IMPORT_STATE_CONFLICT",
              "终态导入任务不能重新预检。",
            );
          }
          const document = await verifySemanticWorkspaceExport(row.source_document);
          const mappedJob = mapJob(row);
          const preview = validateMappings(
            document,
            mappedJob.mappings,
            targets(await listTargetRows(client)),
          );
          await client.query(
            `update app_data_agent.semantic_import_jobs
                set state = $5,
                    preview = $6::jsonb,
                    reason_code = null,
                    updated_at = pg_catalog.clock_timestamp()
              where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3
                and import_id = $4::uuid`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.import_id,
              preview.compatible ? "READY" : "AWAITING_DATASOURCE_MAPPING",
              preview,
            ],
          );
          await recordOperation(
            client,
            capability.principal,
            parsed.data.operation_id,
            parsed.data.idempotency_key,
            "DRY_RUN",
            inputHash,
            parsed.data.import_id,
          );
          return mapJob(await loadJob(client, parsed.data.import_id));
        },
      );
    },

    async commit(capabilityInput, input) {
      const parsed = semanticImportCommandInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalid("SEMANTIC_IMPORT_INPUT_INVALID", "语义导入提交命令不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "semantic.portability.commit", ...transactionOptions },
        async ({ client, capability }) => {
          const inputHash = await databaseHash(client, parsed.data);
          const replay = await operationReplay(
            client,
            capability.principal,
            "COMMIT",
            parsed.data.idempotency_key,
            inputHash,
          );
          if (replay) return mapJob(await loadJob(client, replay));
          const row = await loadJob(client, parsed.data.import_id, true);
          if (row.state === "DRAFT_CREATED") return mapJob(row);
          if (row.state !== "READY") {
            throw new PersistenceBoundaryError(
              "SEMANTIC_IMPORT_STATE_CONFLICT",
              "只有通过预检的 READY 导入任务才能创建草稿。",
            );
          }
          const document = await verifySemanticWorkspaceExport(row.source_document);
          const job = mapJob(row);
          const preview = validateMappings(
            document,
            job.mappings,
            targets(await listTargetRows(client)),
          );
          if (!preview.compatible) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_IMPORT_MAPPING_INVALID",
              "提交前数据源映射已经失效。",
            );
          }
          const candidates: Array<{
            semantic_domain: string;
            candidate_id: string;
            revision_id: string;
          }> = [];
          for (const domain of document.domains) {
            const mapping = job.mappings.find(
              (candidate) => candidate.logical_ref === domain.datasource_logical_ref,
            );
            if (!mapping) {
              throw new PersistenceBoundaryError(
                "SEMANTIC_IMPORT_MAPPING_INVALID",
                "提交前数据源映射已经失效。",
              );
            }
            await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
              mapping.target_semantic_domain,
            ]);
            const candidateKey = deterministicUuid(
              await sha256ContentHash({
                import_id: parsed.data.import_id,
                logical_ref: mapping.logical_ref,
                target_datasource_id: mapping.target_datasource_id,
                target_semantic_domain: mapping.target_semantic_domain,
                document_content_hash: document.content_hash,
              }),
            );
            const created = await client.query<CandidateResultRow>(
              `select semantic.create_candidate_draft(
                 $1::uuid, $2::uuid, $3, $4, $5, $6::uuid,
                 $7, $8, 'MAJOR', 'HIGH', $9::jsonb, $10::jsonb
               ) as result`,
              [
                capability.scope.app_id,
                capability.scope.tenant_id,
                capability.scope.environment,
                mapping.target_semantic_domain,
                capability.principal,
                candidateKey,
                `导入语义：${domain.semantic_domain}`,
                `由 semantic-workspace-export@1.0.0 导入，仅创建待治理草稿。`,
                {
                  schema_version: "semantic-source-payload@1.0.0",
                  source_kind: "MANUAL",
                  content: domain.semantic,
                },
                {
                  schema_version: "semantic-diff@1.0.0",
                  summary: `导入 ${domain.semantic_domain} 为待治理草稿`,
                  operations: [
                    {
                      path: "/",
                      change_type: "ADD",
                      after: domain.semantic,
                    },
                  ],
                },
              ],
            );
            const result = candidateResultSchema.parse(created.rows[0]?.result);
            candidates.push({
              semantic_domain: mapping.target_semantic_domain,
              candidate_id: result.candidate_id,
              revision_id: result.revision_id,
            });
          }
          const receiptId = parsed.data.operation_id;
          const mappingHash = await databaseHash(client, job.mappings);
          await client.query(
            `insert into app_data_agent.semantic_import_receipts (
               app_id, tenant_id, environment, receipt_id, import_id, principal_id,
               upload_hash, document_content_hash, mapping_hash, candidate_refs
             ) values ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid,
               $7, $8, $9, $10::jsonb)`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              receiptId,
              parsed.data.import_id,
              capability.principal,
              job.upload_hash,
              document.content_hash,
              mappingHash,
              candidates,
            ],
          );
          await client.query(
            `update app_data_agent.semantic_import_jobs
                set state = 'DRAFT_CREATED',
                    candidate_refs = $5::jsonb,
                    receipt_id = $6::uuid,
                    reason_code = null,
                    updated_at = pg_catalog.clock_timestamp()
              where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3
                and import_id = $4::uuid`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.import_id,
              candidates,
              receiptId,
            ],
          );
          await client.query(
            `insert into app_data_agent.audit_log (
               app_id, tenant_id, environment, audit_id, principal_id,
               action, resource_type, resource_id, details
             ) values ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
               'SEMANTIC_IMPORT_DRAFT_CREATED', 'semantic_import', $6,
               pg_catalog.jsonb_build_object(
                 'import_id', $6,
                 'receipt_id', $7,
                 'schema_version', 'semantic-workspace-export@1.0.0',
                 'upload_hash', $8,
                 'document_content_hash', $9,
                 'mapping_hash', $10,
                 'candidate_refs', $11::jsonb
               ))`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              randomUUID(),
              capability.principal,
              parsed.data.import_id,
              receiptId,
              job.upload_hash,
              document.content_hash,
              mappingHash,
              candidates,
            ],
          );
          await recordOperation(
            client,
            capability.principal,
            parsed.data.operation_id,
            parsed.data.idempotency_key,
            "COMMIT",
            inputHash,
            parsed.data.import_id,
          );
          return mapJob(await loadJob(client, parsed.data.import_id));
        },
      );
    },

    async cancel(capabilityInput, input) {
      const parsed = semanticImportCommandInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalid("SEMANTIC_IMPORT_INPUT_INVALID", "语义导入取消命令不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "semantic.portability.cancel", ...transactionOptions },
        async ({ client, capability }) => {
          const inputHash = await databaseHash(client, parsed.data);
          const replay = await operationReplay(
            client,
            capability.principal,
            "CANCEL",
            parsed.data.idempotency_key,
            inputHash,
          );
          if (replay) return mapJob(await loadJob(client, replay));
          const row = await loadJob(client, parsed.data.import_id, true);
          if (["DRAFT_CREATED", "FAILED"].includes(row.state)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_IMPORT_STATE_CONFLICT",
              "已完成或失败的导入任务不能取消。",
            );
          }
          await client.query(
            `update app_data_agent.semantic_import_jobs
                set state = 'CANCELLED',
                    reason_code = 'SEMANTIC_IMPORT_CANCELLED_BY_USER',
                    updated_at = pg_catalog.clock_timestamp()
              where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3
                and import_id = $4::uuid`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.import_id,
            ],
          );
          await recordOperation(
            client,
            capability.principal,
            parsed.data.operation_id,
            parsed.data.idempotency_key,
            "CANCEL",
            inputHash,
            parsed.data.import_id,
          );
          return mapJob(await loadJob(client, parsed.data.import_id));
        },
      );
    },
  };
}
