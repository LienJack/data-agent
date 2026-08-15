import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import {
  createModelProviderBindings,
  SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
} from "@data-agent/agent-runtime";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresRepository,
  createPostgresRunEventStore,
  createPostgresRunQueue,
} from "@data-agent/platform";
import nextEnvironment from "@next/env";
import { Pool } from "pg";
import { z } from "zod";
import { runCredentialedProviderCertification } from "./credentialed-provider-certification.js";
import { createPostgresModelCertificationReceiptStore } from "./postgres-model-certification-receipt-store.js";
import { createRunWorkerRunner } from "./runs/index.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000002";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000003";
const CONFIRMATION_VARIABLE = "DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_CONFIRM";

const configurationSchema = z.strictObject({
  databaseUrl: z.string().min(1),
  tenantId: z.uuid(),
  principalId: z.uuid(),
});

function repositoryRoot(): string {
  const cwd = resolve(process.cwd());
  return basename(cwd) === "worker" && basename(resolve(cwd, "..")) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
}

function loadRootEnvironment(): void {
  nextEnvironment.loadEnvConfig(repositoryRoot(), true);
  process.env.DEEPSEEK_API_KEY ||= process.env.DeepSeekAPIKey?.trim();
  process.env.MOONSHOT_API_KEY ||= process.env.KimiAPIKey?.trim();
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function deploymentHash(deploymentId: string): string {
  return `sha256:${createHash("sha256").update(`local-system-model:${deploymentId}`).digest("hex")}`;
}

async function resolveLocalDeployment(adminPool: Pool): Promise<string> {
  const existing = await adminPool.query<{ deployment_id: string }>(
    `select deployment_id
       from platform.deployment_mappings
      where app_id = $1::uuid and environment = 'local' and is_active
      order by created_at
      limit 1`,
    [APP_ID],
  );
  if (existing.rows[0]) return existing.rows[0].deployment_id;

  const deploymentId = randomUUID();
  await adminPool.query(
    `insert into platform.deployment_mappings (
       deployment_id, app_id, environment, deployment_key_hash
     ) values ($1::uuid, $2::uuid, 'local', $3::text)`,
    [deploymentId, APP_ID, deploymentHash(deploymentId)],
  );
  return deploymentId;
}

async function main(): Promise<void> {
  if (process.env[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    report({
      schema_version: "1.0.0",
      terminal: "NOT_RUN",
      reason_code: "EXPLICIT_CONFIRMATION_REQUIRED",
      confirmation_variable: CONFIRMATION_VARIABLE,
    });
    process.exitCode = 2;
    return;
  }
  if (process.env.NODE_ENV === "production") {
    report({ schema_version: "1.0.0", terminal: "HOLD", reason_code: "LOCAL_ONLY_COMMAND" });
    process.exitCode = 2;
    return;
  }

  loadRootEnvironment();
  const configuration = configurationSchema.safeParse({
    databaseUrl: process.env.DATA_AGENT_DATABASE_URL ?? process.env.DATABASE_URL,
    tenantId: process.env.TEST_CENTER_TENANT_ID ?? DEFAULT_TENANT_ID,
    principalId: process.env.TEST_CENTER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
  });
  if (
    !configuration.success ||
    !process.env.DEEPSEEK_API_KEY?.trim() ||
    !process.env.MOONSHOT_API_KEY?.trim()
  ) {
    report({
      schema_version: "1.0.0",
      terminal: "HOLD",
      reason_code: "SYSTEM_MODEL_CERTIFICATION_CONFIGURATION_INVALID",
    });
    process.exitCode = 64;
    return;
  }

  const adminPool = new Pool({
    connectionString: configuration.data.databaseUrl,
    max: 2,
    application_name: "data-agent-local-system-model-certification",
  });
  try {
    const deploymentId = await resolveLocalDeployment(adminPool);
    await adminPool.query(
      "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'owner')",
      [deploymentId, configuration.data.tenantId, configuration.data.principalId],
    );

    const sqlPool = adaptPgPool(adminPool);
    const authority = createPostgresCapabilityAuthority(sqlPool);
    const capabilityResult = await authority.resolveForServerContext({
      deployment_id: deploymentId,
      tenant_id: configuration.data.tenantId,
      principal_id: configuration.data.principalId,
      access: "WRITE",
    });
    if (!capabilityResult.ok) throw new Error(capabilityResult.error.code);
    const capability = capabilityResult.value;
    const repository = createPostgresRepository(sqlPool, authority.authorizer);
    const runId = randomUUID();
    const accepted = await repository.acceptCommand(capability, {
      run_id: runId,
      command_id: randomUUID(),
      event_id: randomUUID(),
      outbox_id: randomUUID(),
      audit_id: randomUUID(),
      idempotency_key: `system-model-certification-${randomUUID()}`,
      question: "对根目录 .env 的 DeepSeek 与 Kimi 系统模型执行真实凭证认证。",
      payload: { kind: "START_L2_RESEARCH", mode: "L2" },
    });
    if (!accepted.ok) throw new Error(accepted.error.code);

    const receiptStore = createPostgresModelCertificationReceiptStore({
      pool: sqlPool,
      authorizer: authority.authorizer,
      capability,
    });
    const selectedProviders = new Set(["deepseek", "kimi"]);
    const bindings = createModelProviderBindings(SYSTEM_MODEL_DEPLOYMENT_OVERRIDES).filter(
      (binding) => selectedProviders.has(binding.provider),
    );
    const reportHolder: {
      value?: Awaited<ReturnType<typeof runCredentialedProviderCertification>>;
    } = {};
    const runner = createRunWorkerRunner({
      queue: createPostgresRunQueue(sqlPool, authority.authorizer, capability, {
        lease_duration_ms: 900_000,
      }),
      event_store: createPostgresRunEventStore(sqlPool, authority.authorizer, capability),
      execution_timeout_ms: 900_000,
      heartbeat_interval_ms: 15_000,
      executor: {
        async execute({ lease }) {
          const certificationReport = await runCredentialedProviderCertification({
            scope: capability.scope,
            run_id: lease.run_id,
            worker_fence: lease.worker_fence,
            bindings,
            resolve_credential: async (credentialEnvironment) =>
              process.env[credentialEnvironment]?.trim() ?? null,
            receipt_store: receiptStore,
          });
          reportHolder.value = certificationReport;
          return certificationReport.terminal === "PASS"
            ? { kind: "COMPLETED" }
            : { kind: "FAILED", error_code: "MODEL_CERTIFICATION_HOLD" };
        },
      },
    });
    const cycle = await runner.runOnce({
      scope: capability.scope,
      worker_id: "local-system-model-certifier",
    });
    const certificationReport = reportHolder.value;
    report({
      schema_version: "1.0.0",
      terminal: certificationReport?.terminal ?? "HOLD",
      deployment_id: deploymentId,
      run_id: runId,
      cycle,
      certification: certificationReport,
    });
    process.exitCode = certificationReport?.terminal === "PASS" && cycle.ok ? 0 : 2;
  } catch {
    report({
      schema_version: "1.0.0",
      terminal: "HOLD",
      reason_code: "SYSTEM_MODEL_CERTIFICATION_EXECUTION_FAILED",
    });
    process.exitCode = 2;
  } finally {
    await adminPool.end().catch(() => undefined);
  }
}

await main();
