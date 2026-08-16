import { pathToFileURL } from "node:url";
import { providerInvocationUnknownClassificationSchema } from "@data-agent/platform";
import {
  createProviderRecoveryJobConnection,
  loadProviderRecoveryEnvironment,
  type ProviderStaleMarkerRecoveryConnectionFactory,
  type ProviderStaleMarkerRecoveryEnvironmentLoader,
  type ProviderStaleMarkerRecoveryReporter,
  parseProviderRecoveryJobAuthority,
} from "./provider-stale-marker-recovery-cli.js";

export type ProviderUnknownClassificationJob = Awaited<
  ReturnType<ProviderStaleMarkerRecoveryConnectionFactory>
>["job"] & {
  discoverNextUnknown(): Promise<
    | { readonly ok: true; readonly value: unknown | null }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly message: string;
          readonly retryable: boolean;
        };
      }
  >;
};

export function providerUnknownClassificationExitCode(
  result: "NOT_CONFIRMED" | "CONFIG_INVALID" | "IDLE" | "MANUAL_REVIEW_REQUIRED",
): number {
  if (result === "IDLE") return 0;
  return result === "MANUAL_REVIEW_REQUIRED" ? 3 : 2;
}

/** Job-only read/classify entry. It never dispatches or reconciles a Provider invocation. */
export async function runProviderUnknownClassificationProcess(
  environment: NodeJS.ProcessEnv = process.env,
  connect: ProviderStaleMarkerRecoveryConnectionFactory = createProviderRecoveryJobConnection,
  report: ProviderStaleMarkerRecoveryReporter = (record) => console.log(JSON.stringify(record)),
  loadEnvironment: ProviderStaleMarkerRecoveryEnvironmentLoader = loadProviderRecoveryEnvironment,
  cwd = process.cwd(),
): Promise<"NOT_CONFIRMED" | "CONFIG_INVALID" | "IDLE" | "MANUAL_REVIEW_REQUIRED"> {
  if (environment.DATA_AGENT_U3_PROVIDER_UNKNOWN_CONFIRM !== "YES") {
    return "NOT_CONFIRMED";
  }
  const loaded = loadEnvironment(environment, cwd);
  const databaseUrl = loaded.DATA_AGENT_JOB_DATABASE_URL?.trim();
  const authority = parseProviderRecoveryJobAuthority(loaded);
  if (!databaseUrl || !authority) return "CONFIG_INVALID";

  const connection = await connect(databaseUrl, authority);
  try {
    const job = connection.job as ProviderUnknownClassificationJob;
    if (typeof job.discoverNextUnknown !== "function") {
      throw new Error("PROVIDER_INVOCATION_UNKNOWN_CLASSIFICATION_UNAVAILABLE");
    }
    const discovered = await job.discoverNextUnknown();
    if (!discovered.ok) throw new Error(discovered.error.code);
    if (discovered.value === null) {
      report({ event_name: "provider_invocation_unknown_classification", status: "IDLE" });
      return "IDLE";
    }
    const classification = providerInvocationUnknownClassificationSchema.parse(discovered.value);
    report({
      event_name: "provider_invocation_unknown_classification",
      status: classification.required_action,
      invocation_id: classification.invocation_id,
      intent_id: classification.intent_id,
      intent_hash: classification.intent_hash,
      permit_id: classification.permit_id,
      permit_hash: classification.permit_hash,
      outcome_id: classification.outcome_id,
      outcome_hash: classification.outcome_hash,
      recovery_capability_used: classification.recovery_capability_used,
    });
    return "MANUAL_REVIEW_REQUIRED";
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runProviderUnknownClassificationProcess().then(
    (result) => {
      process.exitCode = providerUnknownClassificationExitCode(result);
      if (result === "NOT_CONFIRMED" || result === "CONFIG_INVALID") {
        console.error(
          JSON.stringify({
            event_name: "provider_invocation_unknown_classification_stopped",
            reason_code:
              result === "NOT_CONFIRMED"
                ? "EXPLICIT_CONFIRMATION_REQUIRED"
                : "JOB_AUTHORITY_CONFIG_REQUIRED",
          }),
        );
      }
    },
    () => {
      console.error(
        JSON.stringify({
          event_name: "provider_invocation_unknown_classification_stopped",
          reason_code: "PROVIDER_INVOCATION_UNKNOWN_CLASSIFICATION_FAILED",
        }),
      );
      process.exitCode = 1;
    },
  );
}
