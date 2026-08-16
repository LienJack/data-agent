import { pathToFileURL } from "node:url";
import { canonicalImmutableIdSchema } from "@data-agent/contracts";
import { runWorkerProcess } from "./run-worker-cli.js";
import { loadRunWorkerEnvironment } from "./run-worker-environment.js";

export type ProviderInvocationSmokeRun = (environment: NodeJS.ProcessEnv) => Promise<void>;
export type ProviderInvocationSmokeEnvironmentLoader = (
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => NodeJS.ProcessEnv;

/** Confirmation is checked before dotenv, credential parsing, or PostgreSQL. */
export async function runProviderInvocationSmokeProcess(
  environment: NodeJS.ProcessEnv = process.env,
  run: ProviderInvocationSmokeRun = runWorkerProcess,
  loadEnvironment: ProviderInvocationSmokeEnvironmentLoader = (received, receivedCwd) =>
    loadRunWorkerEnvironment(received, receivedCwd),
  cwd = process.cwd(),
): Promise<"NOT_CONFIRMED" | "TARGET_INVALID" | "COMPLETED"> {
  if (environment.DATA_AGENT_U3_PROVIDER_SMOKE_CONFIRM !== "YES") {
    return "NOT_CONFIRMED";
  }
  if (
    !canonicalImmutableIdSchema.safeParse(environment.DATA_AGENT_U3_PROVIDER_SMOKE_RUN_ID)
      .success ||
    !canonicalImmutableIdSchema.safeParse(environment.DATA_AGENT_U3_PROVIDER_SMOKE_COMMAND_ID)
      .success
  ) {
    return "TARGET_INVALID";
  }
  const loaded = loadEnvironment(environment, cwd);
  await run({ ...loaded, DATA_AGENT_U3_PROVIDER_SMOKE_ONE_SHOT: "YES" });
  return "COMPLETED";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runProviderInvocationSmokeProcess().then(
    (result) => {
      if (result !== "COMPLETED") {
        console.error(
          JSON.stringify({
            event_name: "provider_invocation_smoke_stopped",
            reason_code:
              result === "NOT_CONFIRMED"
                ? "EXPLICIT_CONFIRMATION_REQUIRED"
                : "PROVIDER_INVOCATION_SMOKE_TARGET_INVALID",
            ...(result === "NOT_CONFIRMED"
              ? { confirmation_variable: "DATA_AGENT_U3_PROVIDER_SMOKE_CONFIRM" }
              : {}),
          }),
        );
        process.exitCode = 2;
      }
    },
    () => {
      console.error(
        JSON.stringify({
          event_name: "provider_invocation_smoke_stopped",
          reason_code: "PROVIDER_INVOCATION_SMOKE_FAILED",
        }),
      );
      process.exitCode = 1;
    },
  );
}
