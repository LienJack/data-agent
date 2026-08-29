import { fileURLToPath } from "node:url";
import { falcon24FinalizationFailureReceiptSchema } from "@data-agent/contracts/runs";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24AuthorityEpoch } from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_FINALIZATION_FAILURE_RECORD";
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
  receipt_id: z.uuid(),
  idempotency_key: z.string().trim().min(1).max(256),
  predecessor_stage_id: z.uuid(),
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
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
    ? message
    : "FALCON24_FINALIZATION_FAILURE_RECORD_FAILED";
}

export async function runFalcon24FinalizationFailureRecord(
  environment: NodeJS.ProcessEnv = loadRuntimeEnvironment().environment,
) {
  if (environment[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    return Object.freeze({
      schema_version: "falcon24-finalization-failure-record-result@1.0.0" as const,
      terminal: "NOT_RUN" as const,
      reason_code: "FALCON24_FINALIZATION_FAILURE_CONFIRMATION_REQUIRED" as const,
    });
  }
  const configuration = configurationSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.WORKER_DEPLOYMENT_ID ?? DEFAULT_DEPLOYMENT_ID,
    workspace_id: environment.WORKER_TENANT_ID ?? DEFAULT_WORKSPACE_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    environment: environment.FALCON24_ENVIRONMENT ?? "local",
    receipt_id: environment.FALCON24_FINALIZATION_FAILURE_RECEIPT_ID,
    idempotency_key: environment.FALCON24_FINALIZATION_FAILURE_IDEMPOTENCY_KEY,
    predecessor_stage_id: environment.FALCON24_PREDECESSOR_LLM_EXECUTION_STAGE_ID,
  });
  if (configuration.environment === "prod" || configuration.environment === "production") {
    throw new TypeError("FALCON24_FINALIZATION_FAILURE_LOCAL_ONLY");
  }
  const pool = new pg.Pool({
    connectionString: configuration.database_url,
    application_name: "data-agent-falcon24-finalization-failure-record",
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
      throw new TypeError("FALCON24_FINALIZATION_FAILURE_SCOPE_MISMATCH");
    }
    const epoch = createPostgresFalcon24AuthorityEpoch({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    const current = required(await epoch.loadCurrent(capability));
    if (current?.authority_epoch !== "E9") {
      throw new TypeError("FALCON24_FINALIZATION_FAILURE_CURRENT_MISMATCH");
    }
    const stage = required(
      await epoch.loadLlmExecutionStage(capability, {
        stage_id: configuration.predecessor_stage_id,
      }),
    );
    const proof = stage.proof_document;
    if (
      stage.status !== "PROMOTED" ||
      stage.activation_attempt_id !== current.activation_attempt_id ||
      proof.target_authority_epoch !== "E9" ||
      proof.stage_id !== configuration.predecessor_stage_id ||
      proof.scope.app_id !== capability.scope.app_id ||
      proof.scope.tenant_id !== capability.scope.tenant_id ||
      proof.scope.environment !== capability.scope.environment
    ) {
      throw new TypeError("FALCON24_FINALIZATION_FAILURE_STAGE_MISMATCH");
    }
    const receipt = falcon24FinalizationFailureReceiptSchema.parse(
      required(
        await epoch.recordFinalizationFailure(capability, {
          receipt_id: configuration.receipt_id,
          idempotency_key: configuration.idempotency_key,
          expected_authority: current,
          stage_ref: { stage_id: proof.stage_id, proof_hash: proof.proof_hash },
        }),
      ),
    );
    if (
      receipt.receipt_id !== configuration.receipt_id ||
      receipt.authority.authority_epoch !== current.authority_epoch ||
      receipt.authority.baseline_id !== current.baseline_id ||
      receipt.authority.baseline_hash !== current.baseline_hash ||
      receipt.authority.activation_attempt_id !== current.activation_attempt_id ||
      receipt.stage_ref.stage_id !== proof.stage_id ||
      receipt.stage_ref.proof_hash !== proof.proof_hash ||
      receipt.observed_sqlstate !== "42702"
    ) {
      throw new TypeError("FALCON24_FINALIZATION_FAILURE_RECEIPT_MISMATCH");
    }
    return Object.freeze({
      schema_version: "falcon24-finalization-failure-record-result@1.0.0" as const,
      terminal: "RECORDED" as const,
      predecessor_authority: current,
      receipt,
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  let environment: NodeJS.ProcessEnv = process.env;
  try {
    environment = loadRuntimeEnvironment({
      cwd: REPOSITORY_ROOT,
      environment: process.env,
    }).environment;
    Object.assign(process.env, environment);
    const result = await runFalcon24FinalizationFailureRecord(environment);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.terminal === "NOT_RUN") process.exitCode = 2;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "falcon24-finalization-failure-record-result@1.0.0",
        terminal: "FAILED",
        reason_code: stableFailureCode(error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("record-falcon24-finalization-failure.ts") ||
  process.argv[1]?.endsWith("record-falcon24-finalization-failure.js")
) {
  await main();
}
