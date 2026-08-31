import { getModelProviderBinding } from "@data-agent/agent-runtime";
import {
  contextReceiptBindingSchema,
  DEFAULT_RUN_EXECUTION_POLICY,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "../runs/support/effective-config-fixture.js";

const streamState = vi.hoisted(() => ({
  text: "",
  code: "MODEL_STREAM_PROTOCOL_VIOLATION",
  calls: 0,
}));
vi.mock("@data-agent/agent-runtime", async (original) => ({
  ...(await original<typeof import("@data-agent/agent-runtime")>()),
  createDirectModelProviderPort: () => ({
    async *stream() {
      streamState.calls += 1;
      yield { event_type: "TEXT_DELTA", delta: streamState.text };
      yield { event_type: "FAILED", reason_code: streamState.code, retryable: false };
    },
  }),
  createRootModelProviderPort: () => {
    throw new Error("TEST_NOT_ROOT");
  },
}));

import { createDirectRunBoundProviderDispatcher } from "../../src/providers/direct-run-bound-provider-dispatcher.js";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";

const id = (n: number) => `94700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" };

describe("planner protocol diagnostic producer and display consumer", () => {
  it.each([
    ["ANALYSIS_PROGRAM", "MODEL_STREAM_PROTOCOL_VIOLATION", true],
    ["REPORT", "MODEL_STREAM_PROTOCOL_VIOLATION", false],
    ["ANALYSIS_PROGRAM", "MODEL_PROVIDER_AUTH_FAILED", false],
  ] as const)(
    "preserves failure and only exposes allowlisted diagnostics for %s/%s",
    async (stage, code, visible) => {
      streamState.text = JSON.stringify({
        schema_version: "analysis-program-candidate@2.1.0",
        objective_hash: "private-secret",
        nodes: [],
      });
      streamState.code = code;
      streamState.calls = 0;
      const lease: RunWorkLease = {
        scope,
        principal_id: id(3),
        run_id: id(4),
        outbox_id: id(5),
        command_id: id(6),
        command_kind: "START_DATA_AGENT_TEAM",
        attempt_id: id(7),
        attempt_no: 1,
        delivery_attempt_no: 1,
        lease_duration_ms: 30_000,
        worker_id: "protocol-test",
        lease_token: 1,
        worker_fence: 1,
        expires_at: "2026-08-31T00:00:30.000Z",
        execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
        payload: { kind: "START_DATA_AGENT_TEAM" },
      };
      const config = await buildWorkerEffectiveConfigFixture({
        scope,
        workspace_id: scope.tenant_id,
        principal_id: lease.principal_id,
        run_id: lease.run_id,
      });
      const loaded = await createEffectiveConfigFixtureLoader(config)(lease);
      if (!loaded.ok) throw new Error("TEST_CONFIG_REQUIRED");
      const receipt = z
        .object({ context_receipt: contextReceiptBindingSchema })
        .parse(loaded.value).context_receipt;
      const unused = vi.fn(async () => {
        throw new Error("TEST_UNUSED_PORT");
      });
      const dispatcher = createDirectRunBoundProviderDispatcher({
        runs: { getRun: async () => ({ ok: true, value: { question: "观察当前受治理输入" } }) },
        task_artifacts: { commit: unused, load: unused },
        capability: {},
        environment: { [getModelProviderBinding("deepseek").credential_env]: "offline-unused" },
      });
      const display = vi.fn(async (_event: unknown) => ({
        ok: true as const,
        value: { sequence: 1 },
      }));
      const context = createRunExecutionContext({
        lease,
        effective_config: config,
        context_receipt: receipt,
        run_signal: new AbortController().signal,
        event_store: { commitSideEffect: unused, commitSnapshot: unused, findSideEffect: unused },
        now: () => new Date("2026-08-31T00:00:00.000Z"),
        create_id: () => id(8),
        side_effect_timeout_ms: 1_000,
        provider_dispatch: dispatcher,
        heartbeat: unused,
        guard_running_lease: unused,
        append_checkpoint_event: unused,
        append_side_effect_event: unused,
        append_display_event: display,
      });
      const provider = context.getProviderDispatchCapability();
      if (!provider) throw new Error("TEST_PROVIDER_REQUIRED");
      const result = await provider.invoke({
        logical_call_id: id(9),
        turn: {
          kind: "SPECIALIST",
          stage,
          profile_id: stage === "REPORT" ? "report-writing-agent" : "governed-analysis-agent",
          objective: "给出受治理分析候选",
          context_text: "{}",
        },
      });
      expect(result).toMatchObject({ ok: false, error: { code, retryable: false } });
      expect(streamState.calls).toBe(1);
      const failed = z
        .object({
          kind: z.literal("tool_failed"),
          error_code: z.string(),
          output: z.string().nullable(),
        })
        .parse(display.mock.calls.at(-1)?.[0]);
      expect(failed.error_code).toBe(code);
      if (visible)
        expect(JSON.parse(failed.output ?? "null")).toMatchObject({
          state: "SCHEMA_INVALID",
          issues: expect.arrayContaining([{ code: "invalid_format", path: ["objective_hash"] }]),
        });
      else expect(failed.output).toBeNull();
      expect(JSON.stringify(display.mock.calls)).not.toContain("private-secret");
      expect(JSON.stringify(result)).not.toContain("private-secret");
      expect(unused).not.toHaveBeenCalled();
    },
  );
});
