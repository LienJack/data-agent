import { canonicalizeJson } from "@data-agent/contracts/common";
import type pg from "pg";
import { parse } from "pgsql-parser";

const POSTGRES_IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const DANGEROUS_NODE_NAMES = new Set([
  "AlterTableStmt",
  "CallStmt",
  "CopyStmt",
  "CreateStmt",
  "DeleteStmt",
  "DoStmt",
  "DropStmt",
  "GrantStmt",
  "InsertStmt",
  "RefreshMatViewStmt",
  "TransactionStmt",
  "TruncateStmt",
  "UpdateStmt",
  "VariableSetStmt",
]);
const DANGEROUS_FUNCTION =
  /^(?:dblink|lo_|pg_advisory|pg_read|pg_ls|pg_sleep|pg_stat_file|set_config|current_setting)/iu;

type JsonRecord = Record<string, unknown>;

export interface PostgresReadOnlyBenchmarkQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (null | string | number)[])[];
}

export interface PostgresReadOnlyBenchmarkQueryExecutor {
  execute(input: {
    readonly sql: string;
    readonly timeout_ms: number;
    readonly max_rows: number;
  }): Promise<PostgresReadOnlyBenchmarkQueryResult>;
  executeTableCount(input: {
    readonly timeout_ms: number;
  }): Promise<PostgresReadOnlyBenchmarkQueryResult>;
}

export interface PostgresReadOnlyBenchmarkPolicy {
  readonly allowed_schema: string;
  readonly reader_role: string;
  readonly allowed_relations: readonly string[];
}

function validatePolicy(policy: PostgresReadOnlyBenchmarkPolicy): Readonly<{
  allowed_schema: string;
  reader_role: string;
  allowed_relations: ReadonlySet<string>;
}> {
  if (
    !POSTGRES_IDENTIFIER.test(policy.allowed_schema) ||
    !POSTGRES_IDENTIFIER.test(policy.reader_role) ||
    policy.allowed_relations.length === 0 ||
    policy.allowed_relations.some((relation) => !POSTGRES_IDENTIFIER.test(relation))
  ) {
    throw new Error("POSTGRES_QUERY_POLICY_INVALID");
  }
  return Object.freeze({
    allowed_schema: policy.allowed_schema,
    reader_role: policy.reader_role,
    allowed_relations: new Set(policy.allowed_relations),
  });
}

export function compilePostgresTableCountSql(allowedSchema: string): string {
  if (!POSTGRES_IDENTIFIER.test(allowedSchema)) {
    throw new Error("POSTGRES_QUERY_POLICY_INVALID");
  }
  return `select count(*)::integer as table_count
from pg_catalog.pg_class relation
join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = '${allowedSchema}'
  and relation.relkind in ('r', 'p')
  and relation.relname = any($1::text[])`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function visit(value: unknown, visitor: (name: string, node: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) visit(child, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, child] of Object.entries(value)) {
    if (isRecord(child)) visitor(name, child);
    visit(child, visitor);
  }
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && isRecord(entry.String) && typeof entry.String.sval === "string"
      ? [entry.String.sval]
      : [],
  );
}

export async function assertPostgresReadOnlyBenchmarkSql(
  sql: string,
  rawPolicy: PostgresReadOnlyBenchmarkPolicy,
): Promise<string> {
  const policy = validatePolicy(rawPolicy);
  const trimmed = sql.trim();
  if (trimmed.length === 0 || trimmed.length > 100_000) {
    throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
  }
  let tree: Awaited<ReturnType<typeof parse>>;
  try {
    tree = await parse(trimmed);
  } catch {
    throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
  }
  const statements = (
    tree as unknown as { readonly stmts?: readonly { readonly stmt?: unknown }[] }
  ).stmts;
  const statement = statements?.[0]?.stmt;
  if (statements?.length !== 1 || !isRecord(statement) || !isRecord(statement.SelectStmt)) {
    throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
  }
  const ctes = new Set<string>();
  visit(tree, (name, node) => {
    if (DANGEROUS_NODE_NAMES.has(name)) throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
    if (name === "SelectStmt") {
      if (
        node.intoClause !== undefined ||
        (Array.isArray(node.lockingClause) && node.lockingClause.length > 0)
      ) {
        throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
      }
    }
    if (name === "CommonTableExpr" && typeof node.ctename === "string") ctes.add(node.ctename);
    if (name === "FuncCall") {
      const functionName = stringValues(node.funcname).at(-1);
      if (functionName && DANGEROUS_FUNCTION.test(functionName)) {
        throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
      }
    }
  });
  visit(tree, (name, node) => {
    if (name !== "RangeVar" || typeof node.relname !== "string") return;
    if (node.schemaname === undefined && ctes.has(node.relname)) return;
    if (
      (node.schemaname !== undefined && node.schemaname !== policy.allowed_schema) ||
      !policy.allowed_relations.has(node.relname)
    ) {
      throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
    }
  });
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

function normalize(value: unknown): null | string | number {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("POSTGRES_RESULT_CELL_UNSUPPORTED");
    return value;
  }
  if (typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `hex:${Buffer.from(value).toString("hex")}`;
  }
  if (typeof value === "object") return canonicalizeJson(value);
  throw new Error("POSTGRES_RESULT_CELL_UNSUPPORTED");
}

export function createPostgresReadOnlyBenchmarkExecutor(input: {
  readonly pool: pg.Pool;
  readonly policy: PostgresReadOnlyBenchmarkPolicy;
}): PostgresReadOnlyBenchmarkQueryExecutor {
  const policy = validatePolicy(input.policy);
  const executor: PostgresReadOnlyBenchmarkQueryExecutor = {
    async execute(request: {
      readonly sql: string;
      readonly timeout_ms: number;
      readonly max_rows: number;
    }) {
      const sql = await assertPostgresReadOnlyBenchmarkSql(request.sql, input.policy);
      if (
        !Number.isInteger(request.timeout_ms) ||
        request.timeout_ms < 1 ||
        request.timeout_ms > 600_000 ||
        !Number.isInteger(request.max_rows) ||
        request.max_rows < 1 ||
        request.max_rows > 100_000
      ) {
        throw new Error("POSTGRES_QUERY_BUDGET_INVALID");
      }
      const client = await input.pool.connect();
      try {
        await client.query("begin read only");
        await client.query(`set local role ${policy.reader_role}`);
        await client.query(`set local statement_timeout = '${request.timeout_ms}ms'`);
        await client.query("set local lock_timeout = '1000ms'");
        await client.query(`set local search_path = ${policy.allowed_schema}, pg_catalog`);
        const result = await client.query({
          text: `select * from (${sql}) as __ecommerce_candidate limit ${request.max_rows + 1}`,
          rowMode: "array",
        });
        if (result.rows.length > request.max_rows) {
          throw new Error("POSTGRES_RESULT_ROW_LIMIT_EXCEEDED");
        }
        await client.query("commit");
        return Object.freeze({
          columns: Object.freeze(result.fields.map((field) => field.name)),
          rows: Object.freeze(
            result.rows.map((row) => Object.freeze((row as unknown[]).map(normalize))),
          ),
        });
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        if (isRecord(error) && error.code === "57014") throw new Error("POSTGRES_QUERY_TIMEOUT");
        throw error;
      } finally {
        client.release();
      }
    },

    async executeTableCount(request: { readonly timeout_ms: number }) {
      if (
        !Number.isInteger(request.timeout_ms) ||
        request.timeout_ms < 1 ||
        request.timeout_ms > 600_000
      ) {
        throw new Error("POSTGRES_QUERY_BUDGET_INVALID");
      }
      const client = await input.pool.connect();
      try {
        await client.query("begin read only");
        await client.query(`set local role ${policy.reader_role}`);
        await client.query(`set local statement_timeout = '${request.timeout_ms}ms'`);
        await client.query("set local lock_timeout = '1000ms'");
        const result = await client.query<{ readonly table_count: number | string }>(
          compilePostgresTableCountSql(policy.allowed_schema),
          [[...policy.allowed_relations].sort()],
        );
        await client.query("commit");
        return Object.freeze({
          columns: Object.freeze(["table_count"]),
          rows: Object.freeze([Object.freeze([Number(result.rows[0]?.table_count ?? 0)] as const)]),
        });
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        if (isRecord(error) && error.code === "57014") throw new Error("POSTGRES_QUERY_TIMEOUT");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return Object.freeze(executor);
}
