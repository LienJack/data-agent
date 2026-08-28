import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP";
const RETIRED_REASON = "FALCON24_E1_BOOTSTRAP_RETIRED_SEMANTIC_SUCCESSOR_REQUIRED" as const;

/**
 * Historical generation-1 bootstrap is intentionally retired. Creating a new
 * generation-1 current would expose projection bytes that the production read
 * path cannot execute. Existing E1-E3 history remains immutable; the approved
 * recovery entrypoint is the reviewed generation-2/E4 finalizer.
 */
export async function runFalcon24E1Bootstrap(environment: NodeJS.ProcessEnv = process.env) {
  if (environment[CONFIRMATION_VARIABLE] !== "YES") {
    return Object.freeze({
      schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0" as const,
      terminal: "NOT_RUN" as const,
      reason_code: "FALCON24_E1_BOOTSTRAP_CONFIRMATION_REQUIRED" as const,
    });
  }

  return Object.freeze({
    schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0" as const,
    terminal: "HOLD" as const,
    reason_code: RETIRED_REASON,
    production_readiness: "HOLD" as const,
    immutable_history_policy: "NO_GENERATION_1_WRITES" as const,
    required_entrypoint: "finalize:falcon24-authority" as const,
  });
}

async function main(): Promise<void> {
  const result = await runFalcon24E1Bootstrap(process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.terminal === "NOT_RUN" ? 2 : 1;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (executedPath === fileURLToPath(import.meta.url)) await main();
