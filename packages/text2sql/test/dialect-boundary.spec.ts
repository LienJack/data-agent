import {
  artifactReferenceIdentity,
  computeSqlArtifactQueryHash,
  type QueryContractPayload,
  sha256ContentHash,
  sqlArtifactSchema,
} from "@data-agent/contracts";
import {
  buildLogicalPlan,
  buildSemanticQuery,
  compilePostgresqlLogicalPlan,
  compileSqlDialect,
  isPostgresqlCompilation,
  validateLogicalPlan,
} from "@data-agent/text2sql";
import { describe, expect, it } from "vitest";
import { quotePostgresqlIdentifier } from "../src/compiler/postgresql-ast.js";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import {
  analystPolicy,
  artifactReference,
  commerceCatalog,
  fixtureIds,
  netRevenueContract,
} from "./support/commerce-fixture.js";
import { committedLogicalPlanAuthorityFixture } from "./support/compiler-authority-fixture.js";

async function readyFixture(
  queryContract: QueryContractPayload = netRevenueContract(),
  catalog: unknown = commerceCatalog,
  policy: unknown = analystPolicy,
) {
  const groundingResult = await groundQueryContract({
    query_contract: queryContract,
    catalog,
    policy,
    retrieval_candidates: [],
    max_context_objects: 64,
  });
  if (groundingResult.state !== "READY") {
    throw new Error(`测试 Fixture 必须完成 Grounding，实际为 ${groundingResult.state}。`);
  }
  const semanticQuery = buildSemanticQuery({
    query_contract: queryContract,
    grounding: groundingResult.grounding,
  });
  const logicalPlanCandidate = buildLogicalPlan({
    semantic_query: semanticQuery,
    grounding: groundingResult.grounding,
  });
  const validation = validateLogicalPlan({
    logical_plan: logicalPlanCandidate,
    grounding: groundingResult.grounding,
    semantic_query: semanticQuery,
    query_contract: queryContract,
  });
  if (validation.state !== "VALID") {
    throw new Error(`测试 Fixture 的 LogicalPlan 必须有效：${validation.reason_code}`);
  }
  return {
    queryContract,
    grounding: groundingResult.grounding,
    semanticQuery,
    logicalPlanCandidate,
    logicalPlan: validation.logical_plan,
  };
}

async function authoritativeBinding(fixture: Awaited<ReturnType<typeof readyFixture>>) {
  const authorityFixture = await committedLogicalPlanAuthorityFixture(fixture.logicalPlan);
  return authorityFixture.bind();
}

async function compilerInput(fixture: Awaited<ReturnType<typeof readyFixture>>) {
  return {
    logical_plan_binding: await authoritativeBinding(fixture),
    grounding: fixture.grounding,
  };
}

function expectRecursivelyFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectRecursivelyFrozen(Reflect.get(value, key), visited);
  }
}

function simulatedPostgresqlDriverColumns(sql: string): string[] {
  const finalSelectOffset = sql.lastIndexOf("\nSELECT\n");
  if (finalSelectOffset < 0) throw new Error("SQL 缺少最终 SELECT。");
  const finalSelect = sql.slice(finalSelectOffset + 1);
  const fromOffset = finalSelect.indexOf("\nFROM ");
  if (fromOffset < 0) throw new Error("最终 SELECT 缺少 FROM。");
  return [...finalSelect.slice(0, fromOffset).matchAll(/\sAS\s+"((?:[^"]|"")+)"/g)].map(
    ([, quoted]) => (quoted ?? "").replaceAll('""', '"'),
  );
}

describe("PostgreSQL Dialect Compiler", () => {
  it("从品牌化 LogicalPlan 产生可验真的确定性 SqlArtifact、AST、Proof 与参数顺序", async () => {
    const fixture = await readyFixture();
    const input = await compilerInput(fixture);
    const first = await compilePostgresqlLogicalPlan(input);
    const second = await compilePostgresqlLogicalPlan(input);
    if (first.state !== "COMPILED" || second.state !== "COMPILED") {
      throw new Error("测试 Fixture 必须成功编译 PostgreSQL。");
    }

    expect(isPostgresqlCompilation(first.compilation)).toBe(true);
    expect(sqlArtifactSchema.parse(first.compilation.sql_artifact)).toEqual(
      first.compilation.sql_artifact,
    );
    expect(first.compilation.proof).toMatchObject({
      compiler_version: "postgresql-compiler@1.1.0",
      dialect: "postgresql",
      logical_plan_ref: input.logical_plan_binding.reference,
      logical_plan_hash: await sha256ContentHash(fixture.logicalPlan),
      grounding_hash: fixture.grounding.grounding_hash,
      policy_version: fixture.grounding.policy_version,
      query_hash: first.compilation.sql_artifact.query_hash,
      identifier_authority: "GROUNDING_PHYSICAL_NAME_ONLY",
      alias_strategy: "VALIDATED_LOGICAL_OUTPUT_ALIAS_QUOTED",
      parameterization: "POSTGRESQL_POSITIONAL_ALL_VALUES",
      time_semantics: "HALF_OPEN_GTE_LT",
      search_path_binding: "REQUIRED_AT_EXECUTION",
    });
    expect(first.compilation.parameter_order).toEqual([
      {
        position: 1,
        placeholder: "$1",
        parameter_key: "literal.status",
        source: "literal",
        data_type: "text",
      },
      {
        position: 2,
        placeholder: "$2",
        parameter_key: "policy.tenant_id",
        source: "policy",
        data_type: "uuid",
      },
      {
        position: 3,
        placeholder: "$3",
        parameter_key: "time.start",
        source: "time",
        data_type: "timestamptz",
      },
      {
        position: 4,
        placeholder: "$4",
        parameter_key: "time.end",
        source: "time",
        data_type: "timestamptz",
      },
    ]);
    expect(first.compilation.sql_artifact.parameters).toEqual({
      $1: "paid",
      $2: fixtureIds.tenant,
      $3: fixture.queryContract.time_range.start,
      $4: fixture.queryContract.time_range.end,
    });
    expect(first.compilation.sql_artifact.sql).toContain('FROM "orders" AS "source"');
    expect(first.compilation.sql_artifact.sql).toContain("$1::pg_catalog.text");
    expect(first.compilation.sql_artifact.sql).toMatch(
      /OPERATOR\(pg_catalog\.>=\) \$3::pg_catalog\.timestamptz/,
    );
    expect(first.compilation.sql_artifact.sql).toMatch(
      /OPERATOR\(pg_catalog\.<\) \$4::pg_catalog\.timestamptz/,
    );
    expect(first.compilation.sql_artifact.sql).toContain("pg_catalog.SUM(");
    expect(first.compilation.sql_artifact.sql).not.toContain("paid");
    expect(first.compilation.sql_artifact.sql).not.toContain("BETWEEN");
    expect(first.compilation.sql_artifact.sql).not.toContain("NATURAL JOIN");
    expect(first.compilation.sql_artifact.query_hash).toBe(
      await computeSqlArtifactQueryHash(first.compilation.sql_artifact),
    );
    expect(first.compilation.sql_artifact.sql).toBe(second.compilation.sql_artifact.sql);
    expect(first.compilation.sql_artifact.query_hash).toBe(
      second.compilation.sql_artifact.query_hash,
    );
    expect(first.compilation.ast).toEqual(second.compilation.ast);
    expect(first.compilation.proof).toEqual(second.compilation.proof);
    expect(first.compilation.parameter_order).toEqual(second.compilation.parameter_order);
    expectRecursivelyFrozen(first.compilation);
  });

  it("最终 SQL 的 driver 列名精确等于 QueryContract result_contract，而不是内部 result_N alias", async () => {
    const fixture = await readyFixture();
    const result = await compilePostgresqlLogicalPlan(await compilerInput(fixture));
    if (result.state !== "COMPILED") {
      throw new Error(`Output Alias Fixture 编译失败：${result.reason_code}`);
    }

    const driverColumns = simulatedPostgresqlDriverColumns(result.compilation.sql_artifact.sql);
    expect(driverColumns).toEqual(fixture.queryContract.result_contract.columns);
    expect(result.compilation.proof.output_columns).toEqual(
      fixture.queryContract.result_contract.columns.map((column) => ({
        logical_alias: column,
        sql_alias: column,
      })),
    );
    expect(result.compilation.sql_artifact.sql).toContain('AS "dimension.customer_segment"');
    expect(result.compilation.sql_artifact.sql).toContain('AS "metric.net_revenue"');
    expect(result.compilation.sql_artifact.sql).not.toMatch(/\bresult_[0-9]+\b/);
  });

  it("只接受本进程权威 LogicalPlan 绑定，并拒绝 plain/clone binding、raw SQL 或额外字段", async () => {
    const fixture = await readyFixture();
    const authorityFixture = await committedLogicalPlanAuthorityFixture(fixture.logicalPlan);
    const plainBinding = {
      logical_plan: fixture.logicalPlan,
      reference: authorityFixture.reference,
      policy_binding: {
        app_id: authorityFixture.reference.app_id,
        tenant_id: authorityFixture.reference.tenant_id,
        environment: authorityFixture.reference.environment,
        principal_id: "forged@example.test",
      },
    };
    const brandedInput = await compilerInput(fixture);

    await expect(
      compilePostgresqlLogicalPlan({
        ...brandedInput,
        sql: "SELECT 1",
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_INPUT_INVALID",
    });
    await expect(
      compilePostgresqlLogicalPlan({
        ...brandedInput,
        logical_plan_binding: plainBinding,
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED",
    });
    await expect(
      compilePostgresqlLogicalPlan({
        ...brandedInput,
        logical_plan_binding: structuredClone(brandedInput.logical_plan_binding),
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED",
    });
    await expect(
      compilePostgresqlLogicalPlan({
        logical_plan_binding: plainBinding,
        grounding: fixture.grounding,
        authority: {
          resolveCommitted: async () => authorityFixture.document,
          verifyCommitted: async () => true,
        },
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_INPUT_INVALID",
    });
    expect(isPostgresqlCompilation({ dialect: "postgresql" })).toBe(false);
  });

  it("Authority 精确绑定 committed document/ref，拒绝 Plan A + Ref B、synthetic/uncommitted ref 与 authority clone", async () => {
    const planA = await readyFixture();
    const planB = await readyFixture(
      netRevenueContract({
        filters: [{ field: "orders.status", operator: "neq", value: "cancelled" }],
      }),
    );
    const authorityA = await committedLogicalPlanAuthorityFixture(planA.logicalPlan);
    const authorityB = await committedLogicalPlanAuthorityFixture(planB.logicalPlan, {
      artifact_id: "00000000-0000-4000-8000-000000000091",
    });

    await expect(authorityB.bind(planA.logicalPlan)).rejects.toThrow(
      "POSTGRESQL_COMPILER_LOGICAL_PLAN_PAYLOAD_MISMATCH",
    );
    expect(artifactReferenceIdentity(authorityA.reference)).not.toBe(
      artifactReferenceIdentity(authorityB.reference),
    );

    const syntheticReference = {
      ...authorityA.reference,
      artifact_id: "00000000-0000-4000-8000-000000000092",
    };
    await expect(authorityA.bind(planA.logicalPlan, syntheticReference)).rejects.toThrow(
      "POSTGRESQL_COMPILER_LOGICAL_PLAN_NOT_COMMITTED",
    );

    const uncommitted = await committedLogicalPlanAuthorityFixture(planA.logicalPlan, {
      committed: false,
      artifact_id: "00000000-0000-4000-8000-000000000093",
    });
    await expect(uncommitted.bind()).rejects.toThrow(
      "POSTGRESQL_COMPILER_LOGICAL_PLAN_NOT_COMMITTED",
    );
    const revokedDuringResolution = await committedLogicalPlanAuthorityFixture(planA.logicalPlan, {
      revoke_after_first_verification: true,
      artifact_id: "00000000-0000-4000-8000-000000000094",
    });
    await expect(revokedDuringResolution.bind()).rejects.toThrow(
      "POSTGRESQL_COMPILER_LOGICAL_PLAN_NOT_COMMITTED",
    );
    await expect(
      authorityA.bind(planA.logicalPlan, authorityA.reference, {
        ...(authorityA.authority as object),
      }),
    ).rejects.toThrow("POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED");
    await expect(
      authorityA.bind(planA.logicalPlan, authorityA.reference, {
        principal_id: "attacker@example.test",
        resolveCommitted: async () => authorityA.document,
        verifyCommitted: async () => true,
        verifyCommitterCapability: async () => true,
        verifyPrincipalCapability: async () => true,
      }),
    ).rejects.toThrow("POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED");
  });

  it("其他 Dialect 只能返回稳定 UNSUPPORTED，不进入 PostgreSQL 分支", async () => {
    const fixture = await readyFixture();

    await expect(
      compileSqlDialect({
        dialect: "mysql",
        ...(await compilerInput(fixture)),
      }),
    ).resolves.toEqual({
      state: "UNSUPPORTED",
      reason_code: "UNSUPPORTED_DIALECT",
    });
    const postgresql = await compileSqlDialect({
      dialect: "postgresql",
      ...(await compilerInput(fixture)),
    });
    expect(postgresql.state).toBe("COMPILED");
  });

  it("Policy binding 从权威 Ref/Capability 绑定 app/tenant/environment/principal，调用者注入与未知 key 失败关闭", async () => {
    const fixture = await readyFixture();
    const input = await compilerInput(fixture);

    await expect(
      compilePostgresqlLogicalPlan({
        ...input,
        policy_bindings: {
          tenant_id: "00000000-0000-4000-8000-000000000099",
        },
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_INPUT_INVALID",
    });

    const compiled = await compilePostgresqlLogicalPlan(input);
    if (compiled.state !== "COMPILED") {
      throw new Error(`Tenant Policy Fixture 编译失败：${compiled.reason_code}`);
    }
    expect(compiled.compilation.sql_artifact.parameters.$2).toBe(
      input.logical_plan_binding.reference.tenant_id,
    );

    const scopedIdentity = {
      app_id: "00000000-0000-4000-8000-000000000081",
      tenant_id: fixtureIds.tenant,
      environment: "preview",
    } as const;
    const scopedPrincipal = "preview-analyst@example.test";
    const scopedContract = netRevenueContract({
      evidence_plan_ref: {
        ...artifactReference("EvidencePlan"),
        ...scopedIdentity,
      },
    });
    const scopedCatalog = {
      ...commerceCatalog,
      scope: scopedIdentity,
      tables: commerceCatalog.tables.map((table) => {
        if (table.table_id === "orders") {
          return {
            ...table,
            columns: [
              ...table.columns,
              {
                column_id: "orders.app_id",
                physical_name: "app_id",
                data_type: "uuid" as const,
                nullable: false,
                sensitivity: "RESTRICTED" as const,
              },
              {
                column_id: "orders.environment",
                physical_name: "environment",
                data_type: "text" as const,
                nullable: false,
                sensitivity: "RESTRICTED" as const,
              },
            ],
          };
        }
        if (table.table_id === "customers") {
          return {
            ...table,
            columns: [
              ...table.columns,
              {
                column_id: "customers.app_id",
                physical_name: "app_id",
                data_type: "uuid" as const,
                nullable: false,
                sensitivity: "RESTRICTED" as const,
              },
              {
                column_id: "customers.environment",
                physical_name: "environment",
                data_type: "text" as const,
                nullable: false,
                sensitivity: "RESTRICTED" as const,
              },
              {
                column_id: "customers.principal_id",
                physical_name: "principal_id",
                data_type: "text" as const,
                nullable: false,
                sensitivity: "RESTRICTED" as const,
              },
            ],
          };
        }
        return table;
      }),
    };
    const scopedPolicy = {
      ...analystPolicy,
      scope: scopedIdentity,
      principal_id: scopedPrincipal,
      allowed_tables: analystPolicy.allowed_tables.map((table) => ({
        ...table,
        column_ids:
          table.table_id === "orders"
            ? [...table.column_ids, "orders.app_id", "orders.environment"]
            : [
                ...table.column_ids,
                "customers.app_id",
                "customers.environment",
                "customers.principal_id",
              ],
      })),
      mandatory_predicates: [
        ...analystPolicy.mandatory_predicates,
        {
          table_id: "orders",
          column_id: "orders.app_id",
          operator: "eq" as const,
          parameter_key: "app_id",
        },
        {
          table_id: "orders",
          column_id: "orders.environment",
          operator: "eq" as const,
          parameter_key: "environment",
        },
        {
          table_id: "customers",
          column_id: "customers.app_id",
          operator: "eq" as const,
          parameter_key: "app_id",
        },
        {
          table_id: "customers",
          column_id: "customers.environment",
          operator: "eq" as const,
          parameter_key: "environment",
        },
        {
          table_id: "customers",
          column_id: "customers.principal_id",
          operator: "eq" as const,
          parameter_key: "principal_id",
        },
      ],
    };
    const scopedFixture = await readyFixture(scopedContract, scopedCatalog, scopedPolicy);
    const scopedAuthority = await committedLogicalPlanAuthorityFixture(scopedFixture.logicalPlan, {
      scope: scopedIdentity,
      principal_id: scopedPrincipal,
    });
    const scopedCompilation = await compilePostgresqlLogicalPlan({
      logical_plan_binding: await scopedAuthority.bind(),
      grounding: scopedFixture.grounding,
    });
    if (scopedCompilation.state !== "COMPILED") {
      throw new Error(`Scoped Policy Fixture 编译失败：${scopedCompilation.reason_code}`);
    }
    const policyValues = Object.fromEntries(
      scopedCompilation.compilation.parameter_order.flatMap((entry) =>
        entry.source === "policy"
          ? [
              [
                entry.parameter_key,
                scopedCompilation.compilation.sql_artifact.parameters[entry.placeholder],
              ],
            ]
          : [],
      ),
    );
    expect(policyValues).toMatchObject({
      "policy.app_id": scopedIdentity.app_id,
      "policy.tenant_id": scopedIdentity.tenant_id,
      "policy.environment": scopedIdentity.environment,
      "policy.principal_id": scopedPrincipal,
    });
    expect(scopedCompilation.compilation.proof).toMatchObject({
      policy_binding_authority: "LOGICAL_PLAN_REF_AND_SERVER_PRINCIPAL_CAPABILITY",
      policy_binding_hash: await sha256ContentHash({
        logical_plan_ref: scopedAuthority.reference,
        policy_bindings: {
          app_id: scopedIdentity.app_id,
          environment: scopedIdentity.environment,
          principal_id: scopedPrincipal,
          tenant_id: scopedIdentity.tenant_id,
        },
      }),
      query_hash: await computeSqlArtifactQueryHash(scopedCompilation.compilation.sql_artifact),
    });
    expect(scopedAuthority.reference.tenant_id).toBe(
      input.logical_plan_binding.reference.tenant_id,
    );
    expect(scopedAuthority.reference.app_id).not.toBe(input.logical_plan_binding.reference.app_id);
    expect(scopedAuthority.reference.environment).not.toBe(
      input.logical_plan_binding.reference.environment,
    );

    const unsupportedPolicy = {
      ...analystPolicy,
      mandatory_predicates: analystPolicy.mandatory_predicates.map((predicate) => ({
        ...predicate,
        parameter_key: "actor_id",
      })),
    };
    const unsupportedFixture = await readyFixture(
      netRevenueContract(),
      commerceCatalog,
      unsupportedPolicy,
    );
    await expect(
      compilePostgresqlLogicalPlan(await compilerInput(unsupportedFixture)),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_POLICY_BINDING_UNSUPPORTED",
    });
  });

  it("QueryContract NULL Predicate 使用 IS NULL 且不创建伪 NULL 参数", async () => {
    const fixture = await readyFixture(
      netRevenueContract({
        filters: [{ field: "orders.status", operator: "is_null", value: null }],
      }),
    );
    const result = await compilePostgresqlLogicalPlan(await compilerInput(fixture));
    if (result.state !== "COMPILED") {
      throw new Error(`NULL Fixture 编译失败：${result.reason_code}`);
    }

    expect(result.compilation.sql_artifact.sql).toContain(" IS NULL");
    expect(result.compilation.sql_artifact.sql).not.toContain("= NULL");
    expect(result.compilation.parameter_order.map(({ parameter_key }) => parameter_key)).toEqual([
      "policy.tenant_id",
      "time.start",
      "time.end",
    ]);
  });

  it("membership 使用括号 OR + qualified equality，不生成可被 search_path 劫持的 IN", async () => {
    const fixture = await readyFixture(
      netRevenueContract({
        filters: [{ field: "orders.status", operator: "in", value: ["paid", "refunded"] }],
      }),
    );
    const result = await compilePostgresqlLogicalPlan(await compilerInput(fixture));
    if (result.state !== "COMPILED") {
      throw new Error(`Membership Fixture 编译失败：${result.reason_code}`);
    }

    expect(result.compilation.sql_artifact.sql).toMatch(
      /\("source"\."field_[0-9]+" OPERATOR\(pg_catalog\.=\) \$1::pg_catalog\.text OR "source"\."field_[0-9]+" OPERATOR\(pg_catalog\.=\) \$2::pg_catalog\.text\)/,
    );
    expect(result.compilation.sql_artifact.sql).not.toMatch(/\sIN\s*\(/);
    expect(result.compilation.parameter_order.slice(0, 2)).toMatchObject([
      { parameter_key: "literal.status.1", placeholder: "$1", data_type: "text" },
      { parameter_key: "literal.status.2", placeholder: "$2", data_type: "text" },
    ]);
  });

  it("mandatory policy NULL-check 覆盖忽略无意义 parameter_key，但 operator 篡改仍失败", async () => {
    const nullPolicy = {
      ...analystPolicy,
      mandatory_predicates: analystPolicy.mandatory_predicates.map((predicate) => ({
        ...predicate,
        operator: "is_null" as const,
        parameter_key: `unused.${predicate.table_id}`,
      })),
    };
    const fixture = await readyFixture(netRevenueContract(), commerceCatalog, nullPolicy);
    const result = await compilePostgresqlLogicalPlan(await compilerInput(fixture));
    if (result.state !== "COMPILED") {
      throw new Error(`Mandatory NULL Fixture 编译失败：${result.reason_code}`);
    }

    expect(result.compilation.sql_artifact.sql.match(/ IS NULL/g)?.length).toBe(2);
    expect(result.compilation.parameter_order.some(({ source }) => source === "policy")).toBe(
      false,
    );

    const tamperedPolicy = {
      ...nullPolicy,
      mandatory_predicates: nullPolicy.mandatory_predicates.map((predicate, index) =>
        index === 0
          ? {
              ...predicate,
              operator: "is_not_null" as const,
            }
          : predicate,
      ),
    };
    const tamperedFixture = await readyFixture(
      netRevenueContract(),
      commerceCatalog,
      tamperedPolicy,
    );
    await expect(
      compilePostgresqlLogicalPlan({
        logical_plan_binding: await authoritativeBinding(fixture),
        grounding: tamperedFixture.grounding,
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_GROUNDING_HASH_MISMATCH",
    });
  });

  it("SQL 标识符只使用 Grounding physical_name，并按 PostgreSQL 规则双引号包裹", async () => {
    expect(quotePostgresqlIdentifier('odd"name')).toBe('"odd""name"');
    const physicalCatalog = {
      ...commerceCatalog,
      tables: commerceCatalog.tables.map((table) =>
        table.table_id === "orders"
          ? {
              ...table,
              physical_name: "Sales.Orders",
              columns: table.columns.map((column) =>
                column.column_id === "orders.net_amount"
                  ? { ...column, physical_name: "Net-Amount" }
                  : column,
              ),
            }
          : table,
      ),
    };
    const fixture = await readyFixture(netRevenueContract(), physicalCatalog);
    const result = await compilePostgresqlLogicalPlan(await compilerInput(fixture));
    if (result.state !== "COMPILED") {
      throw new Error(`Physical Name Fixture 编译失败：${result.reason_code}`);
    }

    expect(result.compilation.sql_artifact.sql).toContain('FROM "Sales.Orders" AS "source"');
    expect(result.compilation.sql_artifact.sql).toContain('"source"."Net-Amount"');
    expect(result.compilation.sql_artifact.sql).not.toContain('FROM "orders"');
    expect(result.compilation.proof.identifiers).toContainEqual({
      kind: "table",
      logical_id: "orders",
      physical_name: "Sales.Orders",
    });
  });

  it("复合 Key 按 Grounding 顺序生成 AND，且保留 LEFT JOIN preserved side", async () => {
    const compositeCatalog = {
      ...commerceCatalog,
      relationships: commerceCatalog.relationships.map((relationship) => ({
        ...relationship,
        left_column_ids: ["orders.customer_id", "orders.tenant_id"],
        right_column_ids: ["customers.id", "customers.tenant_id"],
        left_row_match: "optional" as const,
      })),
    };
    const fixture = await readyFixture(netRevenueContract(), compositeCatalog);
    const result = await compilePostgresqlLogicalPlan(await compilerInput(fixture));
    if (result.state !== "COMPILED") {
      throw new Error(`Composite Join Fixture 编译失败：${result.reason_code}`);
    }

    expect(result.compilation.sql_artifact.sql).toContain("LEFT JOIN");
    expect(result.compilation.sql_artifact.sql).toMatch(
      /ON\n\s+"left_source"\."field_[0-9]+" OPERATOR\(pg_catalog\.=\) "right_source"\."field_[0-9]+"\n\s+AND "left_source"\."field_[0-9]+" OPERATOR\(pg_catalog\.=\) "right_source"\."field_[0-9]+"/,
    );
    const join = result.compilation.ast.ctes.find(({ operation }) => operation === "join");
    expect(join?.query.joins[0]).toMatchObject({
      join_type: "left",
      conditions: [{ kind: "comparison" }, { kind: "comparison" }],
    });
  });

  it("LogicalPlan 中碰撞的 scan alias 不进入 SQL，统一改用无碰撞 compiler alias", async () => {
    const fixture = await readyFixture();
    const candidate = structuredClone(fixture.logicalPlanCandidate);
    for (const operation of candidate.operations) {
      if (operation.operation === "scan") operation.alias = "same_alias";
    }
    const validation = validateLogicalPlan({
      logical_plan: candidate,
      grounding: fixture.grounding,
      semantic_query: fixture.semanticQuery,
      query_contract: fixture.queryContract,
    });
    if (validation.state !== "VALID") {
      throw new Error(`Alias Fixture 的 LogicalPlan 应有效：${validation.reason_code}`);
    }
    const result = await compilePostgresqlLogicalPlan({
      ...(await compilerInput(fixture)),
      logical_plan_binding: await (
        await committedLogicalPlanAuthorityFixture(validation.logical_plan)
      ).bind(),
    });
    if (result.state !== "COMPILED") {
      throw new Error(`Alias Fixture 编译失败：${result.reason_code}`);
    }

    expect(result.compilation.sql_artifact.sql).not.toContain("same_alias");
    expect(result.compilation.proof.alias_strategy).toBe("VALIDATED_LOGICAL_OUTPUT_ALIAS_QUOTED");
  });

  it("Grounding physical_name 漂移但复用旧 hash 时拒绝编译", async () => {
    const fixture = await readyFixture();
    const tampered = structuredClone(fixture.grounding);
    const orders = tampered.allowed_schema.tables.find(({ table_id }) => table_id === "orders");
    if (!orders) throw new Error("测试 Fixture 缺少 orders。");
    orders.physical_name = "other_orders";

    await expect(
      compilePostgresqlLogicalPlan({
        ...(await compilerInput(fixture)),
        grounding: tampered,
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reason_code: "POSTGRESQL_COMPILER_GROUNDING_HASH_MISMATCH",
    });
  });

  it("恶意 literal 只进入 parameters，不可能拼接进 SQL", async () => {
    const injected = "paid' OR TRUE --";
    const fixture = await readyFixture(
      netRevenueContract({
        filters: [{ field: "orders.status", operator: "eq", value: injected }],
      }),
    );
    const result = await compilePostgresqlLogicalPlan(await compilerInput(fixture));
    if (result.state !== "COMPILED") {
      throw new Error(`Literal Fixture 编译失败：${result.reason_code}`);
    }

    expect(result.compilation.sql_artifact.parameters.$1).toBe(injected);
    expect(result.compilation.sql_artifact.sql).not.toContain(injected);
    expect(result.compilation.sql_artifact.sql).toContain("$1::pg_catalog.text");
  });
});
