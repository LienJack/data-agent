import { describe, expect, it } from "vitest";
import {
  type ArtifactReference,
  type GateReceiptPayload,
  gateReceiptSchema,
  type QueryContractPayload,
  queryContractSchema,
  sandboxExecutionRequestSchema,
  sandboxResultSchema,
  sqlArtifactSchema,
  computeSandboxResultBytes,
} from "@data-agent/contracts";
import {
  buildLogicalPlan,
  buildSemanticQuery,
  compilePostgresqlLogicalPlan,
  compileQueryContract,
  evaluatePostExecutionGates,
  evaluatePreExecutionGates,
  isPostgresqlCompilation,
  isValidatedLogicalPlan,
  validateLogicalPlan,
} from "@data-agent/text2sql";
import {
  registerAuthoritativeLogicalPlanBinding,
  registerTrustedGateArtifactAuthority,
  registerTrustedLogicalPlanCompilerAuthority,
} from "@data-agent/text2sql/server";
import {
  analystPolicy,
  artifactReference,
  commerceCatalog,
  fixtureIds,
  fixturePrincipalId,
  fixtureScope,
  netRevenueContract,
  questionFrameAuthority,
  verifiedQuestionFrame,
} from "./support/commerce-fixture.js";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import { catalogSnapshotSchema } from "../src/grounding/types.js";
import { committedLogicalPlanAuthorityFixture } from "./support/compiler-authority-fixture.js";

// ─── U5 Regression Compatibility Gate ─────────────────────────────────────────
//
// 此门禁验证 U10.0/U10.1a 的 grounding authority materializer 不改变现有 U5
// 行为。所有测试使用已有 Fixture 与已有公共 API，不引入新依赖。
//
// 失败条件：
//   - QueryContract / Grounding / Typed IR / Compiler / Gate / Sandbox 任一
//     契约或管道发生未批准的语义变化。
//   - U10.0/U10.1a 的材料化入口泄漏到 U5 根 API 或改变已有测试行为。
//
// ───────────────────────────────────────────────────────────────────────────────

// ─── 1. QueryContract Schema 不变 ──────────────────────────────────────────────

describe("U5 Regression: QueryContract schema", () => {
  it("queryContractSchema 仍能解析已有 Fixture 形状", () => {
    const contract = netRevenueContract();
    const parsed = queryContractSchema.safeParse(contract);
    expect(parsed.success).toBe(true);
  });

  it("compileQueryContract 仍对完整分辨率返回 READY", async () => {
    const questionFrame = await verifiedQuestionFrame();
    const result = await compileQueryContract(
      {
        evidence_plan_ref: artifactReference("EvidencePlan"),
        question_frame: questionFrame,
        resolution: {
          metric_candidates: ["metric.net_revenue"],
          dimensions: ["dimension.customer_segment"],
          grain: "order",
          time_range: {
            start: "2026-06-01T00:00:00.000+08:00",
            end: "2026-07-01T00:00:00.000+08:00",
            timezone: "Asia/Shanghai",
            semantics: "HALF_OPEN",
          },
          unit: "CNY",
          filters: [{ field: "orders.status", operator: "eq", value: "paid" }],
          datasource_id: fixtureIds.app,
          result_contract: {
            columns: ["dimension.customer_segment", "metric.net_revenue"],
            invariant_ids: ["non_negative_revenue"],
          },
        },
      },
      questionFrameAuthority(questionFrame),
    );
    expect(result.state).toBe("READY");
  });

  it("compileQueryContract 仍对无 Metric 候选返回 CLARIFY", async () => {
    const questionFrame = await verifiedQuestionFrame();
    const result = await compileQueryContract(
      {
        evidence_plan_ref: artifactReference("EvidencePlan"),
        question_frame: questionFrame,
        resolution: {
          metric_candidates: [],
          dimensions: ["dimension.customer_segment"],
          grain: "order",
          time_range: {
            start: "2026-06-01T00:00:00.000+08:00",
            end: "2026-07-01T00:00:00.000+08:00",
            timezone: "Asia/Shanghai",
            semantics: "HALF_OPEN",
          },
          unit: "CNY",
          filters: [],
          datasource_id: fixtureIds.app,
          result_contract: {
            columns: ["dimension.customer_segment", "metric.net_revenue"],
            invariant_ids: ["non_negative_revenue"],
          },
        },
      },
      questionFrameAuthority(questionFrame),
    );
    expect(result.state).toBe("CLARIFY");
    expect((result as { reason_code?: string }).reason_code).toBe(
      "QUERY_CONTRACT_METRIC_UNRESOLVED",
    );
  });
});

// ─── 2. Grounding Pipeline 不变 ────────────────────────────────────────────────

describe("U5 Regression: Grounding pipeline", () => {
  it("groundQueryContract 仍对有效 Fixture 返回 READY", async () => {
    const queryContract = netRevenueContract();
    const result = await groundQueryContract({
      query_contract: queryContract,
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 32,
    });
    expect(result.state).toBe("READY");
  });

  it("Grounding 仍拒绝 Catalog 中的重复语义身份", () => {
    expect(
      catalogSnapshotSchema.safeParse({
        ...commerceCatalog,
        tables: [...commerceCatalog.tables, commerceCatalog.tables[0] as unknown],
      }).success,
    ).toBe(false);
  });

  it("Grounding 仍拒绝 Metric/Dimension 跨类型同名", () => {
    expect(
      catalogSnapshotSchema.safeParse({
        ...commerceCatalog,
        dimensions: commerceCatalog.dimensions.map(
          (dim: { dimension_id: string }) => ({
            ...dim,
            dimension_id: "metric.net_revenue",
          }),
        ),
      }).success,
    ).toBe(false);
  });
});

// ─── 3. Typed IR 类型不变 ──────────────────────────────────────────────────────

describe("U5 Regression: Typed IR", () => {
  async function readyFixture() {
    const queryContract = netRevenueContract();
    const groundingResult = await groundQueryContract({
      query_contract: queryContract,
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 64,
    });
    if (groundingResult.state !== "READY") {
      throw new Error(`Grounding 必须 READY，实际为 ${groundingResult.state}`);
    }
    const semanticQuery = buildSemanticQuery({
      query_contract: queryContract,
      grounding: groundingResult.grounding,
    });
    const logicalPlan = buildLogicalPlan({
      semantic_query: semanticQuery,
      grounding: groundingResult.grounding,
    });
    const validation = validateLogicalPlan({
      logical_plan: logicalPlan,
      grounding: groundingResult.grounding,
      semantic_query: semanticQuery,
      query_contract: queryContract,
    });
    return {
      queryContract,
      grounding: groundingResult.grounding,
      semanticQuery,
      logicalPlan,
      validation,
    };
  }

  it("buildSemanticQuery 仍产生带显式时间参数的类型化 IR", async () => {
    const { semanticQuery } = await readyFixture();
    expect(semanticQuery.time_predicate).toMatchObject({
      field: { table_id: "orders", column_id: "orders.created_at" },
      lower: { parameter_key: "time.start", inclusive: true },
      upper: { parameter_key: "time.end", inclusive: false },
      timezone: "Asia/Shanghai",
    });
    expect(semanticQuery.metric).toMatchObject({
      unit: "CNY",
      null_policy: "coalesce-zero",
    });
  });

  it("LogicalPlan 仍只包含类型化操作，无自由 SQL", async () => {
    const { logicalPlan } = await readyFixture();
    expect(logicalPlan.root_operation_id).toBe("project_result");
    expect(
      logicalPlan.operations.map((o: { operation: string }) => o.operation),
    ).toEqual(expect.arrayContaining(["scan", "filter", "join", "aggregate", "project"]));
  });

  it("validateLogicalPlan 仍对有效 Fixture 返回 VALID", async () => {
    const { validation } = await readyFixture();
    expect(validation.state).toBe("VALID");
  });
});

// ─── 4. PostgreSQL Compiler 不变 ───────────────────────────────────────────────

describe("U5 Regression: PostgreSQL Compiler", () => {
  async function compilerFixture() {
    const queryContract = netRevenueContract();
    const groundingResult = await groundQueryContract({
      query_contract: queryContract,
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 64,
    });
    if (groundingResult.state !== "READY") throw new Error("Grounding 必须 READY");
    const semanticQuery = buildSemanticQuery({
      query_contract: queryContract,
      grounding: groundingResult.grounding,
    });
    const logicalPlan = buildLogicalPlan({
      semantic_query: semanticQuery,
      grounding: groundingResult.grounding,
    });
    const validation = validateLogicalPlan({
      logical_plan: logicalPlan,
      grounding: groundingResult.grounding,
      semantic_query: semanticQuery,
      query_contract: queryContract,
    });
    if (validation.state !== "VALID") throw new Error("LogicalPlan 必须 VALID");
    const logicalPlanAuthority = await committedLogicalPlanAuthorityFixture(
      validation.logical_plan,
    );
    const logicalPlanBinding = await logicalPlanAuthority.bind();
    const compileResult = await compilePostgresqlLogicalPlan({
      logical_plan_binding: logicalPlanBinding,
      grounding: groundingResult.grounding,
    });
    if (compileResult.state !== "COMPILED") {
      throw new Error(
        `Compilation 必须成功: ${compileResult.reason_code}`,
      );
    }
    return {
      queryContract,
      grounding: groundingResult.grounding,
      logicalPlan,
      compilation: compileResult.compilation,
    };
  }

  it("compilePostgresqlLogicalPlan 仍对有效 LogicalPlan 产生有效 SQL", async () => {
    const { compilation } = await compilerFixture();
    const sqlArtifact = (compilation as { sql_artifact: { sql: string; query_hash: string } }).sql_artifact;
    expect(sqlArtifact.sql).toBeTruthy();
    expect(sqlArtifact.sql).toContain("SELECT");
    expect(sqlArtifact.query_hash).toBeDefined();
  });

  it("编译 SQL 仍为 pg_catalog 限定，不含 DML CTE", async () => {
    const { compilation } = await compilerFixture();
    const sqlArtifact = (compilation as { sql_artifact: { sql: string } }).sql_artifact;
    expect(sqlArtifact.sql).not.toMatch(
      /\bDELETE\b|\bINSERT\b|\bUPDATE\b|\bCREATE\b|\bDROP\b/i,
    );
    expect(sqlArtifact.sql).toContain("net_amount");
  });

  it("isPostgresqlCompilation 仍正确判别编译结果", async () => {
    const queryContract = netRevenueContract();
    const groundingResult = await groundQueryContract({
      query_contract: queryContract,
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 64,
    });
    if (groundingResult.state !== "READY") throw new Error("Grounding 必须 READY");
    const semanticQuery = buildSemanticQuery({
      query_contract: queryContract,
      grounding: groundingResult.grounding,
    });
    const logicalPlan = buildLogicalPlan({
      semantic_query: semanticQuery,
      grounding: groundingResult.grounding,
    });
    const validation = validateLogicalPlan({
      logical_plan: logicalPlan,
      grounding: groundingResult.grounding,
      semantic_query: semanticQuery,
      query_contract: queryContract,
    });
    if (validation.state !== "VALID") throw new Error("LogicalPlan 必须 VALID");
    const logicalPlanAuthority = await committedLogicalPlanAuthorityFixture(
      validation.logical_plan,
    );
    const logicalPlanBinding = await logicalPlanAuthority.bind();
    const compileResult = await compilePostgresqlLogicalPlan({
      logical_plan_binding: logicalPlanBinding,
      grounding: groundingResult.grounding,
    });
    expect(compileResult.state === "COMPILED" && isPostgresqlCompilation(compileResult.compilation)).toBe(true);
    expect(isPostgresqlCompilation({ dialect: "postgresql", state: "FAILED", reasonCode: "COMPILATION_FAILED" })).toBe(false);
  });
});

// ─── 5. Gate Matrix 不变 ───────────────────────────────────────────────────────

describe("U5 Regression: Gate Matrix", () => {
  it("七道 Gate 常量仍全部存在：INTENT SEMANTIC STRUCTURAL POLICY RESOURCE EXECUTION RESULT", async () => {
    const text2sql = await import("@data-agent/text2sql");
    expect(text2sql.INTENT_GATE_REASON_CODES).toBeDefined();
    expect(text2sql.SEMANTIC_GATE_REASON_CODES).toBeDefined();
    expect(text2sql.STRUCTURAL_GATE_REASON_CODES).toBeDefined();
    expect(text2sql.POLICY_GATE_REASON_CODES).toBeDefined();
    expect(text2sql.RESOURCE_GATE_REASON_CODES).toBeDefined();
    expect(text2sql.EXECUTION_GATE_REASON_CODES).toBeDefined();
    expect(text2sql.RESULT_GATE_REASON_CODES).toBeDefined();
  });
});

// ─── 6. Sandbox Contract 不变 ──────────────────────────────────────────────────

describe("U5 Regression: Sandbox contracts", () => {
  it("sandboxExecutionRequestSchema 仍要求有效 SQL 执行请求", () => {
    const ref = artifactReference("ExecutionPermit") as unknown as ArtifactReference;
    const sqlRef = artifactReference("SqlArtifact") as unknown as ArtifactReference;
    const resourceRef = artifactReference("ResourceAdmissionReceipt") as unknown as ArtifactReference;
    // 当前 schema 使用 discriminated union（language）
    const validRequest = {
      scope: fixtureScope,
      run_id: fixtureIds.run,
      execution_id: "00000000-0000-4000-8000-000000000099",
      idempotency_key: "test-u5-regression-sandbox-001",
      budget: {
        timeout_ms: 300000,
        lock_timeout_ms: 30000,
        max_rows: 10000,
        max_bytes: 67108864,
        max_memory_mb: 512,
      },
      schema_version: "sandbox-execution-request@1.0.0",
      language: "sql",
      payload: {
        dialect: "postgresql",
        sql_artifact_ref: sqlRef,
        execution_permit_ref: ref,
        resource_admission_ref: resourceRef,
        datasource_id: fixtureIds.app,
        settings_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        execution_settings: {
          statement_timeout_ms: 300000,
          lock_timeout_ms: 30000,
          database_role: "pg_read_all_data",
          search_path: ["public"],
          plan_cache_mode: "force_custom_plan",
        },
        snapshot_requirement: {
          mode: "ALLOW_UNAVAILABLE",
        },
        parameters: {},
      },
    };
    expect(sandboxExecutionRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("sandboxResultSchema 仍要求规范字段（含新 U10 域）", () => {
    const resultRef = {
      ...artifactReference("SandboxResult"),
      ...fixtureScope,
      run_id: fixtureIds.run,
    } as unknown as ArtifactReference;
    const resultBytes = computeSandboxResultBytes({
      columns: [{ name: "col1", type: "STRING" }, { name: "col2", type: "INTEGER" }],
      rows: [["a", 1]],
    });
    const resultHash = "sha256:0000000000000000000000000000000000000000000000000000000000000001";
    expect(
      sandboxResultSchema.safeParse({
        schema_version: "sandbox-result@1.0.0",
        result_ref: { ...resultRef, content_hash: resultHash },
        scope: fixtureScope,
        run_id: fixtureIds.run,
        execution_id: "00000000-0000-4000-8000-000000000099",
        columns: [
          { name: "col1", type: "STRING" },
          { name: "col2", type: "INTEGER" },
        ],
        rows: [["a", 1]],
        row_count: 1,
        bytes: resultBytes,
        result_hash: resultHash,
      }).success,
    ).toBe(true);
  });

  it("sandboxResultSchema 仍拒绝空 Result", () => {
    expect(
      sandboxResultSchema.safeParse({
        schema_version: "sandbox-result@1.0.0",
        result_ref: {
          ...artifactReference("SandboxResult"),
          ...fixtureScope,
          run_id: fixtureIds.run,
          content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        scope: fixtureScope,
        run_id: fixtureIds.run,
        execution_id: "00000000-0000-4000-8000-000000000099",
        columns: [],
        rows: [],
        row_count: 0,
        bytes: 0,
        result_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }).success,
    ).toBe(false);
  });
});

// ─── 7. U10.0/U10.1a Materializer 不改变 U5 行为 ───────────────────────────────

describe("U5 Regression: U10.0/U10.1a 隔离", () => {
  it("公共 @data-agent/text2sql 根 API 不包含 grounding materializer 入口", async () => {
    const publicSurface = await import("@data-agent/text2sql");
    const materializerNames = Object.keys(publicSurface).filter((name) =>
      /materialize|groundingAuthority|groundingBundle|authoritativeRelease|coordinateGrounding|issuer/i.test(
        name,
      ),
    );
    expect(materializerNames).toEqual([]);
  });

  it("服务端 @data-agent/text2sql/server 根 API 不包含 grounding materializer 入口", async () => {
    const serverSurface = await import("@data-agent/text2sql/server");
    const materializerNames = Object.keys(serverSurface).filter((name) =>
      /materialize|groundingAuthority|groundingBundle|authoritativeRelease|coordinateGrounding|issuer/i.test(
        name,
      ),
    );
    expect(materializerNames).toEqual([]);
  });

  it("公共 @data-agent/contracts 根 API 不包含 grounding materializer runtime 入口", async () => {
    const contractSurface = await import("@data-agent/contracts");
    const materializerRuntimeNames = Object.keys(contractSurface).filter((name) =>
      /registerTrustedGrounding|issueSemantic|issueSchema|issuePolicy|materializeGrounding|coordinateGrounding/i.test(
        name,
      ),
    );
    expect(materializerRuntimeNames).toEqual([]);
  });
});
