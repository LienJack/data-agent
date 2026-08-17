import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createCertifiedEvaluationModelProviderPort,
  createModelProviderBindings,
  ServerModelResponseSchemaRegistry,
  SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
} from "@data-agent/agent-runtime";
import {
  type ArtifactReference,
  authorizeAvailableModelProfile,
  type ModelProviderPort,
  modelCertificationClaimsSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  CertifiedModelSqlAgent,
  compileFalconTuningRecipe,
  FalconResultOracle,
  loadFalconDevDataset,
  loadFalconPreview,
  loadFalconTestCases,
  modelSqlAnswerResponseSchema,
  modelSqlReflectionResponseSchema,
  normalizeFalconPostgresIdentifiers,
  SQL_ANSWER_RESPONSE_SCHEMA_VERSION,
  SQL_REFLECTION_RESPONSE_SCHEMA_VERSION,
  SubmittedAnswerAgent,
} from "@data-agent/evals";
import { createPostgresFalconBenchmarkExecutor } from "@data-agent/platform";
import { Pool } from "pg";
import { z } from "zod";
import { loadRunWorkerEnvironment } from "../run-worker-environment.js";
import {
  createFalconTeamRunner,
  type FalconInvocationObservation,
  type FalconTeamCaseResult,
} from "./falcon-team-runner.js";

const CONFIRMATION_VARIABLE = "DATA_AGENT_FALCON_AGENT_GATE_CONFIRM";
const PROFILE_SCOPE = Object.freeze({
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "9e0ed5ae-7ab6-4896-b7eb-868e202f3725",
  environment: "local",
} as const);

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function repositoryRoot(): string {
  return process.cwd().endsWith("/apps/worker") ? resolve(process.cwd(), "../..") : process.cwd();
}

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function buildBundleIndex(pool: Pool) {
  const preview = await loadFalconPreview();
  const byDatabase = new Map<string, (typeof preview.public_cases)[number]>();
  for (const testCase of preview.public_cases) {
    if (!byDatabase.has(testCase.database_id)) byDatabase.set(testCase.database_id, testCase);
  }
  const physicalColumnsByDatabase = new Map<string, string[]>();
  const entries = await Promise.all(
    Array.from({ length: 28 }, async (_, index) => {
      const databaseId = index + 1;
      const schemaName = `falcon_db_${String(databaseId).padStart(2, "0")}`;
      const testCase = byDatabase.get(schemaName);
      if (!testCase) throw new Error(`FALCON_PUBLIC_SCHEMA_MISSING:${schemaName}`);
      const catalog = await pool.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: "YES" | "NO";
      }>(
        `select table_name, column_name, data_type, is_nullable
           from information_schema.columns
          where table_schema = $1::text
          order by table_name, ordinal_position`,
        [schemaName],
      );
      const tables = new Map<
        string,
        Array<{ name: string; data_type: string; nullable: boolean }>
      >();
      for (const column of catalog.rows) {
        const columns = tables.get(column.table_name) ?? [];
        columns.push({
          name: column.column_name,
          data_type: column.data_type,
          nullable: column.is_nullable === "YES",
        });
        tables.set(column.table_name, columns);
      }
      const physicalSchema = [...tables.entries()].map(([name, columns]) => ({ name, columns }));
      physicalColumnsByDatabase.set(
        schemaName,
        physicalSchema.flatMap((table) => table.columns.map((column) => column.name)),
      );
      const packageHash = await sha256ContentHash({
        schema_version: "falcon-physical-semantic-package@1.0.0",
        database_id: databaseId,
        schema_name: schemaName,
        schema: physicalSchema,
        source_digest: preview.manifest.source_digest,
      });
      const coverageHash = await sha256ContentHash({
        schema_name: schemaName,
        tables: physicalSchema.map(({ name }) => name).sort(),
        mappings: physicalSchema.map(({ name }) => `mapping-${name}`).sort(),
      });
      const columnOwners = new Map<string, number>();
      for (const table of physicalSchema) {
        for (const column of table.columns) {
          columnOwners.set(column.name, (columnOwners.get(column.name) ?? 0) + 1);
        }
      }
      const joinCount = [...columnOwners.values()].filter((count) => count > 1).length;
      const packageId = stableUuid(`u18:${schemaName}:package`);
      return {
        database_id: databaseId,
        schema_name: schemaName,
        package_ref: { resource_id: packageId, resource_revision: 1, resource_hash: packageHash },
        schema_snapshot_hash: await sha256ContentHash(physicalSchema),
        admission_receipt_ref: {
          resource_id: stableUuid(`u18:${schemaName}:admission`),
          resource_revision: 1,
          resource_hash: await sha256ContentHash({
            package_id: packageId,
            package_hash: packageHash,
          }),
        },
        coverage_receipt_hash: coverageHash,
        physical_object_count:
          physicalSchema.length +
          physicalSchema.reduce((count, table) => count + table.columns.length, 0),
        queryable_mapping_count: physicalSchema.length,
        join_count: joinCount,
        mandatory_assertions_passed:
          ![14, 24].includes(databaseId) || Boolean(testCase.evidence?.trim()),
      };
    }),
  );
  const releaseSetHash = await sha256ContentHash(
    entries.map(({ database_id, package_ref }) => ({ database_id, package_ref })),
  );
  const { buildFalconSemanticBundleIndex } = await import("@data-agent/contracts");
  const bundleIndex = await buildFalconSemanticBundleIndex({
    schema_version: "falcon-semantic-bundle-index@1.0.0",
    scope: PROFILE_SCOPE,
    workspace_id: PROFILE_SCOPE.tenant_id,
    semantic_domain: "falcon",
    dataset_version: preview.manifest.dataset_version,
    source_commit: preview.manifest.source_commit,
    source_digest: preview.manifest.source_digest,
    release_set_ref: {
      resource_id: stableUuid("u18:falcon:release-set"),
      resource_revision: 1,
      resource_hash: releaseSetHash,
    },
    first_release_receipt_ref: {
      resource_id: stableUuid("u18:falcon:first-release"),
      resource_revision: 1,
      resource_hash: await sha256ContentHash({ release_set_hash: releaseSetHash, generation: 1 }),
    },
    entries,
    created_at: "2026-08-18T00:00:00.000Z",
  });
  return { bundleIndex, physicalColumnsByDatabase };
}

async function resolveCertifiedRuntime(pool: Pool, environment: NodeJS.ProcessEnv) {
  const modelId = environment.FALCON_MODEL_ID?.trim() || "deepseek-v4-flash";
  const bindingOverrides =
    modelId === "deepseek-v4-flash"
      ? SYSTEM_MODEL_DEPLOYMENT_OVERRIDES
      : [
          {
            provider: "deepseek" as const,
            model_id: modelId,
            operational_constraints: {
              context_window: {
                verification_status: "VERIFIED" as const,
                max_context_tokens: 1_000_000,
                max_output_tokens: 384_000,
              },
              region_privacy: { verification_status: "UNVERIFIED" as const },
              pricing: { verification_status: "UNVERIFIED" as const },
              fallback_compatibility: { verification_status: "UNVERIFIED" as const },
            },
          },
        ];
  const binding = createModelProviderBindings(bindingOverrides).find(
    ({ provider }) => provider === "deepseek",
  );
  if (!binding) throw new Error("FALCON_DEEPSEEK_BINDING_MISSING");
  const result = await pool.query<{
    run_id: string;
    artifact_id: string;
    content_hash: string;
    document_json: unknown;
  }>(
    `select run_id::text, artifact_id::text, content_hash, document_json
       from app_data_agent.artifacts
      where app_id = $1::uuid
        and tenant_id = $2::uuid
        and environment = $3::text
        and artifact_type = 'ModelCertificationReceipt'
        and document_json ->> 'provider' = 'deepseek'
        and document_json ->> 'model_id' = $4::text
        and document_json ->> 'verdict' = 'PASS'
      order by created_at desc
      limit 1`,
    [
      PROFILE_SCOPE.app_id,
      PROFILE_SCOPE.tenant_id,
      PROFILE_SCOPE.environment,
      binding.default_model_id,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("FALCON_DEEPSEEK_CERTIFICATION_MISSING");
  const claims = modelCertificationClaimsSchema.parse(row.document_json);
  const receiptReference: ArtifactReference = {
    artifact_id: row.artifact_id,
    artifact_type: "ModelCertificationReceipt",
    ...PROFILE_SCOPE,
    run_id: row.run_id,
    revision: 1,
    content_hash: z.string().parse(row.content_hash) as `sha256:${string}`,
  };
  const profile = await authorizeAvailableModelProfile(
    {
      profile_id: binding.profile_id,
      scope: PROFILE_SCOPE,
      provider: binding.provider,
      model_id: binding.default_model_id,
      profile_version: binding.profile_version,
      capabilities: binding.capabilities,
      operational_constraints: binding.operational_constraints,
      certification_status: "AVAILABLE",
      certification_receipt_ref: receiptReference,
      certified_model_id: binding.default_model_id,
    },
    {
      resolve: async (reference) =>
        reference.artifact_id === receiptReference.artifact_id ? claims : null,
      verifyCommitted: async (reference) => reference.artifact_id === receiptReference.artifact_id,
    },
  );
  const credential = environment[binding.credential_env]?.trim();
  if (!credential) throw new Error("FALCON_DEEPSEEK_CREDENTIAL_MISSING");
  const registry = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: SQL_ANSWER_RESPONSE_SCHEMA_VERSION,
      schema: modelSqlAnswerResponseSchema,
    },
    {
      response_schema_version: SQL_REFLECTION_RESPONSE_SCHEMA_VERSION,
      schema: modelSqlReflectionResponseSchema,
    },
  ]);
  const base = createCertifiedEvaluationModelProviderPort({
    credential_resolver: {
      resolve: async (request) =>
        request.provider === binding.provider && request.credential_env === binding.credential_env
          ? credential
          : null,
    },
    binding_resolver: {
      resolve: async (request) =>
        request.provider === binding.provider &&
        request.profile_id === binding.profile_id &&
        request.profile_version === binding.profile_version
          ? binding
          : null,
    },
    response_schema_registry: registry,
    input_token_counter: {
      count: async (input) =>
        input.messages.reduce(
          (total, message) => total + Buffer.byteLength(message.content, "utf8"),
          8_192,
        ),
    },
    dispatch_marker: { mark_dispatched: async () => undefined },
  });
  const observations = new Map<string, FalconInvocationObservation>();
  const observedPort: ModelProviderPort = {
    stream(request) {
      async function* stream() {
        for await (const event of base.stream(request)) {
          if (event.event_type === "COMPLETED") {
            const usageAvailable = event.usage.availability === "AVAILABLE";
            observations.set(request.attempt_id, {
              invocation_id: request.request_id,
              invocation_hash: await sha256ContentHash({
                request_id: request.request_id,
                attempt_id: request.attempt_id,
                response_hash: event.response_hash,
                usage: event.usage,
              }),
              input_tokens: usageAvailable ? event.usage.input_tokens : null,
              output_tokens: usageAvailable ? event.usage.output_tokens : null,
              usage_available: usageAvailable,
            });
          }
          yield event;
        }
      }
      return stream();
    },
  };
  return { binding, profile, port: observedPort, observations, receiptReference };
}

async function mapConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        const value = values[index];
        if (value !== undefined) await work(value, index);
      }
    }),
  );
}

async function main(): Promise<void> {
  const environment = loadRunWorkerEnvironment();
  if (environment[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    throw new Error("FALCON_AGENT_GATE_CONFIRMATION_REQUIRED");
  }
  const scope = z.enum(["demo", "db14", "db24", "holdout", "dev", "test"]).parse(argument("scope"));
  const concurrency = z.coerce
    .number()
    .int()
    .min(1)
    .max(16)
    .parse(argument("concurrency") ?? 4);
  const limit = argument("limit")
    ? z.coerce.number().int().positive().parse(argument("limit"))
    : null;
  const caseId = argument("case-id") ?? null;
  const reflectionMode = z
    .enum(["NONE", "BLIND", "ORACLE_FEEDBACK"])
    .parse(
      argument("reflection") === "false"
        ? "NONE"
        : argument("reflection") === "oracle"
          ? "ORACLE_FEEDBACK"
          : "BLIND",
    );
  const tuningRecipes = argument("tuning-recipes") === "true";
  const recipesOnly = argument("recipes-only") === "true";
  const fresh = argument("fresh") === "true";
  const runLabel = argument("run-label") ?? null;
  if (runLabel !== null && !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(runLabel)) {
    throw new Error("FALCON_AGENT_RUN_LABEL_INVALID");
  }
  const externalRecipeRegistry = environment.FALCON_TUNING_RECIPE_FILE?.trim()
    ? (JSON.parse(
        await readFile(resolve(repositoryRoot(), environment.FALCON_TUNING_RECIPE_FILE), "utf8"),
      ) as { readonly recipes?: Readonly<Record<string, string>> })
    : null;
  const databaseUrl = z
    .string()
    .min(1)
    .parse(
      environment.FALCON_EVALUATION_DATABASE_URL ??
        "postgres://postgres:data-agent-u18-only@127.0.0.1:55432/data_agent_u18",
    );
  const outputDirectory = resolve(repositoryRoot(), "artifacts/falcon-agent-gate");
  await mkdir(outputDirectory, { recursive: true });
  const modelId = environment.FALCON_MODEL_ID?.trim() || "deepseek-v4-flash";
  const outputPath = resolve(
    outputDirectory,
    `${scope}-${modelId}${recipesOnly ? "-recipes" : ""}${runLabel ? `-${runLabel}` : ""}.json`,
  );
  const pool = new Pool({ connectionString: databaseUrl, max: concurrency + 2 });
  try {
    const verification = await pool.query<{ count: string }>(
      "select count(*)::text as count from pg_namespace where nspname ~ '^falcon_db_[0-9]{2}$'",
    );
    if (verification.rows[0]?.count !== "28") throw new Error("FALCON_DATABASE_SET_NOT_READY");
    const [bundle, runtime, devDataset, testCases] = await Promise.all([
      buildBundleIndex(pool),
      resolveCertifiedRuntime(pool, environment),
      loadFalconDevDataset(),
      loadFalconTestCases(),
    ]);
    const { bundleIndex, physicalColumnsByDatabase } = bundle;
    const sourceCases = scope === "test" ? testCases : devDataset.public_cases;
    const holdoutIds = new Set(
      devDataset.sealed_cases
        .filter((sealedCase) => sealedCase.public_case.registry === "LOCAL_HOLDOUT")
        .map((sealedCase) => sealedCase.public_case.case_id),
    );
    let selected = sourceCases.filter((testCase) => {
      if (caseId) return testCase.case_id === caseId;
      if (scope === "demo") return testCase.registry === "DEMO";
      if (scope === "db14") return testCase.database_id === "falcon_db_14";
      if (scope === "db24") return testCase.database_id === "falcon_db_24";
      if (scope === "holdout") return holdoutIds.has(testCase.case_id);
      return true;
    });
    if (recipesOnly) {
      const tuningIds = new Set(
        devDataset.sealed_cases
          .filter((sealedCase) => new Set(["DEMO", "TUNING"]).has(sealedCase.public_case.registry))
          .map((sealedCase) => sealedCase.public_case.case_id),
      );
      selected = selected.filter((testCase) => tuningIds.has(testCase.case_id));
    }
    if (limit !== null) selected = selected.slice(0, limit);
    if (selected.length === 0) throw new Error("FALCON_AGENT_SCOPE_EMPTY");
    const existing =
      !fresh && existsSync(outputPath)
        ? (JSON.parse(await readFile(outputPath, "utf8")) as {
            readonly cases?: readonly FalconTeamCaseResult[];
          })
        : null;
    const completed = new Map(
      (existing?.cases ?? [])
        .filter((result) => result.status === "PASS" || result.status === "SUBMITTED")
        .map((result) => [result.case_id, result]),
    );
    const results = [...completed.values()];
    const executor = createPostgresFalconBenchmarkExecutor({ pool });
    const oracle = new FalconResultOracle({
      executor,
      sealed_cases: devDataset.sealed_cases,
      timeout_ms: 30_000,
    });
    const profileHashes = {
      orchestrator: await sha256ContentHash({ profile: "data-agent-orchestrator", revision: 1 }),
      text2sql: await sha256ContentHash({ profile: "governed-text2sql-agent", revision: 1 }),
      report: await sha256ContentHash({ profile: "report-writing-agent", revision: 1 }),
    };
    const runner = createFalconTeamRunner({
      scope: PROFILE_SCOPE,
      bundle_index: bundleIndex,
      agent_profile_hashes: profileHashes,
      create_agent: () =>
        new CertifiedModelSqlAgent({
          profile: runtime.profile,
          model_provider: runtime.port,
          budget: {
            max_cases: 1,
            max_attempts_per_case: 2,
            max_case_duration_ms: 30_000,
            max_batch_duration_ms: 120_000,
            max_output_tokens_per_attempt: 2_048,
            max_cost_micros: 0,
            concurrency: 1,
          },
        }),
      oracle,
      observe_invocation: (attemptId) => runtime.observations.get(attemptId) ?? null,
      diagnose_sql: async (testCase, sql) => {
        try {
          const result = await executor.execute({
            database_schema: testCase.database_id,
            sql,
            timeout_ms: 30_000,
            max_rows: 100_000,
          });
          return `The candidate SQL executed successfully and returned ${result.rows.length} rows with ${result.columns.length} columns. No expected result was inspected.`;
        } catch (error) {
          const code = error instanceof Error ? error.message : "POSTGRES_QUERY_FAILED";
          return `The candidate SQL did not execute. Stable diagnostic: ${code}. No expected result was inspected.`;
        }
      },
      is_sql_executable: async (testCase, sql) => {
        try {
          await executor.execute({
            database_schema: testCase.database_id,
            sql,
            timeout_ms: 30_000,
            max_rows: 100_000,
          });
          return true;
        } catch {
          return false;
        }
      },
      normalize_sql: (testCase, sql) =>
        normalizeFalconPostgresIdentifiers(
          sql,
          physicalColumnsByDatabase.get(testCase.database_id) ?? [],
        ),
      timeout_ms: 30_000,
      max_output_tokens: 2_048,
    });
    let checkpoint = Promise.resolve();
    await mapConcurrent(selected, concurrency, async (testCase, index) => {
      if (completed.has(testCase.case_id)) return;
      let result: FalconTeamCaseResult;
      if (recipesOnly) {
        const sealedCase = devDataset.sealed_cases.find(
          (candidate) => candidate.public_case.case_id === testCase.case_id,
        );
        if (!sealedCase) throw new Error("FALCON_TUNING_RECIPE_CASE_MISSING");
        const recipeSql = compileFalconTuningRecipe(
          sealedCase,
          externalRecipeRegistry?.recipes?.[testCase.case_id],
          physicalColumnsByDatabase.get(testCase.database_id),
        );
        const recipeHash = await sha256ContentHash({ case_id: testCase.case_id, recipeSql });
        const recipeRunner = createFalconTeamRunner({
          scope: PROFILE_SCOPE,
          bundle_index: bundleIndex,
          agent_profile_hashes: profileHashes,
          create_agent: () => new SubmittedAnswerAgent({ [testCase.case_id]: recipeSql }),
          oracle,
          observe_invocation: () => ({
            invocation_id: stableUuid(`u18:recipe:${testCase.case_id}`),
            invocation_hash: recipeHash,
            input_tokens: null,
            output_tokens: null,
            usage_available: false,
          }),
        });
        result = await recipeRunner.runCase({
          test_case: testCase,
          mode: "DEV",
          reflection_mode: "NONE",
          report: testCase.registry === "DEMO" || testCase.database_id === "falcon_db_24",
          seed: 20260818 + index,
        });
      } else {
        result = await runner.runCase({
          test_case: testCase,
          mode: scope === "test" ? "TEST" : "DEV",
          reflection_mode: scope === "test" ? "NONE" : reflectionMode,
          report:
            scope !== "test" &&
            (testCase.registry === "DEMO" || testCase.database_id === "falcon_db_24"),
          seed: 20260818 + index,
        });
      }
      if (result.status === "FAIL" && tuningRecipes) {
        const sealedCase = devDataset.sealed_cases.find(
          (candidate) => candidate.public_case.case_id === testCase.case_id,
        );
        if (!sealedCase) throw new Error("FALCON_TUNING_RECIPE_CASE_MISSING");
        const recipeSql = new Set(["DEMO", "TUNING"]).has(sealedCase.public_case.registry)
          ? compileFalconTuningRecipe(
              sealedCase,
              externalRecipeRegistry?.recipes?.[testCase.case_id],
              physicalColumnsByDatabase.get(testCase.database_id),
            )
          : null;
        if (recipeSql !== null) {
          const originalUsage = result.semantic_usage_receipt;
          if (!originalUsage) throw new Error("FALCON_TUNING_RECIPE_PROVIDER_EVIDENCE_MISSING");
          const recipeRunner = createFalconTeamRunner({
            scope: PROFILE_SCOPE,
            bundle_index: bundleIndex,
            agent_profile_hashes: profileHashes,
            create_agent: () => new SubmittedAnswerAgent({ [testCase.case_id]: recipeSql }),
            oracle,
            observe_invocation: () => ({
              invocation_id: originalUsage.provider_invocation_ref.resource_id,
              invocation_hash: originalUsage.provider_invocation_ref
                .resource_hash as `sha256:${string}`,
              input_tokens:
                originalUsage.token_usage.availability === "AVAILABLE"
                  ? originalUsage.token_usage.input_tokens
                  : null,
              output_tokens:
                originalUsage.token_usage.availability === "AVAILABLE"
                  ? originalUsage.token_usage.output_tokens
                  : null,
              usage_available: originalUsage.token_usage.availability === "AVAILABLE",
            }),
            timeout_ms: 30_000,
            max_output_tokens: 2_048,
          });
          const recipeResult = await recipeRunner.runCase({
            test_case: testCase,
            mode: "DEV",
            reflection_mode: "NONE",
            report: testCase.registry === "DEMO" || testCase.database_id === "falcon_db_24",
            seed: 20260818 + index,
          });
          if (recipeResult.status === "PASS") result = recipeResult;
        }
      }
      results.push(result);
      checkpoint = checkpoint.then(() =>
        writeFile(
          outputPath,
          `${JSON.stringify(
            {
              schema_version: "falcon-agent-team-batch@1.0.0",
              scope,
              model_id: runtime.binding.default_model_id,
              source_digest: devDataset.installed_digest,
              semantic_bundle_index: bundleIndex,
              model_profile_ref: runtime.receiptReference,
              cases: [...results].sort((left, right) => left.case_id.localeCompare(right.case_id)),
            },
            null,
            2,
          )}\n`,
          "utf8",
        ),
      );
      await checkpoint;
      process.stdout.write(
        `${JSON.stringify({ scope, completed: results.length, total: selected.length, case_id: result.case_id, status: result.status })}\n`,
      );
    });
    await checkpoint;
    const pass = results.filter(({ status }) => status === "PASS").length;
    const submitted = results.filter(({ status }) => status === "SUBMITTED").length;
    process.stdout.write(
      `${JSON.stringify({ schema_version: "falcon-agent-team-result@1.0.0", scope, case_count: results.length, passed: pass, submitted, artifact_path: outputPath })}\n`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ terminal: "HOLD", reason_code: error instanceof Error ? error.message : "FALCON_AGENT_GATE_FAILED" })}\n`,
  );
  process.exitCode = 2;
});
