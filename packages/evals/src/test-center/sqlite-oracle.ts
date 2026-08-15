import { createHash, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import {
  type BenchmarkOracleFeedback,
  benchmarkOracleFeedbackSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";

const ORACLE_VERSION = "bird-sqlite-result-equivalence@1.0.0";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ROWS = 10_000;

const resultCellSchema = z.union([
  z.null(),
  z.string(),
  z.number().finite(),
  z.strictObject({ cell_type: z.literal("BIGINT"), value: z.string().regex(/^-?[0-9]+$/) }),
  z.strictObject({ cell_type: z.literal("BLOB"), value: z.string().regex(/^[a-f0-9]*$/) }),
]);

const queryResultSchema = z.strictObject({
  columns: z.array(z.string()),
  rows: z.array(z.array(resultCellSchema)),
});

type QueryResult = z.infer<typeof queryResultSchema>;
type ResultCell = z.infer<typeof resultCellSchema>;

const sqliteWorkerSource = `
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync, constants } from "node:sqlite";

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return { cell_type: "BIGINT", value: value.toString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { cell_type: "BLOB", value: Buffer.from(value).toString("hex") };
  }
  throw new Error("SQLITE_RESULT_CELL_UNSUPPORTED");
}

const database = new DatabaseSync(workerData.databasePath, {
  readOnly: true,
  enableDoubleQuotedStringLiterals: true,
});
try {
  database.enableLoadExtension(false);
  database.exec("pragma query_only = on");
  if (typeof database.setAuthorizer === "function") {
    const denied = new Set([
      constants.SQLITE_ATTACH,
      constants.SQLITE_DETACH,
      constants.SQLITE_ALTER_TABLE,
      constants.SQLITE_CREATE_INDEX,
      constants.SQLITE_CREATE_TABLE,
      constants.SQLITE_CREATE_TEMP_INDEX,
      constants.SQLITE_CREATE_TEMP_TABLE,
      constants.SQLITE_CREATE_TEMP_TRIGGER,
      constants.SQLITE_CREATE_TEMP_VIEW,
      constants.SQLITE_CREATE_TRIGGER,
      constants.SQLITE_CREATE_VIEW,
      constants.SQLITE_DELETE,
      constants.SQLITE_DROP_INDEX,
      constants.SQLITE_DROP_TABLE,
      constants.SQLITE_DROP_TEMP_INDEX,
      constants.SQLITE_DROP_TEMP_TABLE,
      constants.SQLITE_DROP_TEMP_TRIGGER,
      constants.SQLITE_DROP_TEMP_VIEW,
      constants.SQLITE_DROP_TRIGGER,
      constants.SQLITE_DROP_VIEW,
      constants.SQLITE_INSERT,
      constants.SQLITE_PRAGMA,
      constants.SQLITE_REINDEX,
      constants.SQLITE_UPDATE,
    ]);
    database.setAuthorizer((actionCode) => denied.has(actionCode) ? constants.SQLITE_DENY : constants.SQLITE_OK);
  }
  const statement = database.prepare(workerData.sql);
  const columns = statement.columns().map((column) => column.name);
  const rows = [];
  for (const row of statement.iterate()) {
    if (rows.length >= workerData.maxRows) throw new Error("SQLITE_RESULT_ROW_LIMIT_EXCEEDED");
    rows.push(columns.map((column) => normalize(row[column])));
  }
  parentPort.postMessage({ ok: true, value: { columns, rows } });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error && typeof error.code === "string" ? error.code : "SQLITE_QUERY_FAILED",
  });
} finally {
  database.close();
}
`;

function lexicalSql(sql: string): string {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const current = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      output += " ";
      index += 1;
      while (index < sql.length) {
        const value = sql[index] ?? "";
        if (value === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      output += " ";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index + 1 < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      output += " ";
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}

function validateReadOnlySql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.length === 0 || trimmed.length > 100_000) {
    throw new Error("SQLITE_QUERY_SHAPE_REJECTED");
  }
  const lexical = lexicalSql(trimmed).trim();
  const withoutTrailingSemicolon = lexical.endsWith(";") ? lexical.slice(0, -1).trimEnd() : lexical;
  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error("SQLITE_QUERY_MULTIPLE_STATEMENTS_REJECTED");
  }
  if (!/^(select|with)\b/iu.test(withoutTrailingSemicolon)) {
    throw new Error("SQLITE_QUERY_READ_ONLY_REQUIRED");
  }
  if (
    /\b(attach|detach|pragma|vacuum|reindex|analyze|insert|update|delete|replace|create|alter|drop|trigger|load_extension)\b/iu.test(
      withoutTrailingSemicolon,
    )
  ) {
    throw new Error("SQLITE_QUERY_FORBIDDEN_OPERATION");
  }
  return trimmed;
}

function runReadOnlyQuery(input: {
  readonly databasePath: string;
  readonly sql: string;
  readonly timeoutMs: number;
  readonly maxRows: number;
}): Promise<QueryResult> {
  const sql = validateReadOnlySql(input.sql);
  return new Promise((resolve, reject) => {
    const worker = new Worker(sqliteWorkerSource, {
      eval: true,
      workerData: {
        databasePath: input.databasePath,
        sql,
        maxRows: input.maxRows,
      },
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new Error("SQLITE_QUERY_TIMEOUT"));
    }, input.timeoutMs);
    worker.once("message", (message: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = z
        .discriminatedUnion("ok", [
          z.strictObject({ ok: z.literal(true), value: queryResultSchema }),
          z.strictObject({
            ok: z.literal(false),
            error: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
          }),
        ])
        .parse(message);
      if (result.ok) resolve(result.value);
      else reject(new Error(result.error));
    });
    worker.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error("SQLITE_WORKER_FAILED"));
    });
    worker.once("exit", (code) => {
      if (settled || code === 0) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error("SQLITE_WORKER_FAILED"));
    });
  });
}

function comparableNumber(left: number, right: number): boolean {
  const difference = Math.abs(left - right);
  return difference <= 1e-6 || difference <= 1e-6 * Math.max(Math.abs(left), Math.abs(right), 1);
}

function cellsEqual(left: ResultCell, right: ResultCell): boolean {
  if (typeof left === "number" && typeof right === "number") return comparableNumber(left, right);
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return left === right;
  if (typeof left === "string" || typeof right === "string") return left === right;
  if (typeof left === "number" || typeof right === "number") return false;
  return left.cell_type === right.cell_type && left.value === right.value;
}

function rowsEqual(left: readonly ResultCell[], right: readonly ResultCell[]): boolean {
  return (
    left.length === right.length &&
    left.every((cell, index) => cellsEqual(cell, right[index] ?? null))
  );
}

function stableCell(cell: ResultCell): string {
  if (cell === null) return "null";
  if (typeof cell === "number") return `number:${cell.toPrecision(15)}`;
  if (typeof cell === "string") return `string:${JSON.stringify(cell)}`;
  return `${cell.cell_type}:${cell.value}`;
}

function stableRow(row: readonly ResultCell[]): string {
  return row.map(stableCell).join("\u001f");
}

function resultsEqual(candidate: QueryResult, gold: QueryResult, ordered: boolean): boolean {
  if (
    candidate.columns.length !== gold.columns.length ||
    candidate.rows.length !== gold.rows.length
  ) {
    return false;
  }
  const candidateRows = ordered
    ? candidate.rows
    : [...candidate.rows].sort((left, right) => stableRow(left).localeCompare(stableRow(right)));
  const goldRows = ordered
    ? gold.rows
    : [...gold.rows].sort((left, right) => stableRow(left).localeCompare(stableRow(right)));
  return candidateRows.every((row, index) => rowsEqual(row, goldRows[index] ?? []));
}

function resultHash(result: QueryResult): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`;
}

function failureCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)
    ? error.message
    : "SQLITE_QUERY_FAILED";
}

function publicExecutionMessage(code: string): string {
  switch (code) {
    case "SQLITE_QUERY_TIMEOUT":
      return "候选 SQL 超过只读 Oracle 的执行时限。";
    case "SQLITE_QUERY_MULTIPLE_STATEMENTS_REJECTED":
    case "SQLITE_QUERY_READ_ONLY_REQUIRED":
    case "SQLITE_QUERY_FORBIDDEN_OPERATION":
    case "SQLITE_QUERY_SHAPE_REJECTED":
      return "候选 SQL 未通过只读查询安全策略。";
    case "SQLITE_RESULT_ROW_LIMIT_EXCEEDED":
      return "候选 SQL 的结果行数超过 Oracle 上限。";
    default:
      return "候选 SQL 无法在固定 SQLite 快照上执行。";
  }
}

export interface SqliteOracleEvaluation {
  readonly verdict: "PASS" | "FAIL" | "INFRA_FAILURE" | "INVALID_CASE" | "ORACLE_FAILURE";
  readonly feedback: BenchmarkOracleFeedback;
  readonly candidate_result_hash: string | null;
  readonly gold_result_hash: string | null;
  /** Server diagnostic only. Never include this in the reflection envelope. */
  readonly diagnostic_code: string | null;
}

/** Runtime-neutral SQL Oracle boundary used by the shared batch runner. */
export interface SqlResultOracle {
  evaluate(input: {
    readonly database_path: string;
    readonly candidate_sql: string;
    readonly gold_sql: string;
  }): Promise<SqliteOracleEvaluation>;
}

export interface SqliteResultOracleOptions {
  readonly timeout_ms?: number;
  readonly max_rows?: number;
  readonly oracle_version?: string;
}

export class SqliteResultOracle implements SqlResultOracle {
  readonly #timeoutMs: number;
  readonly #maxRows: number;
  readonly #oracleVersion: string;

  constructor(options: SqliteResultOracleOptions = {}) {
    this.#timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    this.#maxRows = options.max_rows ?? DEFAULT_MAX_ROWS;
    this.#oracleVersion = options.oracle_version ?? ORACLE_VERSION;
  }

  async evaluate(input: {
    readonly database_path: string;
    readonly candidate_sql: string;
    readonly gold_sql: string;
  }): Promise<SqliteOracleEvaluation> {
    let gold: QueryResult;
    try {
      gold = await runReadOnlyQuery({
        databasePath: input.database_path,
        sql: input.gold_sql,
        timeoutMs: this.#timeoutMs,
        maxRows: this.#maxRows,
      });
    } catch (error) {
      const material = {
        oracle_version: this.#oracleVersion,
        failure_type: "ORACLE_FAILURE" as const,
        public_message: "版本化 Gold SQL 或固定数据快照无法由 Oracle 验证。",
        candidate_row_count: null,
        gold_row_count: null,
        candidate_column_count: null,
        gold_column_count: null,
      };
      return {
        verdict: "ORACLE_FAILURE",
        feedback: benchmarkOracleFeedbackSchema.parse({
          ...material,
          oracle_receipt_hash: await sha256ContentHash(material),
        }),
        candidate_result_hash: null,
        gold_result_hash: null,
        diagnostic_code: failureCode(error),
      };
    }

    let candidate: QueryResult;
    try {
      candidate = await runReadOnlyQuery({
        databasePath: input.database_path,
        sql: input.candidate_sql,
        timeoutMs: this.#timeoutMs,
        maxRows: this.#maxRows,
      });
    } catch (error) {
      const code = failureCode(error);
      const material = {
        oracle_version: this.#oracleVersion,
        failure_type:
          code === "SQLITE_QUERY_TIMEOUT" ? ("TIMEOUT" as const) : ("SQL_EXECUTION" as const),
        public_message: publicExecutionMessage(code),
        candidate_row_count: null,
        gold_row_count: gold.rows.length,
        candidate_column_count: null,
        gold_column_count: gold.columns.length,
      };
      return {
        verdict: "FAIL",
        feedback: benchmarkOracleFeedbackSchema.parse({
          ...material,
          oracle_receipt_hash: await sha256ContentHash(material),
        }),
        candidate_result_hash: null,
        gold_result_hash: resultHash(gold),
        diagnostic_code: code,
      };
    }

    const ordered = /\border\s+by\b/iu.test(lexicalSql(input.gold_sql));
    const pass = resultsEqual(candidate, gold, ordered);
    const material = {
      oracle_version: this.#oracleVersion,
      failure_type: pass ? null : ("ORACLE_MISMATCH" as const),
      public_message: pass
        ? "候选 SQL 与版本化 Gold SQL 的执行结果等价。"
        : "候选结果与版本化 Oracle 不等价；请复核连接、过滤、聚合、排序和 NULL 语义。",
      candidate_row_count: candidate.rows.length,
      gold_row_count: gold.rows.length,
      candidate_column_count: candidate.columns.length,
      gold_column_count: gold.columns.length,
    };
    return {
      verdict: pass ? "PASS" : "FAIL",
      feedback: benchmarkOracleFeedbackSchema.parse({
        ...material,
        oracle_receipt_hash: await sha256ContentHash(material),
      }),
      candidate_result_hash: resultHash(candidate),
      gold_result_hash: resultHash(gold),
      diagnostic_code: null,
    };
  }
}

export function newOracleTraceId(): string {
  return randomUUID();
}
