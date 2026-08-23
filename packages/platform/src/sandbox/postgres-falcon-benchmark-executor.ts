import { canonicalizeJson } from "@data-agent/contracts";
import type pg from "pg";
import { parse } from "pgsql-parser";

const READER_ROLE = "falcon_demo_reader";
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

export interface FalconBenchmarkQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (null | string | number)[])[];
}

export interface FalconBenchmarkQueryExecutor {
  execute(input: {
    readonly database_schema: string;
    readonly sql: string;
    readonly timeout_ms: number;
    readonly max_rows: number;
  }): Promise<FalconBenchmarkQueryResult>;
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

export function assertFalconDatabaseSchema(value: string): string {
  const match = /^falcon_db_(0[1-9]|1[0-9]|2[0-8])$/u.exec(value);
  if (!match) throw new Error("FALCON_DATABASE_SCHEMA_INVALID");
  return value;
}

export async function assertFalconBenchmarkReadOnlySql(input: {
  readonly database_schema: string;
  readonly sql: string;
}): Promise<string> {
  const databaseSchema = assertFalconDatabaseSchema(input.database_schema);
  const trimmed = input.sql.trim();
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
    if (node.schemaname !== undefined && node.schemaname !== databaseSchema) {
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

export function createPostgresFalconBenchmarkExecutor(input: {
  readonly pool: pg.Pool;
}): FalconBenchmarkQueryExecutor {
  return Object.freeze({
    async execute(request: {
      readonly database_schema: string;
      readonly sql: string;
      readonly timeout_ms: number;
      readonly max_rows: number;
    }) {
      const databaseSchema = assertFalconDatabaseSchema(request.database_schema);
      const sql = await assertFalconBenchmarkReadOnlySql({
        database_schema: databaseSchema,
        sql: request.sql,
      });
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
        await client.query(`set local role ${READER_ROLE}`);
        await client.query(`set local statement_timeout = '${request.timeout_ms}ms'`);
        await client.query("set local lock_timeout = '1000ms'");
        await client.query(`set local search_path = ${databaseSchema}, pg_catalog`);
        const result = await client.query({
          text: `select * from (${sql}) as __falcon_candidate limit ${request.max_rows + 1}`,
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
  });
}
