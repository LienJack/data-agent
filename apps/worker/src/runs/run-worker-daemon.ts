import { setTimeout as delay } from "node:timers/promises";
import type { AppScope } from "@data-agent/contracts";
import { z } from "zod";
import {
  parseResearchAuthorityCapabilityIds,
  type ResearchAuthorityCapabilityIds,
} from "./research-authority-capabilities.js";
import type { RunWorkerCycleOutcome, RunWorkerRunner } from "./run-worker-runner.js";

const workerEnvironmentSchema = z
  .strictObject({
    database_url: z.string().min(1),
    deployment_id: z.uuid(),
    tenant_id: z.uuid(),
    principal_id: z.uuid(),
    worker_id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
    poll_interval_ms: z.coerce.number().int().min(100).max(300_000).default(1_000),
    lease_duration_ms: z.coerce.number().int().min(5_000).max(900_000).default(30_000),
    heartbeat_interval_ms: z.coerce.number().int().min(10).max(300_000).default(10_000),
    execution_timeout_ms: z.coerce.number().int().min(10).max(3_600_000).default(300_000),
    side_effect_timeout_ms: z.coerce.number().int().min(10).max(900_000).default(60_000),
    health_port: z.coerce.number().int().min(1_024).max(65_535).default(9_091),
    research_authority_capability_ids: z
      .custom<ResearchAuthorityCapabilityIds>()
      .nullable()
      .default(null),
  })
  .superRefine((config, context) => {
    if (config.heartbeat_interval_ms > Math.floor(config.lease_duration_ms / 3)) {
      context.addIssue({
        code: "custom",
        path: ["heartbeat_interval_ms"],
        message: "Worker Heartbeat Interval 不得超过 Lease Duration 的三分之一。",
      });
    }
    if (config.heartbeat_interval_ms >= config.execution_timeout_ms) {
      context.addIssue({
        code: "custom",
        path: ["heartbeat_interval_ms"],
        message: "Worker Heartbeat Interval 必须小于执行超时。",
      });
    }
  });

export type RunWorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function parseRunWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): RunWorkerEnvironment {
  return workerEnvironmentSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.WORKER_DEPLOYMENT_ID,
    tenant_id: environment.WORKER_TENANT_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID,
    worker_id: environment.WORKER_ID,
    poll_interval_ms: environment.WORKER_POLL_INTERVAL_MS,
    lease_duration_ms: environment.WORKER_LEASE_DURATION_MS,
    heartbeat_interval_ms: environment.WORKER_HEARTBEAT_INTERVAL_MS,
    execution_timeout_ms: environment.WORKER_EXECUTION_TIMEOUT_MS,
    side_effect_timeout_ms: environment.WORKER_SIDE_EFFECT_TIMEOUT_MS,
    health_port: environment.WORKER_HEALTH_PORT,
    research_authority_capability_ids: parseResearchAuthorityCapabilityIds(
      environment.WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET,
    ),
  });
}

export interface WorkerHealthState {
  initialized: boolean;
  run_queue_ready: boolean;
  job_queue_ready: boolean;
  last_cycle_at: string | null;
  last_cycle_kind: RunWorkerCycleOutcome["kind"] | null;
  last_error_code: string | null;
  job_last_cycle_at: string | null;
  job_last_cycle_kind: "IDLE" | "COMPLETED" | "RETRY_SCHEDULED" | "CANCELLED" | "FAILED" | null;
  job_last_error_code: string | null;
  readonly research_authority_configured: boolean;
}

export function createInitialWorkerHealth(researchAuthorityConfigured: boolean): WorkerHealthState {
  return {
    initialized: false,
    run_queue_ready: false,
    job_queue_ready: false,
    last_cycle_at: null,
    last_cycle_kind: null,
    last_error_code: null,
    job_last_cycle_at: null,
    job_last_cycle_kind: null,
    job_last_error_code: null,
    research_authority_configured: researchAuthorityConfigured,
  };
}

export type WorkerCycleLogRecord = Readonly<{
  level: "info" | "warn" | "error";
  event_name: string;
  reason_code?: string;
  retryable?: boolean;
  cycle_kind?: RunWorkerCycleOutcome["kind"];
  run_id?: string;
  final_event_sequence?: number;
  build_id?: `sha256:${string}`;
  generation_id?: `sha256:${string}`;
  git_commit?: string;
  git_dirty?: boolean;
  migration_ready?: true;
  migration_frontier?: `sha256:${string}`;
  examined?: number;
  killed?: number;
  residual?: number;
  deleted?: number;
  cleanup_id?: string;
  receipt_hash?: string;
}>;

export type WorkerCycleLogger = (record: WorkerCycleLogRecord) => void;
export type WorkerSleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

const defaultSleep: WorkerSleep = async (milliseconds, signal) => {
  await delay(milliseconds, undefined, { signal }).catch((error: unknown) => {
    if (!signal.aborted) throw error;
  });
};

function safeCycleRecord(outcome: RunWorkerCycleOutcome): WorkerCycleLogRecord {
  if (outcome.kind === "IDLE") {
    return {
      level: "info",
      event_name: "run_worker_cycle",
      cycle_kind: outcome.kind,
    };
  }
  const finalEventSequence =
    "final_event_sequence" in outcome
      ? outcome.final_event_sequence
      : outcome.observed_event_sequence;
  return {
    level: "info",
    event_name: "run_worker_cycle",
    cycle_kind: outcome.kind,
    run_id: outcome.run_id,
    final_event_sequence: finalEventSequence,
  };
}

export async function runWorkerLoop(
  options: Readonly<{
    runner: RunWorkerRunner;
    scope: AppScope;
    worker_id: string;
    poll_interval_ms: number;
    signal: AbortSignal;
    health: WorkerHealthState;
    sleep?: WorkerSleep;
    logger?: WorkerCycleLogger;
    now?: () => Date;
  }>,
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  options.health.run_queue_ready = true;
  options.health.initialized = options.health.job_queue_ready;

  while (!options.signal.aborted) {
    try {
      const result = await options.runner.runOnce({
        scope: options.scope,
        worker_id: options.worker_id,
      });
      options.health.last_cycle_at = now().toISOString();
      if (result.ok) {
        const previousCycleKind = options.health.last_cycle_kind;
        options.health.last_cycle_kind = result.value.kind;
        options.health.last_error_code = null;
        if (result.value.kind !== "IDLE" || previousCycleKind !== "IDLE") {
          logger(safeCycleRecord(result.value));
        }
        if (result.value.kind !== "IDLE") continue;
      } else {
        options.health.last_cycle_kind = null;
        options.health.last_error_code = result.error.code;
        logger({
          level: result.error.retryable ? "warn" : "error",
          event_name: "run_worker_cycle_failed",
          reason_code: result.error.code,
          retryable: result.error.retryable,
        });
      }
    } catch {
      options.health.last_cycle_at = now().toISOString();
      options.health.last_cycle_kind = null;
      options.health.last_error_code = "WORKER_PROCESS_CRASH";
      logger({
        level: "error",
        event_name: "run_worker_cycle_failed",
        reason_code: "WORKER_PROCESS_CRASH",
        retryable: true,
      });
    }

    await sleep(options.poll_interval_ms, options.signal);
  }

  options.health.run_queue_ready = false;
  options.health.initialized = false;
}
