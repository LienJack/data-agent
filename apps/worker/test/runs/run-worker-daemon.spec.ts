import type { AppScope, PortResult } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createInitialWorkerHealth,
  parseRunWorkerEnvironment,
  runWorkerLoop,
  type WorkerCycleLogger,
} from "../../src/runs/run-worker-daemon.js";
import type { RunWorkerCycleOutcome, RunWorkerRunner } from "../../src/runs/run-worker-runner.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "local",
} as const satisfies AppScope;

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/data_agent",
    WORKER_DEPLOYMENT_ID: "00000000-0000-4000-8000-000000000001",
    WORKER_TENANT_ID: scope.tenant_id,
    WORKER_PRINCIPAL_ID: "00000000-0000-4000-8000-000000000003",
    WORKER_ID: "worker-local-test",
    ...overrides,
  };
}

const authorityPurposes = [
  "BRIEF_SEMANTIC",
  "PLANNING",
  "OBLIGATION_EXECUTION",
  "EVIDENCE",
  "CLAIM_STRUCTURE",
  "RELATION",
  "PROOF",
  "COVERAGE",
  "RESEARCH_STOP",
  "PROJECTION",
  "EVIDENCE_GATE",
  "READINESS",
  "REPORT_READ",
] as const;

const authorityCapabilitySet = Object.fromEntries(
  authorityPurposes.map((purpose, index) => [
    purpose,
    `38000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

describe("Run Worker daemon", () => {
  it("严格解析固定 Authority、轮询和健康配置", () => {
    expect(parseRunWorkerEnvironment(environment())).toMatchObject({
      database_url: "postgres://postgres:postgres@127.0.0.1:5432/data_agent",
      deployment_id: "00000000-0000-4000-8000-000000000001",
      tenant_id: scope.tenant_id,
      principal_id: "00000000-0000-4000-8000-000000000003",
      worker_id: "worker-local-test",
      poll_interval_ms: 1_000,
      lease_duration_ms: 30_000,
      heartbeat_interval_ms: 10_000,
      execution_timeout_ms: 300_000,
      side_effect_timeout_ms: 180_000,
      health_port: 9_091,
      research_authority_capability_ids: null,
    });

    expect(() =>
      parseRunWorkerEnvironment(environment({ WORKER_HEARTBEAT_INTERVAL_MS: "12000" })),
    ).toThrow(/Heartbeat/i);
    expect(
      parseRunWorkerEnvironment(environment({ WORKER_SIDE_EFFECT_TIMEOUT_MS: "90000" }))
        .side_effect_timeout_ms,
    ).toBe(90_000);

    expect(
      parseRunWorkerEnvironment(
        environment({
          WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET: JSON.stringify(authorityCapabilitySet),
        }),
      ).research_authority_capability_ids,
    ).toEqual(authorityCapabilitySet);
  });

  it("IDLE 周期退避，收到停止信号后不再领取新任务", async () => {
    const abort = new AbortController();
    const runOnce = vi.fn<RunWorkerRunner["runOnce"]>(async () => ({
      ok: true,
      value: { kind: "IDLE" },
    }));
    const sleep = vi.fn(async () => abort.abort());
    const health = createInitialWorkerHealth(false);

    await runWorkerLoop({
      runner: { runOnce },
      scope,
      worker_id: "worker-local-test",
      poll_interval_ms: 1_000,
      signal: abort.signal,
      health,
      sleep,
      now: () => new Date("2026-08-10T10:00:00.000Z"),
    });

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000, abort.signal);
    expect(health).toMatchObject({
      initialized: false,
      run_queue_ready: false,
      job_queue_ready: false,
      last_cycle_at: "2026-08-10T10:00:00.000Z",
      last_cycle_kind: "IDLE",
      last_error_code: null,
    });
  });

  it("连续 IDLE 时只记录一次状态切换", async () => {
    const abort = new AbortController();
    const runOnce = vi.fn<RunWorkerRunner["runOnce"]>(async () => ({
      ok: true,
      value: { kind: "IDLE" },
    }));
    const records: unknown[] = [];
    let sleeps = 0;
    const sleep = vi.fn(async () => {
      sleeps += 1;
      if (sleeps === 2) abort.abort();
    });

    await runWorkerLoop({
      runner: { runOnce },
      scope,
      worker_id: "worker-local-test",
      poll_interval_ms: 1_000,
      signal: abort.signal,
      health: createInitialWorkerHealth(false),
      sleep,
      logger: (record) => records.push(record),
    });

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(records).toEqual([
      {
        level: "info",
        event_name: "run_worker_cycle",
        cycle_kind: "IDLE",
      },
    ]);
  });

  it("失败周期只记录稳定错误字段并继续轮询", async () => {
    const abort = new AbortController();
    const secret = "postgres://user:super-secret@db.example/data_agent";
    const outcomes: PortResult<RunWorkerCycleOutcome>[] = [
      {
        ok: false,
        error: {
          code: "APP_AUTHORITY_UNAVAILABLE",
          message: secret,
          retryable: true,
          details: { database_url: secret },
        },
      },
      { ok: true, value: { kind: "IDLE" } },
    ];
    const runOnce = vi.fn<RunWorkerRunner["runOnce"]>(async () => {
      const outcome = outcomes.shift();
      if (!outcome) throw new Error("missing fixture outcome");
      return outcome;
    });
    const records: unknown[] = [];
    const logger: WorkerCycleLogger = (record) => records.push(record);
    const sleep = vi.fn(async () => {
      if (outcomes.length === 0) abort.abort();
    });
    const health = createInitialWorkerHealth(true);

    await runWorkerLoop({
      runner: { runOnce },
      scope,
      worker_id: "worker-local-test",
      poll_interval_ms: 1_000,
      signal: abort.signal,
      health,
      sleep,
      logger,
      now: () => new Date("2026-08-10T10:00:00.000Z"),
    });

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(records)).not.toContain("super-secret");
    expect(records[0]).toEqual({
      level: "warn",
      event_name: "run_worker_cycle_failed",
      reason_code: "APP_AUTHORITY_UNAVAILABLE",
      retryable: true,
    });
    expect(health).toMatchObject({
      last_cycle_kind: "IDLE",
      last_error_code: null,
      research_authority_configured: true,
    });
  });
});
