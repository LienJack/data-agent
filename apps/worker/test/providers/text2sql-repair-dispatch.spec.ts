import { getModelProviderBinding } from "@data-agent/agent-runtime";
import {
  canonicalizeJson,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ModelProviderRequest,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildWorkerEffectiveConfigFixture } from "../runs/support/effective-config-fixture.js";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@data-agent/agent-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@data-agent/agent-runtime")>()),
  createDirectModelProviderPort: () => ({
    async *stream(request: ModelProviderRequest) {
      capture(request);
      yield { event_type: "FAILED", reason_code: "MODEL_PROVIDER_AUTH_FAILED", retryable: false };
    },
  }),
  createRootModelProviderPort: () => {
    throw new Error("TEXT2SQL_MUST_NOT_DISPATCH_AS_ROOT");
  },
}));

import { createDirectRunBoundProviderDispatcher } from "../../src/providers/direct-run-bound-provider-dispatcher.js";

describe("Text2SQL repair through the actual Worker dispatch boundary", () => {
  it.each([
    ["TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH", "not equivalent"],
    ["TEXT2SQL_COMPARISON_CURRENT_MONTH_UNIT_REJECTED", "current month bucket needs two"],
    ["TEXT2SQL_COMPARISON_PRIOR_MONTH_UNIT_REJECTED", "prior month bucket needs two"],
    ["TEXT2SQL_COMPARISON_CURRENT_TIME_INPUT_REJECTED", "current date_trunc input"],
    ["TEXT2SQL_COMPARISON_PRIOR_TIME_INPUT_REJECTED", "prior date_trunc input"],
    ["TEXT2SQL_COMPARISON_CURRENT_SUM_INPUT_REJECTED", "current amount must be raw SUM"],
    ["TEXT2SQL_COMPARISON_PRIOR_SUM_INPUT_REJECTED", "prior amount must be raw SUM"],
  ])(
    "sends bounded %s repair history to the model port without invoking a provider",
    async (code, hint) => {
      capture.mockClear();
      const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const scope = { app_id: id(1), tenant_id: id(2), environment: "test" };
      const runId = id(3),
        attemptId = id(4);
      const config = await buildWorkerEffectiveConfigFixture({
        scope,
        workspace_id: scope.tenant_id,
        principal_id: id(5),
        run_id: runId,
      });
      const commit = vi.fn();
      const dispatcher = createDirectRunBoundProviderDispatcher({
        runs: {
          getRun: vi.fn().mockResolvedValue({ ok: true, value: { question: "按渠道给出回报" } }),
        },
        task_artifacts: { commit } as never,
        capability: {},
        environment: {
          [getModelProviderBinding("deepseek").credential_env]: "offline-test-unused-credential",
        },
      });
      const frozen = { schema_version: "frozen-query-context@1.0.0", authority: "fixed" };
      const candidate = {
        schema_version: "text2sql-query-candidate@1.0.0",
        sql: "select 0 as result",
        parameters: [],
        result_columns: [
          {
            name: "result",
            semantic_type: "NUMBER",
            label: "回报",
            semantic_binding: { object_kind: "FORMULA", object_id: "formula.return" },
          },
        ],
        time_window: null,
        presentation: {
          title: "回报",
          summary: "回报",
          visualization: "TABLE",
          x_key: null,
          y_keys: [],
        },
      };
      const repair = {
        schema_version: "text2sql-repair-context@1.0.0",
        frozen_query_context: frozen,
        rejection: {
          attempt: 1,
          diagnostic_code: code,
          rejected_candidate: candidate,
        },
      };
      const invoke = (context: unknown, callId: string) =>
        dispatcher.invoke({
          lease: {
            scope,
            run_id: runId,
            attempt_id: attemptId,
            worker_fence: 1,
            execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
          },
          effective_config: config,
          context_receipt: { run_id: runId, attempt_id: attemptId, worker_fence: 1 },
          logical_call_id: callId,
          turn: {
            kind: "SPECIALIST",
            stage: "TEXT2SQL",
            profile_id: "governed-text2sql-agent",
            objective: "按已发布口径查询",
            context_text: canonicalizeJson(context),
          },
          signal: new AbortController().signal,
        } as Parameters<typeof dispatcher.invoke>[0]);
      expect(await invoke(frozen, id(6))).toMatchObject({
        ok: false,
        error: { code: "MODEL_PROVIDER_AUTH_FAILED" },
      });
      expect(await invoke(repair, id(7))).toMatchObject({
        ok: false,
        error: { code: "MODEL_PROVIDER_AUTH_FAILED" },
      });
      expect(capture).toHaveBeenCalledTimes(2);
      const first = capture.mock.calls[0]?.[0] as ModelProviderRequest;
      const second = capture.mock.calls[1]?.[0] as ModelProviderRequest;
      expect(first.messages.map((m) => m.role)).toEqual(["system", "user"]);
      expect(second.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
      expect(second.messages[0]).toEqual(first.messages[0]);
      expect(second.messages[1]).toEqual(first.messages[1]);
      expect(JSON.parse(second.messages[2]?.content ?? "null")).toEqual(candidate);
      expect(second.messages[3]?.content).toContain(hint);
      expect(second.task_ref.content_hash).not.toEqual(first.task_ref.content_hash);
      expect(second.request_id).not.toEqual(first.request_id);
      expect(second.budget).toEqual(first.budget);
      expect(second.tool_allowlist).toEqual([]);
      expect(commit).not.toHaveBeenCalled();
      const invalid = await invoke(
        { ...repair, rejection: { ...repair.rejection, extra: "override" } },
        id(8),
      );
      expect(invalid).toMatchObject({
        ok: false,
        error: { code: "SPECIALIST_MODEL_REQUEST_INVALID" },
      });
      expect(capture).toHaveBeenCalledTimes(2);
    },
  );
});
