import { createModelProviderBindings } from "@data-agent/agent-runtime";
import {
  type AppScope,
  MODEL_PROVIDERS,
  type ModelProvider,
  modelOperationalConstraintsSchema,
  modelProviderSchema,
} from "@data-agent/contracts";
import { adaptPgPool, createPostgresCapabilityAuthority } from "@data-agent/platform";
import { Pool } from "pg";
import { z } from "zod";
import { runCredentialedProviderCertification } from "./credentialed-provider-certification.js";
import { createPostgresModelCertificationReceiptStore } from "./postgres-model-certification-receipt-store.js";

const confirmationVariable = "DATA_AGENT_CREDENTIAL_SMOKE_CONFIRM";

const confirmedEnvironmentSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
  run_id: z.uuid(),
  worker_fence: z.coerce.number().int().nonnegative().safe(),
  providers: z.array(modelProviderSchema).min(2).max(MODEL_PROVIDERS.length),
  overrides: z
    .array(
      z.strictObject({
        provider: modelProviderSchema,
        model_id: z.string().min(1).max(256),
        operational_constraints: modelOperationalConstraintsSchema.optional(),
      }),
    )
    .min(2)
    .max(MODEL_PROVIDERS.length),
});

function writeReport(report: unknown): void {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function holdReport(reasonCode: string) {
  return {
    schema_version: "1.0.0",
    report_type: "CredentialedProviderCertificationReport",
    execution_mode: "EXPLICIT_CREDENTIALED_SMOKE",
    terminal: "HOLD",
    reason_code: reasonCode,
    providers: [],
  } as const;
}

function parseProviderList(input: string | undefined): readonly ModelProvider[] {
  const values = (input ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (new Set(values).size !== values.length) {
    throw new Error("duplicate provider");
  }
  return z.array(modelProviderSchema).parse(values);
}

function parseOverrides(input: string | undefined): unknown {
  if (!input) {
    throw new Error("missing overrides");
  }
  return JSON.parse(input);
}

async function main(): Promise<void> {
  if (process.env[confirmationVariable]?.trim() !== "YES") {
    writeReport({
      schema_version: "1.0.0",
      report_type: "CredentialedProviderCertificationReport",
      execution_mode: "EXPLICIT_CREDENTIALED_SMOKE",
      terminal: "NOT_RUN",
      reason_code: "EXPLICIT_CONFIRMATION_REQUIRED",
      confirmation_variable: confirmationVariable,
      providers: [],
    });
    process.exitCode = 2;
    return;
  }

  let configuration: z.infer<typeof confirmedEnvironmentSchema>;
  try {
    configuration = confirmedEnvironmentSchema.parse({
      database_url: process.env.DATA_AGENT_DATABASE_URL,
      deployment_id: process.env.DATA_AGENT_DEPLOYMENT_ID,
      tenant_id: process.env.DATA_AGENT_TENANT_ID,
      principal_id: process.env.DATA_AGENT_PRINCIPAL_ID,
      run_id: process.env.DATA_AGENT_RUN_ID,
      worker_fence: process.env.DATA_AGENT_WORKER_FENCE,
      providers: parseProviderList(process.env.DATA_AGENT_CREDENTIAL_SMOKE_PROVIDERS),
      overrides: parseOverrides(process.env.DATA_AGENT_MODEL_PROVIDER_OVERRIDES),
    });
    const overrideProviders = new Set(configuration.overrides.map(({ provider }) => provider));
    if (
      overrideProviders.size !== configuration.overrides.length ||
      configuration.providers.some((provider) => !overrideProviders.has(provider))
    ) {
      throw new Error("selected provider override missing");
    }
  } catch {
    writeReport(holdReport("CREDENTIAL_SMOKE_CONFIGURATION_INVALID"));
    process.exitCode = 64;
    return;
  }

  const pool = new Pool({
    connectionString: configuration.database_url,
    max: 2,
    application_name: "data-agent-credentialed-provider-smoke",
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
    const capabilityResult = await capabilityAuthority.resolveForServerContext({
      deployment_id: configuration.deployment_id,
      tenant_id: configuration.tenant_id,
      principal_id: configuration.principal_id,
      access: "WRITE",
    });
    if (!capabilityResult.ok) {
      writeReport(holdReport("MODEL_CERTIFICATION_WRITE_CAPABILITY_DENIED"));
      process.exitCode = 2;
      return;
    }

    const capability = capabilityResult.value;
    const receiptStore = createPostgresModelCertificationReceiptStore({
      pool: sqlPool,
      authorizer: capabilityAuthority.authorizer,
      capability,
    });
    const selectedProviders = new Set(configuration.providers);
    const bindings = createModelProviderBindings(configuration.overrides).filter(({ provider }) =>
      selectedProviders.has(provider),
    );
    const scope: AppScope = capability.scope;
    const report = await runCredentialedProviderCertification({
      scope,
      run_id: configuration.run_id,
      worker_fence: configuration.worker_fence,
      bindings,
      resolve_credential: async (credentialEnvironment) => {
        const value = process.env[credentialEnvironment]?.trim();
        return value && value.length > 0 ? value : null;
      },
      receipt_store: receiptStore,
    });
    writeReport(report);
    process.exitCode = report.terminal === "PASS" ? 0 : 2;
  } catch {
    writeReport(holdReport("CREDENTIAL_SMOKE_EXECUTION_FAILED"));
    process.exitCode = 2;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
