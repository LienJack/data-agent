import { parse } from "pgsql-parser";
import { PostgresqlText2SqlPolicyError } from "./postgresql-text2sql-policy.js";

export interface PostgresqlTemporalColumn {
  readonly schema_name: string;
  readonly relation_name: string;
  readonly column_name: string;
}

type RecordNode = Record<string, unknown>;
type TemporalOutputs = ReadonlySet<string>;

function record(value: unknown): RecordNode {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordNode)
    : {};
}

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const name = record(record(item).String).sval;
        return typeof name === "string" ? [name] : [];
      })
    : [];
}

/** Negative selection check only. It neither authorizes columns nor proves declared bounds. */
export async function assertPostgresqlTemporalSelectionDeclared(input: {
  readonly sql: string;
  readonly has_declared_window: boolean;
  readonly temporal_columns: readonly PostgresqlTemporalColumn[];
}): Promise<void> {
  if (input.has_declared_window) return;
  const required = () => {
    throw new PostgresqlText2SqlPolicyError(
      "TEXT2SQL_SQL_SHAPE_REJECTED",
      "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED",
    );
  };
  function invalid(): never {
    throw new PostgresqlText2SqlPolicyError(
      "TEXT2SQL_SQL_SHAPE_REJECTED",
      "TEXT2SQL_SQL_SELECT_SHAPE_REJECTED",
    );
  }
  let ast: unknown;
  try {
    ast = await parse(input.sql);
  } catch {
    invalid();
  }
  const statements = record(ast).stmts;
  if (!Array.isArray(statements) || statements.length !== 1) invalid();

  const analyze = (
    selectValue: unknown,
    inheritedCtes: ReadonlyMap<string, TemporalOutputs>,
    depth: number,
  ): TemporalOutputs => {
    const select = record(selectValue);
    if (depth > 32 || !Array.isArray(select.targetList) || select.larg || select.rarg) invalid();
    const ctes = new Map(inheritedCtes);
    const withClause = record(select.withClause);
    if (withClause.recursive) invalid();
    if (Array.isArray(withClause.ctes)) {
      for (const wrapped of withClause.ctes) {
        const cte = record(record(wrapped).CommonTableExpr);
        if (typeof cte.ctename !== "string" || cte.aliascolnames) invalid();
        ctes.set(cte.ctename, analyze(record(cte.ctequery).SelectStmt, ctes, depth + 1));
      }
    }
    const sources = new Map<string, TemporalOutputs>();
    const predicates: unknown[] = [select.whereClause, select.havingClause];
    const addSource = (wrapped: unknown): void => {
      const node = record(wrapped);
      if (node.JoinExpr) {
        const join = record(node.JoinExpr);
        addSource(join.larg);
        addSource(join.rarg);
        predicates.push(join.quals);
        return;
      }
      const relation = record(node.RangeVar);
      const alias = record(relation.alias).aliasname;
      if (typeof relation.relname !== "string" || typeof alias !== "string" || sources.has(alias)) {
        invalid();
      }
      if (typeof relation.schemaname === "string") {
        const columns = new Set(
          input.temporal_columns
            .filter(
              (column) =>
                column.schema_name === relation.schemaname &&
                column.relation_name === relation.relname,
            )
            .map((column) => column.column_name),
        );
        sources.set(alias, columns);
      } else {
        const columns = ctes.get(relation.relname);
        if (!columns) invalid();
        sources.set(alias, columns);
      }
    };
    if (Array.isArray(select.fromClause)) select.fromClause.forEach(addSource);

    const temporal = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(temporal);
      const node = record(value);
      if (node.ColumnRef) {
        const fields = names(record(node.ColumnRef).fields);
        if (fields.length === 1) {
          return [...sources.values()].some((columns) => columns.has(fields[0] ?? ""));
        }
        // Three-part references do not use aliases; resolve their physical identity directly.
        if (fields.length === 3) {
          return input.temporal_columns.some(
            (column) =>
              column.schema_name === fields[0] &&
              column.relation_name === fields[1] &&
              column.column_name === fields[2],
          );
        }
        return sources.get(fields[0] ?? "")?.has(fields[1] ?? "") ?? false;
      }
      const castName = names(record(record(node.TypeCast).typeName).names).at(-1);
      if (castName && ["date", "timestamp", "timestamptz"].includes(castName)) return true;
      const functionName = names(record(node.FuncCall).funcname).at(-1);
      if (functionName && ["date_trunc", "date_part"].includes(functionName)) return true;
      return Object.values(node).some(temporal);
    };
    const checkConditional = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(checkConditional);
        return;
      }
      const node = record(value);
      if (
        temporal(record(node.FuncCall).agg_filter) ||
        temporal(record(node.CaseWhen).expr) ||
        temporal(record(node.CaseExpr).arg)
      ) {
        required();
      }
      Object.values(node).forEach(checkConditional);
    };
    if (predicates.some(temporal)) required();
    // Each CTE has already been checked with its own scope; never resolve it with outer aliases.
    for (const [key, value] of Object.entries(select)) {
      if (key !== "withClause") checkConditional(value);
    }
    return new Set(
      select.targetList.flatMap((wrapped) => {
        const target = record(record(wrapped).ResTarget);
        if (typeof target.name !== "string") invalid();
        return temporal(target.val) ? [target.name] : [];
      }),
    );
  };
  analyze(record(record(statements[0]).stmt).SelectStmt, new Map(), 0);
}
