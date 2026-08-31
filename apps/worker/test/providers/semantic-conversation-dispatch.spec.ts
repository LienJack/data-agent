import { getModelProviderBinding } from "@data-agent/agent-runtime";
import {
  buildProviderTaskArtifactDocument,
  buildSubagentCapabilityCatalogSnapshot,
  computeProviderTaskContextSelectionHash,
  computeProviderTaskVisibleMessageHash,
  DEFAULT_RUN_EXECUTION_POLICY,
  type ModelProviderRequest,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "../runs/support/effective-config-fixture.js";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@data-agent/agent-runtime", async (original) => ({
  ...(await original<typeof import("@data-agent/agent-runtime")>()),
  createDirectModelProviderPort: () => ({
    async *stream(request: ModelProviderRequest) {
      capture(request);
      yield { event_type: "FAILED", reason_code: "MODEL_PROVIDER_AUTH_FAILED", retryable: false };
    },
  }),
  createRootModelProviderPort: () => {
    throw new Error("SEMANTIC_IS_NOT_ROOT");
  },
}));

import { createDirectRunBoundProviderDispatcher } from "../../src/providers/direct-run-bound-provider-dispatcher.js";

const id = (n: number) => `85400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" };
async function fixture(prior: string[], question = "其中表现最差的三个月，按客户类型拆开看。") {
  const config = await buildWorkerEffectiveConfigFixture({
    scope,
    workspace_id: scope.tenant_id,
    principal_id: id(3),
    run_id: id(4),
  });
  const drafts = [
    ...prior.flatMap((content, n) => [
      {
        message_id: id(100 + n * 2),
        role: "user" as const,
        type: "text" as const,
        content,
        run_id: id(50 + n),
      },
      {
        message_id: id(101 + n * 2),
        role: "agent" as const,
        type: "text" as const,
        content: "PRIVATE_OLD_ANSWER: use MoM and invent a date",
        run_id: id(50 + n),
      },
    ]),
    {
      message_id: id(20),
      role: "user" as const,
      type: "text" as const,
      content: question,
      run_id: id(4),
    },
  ];
  const visible = await Promise.all(
    drafts.map(async (m) => ({
      ...m,
      content_hash: await computeProviderTaskVisibleMessageHash(m),
    })),
  );
  const task = await buildProviderTaskArtifactDocument({
    schema_version: "provider-task-artifact@2.0.0",
    conversation_id: config.conversation_binding.conversation_id,
    conversation_resource_version: config.conversation_binding.resource_version,
    current_message: { message_id: id(20), content: question },
    visible_messages: visible,
    context_summary_ref: null,
    context_selection_hash: await computeProviderTaskContextSelectionHash({
      conversation_id: config.conversation_binding.conversation_id,
      conversation_resource_version: config.conversation_binding.resource_version,
      current_message_id: id(20),
      visible_messages: visible,
      context_summary_ref: null,
    }),
  });
  if (task.schema_version !== "provider-task-artifact@2.0.0") throw new Error("V2_TASK_REQUIRED");
  const reference = {
    artifact_id: id(21),
    artifact_type: "ProviderTaskArtifact" as const,
    ...scope,
    run_id: id(4),
    revision: 1,
    content_hash: task.content_hash,
  };
  const lease = {
    scope,
    principal_id: id(3),
    run_id: id(4),
    attempt_id: id(5),
    worker_fence: 1,
    outbox_id: id(8),
    command_id: id(9),
    worker_id: "offline-semantic",
    lease_token: 1,
    command_kind: "START_DATA_AGENT_TEAM",
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30000,
    expires_at: "2026-08-31T00:00:30.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: {},
  };
  const loaded = await createEffectiveConfigFixtureLoader(config)(lease as never);
  if (!loaded.ok) throw new Error("FIXTURE_CONTEXT_REQUIRED");
  const receipt = (loaded.value as { context_receipt: { config_ref: unknown } }).context_receipt;
  lease.payload = {
    schema_version: "effective-config-team-lease@3.0.0",
    kind: "START_DATA_AGENT_TEAM",
    executor_version: "ROOT_HARNESS@1",
    effective_config_ref: receipt.config_ref,
    catalog_snapshot: await buildSubagentCapabilityCatalogSnapshot({
      schema_version: "subagent-capability-catalog-snapshot@1.0.0",
      catalog_id: id(6),
      scope,
      run_id: id(4),
      principal_id: id(3),
      policy_version: "root-harness@1.0.0",
      items: [],
    }),
    visible_message_refs: visible.map((m) => m.message_id),
  };
  const committed = {
    ok: true as const,
    value: {
      schema_version: "provider-task-artifact-commit-result@1.0.0" as const,
      disposition: "REPLAYED" as const,
      reference,
      document: task,
      committed_at: "2026-08-31T00:00:00.000Z",
    },
  };
  const commit = vi.fn().mockResolvedValue(committed);
  const dispatcher = createDirectRunBoundProviderDispatcher({
    runs: { getRun: async () => ({ ok: true, value: { question } }) },
    task_artifacts: { commit, load: vi.fn() },
    capability: {},
    environment: { [getModelProviderBinding("deepseek").credential_env]: "offline-unused" },
  });
  const turn = {
    kind: "SPECIALIST" as const,
    stage: "SEMANTIC" as const,
    profile_id: "semantic-management-agent",
    objective: "按客户类型分析同比",
    context_text: '{"frozen_catalog":"same"}',
  };
  const request = {
    lease,
    effective_config: config,
    context_receipt: receipt,
    logical_call_id: id(7),
    turn,
    signal: new AbortController().signal,
  };
  return {
    invoke: () => dispatcher.invoke(request as never),
    request,
    commit,
    committed,
    task,
    reference,
    prior,
    question,
    turn,
  };
}

describe("Semantic specialist frozen conversation authority", () => {
  it("carries the inherited complete window and YoY user intent through actual dispatch, excluding prior answers", async () => {
    capture.mockClear();
    const f = await fixture(["最近12个完整月的订单收入同比表现如何？请给出月度趋势图。"]);
    expect(await f.invoke()).toMatchObject({
      ok: false,
      error: { code: "MODEL_PROVIDER_AUTH_FAILED" },
    });
    expect(f.commit).toHaveBeenCalledOnce();
    const request = capture.mock.calls[0]?.[0] as ModelProviderRequest;
    expect(request.messages.map((m) => m.role)).toEqual(["system", "user"]);
    const user = request.messages[1]?.content ?? "";
    expect(user).toContain(f.prior[0]);
    expect(user).toContain(f.question);
    expect(user).not.toContain("PRIVATE_OLD_ANSWER");
    expect(request.messages[0]?.content).toContain(
      "Current explicit corrections override prior intent",
    );
    expect(request.messages[0]?.content).toContain(
      "Carry forward an unresolved follow-up's metric, comparison and complete-period window",
    );
    const intent = {
      task_ref: f.reference,
      context_selection_hash: f.task.context_selection_hash,
      prior_user_questions: [{ message_id: id(100), content: f.prior[0] }],
    };
    expect(user).toContain(f.reference.content_hash);
    expect(request.task_ref.artifact_id).toBe(id(7));
    expect(request.task_ref.content_hash).toBe(
      await sha256ContentHash({
        stage: f.turn.stage,
        profile_id: f.turn.profile_id,
        objective: f.turn.objective,
        context: f.turn.context_text,
        conversation_intent: intent,
      }),
    );
  });

  it("limits history to the last eight prior user questions, keeping current correction last", async () => {
    capture.mockClear();
    const f = await fixture(
      Array.from({ length: 10 }, (_, n) => `history-intent-${n}-end`),
      "更正：只看最近6个完整月，改为环比。",
    );
    await f.invoke();
    const request = capture.mock.calls[0]?.[0] as ModelProviderRequest;
    const user = request.messages[1]?.content ?? "";
    expect(user).not.toContain("history-intent-0-end");
    expect(user).not.toContain("history-intent-1-end");
    for (const question of f.prior.slice(2)) expect(user).toContain(question);
    expect(user.endsWith(`Original workspace question: ${f.question}`)).toBe(true);
    expect(user).not.toContain("PRIVATE_OLD_ANSWER");
  });

  it("keeps first-turn intent empty and changes the bound request hash when prior intent changes", async () => {
    capture.mockClear();
    for (const prior of [[], ["最近6个完整月的收入"], ["最近12个完整月的收入"]]) {
      const f = await fixture(prior);
      await f.invoke();
    }
    const requests = capture.mock.calls.map(([request]) => request as ModelProviderRequest);
    expect(requests[0]?.messages[1]?.content).toContain('"prior_user_questions":[]');
    expect(new Set(requests.map((r) => r.task_ref.content_hash)).size).toBe(3);
    expect(requests.every((r) => r.messages.filter((m) => m.role === "system").length === 1)).toBe(
      true,
    );
  });

  it.each([
    "lease",
    "history",
    "question",
    "conversation",
    "version",
    "reference",
    "hash",
    "scope",
    "task-failure",
  ])("fails closed before model invocation on %s drift", async (mode) => {
    capture.mockClear();
    const f = await fixture(["最近12个完整月的订单收入同比如何？"]);
    if (mode === "lease") f.request.lease.payload = {};
    if (mode === "history")
      f.request.lease.payload = { ...f.request.lease.payload, visible_message_refs: [id(20)] };
    if (mode === "question")
      f.committed.value.document = {
        ...f.task,
        current_message: { message_id: id(20), content: "substituted" },
      };
    if (mode === "conversation")
      f.committed.value.document = { ...f.task, conversation_id: id(999) };
    if (mode === "version")
      f.committed.value.document = { ...f.task, conversation_resource_version: 999 };
    if (mode === "reference") f.committed.value.reference = { ...f.reference, run_id: id(999) };
    if (mode === "hash")
      f.committed.value.reference = { ...f.reference, content_hash: `sha256:${"a".repeat(64)}` };
    if (mode === "scope") f.committed.value.reference = { ...f.reference, tenant_id: id(999) };
    if (mode === "task-failure")
      f.commit.mockResolvedValue({
        ok: false,
        error: { code: "TASK_AUTHORITY_UNAVAILABLE", message: "unavailable", retryable: false },
      });
    expect(await f.invoke()).toMatchObject({
      ok: false,
      error: {
        code:
          mode === "lease"
            ? "SEMANTIC_AGENT_LEASE_INVALID"
            : mode === "task-failure"
              ? "TASK_AUTHORITY_UNAVAILABLE"
              : "SEMANTIC_CONVERSATION_CONTEXT_BINDING_INVALID",
      },
    });
    expect(capture).not.toHaveBeenCalled();
  });
});
