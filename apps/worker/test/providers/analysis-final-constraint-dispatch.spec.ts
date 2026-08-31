import {
  getModelProviderBinding,
  type RootModelProviderPortCompositionInput,
} from "@data-agent/agent-runtime";
import {
  contextReceiptBindingSchema,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ModelProviderRequest,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "../runs/support/effective-config-fixture.js";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@data-agent/agent-runtime", async (original) => ({
  ...(await original<typeof import("@data-agent/agent-runtime")>()),
  createDirectModelProviderPort: (composition: RootModelProviderPortCompositionInput) => ({
    async *stream(request: ModelProviderRequest) {
      capture(
        request,
        composition.response_schema_registry?.resolve(request.response_schema_version),
      );
      yield { event_type: "FAILED", reason_code: "MODEL_PROVIDER_AUTH_FAILED", retryable: false };
    },
  }),
}));

import { createDirectRunBoundProviderDispatcher } from "../../src/providers/direct-run-bound-provider-dispatcher.js";

describe("Host-owned per-request final constraint", () => {
  it("binds the exact summary into task identity and an isolated server response schema", async () => {
    capture.mockClear();
    const id = (n: number) => `74800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const scope = { app_id: id(1), tenant_id: id(2), environment: "test" };
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: id(3),
      run_id: id(4),
    });
    const getRun = vi.fn(async () => ({ ok: true as const, value: { question: "业务问题" } }));
    const lease: RunWorkLease = {
      scope,
      principal_id: id(3),
      run_id: id(4),
      attempt_id: id(5),
      outbox_id: id(7),
      command_id: id(8),
      command_kind: "START_DATA_AGENT_TEAM",
      attempt_no: 1,
      delivery_attempt_no: 1,
      lease_duration_ms: 30000,
      worker_id: "final-constraint-test",
      lease_token: 1,
      worker_fence: 1,
      expires_at: "2026-08-31T00:00:30.000Z",
      execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      payload: { kind: "START_DATA_AGENT_TEAM" },
    };
    const loaded = await createEffectiveConfigFixtureLoader(config)(lease);
    if (!loaded.ok) throw new Error("CONFIG_REQUIRED");
    const receipt = z
      .object({ context_receipt: contextReceiptBindingSchema })
      .parse(loaded.value).context_receipt;
    const dispatcher = createDirectRunBoundProviderDispatcher({
      runs: { getRun },
      task_artifacts: {} as never,
      capability: {},
      environment: { [getModelProviderBinding("deepseek").credential_env]: "offline-unused" },
    });
    const invoke = (constraint?: string, phase: "FINAL" | "TOOL" = "FINAL") =>
      dispatcher.invoke({
        lease,
        effective_config: config,
        context_receipt: receipt,
        logical_call_id: id(6),
        signal: new AbortController().signal,
        analysis_agent: {
          node_id: "node",
          turn_index: 1,
          phase,
          allowed_tool_names: [],
          messages: [{ role: "user", content: "Same frozen intent." }],
          response_schema_version: "analysis-agent-final@1.0.0",
          max_output_tokens: 2048,
          ...(constraint === undefined ? {} : { final_summary_constraint: constraint }),
        },
      });
    for (const text of ["本轮受验文本A。", "本轮受验文本B。", undefined]) {
      await expect(invoke(text)).resolves.toMatchObject({
        ok: false,
        error: { code: "MODEL_PROVIDER_AUTH_FAILED" },
      });
    }
    expect(capture).toHaveBeenCalledTimes(3);
    const first = capture.mock.calls[0],
      second = capture.mock.calls[1],
      legacy = capture.mock.calls[2];
    if (!first || !second || !legacy) throw new Error("CAPTURE_REQUIRED");
    expect(first[0].task_ref.content_hash).not.toEqual(second[0].task_ref.content_hash);
    expect(first[0].budget).toEqual(second[0].budget);
    expect(first[0].tool_allowlist).toEqual([]);
    expect(z.toJSONSchema(first[1].schema)).toMatchObject({
      properties: { summary_zh: { const: "本轮受验文本A。" } },
      additionalProperties: false,
    });
    const response = (summary_zh: string) => ({
      schema_version: "analysis-agent-final@1.0.0",
      summary_zh,
    });
    expect(first[1].schema.safeParse(response("本轮受验文本A。")).success).toBe(true);
    expect(first[1].schema.safeParse(response("本轮受验文本B。")).success).toBe(false);
    expect(second[1].schema.safeParse(response("本轮受验文本B。")).success).toBe(true);
    expect(legacy[1].schema.safeParse(response("其他合同的自由解释。")).success).toBe(true);
    for (const [text, phase] of [
      ["bad", "TOOL"],
      [" ", "FINAL"],
      ["x".repeat(20001), "FINAL"],
    ] as const) {
      await expect(invoke(text, phase)).resolves.toMatchObject({
        ok: false,
        error: { code: "ANALYSIS_FINAL_CONSTRAINT_INVALID", retryable: false },
      });
    }
    expect(capture).toHaveBeenCalledTimes(3);
    expect(getRun).toHaveBeenCalledTimes(3);
  });
});
