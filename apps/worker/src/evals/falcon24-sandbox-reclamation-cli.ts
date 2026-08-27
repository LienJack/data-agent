import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  authorityEpochForFalcon24Gate,
  buildFalcon24SandboxReclamationReceipt,
  buildFalcon24SandboxReclamationReceiptV2,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  falcon24AcceptanceCampaignIdSchema,
  type falcon24SandboxReclamationReceiptDocumentSchema,
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

function stableErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : null;
  return typeof candidate === "string" && /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate)
    ? candidate
    : "FALCON24_SANDBOX_RECLAMATION_FAILED";
}

type CampaignHoldResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string } };

export class Falcon24ReclamationHoldDiagnosticError extends Error {
  override readonly name = "Falcon24ReclamationHoldDiagnosticError";
  readonly code: string;
  readonly hold_failure_code: string;

  constructor(originalError: unknown, holdError: unknown) {
    const originalCode = stableErrorCode(originalError);
    super(originalCode, { cause: originalError });
    this.code = originalCode;
    this.hold_failure_code = stableErrorCode(holdError);
  }
}

export async function holdReclamationAfterFailure(input: {
  readonly originalError: unknown;
  readonly hold: () => Promise<CampaignHoldResult>;
}): Promise<never> {
  if (
    new Set([
      "FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED",
      "FALCON24_SANDBOX_RECLAMATION_OUTCOME_UNKNOWN",
    ]).has(stableErrorCode(input.originalError))
  ) {
    throw input.originalError;
  }
  let result: CampaignHoldResult;
  try {
    result = await input.hold();
  } catch (holdError) {
    throw new Falcon24ReclamationHoldDiagnosticError(input.originalError, holdError);
  }
  if (!result.ok && result.error.code !== "FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH") {
    throw new Falcon24ReclamationHoldDiagnosticError(input.originalError, result.error);
  }
  throw input.originalError;
}

export async function reclaimFalcon24RunSandboxes(input: {
  readonly runtime: () => Pick<OpenSandboxAnalysisRuntime, "cleanupRun">;
  readonly claim: () => Promise<
    | { readonly disposition: "CLAIMED"; readonly receipt: null }
    | {
        readonly disposition: "COMPLETED";
        readonly receipt: z.infer<typeof falcon24SandboxReclamationReceiptDocumentSchema>;
      }
  >;
  readonly campaign_id: string;
  readonly run_id: string;
  readonly runtime_attestation_hash: `sha256:${string}`;
}) {
  const campaignId = falcon24AcceptanceCampaignIdSchema.parse(input.campaign_id);
  const authorityEpoch = authorityEpochForFalcon24Gate(campaignId);
  const runId = runIdSchema.parse(input.run_id);
  const claim = await input.claim();
  if (claim.disposition === "COMPLETED") {
    return { disposition: "COMPLETED" as const, receipt: claim.receipt };
  }
  const cleanup = await input.runtime().cleanupRun({ run_id: runId });
  if (cleanup.residual !== 0) throw new TypeError("FALCON24_SANDBOX_RECLAMATION_INCOMPLETE");
  const material = {
    campaign_id: campaignId,
    run_id: runId,
    runtime_attestation_hash: input.runtime_attestation_hash,
    ...cleanup,
  };
  const receipt =
    authorityEpoch === "E1"
      ? await buildFalcon24SandboxReclamationReceipt({
          schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0" as const,
          ...material,
        })
      : await buildFalcon24SandboxReclamationReceiptV2({
          schema_version: "falcon24-sandbox-reclamation-receipt@3.0.0" as const,
          authority_epoch: authorityEpoch,
          ...material,
        });
  return { disposition: "CLAIMED" as const, receipt };
}

async function main() {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
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
  const reclamationRecoveryToken = runIdSchema.parse(argument("recovery-token") ?? runId);
  const reclamationClaimToken = runIdSchema.parse(argument("claim-token") ?? randomUUID());
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
    try {
      if (
        environment.DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY?.trim() !==
        FALCON24_STRICT_ACCEPTANCE_POLICY_ID
      ) {
        throw new TypeError("FALCON24_ACCEPTANCE_EXECUTION_POLICY_REQUIRED");
      }
      const attestationPath = resolve(
        root,
        argument("runtime-attestation") ?? "infra/docker/opensandbox-analysis-attestation.json",
      );
      const runtimeAttestationHash = await sha256ContentHash(
        JSON.parse(await readFile(attestationPath, "utf8")),
      );
      const outcome = await reclaimFalcon24RunSandboxes({
        runtime: () => {
          const runtime = createEnvironmentOpenSandboxAnalysisRuntime(environment, {
            max_file_transfer_attempts: 1,
          });
          if (!runtime) throw new TypeError("FALCON24_SANDBOX_RUNTIME_REQUIRED");
          return runtime;
        },
        claim: async () => {
          return requireValue(
            await campaignAuthority.claimSandboxReclamation(capability, {
              campaign_id: campaignId,
              run_id: runId,
              runtime_attestation_hash: runtimeAttestationHash,
              reclamation_recovery_token: reclamationRecoveryToken,
              reclamation_claim_token: reclamationClaimToken,
            }),
          );
        },
        campaign_id: campaignId,
        run_id: runId,
        runtime_attestation_hash: runtimeAttestationHash,
      });
      if (outcome.disposition === "CLAIMED") {
        requireValue(
          await campaignAuthority.recordSandboxReclamation(capability, {
            campaign_id: campaignId,
            run_id: runId,
            reclamation_claim_token: reclamationClaimToken,
            receipt: outcome.receipt,
          }),
        );
      }
      process.stdout.write(`${JSON.stringify(outcome.receipt, null, 2)}\n`);
    } catch (error) {
      await holdReclamationAfterFailure({
        originalError: error,
        hold: () =>
          campaignAuthority.hold(capability, {
            campaign_id: campaignId,
            run_id: runId,
            failure_layer: "SANDBOX_RECLAMATION",
            failure_code: stableErrorCode(error),
          }),
      });
    }
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1]?.endsWith("falcon24-sandbox-reclamation-cli.ts") ||
  process.argv[1]?.endsWith("falcon24-sandbox-reclamation-cli.js")
) {
  void main().catch((error: unknown) => {
    const reasonCode =
      error instanceof Falcon24ReclamationHoldDiagnosticError ? error.code : stableErrorCode(error);
    process.stderr.write(
      `${JSON.stringify({
        terminal: new Set([
          "FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED",
          "FALCON24_SANDBOX_RECLAMATION_OUTCOME_UNKNOWN",
        ]).has(reasonCode)
          ? "CONFLICT"
          : "HOLD",
        failure_layer: "SANDBOX_RECLAMATION",
        reason_code: reasonCode,
        hold_failure_code:
          error instanceof Falcon24ReclamationHoldDiagnosticError ? error.hold_failure_code : null,
      })}\n`,
    );
    process.exitCode = 2;
  });
}
