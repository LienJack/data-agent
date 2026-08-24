import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import pg from "../apps/web/node_modules/pg/esm/index.mjs";
import { activateFalconSemanticWorkspace } from "../apps/web/src/lib/falcon-semantic-activation";
import {
  attachFalconToWorkspace,
  FALCON_DATASOURCE_ID,
  resolveFalconConnectionConfiguration,
  verifyFalconWorkspace,
} from "../apps/web/src/lib/falcon-workspace-bootstrap";
import { createPostgresSemanticPublicationAuthority } from "../apps/web/src/lib/postgres-semantic-publication";
import { buildFalcon24SemanticChangeSet } from "../apps/worker/src/evals/falcon24-semantic-change-set";
import {
  buildSemanticReviewDecision,
  FALCON_DATASET_VERSION,
  FALCON_SOURCE_COMMIT,
  falconSubmissionReceiptSchema,
  sha256ContentHash,
} from "../packages/contracts/src/index";
import {
  executeSqlBenchmarkBatch,
  FalconResultOracle,
  loadFalconDevDataset,
  loadFalconTestCases,
  SubmittedAnswerAgent,
  toFalconSqlBenchmarkDataset,
  verifyFalconBundle,
} from "../packages/evals/src/index";
import { createPostgresFalconBenchmarkExecutor } from "../packages/platform/src/index";
import { resolveRuntimeRepositoryRoot } from "../packages/platform/src/runtime-config/index";
import { publishReviewedSemanticChangeSet } from "../packages/semantic/src/production/index";

const APP_ID = "00000000-0000-4000-8000-00000000da01";

function repositoryRoot(): string {
  return resolveRuntimeRepositoryRoot(process.cwd());
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

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function resolveScope(pool: pg.Pool) {
  const workspaceId = argument("workspace-id");
  const result = await pool.query<{
    workspace_id: string;
    environment: string;
    principal_id: string;
    deployment_id: string;
  }>(
    `select workspace.workspace_id::text, workspace.environment, membership.principal_id::text,
            deployment.deployment_id::text
       from app_data_agent.workspaces as workspace
       join app_data_agent.memberships as membership
         on membership.app_id = workspace.app_id
        and membership.tenant_id = workspace.workspace_id
        and membership.environment = workspace.environment
       join platform.deployment_mappings as deployment
         on deployment.app_id=workspace.app_id and deployment.environment=workspace.environment
        and deployment.is_active
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
    deploymentId: result.rows[0].deployment_id,
  } as const;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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
  } else if (command === "semantic:publish") {
    const scope = await resolveScope(pool);
    const currentResult = await pool.query<{
      current_release_id: string | null;
      current_release_generation: string;
      current_release_digest: string | null;
      source_payload: unknown | null;
    }>(
      `select pointer.current_release_id::text,pointer.current_release_generation::text,
              pointer.current_release_digest,source.source_payload
         from semantic.semantic_active_pointer as pointer
         left join semantic.semantic_source_release as release
           on release.app_id=pointer.app_id and release.tenant_id=pointer.tenant_id
          and release.environment=pointer.environment and release.semantic_domain=pointer.semantic_domain
          and release.release_id=pointer.current_release_id
         left join semantic.semantic_candidate as candidate
           on candidate.app_id=release.app_id and candidate.tenant_id=release.tenant_id
          and candidate.environment=release.environment and candidate.semantic_domain=release.semantic_domain
          and candidate.candidate_id=release.candidate_id
         left join semantic.semantic_candidate_revision as revision
           on revision.app_id=candidate.app_id and revision.tenant_id=candidate.tenant_id
          and revision.environment=candidate.environment and revision.semantic_domain=candidate.semantic_domain
          and revision.candidate_id=candidate.candidate_id
          and revision.revision_id=candidate.current_revision_id
         left join semantic.semantic_source_revision as source
           on source.app_id=revision.app_id and source.tenant_id=revision.tenant_id
          and source.environment=revision.environment and source.semantic_domain=revision.semantic_domain
          and source.revision_id=revision.source_revision_id
        where pointer.app_id=$1::uuid and pointer.tenant_id=$2::uuid
          and pointer.environment=$3::text and pointer.semantic_domain='falcon24'`,
      [scope.appId, scope.workspaceId, scope.environment],
    );
    const current = currentResult.rows[0];
    const baseRelease = current?.current_release_id
      ? {
          release_id: current.current_release_id,
          generation: Number(current.current_release_generation),
          release_hash: current.current_release_digest as `sha256:${string}`,
        }
      : {
          release_id: stableUuid("falcon24:genesis-release"),
          generation: 0,
          release_hash: await sha256ContentHash({ semantic_domain: "falcon24", generation: 0 }),
        };
    const prepared = await buildFalcon24SemanticChangeSet({
      scope: {
        app_id: scope.appId,
        tenant_id: scope.workspaceId,
        environment: scope.environment,
        semantic_domain: "falcon24",
      },
      base_release: baseRelease,
      revision: baseRelease.generation + 1,
    });
    const assetMaterial = (changeSet: typeof prepared.change_set) => ({
      assertions: changeSet.assertions,
      competency_results: changeSet.competency_results,
      validation: changeSet.validation,
    });
    const desiredAssetHash = await sha256ContentHash(assetMaterial(prepared.change_set));
    const currentAssetHash = current?.source_payload
      ? await sha256ContentHash(
          assetMaterial(current.source_payload as typeof prepared.change_set),
        ).catch(() => null)
      : null;
    let publication: Record<string, unknown>;
    let release: {
      release_id: string;
      release_generation: number;
      release_hash: `sha256:${string}`;
    };
    if (current?.current_release_id && desiredAssetHash === currentAssetHash) {
      release = {
        release_id: current.current_release_id,
        release_generation: Number(current.current_release_generation),
        release_hash: current.current_release_digest as `sha256:${string}`,
      };
      publication = {
        schema_version: "falcon-semantic-publication@1.0.0",
        terminal: "ALREADY_PUBLISHED",
        workspace_id: scope.workspaceId,
        semantic_domain: "falcon24",
        ...release,
        asset_hash: currentAssetHash,
      };
    } else {
      const publishedAt = new Date().toISOString();
      const review = await buildSemanticReviewDecision({
        schema_version: "semantic-review-decision@1.0.0",
        review_id: stableUuid(`${prepared.change_set.change_set_hash}:review`),
        scope: prepared.change_set.scope,
        change_set_id: prepared.change_set.change_set_id,
        change_set_hash: prepared.change_set.change_set_hash,
        reviewer_principal_id: scope.principalId,
        decision: "APPROVE",
        reason_codes: [],
        reviewed_at: publishedAt,
      });
      const receipt = await publishReviewedSemanticChangeSet({
        publication_id: stableUuid(`${prepared.change_set.change_set_hash}:publication`),
        change_set: prepared.change_set,
        review,
        authority: createPostgresSemanticPublicationAuthority(pool, {
          ...scope,
          datasourceId: FALCON_DATASOURCE_ID,
          semanticDomain: "falcon24",
        }),
        published_at: publishedAt,
      });
      release = {
        release_id: receipt.published_release.release_id,
        release_generation: receipt.published_release.generation,
        release_hash: receipt.published_release.release_hash,
      };
      publication = {
        schema_version: "falcon-semantic-publication@1.0.0",
        terminal: "PUBLISHED",
        workspace_id: scope.workspaceId,
        semantic_domain: "falcon24",
        datasource_id: FALCON_DATASOURCE_ID,
        assertion_count: prepared.assertion_count,
        competency_case_count: prepared.competency_case_count,
        asset_hash: desiredAssetHash,
        receipt,
      };
    }
    const activation = await activateFalconSemanticWorkspace({
      pool,
      environment: process.env,
      scope,
      release,
    });
    report({ ...publication, activation });
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
