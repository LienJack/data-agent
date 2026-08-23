import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "81000000-0000-4000-8000-000000000001",
  principal: "81000000-0000-4000-8000-000000000002",
  conversation: "81000000-0000-4000-8000-000000000003",
  defaultModel: "81000000-0000-4000-8000-000000000004",
  selectedModel: "81000000-0000-4000-8000-000000000005",
  defaultDatasource: "81000000-0000-4000-8000-000000000006",
  selectedDatasource: "81000000-0000-4000-8000-000000000007",
  run: "81000000-0000-4000-8000-000000000008",
  config: "81000000-0000-4000-8000-000000000009",
} as const;

const H1 = `sha256:${"1".repeat(64)}` as const;

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getDefaults: vi.fn(),
  resolveSelections: vi.fn(),
  resolveAndAccept: vi.fn(),
  getEffectiveConfig: vi.fn(),
  getRun: vi.fn(),
  resolveRollout: vi.fn(),
  commitDeferred: vi.fn(),
  freezeCatalog: vi.fn(),
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      capability: { principal: ids.principal, scope: { tenant_id: ids.workspace } },
      session: { principal_id: ids.principal },
    },
  }),
  workspaceErrorResponse: (error: unknown) => Response.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getAgentDispatchAuthority: () => ({
    resolveRolloutPolicy: mocks.resolveRollout,
    commitDeferred: mocks.commitDeferred,
  }),
  getAgentProfileRegistry: () => ({
    listDiscoverable: async () => ({
      ok: true,
      value: [
        { revision: { profile_id: "governed-text2sql-agent" } },
        { revision: { profile_id: "report-writing-agent" } },
        { revision: { profile_id: "semantic-management-agent" } },
      ],
    }),
  }),
  getEffectiveConfigResolver: () => ({
    getWorkspaceDefaults: mocks.getDefaults,
    resolveAndAccept: mocks.resolveAndAccept,
    getEffectiveConfig: mocks.getEffectiveConfig,
  }),
  getProviderInvocationStore: () => ({
    resolveConversationRunSelections: mocks.resolveSelections,
  }),
  getWorkspaceAuthority: () => ({ authorizer: {} }),
  getWorkspaceDataRepository: () => ({ getConversation: mocks.getConversation }),
  getWorkspaceSqlPool: () => ({}),
}));

vi.mock("@data-agent/platform", () => ({
  createPostgresRepository: () => ({ getRun: mocks.getRun }),
  freezeSubagentCapabilityCatalog: mocks.freezeCatalog,
}));

vi.mock("@/lib/workspace-run", () => ({
  workspaceRunProjection: () => ({ runId: ids.run, status: "QUEUED" }),
}));

let post: typeof import("../src/app/api/workspaces/[workspaceId]/qa/conversations/[conversationId]/runs/route").POST;
let startQuestionRun: typeof import("../src/server/qa/start-question-run").startQuestionRun;

beforeAll(async () => {
  ({ POST: post } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/conversations/[conversationId]/runs/route"
  ));
  ({ startQuestionRun } = await import("../src/server/qa/start-question-run"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConversation.mockResolvedValue({
    ok: true,
    value: { conversation_id: ids.conversation, resource_version: 9 },
  });
  mocks.getDefaults.mockResolvedValue({
    ok: true,
    value: {
      defaults_ref: { defaults_id: ids.workspace, defaults_revision: 4, defaults_hash: H1 },
      revision: {
        defaults: {
          model: { resource_id: ids.defaultModel, resource_revision: 3, resource_hash: H1 },
          datasource: {
            resource_id: ids.defaultDatasource,
            resource_revision: 5,
            resource_hash: H1,
          },
        },
      },
    },
  });
  mocks.resolveSelections.mockResolvedValue({
    ok: true,
    value: {
      schema_version: "conversation-run-selections@1.0.0",
      conversation_id: ids.conversation,
      conversation_resource_version: 9,
      model_profile_id: ids.selectedModel,
      model_config_version: 12,
      datasource_id: ids.selectedDatasource,
      datasource_resource_version: 7,
    },
  });
  mocks.resolveAndAccept.mockResolvedValue({
    ok: true,
    value: {
      operation: "QUESTION_RUN",
      admission: "READY",
      effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: H1 },
    },
  });
  mocks.getEffectiveConfig.mockResolvedValue({
    ok: true,
    value: {
      datasource: { resource_id: ids.selectedDatasource, resource_revision: 7, resource_hash: H1 },
    },
  });
  mocks.getRun.mockResolvedValue({ ok: true, value: { run_id: ids.run } });
  mocks.resolveRollout.mockResolvedValue({
    ok: true,
    value: {
      mode: "ENFORCED",
      version: 1,
      policy_version: "adaptive-routing@1.0.0+rollout.1",
    },
  });
  mocks.freezeCatalog.mockResolvedValue({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    run_id: ids.run,
    snapshot_hash: H1,
    items: [],
  });
});

describe("QA effective model selection", () => {
  it("uses Conversation B exact revisions instead of Workspace Default A", async () => {
    const response = await post(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "qa-run-start@1.0.0",
            question: "统计订单数",
            idempotency_key: "conversation-b-model",
          }),
        },
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace, conversationId: ids.conversation }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.resolveSelections).toHaveBeenCalledWith(expect.anything(), {
      conversation_id: ids.conversation,
      expected_resource_version: 9,
    });
    const request = mocks.resolveAndAccept.mock.calls[0]?.[1].request;
    expect(request.overrides.model).toEqual({
      mode: "RESOURCE_IDS",
      resources: [{ resource_id: ids.selectedModel, expected_revision: 12 }],
    });
    expect(request.overrides.datasource).toEqual({
      mode: "RESOURCE_IDS",
      resources: [{ resource_id: ids.selectedDatasource, expected_revision: 7 }],
    });
    expect(JSON.stringify(request)).not.toContain(ids.defaultModel);
    expect(JSON.stringify(request)).not.toContain(ids.defaultDatasource);
  });

  it("does not accept a Run when the authoritative selection resolver fails", async () => {
    mocks.resolveSelections.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CONVERSATION_RUN_SELECTION_VERSION_CONFLICT",
        message: "Conversation selection changed.",
        retryable: true,
      },
    });

    const response = await post(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "qa-run-start@1.0.0",
            question: "统计订单数",
            idempotency_key: "conversation-selection-stale",
          }),
        },
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace, conversationId: ids.conversation }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
  });
});

describe("startQuestionRun use-case", () => {
  const capability = {
    principal: ids.principal,
    scope: { tenant_id: ids.workspace },
  };
  const input = () => ({
    capability,
    conversation_id: ids.conversation,
    files: [],
    idempotency_key: "use-case-direct",
    principal_id: ids.principal,
    question: "统计订单数",
    rollout_bootstrap_mode: undefined,
    scope: {
      app_id: "81000000-0000-4000-8000-000000000010",
      environment: "test",
      tenant_id: ids.workspace,
    },
    workspace_id: ids.workspace,
  });

  it("独立完成资源冻结、接受和权威投影读取", async () => {
    await expect(startQuestionRun(input())).resolves.toEqual(
      expect.objectContaining({
        kind: "CREATED",
        projection: { runId: ids.run, status: "QUEUED" },
      }),
    );
    expect(mocks.resolveAndAccept).toHaveBeenCalledOnce();
    expect(mocks.getRun).toHaveBeenCalledOnce();
  });

  it("对话不存在时在接受前失败关闭", async () => {
    mocks.getConversation.mockResolvedValueOnce({ ok: true, value: null });

    await expect(startQuestionRun(input())).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "CONVERSATION_NOT_FOUND_OR_DENIED" }),
        kind: "ERROR",
      }),
    );
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
  });
});
