import { fileURLToPath } from "node:url";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24AuthorityEpoch } from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_ACTIVATION_HOLD";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  workspace_id: z.uuid(),
  principal_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  authority_epoch: z.literal("E4"),
  attempt_id: z.uuid(),
  baseline_id: z.uuid(),
  expected_baseline_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/u),
});

function required<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function stableFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message) ? message : "FALCON24_ACTIVATION_HOLD_FAILED";
}

export async function runFalcon24AuthorityActivationHold(
  environment: NodeJS.ProcessEnv = loadRuntimeEnvironment().environment,
) {
  if (environment[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    return Object.freeze({
      schema_version: "falcon24-authority-activation-hold-result@1.0.0" as const,
      terminal: "NOT_RUN" as const,
      reason_code: "FALCON24_ACTIVATION_HOLD_CONFIRMATION_REQUIRED" as const,
    });
  }
  const configuration = configurationSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.WORKER_DEPLOYMENT_ID ?? DEFAULT_DEPLOYMENT_ID,
    workspace_id: environment.WORKER_TENANT_ID ?? DEFAULT_WORKSPACE_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    environment: environment.FALCON24_ENVIRONMENT ?? "local",
    authority_epoch: environment.FALCON24_AUTHORITY_EPOCH ?? "E4",
    attempt_id: environment.FALCON24_ACTIVATION_ATTEMPT_ID,
    baseline_id: environment.FALCON24_ACTIVATION_BASELINE_ID,
    expected_baseline_hash: environment.FALCON24_ACTIVATION_EXPECTED_BASELINE_HASH,
    failure_code: environment.FALCON24_ACTIVATION_FAILURE_CODE,
  });
  const pool = new pg.Pool({
    connectionString: configuration.database_url,
    application_name: "data-agent-falcon24-authority-activation-hold",
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 120_000,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const authority = createPostgresCapabilityAuthority(sqlPool);
    const capability = required(
      await authority.resolveForServerContext({
        deployment_id: configuration.deployment_id,
        tenant_id: configuration.workspace_id,
        principal_id: configuration.principal_id,
        access: "WRITE",
      }),
    );
    if (
      capability.scope.app_id !== APP_ID ||
      capability.scope.tenant_id !== configuration.workspace_id ||
      capability.scope.environment !== configuration.environment
    ) {
      throw new TypeError("FALCON24_ACTIVATION_HOLD_SCOPE_MISMATCH");
    }
    const epoch = createPostgresFalcon24AuthorityEpoch({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    const current = required(await epoch.loadCurrent(capability));
    if (current?.authority_epoch !== "E3") {
      throw new TypeError("FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR");
    }
    const held = required(
      await epoch.holdActivationAttempt(capability, {
        schema_version: "falcon24-activation-request@2.0.0",
        authority_epoch: configuration.authority_epoch,
        attempt_id: configuration.attempt_id,
        baseline_id: configuration.baseline_id,
        expected_baseline_hash: configuration.expected_baseline_hash,
        failure_code: configuration.failure_code,
      }),
    );
    return Object.freeze({
      schema_version: "falcon24-authority-activation-hold-result@1.0.0" as const,
      terminal: "HELD" as const,
      predecessor_authority: current,
      activation_attempt: held,
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const environment = loadRuntimeEnvironment({
      cwd: REPOSITORY_ROOT,
      environment: process.env,
    }).environment;
    Object.assign(process.env, environment);
    const result = await runFalcon24AuthorityActivationHold(environment);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.terminal === "NOT_RUN") process.exitCode = 2;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "falcon24-authority-activation-hold-result@1.0.0",
        terminal: "FAILED",
        reason_code: stableFailureCode(error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("hold-falcon24-authority-activation.ts") ||
  process.argv[1]?.endsWith("hold-falcon24-authority-activation.js")
) {
  await main();
}
