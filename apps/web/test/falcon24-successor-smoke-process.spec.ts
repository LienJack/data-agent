import { buildSemanticRuntimeSmokeReceipt } from "@data-agent/contracts/artifacts";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createFalcon24SuccessorSmokeProcess,
  type ProcessExecutor,
} from "../src/lib/falcon24-successor-smoke-process";

const id = (suffix: number) => `90000000-0000-5000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const buildIdentity: RuntimeBuildIdentity = {
  schema_version: "runtime-build-identity@1.0.0",
  consumer_role: "worker",
  generation_id: hash("a"),
  build_id: hash("b"),
  built_at: "2026-08-28T00:00:00.000Z",
  git_commit: "eac9717e",
  git_dirty: false,
};

async function smokeReceipt(workerBuildIdentity: RuntimeBuildIdentity = buildIdentity) {
  return buildSemanticRuntimeSmokeReceipt({
    schema_version: "semantic-runtime-smoke-receipt@1.0.0",
    receipt_id: id(1),
    stage_id: id(2),
    stage_digest: hash("c"),
    candidate_release: {
      release_id: id(3),
      generation: 2,
      release_digest: hash("d"),
      datasource_id: id(4),
    },
    projection_refs: {
      executable: { projection_id: id(5), projection_digest: hash("e") },
      relationship: { projection_id: id(6), projection_digest: hash("f") },
      runtime_restriction: { projection_id: id(7), projection_digest: hash("1") },
      graph: { projection_id: id(8), projection_digest: hash("2") },
    },
    resolved_metric_id: "metric.order_revenue",
    resolved_dimension_id: "dimension.order_month",
    resolved_binding_hash: hash("3"),
    plan_hash: hash("4"),
    calendar_timezone: "Asia/Shanghai",
    window_start: "2023-11-01T00:00:00.000Z",
    window_end_exclusive: "2024-11-01T00:00:00.000Z",
    validator_identity: {
      validator_version: "semantic-runtime-closure-validator@1.0.0",
      validator_hash: hash("5"),
    },
    worker_build_identity: workerBuildIdentity,
    outcome: "PASS",
    failure_code: null,
  });
}

function processInput(execute: ProcessExecutor) {
  return createFalcon24SuccessorSmokeProcess({
    repository_root: "/repo",
    database_url: "postgres://authority.invalid/data_agent",
    deployment_id: id(20),
    tenant_id: id(21),
    principal_id: id(22),
    worker_build_identity_file: "/build/worker.json",
    execute,
  });
}

describe("Falcon24 successor Worker smoke process", () => {
  it("passes only refs/configuration to the Worker-owned CLI and verifies its receipt", async () => {
    const receipt = await smokeReceipt();
    const execute = vi.fn<ProcessExecutor>(async () => ({
      stdout: `${JSON.stringify(receipt)}\n`,
      stderr: "",
    }));
    const smoke = processInput(execute);

    const result = await smoke.run({
      capability: { not_serialized: true },
      semantic_domain: "falcon24",
      stage_id: receipt.stage_id,
      idempotency_key: "falcon24-generation-2-smoke",
      worker_build_identity: buildIdentity,
    });

    expect(result).toEqual({ ok: true, value: receipt });
    expect(execute).toHaveBeenCalledWith(
      process.execPath,
      [
        "/repo/node_modules/tsx/dist/cli.mjs",
        "/repo/apps/worker/src/semantic/semantic-successor-stage-smoke-cli.ts",
      ],
      expect.objectContaining({
        cwd: "/repo",
        env: expect.objectContaining({
          SEMANTIC_SUCCESSOR_DOMAIN: "falcon24",
          SEMANTIC_SUCCESSOR_STAGE_ID: receipt.stage_id,
          SEMANTIC_SUCCESSOR_SMOKE_IDEMPOTENCY_KEY: "falcon24-generation-2-smoke",
          DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: "/build/worker.json",
        }),
      }),
    );
    expect(JSON.stringify(execute.mock.calls[0]?.[1])).not.toContain("projection_payload");
  });

  it("rejects a valid receipt from a different Worker build", async () => {
    const wrongReceipt = await smokeReceipt({
      ...buildIdentity,
      generation_id: hash("6"),
      build_id: hash("7"),
    });
    const smoke = processInput(
      vi.fn<ProcessExecutor>(async () => ({
        stdout: JSON.stringify(wrongReceipt),
        stderr: "",
      })),
    );

    await expect(
      smoke.run({
        capability: {},
        semantic_domain: "falcon24",
        stage_id: wrongReceipt.stage_id,
        idempotency_key: "falcon24-generation-2-smoke",
        worker_build_identity: buildIdentity,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "FALCON24_SEMANTIC_SUCCESSOR_SMOKE_PROCESS_FAILED",
        message: "Worker semantic successor smoke 进程未返回可验证的 exact receipt。",
        retryable: false,
      },
    });
  });

  it("does not expose child-process diagnostics through the port failure", async () => {
    const smoke = processInput(
      vi.fn<ProcessExecutor>(async () => {
        throw new Error("postgres://secret@internal.invalid/data_agent");
      }),
    );

    await expect(
      smoke.run({
        capability: {},
        semantic_domain: "falcon24",
        stage_id: id(2),
        idempotency_key: "falcon24-generation-2-smoke",
        worker_build_identity: buildIdentity,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "FALCON24_SEMANTIC_SUCCESSOR_SMOKE_PROCESS_FAILED",
        message: "Worker semantic successor smoke 进程未返回可验证的 exact receipt。",
        retryable: false,
      },
    });
  });
});
