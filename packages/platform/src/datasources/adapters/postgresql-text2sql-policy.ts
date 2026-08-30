import { deparse, parse } from "pgsql-parser";

export type PostgresqlText2SqlPolicyDiagnosticCode =
  | "TEXT2SQL_SQL_INPUT_REJECTED"
  | "TEXT2SQL_SQL_PARAMETERIZATION_REJECTED"
  | "TEXT2SQL_SQL_STATEMENT_SHAPE_REJECTED"
  | "TEXT2SQL_SQL_SELECT_SHAPE_REJECTED"
  | "TEXT2SQL_SQL_CTE_SHAPE_REJECTED"
  | "TEXT2SQL_SQL_RELATION_BINDING_REJECTED"
  | "TEXT2SQL_SQL_JOIN_SHAPE_REJECTED"
  | "TEXT2SQL_SQL_PROJECTION_SHAPE_REJECTED"
  | "TEXT2SQL_SQL_PRIMITIVE_DENIED"
  | "TEXT2SQL_SQL_AST_NODE_DENIED"
  | "TEXT2SQL_SQL_FUNCTION_DENIED"
  | "TEXT2SQL_SQL_OPERATOR_DENIED"
  | "TEXT2SQL_SQL_CAST_DENIED"
  | "TEXT2SQL_SQL_TARGET_ALIAS_REQUIRED"
  | "TEXT2SQL_SQL_COLUMN_REFERENCE_REJECTED"
  | "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED"
  | "TEXT2SQL_SQL_LITERAL_POLICY_REJECTED"
  | "TEXT2SQL_SQL_ORDERING_SHAPE_REJECTED"
  | "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED";

export class PostgresqlText2SqlPolicyError extends Error {
  override readonly name = "PostgresqlText2SqlPolicyError";

  constructor(
    readonly code: "TEXT2SQL_SQL_SHAPE_REJECTED" | "TEXT2SQL_SQL_DANGEROUS",
    readonly diagnostic_code: PostgresqlText2SqlPolicyDiagnosticCode,
  ) {
    super(code);
  }
}

export interface PostgresqlText2SqlPolicyInput {
  readonly sql: string;
  readonly parameter_count: number;
  readonly parameters?: readonly QueryParameter[];
  readonly allowed_relations: readonly {
    readonly schema_name: string;
    readonly relation_name: string;
  }[];
}

type JsonRecord = Record<string, unknown>;
type QueryParameter = string | number | boolean | null;

const safeFunctions = new Set([
  "abs",
  "avg",
  "btrim",
  "ceil",
  "ceiling",
  "count",
  "date_part",
  "date_trunc",
  "floor",
  "greatest",
  "least",
  "length",
  "lower",
  "max",
  "min",
  "round",
  "stddev_pop",
  "stddev_samp",
  "sum",
  "upper",
  "variance",
  "var_pop",
  "var_samp",
]);
const safeOperators = new Set(["=", "<>", "!=", ">", ">=", "<", "<=", "+", "-", "*", "/"]);
const safeCastTypes = new Set([
  "bool",
  "boolean",
  "date",
  "float4",
  "float8",
  "int2",
  "int4",
  "int8",
  "interval",
  "numeric",
  "text",
  "timestamp",
  "timestamptz",
  "uuid",
]);
const temporalSortCastTypes = new Set(["date", "timestamp", "timestamptz"]);
const allowedAstNodes = new Set([
  "A_Const",
  "A_Expr",
  "A_Star",
  "BoolExpr",
  "BooleanTest",
  "CaseExpr",
  "CaseWhen",
  "CoalesceExpr",
  "ColumnRef",
  "CommonTableExpr",
  "FuncCall",
  "JoinExpr",
  "List",
  "MinMaxExpr",
  "NullTest",
  "ParamRef",
  "RangeVar",
  "ResTarget",
  "SelectStmt",
  "SortBy",
  "String",
  "TypeCast",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(
  code: PostgresqlText2SqlPolicyError["code"],
  diagnosticCode: PostgresqlText2SqlPolicyDiagnosticCode,
): never {
  throw new PostgresqlText2SqlPolicyError(code, diagnosticCode);
}

function assertOnlyKeys(
  node: JsonRecord,
  allowedKeys: readonly string[],
  diagnosticCode: PostgresqlText2SqlPolicyDiagnosticCode,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(node).some((key) => !allowed.has(key))) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", diagnosticCode);
  }
}

function wrappedNodeName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const [key] = keys;
  return key && isRecord(value[key]) ? key : null;
}

function stringVector(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const child of value) {
    if (!isRecord(child) || !isRecord(child.String) || typeof child.String.sval !== "string") {
      return null;
    }
    result.push(child.String.sval);
  }
  return result;
}

function visit(value: unknown, visitor: (nodeName: string, node: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) visit(child, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isRecord(child)) visitor(key, child);
    visit(child, visitor);
  }
}

function exactToken(sql: string, location: unknown, token: string): boolean {
  if (!Number.isInteger(location) || (location as number) < 0) return false;
  const source = Buffer.from(sql, "utf8");
  const expected = Buffer.from(token, "utf8");
  return source
    .subarray(location as number, (location as number) + expected.length)
    .equals(expected);
}

function normalizedPrimitiveName(value: unknown): string | null {
  const names = stringVector(value);
  if (!names || (names.length !== 1 && names.length !== 2)) return null;
  if (names.length === 2 && names[0]?.toLowerCase() !== "pg_catalog") return null;
  return names.at(-1)?.toLowerCase() ?? null;
}

function validLimitCount(
  value: unknown,
  parameters: readonly QueryParameter[] | undefined,
): boolean {
  if (value === undefined) return true;
  if (!parameters || !isRecord(value)) return false;
  const limitNode =
    wrappedNodeName(value) === "ParamRef"
      ? value
      : wrappedNodeName(value) === "TypeCast" &&
          isRecord(value.TypeCast) &&
          wrappedNodeName(value.TypeCast.arg) === "ParamRef" &&
          isRecord(value.TypeCast.typeName) &&
          value.TypeCast.typeName.typemod === -1 &&
          ["int2", "int4", "int8"].includes(
            normalizedPrimitiveName(value.TypeCast.typeName.names) ?? "",
          )
        ? (value.TypeCast.arg as JsonRecord)
        : null;
  if (!limitNode) return false;
  const reference = limitNode.ParamRef;
  if (!isRecord(reference) || !Number.isSafeInteger(reference.number)) return false;
  const parameter = parameters[(reference.number as number) - 1];
  return Number.isSafeInteger(parameter) && (parameter as number) > 0;
}

function validSortExpression(value: unknown): boolean {
  const expression = wrappedNodeName(value);
  if (expression === "ColumnRef") return true;
  if (expression !== "TypeCast" || !isRecord(value)) return false;
  const cast = value.TypeCast;
  if (!isRecord(cast) || wrappedNodeName(cast.arg) !== "ColumnRef" || !isRecord(cast.typeName)) {
    return false;
  }
  const typeName = normalizedPrimitiveName(cast.typeName.names);
  return typeName !== null && temporalSortCastTypes.has(typeName) && cast.typeName.typemod === -1;
}

function collectPhysicalRangeAliases(
  value: unknown,
  aliases: Map<string, { readonly schema_name: string; readonly relation_name: string }>,
): boolean {
  const nodeName = wrappedNodeName(value);
  if (nodeName === "RangeVar" && isRecord(value)) {
    const range = value.RangeVar;
    if (
      !isRecord(range) ||
      typeof range.schemaname !== "string" ||
      typeof range.relname !== "string" ||
      !isRecord(range.alias) ||
      typeof range.alias.aliasname !== "string" ||
      aliases.has(range.alias.aliasname)
    ) {
      return false;
    }
    aliases.set(range.alias.aliasname, {
      schema_name: range.schemaname,
      relation_name: range.relname,
    });
    return true;
  }
  if (nodeName !== "JoinExpr" || !isRecord(value) || !isRecord(value.JoinExpr)) return false;
  return (
    collectPhysicalRangeAliases(value.JoinExpr.larg, aliases) &&
    collectPhysicalRangeAliases(value.JoinExpr.rarg, aliases)
  );
}

/**
 * Proves that row-level physical bindings describe exact outer SELECT column projections.
 * Calculations, CTE pass-throughs, unqualified fields, and alias drift fail closed instead of
 * borrowing a physical column's provenance for a different expression.
 */
export async function hasExactPostgresqlPhysicalColumnProjections(input: {
  readonly sql: string;
  readonly columns: readonly {
    readonly output_name: string;
    readonly schema_name: string;
    readonly relation_name: string;
    readonly column_name: string;
  }[];
}): Promise<boolean> {
  if (input.columns.length === 0) return true;
  let ast: unknown;
  try {
    ast = await parse(input.sql);
  } catch {
    return false;
  }
  if (!isRecord(ast) || !Array.isArray(ast.stmts) || ast.stmts.length !== 1) return false;
  const raw = ast.stmts[0];
  if (!isRecord(raw) || wrappedNodeName(raw.stmt) !== "SelectStmt" || !isRecord(raw.stmt)) {
    return false;
  }
  const select = raw.stmt.SelectStmt;
  if (!isRecord(select) || !Array.isArray(select.targetList) || !Array.isArray(select.fromClause)) {
    return false;
  }
  const aliases = new Map<
    string,
    { readonly schema_name: string; readonly relation_name: string }
  >();
  if (select.fromClause.some((relation) => !collectPhysicalRangeAliases(relation, aliases))) {
    return false;
  }
  const targets = new Map<string, JsonRecord>();
  for (const wrappedTarget of select.targetList) {
    if (wrappedNodeName(wrappedTarget) !== "ResTarget" || !isRecord(wrappedTarget)) return false;
    const target = wrappedTarget.ResTarget;
    if (
      !isRecord(target) ||
      typeof target.name !== "string" ||
      !isRecord(target.val) ||
      targets.has(target.name)
    ) {
      return false;
    }
    targets.set(target.name, target.val);
  }
  return input.columns.every((column) => {
    let expression: unknown = targets.get(column.output_name);
    if (wrappedNodeName(expression) === "TypeCast" && isRecord(expression)) {
      const cast = expression.TypeCast;
      if (!isRecord(cast)) return false;
      expression = cast.arg;
    }
    if (wrappedNodeName(expression) !== "ColumnRef" || !isRecord(expression)) return false;
    const reference = expression.ColumnRef;
    if (!isRecord(reference)) return false;
    const fields = stringVector(reference.fields);
    if (fields?.length !== 2 || fields[1] !== column.column_name) return false;
    const relation = aliases.get(fields[0] as string);
    return (
      relation?.schema_name === column.schema_name &&
      relation.relation_name === column.relation_name
    );
  });
}

function literalValue(node: JsonRecord): QueryParameter {
  if (node.isnull === true) return null;
  if (isRecord(node.ival) && typeof node.ival.ival === "number") {
    if (!Number.isSafeInteger(node.ival.ival)) {
      reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_LITERAL_POLICY_REJECTED");
    }
    return node.ival.ival;
  }
  if (isRecord(node.fval) && typeof node.fval.fval === "string") {
    const value = Number(node.fval.fval);
    if (!Number.isFinite(value)) {
      reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_LITERAL_POLICY_REJECTED");
    }
    return value;
  }
  if (isRecord(node.sval) && typeof node.sval.sval === "string") return node.sval.sval;
  if (typeof node.boolval === "boolean") return node.boolval;
  if (isRecord(node.boolval) && typeof node.boolval.boolval === "boolean") {
    return node.boolval.boolval;
  }
  reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_LITERAL_POLICY_REJECTED");
}

/**
 * Turns model-authored literals into explicit candidate parameters before the
 * fail-closed AST policy runs. Numeric zero is retained only because the
 * policy allows it for zero checks. The compiler never invents SQL structure
 * or business values; it only makes values already present in the candidate
 * auditable in the parameter vector.
 */
export async function parameterizePostgresqlText2SqlCandidate(input: {
  readonly sql: string;
  readonly parameters: readonly QueryParameter[];
}): Promise<{ readonly sql: string; readonly parameters: readonly QueryParameter[] }> {
  let ast: unknown;
  try {
    ast = await parse(input.sql);
  } catch {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_PARAMETERIZATION_REJECTED");
  }
  const parameters = [...input.parameters];
  const stableTemporalUnitParameters = new Map<string, number>();
  const parameterReference = (constant: JsonRecord, parameterNumber: number): JsonRecord => ({
    ParamRef: {
      number: parameterNumber,
      ...(Number.isInteger(constant.location) ? { location: constant.location } : {}),
    },
  });
  const rewriteStableTemporalUnit = (value: unknown, functionName: string): unknown => {
    if (!isRecord(value) || wrappedNodeName(value) !== "A_Const") return rewrite(value);
    const constant = value.A_Const as JsonRecord;
    const parameter = literalValue(constant);
    if (typeof parameter !== "string") return rewrite(value);
    const key = `${functionName}\u0000${parameter}`;
    const existingParameterNumber = stableTemporalUnitParameters.get(key);
    if (existingParameterNumber !== undefined) {
      return parameterReference(constant, existingParameterNumber);
    }
    parameters.push(parameter);
    stableTemporalUnitParameters.set(key, parameters.length);
    return parameterReference(constant, parameters.length);
  };
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!isRecord(value)) return value;
    if (wrappedNodeName(value) === "FuncCall") {
      const call = value.FuncCall as JsonRecord;
      const functionName = normalizedPrimitiveName(call.funcname);
      const args = call.args;
      if (
        (functionName === "date_trunc" || functionName === "date_part") &&
        Array.isArray(args) &&
        args.length > 0
      ) {
        return {
          FuncCall: Object.fromEntries(
            Object.entries(call).map(([key, child]) => [
              key,
              key === "args"
                ? args.map((argument, index) =>
                    index === 0
                      ? rewriteStableTemporalUnit(argument, functionName)
                      : rewrite(argument),
                  )
                : rewrite(child),
            ]),
          ),
        };
      }
    }
    if (wrappedNodeName(value) === "A_Const") {
      const constant = value.A_Const as JsonRecord;
      if (
        isRecord(constant.ival) &&
        Object.keys(constant.ival).length === 0 &&
        exactToken(input.sql, constant.location, "0")
      ) {
        return value;
      }
      const parameter = literalValue(constant);
      parameters.push(parameter);
      return parameterReference(constant, parameters.length);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  };
  let sql: string;
  try {
    sql = await deparse(rewrite(ast) as Parameters<typeof deparse>[0]);
  } catch {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_PARAMETERIZATION_REJECTED");
  }
  return Object.freeze({ sql, parameters: Object.freeze(parameters) });
}

/**
 * Validates model-authored PostgreSQL SELECT candidates before target I/O.
 * Physical relations must be explicitly schema-qualified; unqualified names are CTEs only.
 * The transport fixes search_path to pg_catalog so unqualified approved primitives cannot resolve
 * to datasource-owned functions or operators.
 */
export async function assertPostgresqlText2SqlCandidatePolicy(
  input: PostgresqlText2SqlPolicyInput,
): Promise<void> {
  if (
    !isRecord(input) ||
    typeof input.sql !== "string" ||
    input.sql.trim().length === 0 ||
    !Number.isSafeInteger(input.parameter_count) ||
    input.parameter_count < 0 ||
    (input.parameters !== undefined &&
      (!Array.isArray(input.parameters) || input.parameters.length !== input.parameter_count)) ||
    !Array.isArray(input.allowed_relations) ||
    input.allowed_relations.length === 0
  ) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_INPUT_REJECTED");
  }
  if (
    input.sql.includes(";") ||
    input.sql.includes("--") ||
    input.sql.includes("/*") ||
    input.sql.includes("*/")
  ) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_STATEMENT_SHAPE_REJECTED");
  }

  let ast: unknown;
  try {
    ast = await parse(input.sql);
  } catch {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_STATEMENT_SHAPE_REJECTED");
  }
  if (!isRecord(ast) || !Array.isArray(ast.stmts) || ast.stmts.length !== 1) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_STATEMENT_SHAPE_REJECTED");
  }
  const raw = ast.stmts[0];
  if (!isRecord(raw) || wrappedNodeName(raw.stmt) !== "SelectStmt") {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_STATEMENT_SHAPE_REJECTED");
  }

  const allowedRelations = new Set(
    input.allowed_relations.map(
      ({ schema_name, relation_name }) => `${schema_name}\0${relation_name}`,
    ),
  );
  if (allowedRelations.size !== input.allowed_relations.length) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_RELATION_BINDING_REJECTED");
  }
  const cteNames = new Set<string>();
  visit(ast, (nodeName, node) => {
    if (nodeName !== "CommonTableExpr") return;
    if (typeof node.ctename !== "string" || cteNames.has(node.ctename)) {
      reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_CTE_SHAPE_REJECTED");
    }
    cteNames.add(node.ctename);
  });

  const referencedParameters = new Set<number>();
  visit(ast, (nodeName, node) => {
    if (nodeName.endsWith("Stmt") && nodeName !== "SelectStmt") {
      reject("TEXT2SQL_SQL_DANGEROUS", "TEXT2SQL_SQL_AST_NODE_DENIED");
    }
    if (/^[A-Z][A-Za-z0-9_]*$/u.test(nodeName) && !allowedAstNodes.has(nodeName)) {
      reject("TEXT2SQL_SQL_DANGEROUS", "TEXT2SQL_SQL_AST_NODE_DENIED");
    }
    switch (nodeName) {
      case "SelectStmt": {
        assertOnlyKeys(
          node,
          [
            "distinctClause",
            "targetList",
            "fromClause",
            "whereClause",
            "groupClause",
            "havingClause",
            "sortClause",
            "limitCount",
            "limitOption",
            "withClause",
            "op",
          ],
          "TEXT2SQL_SQL_SELECT_SHAPE_REJECTED",
        );
        if (
          !Array.isArray(node.targetList) ||
          node.targetList.length === 0 ||
          node.targetList.some((target) => wrappedNodeName(target) !== "ResTarget") ||
          (node.limitCount === undefined
            ? node.limitOption !== "LIMIT_OPTION_DEFAULT"
            : node.limitOption !== "LIMIT_OPTION_COUNT") ||
          node.op !== "SETOP_NONE" ||
          !validLimitCount(node.limitCount, input.parameters) ||
          (node.fromClause !== undefined &&
            (!Array.isArray(node.fromClause) || node.fromClause.length !== 1)) ||
          (node.withClause !== undefined &&
            (!isRecord(node.withClause) || node.withClause.recursive === true)) ||
          (node.distinctClause !== undefined &&
            (!Array.isArray(node.distinctClause) ||
              node.distinctClause.length !== 1 ||
              !isRecord(node.distinctClause[0]) ||
              Object.keys(node.distinctClause[0]).length !== 0))
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_SELECT_SHAPE_REJECTED");
        }
        break;
      }
      case "CommonTableExpr":
        assertOnlyKeys(
          node,
          ["ctename", "ctematerialized", "ctequery", "location"],
          "TEXT2SQL_SQL_CTE_SHAPE_REJECTED",
        );
        if (
          typeof node.ctename !== "string" ||
          node.ctematerialized !== "CTEMaterializeDefault" ||
          wrappedNodeName(node.ctequery) !== "SelectStmt"
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_CTE_SHAPE_REJECTED");
        }
        break;
      case "RangeVar": {
        assertOnlyKeys(
          node,
          ["schemaname", "relname", "inh", "relpersistence", "alias", "location"],
          "TEXT2SQL_SQL_RELATION_BINDING_REJECTED",
        );
        if (
          typeof node.relname !== "string" ||
          node.inh !== true ||
          node.relpersistence !== "p" ||
          !isRecord(node.alias) ||
          typeof node.alias.aliasname !== "string"
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_RELATION_BINDING_REJECTED");
        }
        if (node.schemaname === undefined) {
          if (!cteNames.has(node.relname)) {
            reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_RELATION_BINDING_REJECTED");
          }
        } else if (
          typeof node.schemaname !== "string" ||
          !allowedRelations.has(`${node.schemaname}\0${node.relname}`)
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_RELATION_BINDING_REJECTED");
        }
        break;
      }
      case "JoinExpr":
        assertOnlyKeys(
          node,
          ["jointype", "larg", "rarg", "quals"],
          "TEXT2SQL_SQL_JOIN_SHAPE_REJECTED",
        );
        if (
          !["JOIN_INNER", "JOIN_LEFT"].includes(String(node.jointype)) ||
          !["RangeVar", "JoinExpr"].includes(wrappedNodeName(node.larg) ?? "") ||
          wrappedNodeName(node.rarg) !== "RangeVar" ||
          !["A_Expr", "BoolExpr"].includes(wrappedNodeName(node.quals) ?? "")
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_JOIN_SHAPE_REJECTED");
        }
        break;
      case "ResTarget":
        assertOnlyKeys(node, ["name", "val", "location"], "TEXT2SQL_SQL_TARGET_ALIAS_REQUIRED");
        if (typeof node.name !== "string" || node.name.length === 0 || !isRecord(node.val)) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_TARGET_ALIAS_REQUIRED");
        }
        break;
      case "ColumnRef": {
        assertOnlyKeys(node, ["fields", "location"], "TEXT2SQL_SQL_COLUMN_REFERENCE_REJECTED");
        const fields = stringVector(node.fields);
        if (!fields || fields.length < 1 || fields.length > 3) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_COLUMN_REFERENCE_REJECTED");
        }
        break;
      }
      case "FuncCall": {
        assertOnlyKeys(
          node,
          ["funcname", "args", "agg_star", "agg_distinct", "agg_filter", "funcformat", "location"],
          "TEXT2SQL_SQL_FUNCTION_DENIED",
        );
        const name = normalizedPrimitiveName(node.funcname);
        if (
          !name ||
          !safeFunctions.has(name) ||
          node.funcformat !== "COERCE_EXPLICIT_CALL" ||
          (node.agg_star === true && name !== "count") ||
          (node.agg_star !== true && !Array.isArray(node.args))
        ) {
          reject("TEXT2SQL_SQL_DANGEROUS", "TEXT2SQL_SQL_FUNCTION_DENIED");
        }
        break;
      }
      case "A_Expr": {
        assertOnlyKeys(
          node,
          ["kind", "name", "lexpr", "rexpr", "rexpr_list_start", "rexpr_list_end", "location"],
          "TEXT2SQL_SQL_OPERATOR_DENIED",
        );
        const names = stringVector(node.name);
        const operator = names?.at(-1);
        if (
          !operator ||
          !safeOperators.has(operator) ||
          !["AEXPR_OP", "AEXPR_NULLIF", "AEXPR_IN"].includes(String(node.kind)) ||
          (names?.length === 2 && names[0]?.toLowerCase() !== "pg_catalog") ||
          (names?.length !== 1 && names?.length !== 2)
        ) {
          reject("TEXT2SQL_SQL_DANGEROUS", "TEXT2SQL_SQL_OPERATOR_DENIED");
        }
        if (node.kind === "AEXPR_IN" && wrappedNodeName(node.rexpr) !== "List") {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED");
        }
        break;
      }
      case "List":
        assertOnlyKeys(node, ["items"], "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED");
        if (
          !Array.isArray(node.items) ||
          node.items.length === 0 ||
          node.items.some((item) => wrappedNodeName(item) !== "ParamRef")
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED");
        }
        break;
      case "ParamRef":
        assertOnlyKeys(node, ["number", "location"], "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED");
        if (
          !Number.isSafeInteger(node.number) ||
          (node.number as number) < 1 ||
          !exactToken(input.sql, node.location, `$${String(node.number)}`)
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED");
        }
        referencedParameters.add(node.number as number);
        break;
      case "TypeCast": {
        assertOnlyKeys(node, ["arg", "typeName", "location"], "TEXT2SQL_SQL_CAST_DENIED");
        if (!isRecord(node.typeName)) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED");
        }
        const typeName = normalizedPrimitiveName(node.typeName.names);
        if (!typeName || !safeCastTypes.has(typeName) || node.typeName.typemod !== -1) {
          reject("TEXT2SQL_SQL_DANGEROUS", "TEXT2SQL_SQL_CAST_DENIED");
        }
        break;
      }
      case "A_Const":
        assertOnlyKeys(node, ["ival", "location"], "TEXT2SQL_SQL_LITERAL_POLICY_REJECTED");
        if (
          !isRecord(node.ival) ||
          Object.keys(node.ival).length !== 0 ||
          !exactToken(input.sql, node.location, "0")
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_LITERAL_POLICY_REJECTED");
        }
        break;
      case "SortBy":
        assertOnlyKeys(
          node,
          ["node", "sortby_dir", "sortby_nulls", "location"],
          "TEXT2SQL_SQL_ORDERING_SHAPE_REJECTED",
        );
        if (
          !validSortExpression(node.node) ||
          !["SORTBY_DEFAULT", "SORTBY_ASC", "SORTBY_DESC"].includes(String(node.sortby_dir)) ||
          !["SORTBY_NULLS_DEFAULT", "SORTBY_NULLS_FIRST", "SORTBY_NULLS_LAST"].includes(
            String(node.sortby_nulls),
          )
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_ORDERING_SHAPE_REJECTED");
        }
        break;
      case "BoolExpr":
        assertOnlyKeys(
          node,
          ["boolop", "args", "location"],
          "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED",
        );
        if (
          !["AND_EXPR", "OR_EXPR", "NOT_EXPR"].includes(String(node.boolop)) ||
          !Array.isArray(node.args) ||
          node.args.length === 0
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED");
        }
        break;
      case "NullTest":
        assertOnlyKeys(
          node,
          ["arg", "nulltesttype", "location"],
          "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED",
        );
        if (
          !isRecord(node.arg) ||
          !["IS_NULL", "IS_NOT_NULL"].includes(String(node.nulltesttype))
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_EXPRESSION_SHAPE_REJECTED");
        }
        break;
      default:
        break;
    }
  });

  if (
    referencedParameters.size !== input.parameter_count ||
    [...referencedParameters].some((number) => number > input.parameter_count) ||
    Array.from({ length: input.parameter_count }, (_, index) => index + 1).some(
      (number) => !referencedParameters.has(number),
    )
  ) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED", "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED");
  }
}
