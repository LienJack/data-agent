import { createHash, randomUUID } from "node:crypto";
import { adaptPgPool, createPostgresCapabilityAuthority } from "@data-agent/platform";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import { Pool } from "pg";
import { z } from "zod";
import { runCredentialedProviderCertification } from "./credentialed-provider-certification.js";
import { createPostgresModelCertificationReceiptStore } from "./postgres-model-certification-receipt-store.js";
import { loadSystemModelExecutionBindings } from "./system-model-execution-bindings.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000002";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000003";
const CONFIRMATION_VARIABLE = "DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_CONFIRM";

const configurationSchema = z.strictObject({
  databaseUrl: z.string().min(1),
  tenantId: z.uuid(),
  principalId: z.uuid(),
  certificationRunId: z.uuid(),
  certificationWorkerFence: z.coerce.number().int().nonnegative().safe(),
});

function loadRootEnvironment(): void {
  loadRuntimeEnvironment();
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
    certificationRunId: process.env.DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_RUN_ID,
    certificationWorkerFence: process.env.DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_WORKER_FENCE,
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
      required_authority_variables: [
        "DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_RUN_ID",
        "DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_WORKER_FENCE",
      ],
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
    const existingMembership = await adminPool.query<{ exists: boolean }>(
      `select exists (
         select 1
           from app_data_agent.memberships
          where app_id = $1::uuid
            and tenant_id = $2::uuid
            and environment = 'local'
            and principal_id = $3::uuid
            and revoked_at is null
       ) as exists`,
      [APP_ID, configuration.data.tenantId, configuration.data.principalId],
    );
    if (!existingMembership.rows[0]?.exists) {
      await adminPool.query(
        "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'owner')",
        [deploymentId, configuration.data.tenantId, configuration.data.principalId],
      );
    }

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
    const receiptStore = createPostgresModelCertificationReceiptStore({
      pool: sqlPool,
      authorizer: authority.authorizer,
      capability,
    });
    const bindings = await loadSystemModelExecutionBindings(adminPool, deploymentId);
    const certificationReport = await runCredentialedProviderCertification({
      scope: capability.scope,
      run_id: configuration.data.certificationRunId,
      worker_fence: configuration.data.certificationWorkerFence,
      bindings,
      resolve_credential: async (credentialEnvironment) =>
        process.env[credentialEnvironment]?.trim() ?? null,
      receipt_store: receiptStore,
    });
    report({
      schema_version: "1.0.0",
      terminal: certificationReport.terminal,
      deployment_id: deploymentId,
      run_id: configuration.data.certificationRunId,
      certification: certificationReport,
    });
    process.exitCode = certificationReport.terminal === "PASS" ? 0 : 2;
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
