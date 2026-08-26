import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";
import { buildFalcon24SemanticChangeSet } from "../apps/worker/src/evals/falcon24-semantic-change-set.js";
import {
  falcon24RetainedLlmConfigSchema,
  sha256ContentHash,
} from "../packages/contracts/src/index.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadEnvironment(root: string): void {
  for (const filename of [".env", ".env.local"]) {
    const path = resolve(root, filename);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      process.env[key] ??= value;
    }
  }
}

function normalizeCapabilities(input: unknown): string[] {
  const capabilities =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return [
    "LLM",
    ...(capabilities.reasoning === true ? ["REASONING"] : []),
    ...(capabilities.streaming === true ? ["STREAMING"] : []),
    ...(capabilities.structured_output === true ? ["STRUCTURED_OUTPUT"] : []),
    ...(capabilities.tool_calling === true ? ["TOOLS"] : []),
    ...(capabilities.vision === true ? ["VISION"] : []),
  ].sort();
}

async function assertionDiff(desired: readonly unknown[], current: readonly unknown[]) {
  async function indexed(values: readonly unknown[]) {
    const entries = await Promise.all(
      values.map(async (value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw new TypeError("FALCON24_SEMANTIC_ASSERTION_INVALID");
        }
        const key = (value as Record<string, unknown>).canonical_key;
        if (typeof key !== "string" || key.length === 0) {
          throw new TypeError("FALCON24_SEMANTIC_ASSERTION_KEY_INVALID");
        }
        return [key, await sha256ContentHash(value)] as const;
      }),
    );
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      throw new TypeError("FALCON24_SEMANTIC_ASSERTION_KEY_DUPLICATE");
    }
    return new Map(entries);
  }
  const desiredIndex = await indexed(desired);
  const currentIndex = await indexed(current);
  const keys = [...new Set([...desiredIndex.keys(), ...currentIndex.keys()])].sort();
  return keys.flatMap((key) => {
    const desiredHash = desiredIndex.get(key);
    const currentHash = currentIndex.get(key);
    if (!desiredHash) return [`EXTRA_DATABASE_KEY:${key}`];
    if (!currentHash) return [`MISSING_DATABASE_KEY:${key}`];
    return desiredHash === currentHash ? [] : [`CONTENT_MISMATCH:${key}`];
  });
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const outputPath = resolve(root, argument("output") ?? ".data/falcon24-e1-retained-export.json");
  loadEnvironment(root);
  const llmManifest = falcon24RetainedLlmConfigSchema.parse(
    JSON.parse(
      readFileSync(resolve(root, "infra/falcon/e1/llm-provider-model-profile.json"), "utf8"),
    ),
  );
  const connectionString =
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: read-only admin export uses the documented server authority.
    process.env.AUTH_DATABASE_URL ??
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: local fresh/dev fallback.
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@127.0.0.1:5432/data_agent";
  const pool = new pg.Pool({
    connectionString,
    application_name: "falcon24-e1-retained-export",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("begin read only isolation level repeatable read");
    const semanticResult = await client.query<{
      app_id: string;
      tenant_id: string;
      environment: string;
      release_id: string;
      release_generation: string;
      release_hash: `sha256:${string}`;
      source_payload: unknown;
    }>(
      `select pointer.app_id::text,pointer.tenant_id::text,pointer.environment,
              release.release_id::text,release.release_generation::text,
              release.release_digest as release_hash,source.source_payload
         from semantic.semantic_active_pointer as pointer
         join semantic.semantic_source_release as release
           on release.app_id=pointer.app_id and release.tenant_id=pointer.tenant_id
          and release.environment=pointer.environment and release.semantic_domain=pointer.semantic_domain
          and release.release_id=pointer.current_release_id
         join semantic.semantic_candidate as candidate
           on candidate.app_id=release.app_id and candidate.tenant_id=release.tenant_id
          and candidate.environment=release.environment and candidate.semantic_domain=release.semantic_domain
          and candidate.candidate_id=release.candidate_id
         join semantic.semantic_candidate_revision as revision
           on revision.app_id=candidate.app_id and revision.tenant_id=candidate.tenant_id
          and revision.environment=candidate.environment and revision.semantic_domain=candidate.semantic_domain
          and revision.candidate_id=candidate.candidate_id
          and revision.revision_id=candidate.current_revision_id
         join semantic.semantic_source_revision as source
           on source.app_id=revision.app_id and source.tenant_id=revision.tenant_id
          and source.environment=revision.environment and source.semantic_domain=revision.semantic_domain
          and source.revision_id=revision.source_revision_id
        where pointer.app_id=$1::uuid and pointer.semantic_domain='falcon24'
          and pointer.current_release_id is not null
        order by pointer.tenant_id,pointer.environment`,
      [APP_ID],
    );
    if (semanticResult.rowCount !== 1 || !semanticResult.rows[0]) {
      throw new TypeError("FALCON24_PUBLISHED_RELEASE_TARGET_AMBIGUOUS");
    }
    const current = semanticResult.rows[0];
    const desired = await buildFalcon24SemanticChangeSet({
      scope: {
        app_id: current.app_id,
        tenant_id: current.tenant_id,
        environment: current.environment,
        semantic_domain: "falcon24",
      },
      base_release: {
        release_id: current.release_id,
        generation: Number(current.release_generation),
        release_hash: current.release_hash,
      },
      revision: Number(current.release_generation) + 1,
    });
    const currentPayload = current.source_payload as {
      assertions?: readonly unknown[];
      competency_results?: unknown;
      validation?: unknown;
    };
    if (!Array.isArray(currentPayload.assertions)) {
      throw new TypeError("FALCON24_PUBLISHED_RELEASE_PAYLOAD_INVALID");
    }
    const semanticDifferences = await assertionDiff(
      desired.change_set.assertions,
      currentPayload.assertions,
    );
    const sourceAssetMaterial = {
      assertions: desired.change_set.assertions,
      competency_results: desired.change_set.competency_results,
      validation: desired.change_set.validation,
    };
    const databaseAssetMaterial = {
      assertions: currentPayload.assertions,
      competency_results: currentPayload.competency_results,
      validation: currentPayload.validation,
    };
    const modelRows = await client.query<{
      vendor_id: string;
      runtime_provider: string;
      display_name: string;
      base_url: string;
      model_id: string;
      capabilities: unknown;
      is_system_default: boolean;
    }>(
      `select connection.vendor_id,connection.runtime_provider,model.display_name,
              connection.base_url,model.model_id,model.capabilities,model.is_system_default
         from app_data_agent.model_catalog_entries as model
         join app_data_agent.model_provider_connections as connection
           on connection.app_id=model.app_id and connection.environment=model.environment
          and connection.provider_connection_id=model.provider_connection_id
        where model.app_id=$1::uuid and model.environment=$2::text
          and model.status='ACTIVE' and connection.status='ACTIVE'
          and model.model_id = any($3::text[])
        order by connection.vendor_id,model.model_id`,
      [current.app_id, current.environment, llmManifest.profiles.map(({ model_id }) => model_id)],
    );
    const observedProfiles = modelRows.rows.map((row) => ({
      logical_profile_key: `falcon24-analysis-${row.vendor_id}`,
      vendor_id: row.vendor_id,
      runtime_provider: row.runtime_provider,
      display_name: row.display_name,
      base_url: row.base_url,
      model_id: row.model_id,
      capabilities: normalizeCapabilities(row.capabilities),
      default: row.is_system_default,
    }));
    const llmDifferences = [] as string[];
    const expectedByKey = new Map(
      llmManifest.profiles.map((profile) => [profile.logical_profile_key, profile]),
    );
    const observedByKey = new Map(
      observedProfiles.map((profile) => [profile.logical_profile_key, profile]),
    );
    for (const key of [...new Set([...expectedByKey.keys(), ...observedByKey.keys()])].sort()) {
      const expected = expectedByKey.get(key);
      const observed = observedByKey.get(key);
      if (!expected) llmDifferences.push(`EXTRA_DATABASE_PROFILE:${key}`);
      else if (!observed) llmDifferences.push(`MISSING_DATABASE_PROFILE:${key}`);
      else if ((await sha256ContentHash(expected)) !== (await sha256ContentHash(observed))) {
        llmDifferences.push(`CONTENT_MISMATCH:${key}`);
      }
    }
    const llmDiffStatus =
      llmDifferences.length === 0
        ? "MATCH"
        : llmDifferences.every((difference) => difference.startsWith("MISSING_DATABASE_PROFILE:"))
          ? "RECREATE"
          : "HOLD";
    await client.query("commit");
    const semanticDiffHash = await sha256ContentHash(semanticDifferences);
    const llmDiffHash = await sha256ContentHash(llmDifferences);
    const output = {
      schema_version: "falcon24-retained-export@1.0.0",
      semantic: {
        source_bundle_hash: await sha256ContentHash(sourceAssetMaterial),
        database_export_hash: await sha256ContentHash(databaseAssetMaterial),
        expected_definition_count: desired.assertion_count,
        competency_closure_hash: await sha256ContentHash({
          competency_results: desired.change_set.competency_results,
          validation: desired.change_set.validation,
        }),
        diff: {
          status: semanticDifferences.length === 0 ? "MATCH" : "HOLD",
          diff_hash: semanticDiffHash,
          differences: semanticDifferences,
        },
      },
      llm: {
        observed_profiles: observedProfiles,
        diff: {
          status: llmDiffStatus,
          diff_hash: llmDiffHash,
          differences: llmDifferences,
        },
      },
      terminal: semanticDifferences.length === 0 && llmDiffStatus !== "HOLD" ? "READY" : "HOLD",
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(
      `${JSON.stringify({
        schema_version: output.schema_version,
        terminal: output.terminal,
        semantic_diff_count: semanticDifferences.length,
        llm_diff_count: llmDifferences.length,
        output: outputPath,
      })}\n`,
    );
    if (output.terminal !== "READY") process.exitCode = 2;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/u.test(error.message)
        ? error.message
        : "FALCON24_E1_RETAINED_EXPORT_FAILED";
    process.stderr.write(`${JSON.stringify({ terminal: "HOLD", reason_code: code })}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
