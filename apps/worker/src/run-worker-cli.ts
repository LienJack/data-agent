import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresResearchAuthority,
  createPostgresRunEventStore,
  createPostgresRunQueue,
} from "@data-agent/platform";
import pg from "pg";
import { z } from "zod";
import { createResearchWorkflowExecutor } from "./runs/research-workflow-executor.js";
import {
  createInitialWorkerHealth,
  parseRunWorkerEnvironment,
  runWorkerLoop,
  type WorkerCycleLogRecord,
  type WorkerHealthState,
} from "./runs/run-worker-daemon.js";
import { createRunWorkerRunner } from "./runs/run-worker-runner.js";

class RunWorkerStartupError extends Error {
  override readonly name = "RunWorkerStartupError";

  constructor(readonly code: string) {
    super(code);
  }
}

function writeLog(record: WorkerCycleLogRecord): void {
  const { level, ...fields } = record;
  const output = JSON.stringify(fields);
  switch (level) {
    case "info":
      console.info(output);
      return;
    case "warn":
      console.warn(output);
      return;
    case "error":
      console.error(output);
      return;
  }
}

function createHealthServer(health: WorkerHealthState): Server {
  return createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/live") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(health.initialized ? 200 : 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        status: health.initialized ? "ready" : "starting",
        ...health,
      }),
    );
  });
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "0.0.0.0");
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function runWorkerProcess(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = parseRunWorkerEnvironment(environment);
  const pool = new pg.Pool({
    connectionString: config.database_url,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 12_000,
    idle_in_transaction_session_timeout: 15_000,
  });
  const sqlPool = adaptPgPool(pool);
  const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
  const controller = new AbortController();
  const health = createInitialWorkerHealth(config.research_authority_capability_id !== null);
  const healthServer = createHealthServer(health);
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const resolved = await capabilityAuthority.resolveForServerContext({
      deployment_id: config.deployment_id,
      tenant_id: config.tenant_id,
      principal_id: config.principal_id,
      access: "WRITE",
    });
    if (!resolved.ok) throw new RunWorkerStartupError(resolved.error.code);

    const appCapability = resolved.value;
    const authorityCapabilityInput = config.research_authority_capability_id
      ? {
          app_capability: appCapability,
          authority_capability_id: config.research_authority_capability_id,
        }
      : null;
    const executor = createResearchWorkflowExecutor({
      research_authority: createPostgresResearchAuthority({
        pool: sqlPool,
        authorizer: capabilityAuthority.authorizer,
      }),
      authority_capability_input: authorityCapabilityInput,
      principal_id: config.principal_id,
      create_id: randomUUID,
      now: () => new Date(),
    });
    const runner = createRunWorkerRunner({
      queue: createPostgresRunQueue(sqlPool, capabilityAuthority.authorizer, appCapability, {
        lease_duration_ms: config.lease_duration_ms,
      }),
      event_store: createPostgresRunEventStore(
        sqlPool,
        capabilityAuthority.authorizer,
        appCapability,
      ),
      executor,
      execution_timeout_ms: config.execution_timeout_ms,
      heartbeat_interval_ms: config.heartbeat_interval_ms,
      side_effect_timeout_ms: config.side_effect_timeout_ms,
    });

    health.initialized = true;
    await listen(healthServer, config.health_port);
    writeLog({
      level: "info",
      event_name: "run_worker_started",
      reason_code: authorityCapabilityInput
        ? "RESEARCH_AUTHORITY_CONFIGURED"
        : "RESEARCH_AUTHORITY_NOT_CONFIGURED",
    });
    await runWorkerLoop({
      runner,
      scope: appCapability.scope,
      worker_id: config.worker_id,
      poll_interval_ms: config.poll_interval_ms,
      signal: controller.signal,
      health,
      logger: writeLog,
    });
  } finally {
    health.initialized = false;
    controller.abort();
    await closeServer(healthServer);
    await pool.end();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

void runWorkerProcess().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event_name: "run_worker_stopped",
      reason_code:
        error instanceof z.ZodError
          ? "WORKER_CONFIG_INVALID"
          : error instanceof RunWorkerStartupError
            ? error.code
            : "WORKER_STARTUP_FAILED",
    }),
  );
  process.exitCode = 1;
});
