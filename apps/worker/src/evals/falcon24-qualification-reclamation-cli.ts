import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24SandboxReclamationReceipt,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  falcon24QualificationIdSchema,
  verifyFalcon24SandboxReclamationReceipt,
} from "@data-agent/contracts/evals";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24QualificationAuthority } from "@data-agent/platform/runs";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";
import { createEnvironmentOpenSandboxAnalysisRuntime } from "../runs/opensandbox-analysis-runtime.js";

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
    : "FALCON24_SANDBOX_RECLAMATION_FAILED";
}

async function main() {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  const databaseUrl =
    environment.DATA_AGENT_DATABASE_URL?.trim() ??
    environment.DATA_AGENT_JOB_DATABASE_URL?.trim() ??
    environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new TypeError("FALCON24_DATABASE_URL_MISSING");
  if (
    environment.DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY?.trim() !==
    FALCON24_STRICT_ACCEPTANCE_POLICY_ID
  ) {
    throw new TypeError("FALCON24_ACCEPTANCE_EXECUTION_POLICY_REQUIRED");
  }
  const scope = z
    .strictObject({ deployment_id: z.uuid(), tenant_id: z.uuid(), principal_id: z.uuid() })
    .parse({
      deployment_id: environment.WORKER_DEPLOYMENT_ID ?? environment.SEMANTIC_DEPLOYMENT_ID,
      tenant_id: environment.WORKER_TENANT_ID ?? environment.SEMANTIC_TENANT_ID,
      principal_id: environment.WORKER_PRINCIPAL_ID ?? environment.SEMANTIC_PRINCIPAL_ID,
    });
  const qualificationId = falcon24QualificationIdSchema.parse(argument("qualification-id"));
  const runId = z.uuid().parse(argument("run-id"));
  const forced = process.argv.includes("--forced");
  const token = z.uuid().parse(argument("claim-token") ?? randomUUID());
  const runtimeAttestationHash = await sha256ContentHash(
    JSON.parse(
      await readFile(
        resolve(
          root,
          argument("runtime-attestation") ?? "infra/docker/opensandbox-analysis-attestation.json",
        ),
        "utf8",
      ),
    ),
  );
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: "data-agent-falcon24-qualification-reclamation",
    max: 1,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
    const capability = requireValue(
      await capabilityAuthority.resolveForServerContext({ ...scope, access: "WRITE" }),
    );
    const qualificationAuthority = createPostgresFalcon24QualificationAuthority({
      pool: sqlPool,
      authorizer: capabilityAuthority.authorizer,
    });
    const identity = { qualification_id: qualificationId, run_id: runId } as const;
    if (forced) {
      requireValue(
        await qualificationAuthority.claimForcedCleanup(capability, {
          ...identity,
          forced_cleanup_token: token,
        }),
      );
      try {
        const runtime = createEnvironmentOpenSandboxAnalysisRuntime(environment, {
          max_file_transfer_attempts: 1,
        });
        if (!runtime) throw new TypeError("FALCON24_SANDBOX_RUNTIME_REQUIRED");
        const cleanup = await runtime.cleanupRun({ run_id: runId });
        if (cleanup.residual !== 0) {
          throw new TypeError("FALCON24_SANDBOX_RECLAMATION_INCOMPLETE");
        }
        const receipt = await buildFalcon24SandboxReclamationReceipt({
          schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0",
          campaign_id: qualificationId,
          run_id: runId,
          runtime_attestation_hash: runtimeAttestationHash,
          ...cleanup,
        });
        requireValue(
          await qualificationAuthority.resolveForcedCleanup(capability, {
            ...identity,
            forced_cleanup_token: token,
            receipt,
            secondary_failure_code: null,
          }),
        );
        process.stdout.write(
          `${JSON.stringify({ terminal: "FORCED_CLEANUP_COMPLETED", receipt }, null, 2)}\n`,
        );
        return;
      } catch (error) {
        const secondaryFailureCode = stableErrorCode(error);
        requireValue(
          await qualificationAuthority.resolveForcedCleanup(capability, {
            ...identity,
            forced_cleanup_token: token,
            receipt: null,
            secondary_failure_code: secondaryFailureCode,
          }),
        );
        throw error;
      }
    }

    const claimed = requireValue(
      await qualificationAuthority.claimSandboxReclamation(capability, {
        ...identity,
        reclamation_claim_token: token,
      }),
    );
    if (claimed.sandbox_reclamation_receipt) {
      const receipt = await verifyFalcon24SandboxReclamationReceipt(
        claimed.sandbox_reclamation_receipt,
      );
      process.stdout.write(
        `${JSON.stringify({ terminal: "RECLAMATION_REPLAYED", receipt }, null, 2)}\n`,
      );
      return;
    }
    const runtime = createEnvironmentOpenSandboxAnalysisRuntime(environment, {
      max_file_transfer_attempts: 1,
    });
    if (!runtime) throw new TypeError("FALCON24_SANDBOX_RUNTIME_REQUIRED");
    const cleanup = await runtime.cleanupRun({ run_id: runId });
    if (cleanup.residual !== 0) throw new TypeError("FALCON24_SANDBOX_RECLAMATION_INCOMPLETE");
    const receipt = await buildFalcon24SandboxReclamationReceipt({
      schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0",
      campaign_id: qualificationId,
      run_id: runId,
      runtime_attestation_hash: runtimeAttestationHash,
      ...cleanup,
    });
    requireValue(
      await qualificationAuthority.recordSandboxReclamation(capability, {
        ...identity,
        reclamation_claim_token: token,
        receipt,
      }),
    );
    process.stdout.write(
      `${JSON.stringify({ terminal: "RECLAMATION_COMPLETED", receipt }, null, 2)}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1]?.endsWith("falcon24-qualification-reclamation-cli.ts") ||
  process.argv[1]?.endsWith("falcon24-qualification-reclamation-cli.js")
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        terminal: "HOLD",
        failure_layer: "SANDBOX_RECLAMATION",
        reason_code: stableErrorCode(error),
      })}\n`,
    );
    process.exitCode = 2;
  });
}
