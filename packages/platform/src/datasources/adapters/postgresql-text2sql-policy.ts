import { deparse, parse } from "pgsql-parser";

export class PostgresqlText2SqlPolicyError extends Error {
  override readonly name = "PostgresqlText2SqlPolicyError";

  constructor(readonly code: "TEXT2SQL_SQL_SHAPE_REJECTED" | "TEXT2SQL_SQL_DANGEROUS") {
    super(code);
  }
}

export interface PostgresqlText2SqlPolicyInput {
  readonly sql: string;
  readonly parameter_count: number;
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

function reject(code: PostgresqlText2SqlPolicyError["code"]): never {
  throw new PostgresqlText2SqlPolicyError(code);
}

function assertOnlyKeys(node: JsonRecord, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(node).some((key) => !allowed.has(key))) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
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

function literalValue(node: JsonRecord): QueryParameter {
  if (node.isnull === true) return null;
  if (isRecord(node.ival) && typeof node.ival.ival === "number") {
    if (!Number.isSafeInteger(node.ival.ival)) reject("TEXT2SQL_SQL_SHAPE_REJECTED");
    return node.ival.ival;
  }
  if (isRecord(node.fval) && typeof node.fval.fval === "string") {
    const value = Number(node.fval.fval);
    if (!Number.isFinite(value)) reject("TEXT2SQL_SQL_SHAPE_REJECTED");
    return value;
  }
  if (isRecord(node.sval) && typeof node.sval.sval === "string") return node.sval.sval;
  if (typeof node.boolval === "boolean") return node.boolval;
  if (isRecord(node.boolval) && typeof node.boolval.boolval === "boolean") {
    return node.boolval.boolval;
  }
  reject("TEXT2SQL_SQL_SHAPE_REJECTED");
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
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }
  const parameters = [...input.parameters];
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!isRecord(value)) return value;
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
      return {
        ParamRef: {
          number: parameters.length,
          ...(Number.isInteger(constant.location) ? { location: constant.location } : {}),
        },
      };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  };
  let sql: string;
  try {
    sql = await deparse(rewrite(ast) as Parameters<typeof deparse>[0]);
  } catch {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
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
    !Array.isArray(input.allowed_relations) ||
    input.allowed_relations.length === 0
  ) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }
  if (
    input.sql.includes(";") ||
    input.sql.includes("--") ||
    input.sql.includes("/*") ||
    input.sql.includes("*/")
  ) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }

  let ast: unknown;
  try {
    ast = await parse(input.sql);
  } catch {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }
  if (!isRecord(ast) || !Array.isArray(ast.stmts) || ast.stmts.length !== 1) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }
  const raw = ast.stmts[0];
  if (!isRecord(raw) || wrappedNodeName(raw.stmt) !== "SelectStmt") {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }

  const allowedRelations = new Set(
    input.allowed_relations.map(({ schema_name, relation_name }) => `${schema_name}\0${relation_name}`),
  );
  if (allowedRelations.size !== input.allowed_relations.length) {
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }
  const cteNames = new Set<string>();
  visit(ast, (nodeName, node) => {
    if (nodeName !== "CommonTableExpr") return;
    if (typeof node.ctename !== "string" || cteNames.has(node.ctename)) {
      reject("TEXT2SQL_SQL_SHAPE_REJECTED");
    }
    cteNames.add(node.ctename);
  });

  const referencedParameters = new Set<number>();
  visit(ast, (nodeName, node) => {
    if (nodeName.endsWith("Stmt") && nodeName !== "SelectStmt") {
      reject("TEXT2SQL_SQL_DANGEROUS");
    }
    if (/^[A-Z][A-Za-z0-9_]*$/u.test(nodeName) && !allowedAstNodes.has(nodeName)) {
      reject("TEXT2SQL_SQL_DANGEROUS");
    }
    switch (nodeName) {
      case "SelectStmt": {
        assertOnlyKeys(node, [
          "distinctClause",
          "targetList",
          "fromClause",
          "whereClause",
          "groupClause",
          "havingClause",
          "sortClause",
          "limitOption",
          "withClause",
          "op",
        ]);
        if (
          !Array.isArray(node.targetList) ||
          node.targetList.length === 0 ||
          node.targetList.some((target) => wrappedNodeName(target) !== "ResTarget") ||
          node.limitOption !== "LIMIT_OPTION_DEFAULT" ||
          node.op !== "SETOP_NONE" ||
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
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      }
      case "CommonTableExpr":
        assertOnlyKeys(node, ["ctename", "ctematerialized", "ctequery", "location"]);
        if (
          typeof node.ctename !== "string" ||
          node.ctematerialized !== "CTEMaterializeDefault" ||
          wrappedNodeName(node.ctequery) !== "SelectStmt"
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      case "RangeVar": {
        assertOnlyKeys(node, [
          "schemaname",
          "relname",
          "inh",
          "relpersistence",
          "alias",
          "location",
        ]);
        if (
          typeof node.relname !== "string" ||
          node.inh !== true ||
          node.relpersistence !== "p" ||
          !isRecord(node.alias) ||
          typeof node.alias.aliasname !== "string"
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        if (node.schemaname === undefined) {
          if (!cteNames.has(node.relname)) reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        } else if (
          typeof node.schemaname !== "string" ||
          !allowedRelations.has(`${node.schemaname}\0${node.relname}`)
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      }
      case "JoinExpr":
        assertOnlyKeys(node, ["jointype", "larg", "rarg", "quals"]);
        if (
          !["JOIN_INNER", "JOIN_LEFT"].includes(String(node.jointype)) ||
          !["RangeVar", "JoinExpr"].includes(wrappedNodeName(node.larg) ?? "") ||
          wrappedNodeName(node.rarg) !== "RangeVar" ||
          !["A_Expr", "BoolExpr"].includes(wrappedNodeName(node.quals) ?? "")
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      case "ResTarget":
        assertOnlyKeys(node, ["name", "val", "location"]);
        if (typeof node.name !== "string" || node.name.length === 0 || !isRecord(node.val)) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      case "ColumnRef": {
        assertOnlyKeys(node, ["fields", "location"]);
        const fields = stringVector(node.fields);
        if (!fields || fields.length < 1 || fields.length > 3) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      }
      case "FuncCall": {
        assertOnlyKeys(node, [
          "funcname",
          "args",
          "agg_star",
          "agg_distinct",
          "agg_filter",
          "funcformat",
          "location",
        ]);
        const name = normalizedPrimitiveName(node.funcname);
        if (
          !name ||
          !safeFunctions.has(name) ||
          node.funcformat !== "COERCE_EXPLICIT_CALL" ||
          (node.agg_star === true && name !== "count") ||
          (node.agg_star !== true && !Array.isArray(node.args))
        ) {
          reject("TEXT2SQL_SQL_DANGEROUS");
        }
        break;
      }
      case "A_Expr": {
        assertOnlyKeys(node, [
          "kind",
          "name",
          "lexpr",
          "rexpr",
          "rexpr_list_start",
          "rexpr_list_end",
          "location",
        ]);
        const names = stringVector(node.name);
        const operator = names?.at(-1);
        if (
          !operator ||
          !safeOperators.has(operator) ||
          !["AEXPR_OP", "AEXPR_NULLIF", "AEXPR_IN"].includes(String(node.kind)) ||
          (names?.length === 2 && names[0]?.toLowerCase() !== "pg_catalog") ||
          (names?.length !== 1 && names?.length !== 2)
        ) {
          reject("TEXT2SQL_SQL_DANGEROUS");
        }
        if (node.kind === "AEXPR_IN" && wrappedNodeName(node.rexpr) !== "List") {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      }
      case "List":
        assertOnlyKeys(node, ["items"]);
        if (
          !Array.isArray(node.items) ||
          node.items.length === 0 ||
          node.items.some((item) => wrappedNodeName(item) !== "ParamRef")
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      case "ParamRef":
        assertOnlyKeys(node, ["number", "location"]);
        if (
          !Number.isSafeInteger(node.number) ||
          (node.number as number) < 1 ||
          !exactToken(input.sql, node.location, `$${String(node.number)}`)
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        referencedParameters.add(node.number as number);
        break;
      case "TypeCast": {
        assertOnlyKeys(node, ["arg", "typeName", "location"]);
        if (!isRecord(node.typeName)) reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        const typeName = normalizedPrimitiveName(node.typeName.names);
        if (!typeName || !safeCastTypes.has(typeName) || node.typeName.typemod !== -1) {
          reject("TEXT2SQL_SQL_DANGEROUS");
        }
        break;
      }
      case "A_Const":
        assertOnlyKeys(node, ["ival", "location"]);
        if (!isRecord(node.ival) || Object.keys(node.ival).length !== 0 || !exactToken(input.sql, node.location, "0")) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      case "SortBy":
        assertOnlyKeys(node, ["node", "sortby_dir", "sortby_nulls", "location"]);
        if (
          wrappedNodeName(node.node) !== "ColumnRef" ||
          !["SORTBY_DEFAULT", "SORTBY_ASC", "SORTBY_DESC"].includes(String(node.sortby_dir)) ||
          !["SORTBY_NULLS_DEFAULT", "SORTBY_NULLS_FIRST", "SORTBY_NULLS_LAST"].includes(
            String(node.sortby_nulls),
          )
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      case "BoolExpr":
        assertOnlyKeys(node, ["boolop", "args", "location"]);
        if (
          !["AND_EXPR", "OR_EXPR", "NOT_EXPR"].includes(String(node.boolop)) ||
          !Array.isArray(node.args) ||
          node.args.length === 0
        ) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
        }
        break;
      case "NullTest":
        assertOnlyKeys(node, ["arg", "nulltesttype", "location"]);
        if (!isRecord(node.arg) || !["IS_NULL", "IS_NOT_NULL"].includes(String(node.nulltesttype))) {
          reject("TEXT2SQL_SQL_SHAPE_REJECTED");
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
    reject("TEXT2SQL_SQL_SHAPE_REJECTED");
  }
}
