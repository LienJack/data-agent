import { parse } from "pgsql-parser";

export type PostgresqlSandboxSqlPolicyReason =
  | "SANDBOX_SQL_SHAPE_REJECTED"
  | "SANDBOX_DANGEROUS_FUNCTION_REJECTED";

export class PostgresqlSandboxSqlPolicyError extends Error {
  override readonly name = "PostgresqlSandboxSqlPolicyError";

  constructor(
    message: string,
    readonly code: PostgresqlSandboxSqlPolicyReason,
  ) {
    super(message);
  }
}

export interface PostgresqlSandboxAllowedRelation {
  readonly schema_name: string;
  readonly relation_name: string;
}

export interface PostgresqlSandboxSqlPolicyInput {
  readonly sql: string;
  /**
   * 省略时只做服务端 Shape/Function 复核；传入时还会把所有物理 RangeVar
   * 精确约束到当前 sealed Snapshot Manifest。
   */
  readonly allowed_relations?: readonly PostgresqlSandboxAllowedRelation[];
}

type JsonRecord = Record<string, unknown>;

const allowedFunctions = new Set(["avg", "count", "max", "min", "sum"]);
const allowedOperators = new Set(["=", "<>", ">", ">=", "<", "<="]);
const allowedCastTypes = new Set([
  "bool",
  "date",
  "int4",
  "numeric",
  "text",
  "timestamp",
  "timestamptz",
  "uuid",
]);
const allowedAstNodeNames = new Set([
  "A_Const",
  "A_Expr",
  "BoolExpr",
  "CoalesceExpr",
  "ColumnRef",
  "CommonTableExpr",
  "FuncCall",
  "JoinExpr",
  "NullTest",
  "ParamRef",
  "RangeVar",
  "ResTarget",
  "SelectStmt",
  "String",
  "TypeCast",
]);
const dangerousAstNodeNames = new Set([
  "CollateClause",
  "JsonTable",
  "NextValueExpr",
  "RangeFunction",
  "RangeSubselect",
  "SQLValueFunction",
  "SubLink",
  "TableFunc",
]);
const generatedIdentifierPattern = /^[a-z][a-z0-9_]*$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shapeRejected(message: string): never {
  throw new PostgresqlSandboxSqlPolicyError(message, "SANDBOX_SQL_SHAPE_REJECTED");
}

function dangerousRejected(message: string): never {
  throw new PostgresqlSandboxSqlPolicyError(message, "SANDBOX_DANGEROUS_FUNCTION_REJECTED");
}

function assertOnlyKeys(node: JsonRecord, allowedKeys: readonly string[], message: string): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(node).some((key) => !allowed.has(key))) {
    shapeRejected(message);
  }
}

function wrappedNodeName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const [nodeName] = keys;
  return nodeName && isRecord(value[nodeName]) ? nodeName : null;
}

function assertWrappedNode(
  value: unknown,
  allowedNodeNames: readonly string[],
  message: string,
): JsonRecord {
  const nodeName = wrappedNodeName(value);
  if (!nodeName || !allowedNodeNames.includes(nodeName)) {
    shapeRejected(message);
  }
  const node = (value as JsonRecord)[nodeName];
  if (!isRecord(node)) {
    shapeRejected(message);
  }
  return node;
}

function sourceHasExactToken(sql: string, byteLocation: unknown, token: string): boolean {
  if (
    typeof sql !== "string" ||
    typeof token !== "string" ||
    token.length === 0 ||
    !Number.isInteger(byteLocation) ||
    (byteLocation as number) < 0
  ) {
    return false;
  }
  const source = Buffer.from(sql, "utf8");
  const expected = Buffer.from(token, "utf8");
  return source
    .subarray(byteLocation as number, (byteLocation as number) + expected.length)
    .equals(expected);
}

function stringVector(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 1 ||
      !isRecord(item.String) ||
      typeof item.String.sval !== "string"
    ) {
      return null;
    }
    result.push(item.String.sval);
  }
  return result;
}

function visitJson(value: unknown, visitor: (nodeName: string, node: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitJson(item, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isRecord(child)) visitor(key, child);
    visitJson(child, visitor);
  }
}

function assertSelectShape(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["targetList", "fromClause", "whereClause", "groupClause", "limitOption", "withClause", "op"],
    "Sandbox SQL SelectStmt 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    !Array.isArray(node.targetList) ||
    node.targetList.length === 0 ||
    node.targetList.some((target) => wrappedNodeName(target) !== "ResTarget") ||
    node.limitOption !== "LIMIT_OPTION_DEFAULT" ||
    node.op !== "SETOP_NONE"
  ) {
    shapeRejected(
      "Sandbox SQL 只接受编译器生成的单条 SELECT/WITH SELECT，不能包含 INTO、锁、集合、窗口、排序或 LIMIT 变体。",
    );
  }
  if (
    node.fromClause !== undefined &&
    (!Array.isArray(node.fromClause) || node.fromClause.length !== 1)
  ) {
    shapeRejected("Sandbox SQL FROM 必须是编译器生成的单一 Relation 或 Join。");
  }
  const fromNodeName = Array.isArray(node.fromClause) ? wrappedNodeName(node.fromClause[0]) : null;
  if (fromNodeName && dangerousAstNodeNames.has(fromNodeName)) {
    dangerousRejected(`Sandbox SQL 不接受 ${fromNodeName}。`);
  }
  if (fromNodeName && !["JoinExpr", "RangeVar"].includes(fromNodeName)) {
    shapeRejected("Sandbox SQL FROM 必须是编译器生成的单一 Relation 或 Join。");
  }
  if (
    node.whereClause !== undefined &&
    !["A_Expr", "BoolExpr", "NullTest"].includes(wrappedNodeName(node.whereClause) ?? "")
  ) {
    shapeRejected("Sandbox SQL WHERE 只能包含编译器生成的 Predicate。");
  }
  if (
    node.groupClause !== undefined &&
    (!Array.isArray(node.groupClause) ||
      node.groupClause.length === 0 ||
      node.groupClause.some((group) => wrappedNodeName(group) !== "ColumnRef"))
  ) {
    shapeRejected("Sandbox SQL GROUP BY 只能引用编译器列表达式。");
  }
  if (node.withClause !== undefined) {
    if (!isRecord(node.withClause)) {
      shapeRejected("Sandbox SQL WITH 缺少可验证的 CTE 列表。");
    }
    assertOnlyKeys(
      node.withClause,
      ["ctes", "location"],
      "Sandbox SQL WITH 不能包含递归或 compiler 外部字段。",
    );
    if (
      !Array.isArray(node.withClause.ctes) ||
      node.withClause.ctes.length === 0 ||
      node.withClause.ctes.some((cte) => wrappedNodeName(cte) !== "CommonTableExpr")
    ) {
      shapeRejected("Sandbox SQL WITH 必须包含非递归 compiler CTE。");
    }
  }
}

function assertResultTarget(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["name", "val", "location"],
    "Sandbox SQL ResTarget 包含 deterministic compiler 不会生成的字段。",
  );
  const valueNodeName = wrappedNodeName(node.val);
  if (valueNodeName && dangerousAstNodeNames.has(valueNodeName)) {
    dangerousRejected(`Sandbox SQL 不接受 ${valueNodeName}。`);
  }
  if (
    typeof node.name !== "string" ||
    node.name.length === 0 ||
    node.name.includes("\u0000") ||
    !["CoalesceExpr", "ColumnRef", "FuncCall", "TypeCast"].includes(valueNodeName ?? "")
  ) {
    shapeRejected("Sandbox SQL 的每个输出都必须是带 Alias 的 compiler 表达式。");
  }
}

function assertFunction(node: JsonRecord, sql: string): void {
  assertOnlyKeys(
    node,
    ["funcname", "args", "agg_distinct", "funcformat", "location"],
    "Sandbox SQL FuncCall 包含 deterministic compiler 不会生成的字段。",
  );
  const functionName = stringVector(node.funcname);
  const normalizedFunctionName = functionName?.[1]?.toLowerCase();
  if (
    functionName?.length !== 2 ||
    functionName[0]?.toLowerCase() !== "pg_catalog" ||
    !normalizedFunctionName ||
    !allowedFunctions.has(normalizedFunctionName) ||
    !Array.isArray(node.args) ||
    node.args.length !== 1 ||
    !["CoalesceExpr", "ColumnRef"].includes(wrappedNodeName(node.args[0]) ?? "") ||
    (node.agg_distinct !== undefined && node.agg_distinct !== true) ||
    node.funcformat !== "COERCE_EXPLICIT_CALL" ||
    !sourceHasExactToken(sql, node.location, `pg_catalog.${normalizedFunctionName.toUpperCase()}`)
  ) {
    dangerousRejected("Sandbox SQL 只能调用 pg_catalog 精确限定的 AVG/COUNT/MAX/MIN/SUM 聚合。");
  }
}

function assertOperator(node: JsonRecord, sql: string): void {
  const operator = stringVector(node.name);
  const operatorName = operator?.[1];
  if (node.kind !== "AEXPR_OP") {
    dangerousRejected(
      "Sandbox SQL 只接受 OPERATOR(pg_catalog.<op>) 精确限定的 compiler 比较运算。",
    );
  }
  assertOnlyKeys(
    node,
    ["kind", "name", "lexpr", "rexpr", "location"],
    "Sandbox SQL A_Expr 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    operator?.length !== 2 ||
    operator[0]?.toLowerCase() !== "pg_catalog" ||
    !operatorName ||
    !allowedOperators.has(operatorName) ||
    wrappedNodeName(node.lexpr) !== "ColumnRef" ||
    !["ColumnRef", "TypeCast"].includes(wrappedNodeName(node.rexpr) ?? "") ||
    !sourceHasExactToken(sql, node.location, `OPERATOR(pg_catalog.${operatorName})`)
  ) {
    dangerousRejected(
      "Sandbox SQL 只接受 OPERATOR(pg_catalog.<op>) 精确限定的 compiler 比较运算。",
    );
  }
}

function assertTypeCast(node: JsonRecord, sql: string): void {
  assertOnlyKeys(
    node,
    ["arg", "typeName", "location"],
    "Sandbox SQL TypeCast 包含 deterministic compiler 不会生成的字段。",
  );
  if (!isRecord(node.typeName)) shapeRejected("Sandbox SQL TypeCast 缺少类型标识。");
  assertOnlyKeys(
    node.typeName,
    ["names", "typemod", "location"],
    "Sandbox SQL TypeName 包含 deterministic compiler 不会生成的字段。",
  );
  const names = stringVector(node.typeName.names);
  const namespace = names?.[0]?.toLowerCase();
  const typeName = names?.[1]?.toLowerCase();
  if (
    names?.length !== 2 ||
    namespace !== "pg_catalog" ||
    !typeName ||
    !allowedCastTypes.has(typeName) ||
    node.typeName.typemod !== -1 ||
    wrappedNodeName(node.arg) !== "ParamRef" ||
    !sourceHasExactToken(sql, node.typeName.location, `pg_catalog.${typeName}`)
  ) {
    dangerousRejected("Sandbox SQL 只接受 pg_catalog 精确限定的 compiler 内部参数类型转换。");
  }
}

function assertCompilerConstant(node: JsonRecord, sql: string): void {
  assertOnlyKeys(
    node,
    ["ival", "location"],
    "Sandbox SQL A_Const 包含 deterministic compiler 不会生成的字段。",
  );
  const integer = node.ival;
  if (
    !isRecord(integer) ||
    (Object.keys(integer).length > 0 &&
      (Object.keys(integer).length !== 1 || integer.ival !== 0)) ||
    !sourceHasExactToken(sql, node.location, "0")
  ) {
    shapeRejected("Sandbox SQL 的业务值必须全部参数化；只允许编译器生成的常量 0。");
  }
}

function assertColumnReference(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["fields", "location"],
    "Sandbox SQL ColumnRef 包含 deterministic compiler 不会生成的字段。",
  );
  if (!Array.isArray(node.fields) || node.fields.length !== 2) {
    shapeRejected("Sandbox SQL ColumnRef 必须是编译器生成的两段标识。");
  }
  for (const field of node.fields) {
    if (
      !isRecord(field) ||
      Object.keys(field).length !== 1 ||
      !isRecord(field.String) ||
      typeof field.String.sval !== "string"
    ) {
      shapeRejected("Sandbox SQL 不接受通配符或非常规 ColumnRef。");
    }
  }
}

function assertParamReference(node: JsonRecord, sql: string): void {
  assertOnlyKeys(
    node,
    ["number", "location"],
    "Sandbox SQL ParamRef 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    !Number.isInteger(node.number) ||
    (node.number as number) < 1 ||
    !sourceHasExactToken(sql, node.location, `$${String(node.number)}`)
  ) {
    shapeRejected("Sandbox SQL ParamRef 必须是 compiler 生成的正序 PostgreSQL 参数。");
  }
}

function assertStringNode(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["sval"],
    "Sandbox SQL String AST node 包含 deterministic compiler 不会生成的字段。",
  );
  if (typeof node.sval !== "string" || node.sval.length === 0 || node.sval.includes("\u0000")) {
    shapeRejected("Sandbox SQL 标识符与 primitive name 必须是非空字符串。");
  }
}

function assertCoalesce(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["args", "location"],
    "Sandbox SQL CoalesceExpr 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    !Array.isArray(node.args) ||
    node.args.length !== 2 ||
    !["ColumnRef", "FuncCall"].includes(wrappedNodeName(node.args[0]) ?? "") ||
    wrappedNodeName(node.args[1]) !== "A_Const"
  ) {
    shapeRejected("Sandbox SQL COALESCE 只接受 compiler 的 expression-to-zero 形态。");
  }
}

function assertNullTest(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["arg", "nulltesttype", "location"],
    "Sandbox SQL NullTest 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    wrappedNodeName(node.arg) !== "ColumnRef" ||
    (node.nulltesttype !== "IS_NULL" && node.nulltesttype !== "IS_NOT_NULL")
  ) {
    shapeRejected("Sandbox SQL NullTest 只接受 compiler 的 IS NULL/IS NOT NULL。");
  }
}

function assertBooleanExpression(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["boolop", "args", "location"],
    "Sandbox SQL BoolExpr 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    (node.boolop !== "AND_EXPR" && node.boolop !== "OR_EXPR") ||
    !Array.isArray(node.args) ||
    node.args.length < 2
  ) {
    shapeRejected("Sandbox SQL BoolExpr 只接受 compiler 的 AND/OR 条件链。");
  }
  if (node.boolop === "AND_EXPR") {
    if (
      node.args.some(
        (argument) => !["A_Expr", "BoolExpr", "NullTest"].includes(wrappedNodeName(argument) ?? ""),
      )
    ) {
      shapeRejected("Sandbox SQL AND 只能组合 compiler Predicate。");
    }
    return;
  }

  let membershipField: string | null = null;
  const parameterNumbers = new Set<number>();
  for (const argument of node.args) {
    const comparison = assertWrappedNode(
      argument,
      ["A_Expr"],
      "Sandbox SQL OR 只能表示 compiler membership equality chain。",
    );
    const operator = stringVector(comparison.name);
    const left = assertWrappedNode(
      comparison.lexpr,
      ["ColumnRef"],
      "Sandbox SQL membership 左值必须是列。",
    );
    const right = assertWrappedNode(
      comparison.rexpr,
      ["TypeCast"],
      "Sandbox SQL membership 右值必须是类型化参数。",
    );
    const parameter = assertWrappedNode(
      right.arg,
      ["ParamRef"],
      "Sandbox SQL membership 右值必须是类型化参数。",
    );
    const fields = stringVector(left.fields);
    if (
      comparison.kind !== "AEXPR_OP" ||
      operator?.length !== 2 ||
      operator[0]?.toLowerCase() !== "pg_catalog" ||
      operator[1] !== "=" ||
      fields?.length !== 2 ||
      !Number.isInteger(parameter.number) ||
      parameterNumbers.has(parameter.number as number)
    ) {
      shapeRejected("Sandbox SQL OR 只能表示 compiler membership equality chain。");
    }
    const fieldIdentity = fields.join("\u0000");
    if (membershipField !== null && membershipField !== fieldIdentity) {
      shapeRejected("Sandbox SQL membership OR 链必须比较同一个字段。");
    }
    membershipField = fieldIdentity;
    parameterNumbers.add(parameter.number as number);
  }
}

function assertRangeVar(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["relname", "inh", "relpersistence", "alias", "location"],
    "Sandbox SQL RangeVar 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    typeof node.relname !== "string" ||
    node.relname.length === 0 ||
    node.relname.includes("\u0000") ||
    node.inh !== true ||
    node.relpersistence !== "p" ||
    !isRecord(node.alias)
  ) {
    shapeRejected("Sandbox SQL RangeVar 必须是 compiler 的带 Alias 普通关系引用。");
  }
  assertOnlyKeys(
    node.alias,
    ["aliasname"],
    "Sandbox SQL Relation Alias 不能声明列别名或额外字段。",
  );
  if (
    typeof node.alias.aliasname !== "string" ||
    !generatedIdentifierPattern.test(node.alias.aliasname)
  ) {
    shapeRejected("Sandbox SQL Relation Alias 必须来自 compiler-generated identifier。");
  }
}

function assertCommonTableExpression(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["ctename", "ctematerialized", "ctequery", "location"],
    "Sandbox SQL CommonTableExpr 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    typeof node.ctename !== "string" ||
    !generatedIdentifierPattern.test(node.ctename) ||
    node.ctematerialized !== "CTEMaterializeDefault" ||
    wrappedNodeName(node.ctequery) !== "SelectStmt"
  ) {
    shapeRejected("Sandbox SQL CTE 必须是 compiler 生成的非递归 SELECT CTE。");
  }
}

function assertJoin(node: JsonRecord): void {
  assertOnlyKeys(
    node,
    ["jointype", "larg", "rarg", "quals"],
    "Sandbox SQL JoinExpr 包含 deterministic compiler 不会生成的字段。",
  );
  if (
    (node.jointype !== "JOIN_INNER" && node.jointype !== "JOIN_LEFT") ||
    wrappedNodeName(node.larg) !== "RangeVar" ||
    wrappedNodeName(node.rarg) !== "RangeVar" ||
    !["A_Expr", "BoolExpr"].includes(wrappedNodeName(node.quals) ?? "")
  ) {
    shapeRejected("Sandbox SQL JoinExpr 只接受 compiler 的 INNER/LEFT equality join。");
  }
}

function relationKey(schemaName: string, relationName: string): string {
  return `${schemaName}\u0000${relationName}`;
}

function assertPhysicalRelations(
  rootSelect: JsonRecord,
  allowedRelations: readonly PostgresqlSandboxAllowedRelation[] | undefined,
): void {
  const manifestRelations = allowedRelations ?? [];
  const allowed = new Set(
    manifestRelations.map(({ schema_name, relation_name }) =>
      relationKey(schema_name, relation_name),
    ),
  );
  const allowedByUnqualifiedName = new Map<string, string>();
  for (const relation of manifestRelations) {
    const existing = allowedByUnqualifiedName.get(relation.relation_name);
    if (existing && existing !== relation.schema_name) {
      shapeRejected("Snapshot Manifest 不能含有无法由固定 search_path 唯一解析的同名关系。");
    }
    allowedByUnqualifiedName.set(relation.relation_name, relation.schema_name);
  }

  const ctes =
    isRecord(rootSelect.withClause) && Array.isArray(rootSelect.withClause.ctes)
      ? rootSelect.withClause.ctes.map((wrappedCte) =>
          assertWrappedNode(
            wrappedCte,
            ["CommonTableExpr"],
            "Sandbox SQL WITH 只能包含 compiler CTE。",
          ),
        )
      : [];
  const declaredCteNames = new Set<string>();
  for (const cte of ctes) {
    if (typeof cte.ctename !== "string" || declaredCteNames.has(cte.ctename)) {
      shapeRejected("Sandbox SQL CTE name 必须唯一。");
    }
    declaredCteNames.add(cte.ctename);
  }

  function assertSelectRelations(select: JsonRecord, visibleCteNames: ReadonlySet<string>): void {
    visitJson(select.fromClause, (nodeName, node) => {
      if (nodeName !== "RangeVar") return;
      if (
        typeof node.relname !== "string" ||
        node.catalogname !== undefined ||
        node.schemaname !== undefined
      ) {
        shapeRejected("Sandbox SQL RangeVar 缺少可验证的 relation name。");
      }
      if (visibleCteNames.has(node.relname)) return;
      if (declaredCteNames.has(node.relname)) {
        shapeRejected("Sandbox SQL CTE 不能自引用或前向引用尚未声明的 CTE。");
      }
      if (allowedRelations === undefined) return;
      const schemaName = allowedByUnqualifiedName.get(node.relname);
      if (!schemaName || !allowed.has(relationKey(schemaName, node.relname))) {
        shapeRejected("Sandbox SQL 引用了当前 sealed Snapshot Manifest 之外的关系。");
      }
    });
  }

  const visibleCteNames = new Set<string>();
  for (const cte of ctes) {
    const cteQuery = assertWrappedNode(
      cte.ctequery,
      ["SelectStmt"],
      "Sandbox SQL CTE 必须包含 compiler SELECT。",
    );
    if (cteQuery.withClause !== undefined) {
      shapeRejected("Sandbox SQL 不接受 nested WITH；CTE 必须按 compiler 拓扑顺序声明。");
    }
    assertSelectRelations(cteQuery, visibleCteNames);
    visibleCteNames.add(cte.ctename as string);
  }
  assertSelectRelations(rootSelect, visibleCteNames);
}

/**
 * 使用 PostgreSQL 原生语法树做 fail-closed 复核，且必须在创建 Datasource
 * 子进程/连接之前完成。它刻意只接受当前 deterministic compiler 的语法子集。
 */
export async function assertPostgresqlSandboxSqlPolicy(
  input: PostgresqlSandboxSqlPolicyInput,
): Promise<void> {
  if (!isRecord(input) || typeof input.sql !== "string" || input.sql.length === 0) {
    shapeRejected("Sandbox SQL Policy input 必须包含非空 SQL。");
  }
  if (
    input.sql.includes(";") ||
    input.sql.includes("--") ||
    input.sql.includes("/*") ||
    input.sql.includes("*/")
  ) {
    shapeRejected("Sandbox SQL 不接受分号、多语句或注释逃逸。");
  }

  let ast: unknown;
  try {
    ast = await parse(input.sql);
  } catch {
    shapeRejected("Sandbox SQL 无法解析为 PostgreSQL AST。");
  }
  if (!isRecord(ast) || !Array.isArray(ast.stmts) || ast.stmts.length !== 1) {
    shapeRejected("Sandbox SQL 必须精确包含一条 PostgreSQL Statement。");
  }
  assertOnlyKeys(ast, ["version", "stmts"], "PostgreSQL ParseResult 包含未知字段。");
  if (!Number.isInteger(ast.version) || (ast.version as number) < 1) {
    shapeRejected("PostgreSQL ParseResult 缺少可验证的 parser version。");
  }
  const rawStatement = ast.stmts[0];
  if (!isRecord(rawStatement)) {
    shapeRejected("Sandbox SQL 顶层必须是 SELECT/WITH SELECT。");
  }
  assertOnlyKeys(
    rawStatement,
    ["stmt", "stmt_location", "stmt_len"],
    "Sandbox SQL RawStmt 包含未知字段。",
  );
  const rootSelect = assertWrappedNode(
    rawStatement.stmt,
    ["SelectStmt"],
    "Sandbox SQL 顶层必须是 SELECT/WITH SELECT。",
  );

  visitJson(ast, (nodeName, node) => {
    if (dangerousAstNodeNames.has(nodeName)) {
      dangerousRejected(`Sandbox SQL 不接受 ${nodeName}。`);
    }
    if (nodeName.endsWith("Stmt") && nodeName !== "SelectStmt") {
      shapeRejected(`Sandbox SQL 不接受 ${nodeName}。`);
    }
    if (/^[A-Z][A-Za-z0-9_]*$/.test(nodeName) && !allowedAstNodeNames.has(nodeName)) {
      shapeRejected(`Sandbox SQL AST node ${nodeName} 不在 compiler 白名单中。`);
    }
    switch (nodeName) {
      case "SelectStmt":
        assertSelectShape(node);
        break;
      case "ResTarget":
        assertResultTarget(node);
        break;
      case "FuncCall":
        assertFunction(node, input.sql);
        break;
      case "A_Expr":
        assertOperator(node, input.sql);
        break;
      case "TypeCast":
        assertTypeCast(node, input.sql);
        break;
      case "A_Const":
        assertCompilerConstant(node, input.sql);
        break;
      case "ColumnRef":
        assertColumnReference(node);
        break;
      case "ParamRef":
        assertParamReference(node, input.sql);
        break;
      case "String":
        assertStringNode(node);
        break;
      case "CoalesceExpr":
        assertCoalesce(node);
        break;
      case "NullTest":
        assertNullTest(node);
        break;
      case "BoolExpr":
        assertBooleanExpression(node);
        break;
      case "RangeVar":
        assertRangeVar(node);
        break;
      case "CommonTableExpr":
        assertCommonTableExpression(node);
        break;
      case "JoinExpr":
        assertJoin(node);
        break;
      default:
        break;
    }
  });

  assertPhysicalRelations(rootSelect, input.allowed_relations);
}
