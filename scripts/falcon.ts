import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseEnv } from "node:util";
import pg from "../apps/web/node_modules/pg/esm/index.mjs";
import {
  attachFalconToWorkspace,
  resolveFalconConnectionConfiguration,
  verifyFalconWorkspace,
} from "../apps/web/src/lib/falcon-workspace-bootstrap";
import {
  FALCON_DATASET_VERSION,
  FALCON_SOURCE_COMMIT,
  falconSubmissionReceiptSchema,
  sha256ContentHash,
} from "../packages/contracts/src/index";
import {
  buildFalconDb24OntologyGraph,
  executeSqlBenchmarkBatch,
  FALCON_DB24_JOIN_SPECS,
  FalconResultOracle,
  loadFalconDevDataset,
  loadFalconPreview,
  loadFalconTestCases,
  SubmittedAnswerAgent,
  toFalconSqlBenchmarkDataset,
  verifyFalconBundle,
} from "../packages/evals/src/index";
import { createPostgresFalconBenchmarkExecutor } from "../packages/platform/src/index";
import { createSemanticOntologyCoverageReceipt } from "../packages/semantic/src/public/authoring";
import { compileSemanticGraphV2 } from "../packages/semantic/src/public/governance";

const APP_ID = "00000000-0000-4000-8000-00000000da01";

function repositoryRoot(): string {
  const cwd = resolve(process.cwd());
  return basename(cwd) === "web" && basename(resolve(cwd, "..")) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
}

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function resolveScope(pool: pg.Pool) {
  const workspaceId = argument("workspace-id");
  const result = await pool.query<{
    workspace_id: string;
    environment: string;
    principal_id: string;
  }>(
    `select workspace.workspace_id::text, workspace.environment, membership.principal_id::text
       from app_data_agent.workspaces as workspace
       join app_data_agent.memberships as membership
         on membership.app_id = workspace.app_id
        and membership.tenant_id = workspace.workspace_id
        and membership.environment = workspace.environment
      where workspace.app_id = $1::uuid and workspace.lifecycle = 'ACTIVE'
        and membership.workspace_role = 'WORKSPACE_ADMIN' and membership.revoked_at is null
        and ($2::uuid is null or workspace.workspace_id = $2::uuid)
      order by workspace.created_at
      limit 2`,
    [APP_ID, workspaceId ?? null],
  );
  if (result.rowCount !== 1 || !result.rows[0])
    throw new Error("FALCON_WORKSPACE_TARGET_AMBIGUOUS");
  return {
    appId: APP_ID,
    workspaceId: result.rows[0].workspace_id,
    environment: result.rows[0].environment,
    principalId: result.rows[0].principal_id,
  } as const;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function postgresIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(value)) {
    throw new Error("FALCON_POSTGRES_IDENTIFIER_INVALID");
  }
  return `"${value}"`;
}

interface FalconJoinObservationRow {
  readonly left_non_null_rows: string;
  readonly left_distinct_keys: string;
  readonly orphan_rows: string;
  readonly right_non_null_rows: string;
  readonly right_distinct_keys: string;
}

async function certifyFalconDb24Joins() {
  const entries = await Promise.all(
    FALCON_DB24_JOIN_SPECS.map(async (join) => {
      const schema = postgresIdentifier("falcon_db_24");
      const leftTable = `${schema}.${postgresIdentifier(join.left_table)}`;
      const rightTable = `${schema}.${postgresIdentifier(join.right_table)}`;
      const leftColumn = postgresIdentifier(join.left_column);
      const rightColumn = postgresIdentifier(join.right_column);
      const result = await pool.query<FalconJoinObservationRow>(
        `with right_keys as (
           select ${rightColumn} as join_key
             from ${rightTable}
            where ${rightColumn} is not null
         ), observation as (
           select count(left_row.${leftColumn})::text as left_non_null_rows,
                  count(distinct left_row.${leftColumn})::text as left_distinct_keys,
                  count(*) filter (
                    where left_row.${leftColumn} is not null and right_row.join_key is null
                  )::text as orphan_rows
             from ${leftTable} as left_row
             left join (select distinct join_key from right_keys) as right_row
               on right_row.join_key = left_row.${leftColumn}
         )
         select observation.left_non_null_rows,
                observation.left_distinct_keys,
                observation.orphan_rows,
                (select count(*) from right_keys)::text as right_non_null_rows,
                (select count(distinct join_key) from right_keys)::text as right_distinct_keys
           from observation`,
      );
      const observation = result.rows[0];
      if (!observation) throw new Error(`FALCON_DB24_JOIN_OBSERVATION_MISSING:${join.join_id}`);
      const leftUnique = observation.left_non_null_rows === observation.left_distinct_keys;
      const rightUnique = observation.right_non_null_rows === observation.right_distinct_keys;
      const cardinality =
        leftUnique && rightUnique
          ? "one-to-one"
          : rightUnique
            ? "many-to-one"
            : leftUnique
              ? "one-to-many"
              : "many-to-many";
      const material = { join_id: join.join_id, ...observation, cardinality } as const;
      return [
        join.join_id,
        {
          content_hash: await sha256ContentHash(material),
          description: `${join.left_table}.${join.left_column} -> ${join.right_table}.${join.right_column}; left_non_null=${observation.left_non_null_rows}, left_distinct=${observation.left_distinct_keys}, orphan=${observation.orphan_rows}, right_non_null=${observation.right_non_null_rows}, right_distinct=${observation.right_distinct_keys}`,
          cardinality,
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

for (const filename of [".env", ".env.local"]) {
  const path = resolve(repositoryRoot(), filename);
  if (!existsSync(path)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
    process.env[key] ??= value;
  }
}
const command = process.argv[2];
const connectionString =
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: CLI reuses the server database authority.
  process.env.AUTH_DATABASE_URL ??
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: DATABASE_URL is the documented local fallback.
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/data_agent";
const pool = new pg.Pool({
  connectionString,
  application_name: "data-agent-falcon-cli",
  connectionTimeoutMillis: 5_000,
  statement_timeout: 300_000,
  max: 4,
});

try {
  if (command === "bundle:verify") {
    const verification = await verifyFalconBundle();
    report({
      schema_version: "falcon-bundle-verification@1.0.0",
      terminal: "READY",
      source_commit: verification.manifest.source_commit,
      source_digest: verification.installed_digest,
      verified_file_count: verification.verified_file_count,
      database_count: verification.manifest.database_count,
      case_count: verification.manifest.case_count,
      dev_case_count: verification.manifest.dev_case_count,
      test_case_count: verification.manifest.test_case_count,
      compatibility_fixture_count: verification.compatibility_fixture_count,
    });
  } else if (command === "workspace:attach") {
    const scope = await resolveScope(pool);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await attachFalconToWorkspace(
        client,
        scope,
        resolveFalconConnectionConfiguration(process.env, scope.environment),
      );
      await client.query("commit");
      report(result);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } else if (command === "workspace:verify") {
    const scope = await resolveScope(pool);
    report(await verifyFalconWorkspace(pool, scope));
  } else if (command === "semantic:import") {
    const scope = await resolveScope(pool);
    const preview = await loadFalconPreview();
    const mainDemoCase = preview.main_demo_cases[0];
    if (!mainDemoCase) throw new Error("FALCON_DB24_DEMO_CASE_MISSING");
    const checkedAt = new Date().toISOString();
    const graph = buildFalconDb24OntologyGraph({
      schema: mainDemoCase.schema,
      source_digest: preview.manifest.source_digest,
      scope: {
        app_id: scope.appId,
        tenant_id: scope.workspaceId,
        environment: scope.environment,
      },
      created_at: checkedAt,
      join_evidence: await certifyFalconDb24Joins(),
    });
    const [compilation, coverageReceipt] = await Promise.all([
      compileSemanticGraphV2(graph),
      createSemanticOntologyCoverageReceipt(graph, checkedAt),
    ]);
    if (!coverageReceipt.valid) throw new Error("FALCON_DB24_ONTOLOGY_COVERAGE_INVALID");
    const outputDirectory = resolve(repositoryRoot(), "artifacts/falcon-semantic");
    await mkdir(outputDirectory, { recursive: true });
    const candidatePath = resolve(outputDirectory, "falcon-db24-ontology-candidate.json");
    const coveragePath = resolve(outputDirectory, "falcon-db24-ontology-coverage.json");
    await Promise.all([
      writeFile(candidatePath, `${JSON.stringify(graph, null, 2)}\n`, "utf8"),
      writeFile(coveragePath, `${JSON.stringify(coverageReceipt, null, 2)}\n`, "utf8"),
    ]);
    report({
      schema_version: "falcon-semantic-import@1.0.0",
      terminal: "REVIEW_REQUIRED",
      workspace_id: scope.workspaceId,
      database_schema: "falcon_db_24",
      source_digest: compilation.source_digest,
      node_counts: coverageReceipt.active_node_counts,
      edge_family_counts: coverageReceipt.active_edge_family_counts,
      coverage_valid: coverageReceipt.valid,
      runtime_metric_count: compilation.runtime_bundle.metrics.length,
      runtime_dimension_count: compilation.runtime_bundle.dimensions.length,
      runtime_relationship_count: compilation.runtime_bundle.relationships.length,
      candidate_path: candidatePath,
      coverage_path: coveragePath,
      note: "Agent 候选已完成编译与物理 Join 认证；必须经人工 Review 后才能 Publish。",
    });
  } else if (command === "demo:smoke") {
    const dataset = await loadFalconDevDataset();
    const sealedCase = dataset.sealed_cases.find(
      (value) =>
        value.public_case.database_id === "falcon_db_14" && value.public_case.ordinal === 0,
    );
    if (!sealedCase) throw new Error("FALCON_SMOKE_CASE_MISSING");
    const sql = `with commercial_stores as (
      select "Store_ID" from "toy_stores" where "Store_Location" = 'Commercial'
    ), inventory_aggregation as (
      select inventory."Product_ID", sum(inventory."Stock_On_Hand") as total_stock
      from "toy_inventory" as inventory
      join commercial_stores as store on inventory."Store_ID" = store."Store_ID"
      group by inventory."Product_ID"
    )
    select product."Product_Name" as product_name, aggregate.total_stock as stock_on_hand
    from inventory_aggregation as aggregate
    join "toy_products" as product on product."Product_ID" = aggregate."Product_ID"
    order by aggregate.total_stock desc limit 10`;
    const oracle = new FalconResultOracle({
      executor: createPostgresFalconBenchmarkExecutor({ pool }),
      sealed_cases: [sealedCase],
    });
    const result = await oracle.evaluate({
      database_path: "falcon_db_14",
      candidate_sql: sql,
      gold_sql: `falcon-expected://${sealedCase.public_case.case_id}`,
    });
    report({
      schema_version: "falcon-demo-smoke@1.0.0",
      terminal: result.verdict === "PASS" ? "PASS" : "HOLD",
      case_id: sealedCase.public_case.case_id,
      database_schema: sealedCase.public_case.database_id,
      verdict: result.verdict,
      failure_type: result.feedback.failure_type,
      candidate_row_count: result.feedback.candidate_row_count,
      expected_row_count: result.feedback.gold_row_count,
      oracle_receipt_hash: result.feedback.oracle_receipt_hash,
    });
    if (result.verdict !== "PASS") process.exitCode = 2;
  } else if (command === "eval:batch") {
    const scope = argument("scope") ?? "db14";
    if (!new Set(["db14", "db24", "dev"]).has(scope)) throw new Error("FALCON_SCOPE_INVALID");
    const sourceDataset = await loadFalconDevDataset();
    const dataset = await toFalconSqlBenchmarkDataset(sourceDataset);
    const cases =
      scope === "dev"
        ? dataset.public_cases
        : dataset.public_cases.filter(
            (testCase) =>
              testCase.database_id === (scope === "db14" ? "falcon_db_14" : "falcon_db_24"),
          );
    if (cases.length === 0) throw new Error("FALCON_SCOPE_EMPTY");
    const answers = Object.fromEntries(
      cases.map((testCase) => [testCase.case_id, "select 1 as __falcon_pipeline_probe"]),
    );
    const batchRunId = randomUUID();
    const execution = await executeSqlBenchmarkBatch({
      dataset,
      suite: {
        suite_id: "falcon",
        suite_version: "1.0.0",
        dataset_version: FALCON_DATASET_VERSION,
        source_commit: FALCON_SOURCE_COMMIT,
        oracle_version: "falcon-postgres-expected-result@1.0.0",
        prompt_version: "falcon-pipeline-probe@1.0.0",
        workflow_version: "test-center-case-runner@1.0.0",
        evaluator_version: "falcon-postgres-evaluator@1.0.0",
        aggregator_version: "test-center-aggregator@1.0.0",
      },
      case_ids: cases.map((testCase) => testCase.case_id),
      agent: new SubmittedAnswerAgent(answers),
      reflection_enabled: false,
      budget: {
        max_cases: cases.length,
        max_attempts_per_case: 1,
        max_case_duration_ms: 30_000,
        max_batch_duration_ms: 3_600_000,
        max_output_tokens_per_attempt: 64,
        concurrency: 1,
      },
      seed: 20260816,
      batch_run_id: batchRunId,
      oracle: new FalconResultOracle({
        executor: createPostgresFalconBenchmarkExecutor({ pool }),
        sealed_cases: sourceDataset.sealed_cases,
        timeout_ms: 30_000,
      }),
    });
    const outputDirectory = resolve(repositoryRoot(), "artifacts/falcon-runs");
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = resolve(outputDirectory, `${batchRunId}.json`);
    await writeFile(outputPath, `${JSON.stringify(execution, null, 2)}\n`, "utf8");
    report({
      schema_version: "falcon-batch-pipeline-receipt@1.0.0",
      terminal: "COMPLETED",
      score_gate: execution.scorecard.post_reflection_score === 1 ? "GO" : "HOLD",
      scope,
      run_id: batchRunId,
      case_count: cases.length,
      passed_cases: execution.case_runs.filter((run) => run.status === "PASS").length,
      failed_cases: execution.case_runs.filter((run) => run.status === "FAIL").length,
      infra_failed_cases: execution.case_runs.filter((run) => run.status === "INFRA_FAILURE")
        .length,
      scorecard_hash: execution.scorecard.scorecard_hash,
      artifact_path: outputPath,
      note: "pipeline-probe 仅验证全链路完成性，不冒充模型准确率。",
    });
  } else if (command === "submission") {
    if ((argument("scope") ?? "test") !== "test")
      throw new Error("FALCON_SUBMISSION_SCOPE_INVALID");
    const cases = await loadFalconTestCases();
    const entries = cases.map((testCase) => ({
      question_id: String(testCase.ordinal),
      db_id: Number(testCase.database_id.slice(-2)),
      sql: "select 1 as __falcon_submission_probe",
      trace_id: randomUUID(),
    }));
    const entriesSha256 = await sha256ContentHash(entries);
    const csv = [
      "question_id,db_id,sql,trace_id",
      ...entries.map((entry) =>
        [entry.question_id, String(entry.db_id), entry.sql, entry.trace_id].map(csvCell).join(","),
      ),
    ].join("\n");
    const outputDirectory = resolve(repositoryRoot(), "artifacts/falcon-submissions");
    await mkdir(outputDirectory, { recursive: true });
    const artifactSha256 = await sha256ContentHash(csv);
    const receipt = falconSubmissionReceiptSchema.parse({
      receipt_version: "falcon-submission@1.0.0",
      suite_version: "1.0.0",
      dataset_version: FALCON_DATASET_VERSION,
      source_commit: FALCON_SOURCE_COMMIT,
      scope: "OFFICIAL_TEST_BLIND",
      case_count: 191,
      entries_sha256: entriesSha256,
      artifact_sha256: artifactSha256,
      generated_at: new Date().toISOString(),
    });
    const stem = `${Date.now()}-${artifactSha256.slice(7, 19)}`;
    const csvPath = resolve(outputDirectory, `${stem}.csv`);
    const receiptPath = resolve(outputDirectory, `${stem}.receipt.json`);
    await Promise.all([
      writeFile(csvPath, `${csv}\n`, "utf8"),
      writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
    ]);
    report({
      schema_version: "falcon-test-submission-result@1.0.0",
      terminal: "GENERATED",
      local_accuracy: null,
      case_count: entries.length,
      artifact_sha256: artifactSha256,
      csv_path: csvPath,
      receipt_path: receiptPath,
      note: "官方 TEST 无本地 Gold；本回执不报告本地准确率。",
    });
  } else {
    throw new Error("FALCON_COMMAND_INVALID");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "FALCON_COMMAND_FAILED";
  report({
    schema_version: "falcon-command-result@1.0.0",
    terminal: "HOLD",
    reason_code: /^[A-Z][A-Z0-9_:-]{2,255}$/u.test(message) ? message : "FALCON_COMMAND_FAILED",
  });
  process.exitCode = 2;
} finally {
  await pool.end().catch(() => undefined);
}
