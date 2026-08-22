import { setTimeout as delay } from "node:timers/promises";
import type { AvailableExecutionModelProfile } from "@data-agent/contracts";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresSemanticAuthoringQueue,
} from "@data-agent/platform";
import nextEnvironment from "@next/env";
import pg from "pg";
import { z } from "zod";
import { resolveSemanticAuthoringModelRuntime } from "./authoring-model-runtime.js";
import { createWorkerSemanticAuthoringRunner } from "./authoring-runner.js";
import { createSemanticAuthoringWorkerCycleRunner } from "./authoring-worker-runner.js";

const LOCAL_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const LOCAL_TENANT_ID = "00000000-0000-4000-8000-000000000002";
const LOCAL_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000003";
const AUTHORING_INPUT_TOKEN_CEILING = 128_000;
const AUTHORING_OUTPUT_TOKEN_CEILING = 8_000;

function authoringProviderBudget(profile: AvailableExecutionModelProfile) {
  const context = profile.operational_constraints.context_window;
  if (context.verification_status !== "VERIFIED") {
    return {
      timeout_ms: 60_000,
      max_input_tokens: 32_000,
      max_output_tokens: AUTHORING_OUTPUT_TOKEN_CEILING,
    };
  }
  const maxOutputTokens = Math.min(AUTHORING_OUTPUT_TOKEN_CEILING, context.max_output_tokens);
  return {
    timeout_ms: 60_000,
    max_input_tokens: Math.min(
      AUTHORING_INPUT_TOKEN_CEILING,
      context.max_context_tokens - maxOutputTokens,
    ),
    max_output_tokens: maxOutputTokens,
  };
}

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
  worker_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  semantic_domains: z
    .array(
      z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
    )
    .min(1),
  poll_interval_ms: z.coerce.number().int().min(100).max(300_000).default(1_000),
  lease_duration_ms: z.coerce.number().int().min(5_000).max(900_000).default(300_000),
});

function loadEnvironment(): NodeJS.ProcessEnv {
  nextEnvironment.loadEnvConfig(process.cwd(), true);
  process.env.DEEPSEEK_API_KEY ||= process.env.DeepSeekAPIKey?.trim();
  process.env.MOONSHOT_API_KEY ||= process.env.KimiAPIKey?.trim();
  return process.env;
}

function parseConfiguration(environment: NodeJS.ProcessEnv) {
  const semanticDomains = [
    ...new Set(
      (
        environment.SEMANTIC_AUTHORING_DOMAINS ??
        environment.SEMANTIC_ALLOWED_DOMAINS ??
        "ecommerce"
      )
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
  return configurationSchema.parse({
    database_url:
      environment.DATABASE_URL ??
      environment.DATA_AGENT_DATABASE_URL ??
      "postgres://postgres:postgres@127.0.0.1:5432/data_agent",
    deployment_id:
      environment.WORKER_DEPLOYMENT_ID ?? environment.SEMANTIC_DEPLOYMENT_ID ?? LOCAL_DEPLOYMENT_ID,
    tenant_id: environment.WORKER_TENANT_ID ?? environment.SEMANTIC_TENANT_ID ?? LOCAL_TENANT_ID,
    principal_id:
      environment.WORKER_PRINCIPAL_ID ?? environment.SEMANTIC_PRINCIPAL_ID ?? LOCAL_PRINCIPAL_ID,
    worker_id: environment.SEMANTIC_AUTHORING_WORKER_ID ?? "semantic-authoring-worker-local",
    semantic_domains: semanticDomains,
    poll_interval_ms: environment.SEMANTIC_AUTHORING_POLL_INTERVAL_MS,
    lease_duration_ms: environment.SEMANTIC_AUTHORING_LEASE_DURATION_MS,
  });
}

function log(record: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export async function runSemanticAuthoringWorkerProcess(
  environmentInput?: NodeJS.ProcessEnv,
): Promise<void> {
  const environment = environmentInput ?? loadEnvironment();
  const config = parseConfiguration(environment);
  const pool = new pg.Pool({
    connectionString: config.database_url,
    connectionTimeoutMillis: 5_000,
    query_timeout: 75_000,
    statement_timeout: 70_000,
    idle_in_transaction_session_timeout: 15_000,
    application_name: "data-agent-semantic-authoring-worker",
  });
  const sqlPool = adaptPgPool(pool);
  const authority = createPostgresCapabilityAuthority(sqlPool);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const capabilityResult = await authority.resolveForServerContext({
      deployment_id: config.deployment_id,
      tenant_id: config.tenant_id,
      principal_id: config.principal_id,
      access: "WRITE",
    });
    if (!capabilityResult.ok) throw new Error(capabilityResult.error.code);
    const capability = capabilityResult.value;
    let modelRuntime = await resolveSemanticAuthoringModelRuntime({
      pool: sqlPool,
      authorizer: authority.authorizer,
      capability,
      environment,
    });
    log({
      event_name: "semantic_authoring_worker_started",
      model_ready: modelRuntime !== null,
      semantic_domains: config.semantic_domains,
    });

    while (!abort.signal.aborted) {
      if (modelRuntime === null) {
        log({
          event_name: "semantic_authoring_worker_waiting",
          reason_code: "CERTIFIED_MODEL_NOT_READY",
        });
        await delay(config.poll_interval_ms, undefined, { signal: abort.signal }).catch(
          () => undefined,
        );
        modelRuntime = await resolveSemanticAuthoringModelRuntime({
          pool: sqlPool,
          authorizer: authority.authorizer,
          capability,
          environment,
        });
        continue;
      }

      const activeModelRuntime = modelRuntime;
      let processed = false;
      for (const semanticDomain of config.semantic_domains) {
        if (abort.signal.aborted) break;
        const queue = createPostgresSemanticAuthoringQueue({
          pool: sqlPool,
          authorizer: authority.authorizer,
          capability,
          semantic_domain: semanticDomain,
        });
        const domainModelRuntime = activeModelRuntime.for_domain(semanticDomain);
        const cycle = createSemanticAuthoringWorkerCycleRunner({
          queue,
          create_runner: (heartbeat) =>
            createWorkerSemanticAuthoringRunner({
              provider: domainModelRuntime.model_provider,
              create_invocation: domainModelRuntime.create_invocation,
              store: {
                pool: sqlPool,
                authorizer: authority.authorizer,
                capability,
                semantic_domain: semanticDomain,
              },
              provider_budget: authoringProviderBudget(activeModelRuntime.profile),
              before_step: heartbeat,
            }),
        });
        const result = await cycle.runOnce({
          scope: capability.scope,
          worker_id: config.worker_id,
          lease_duration_ms: config.lease_duration_ms,
        });
        if (!result.ok) {
          log({
            event_name: "semantic_authoring_worker_cycle_failed",
            semantic_domain: semanticDomain,
            reason_code: result.error.code,
            retryable: result.error.retryable,
          });
          continue;
        }
        if (result.value.kind === "PROCESSED") {
          processed = true;
          log({
            event_name: "semantic_authoring_worker_cycle",
            semantic_domain: semanticDomain,
            ...result.value,
          });
        }
      }
      if (!processed) {
        await delay(config.poll_interval_ms, undefined, { signal: abort.signal }).catch(
          () => undefined,
        );
      }
    }
  } finally {
    abort.abort();
    await pool.end();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (
  process.argv[1]?.endsWith("authoring-worker-cli.ts") ||
  process.argv[1]?.endsWith("authoring-worker-cli.js")
) {
  void runSemanticAuthoringWorkerProcess().catch((error: unknown) => {
    log({
      event_name: "semantic_authoring_worker_stopped",
      reason_code: error instanceof z.ZodError ? "WORKER_CONFIG_INVALID" : "WORKER_STARTUP_FAILED",
    });
    process.exitCode = 1;
  });
}
