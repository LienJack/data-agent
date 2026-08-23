import { createHash } from "node:crypto";
import {
  type BenchmarkOracleFeedback,
  benchmarkOracleFeedbackSchema,
  type FalconExpectedResult,
  type SealedFalconCase,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { SqliteOracleEvaluation, SqlResultOracle } from "./sqlite-oracle.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_VERSION = "falcon-postgres-expected-result@1.0.0";
export const FALCON_ORACLE_REFERENCE_PREFIX = "falcon-expected://" as const;

type FalconCell = null | string | number | boolean;

export interface FalconOracleQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (null | string | number)[])[];
}

export interface FalconOracleQueryExecutor {
  execute(input: {
    readonly database_schema: string;
    readonly sql: string;
    readonly timeout_ms: number;
    readonly max_rows: number;
  }): Promise<FalconOracleQueryResult>;
}

export interface FalconResultOracleOptions {
  readonly executor: FalconOracleQueryExecutor;
  readonly sealed_cases: readonly SealedFalconCase[];
  readonly timeout_ms?: number;
  readonly max_rows?: number;
  readonly oracle_version?: string;
}

function closeNumber(left: number, right: number): boolean {
  const difference = Math.abs(left - right);
  return difference <= 1e-6 || difference <= 1e-6 * Math.max(Math.abs(left), Math.abs(right), 1);
}

function expectedDecimalPlaces(value: FalconCell): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^[+-]?\d+\.(\d+)$/u);
  return match?.[1]?.length ?? null;
}

function numeric(value: FalconCell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value.trim())
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateTime(value: FalconCell): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[T ][^\s]+)?$/u.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cellsEqual(left: FalconCell, right: FalconCell): boolean {
  if (left === null || right === null) return left === right;
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber !== null && rightNumber !== null) {
    const decimalPlaces = expectedDecimalPlaces(right);
    if (decimalPlaces !== null && decimalPlaces <= 12) {
      const scale = 10 ** decimalPlaces;
      if (closeNumber(Math.round(leftNumber * scale) / scale, rightNumber)) return true;
    }
    return closeNumber(leftNumber, rightNumber);
  }
  const leftDate = dateTime(left);
  const rightDate = dateTime(right);
  if (leftDate !== null && rightDate !== null) return leftDate === rightDate;
  return String(left) === String(right);
}

function cellKey(value: FalconCell): string {
  if (value === null) return "0:null";
  const asNumber = numeric(value);
  if (asNumber !== null) return `1:number:${asNumber.toPrecision(15)}`;
  const asDate = dateTime(value);
  if (asDate !== null) return `2:date:${asDate}`;
  return `3:text:${JSON.stringify(String(value))}`;
}

function rowKey(row: readonly FalconCell[]): string {
  return row.map(cellKey).join("\u001f");
}

function resultEquals(candidate: FalconOracleQueryResult, expected: FalconExpectedResult): boolean {
  if (
    candidate.columns.length !== expected.columns.length ||
    candidate.rows.length !== expected.rows.length
  ) {
    return false;
  }
  const candidateRows = expected.ordered
    ? candidate.rows
    : [...candidate.rows].sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  const expectedRows = expected.ordered
    ? expected.rows
    : [...expected.rows].sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  return candidateRows.every((row, rowIndex) => {
    const expectedRow = expectedRows[rowIndex];
    return Boolean(
      expectedRow &&
        row.length === expectedRow.length &&
        row.every((cell, columnIndex) => cellsEqual(cell, expectedRow[columnIndex] ?? null)),
    );
  });
}

function resultHash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function diagnosticCode(error: unknown): string {
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

export function falconOracleReference(caseId: string): string {
  return `${FALCON_ORACLE_REFERENCE_PREFIX}${caseId}`;
}

export class FalconResultOracle implements SqlResultOracle {
  readonly #executor: FalconOracleQueryExecutor;
  readonly #sealedById: ReadonlyMap<string, SealedFalconCase>;
  readonly #timeoutMs: number;
  readonly #maxRows: number;
  readonly #oracleVersion: string;

  constructor(options: FalconResultOracleOptions) {
    this.#executor = options.executor;
    this.#sealedById = new Map(
      options.sealed_cases.map((sealedCase) => [sealedCase.public_case.case_id, sealedCase]),
    );
    if (this.#sealedById.size !== options.sealed_cases.length) {
      throw new Error("FALCON_ORACLE_CASE_SET_INVALID");
    }
    this.#timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    this.#maxRows = options.max_rows ?? DEFAULT_MAX_ROWS;
    this.#oracleVersion = options.oracle_version ?? DEFAULT_VERSION;
  }

  async evaluate(input: {
    readonly database_path: string;
    readonly candidate_sql: string;
    readonly gold_sql: string;
  }): Promise<SqliteOracleEvaluation> {
    const caseId = input.gold_sql.startsWith(FALCON_ORACLE_REFERENCE_PREFIX)
      ? input.gold_sql.slice(FALCON_ORACLE_REFERENCE_PREFIX.length)
      : "";
    const sealedCase = this.#sealedById.get(caseId);
    if (!sealedCase || sealedCase.public_case.database_id !== input.database_path) {
      const material = {
        oracle_version: this.#oracleVersion,
        failure_type: "INVALID_CASE" as const,
        public_message: "Falcon 题目与固定数据库映射无效。",
        candidate_row_count: null,
        gold_row_count: null,
        candidate_column_count: null,
        gold_column_count: null,
      };
      return {
        verdict: "INVALID_CASE",
        feedback: await feedback(material),
        candidate_result_hash: null,
        gold_result_hash: null,
        diagnostic_code: "FALCON_ORACLE_CASE_INVALID",
      };
    }

    const expectedRows = sealedCase.expected_results[0]?.rows.length ?? 0;
    const expectedColumns = sealedCase.expected_results[0]?.columns.length ?? 0;
    let candidate: FalconOracleQueryResult;
    try {
      candidate = await this.#executor.execute({
        database_schema: input.database_path,
        sql: input.candidate_sql,
        timeout_ms: this.#timeoutMs,
        max_rows: this.#maxRows,
      });
    } catch (error) {
      const code = diagnosticCode(error);
      const failureType =
        code === "POSTGRES_QUERY_TIMEOUT"
          ? ("TIMEOUT" as const)
          : code === "POSTGRES_QUERY_POLICY_REJECTED" || code === "FALCON_DATABASE_SCHEMA_INVALID"
            ? ("SAFETY_VIOLATION" as const)
            : ("SQL_EXECUTION" as const);
      const material = {
        oracle_version: this.#oracleVersion,
        failure_type: failureType,
        public_message:
          failureType === "SAFETY_VIOLATION"
            ? "候选 SQL 未通过 Falcon 只读 schema 隔离策略。"
            : failureType === "TIMEOUT"
              ? "候选 SQL 超过 Falcon Oracle 的执行时限。"
              : "候选 SQL 无法在固定 Falcon PostgreSQL 快照上执行。",
        candidate_row_count: null,
        gold_row_count: expectedRows,
        candidate_column_count: null,
        gold_column_count: expectedColumns,
      };
      return {
        verdict: "FAIL",
        feedback: await feedback(material),
        candidate_result_hash: null,
        gold_result_hash: resultHash(sealedCase.expected_results),
        diagnostic_code: code,
      };
    }

    const pass = sealedCase.expected_results.some((expected) => resultEquals(candidate, expected));
    const material = {
      oracle_version: this.#oracleVersion,
      failure_type: pass ? null : ("ORACLE_MISMATCH" as const),
      public_message: pass
        ? "候选 SQL 与 Falcon 固定 expected result 等价。"
        : "候选结果与 Falcon Oracle 不等价；请复核连接、过滤、聚合、输出列数量、排序和 NULL 语义。",
      candidate_row_count: candidate.rows.length,
      gold_row_count: expectedRows,
      candidate_column_count: candidate.columns.length,
      gold_column_count: expectedColumns,
    };
    return {
      verdict: pass ? "PASS" : "FAIL",
      feedback: await feedback(material),
      candidate_result_hash: resultHash(candidate),
      gold_result_hash: resultHash(sealedCase.expected_results),
      diagnostic_code: null,
    };
  }
}
