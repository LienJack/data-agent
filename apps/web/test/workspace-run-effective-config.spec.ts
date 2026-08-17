import { buildWorkspaceDefaultsRevisionCandidate } from "@data-agent/contracts";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { submitBoundAnalysisRun } from "../src/lib/analysis-run-submission";

vi.mock("server-only", () => ({}));

const ids = {
  app: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  principal: "10000000-0000-4000-8000-000000000003",
  run: "10000000-0000-4000-8000-000000000004",
  defaults: "10000000-0000-4000-8000-000000000005",
  datasource: "10000000-0000-4000-8000-000000000006",
  model: "10000000-0000-4000-8000-000000000007",
  semantic: "10000000-0000-4000-8000-000000000008",
  snapshot: "10000000-0000-4000-8000-000000000009",
  context: "10000000-0000-4000-8000-00000000000a",
  egress: "10000000-0000-4000-8000-00000000000b",
  safety: "10000000-0000-4000-8000-00000000000c",
  config: "10000000-0000-4000-8000-00000000000d",
  conversation: "10000000-0000-4000-8000-00000000000e",
  file: "10000000-0000-4000-8000-00000000000f",
} as const;

const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const resource = (resource_id: string, resource_revision = 1) => ({
  resource_id,
  resource_revision,
  resource_hash: H1,
});

const mocks = vi.hoisted(() => ({
  getDefaults: vi.fn(),
  updateDefaults: vi.fn(),
  resolveAndAccept: vi.fn(),
  getEffectiveConfig: vi.fn(),
  getConversation: vi.fn(),
  getRun: vi.fn(),
  resolveSelections: vi.fn(),
  getFile: vi.fn(),
  runProjection: vi.fn(),
  listProfiles: vi.fn(),
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      session: { principal_id: ids.principal },
      capability: { principal: ids.principal, scope: { tenant_id: ids.workspace } },
    },
  }),
  workspaceErrorResponse: (error: unknown) => Response.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getAgentProfileRegistry: () => ({
    list: mocks.listProfiles,
  }),
  getEffectiveConfigResolver: () => ({
    getWorkspaceDefaults: mocks.getDefaults,
    updateWorkspaceDefaults: mocks.updateDefaults,
    resolveAndAccept: mocks.resolveAndAccept,
    getEffectiveConfig: mocks.getEffectiveConfig,
  }),
  getWorkspaceAuthority: () => ({ authorizer: {} }),
  getProviderInvocationStore: () => ({
    resolveConversationRunSelections: mocks.resolveSelections,
  }),
  getWorkspaceDataRepository: () => ({ getConversation: mocks.getConversation }),
  getWorkspaceFiles: () => ({ get: mocks.getFile }),
  getWorkspaceSqlPool: () => ({}),
}));

vi.mock("@data-agent/platform", () => ({
  createPostgresRepository: () => ({ getRun: mocks.getRun }),
}));

vi.mock("@/lib/workspace-run", () => ({
  workspaceRunProjection: mocks.runProjection,
}));

let genericPost: typeof import("../src/app/api/workspaces/[workspaceId]/runs/route").POST;
let qaPost: typeof import("../src/app/api/workspaces/[workspaceId]/qa/conversations/[conversationId]/runs/route").POST;
let defaultsGet: typeof import("../src/app/api/workspaces/[workspaceId]/defaults/route").GET;
let defaultsPatch: typeof import("../src/app/api/workspaces/[workspaceId]/defaults/route").PATCH;

async function defaultsReadResult() {
  const revision = await buildWorkspaceDefaultsRevisionCandidate({
    schema_version: "workspace-defaults-revision@1.0.0",
    scope: {
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      workspace_id: ids.workspace,
    },
    defaults_id: ids.defaults,
    defaults_revision: 1,
    parent_revision: null,
    parent_hash: null,
    defaults: {
      model: resource(ids.model),
      datasource: resource(ids.datasource),
      files: [],
      knowledge: [],
      mcp_servers: [],
      skills: [],
      semantic_release: resource(ids.semantic),
      schema_snapshot: resource(ids.snapshot),
      context_policy: resource(ids.context),
      egress_policy: resource(ids.egress),
      execution_safety_policy: resource(ids.safety),
    },
    created_by_principal_id: ids.principal,
    created_at: "2026-08-16T10:00:00.000Z",
  });
  return {
    revision,
    defaults_ref: {
      defaults_id: revision.defaults_id,
      defaults_revision: revision.defaults_revision,
      defaults_hash: revision.defaults_hash,
    },
  };
}

function readyResolution() {
  return {
    operation: "QUESTION_RUN" as const,
    admission: "READY" as const,
    conversation_ref: {
      conversation_id: ids.conversation,
      expected_resource_version: 3,
    },
    effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: H2 },
  };
}

function defaultsSelection() {
  const requested = (resource_id: string, expected_revision = 1) => ({
    resource_id,
    expected_revision,
  });
  return {
    model: requested(ids.model),
    datasource: requested(ids.datasource),
    files: [],
    knowledge: [],
    mcp_servers: [],
    skills: [],
    semantic_release: requested(ids.semantic),
    schema_snapshot: requested(ids.snapshot),
    context_policy: requested(ids.context),
    egress_policy: requested(ids.egress),
    execution_safety_policy: requested(ids.safety),
  };
}

beforeAll(async () => {
  ({ POST: genericPost } = await import("../src/app/api/workspaces/[workspaceId]/runs/route"));
  ({ POST: qaPost } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/conversations/[conversationId]/runs/route"
  ));
  ({ GET: defaultsGet, PATCH: defaultsPatch } = await import(
    "../src/app/api/workspaces/[workspaceId]/defaults/route"
  ));
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getDefaults.mockResolvedValue({ ok: true, value: await defaultsReadResult() });
  mocks.resolveAndAccept.mockResolvedValue({ ok: true, value: readyResolution() });
  mocks.getEffectiveConfig.mockResolvedValue({
    ok: true,
    value: { datasource: resource(ids.datasource) },
  });
  mocks.getConversation.mockResolvedValue({
    ok: true,
    value: { conversation_id: ids.conversation, resource_version: 3 },
  });
  mocks.getRun.mockResolvedValue({
    ok: true,
    value: { run_id: ids.run },
  });
  mocks.resolveSelections.mockResolvedValue({
    ok: true,
    value: {
      schema_version: "conversation-run-selections@1.0.0",
      conversation_id: ids.conversation,
      conversation_resource_version: 3,
      model_profile_id: ids.model,
      model_config_version: 2,
      datasource_id: ids.datasource,
      datasource_resource_version: 3,
    },
  });
  mocks.getFile.mockResolvedValue({
    ok: true,
    value: { file_id: ids.file, revision: 2, revision_hash: H1, status: "READY" },
  });
  mocks.runProjection.mockReturnValue({ runId: ids.run, status: "QUEUED" });
  mocks.listProfiles.mockResolvedValue({
    ok: true,
    value: [
      { revision: { profile_id: "governed-text2sql-agent" } },
      { revision: { profile_id: "report-writing-agent" } },
      { revision: { profile_id: "semantic-management-agent" } },
    ],
  });
});

describe("workspace Effective Config routes", () => {
  it("submits the Analysis workbench through the active bound conversation", async () => {
    const submit = vi.fn().mockResolvedValue({ runId: ids.run });
    await submitBoundAnalysisRun(
      {
        question: "统计订单数",
        workspace_id: ids.workspace,
        conversation: {
          id: ids.conversation,
          title: "订单分析",
          dataSourceId: ids.datasource,
          modelProfileId: ids.model,
          resourceVersion: 3,
          messageCount: 0,
          createdAt: "2026-08-16T10:00:00.000Z",
          updatedAt: "2026-08-16T10:00:00.000Z",
        },
      },
      submit,
    );

    expect(submit).toHaveBeenCalledWith("统计订单数", ids.conversation, ids.workspace);
  });

  it("refuses Analysis submission without an explicitly bound conversation", async () => {
    const submit = vi.fn();
    await expect(
      submitBoundAnalysisRun(
        { question: "统计订单数", workspace_id: ids.workspace, conversation: undefined },
        submit,
      ),
    ).rejects.toThrow("ANALYSIS_CONVERSATION_BINDING_REQUIRED");
    expect(submit).not.toHaveBeenCalled();
  });

  it("derives the same complete command identity for an idempotent HTTP retry", async () => {
    const makeRequest = () =>
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/runs`, {
        method: "POST",
        body: JSON.stringify({
          question: "统计订单数",
          idempotencyKey: "generic-run-retry",
          datasourceId: ids.datasource,
          datasourceRevision: 3,
          conversationId: ids.conversation,
        }),
      });

    const first = await genericPost(makeRequest(), {
      params: Promise.resolve({ workspaceId: ids.workspace }),
    });
    const second = await genericPost(makeRequest(), {
      params: Promise.resolve({ workspaceId: ids.workspace }),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstInput = mocks.resolveAndAccept.mock.calls[0]?.[1];
    const secondInput = mocks.resolveAndAccept.mock.calls[1]?.[1];
    expect(secondInput.command).toEqual(firstInput.command);
    expect(secondInput.request).toEqual(firstInput.request);
    expect(firstInput.command.run_id).toBe(firstInput.request.run_id);
  });

  it("rejects a Team Run before acceptance when the enabled Profile set is incomplete", async () => {
    mocks.listProfiles.mockResolvedValueOnce({
      ok: true,
      value: [{ revision: { profile_id: "governed-text2sql-agent" } }],
    });
    const response = await genericPost(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/runs`, {
        method: "POST",
        body: JSON.stringify({
          question: "统计订单数",
          idempotencyKey: "missing-team-profile",
          datasourceId: ids.datasource,
          datasourceRevision: 3,
          conversationId: ids.conversation,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AGENT_PROFILE_SET_NOT_READY" },
    });
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
  });

  it("derives the same Defaults operation identity for an idempotent PATCH retry", async () => {
    const defaults = defaultsSelection();
    const makeRequest = () =>
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/defaults`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 0,
          idempotency_key: "defaults-retry-one",
          defaults,
        }),
      });
    mocks.updateDefaults.mockResolvedValue({
      ok: true,
      value: { revision: await defaultsReadResult(), replayed: false },
    });

    await defaultsPatch(makeRequest(), {
      params: Promise.resolve({ workspaceId: ids.workspace }),
    });
    await defaultsPatch(makeRequest(), {
      params: Promise.resolve({ workspaceId: ids.workspace }),
    });

    expect(mocks.updateDefaults.mock.calls[1]?.[1]).toEqual(
      mocks.updateDefaults.mock.calls[0]?.[1],
    );
  });

  it("uses the same resolver for generic and QA runs with server-built strict requests", async () => {
    const genericResponse = await genericPost(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/runs`, {
        method: "POST",
        body: JSON.stringify({
          question: "统计订单数",
          idempotencyKey: "generic-run-one",
          datasourceId: ids.datasource,
          datasourceRevision: 3,
          conversationId: ids.conversation,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    const qaResponse = await qaPost(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "qa-run-start@1.0.0",
            question: "统计订单数",
            idempotency_key: "qa-run-one",
          }),
        },
      ),
      {
        params: Promise.resolve({
          workspaceId: ids.workspace,
          conversationId: ids.conversation,
        }),
      },
    );

    expect(genericResponse.status).toBe(201);
    expect(qaResponse.status).toBe(201);
    expect(mocks.resolveAndAccept).toHaveBeenCalledTimes(2);
    const genericRequest = mocks.resolveAndAccept.mock.calls[0]?.[1].request;
    const qaRequest = mocks.resolveAndAccept.mock.calls[1]?.[1].request;
    expect(genericRequest).toMatchObject({
      operation: "QUESTION_RUN",
      workspace_id: ids.workspace,
      conversation_ref: {
        conversation_id: ids.conversation,
        expected_resource_version: 3,
      },
      defaults_ref: (await defaultsReadResult()).defaults_ref,
      overrides: {
        model: { mode: "INHERIT_DEFAULT" },
        datasource: {
          mode: "RESOURCE_IDS",
          resources: [{ resource_id: ids.datasource, expected_revision: 3 }],
        },
        files: { mode: "INHERIT_DEFAULT" },
        knowledge: { mode: "INHERIT_DEFAULT" },
        mcp_servers: { mode: "INHERIT_DEFAULT" },
        skills: { mode: "INHERIT_DEFAULT" },
        egress: null,
      },
      mentions: [],
    });
    expect(qaRequest.overrides).toEqual({
      model: {
        mode: "RESOURCE_IDS",
        resources: [{ resource_id: ids.model, expected_revision: 2 }],
      },
      datasource: {
        mode: "RESOURCE_IDS",
        resources: [{ resource_id: ids.datasource, expected_revision: 3 }],
      },
      files: { mode: "INHERIT_DEFAULT" },
      knowledge: { mode: "INHERIT_DEFAULT" },
      mcp_servers: { mode: "INHERIT_DEFAULT" },
      skills: { mode: "INHERIT_DEFAULT" },
      egress: null,
    });
    expect(genericRequest.request_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(qaRequest.request_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    for (const call of mocks.getEffectiveConfig.mock.calls) {
      expect(call[1].conversation_ref).toEqual({
        conversation_id: ids.conversation,
        expected_resource_version: 3,
      });
    }
    expect(mocks.getRun).toHaveBeenCalledTimes(2);
  });

  it("freezes exact READY file revisions and rejects deleted attachment references", async () => {
    const request = (idempotencyKey: string) =>
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "qa-run-start@1.0.0",
            question: "分析附件",
            idempotency_key: idempotencyKey,
            files: [{ file_id: ids.file, revision: 2, revision_hash: H1 }],
          }),
        },
      );
    const context = {
      params: Promise.resolve({ workspaceId: ids.workspace, conversationId: ids.conversation }),
    };
    const accepted = await qaPost(request("qa-file-ready"), context);
    expect(accepted.status).toBe(201);
    expect(mocks.resolveAndAccept.mock.calls.at(-1)?.[1].request.overrides.files).toEqual({
      mode: "RESOURCE_IDS",
      resources: [{ resource_id: ids.file, expected_revision: 2 }],
    });

    mocks.getFile.mockResolvedValueOnce({
      ok: true,
      value: { file_id: ids.file, revision: 3, revision_hash: H2, status: "DELETED" },
    });
    const rejected = await qaPost(request("qa-file-deleted"), context);
    expect(rejected.status).toBe(400);
    expect(mocks.resolveAndAccept).toHaveBeenCalledTimes(1);
  });

  it("rejects client authority/effective/provider claims before resolver execution", async () => {
    const response = await genericPost(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/runs`, {
        method: "POST",
        body: JSON.stringify({
          question: "统计订单数",
          idempotencyKey: "generic-run-two",
          datasourceId: ids.datasource,
          datasourceRevision: 3,
          conversationId: ids.conversation,
          role: "OWNER",
          semantic_release: resource(ids.semantic),
          request_hash: H1,
          provider_eligible: true,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.getDefaults).not.toHaveBeenCalled();
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
  });

  it("rejects an unversioned generic datasource selection before resolution", async () => {
    const response = await genericPost(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/runs`, {
        method: "POST",
        body: JSON.stringify({
          question: "统计订单数",
          idempotencyKey: "generic-unversioned-datasource",
          datasourceId: ids.datasource,
          conversationId: ids.conversation,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
  });

  it.each([
    ["generic", "bad key!"],
    ["qa", "x".repeat(129)],
    ["defaults", "bad key!"],
  ])("rejects %s idempotency keys outside the U2 contract with 400", async (route, key) => {
    const response =
      route === "generic"
        ? await genericPost(
            new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/runs`, {
              method: "POST",
              body: JSON.stringify({
                question: "统计订单数",
                idempotencyKey: key,
                datasourceId: ids.datasource,
                datasourceRevision: 3,
                conversationId: ids.conversation,
              }),
            }),
            { params: Promise.resolve({ workspaceId: ids.workspace }) },
          )
        : route === "qa"
          ? await qaPost(
              new NextRequest(
                `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    schema_version: "qa-run-start@1.0.0",
                    question: "统计订单数",
                    idempotency_key: key,
                  }),
                },
              ),
              {
                params: Promise.resolve({
                  workspaceId: ids.workspace,
                  conversationId: ids.conversation,
                }),
              },
            )
          : await defaultsPatch(
              new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/defaults`, {
                method: "PATCH",
                body: JSON.stringify({
                  expected_revision: 1,
                  idempotency_key: key,
                  defaults: defaultsSelection(),
                }),
              }),
              { params: Promise.resolve({ workspaceId: ids.workspace }) },
            );

    expect(response.status).toBe(400);
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
    expect(mocks.updateDefaults).not.toHaveBeenCalled();
  });

  it("fails stably when defaults are absent", async () => {
    mocks.getDefaults.mockResolvedValueOnce({ ok: true, value: null });
    const response = await qaPost(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "qa-run-start@1.0.0",
            question: "统计订单数",
            idempotency_key: "qa-run-missing-defaults",
          }),
        },
      ),
      {
        params: Promise.resolve({
          workspaceId: ids.workspace,
          conversationId: ids.conversation,
        }),
      },
    );

    expect(await response.json()).toMatchObject({
      error: { code: "WORKSPACE_DEFAULTS_NOT_CONFIGURED" },
    });
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
  });

  it("rejects guessed or cross-workspace conversations on both routes before config resolution", async () => {
    mocks.getConversation.mockResolvedValue({ ok: true, value: null });
    const genericResponse = await genericPost(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/runs`, {
        method: "POST",
        body: JSON.stringify({
          question: "统计订单数",
          idempotencyKey: "generic-run-foreign-conversation",
          datasourceId: ids.datasource,
          datasourceRevision: 3,
          conversationId: ids.conversation,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    const qaResponse = await qaPost(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "qa-run-start@1.0.0",
            question: "统计订单数",
            idempotency_key: "qa-run-foreign-conversation",
          }),
        },
      ),
      {
        params: Promise.resolve({
          workspaceId: ids.workspace,
          conversationId: ids.conversation,
        }),
      },
    );

    await expect(genericResponse.json()).resolves.toMatchObject({
      error: { code: "CONVERSATION_NOT_FOUND_OR_DENIED" },
    });
    await expect(qaResponse.json()).resolves.toMatchObject({
      error: { code: "CONVERSATION_NOT_FOUND_OR_DENIED" },
    });
    expect(mocks.getConversation).toHaveBeenCalledTimes(2);
    expect(mocks.getDefaults).not.toHaveBeenCalled();
    expect(mocks.resolveAndAccept).not.toHaveBeenCalled();
  });

  it.each(["BLOCKED", "BOOTSTRAP_REQUIRED"] as const)(
    "returns %s resolution without reading an accepted Run",
    async (admission) => {
      mocks.resolveAndAccept.mockResolvedValueOnce({
        ok: true,
        value: {
          admission,
          unavailable_reasons: ["SEMANTIC_RELEASE_NOT_PUBLISHED"],
          effective_config_ref: null,
        },
      });
      const response = await qaPost(
        new NextRequest(
          `http://localhost/api/workspaces/${ids.workspace}/qa/conversations/${ids.conversation}/runs`,
          {
            method: "POST",
            body: JSON.stringify({
              schema_version: "qa-run-start@1.0.0",
              question: "统计订单数",
              idempotency_key: `qa-run-${admission.toLowerCase()}`,
            }),
          },
        ),
        {
          params: Promise.resolve({
            workspaceId: ids.workspace,
            conversationId: ids.conversation,
          }),
        },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ resolution: { admission } });
      expect(mocks.getRun).not.toHaveBeenCalled();
      expect(mocks.getEffectiveConfig).not.toHaveBeenCalled();
    },
  );

  it("supports Defaults GET/PATCH without accepting client operation/hash/role claims", async () => {
    const getResponse = await defaultsGet(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/defaults`),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(getResponse.status).toBe(200);
    expect((await getResponse.json()).data.defaults_ref).toEqual(
      (await defaultsReadResult()).defaults_ref,
    );

    const defaults = defaultsSelection();
    mocks.updateDefaults.mockResolvedValueOnce({
      ok: true,
      value: { defaults_ref: (await defaultsReadResult()).defaults_ref },
    });
    const patchResponse = await defaultsPatch(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/defaults`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 1,
          idempotency_key: "defaults-patch-one",
          defaults,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(patchResponse.status).toBe(200);
    const command = mocks.updateDefaults.mock.calls[0]?.[1];
    expect(command).toMatchObject({
      workspace_id: ids.workspace,
      expected_defaults_revision: 1,
      idempotency_key: "defaults-patch-one",
      defaults,
    });
    expect(command.operation_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(command.request_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const injected = await defaultsPatch(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/defaults`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 1,
          idempotency_key: "defaults-patch-two",
          defaults,
          operation_id: ids.run,
          request_hash: H1,
          role: "OWNER",
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(injected.status).toBe(400);
    expect(mocks.updateDefaults).toHaveBeenCalledTimes(1);
  });

  it("rejects server-owned Defaults hashes and revisions even when no extra claim is present", async () => {
    const response = await defaultsPatch(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/defaults`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 1,
          idempotency_key: "defaults-forged-authority",
          defaults: (await defaultsReadResult()).revision.defaults,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.updateDefaults).not.toHaveBeenCalled();
  });
});
