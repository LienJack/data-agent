import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  createQuestionRunRoute,
  type QuestionRunRouteDependencies,
} from "../src/server/qa/question-run-route";

vi.mock("server-only", () => ({}));

const workspaceId = "10000000-0000-4000-8000-000000000051";
const conversationId = "10000000-0000-4000-8000-000000000052";
const capability = {
  deployment_id: "10000000-0000-4000-8000-000000000056",
  principal: "10000000-0000-4000-8000-000000000053",
  role: "ANALYST" as const,
  scope: {
    app_id: "10000000-0000-4000-8000-000000000054",
    environment: "test",
    tenant_id: "10000000-0000-4000-8000-000000000055",
  },
};
const session = {
  app_id: capability.scope.app_id,
  auth_user_id: "10000000-0000-4000-8000-000000000057",
  authz_epoch: 1,
  environment: capability.scope.environment,
  principal_id: capability.principal,
  schema_version: "session-principal@1.0.0" as const,
  session_expires_at: "2026-08-24T00:00:00.000Z",
  session_id: "10000000-0000-4000-8000-000000000058",
  system_role: "USER" as const,
};
const projection = {
  createdAt: "2026-08-23T00:00:00.000Z",
  l2Only: true,
  question: "统计订单数",
  runId: "run-1",
  status: "QUEUED" as const,
  updatedAt: "2026-08-23T00:00:00.000Z",
};

function request(body: unknown) {
  return new NextRequest(
    `http://localhost/api/workspaces/${workspaceId}/qa/conversations/${conversationId}/runs`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

describe("Q&A Run route adapter", () => {
  it("只解析 transport 并把授权 capability 交给注入 use-case", async () => {
    const execute = vi.fn<QuestionRunRouteDependencies["execute"]>();
    execute.mockResolvedValue({ kind: "CREATED", projection });
    const route = createQuestionRunRoute({
      authorize: vi.fn<QuestionRunRouteDependencies["authorize"]>().mockResolvedValue({
        ok: true,
        value: { capability, session },
      }),
      execute,
      projectError: vi.fn<QuestionRunRouteDependencies["projectError"]>(),
    });
    const response = await route(
      request({
        schema_version: "qa-run-start@1.0.0",
        question: "统计订单数",
        idempotency_key: "route-adapter-1",
      }),
      { params: Promise.resolve({ conversationId, workspaceId }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(projection);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        capability,
        conversation_id: conversationId,
        principal_id: capability.principal,
        question: "统计订单数",
        workspace_id: workspaceId,
      }),
    );
  });

  it("输入无效时不会调用 use-case", async () => {
    const execute = vi.fn<QuestionRunRouteDependencies["execute"]>();
    const projectError = vi
      .fn<QuestionRunRouteDependencies["projectError"]>()
      .mockImplementation((error) => NextResponse.json({ error }, { status: 400 }));
    const route = createQuestionRunRoute({
      authorize: vi.fn<QuestionRunRouteDependencies["authorize"]>().mockResolvedValue({
        ok: true,
        value: { capability, session },
      }),
      execute,
      projectError,
    });
    const response = await route(request({ question: "" }), {
      params: Promise.resolve({ conversationId, workspaceId }),
    });

    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect(projectError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "RUN_INPUT_INVALID" }),
    );
  });

  it("把 exact E1 gate attempt fence 传给 use-case", async () => {
    const execute = vi.fn<QuestionRunRouteDependencies["execute"]>();
    execute.mockResolvedValue({ kind: "CREATED", projection });
    const route = createQuestionRunRoute({
      authorize: vi.fn<QuestionRunRouteDependencies["authorize"]>().mockResolvedValue({
        ok: true,
        value: { capability, session },
      }),
      execute,
      projectError: vi.fn<QuestionRunRouteDependencies["projectError"]>(),
    });
    const acceptanceFence = {
      authority_kind: "QUALIFICATION" as const,
      qualification_id: "E1-Q1" as const,
      attempt_id: "10000000-0000-4000-8000-000000000061",
      run_id: "10000000-0000-4000-8000-000000000062",
      claim_fence_token: "10000000-0000-4000-8000-000000000063",
    };
    const response = await route(
      request({
        schema_version: "qa-run-start@1.0.0",
        question: "统计订单数",
        idempotency_key: "route-adapter-e1",
        acceptance_fence: acceptanceFence,
      }),
      { params: Promise.resolve({ conversationId, workspaceId }) },
    );
    expect(response.status).toBe(201);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ acceptance_fence: acceptanceFence }),
    );
  });
});
