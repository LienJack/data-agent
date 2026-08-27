import { pathToFileURL } from "node:url";
import { loadRuntimeBuildIdentity } from "@data-agent/contracts/server";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresSemanticSuccessorSmokeAuthority } from "@data-agent/platform/semantic-postgres";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";
import { createSemanticSuccessorStageSmoke } from "./semantic-successor-stage-smoke.js";

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u),
  stage_id: z.uuid(),
  idempotency_key: z.string().trim().min(1).max(256),
});

function parseConfiguration(environment: NodeJS.ProcessEnv) {
  return configurationSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.SEMANTIC_DEPLOYMENT_ID ?? environment.WORKER_DEPLOYMENT_ID,
    tenant_id: environment.SEMANTIC_TENANT_ID ?? environment.WORKER_TENANT_ID,
    principal_id: environment.SEMANTIC_PRINCIPAL_ID ?? environment.WORKER_PRINCIPAL_ID,
    semantic_domain: environment.SEMANTIC_SUCCESSOR_DOMAIN,
    stage_id: environment.SEMANTIC_SUCCESSOR_STAGE_ID,
    idempotency_key: environment.SEMANTIC_SUCCESSOR_SMOKE_IDEMPOTENCY_KEY,
  });
}

export async function runSemanticSuccessorStageSmokeProcess(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const buildIdentity = loadRuntimeBuildIdentity({ expectedRole: "worker", environment });
  const configuration = parseConfiguration(environment);
  const pool = new pg.Pool({
    connectionString: configuration.database_url,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
    idle_in_transaction_session_timeout: 15_000,
    application_name: "data-agent-semantic-successor-stage-smoke",
  });
  const sqlPool = adaptPgPool(pool);
  const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
  try {
    const resolved = await capabilityAuthority.resolveForServerContext({
      deployment_id: configuration.deployment_id,
      tenant_id: configuration.tenant_id,
      principal_id: configuration.principal_id,
      access: "WRITE",
    });
    if (!resolved.ok) throw new Error(resolved.error.code);
    const smoke = createSemanticSuccessorStageSmoke(
      createPostgresSemanticSuccessorSmokeAuthority({
        pool: sqlPool,
        authorizer: capabilityAuthority.authorizer,
      }),
    );
    const result = await smoke.run({
      capability: resolved.value,
      semantic_domain: configuration.semantic_domain,
      stage_id: configuration.stage_id,
      idempotency_key: configuration.idempotency_key,
      worker_build_identity: buildIdentity,
    });
    if (!result.ok) throw new Error(result.error.code);
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSemanticSuccessorStageSmokeProcess().catch((error) => {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)
        ? error.message
        : "SEMANTIC_SUCCESSOR_STAGE_SMOKE_FAILED";
    process.stderr.write(
      `${JSON.stringify({ event: "semantic_successor_stage_smoke_failed", code })}\n`,
    );
    process.exitCode = 1;
  });
}
