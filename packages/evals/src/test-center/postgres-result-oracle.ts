import { createHash } from "node:crypto";
import {
  type BenchmarkOracleFeedback,
  benchmarkOracleFeedbackSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { SqliteOracleEvaluation, SqlResultOracle } from "./sqlite-oracle.js";

export type PostgresOracleCell = null | string | number;

export interface PostgresOracleQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly PostgresOracleCell[])[];
}

export interface PostgresOracleQueryExecutor {
  execute(input: {
    readonly sql: string;
    readonly timeout_ms: number;
    readonly max_rows: number;
  }): Promise<PostgresOracleQueryResult>;
}

export interface PostgresResultOracleOptions {
  readonly executor: PostgresOracleQueryExecutor;
  readonly timeout_ms?: number;
  readonly max_rows?: number;
  readonly oracle_version?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_VERSION = "ecommerce-postgres-result-equivalence@1.0.0";

function lexicalSql(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/gu, " ")
    .replace(/--[^\n]*/gu, " ")
    .replace(/\/\*[\s\S]*?\*\//gu, " ");
}

function closeNumber(left: number, right: number): boolean {
  const difference = Math.abs(left - right);
  return difference <= 1e-6 || difference <= 1e-6 * Math.max(Math.abs(left), Math.abs(right), 1);
}

function cellKey(cell: PostgresOracleCell): string {
  if (cell === null) return "null";
  if (typeof cell === "number") return `number:${cell.toPrecision(15)}`;
  return `string:${JSON.stringify(cell)}`;
}

function rowKey(row: readonly PostgresOracleCell[]): string {
  return row.map(cellKey).join("\u001f");
}

function cellsEqual(left: PostgresOracleCell, right: PostgresOracleCell): boolean {
  if (typeof left === "number" && typeof right === "number") return closeNumber(left, right);
  return left === right;
}

function resultsEqual(
  candidate: PostgresOracleQueryResult,
  gold: PostgresOracleQueryResult,
  ordered: boolean,
): boolean {
  if (
    candidate.columns.length !== gold.columns.length ||
    candidate.rows.length !== gold.rows.length
  ) {
    return false;
  }
  const candidateRows = ordered
    ? candidate.rows
    : [...candidate.rows].sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
  const goldRows = ordered
    ? gold.rows
    : [...gold.rows].sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
  return candidateRows.every((row, rowIndex) => {
    const expected = goldRows[rowIndex];
    return Boolean(
      expected &&
        row.length === expected.length &&
        row.every((cell, columnIndex) => cellsEqual(cell, expected[columnIndex] ?? null)),
    );
  });
}

function resultHash(result: PostgresOracleQueryResult): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`;
}

function code(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)
    ? error.message
    : "POSTGRES_QUERY_FAILED";
}

async function feedback(
  material: Omit<BenchmarkOracleFeedback, "oracle_receipt_hash">,
): Promise<BenchmarkOracleFeedback> {
  return benchmarkOracleFeedbackSchema.parse({
    ...material,
    oracle_receipt_hash: await sha256ContentHash(material),
  });
}

export class PostgresResultOracle implements SqlResultOracle {
  readonly #executor: PostgresOracleQueryExecutor;
  readonly #timeoutMs: number;
  readonly #maxRows: number;
  readonly #oracleVersion: string;

  constructor(options: PostgresResultOracleOptions) {
    this.#executor = options.executor;
    this.#timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    this.#maxRows = options.max_rows ?? DEFAULT_MAX_ROWS;
    this.#oracleVersion = options.oracle_version ?? DEFAULT_VERSION;
  }

  async evaluate(input: {
    readonly database_path: string;
    readonly candidate_sql: string;
    readonly gold_sql: string;
  }): Promise<SqliteOracleEvaluation> {
    let gold: PostgresOracleQueryResult;
    try {
      gold = await this.#executor.execute({
        sql: input.gold_sql,
        timeout_ms: this.#timeoutMs,
        max_rows: this.#maxRows,
      });
    } catch (error) {
      const material = {
        oracle_version: this.#oracleVersion,
        failure_type: "ORACLE_FAILURE" as const,
        public_message: "版本化 Gold SQL 或固定 PostgreSQL 快照无法由 Oracle 验证。",
        candidate_row_count: null,
        gold_row_count: null,
        candidate_column_count: null,
        gold_column_count: null,
      };
      return {
        verdict: "ORACLE_FAILURE",
        feedback: await feedback(material),
        candidate_result_hash: null,
        gold_result_hash: null,
        diagnostic_code: code(error),
      };
    }

    let candidate: PostgresOracleQueryResult;
    try {
      candidate = await this.#executor.execute({
        sql: input.candidate_sql,
        timeout_ms: this.#timeoutMs,
        max_rows: this.#maxRows,
      });
    } catch (error) {
      const failureCode = code(error);
      const material = {
        oracle_version: this.#oracleVersion,
        failure_type:
          failureCode === "POSTGRES_QUERY_TIMEOUT"
            ? ("TIMEOUT" as const)
            : ("SQL_EXECUTION" as const),
        public_message:
          failureCode === "POSTGRES_QUERY_POLICY_REJECTED"
            ? "候选 SQL 未通过 E-commerce 只读查询策略。"
            : "候选 SQL 无法在固定 PostgreSQL 快照上执行。",
        candidate_row_count: null,
        gold_row_count: gold.rows.length,
        candidate_column_count: null,
        gold_column_count: gold.columns.length,
      };
      return {
        verdict: "FAIL",
        feedback: await feedback(material),
        candidate_result_hash: null,
        gold_result_hash: resultHash(gold),
        diagnostic_code: failureCode,
      };
    }

    const pass = resultsEqual(candidate, gold, /\border\s+by\b/iu.test(lexicalSql(input.gold_sql)));
    const material = {
      oracle_version: this.#oracleVersion,
      failure_type: pass ? null : ("ORACLE_MISMATCH" as const),
      public_message: pass
        ? "候选 SQL 与版本化 Gold SQL 的 PostgreSQL 执行结果等价。"
        : "候选结果与版本化 Oracle 不等价；请复核连接、过滤、聚合、排序和 NULL 语义。",
      candidate_row_count: candidate.rows.length,
      gold_row_count: gold.rows.length,
      candidate_column_count: candidate.columns.length,
      gold_column_count: gold.columns.length,
    };
    return {
      verdict: pass ? "PASS" : "FAIL",
      feedback: await feedback(material),
      candidate_result_hash: resultHash(candidate),
      gold_result_hash: resultHash(gold),
      diagnostic_code: null,
    };
  }
}
