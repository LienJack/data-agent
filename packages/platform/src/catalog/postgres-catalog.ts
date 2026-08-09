import {
  contentHashSchema,
  type ForeignKey,
  immutableIdSchema,
  type PhysicalIndex,
  type PhysicalRelation,
  type PhysicalSchemaSnapshot,
  type PortResult,
  type SchemaScanErrorCode,
  schemaScanRequestSchema,
  timestampSchema,
} from "@data-agent/contracts";
import { type Pool, type PoolClient, Query, type QueryResultRow } from "pg";
import { z } from "zod";
import { CatalogContractError, createPhysicalSchemaSnapshot } from "./physical-schema.js";

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const SET_TIMEOUTS_SQL = `/* data-agent:catalog-timeouts@1 */
select
  pg_catalog.set_config('statement_timeout', $1::text, true),
  pg_catalog.set_config('lock_timeout', $2::text, true),
  pg_catalog.set_config('idle_in_transaction_session_timeout', $3::text, true)`;
const PREFLIGHT_SQL = `/* data-agent:catalog-preflight@1 */
select
  pg_catalog.current_setting('transaction_read_only') as transaction_read_only,
  pg_catalog.current_setting('server_version_num') as server_version_num,
  pg_catalog.current_database() as database_name,
  d.oid::text as database_oid
from pg_catalog.pg_database as d
where d.datname = pg_catalog.current_database()`;
const RELATIONS_SQL = `/* data-agent:catalog-relations@1 */
select
  n.nspname as schema_name,
  c.relname as relation_name,
  case c.relkind
    when 'r' then 'TABLE'
    when 'p' then 'PARTITIONED_TABLE'
    when 'v' then 'VIEW'
    when 'm' then 'MATERIALIZED_VIEW'
    when 'f' then 'FOREIGN_TABLE'
  end as relation_kind,
  pg_catalog.obj_description(c.oid, 'pg_class') as comment
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = any($1::text[])
  and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and (n.nspname, c.relname) > ($2::text, $3::text)
order by n.nspname, c.relname
limit $4::integer`;
const COLUMNS_SQL = `/* data-agent:catalog-columns@1 */
with wanted(schema_name, relation_name) as (
  select schema_name, relation_name
  from rows from (pg_catalog.unnest($1::text[]), pg_catalog.unnest($2::text[]))
    as requested(schema_name, relation_name)
)
select
  n.nspname as schema_name,
  c.relname as relation_name,
  a.attname as column_name,
  a.attnum::integer as ordinal_position,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as formatted_type,
  tn.nspname as type_schema,
  t.typname as type_name,
  case t.typtype
    when 'b' then 'BASE'
    when 'd' then 'DOMAIN'
    when 'e' then 'ENUM'
    when 'c' then 'COMPOSITE'
    when 'p' then 'PSEUDO'
    when 'r' then 'RANGE'
    when 'm' then 'MULTIRANGE'
  end as type_kind,
  a.attndims::integer as array_dimensions,
  not a.attnotnull as nullable,
  case when a.attgenerated = '' then pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) end as default_expression,
  case a.attidentity when 'a' then 'ALWAYS' when 'd' then 'BY_DEFAULT' end as identity_generation,
  case when a.attgenerated <> '' then pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) end as generated_expression,
  pg_catalog.col_description(c.oid, a.attnum) as comment
from wanted as w
join pg_catalog.pg_namespace as n on n.nspname = w.schema_name
join pg_catalog.pg_class as c on c.relnamespace = n.oid and c.relname = w.relation_name
join pg_catalog.pg_attribute as a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_catalog.pg_type as t on t.oid = a.atttypid
join pg_catalog.pg_namespace as tn on tn.oid = t.typnamespace
left join pg_catalog.pg_attrdef as ad on ad.adrelid = c.oid and ad.adnum = a.attnum
order by n.nspname, c.relname, a.attname`;
const CONSTRAINTS_SQL = `/* data-agent:catalog-constraints@1 */
with wanted(schema_name, relation_name) as (
  select schema_name, relation_name
  from rows from (pg_catalog.unnest($1::text[]), pg_catalog.unnest($2::text[]))
    as requested(schema_name, relation_name)
)
select
  n.nspname as schema_name,
  c.relname as relation_name,
  case con.contype when 'p' then 'PRIMARY_KEY' when 'f' then 'FOREIGN_KEY'
    when 'u' then 'UNIQUE' when 'c' then 'CHECK' end as constraint_type,
  con.conname as constraint_name,
  pg_catalog.to_jsonb(coalesce((
    select pg_catalog.array_agg(a.attname order by key_column.ordinality)
    from pg_catalog.unnest(con.conkey) with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute as a on a.attrelid = con.conrelid and a.attnum = key_column.attnum
  ), array[]::text[])) as columns,
  rn.nspname as referenced_schema_name,
  rc.relname as referenced_relation_name,
  pg_catalog.to_jsonb(coalesce((
    select pg_catalog.array_agg(a.attname order by key_column.ordinality)
    from pg_catalog.unnest(con.confkey) with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute as a on a.attrelid = con.confrelid and a.attnum = key_column.attnum
  ), array[]::text[])) as referenced_columns,
  case con.confmatchtype when 'f' then 'FULL' when 'p' then 'PARTIAL' when 's' then 'SIMPLE' end as match_type,
  case con.confupdtype when 'a' then 'NO_ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
    when 'n' then 'SET_NULL' when 'd' then 'SET_DEFAULT' end as on_update,
  case con.confdeltype when 'a' then 'NO_ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
    when 'n' then 'SET_NULL' when 'd' then 'SET_DEFAULT' end as on_delete,
  con.condeferrable as deferrable,
  con.condeferred as initially_deferred,
  case when con.contype = 'c' then pg_catalog.pg_get_constraintdef(con.oid, true) end as check_expression,
  con.connoinherit as no_inherit,
  coalesce(i.indnullsnotdistinct, false) as nulls_not_distinct
from wanted as w
join pg_catalog.pg_namespace as n on n.nspname = w.schema_name
join pg_catalog.pg_class as c on c.relnamespace = n.oid and c.relname = w.relation_name
join pg_catalog.pg_constraint as con on con.conrelid = c.oid and con.contype in ('p', 'f', 'u', 'c')
left join pg_catalog.pg_class as rc on rc.oid = con.confrelid
left join pg_catalog.pg_namespace as rn on rn.oid = rc.relnamespace
left join pg_catalog.pg_index as i on i.indexrelid = con.conindid
order by n.nspname, c.relname, constraint_type, con.conname`;
const INDEXES_SQL = `/* data-agent:catalog-indexes@1 */
with wanted(schema_name, relation_name) as (
  select schema_name, relation_name
  from rows from (pg_catalog.unnest($1::text[]), pg_catalog.unnest($2::text[]))
    as requested(schema_name, relation_name)
)
select
  n.nspname as schema_name,
  c.relname as relation_name,
  ic.relname as index_name,
  am.amname as access_method,
  i.indisunique as unique,
  i.indisvalid as valid,
  i.indisready as ready,
  pg_catalog.to_jsonb(array(
    select pg_catalog.pg_get_indexdef(i.indexrelid, position, true)
    from pg_catalog.generate_series(1, i.indnkeyatts::integer) as position
    order by position
  )) as key_expressions,
  pg_catalog.to_jsonb(array(
    select a.attname
    from pg_catalog.unnest(i.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute as a on a.attrelid = i.indrelid and a.attnum = key_column.attnum
    where key_column.ordinality > i.indnkeyatts
    order by key_column.ordinality
  )) as included_columns,
  pg_catalog.pg_get_expr(i.indpred, i.indrelid) as predicate
from wanted as w
join pg_catalog.pg_namespace as n on n.nspname = w.schema_name
join pg_catalog.pg_class as c on c.relnamespace = n.oid and c.relname = w.relation_name
join pg_catalog.pg_index as i on i.indrelid = c.oid
join pg_catalog.pg_class as ic on ic.oid = i.indexrelid
join pg_catalog.pg_am as am on am.oid = ic.relam
order by n.nspname, c.relname, ic.relname`;
const ROLLBACK_SQL = "ROLLBACK";

const trustedScanInputSchema = z.strictObject({
  request: schemaScanRequestSchema,
  datasource_fingerprint: contentHashSchema,
  snapshot_id: immutableIdSchema,
  scan_run_id: immutableIdSchema,
  captured_at: timestampSchema,
});
const preflightRowSchema = z.strictObject({
  transaction_read_only: z.literal("on"),
  server_version_num: z.string().regex(/^\d{6}$/),
  database_name: z.string().min(1).max(256),
  database_oid: z.coerce.number().int().positive().safe(),
});
const relationRowSchema = z.strictObject({
  schema_name: z.string().min(1).max(256),
  relation_name: z.string().min(1).max(256),
  relation_kind: z.enum([
    "TABLE",
    "PARTITIONED_TABLE",
    "VIEW",
    "MATERIALIZED_VIEW",
    "FOREIGN_TABLE",
  ]),
  comment: z.string().max(32_768).nullable(),
});
const columnRowSchema = z.strictObject({
  schema_name: z.string().min(1).max(256),
  relation_name: z.string().min(1).max(256),
  column_name: z.string().min(1).max(256),
  ordinal_position: z.coerce.number().int().positive(),
  formatted_type: z.string().min(1).max(2_048),
  type_schema: z.string().min(1).max(256),
  type_name: z.string().min(1).max(256),
  type_kind: z.enum(["BASE", "DOMAIN", "ENUM", "COMPOSITE", "PSEUDO", "RANGE", "MULTIRANGE"]),
  array_dimensions: z.coerce.number().int().min(0).max(32),
  nullable: z.boolean(),
  default_expression: z.string().max(32_768).nullable(),
  identity_generation: z.enum(["ALWAYS", "BY_DEFAULT"]).nullable(),
  generated_expression: z.string().max(32_768).nullable(),
  comment: z.string().max(32_768).nullable(),
});
const constraintRowSchema = z.strictObject({
  schema_name: z.string().min(1).max(256),
  relation_name: z.string().min(1).max(256),
  constraint_type: z.enum(["PRIMARY_KEY", "FOREIGN_KEY", "UNIQUE", "CHECK"]),
  constraint_name: z.string().min(1).max(256),
  columns: z.array(z.string().min(1).max(256)).max(1_000),
  referenced_schema_name: z.string().min(1).max(256).nullable(),
  referenced_relation_name: z.string().min(1).max(256).nullable(),
  referenced_columns: z.array(z.string().min(1).max(256)).max(1_000),
  match_type: z.enum(["FULL", "PARTIAL", "SIMPLE"]).nullable(),
  on_update: z.enum(["NO_ACTION", "RESTRICT", "CASCADE", "SET_NULL", "SET_DEFAULT"]).nullable(),
  on_delete: z.enum(["NO_ACTION", "RESTRICT", "CASCADE", "SET_NULL", "SET_DEFAULT"]).nullable(),
  deferrable: z.boolean(),
  initially_deferred: z.boolean(),
  check_expression: z.string().min(1).max(32_768).nullable(),
  no_inherit: z.boolean(),
  nulls_not_distinct: z.boolean(),
});
const indexRowSchema = z.strictObject({
  schema_name: z.string().min(1).max(256),
  relation_name: z.string().min(1).max(256),
  index_name: z.string().min(1).max(256),
  access_method: z.string().min(1).max(256),
  unique: z.boolean(),
  valid: z.boolean(),
  ready: z.boolean(),
  key_expressions: z.array(z.string().min(1).max(32_768)).min(1).max(1_000),
  included_columns: z.array(z.string().min(1).max(256)).max(1_000),
  predicate: z.string().max(32_768).nullable(),
});

export interface PostgresCatalogQuery {
  readonly text: string;
  readonly values?: readonly unknown[];
  readonly signal?: AbortSignal;
}

export interface PostgresCatalogClient {
  query<Row extends object = Record<string, unknown>>(
    query: PostgresCatalogQuery,
  ): Promise<{ readonly rows: readonly Row[] }>;
  release(): void;
}

export interface PostgresCatalogConnector {
  connect(): Promise<PostgresCatalogClient>;
}

export interface PostgresCatalogScanner {
  scan(input: unknown, signal?: AbortSignal): Promise<PortResult<PhysicalSchemaSnapshot>>;
}

class CatalogLimitError extends Error {}
class CatalogCancelledError extends Error {}

function relationKey(schemaName: string, relationName: string): string {
  return JSON.stringify([schemaName, relationName]);
}

function publicFailure(
  code: SchemaScanErrorCode,
  message: string,
  retryable: boolean,
): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function mapCatalogFailure(error: unknown, signal?: AbortSignal): PortResult<never> {
  if (signal?.aborted || error instanceof CatalogCancelledError) {
    return publicFailure("SCHEMA_SCAN_CANCELLED", "物理结构扫描已取消。", false);
  }
  if (error instanceof CatalogLimitError) {
    return publicFailure("SCHEMA_SCAN_LIMIT_EXCEEDED", "物理结构超过服务端扫描上限。", false);
  }
  if (error instanceof CatalogContractError || error instanceof z.ZodError) {
    return publicFailure(
      "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
      "Datasource catalog 返回了不符合物理快照契约的数据。",
      false,
    );
  }
  const code = errorCode(error);
  if (code === "57014") {
    return publicFailure("SCHEMA_SCAN_TIMEOUT", "物理结构扫描超时。", true);
  }
  if (code === "42501" || code === "28000" || code === "28P01") {
    return publicFailure(
      "SCHEMA_SCAN_PERMISSION_DENIED",
      "Datasource 权限不足，无法读取允许范围内的 catalog。",
      false,
    );
  }
  return publicFailure(
    "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
    "当前无法读取 datasource 物理结构。",
    true,
  );
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CatalogCancelledError();
}

function assertAllowedSchemas(schemaNames: readonly string[]): void {
  const denied = schemaNames.find(
    (schemaName) =>
      schemaName === "pg_catalog" ||
      schemaName === "information_schema" ||
      schemaName === "pg_toast" ||
      schemaName.startsWith("pg_temp_") ||
      schemaName.startsWith("pg_toast_temp_"),
  );
  if (denied) {
    throw new CatalogContractError("内部或临时 schema 不允许进入 datasource 扫描 allowlist。");
  }
}

function parseRows<T>(schema: z.ZodType<T>, rows: readonly unknown[]): T[] {
  return rows.map((row) => schema.parse(row));
}

function lookupRelation(
  relations: Map<string, PhysicalRelation>,
  schemaName: string,
  relationName: string,
): PhysicalRelation {
  const relation = relations.get(relationKey(schemaName, relationName));
  if (!relation) throw new CatalogContractError();
  return relation;
}

function appendColumns(relations: Map<string, PhysicalRelation>, rows: readonly unknown[]): void {
  for (const row of parseRows(columnRowSchema, rows)) {
    const relation = lookupRelation(relations, row.schema_name, row.relation_name);
    relation.columns.push({
      column_name: row.column_name,
      ordinal_position: row.ordinal_position,
      formatted_type: row.formatted_type,
      type_identity: {
        type_schema: row.type_schema,
        type_name: row.type_name,
        type_kind: row.type_kind,
        array_dimensions: row.array_dimensions,
      },
      nullable: row.nullable,
      default_expression: row.default_expression,
      identity_generation: row.identity_generation,
      generated_expression: row.generated_expression,
      comment: row.comment,
    });
  }
}

function foreignKey(row: z.infer<typeof constraintRowSchema>): ForeignKey {
  if (
    !row.referenced_schema_name ||
    !row.referenced_relation_name ||
    !row.match_type ||
    !row.on_update ||
    !row.on_delete ||
    row.columns.length === 0 ||
    row.columns.length !== row.referenced_columns.length
  ) {
    throw new CatalogContractError();
  }
  return {
    constraint_name: row.constraint_name,
    referenced_relation: {
      schema_name: row.referenced_schema_name,
      relation_name: row.referenced_relation_name,
    },
    column_pairs: row.columns.map((columnName, index) => ({
      column_name: columnName,
      referenced_column_name: row.referenced_columns[index] ?? "",
    })),
    match_type: row.match_type,
    on_update: row.on_update,
    on_delete: row.on_delete,
    deferrable: row.deferrable,
    initially_deferred: row.initially_deferred,
  };
}

function appendConstraints(
  relations: Map<string, PhysicalRelation>,
  rows: readonly unknown[],
): void {
  for (const row of parseRows(constraintRowSchema, rows)) {
    const relation = lookupRelation(relations, row.schema_name, row.relation_name);
    switch (row.constraint_type) {
      case "PRIMARY_KEY":
        if (row.columns.length === 0) throw new CatalogContractError();
        if (relation.primary_key) throw new CatalogContractError();
        relation.primary_key = {
          constraint_name: row.constraint_name,
          columns: row.columns,
          deferrable: row.deferrable,
          initially_deferred: row.initially_deferred,
        };
        break;
      case "FOREIGN_KEY":
        relation.foreign_keys.push(foreignKey(row));
        break;
      case "UNIQUE":
        if (row.columns.length === 0) throw new CatalogContractError();
        relation.unique_constraints.push({
          constraint_name: row.constraint_name,
          columns: row.columns,
          nulls_not_distinct: row.nulls_not_distinct,
          deferrable: row.deferrable,
          initially_deferred: row.initially_deferred,
        });
        break;
      case "CHECK":
        if (!row.check_expression) throw new CatalogContractError();
        relation.check_constraints.push({
          constraint_name: row.constraint_name,
          expression: row.check_expression,
          no_inherit: row.no_inherit,
        });
        break;
    }
  }
}

function appendIndexes(relations: Map<string, PhysicalRelation>, rows: readonly unknown[]): void {
  for (const row of parseRows(indexRowSchema, rows)) {
    const relation = lookupRelation(relations, row.schema_name, row.relation_name);
    const index: PhysicalIndex = {
      index_name: row.index_name,
      access_method: row.access_method,
      unique: row.unique,
      valid: row.valid,
      ready: row.ready,
      key_expressions: row.key_expressions,
      included_columns: row.included_columns,
      predicate: row.predicate,
    };
    relation.indexes.push(index);
  }
}

async function loadCatalog(
  client: PostgresCatalogClient,
  input: z.infer<typeof trustedScanInputSchema>,
  signal: AbortSignal | undefined,
  maxRelations: number,
): Promise<PhysicalSchemaSnapshot> {
  const preflight = parseRows(
    preflightRowSchema,
    (await client.query({ text: PREFLIGHT_SQL, ...(signal ? { signal } : {}) })).rows,
  );
  if (preflight.length !== 1) throw new CatalogContractError();
  const database = preflight[0];
  if (!database) throw new CatalogContractError();
  const versionNumber = Number(database.server_version_num);
  const relations = new Map<string, PhysicalRelation>();
  let cursor: readonly [string, string] = ["", ""];
  while (true) {
    assertNotCancelled(signal);
    const relationRows = parseRows(
      relationRowSchema,
      (
        await client.query({
          text: RELATIONS_SQL,
          values: [input.request.include_schemas, cursor[0], cursor[1], input.request.page_size],
          ...(signal ? { signal } : {}),
        })
      ).rows,
    );
    if (relationRows.length > input.request.page_size) throw new CatalogContractError();
    if (relationRows.length === 0) break;
    if (relations.size + relationRows.length > maxRelations) throw new CatalogLimitError();

    const schemaNames: string[] = [];
    const relationNames: string[] = [];
    for (const row of relationRows) {
      const key = relationKey(row.schema_name, row.relation_name);
      if (relations.has(key)) throw new CatalogContractError();
      relations.set(key, {
        identity: { schema_name: row.schema_name, relation_name: row.relation_name },
        relation_kind: row.relation_kind,
        comment: row.comment,
        columns: [],
        primary_key: null,
        foreign_keys: [],
        unique_constraints: [],
        check_constraints: [],
        indexes: [],
      });
      schemaNames.push(row.schema_name);
      relationNames.push(row.relation_name);
    }
    assertNotCancelled(signal);
    appendColumns(
      relations,
      (
        await client.query({
          text: COLUMNS_SQL,
          values: [schemaNames, relationNames],
          ...(signal ? { signal } : {}),
        })
      ).rows,
    );
    assertNotCancelled(signal);
    appendConstraints(
      relations,
      (
        await client.query({
          text: CONSTRAINTS_SQL,
          values: [schemaNames, relationNames],
          ...(signal ? { signal } : {}),
        })
      ).rows,
    );
    assertNotCancelled(signal);
    appendIndexes(
      relations,
      (
        await client.query({
          text: INDEXES_SQL,
          values: [schemaNames, relationNames],
          ...(signal ? { signal } : {}),
        })
      ).rows,
    );
    const last = relationRows.at(-1);
    if (!last) throw new CatalogContractError();
    cursor = [last.schema_name, last.relation_name];
  }

  return createPhysicalSchemaSnapshot({
    schema_version: "physical-schema-snapshot-draft@1.0.0",
    snapshot_id: input.snapshot_id,
    scan_run_id: input.scan_run_id,
    captured_at: input.captured_at,
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: input.request.datasource_id,
      datasource_fingerprint: input.datasource_fingerprint,
      engine: "postgresql",
      engine_version: {
        major: Math.floor(versionNumber / 10_000),
        minor: versionNumber % 10_000,
      },
      database_identity: {
        database_name: database.database_name,
        database_oid: database.database_oid,
      },
      included_schemas: input.request.include_schemas,
      relations: [...relations.values()],
    },
  });
}

export function createPostgresCatalogScanner(
  connector: PostgresCatalogConnector,
  options: Readonly<{ max_relations?: number }> = {},
): PostgresCatalogScanner {
  const maxRelations = options.max_relations ?? 100_000;
  if (!Number.isSafeInteger(maxRelations) || maxRelations < 1 || maxRelations > 1_000_000) {
    throw new TypeError("max_relations 必须位于 1..1000000。 ");
  }
  return {
    async scan(input: unknown, signal?: AbortSignal): Promise<PortResult<PhysicalSchemaSnapshot>> {
      const parsed = trustedScanInputSchema.safeParse(input);
      if (!parsed.success) return mapCatalogFailure(parsed.error, signal);
      try {
        assertAllowedSchemas(parsed.data.request.include_schemas);
      } catch {
        return publicFailure("SCHEMA_SCAN_SCOPE_FORBIDDEN", "请求的 schema 不允许扫描。", false);
      }
      if (signal?.aborted) return mapCatalogFailure(new CatalogCancelledError(), signal);
      let client: PostgresCatalogClient;
      try {
        client = await connector.connect();
      } catch (error) {
        return mapCatalogFailure(error, signal);
      }
      let transactionStarted = false;
      let completed: PhysicalSchemaSnapshot | null = null;
      let failure: PortResult<never> | null = null;
      try {
        await client.query({ text: BEGIN_SQL });
        transactionStarted = true;
        await client.query({
          text: SET_TIMEOUTS_SQL,
          values: [
            String(parsed.data.request.statement_timeout_ms),
            String(Math.min(parsed.data.request.statement_timeout_ms, 5_000)),
            String(Math.min(parsed.data.request.statement_timeout_ms + 1_000, 121_000)),
          ],
        });
        assertNotCancelled(signal);
        completed = await loadCatalog(client, parsed.data, signal, maxRelations);
      } catch (error) {
        failure = mapCatalogFailure(error, signal);
      }
      if (transactionStarted) {
        try {
          await client.query({ text: ROLLBACK_SQL });
        } catch (error) {
          failure ??= mapCatalogFailure(error, signal);
          completed = null;
        }
      }
      try {
        client.release();
      } catch (error) {
        failure ??= mapCatalogFailure(error, signal);
        completed = null;
      }
      if (failure) return failure;
      if (!completed) return mapCatalogFailure(new Error("scan incomplete"), signal);
      return { ok: true, value: completed };
    },
  };
}

export function adaptPgCatalogPool(pool: Pool): PostgresCatalogConnector {
  return {
    async connect(): Promise<PostgresCatalogClient> {
      const client = await pool.connect();
      return {
        query<Row extends object = Record<string, unknown>>(
          queryConfig: PostgresCatalogQuery,
        ): Promise<{ readonly rows: readonly Row[] }> {
          return queryPgClient<Row>(client, queryConfig);
        },
        release(): void {
          client.release();
        },
      };
    },
  };
}

function queryPgClient<Row extends object>(
  client: PoolClient,
  queryConfig: PostgresCatalogQuery,
): Promise<{ readonly rows: readonly Row[] }> {
  if (queryConfig.signal?.aborted) return Promise.reject(new CatalogCancelledError());
  return new Promise((resolve, reject) => {
    const query = new Query<QueryResultRow>({
      text: queryConfig.text,
      values: queryConfig.values ? [...queryConfig.values] : [],
      types: client,
    });
    const onAbort = () => {
      const cancellableClient = client as PoolClient & {
        cancel(targetClient: PoolClient, targetQuery: Query<QueryResultRow>): void;
      };
      cancellableClient.cancel(client, query);
    };
    queryConfig.signal?.addEventListener("abort", onAbort, { once: true });
    query.once("error", (error) => {
      queryConfig.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    query.once("end", (result) => {
      queryConfig.signal?.removeEventListener("abort", onAbort);
      resolve({ rows: result.rows as Row[] });
    });
    client.query(query);
  });
}
