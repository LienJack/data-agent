import {
  text2sqlQueryCandidateSchema,
  type Text2SqlQueryCandidate,
} from "@data-agent/contracts/agents";
import type { PhysicalSchemaSnapshot } from "@data-agent/contracts/catalog";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildGovernedDatasourceQueryRequest,
  type GovernedDatasourceQueryResult,
} from "@data-agent/contracts/datasources";
import type { PortResult } from "@data-agent/contracts/ports";
import type { WorkspaceDatasource } from "@data-agent/contracts/workspaces";
import { buildBuiltinDatasourceAdapterDescriptors } from "@data-agent/platform/datasource-adapters";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  createGovernedDatasourceAdapter,
  DatasourceAdapterPolicyError,
  parameterizePostgresqlText2SqlCandidate,
  type DatasourceAdapterTransport,
} from "@data-agent/platform/datasource-adapters";
import type { PostgresSchemaSnapshotStore } from "@data-agent/platform/catalog";
import type { PersistedSecretRef } from "@data-agent/platform/secrets";
import type pg from "pg";
import type { RunExecutionContext } from "../runs/run-worker-runner.js";
import type { DataAgentProductTeamRuntimePort } from "./data-agent-team-runner.js";

const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/u;

type EffectiveConfig = ReturnType<RunExecutionContext["getEffectiveConfig"]>;
type SemanticContextPackage = Parameters<
  DataAgentProductTeamRuntimePort["execute"]
>[0]["semantic_context_package"];

export interface PreparedText2SqlContext {
  readonly context_text: string;
  readonly datasource_id: string;
  readonly schema_snapshot_id: string;
  readonly schema_snapshot_hash: string;
  readonly allowed_relations: readonly string[];
  readonly target_capability_hash: string;
  readonly reader_role: string;
}

export interface Text2SqlQueryRuntimePort {
  prepare(input: {
    readonly effective_config: EffectiveConfig;
    readonly semantic_context_package: SemanticContextPackage;
    readonly max_context_bytes: number;
  }): Promise<PreparedText2SqlContext>;
  compileCandidate(input: {
    readonly prepared: PreparedText2SqlContext;
    readonly candidate: Text2SqlQueryCandidate;
  }): Promise<Text2SqlQueryCandidate>;
  execute(input: {
    readonly effective_config: EffectiveConfig;
    readonly prepared: PreparedText2SqlContext;
    readonly candidate: Text2SqlQueryCandidate;
    readonly timeout_ms: number;
    readonly max_rows: number;
    readonly max_bytes: number;
    readonly signal?: AbortSignal;
  }): Promise<GovernedDatasourceQueryResult>;
}

function allowedRelationBindings(prepared: PreparedText2SqlContext) {
  return prepared.allowed_relations.map((relation) => {
    const [schemaName, relationName] = relation.split(".", 2);
    if (!schemaName || !relationName) {
      throw new Text2SqlQueryRuntimeError("TEXT2SQL_ALLOWED_RELATION_INVALID");
    }
    return { schema_name: schemaName, relation_name: relationName };
  });
}

async function validateCandidate(
  prepared: PreparedText2SqlContext,
  candidate: Text2SqlQueryCandidate,
): Promise<void> {
  await assertPostgresqlText2SqlCandidatePolicy({
    sql: candidate.sql,
    parameter_count: candidate.parameters.length,
    allowed_relations: allowedRelationBindings(prepared),
  });
}

export interface PostgresqlText2SqlQueryRuntimeDependencies {
  readonly pool: pg.Pool;
  readonly capability: unknown;
  readonly schema_snapshots: Pick<PostgresSchemaSnapshotStore, "getSnapshot">;
  readonly datasources: {
    getDatasource(
      capability: unknown,
      datasourceId: unknown,
    ): Promise<PortResult<WorkspaceDatasource | null>>;
  };
  readonly secrets: {
    get(
      capability: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedSecretRef | null>>;
  };
  readonly now?: () => number;
}

class Text2SqlQueryRuntimeError extends Error {
  override readonly name = "Text2SqlQueryRuntimeError";

  constructor(readonly code: string) {
    super(code);
  }
}

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new Text2SqlQueryRuntimeError(result.error.code);
  return result.value;
}

function datasourceHash(datasource: WorkspaceDatasource) {
  return sha256ContentHash({
    datasource_id: datasource.datasource_id,
    datasource_type: datasource.type,
    status: datasource.status,
    resource_version: datasource.resource_version,
  });
}

function relations(snapshot: PhysicalSchemaSnapshot): readonly string[] {
  const result = snapshot.content.relations
    .map(({ identity }) => `${identity.schema_name}.${identity.relation_name}`)
    .sort();
  if (result.length === 0 || result.length > 256 || new Set(result).size !== result.length) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SCHEMA_RELATION_SET_INVALID");
  }
  return Object.freeze(result);
}

function schemaProjection(snapshot: PhysicalSchemaSnapshot) {
  return snapshot.content.relations.map((relation) => ({
    relation: `${relation.identity.schema_name}.${relation.identity.relation_name}`,
    description: relation.comment,
    columns: relation.columns.map((column) => ({
      name: column.column_name,
      type: column.formatted_type,
      nullable: column.nullable,
      description: column.comment,
    })),
    primary_key: relation.primary_key?.columns ?? [],
    foreign_keys: relation.foreign_keys.map((foreignKey) => ({
      columns: foreignKey.column_pairs.map(({ column_name: columnName }) => columnName),
      references: `${foreignKey.referenced_relation.schema_name}.${foreignKey.referenced_relation.relation_name}`,
      referenced_columns: foreignKey.column_pairs.map(
        ({ referenced_column_name: columnName }) => columnName,
      ),
    })),
  }));
}

function semanticProjection(packageDocument: SemanticContextPackage) {
  return {
    package_id: packageDocument.package_id,
    package_hash: packageDocument.package_hash,
    semantic_release: packageDocument.semantic_release,
    route_decision: packageDocument.route_decision,
    mandatory_closure: packageDocument.mandatory_closure,
    evidence: packageDocument.evidence.map((entry) => ({
      kind: entry.evidence_kind,
      id: entry.evidence_id,
      hash: entry.evidence_hash,
      summary: entry.summary,
    })),
  };
}

function text2sqlContext(input: {
  readonly snapshot: PhysicalSchemaSnapshot;
  readonly semantic_context_package: SemanticContextPackage;
  readonly max_context_bytes: number;
}): string {
  const context = canonicalizeJson({
    schema_snapshot: {
      snapshot_id: input.snapshot.snapshot_id,
      snapshot_content_hash: input.snapshot.snapshot_content_hash,
      datasource_id: input.snapshot.content.datasource_id,
      included_schemas: input.snapshot.content.included_schemas,
      relations: schemaProjection(input.snapshot),
    },
    semantic_context: semanticProjection(input.semantic_context_package),
  });
  if (new TextEncoder().encode(context).byteLength > input.max_context_bytes) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_CONTEXT_BUDGET_EXCEEDED");
  }
  return context;
}

type LocalTarget = Readonly<{ reader_role: string }>;

function localTarget(input: unknown): LocalTarget {
  if (
    typeof input !== "object" ||
    input === null ||
    !("reader_role" in input) ||
    typeof input.reader_role !== "string" ||
    !POSTGRES_IDENTIFIER.test(input.reader_role)
  ) {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TARGET_INVALID");
  }
  return { reader_role: input.reader_role };
}

function jsonValue(input: unknown): null | string | number | boolean | object {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    if (typeof input === "number" && !Number.isFinite(input)) {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
    }
    return input;
  }
  if (typeof input === "bigint") return input.toString();
  if (input instanceof Date) return input.toISOString();
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return `hex:${Buffer.from(input).toString("hex")}`;
  }
  if (typeof input === "object") return JSON.parse(canonicalizeJson(input)) as object;
  throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
}

function classifiedPostgresqlExecutionError(error: unknown): DatasourceAdapterPolicyError | null {
  const sqlState =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;
  if (!sqlState) return null;
  if (["42804", "42809", "42846", "42883", "42P18"].includes(sqlState)) {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_TYPE_ERROR");
  }
  if (sqlState === "42703") {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_COLUMN_NOT_FOUND");
  }
  if (sqlState === "42P01") {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_RELATION_NOT_FOUND");
  }
  if (sqlState.startsWith("22")) {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_DATA_ERROR");
  }
  return null;
}

function createManagedPostgresqlTransport(pool: pg.Pool): DatasourceAdapterTransport {
  const transaction = async <T>(
    targetInput: unknown,
    timeoutMs: number,
    execute: (client: pg.PoolClient) => Promise<T>,
  ) => {
    const target = localTarget(targetInput);
    const client = await pool.connect();
    try {
      await client.query("begin read only");
      await client.query(`set local role ${target.reader_role}`);
      await client.query("set local search_path = pg_catalog");
      await client.query(`set local statement_timeout = '${timeoutMs}ms'`);
      await client.query("set local lock_timeout = '1000ms'");
      const result = await execute(client);
      await client.query("rollback");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  const transport: DatasourceAdapterTransport = {
    async scanSchema() {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SCHEMA_SCAN_NOT_ALLOWED");
    },
    async explain({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      try {
        await transaction(target, request.limits.timeout_ms, async (client) => {
          await client.query({
            text: `explain (format json) ${request.statement}`,
            values: [...request.parameters],
          });
        });
      } catch (error) {
        throw classifiedPostgresqlExecutionError(error) ?? error;
      }
    },
    async execute({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      try {
        return await transaction(target, request.limits.timeout_ms, async (client) => {
          const result = await client.query<Record<string, unknown>>({
            text: `select * from (${request.statement}) as __data_agent_candidate limit ${request.limits.max_rows + 1}`,
            values: [...request.parameters],
          });
          const fieldNames = result.fields.map(({ name }) => name);
          if (new Set(fieldNames).size !== fieldNames.length) {
            throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
          }
          return {
            columns: result.fields.map((field) => ({
              name: field.name,
              type: field.dataTypeID === undefined ? "unknown" : String(field.dataTypeID),
            })),
            rows: result.rows.map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([key, child]) => [key, jsonValue(child)]),
              ),
            ),
          };
        });
      } catch (error) {
        if (error instanceof DatasourceAdapterPolicyError) throw error;
        throw classifiedPostgresqlExecutionError(error) ?? error;
      }
    },
  };
  return Object.freeze(transport);
}

export function createPostgresqlText2SqlQueryRuntime(
  dependencies: PostgresqlText2SqlQueryRuntimeDependencies,
): Text2SqlQueryRuntimePort {
  const descriptor = buildBuiltinDatasourceAdapterDescriptors().then((descriptors) => {
    const postgresql = descriptors.find(({ adapter_id: adapterId }) => adapterId === "postgresql");
    if (!postgresql) throw new Text2SqlQueryRuntimeError("POSTGRESQL_ADAPTER_NOT_REGISTERED");
    return postgresql;
  });

  const runtime: Text2SqlQueryRuntimePort = {
    async prepare(input) {
      const {
        effective_config: config,
        semantic_context_package,
        max_context_bytes,
      } = input;
      const snapshot = value(
        await dependencies.schema_snapshots.getSnapshot(
          dependencies.capability,
          config.schema_snapshot.resource_id,
        ),
      );
      const datasource = value(
        await dependencies.datasources.getDatasource(
          dependencies.capability,
          config.datasource.resource_id,
        ),
      );
      if (!datasource) throw new Text2SqlQueryRuntimeError("TEXT2SQL_DATASOURCE_NOT_FOUND");
      const credential = datasource.credential_ref;
      if (
        datasource.type !== "postgresql" ||
        datasource.status !== "ACTIVE" ||
        datasource.resource_version !== config.datasource.resource_revision ||
        (await datasourceHash(datasource)) !== config.datasource.resource_hash ||
        !credential ||
        credential.rotation_state !== "ACTIVE"
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_DATASOURCE_BINDING_STALE");
      }
      const secret = value(
        await dependencies.secrets.get(dependencies.capability, {
          ref: `secretref:${credential.secret_ref_id}`,
          expected_version: credential.secret_version,
        }),
      );
      if (!secret || secret.status !== "ACTIVE" || secret.version !== credential.secret_version) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_SECRET_REF_STALE");
      }
      if (
        snapshot.snapshot_id !== config.schema_snapshot.resource_id ||
        snapshot.snapshot_content_hash !== config.schema_snapshot.resource_hash ||
        snapshot.content.datasource_id !== config.datasource.resource_id ||
        semantic_context_package.schema_snapshot.resource_id !== snapshot.snapshot_id ||
        semantic_context_package.schema_snapshot.resource_hash !== snapshot.snapshot_content_hash ||
        semantic_context_package.semantic_release.resource_id !==
          config.semantic_release.resource_id ||
        semantic_context_package.semantic_release.resource_hash !== config.semantic_release.resource_hash
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_CONTEXT_BINDING_STALE");
      }
      if (!datasource.username || !POSTGRES_IDENTIFIER.test(datasource.username)) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_READER_ROLE_INVALID");
      }
      const allowedRelations = relations(snapshot);
      const targetCapabilityHash = await sha256ContentHash({
        datasource: config.datasource,
        schema_snapshot: config.schema_snapshot,
        credential_ref: credential,
        secret_ref: { ref: secret.ref, version: secret.version, status: secret.status },
        reader_role: datasource.username,
      });
      return Object.freeze({
        context_text: text2sqlContext({
          snapshot,
          semantic_context_package,
          max_context_bytes,
        }),
        datasource_id: datasource.datasource_id,
        schema_snapshot_id: snapshot.snapshot_id,
        schema_snapshot_hash: snapshot.snapshot_content_hash,
        allowed_relations: allowedRelations,
        target_capability_hash: targetCapabilityHash,
        reader_role: datasource.username,
      });
    },

    async compileCandidate(input) {
      const parameterized = await parameterizePostgresqlText2SqlCandidate({
        sql: input.candidate.sql,
        parameters: input.candidate.parameters,
      });
      const compiled = text2sqlQueryCandidateSchema.parse({
        ...input.candidate,
        ...parameterized,
      });
      await validateCandidate(input.prepared, compiled);
      return compiled;
    },

    async execute(input) {
      const adapterDescriptor = await descriptor;
      const prepared = input.prepared;
      if (
        prepared.datasource_id !== input.effective_config.datasource.resource_id ||
        prepared.schema_snapshot_id !== input.effective_config.schema_snapshot.resource_id ||
        prepared.schema_snapshot_hash !== input.effective_config.schema_snapshot.resource_hash
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_PREPARED_CONTEXT_STALE");
      }
      const request = await buildGovernedDatasourceQueryRequest({
        schema_version: "governed-datasource-query@1.0.0",
        scope: {
          app_id: input.effective_config.scope.app_id,
          tenant_id: input.effective_config.scope.tenant_id,
          environment: input.effective_config.scope.environment,
        },
        query_id: crypto.randomUUID(),
        datasource_id: prepared.datasource_id,
        adapter_ref: {
          adapter_id: adapterDescriptor.adapter_id,
          adapter_revision: adapterDescriptor.revision,
          descriptor_hash: adapterDescriptor.descriptor_hash,
          dialect: adapterDescriptor.dialect,
        },
        target_capability_hash: prepared.target_capability_hash,
        statement: input.candidate.sql,
        parameters: input.candidate.parameters,
        allowed_relations: prepared.allowed_relations,
        limits: {
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
          max_bytes: input.max_bytes,
        },
      });
      const adapter = await createGovernedDatasourceAdapter({
        descriptor: adapterDescriptor,
        target_authority: {
          authorize: async (candidate) =>
            candidate.request_hash === request.request_hash &&
            candidate.target_capability_hash === prepared.target_capability_hash
              ? {
                  ok: true,
                  value: {
                    target_capability_hash: prepared.target_capability_hash,
                    target: { reader_role: prepared.reader_role },
                  },
                }
              : {
                  ok: false,
                  error: {
                    code: "DATASOURCE_ADAPTER_TARGET_MISMATCH",
                    message: "Run-bound datasource target binding is stale.",
                    retryable: false,
                  },
                },
        },
        transport: createManagedPostgresqlTransport(dependencies.pool),
        validate_statement: (candidateRequest) =>
          validateCandidate(prepared, {
            ...input.candidate,
            sql: candidateRequest.statement,
            parameters: [...candidateRequest.parameters],
          }),
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
      const executed = await adapter.execute(request, input.signal);
      const result = value(executed);
      const actualColumns = result.columns.map(({ name }) => name);
      const expectedColumns = input.candidate.result_columns.map(({ name }) => name);
      if (
        actualColumns.length !== expectedColumns.length ||
        actualColumns.some((name, index) => name !== expectedColumns[index])
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_RESULT_SHAPE_MISMATCH");
      }
      return result;
    },
  };
  return Object.freeze(runtime);
}

export const postgresqlText2SqlQueryRuntimeInternals = Object.freeze({
  datasourceHash,
  relations,
  allowedRelationBindings,
  classifiedPostgresqlExecutionError,
  schemaProjection,
  semanticProjection,
  text2sqlContext,
});
