import type { GovernedDatasourceQueryRequest } from "@data-agent/contracts";
import NodeSqlParser from "node-sql-parser";
import { DatasourceAdapterPolicyError } from "./common.js";

type AstRecord = Record<string, unknown>;
const aggregateFunctions = new Set(["AVG", "COUNT", "MAX", "MIN", "SUM"]);

function visit(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as AstRecord;
  if (node.type === "function") {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_FUNCTION_REJECTED");
  }
  if (node.type === "aggr_func" && !aggregateFunctions.has(String(node.name).toUpperCase())) {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_FUNCTION_REJECTED");
  }
  if (node.type === "column_ref" && node.column === "*") {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_WILDCARD_REJECTED");
  }
  Object.values(node).forEach(visit);
}

function relationName(encoded: string): string {
  const [, namespace, relation] = encoded.split("::");
  return namespace && namespace !== "null" ? `${namespace}.${relation}` : (relation ?? "");
}

export function createNodeSqlStatementPolicy(database: "MySQL" | "sqlite") {
  const parser = new NodeSqlParser.Parser();
  return (request: GovernedDatasourceQueryRequest): void => {
    let ast: unknown;
    let tableList: readonly string[];
    try {
      ast = parser.astify(request.statement, { database });
      tableList = parser.tableList(request.statement, { database });
    } catch {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_PARSE_FAILED");
    }
    if (Array.isArray(ast) || typeof ast !== "object" || ast === null) {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SINGLE_STATEMENT_REQUIRED");
    }
    const statement = ast as AstRecord;
    if (
      statement.type !== "select" ||
      (typeof statement.locking_read === "string" && statement.locking_read.length > 0) ||
      (typeof statement.for_update === "string" && statement.for_update.length > 0) ||
      (typeof statement.into === "object" &&
        statement.into !== null &&
        (statement.into as AstRecord).position !== null)
    ) {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_READ_ONLY_REQUIRED");
    }
    visit(statement);
    const cteNames = new Set(
      Array.isArray(statement.with)
        ? statement.with.flatMap((entry) => {
            if (typeof entry !== "object" || entry === null) return [];
            const name = (entry as AstRecord).name;
            return typeof name === "object" && name !== null && "value" in name
              ? [String((name as AstRecord).value)]
              : [];
          })
        : [],
    );
    const allowed = new Set(request.allowed_relations);
    if (
      tableList
        .map(relationName)
        .filter((relation) => !cteNames.has(relation))
        .some((relation) => !allowed.has(relation))
    ) {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RELATION_DENIED");
    }
  };
}
