import { pathToFileURL } from "node:url";
import {
  type PortResult,
  recoverStaleProviderInvocationMarkerResultSchema,
} from "@data-agent/contracts";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresProviderStaleMarkerRecoveryJob,
} from "@data-agent/platform";
import nextEnvironment from "@next/env";
import pg from "pg";
import { z } from "zod";
import { resolveRunWorkerRepositoryRoot } from "./run-worker-environment.js";

const { Pool } = pg;

export interface ProviderStaleMarkerRecoveryJobPort {
  recoverNext(): Promise<PortResult<unknown | null>>;
  discoverNextUnknown?(): Promise<PortResult<unknown | null>>;
}

export interface ProviderStaleMarkerRecoveryConnection {
  readonly job: ProviderStaleMarkerRecoveryJobPort;
  close(): Promise<void>;
}

export type ProviderStaleMarkerRecoveryConnectionFactory = (
  databaseUrl: string,
  authority: ProviderRecoveryJobAuthorityInput,
) => Promise<ProviderStaleMarkerRecoveryConnection>;

export interface ProviderRecoveryJobAuthorityInput {
  readonly deployment_id: string;
  readonly tenant_id: string;
  readonly principal_id: string;
}

const providerRecoveryJobAuthorityInputSchema = z.strictObject({
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
});

export function parseProviderRecoveryJobAuthority(
  environment: NodeJS.ProcessEnv,
): ProviderRecoveryJobAuthorityInput | null {
  const parsed = providerRecoveryJobAuthorityInputSchema.safeParse({
    deployment_id: environment.DATA_AGENT_JOB_DEPLOYMENT_ID,
    tenant_id: environment.DATA_AGENT_JOB_TENANT_ID,
    principal_id: environment.DATA_AGENT_JOB_PRINCIPAL_ID,
  });
  return parsed.success ? parsed.data : null;
}

export type ProviderStaleMarkerRecoveryReporter = (
  record: Readonly<Record<string, unknown>>,
) => void;

export type ProviderStaleMarkerRecoveryEnvironmentLoader = (
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => NodeJS.ProcessEnv;

export function loadProviderRecoveryEnvironment(
  environment: NodeJS.ProcessEnv,
  cwd: string,
): NodeJS.ProcessEnv {
  if (environment === process.env) {
    nextEnvironment.loadEnvConfig(
      resolveRunWorkerRepositoryRoot(cwd),
      process.env.NODE_ENV !== "production",
    );
  }
  return environment;
}

export async function createProviderRecoveryJobConnection(
  databaseUrl: string,
  authorityInput: ProviderRecoveryJobAuthorityInput,
): Promise<ProviderStaleMarkerRecoveryConnection> {
  const pool = new Pool({ connectionString: databaseUrl });
  const sqlPool = adaptPgPool(pool);
  const authority = createPostgresCapabilityAuthority(sqlPool);
  const resolved = await authority.resolveForServerContext({
    ...authorityInput,
    access: "WRITE",
  });
  if (!resolved.ok) {
    await pool.end();
    throw new Error(resolved.error.code);
  }
  return {
    job: createPostgresProviderStaleMarkerRecoveryJob({
      pool: sqlPool,
      authorizer: authority.authorizer,
      capability: resolved.value,
    }),
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * Processes at most one stale marker using the dedicated PostgreSQL job role.
 * The confirmation gate runs before dotenv loading or database construction.
 */
export async function runProviderStaleMarkerRecoveryProcess(
  environment: NodeJS.ProcessEnv = process.env,
  connect: ProviderStaleMarkerRecoveryConnectionFactory = createProviderRecoveryJobConnection,
  report: ProviderStaleMarkerRecoveryReporter = (record) => console.log(JSON.stringify(record)),
  loadEnvironment: ProviderStaleMarkerRecoveryEnvironmentLoader = loadProviderRecoveryEnvironment,
  cwd = process.cwd(),
): Promise<"NOT_CONFIRMED" | "CONFIG_INVALID" | "IDLE" | "RECOVERED"> {
  if (environment.DATA_AGENT_U3_PROVIDER_RECOVERY_CONFIRM !== "YES") {
    return "NOT_CONFIRMED";
  }

  const loaded = loadEnvironment(environment, cwd);
  const databaseUrl = loaded.DATA_AGENT_JOB_DATABASE_URL?.trim();
  const authority = parseProviderRecoveryJobAuthority(loaded);
  if (!databaseUrl || !authority) return "CONFIG_INVALID";

  const connection = await connect(databaseUrl, authority);
  try {
    const recovered = await connection.job.recoverNext();
    if (!recovered.ok) throw new Error(recovered.error.code);
    if (recovered.value === null) {
      report({ event_name: "provider_stale_marker_recovery", status: "IDLE" });
      return "IDLE";
    }

    const result = recoverStaleProviderInvocationMarkerResultSchema.parse(recovered.value);
    report({
      event_name: "provider_stale_marker_recovery",
      status: "RECOVERED",
      invocation_id: result.intent.invocation_spec.invocation_id,
      outcome_status: result.outcome.candidate.status,
      usage_availability: result.usage.availability,
      recovery_receipt_ref: {
        artifact_id: result.recovery_receipt_ref.artifact_id,
        content_hash: result.recovery_receipt_ref.content_hash,
      },
    });
    return "RECOVERED";
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runProviderStaleMarkerRecoveryProcess().then(
    (result) => {
      if (result === "NOT_CONFIRMED" || result === "CONFIG_INVALID") {
        console.error(
          JSON.stringify({
            event_name: "provider_stale_marker_recovery_stopped",
            reason_code:
              result === "NOT_CONFIRMED"
                ? "EXPLICIT_CONFIRMATION_REQUIRED"
                : "JOB_AUTHORITY_CONFIG_REQUIRED",
            ...(result === "NOT_CONFIRMED"
              ? { confirmation_variable: "DATA_AGENT_U3_PROVIDER_RECOVERY_CONFIRM" }
              : {}),
          }),
        );
        process.exitCode = 2;
      }
    },
    () => {
      console.error(
        JSON.stringify({
          event_name: "provider_stale_marker_recovery_stopped",
          reason_code: "PROVIDER_STALE_MARKER_RECOVERY_FAILED",
        }),
      );
      process.exitCode = 1;
    },
  );
}
