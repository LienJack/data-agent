import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  qualificationIdForEpoch,
} from "@data-agent/contracts/evals";
import { falcon24AuthorityEpochOrdinal } from "@data-agent/contracts/runs";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24DiagnosticAuthority } from "@data-agent/platform/runs";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";
import { createEnvironmentOpenSandboxAnalysisRuntime } from "../runs/opensandbox-analysis-runtime.js";
import { reclaimFalcon24RunSandboxes } from "./falcon24-sandbox-reclamation-cli.js";

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

function stableErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : null;
  return typeof candidate === "string" && /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate)
    ? candidate
    : "FALCON24_DIAGNOSTIC_RECLAMATION_FAILED";
}

async function main(): Promise<void> {
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
  const attemptId = z.uuid().parse(argument("attempt-id"));
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: "data-agent-falcon24-diagnostic-reclamation",
    max: 1,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
    const capability = requireValue(
      await capabilityAuthority.resolveForServerContext({ ...scope, access: "WRITE" }),
    );
    const diagnosticAuthority = createPostgresFalcon24DiagnosticAuthority({
      pool: sqlPool,
      authorizer: capabilityAuthority.authorizer,
    });
    const attempt = requireValue(await diagnosticAuthority.load(capability, attemptId));
    if (
      attempt?.status !== "ACTIVE" ||
      falcon24AuthorityEpochOrdinal(attempt.authority_epoch) < 4n
    ) {
      throw new TypeError("FALCON24_DIAGNOSTIC_ATTEMPT_NOT_ACTIVE");
    }
    const attestationPath = resolve(
      root,
      argument("runtime-attestation") ?? "infra/docker/opensandbox-analysis-attestation.json",
    );
    const runtimeAttestationHash = await sha256ContentHash(
      JSON.parse(await readFile(attestationPath, "utf8")),
    );
    if (runtimeAttestationHash !== attempt.runtime_attestation_hash) {
      throw new TypeError("FALCON24_DIAGNOSTIC_RUNTIME_ATTESTATION_MISMATCH");
    }
    const outcome = await reclaimFalcon24RunSandboxes({
      runtime: () => {
        const runtime = createEnvironmentOpenSandboxAnalysisRuntime(environment, {
          max_file_transfer_attempts: 1,
        });
        if (!runtime) throw new TypeError("FALCON24_SANDBOX_RUNTIME_REQUIRED");
        return runtime;
      },
      claim: async () => ({ disposition: "CLAIMED" as const, receipt: null }),
      campaign_id: qualificationIdForEpoch(attempt.authority_epoch),
      run_id: attempt.run_id,
      runtime_attestation_hash: runtimeAttestationHash,
    });
    const output = z.string().min(1).parse(argument("output"));
    const outputPath = resolve(root, output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(outcome.receipt, null, 2)}\n`, "utf8");
    process.stdout.write(
      `${JSON.stringify({ terminal: "RECLAIMED", attempt_id: attemptId, run_id: attempt.run_id, output_path: outputPath })}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1]?.endsWith("falcon24-diagnostic-reclamation-cli.ts") ||
  process.argv[1]?.endsWith("falcon24-diagnostic-reclamation-cli.js")
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ terminal: "HOLD", reason_code: stableErrorCode(error) })}\n`,
    );
    process.exitCode = 2;
  });
}
