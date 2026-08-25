import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24SandboxReclamationReceipt,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  falcon24AcceptanceCampaignIdSchema,
} from "@data-agent/contracts/evals";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24AcceptanceCampaignAuthority } from "@data-agent/platform/runs";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";
import {
  createEnvironmentOpenSandboxAnalysisRuntime,
  type OpenSandboxAnalysisRuntime,
} from "../runs/opensandbox-analysis-runtime.js";

const runIdSchema = z.uuid();

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

export async function reclaimFalcon24RunSandboxes(input: {
  readonly runtime: Pick<OpenSandboxAnalysisRuntime, "cleanupRun">;
  readonly campaign_id: string;
  readonly run_id: string;
  readonly runtime_attestation_hash: `sha256:${string}`;
}) {
  const campaignId = falcon24AcceptanceCampaignIdSchema.parse(input.campaign_id);
  const runId = runIdSchema.parse(input.run_id);
  const cleanup = await input.runtime.cleanupRun({ run_id: runId });
  if (cleanup.residual !== 0) throw new TypeError("FALCON24_SANDBOX_RECLAMATION_INCOMPLETE");
  return buildFalcon24SandboxReclamationReceipt({
    schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0" as const,
    campaign_id: campaignId,
    run_id: runId,
    runtime_attestation_hash: input.runtime_attestation_hash,
    ...cleanup,
  });
}

async function main() {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  if (
    environment.DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY?.trim() !==
    FALCON24_STRICT_ACCEPTANCE_POLICY_ID
  ) {
    throw new TypeError("FALCON24_ACCEPTANCE_EXECUTION_POLICY_REQUIRED");
  }
  const databaseUrl =
    environment.DATA_AGENT_DATABASE_URL?.trim() ??
    environment.DATA_AGENT_JOB_DATABASE_URL?.trim() ??
    environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new TypeError("FALCON24_DATABASE_URL_MISSING");
  const scope = z
    .strictObject({ deployment_id: z.uuid(), tenant_id: z.uuid(), principal_id: z.uuid() })
    .parse({
      deployment_id: environment.WORKER_DEPLOYMENT_ID ?? environment.SEMANTIC_DEPLOYMENT_ID,
      tenant_id: environment.WORKER_TENANT_ID ?? environment.SEMANTIC_TENANT_ID,
      principal_id: environment.WORKER_PRINCIPAL_ID ?? environment.SEMANTIC_PRINCIPAL_ID,
    });
  const campaignId = falcon24AcceptanceCampaignIdSchema.parse(argument("campaign-id"));
  const runId = runIdSchema.parse(argument("run-id"));
  const attestationPath = resolve(
    root,
    argument("runtime-attestation") ?? "infra/docker/opensandbox-analysis-attestation.json",
  );
  const runtimeAttestationHash = await sha256ContentHash(
    JSON.parse(await readFile(attestationPath, "utf8")),
  );
  const runtime = createEnvironmentOpenSandboxAnalysisRuntime(environment, {
    max_file_transfer_attempts: 1,
  });
  if (!runtime) throw new TypeError("FALCON24_SANDBOX_RUNTIME_REQUIRED");
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: "data-agent-falcon24-sandbox-reclamation",
    max: 1,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
    const capability = requireValue(
      await capabilityAuthority.resolveForServerContext({ ...scope, access: "WRITE" }),
    );
    const campaignAuthority = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: sqlPool,
      authorizer: capabilityAuthority.authorizer,
    });
    const receipt = await reclaimFalcon24RunSandboxes({
      runtime,
      campaign_id: campaignId,
      run_id: runId,
      runtime_attestation_hash: runtimeAttestationHash,
    });
    requireValue(
      await campaignAuthority.recordSandboxReclamation(capability, {
        campaign_id: campaignId,
        run_id: runId,
        receipt,
      }),
    );
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1]?.endsWith("falcon24-sandbox-reclamation-cli.ts") ||
  process.argv[1]?.endsWith("falcon24-sandbox-reclamation-cli.js")
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        terminal: "HOLD",
        failure_layer: "SANDBOX_RECLAMATION",
        reason_code:
          error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)
            ? error.message
            : "FALCON24_SANDBOX_RECLAMATION_FAILED",
      })}\n`,
    );
    process.exitCode = 2;
  });
}
