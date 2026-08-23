import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  type BenchmarkAgentDescriptor,
  type BenchmarkEvalBatchRun,
  benchmarkEvalBatchRunSchema,
  CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
  CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
  CERTIFIED_MODEL_SQL_AGENT_ID,
  createBenchmarkRunInputSchema,
  PROFILE_ANALYSIS_AGENT_ID,
  PUBLISHED_BASELINE_AGENT_ID,
  SUBMITTED_ANSWER_AGENT_ID,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  type BenchmarkAnalysisAgent,
  type BenchmarkEvalAgent,
  DeterministicProfileAnalysisAgent,
  DR_SPIDER_DATASET_VERSION,
  executeBirdBenchmarkBatch,
  executeInsightBenchBatch,
  executeMultipleChoiceBenchmarkBatch,
  executeSqlBenchmarkBatch,
  FalconResultOracle,
  getBenchmarkCatalog,
  getBenchmarkCatalogEntry,
  installBladeSmokeSlice,
  installDrSpiderSmokeSlice,
  installInsightBenchSmokeSlice,
  loadBirdMiniDevDataset,
  loadBladeDataset,
  loadDrSpiderDataset,
  loadEcommerceProductionPreview,
  loadEcommerceProductionSqlDataset,
  loadFalconDevDataset,
  loadFalconPreview,
  loadInsightBenchDataset,
  PostgresResultOracle,
  PublishedBirdBaselineAgent,
  SubmittedAnswerAgent,
  toFalconSqlBenchmarkDataset,
} from "@data-agent/evals";
import { ECOMMERCE_DIRECT_QA_CAPABILITY } from "@data-agent/evals/ecommerce-direct-qa";
import {
  createPostgresFalconBenchmarkExecutor,
  createPostgresReadOnlyBenchmarkExecutor,
} from "@data-agent/platform";
import pg from "pg";
import { z } from "zod";
import { ensureRootEnvironmentLoaded } from "./root-env";
import { resolveTestCenterModelRuntime } from "./test-center-model-runtime";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const workspaceContextSchema = z.strictObject({
  appId: z.uuid(),
  tenantId: z.uuid(),
  principalId: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
});
export type TestCenterWorkspaceContext = z.infer<typeof workspaceContextSchema>;
const workspaceContext = new AsyncLocalStorage<TestCenterWorkspaceContext>();

const runtimeConfigSchema = z.strictObject({
  connectionString: z.string().min(1),
  tenantId: z.uuid(),
  principalId: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
});

interface StoredRunRow {
  readonly request_hash: string;
  readonly run_document: unknown;
}

export class TestCenterRuntimeError extends Error {
  override readonly name = "TestCenterRuntimeError";

  constructor(
    readonly code:
      | "TEST_CENTER_CONFIG_INVALID"
      | "TEST_CENTER_SUITE_NOT_FOUND"
      | "TEST_CENTER_SUITE_NOT_READY"
      | "TEST_CENTER_AGENT_UNSUPPORTED"
      | "TEST_CENTER_REFLECTION_UNSUPPORTED"
      | "TEST_CENTER_IDEMPOTENCY_CONFLICT"
      | "TEST_CENTER_RUN_NOT_FOUND"
      | "TEST_CENTER_INSTALL_UNSUPPORTED"
      | "TEST_CENTER_INSTALL_FAILED"
      | "TEST_CENTER_WORKER_REQUIRED"
      | "TEST_CENTER_PERSISTENCE_UNAVAILABLE",
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function resolveTestCenterRuntimeConfig(environment: NodeJS.ProcessEnv) {
  const development = environment.NODE_ENV !== "production";
  const parsed = runtimeConfigSchema.safeParse({
    connectionString: environment.DATABASE_URL,
    tenantId:
      environment.TEST_CENTER_TENANT_ID ??
      (development ? "00000000-0000-4000-8000-000000000002" : undefined),
    principalId:
      environment.TEST_CENTER_PRINCIPAL_ID ??
      (development ? "00000000-0000-4000-8000-000000000003" : undefined),
    environment: environment.TEST_CENTER_ENVIRONMENT ?? (development ? "local" : undefined),
  });
  if (!parsed.success) {
    throw new TestCenterRuntimeError("TEST_CENTER_CONFIG_INVALID", "能力测试持久化尚未配置。", 503);
  }
  return parsed.data;
}

function config() {
  ensureRootEnvironmentLoaded();
  const scoped = workspaceContext.getStore();
  if (scoped) {
    return resolveTestCenterRuntimeConfig({
      ...process.env,
      TEST_CENTER_TENANT_ID: scoped.tenantId,
      TEST_CENTER_PRINCIPAL_ID: scoped.principalId,
      TEST_CENTER_ENVIRONMENT: scoped.environment,
    });
  }
  return resolveTestCenterRuntimeConfig(process.env);
}

function currentAppId(): string {
  return workspaceContext.getStore()?.appId ?? APP_ID;
}

export function withTestCenterWorkspaceContext<T>(
  context: TestCenterWorkspaceContext,
  work: () => Promise<T>,
): Promise<T> {
  return workspaceContext.run(workspaceContextSchema.parse(context), work);
}

const globalPool = globalThis as unknown as { __testCenterPool?: pg.Pool };

function pool(): pg.Pool {
  const current = config();
  globalPool.__testCenterPool ??= new pg.Pool({
    connectionString: current.connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
    max: 4,
  });
  return globalPool.__testCenterPool;
}

async function withScopedClient<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const current = config();
  let client: pg.PoolClient;
  try {
    client = await pool().connect();
  } catch {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_PERSISTENCE_UNAVAILABLE",
      "能力测试成绩存储当前不可用。",
      503,
    );
  }
  try {
    await client.query("begin");
    await client.query("set local search_path to app_data_agent, pg_catalog");
    await client.query(
      `select
         pg_catalog.set_config('data_agent.app_id', $1, true),
         pg_catalog.set_config('data_agent.tenant_id', $2, true),
         pg_catalog.set_config('data_agent.environment', $3, true),
         pg_catalog.set_config('data_agent.principal_id', $4, true),
         pg_catalog.set_config('data_agent.role', 'analyst', true)`,
      [currentAppId(), current.tenantId, current.environment, current.principalId],
    );
    const value = await work(client);
    await client.query("commit");
    return value;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the public boundary error from the original operation.
    }
    if (error instanceof TestCenterRuntimeError) throw error;
    throw new TestCenterRuntimeError(
      "TEST_CENTER_PERSISTENCE_UNAVAILABLE",
      "能力测试成绩未能写入权威存储。",
      503,
    );
  } finally {
    client.release();
  }
}

function parseStoredRun(row: StoredRunRow | undefined): BenchmarkEvalBatchRun | null {
  if (!row) return null;
  const parsed = benchmarkEvalBatchRunSchema.safeParse(row.run_document);
  if (!parsed.success) {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_PERSISTENCE_UNAVAILABLE",
      "已保存的成绩单不符合当前权威契约。",
      503,
    );
  }
  return parsed.data;
}

async function findByIdempotencyKey(
  client: pg.PoolClient,
  idempotencyKey: string,
): Promise<StoredRunRow | undefined> {
  const current = config();
  const result = await client.query<StoredRunRow>(
    `select request_hash, run_document
       from app_data_agent.benchmark_eval_runs
      where app_id = $1::uuid
        and tenant_id = $2::uuid
        and environment = $3::text
        and principal_id = $4::uuid
        and idempotency_key = $5::uuid`,
    [currentAppId(), current.tenantId, current.environment, current.principalId, idempotencyKey],
  );
  return result.rows[0];
}

async function persistRun(input: {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly run: BenchmarkEvalBatchRun;
}): Promise<BenchmarkEvalBatchRun> {
  const current = config();
  return withScopedClient(async (client) => {
    const inserted = await client.query<StoredRunRow>(
      `insert into app_data_agent.benchmark_eval_runs (
         app_id, tenant_id, environment, principal_id, batch_run_id,
         idempotency_key, request_hash, manifest_hash, scorecard_hash,
         run_document, run_document_hash
       ) values (
         $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid,
         $6::uuid, $7::text, $8::text, $9::text,
         $10::jsonb, app_data_agent.runtime_canonical_sha256($10::jsonb)
       )
       on conflict (app_id, tenant_id, environment, principal_id, idempotency_key)
       do nothing
       returning request_hash, run_document`,
      [
        currentAppId(),
        current.tenantId,
        current.environment,
        current.principalId,
        input.run.batch_run_id,
        input.idempotencyKey,
        input.requestHash,
        input.run.manifest.manifest_hash,
        input.run.scorecard?.scorecard_hash,
        input.run,
      ],
    );
    const row = inserted.rows[0] ?? (await findByIdempotencyKey(client, input.idempotencyKey));
    if (!row || row.request_hash !== input.requestHash) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_IDEMPOTENCY_CONFLICT",
        "同一幂等键已用于不同的能力测试请求。",
        409,
      );
    }
    const parsed = parseStoredRun(row);
    if (!parsed) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_PERSISTENCE_UNAVAILABLE",
        "能力测试成绩写入后无法读取。",
        503,
      );
    }
    return parsed;
  });
}

export async function listTestCenterSuites() {
  return getBenchmarkCatalog();
}

function currentScope() {
  const current = config();
  return {
    app_id: currentAppId(),
    tenant_id: current.tenantId,
    environment: current.environment,
  } as const;
}

async function modelRuntime() {
  return resolveTestCenterModelRuntime({
    scope: currentScope(),
  });
}

export async function listTestCenterAgents(
  suiteId: string,
): Promise<readonly BenchmarkAgentDescriptor[]> {
  if (suiteId === "bird-mini-dev") {
    const runtime = await modelRuntime();
    return Object.freeze([new PublishedBirdBaselineAgent({}).descriptor, runtime.sql_descriptor]);
  }
  if (suiteId === "insightbench") {
    return Object.freeze([
      new DeterministicProfileAnalysisAgent().descriptor,
      (await modelRuntime()).descriptor,
    ]);
  }
  if (suiteId === "dr-spider") {
    const runtime = await modelRuntime();
    return Object.freeze([runtime.sql_descriptor]);
  }
  if (suiteId === "blade") {
    return Object.freeze([(await modelRuntime()).multiple_choice_descriptor]);
  }
  if (suiteId === "ecommerce-production" || suiteId === "falcon") {
    return Object.freeze([(await modelRuntime()).sql_descriptor]);
  }
  const suite = await getBenchmarkCatalogEntry(suiteId);
  if (!suite) {
    throw new TestCenterRuntimeError("TEST_CENTER_SUITE_NOT_FOUND", "未找到指定题库。", 404);
  }
  return Object.freeze([]);
}

export async function installTestCenterSuite(suiteId: string) {
  if (suiteId !== "insightbench" && suiteId !== "dr-spider" && suiteId !== "blade") {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_INSTALL_UNSUPPORTED",
      "该题库尚未提供安全的自动导入 Adapter。",
      409,
    );
  }
  try {
    const receipt =
      suiteId === "dr-spider"
        ? await installDrSpiderSmokeSlice()
        : suiteId === "blade"
          ? await installBladeSmokeSlice()
          : await installInsightBenchSmokeSlice();
    const suite = await getBenchmarkCatalogEntry(suiteId);
    return { receipt, suite };
  } catch (error) {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_INSTALL_FAILED",
      error instanceof Error
        ? `${suiteId} 自动导入失败：${error.message}`
        : `${suiteId} 自动导入失败。`,
      502,
    );
  }
}

export async function listPublicTestCases(suiteId: string) {
  const suite = await getBenchmarkCatalogEntry(suiteId);
  if (!suite) {
    throw new TestCenterRuntimeError("TEST_CENTER_SUITE_NOT_FOUND", "未找到指定题库。", 404);
  }
  if (!suite.previewable) {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_SUITE_NOT_READY",
      suite.status_reason ?? "该题库当前不可运行。",
      409,
    );
  }
  if (suite.suite_id === "bird-mini-dev") return (await loadBirdMiniDevDataset()).public_cases;
  if (suite.suite_id === "dr-spider") return (await loadDrSpiderDataset()).public_cases;
  if (suite.suite_id === "insightbench") return (await loadInsightBenchDataset()).public_cases;
  if (suite.suite_id === "blade") return (await loadBladeDataset()).public_cases;
  if (suite.suite_id === "ecommerce-production") {
    return (await loadEcommerceProductionPreview()).public_cases;
  }
  if (suite.suite_id === "falcon") return (await loadFalconPreview()).public_cases;
  throw new TestCenterRuntimeError(
    "TEST_CENTER_SUITE_NOT_READY",
    "该题库的公开题目 Adapter 尚未注册。",
    409,
  );
}

export async function getPersistedTestRun(batchRunId: string): Promise<BenchmarkEvalBatchRun> {
  const current = config();
  return withScopedClient(async (client) => {
    const result = await client.query<StoredRunRow>(
      `select request_hash, run_document
         from app_data_agent.benchmark_eval_runs
        where app_id = $1::uuid
          and tenant_id = $2::uuid
          and environment = $3::text
          and principal_id = $4::uuid
          and batch_run_id = $5::uuid`,
      [currentAppId(), current.tenantId, current.environment, current.principalId, batchRunId],
    );
    const run = parseStoredRun(result.rows[0]);
    if (!run) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_RUN_NOT_FOUND",
        "未找到指定能力测试运行。",
        404,
      );
    }
    return run;
  });
}

function completedBatchRun(input: {
  readonly batchRunId: string;
  readonly reflectionEnabled: boolean;
  readonly execution: Awaited<ReturnType<typeof executeBirdBenchmarkBatch>>;
}): BenchmarkEvalBatchRun {
  const completedAt =
    input.execution.case_runs
      .map((caseRun) => caseRun.completed_at)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? input.execution.scorecard.generated_at;
  return benchmarkEvalBatchRunSchema.parse({
    batch_run_id: input.batchRunId,
    status: "COMPLETED",
    manifest: input.execution.manifest,
    reflection_enabled: input.reflectionEnabled,
    total_cases: input.execution.case_runs.length,
    completed_cases: input.execution.case_runs.length,
    passed_cases: input.execution.case_runs.filter((caseRun) => caseRun.status === "PASS").length,
    failed_cases: input.execution.case_runs.filter((caseRun) => caseRun.status === "FAIL").length,
    infra_failed_cases: input.execution.case_runs.filter((caseRun) =>
      ["INFRA_FAILURE", "ORACLE_FAILURE", "INVALID_CASE"].includes(caseRun.status),
    ).length,
    cancelled_cases: input.execution.case_runs.filter((caseRun) => caseRun.status === "CANCELLED")
      .length,
    event_cursor: input.execution.case_runs.reduce(
      (total, caseRun) => total + 2 + caseRun.attempts.length + (caseRun.reflection ? 1 : 0),
      3,
    ),
    case_runs: input.execution.case_runs,
    scorecard: input.execution.scorecard,
    created_at: input.execution.manifest.frozen_at,
    started_at: input.execution.manifest.frozen_at,
    completed_at: completedAt,
  });
}

/**
 * Server-only compatibility seam for the fixed E-commerce snapshot. New acceptance runs use the
 * public Test Center execution path; this function remains for callers that need the narrow SQL
 * contract while retaining the same certified model, Oracle and ScoreCard requirements.
 */
export async function executeEcommerceSqlAcceptance(input: {
  readonly case_id: string;
  readonly idempotency_key: string;
  readonly reflection_enabled?: boolean;
}): Promise<BenchmarkEvalBatchRun> {
  const dataset = await loadEcommerceProductionSqlDataset();
  const testCase = dataset.public_cases.find((candidate) => candidate.case_id === input.case_id);
  if (!testCase?.runnable) {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_SUITE_NOT_READY",
      "当前验收入口只接受已具备确定性结果 Oracle 的 E-commerce SQL Case。",
      409,
    );
  }
  const budget = {
    max_cases: 1,
    max_attempts_per_case: input.reflection_enabled ? 2 : 1,
    max_case_duration_ms: 120_000,
    max_batch_duration_ms: 240_000,
    max_output_tokens_per_attempt: 4_096,
    concurrency: 1,
  } as const;
  const runtime = await modelRuntime();
  if (!runtime.available) {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_AGENT_UNSUPPORTED",
      runtime.sql_descriptor.unavailable_reason ?? "认证 SQL 模型 Agent 尚不可用。",
      409,
    );
  }
  const executor = createPostgresReadOnlyBenchmarkExecutor({
    pool: pool(),
    policy: ECOMMERCE_DIRECT_QA_CAPABILITY,
  });
  const batchRunId = randomUUID();
  const execution = await executeSqlBenchmarkBatch({
    dataset,
    suite: {
      suite_id: "ecommerce-production",
      suite_version: "1.0.0",
      dataset_version: "adb-ecommerce-bounded-v1",
      source_commit: "61bb0d6be3439797d2c75a6ede198b0b296cc226",
      oracle_version: "ecommerce-postgres-result-equivalence@1.0.0",
      prompt_version: "ecommerce-certified-sql-agent@1.0.0",
      workflow_version: "test-center-case-runner@1.0.0",
      evaluator_version: "ecommerce-postgres-evaluator@1.0.0",
      aggregator_version: "test-center-aggregator@1.0.0",
    },
    case_ids: [input.case_id],
    agent: runtime.createSqlAgent(budget),
    reflection_enabled: input.reflection_enabled ?? true,
    budget,
    seed: 20260815,
    batch_run_id: batchRunId,
    oracle: new PostgresResultOracle({
      executor,
      timeout_ms: budget.max_case_duration_ms,
      max_rows: 100_000,
      oracle_version: "ecommerce-postgres-result-equivalence@1.0.0",
    }),
  });
  const run = completedBatchRun({
    batchRunId,
    reflectionEnabled: input.reflection_enabled ?? true,
    execution,
  });
  const requestHash = await sha256ContentHash({
    acceptance_version: "ecommerce-sql-acceptance@1.0.0",
    case_id: input.case_id,
    agent: runtime.sql_descriptor,
    reflection_enabled: input.reflection_enabled ?? true,
    budget,
  });
  const persisted = await persistRun({
    idempotencyKey: input.idempotency_key,
    requestHash,
    run,
  });
  return getPersistedTestRun(persisted.batch_run_id);
}

function assertWebRunnableSuite(suiteId: string): void {
  if (suiteId !== "falcon") return;
  throw new TestCenterRuntimeError(
    "TEST_CENTER_WORKER_REQUIRED",
    "Falcon 正式评测只能由受治理 Worker Agent Team 创建；Web 入口仅可读取运行与 Gate 证据。",
    409,
  );
}

export async function executeTestCenterRun(
  untrustedInput: unknown,
  idempotencyKey: string,
): Promise<BenchmarkEvalBatchRun> {
  const request = createBenchmarkRunInputSchema.parse(untrustedInput);
  assertWebRunnableSuite(request.suite_id);
  const suite = await getBenchmarkCatalogEntry(request.suite_id);
  if (!suite?.runnable) {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_SUITE_NOT_READY",
      suite?.status_reason ?? "该题库当前不可运行。",
      409,
    );
  }
  const requestHash = await sha256ContentHash(request);
  const existing = await withScopedClient(async (client) =>
    findByIdempotencyKey(client, idempotencyKey),
  );
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_IDEMPOTENCY_CONFLICT",
        "同一幂等键已用于不同的能力测试请求。",
        409,
      );
    }
    const stored = parseStoredRun(existing);
    if (stored) return stored;
  }

  if (request.suite_version !== "1.0.0") {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_SUITE_NOT_READY",
      "当前仅已冻结 1.0.0 Adapter 的题库可执行。",
      409,
    );
  }
  const batchRunId = randomUUID();
  let execution: Awaited<ReturnType<typeof executeBirdBenchmarkBatch>>;
  if (request.suite_id === "falcon") {
    const sourceDataset = await loadFalconDevDataset();
    const dataset = await toFalconSqlBenchmarkDataset(sourceDataset);
    const selectedCases = request.case_ids.map((caseId) =>
      dataset.public_cases.find((testCase) => testCase.case_id === caseId),
    );
    if (selectedCases.some((testCase) => !testCase?.runnable)) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_SUITE_NOT_READY",
        "官方 TEST 只能生成提交包；当前运行入口只执行具备密封 Oracle 的 DEV 题目。",
        409,
      );
    }
    let agent: BenchmarkEvalAgent;
    if (request.agent_id === CERTIFIED_MODEL_SQL_AGENT_ID) {
      const runtime = await modelRuntime();
      if (!runtime.available) {
        throw new TestCenterRuntimeError(
          "TEST_CENTER_AGENT_UNSUPPORTED",
          runtime.sql_descriptor.unavailable_reason ?? "认证 SQL 模型 Agent 尚不可用。",
          409,
        );
      }
      agent = runtime.createSqlAgent(request.budget);
    } else if (request.agent_id === SUBMITTED_ANSWER_AGENT_ID) {
      agent = new SubmittedAnswerAgent(request.submitted_answers ?? {});
    } else {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_AGENT_UNSUPPORTED",
        "Falcon 当前只注册认证模型 SQL Agent 与提交答案 Agent。",
        409,
      );
    }
    if (request.reflection_enabled && !agent.descriptor.supports_reflection) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_REFLECTION_UNSUPPORTED",
        "所选 Agent 不支持受 Oracle 反馈约束的自反省重试。",
        409,
      );
    }
    execution = await executeSqlBenchmarkBatch({
      dataset,
      suite: {
        suite_id: "falcon",
        suite_version: "1.0.0",
        dataset_version: "falcon-fixed-8ff29caa-postgres-v1",
        source_commit: "8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5",
        oracle_version: "falcon-postgres-expected-result@1.0.0",
        prompt_version: "falcon-certified-sql-agent@1.0.0",
        workflow_version: "test-center-case-runner@1.0.0",
        evaluator_version: "falcon-postgres-evaluator@1.0.0",
        aggregator_version: "test-center-aggregator@1.0.0",
      },
      case_ids: request.case_ids,
      agent,
      reflection_enabled: request.reflection_enabled,
      budget: request.budget,
      seed: request.seed,
      batch_run_id: batchRunId,
      oracle: new FalconResultOracle({
        executor: createPostgresFalconBenchmarkExecutor({ pool: pool() }),
        sealed_cases: sourceDataset.sealed_cases,
        timeout_ms: request.budget.max_case_duration_ms,
        max_rows: 100_000,
        oracle_version: "falcon-postgres-expected-result@1.0.0",
      }),
    });
  } else if (request.suite_id === "ecommerce-production") {
    const dataset = await loadEcommerceProductionSqlDataset();
    const selectedCases = request.case_ids.map((caseId) =>
      dataset.public_cases.find((testCase) => testCase.case_id === caseId),
    );
    const unavailableIndex = selectedCases.findIndex((testCase) => !testCase?.runnable);
    if (unavailableIndex >= 0) {
      const unavailable = selectedCases[unavailableIndex];
      throw new TestCenterRuntimeError(
        "TEST_CENTER_SUITE_NOT_READY",
        unavailable?.status_reason ?? "所选 E-commerce 题目尚未注册可执行 Runner。",
        409,
      );
    }
    let agent: BenchmarkEvalAgent;
    if (request.agent_id === CERTIFIED_MODEL_SQL_AGENT_ID) {
      const runtime = await modelRuntime();
      if (!runtime.available) {
        throw new TestCenterRuntimeError(
          "TEST_CENTER_AGENT_UNSUPPORTED",
          runtime.sql_descriptor.unavailable_reason ?? "认证 SQL 模型 Agent 尚不可用。",
          409,
        );
      }
      agent = runtime.createSqlAgent(request.budget);
    } else if (request.agent_id === SUBMITTED_ANSWER_AGENT_ID) {
      agent = new SubmittedAnswerAgent(request.submitted_answers ?? {});
    } else {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_AGENT_UNSUPPORTED",
        "E-commerce Production 当前只注册认证模型 SQL Agent 与提交答案 Agent。",
        409,
      );
    }
    if (request.reflection_enabled && !agent.descriptor.supports_reflection) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_REFLECTION_UNSUPPORTED",
        "所选 Agent 不支持受 Oracle 反馈约束的自反省重试。",
        409,
      );
    }
    execution = await executeSqlBenchmarkBatch({
      dataset,
      suite: {
        suite_id: "ecommerce-production",
        suite_version: "1.0.0",
        dataset_version: "adb-ecommerce-bounded-v1",
        source_commit: "61bb0d6be3439797d2c75a6ede198b0b296cc226",
        oracle_version: "ecommerce-postgres-result-equivalence@1.0.0",
        prompt_version: "ecommerce-certified-sql-agent@1.0.0",
        workflow_version: "test-center-case-runner@1.0.0",
        evaluator_version: "ecommerce-postgres-evaluator@1.0.0",
        aggregator_version: "test-center-aggregator@1.0.0",
      },
      case_ids: request.case_ids,
      agent,
      reflection_enabled: request.reflection_enabled,
      budget: request.budget,
      seed: request.seed,
      batch_run_id: batchRunId,
      oracle: new PostgresResultOracle({
        executor: createPostgresReadOnlyBenchmarkExecutor({
          pool: pool(),
          policy: ECOMMERCE_DIRECT_QA_CAPABILITY,
        }),
        timeout_ms: request.budget.max_case_duration_ms,
        max_rows: 100_000,
        oracle_version: "ecommerce-postgres-result-equivalence@1.0.0",
      }),
    });
  } else if (request.suite_id === "bird-mini-dev") {
    const dataset = await loadBirdMiniDevDataset();
    let agent: PublishedBirdBaselineAgent | SubmittedAnswerAgent | BenchmarkEvalAgent;
    if (request.agent_id === PUBLISHED_BASELINE_AGENT_ID) {
      agent = new PublishedBirdBaselineAgent(dataset.published_predictions);
    } else if (request.agent_id === SUBMITTED_ANSWER_AGENT_ID) {
      agent = new SubmittedAnswerAgent(request.submitted_answers ?? {});
    } else if (request.agent_id === CERTIFIED_MODEL_SQL_AGENT_ID) {
      const runtime = await modelRuntime();
      if (!runtime.available) {
        throw new TestCenterRuntimeError(
          "TEST_CENTER_AGENT_UNSUPPORTED",
          runtime.sql_descriptor.unavailable_reason ?? "认证 SQL 模型 Agent 尚不可用。",
          409,
        );
      }
      agent = runtime.createSqlAgent(request.budget);
    } else {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_AGENT_UNSUPPORTED",
        "当前运行环境未注册指定 SQL Agent。",
        409,
      );
    }
    if (request.reflection_enabled && !agent.descriptor.supports_reflection) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_REFLECTION_UNSUPPORTED",
        "所选 Agent 不支持受 Oracle 反馈约束的自反省重试。",
        409,
      );
    }
    execution = await executeBirdBenchmarkBatch({
      dataset,
      case_ids: request.case_ids,
      agent,
      reflection_enabled: request.reflection_enabled,
      budget: request.budget,
      seed: request.seed,
      batch_run_id: batchRunId,
    });
  } else if (request.suite_id === "dr-spider") {
    let agent: BenchmarkEvalAgent;
    if (request.agent_id === SUBMITTED_ANSWER_AGENT_ID) {
      agent = new SubmittedAnswerAgent(request.submitted_answers ?? {});
    } else if (request.agent_id === CERTIFIED_MODEL_SQL_AGENT_ID) {
      const runtime = await modelRuntime();
      if (!runtime.available) {
        throw new TestCenterRuntimeError(
          "TEST_CENTER_AGENT_UNSUPPORTED",
          runtime.sql_descriptor.unavailable_reason ?? "认证 SQL 模型 Agent 尚不可用。",
          409,
        );
      }
      agent = runtime.createSqlAgent(request.budget);
    } else {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_AGENT_UNSUPPORTED",
        "Dr.Spider 当前未注册指定 SQL Agent。",
        409,
      );
    }
    execution = await executeSqlBenchmarkBatch({
      dataset: await loadDrSpiderDataset(),
      suite: {
        suite_id: "dr-spider",
        suite_version: "1.0.0",
        dataset_version: DR_SPIDER_DATASET_VERSION,
        source_commit: "c64694a4a278ab0faff08ce7a3501d46f458b431",
        oracle_version: "dr-spider-sqlite-result-equivalence@1.0.0",
        prompt_version: "dr-spider-sql-agent@1.3.0",
        workflow_version: "test-center-case-runner@1.0.0",
        evaluator_version: "dr-spider-sqlite-evaluator@1.0.0",
        aggregator_version: "test-center-aggregator@1.0.0",
      },
      case_ids: request.case_ids,
      agent,
      reflection_enabled: request.reflection_enabled,
      budget: request.budget,
      seed: request.seed,
      batch_run_id: batchRunId,
    });
  } else if (request.suite_id === "insightbench") {
    let agent: BenchmarkAnalysisAgent;
    if (request.agent_id === PROFILE_ANALYSIS_AGENT_ID) {
      agent = new DeterministicProfileAnalysisAgent();
    } else if (request.agent_id === CERTIFIED_MODEL_ANALYSIS_AGENT_ID) {
      const runtime = await modelRuntime();
      if (!runtime.available) {
        throw new TestCenterRuntimeError(
          "TEST_CENTER_AGENT_UNSUPPORTED",
          runtime.descriptor.unavailable_reason ?? "认证模型 Agent 尚不可用。",
          409,
        );
      }
      agent = runtime.createAgent(request.budget);
    } else {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_AGENT_UNSUPPORTED",
        "InsightBench 当前未注册指定分析 Agent。",
        409,
      );
    }
    execution = await executeInsightBenchBatch({
      dataset: await loadInsightBenchDataset(),
      case_ids: request.case_ids,
      agent,
      reflection_enabled: request.reflection_enabled,
      budget: request.budget,
      seed: request.seed,
      batch_run_id: batchRunId,
    });
  } else if (request.suite_id === "blade") {
    if (request.agent_id !== CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_AGENT_UNSUPPORTED",
        "BLADE 当前只注册认证模型选择题 Agent。",
        409,
      );
    }
    const runtime = await modelRuntime();
    if (!runtime.available) {
      throw new TestCenterRuntimeError(
        "TEST_CENTER_AGENT_UNSUPPORTED",
        runtime.multiple_choice_descriptor.unavailable_reason ?? "认证选择题模型 Agent 尚不可用。",
        409,
      );
    }
    execution = await executeMultipleChoiceBenchmarkBatch({
      dataset: await loadBladeDataset(),
      case_ids: request.case_ids,
      agent: runtime.createMultipleChoiceAgent(request.budget),
      budget: request.budget,
      reflection_enabled: request.reflection_enabled,
      seed: request.seed,
      batch_run_id: batchRunId,
    });
  } else {
    throw new TestCenterRuntimeError(
      "TEST_CENTER_SUITE_NOT_READY",
      "该题库尚未注册可执行 Runner。",
      409,
    );
  }
  const run = completedBatchRun({
    batchRunId,
    reflectionEnabled: request.reflection_enabled,
    execution,
  });
  return persistRun({ idempotencyKey, requestHash, run });
}

export const testCenterAgentIds = Object.freeze({
  publishedBaseline: PUBLISHED_BASELINE_AGENT_ID,
  submittedAnswer: SUBMITTED_ANSWER_AGENT_ID,
  profileAnalysis: PROFILE_ANALYSIS_AGENT_ID,
  certifiedModelAnalysis: CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
  certifiedModelSql: CERTIFIED_MODEL_SQL_AGENT_ID,
  certifiedModelMultipleChoice: CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
});
