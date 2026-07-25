import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type AuthorizedTeamToolCall,
  authorizeTeamToolCall,
  authorizeTeamToolSinkInvocation,
  InMemoryAtomicTeamToolBudgetReservationLedger,
  isAuthoritativeTeamToolSinkInvocation,
  type TeamToolAuthorizationSecurity,
  toolCallCandidateSchema,
  toolPolicyFailureReceiptSchema,
} from "../src/teams/index.js";
import { ServerOwnedToolRegistry } from "../src/tools/index.js";
import {
  APP_SCOPE,
  makeParentTask,
  PARENT_ATTEMPT_ID,
  PARENT_TASK_ID,
  RUN_ID,
  TOOL_CALL_ID,
} from "./fixtures/team.js";

const SECOND_TOOL_CALL_ID = "00000000-0000-4000-8000-000000000099";

const semanticTool = {
  tool_name: "semantic.catalog.read",
  description: "Read the authorized semantic catalog.",
  input_schema: z.strictObject({
    metric: z.string().min(1),
  }),
  network_access: { mode: "DENY" },
} as const;

const networkTool = {
  tool_name: "network.fetch",
  description: "Fetch an authorized HTTPS origin.",
  input_schema: z.strictObject({
    path: z.string().startsWith("/"),
  }),
  network_access: { mode: "HTTPS" },
} as const;

const nonIdempotentTool = {
  tool_name: "artifact.commit",
  description: "Commit a new authoritative artifact revision.",
  input_schema: z.strictObject({
    revision: z.number().int().positive(),
  }),
  network_access: { mode: "DENY" },
} as const;

function security(
  ledger = new InMemoryAtomicTeamToolBudgetReservationLedger(),
): TeamToolAuthorizationSecurity {
  return {
    registry: new ServerOwnedToolRegistry([semanticTool, networkTool, nonIdempotentTool]),
    budget_ledger: ledger,
  };
}

const allowedCandidate = {
  schema_version: "1.0.0",
  tool_call_id: TOOL_CALL_ID,
  task_id: PARENT_TASK_ID,
  attempt_id: PARENT_ATTEMPT_ID,
  scope: APP_SCOPE,
  run_id: RUN_ID,
  tool_name: "semantic.catalog.read",
  arguments: {
    metric: "revenue",
  },
  network_access: {
    mode: "NONE",
  },
} as const;

function networkTask(origin = "https://api.example.com") {
  return {
    ...makeParentTask(),
    tool_policy: {
      policy_version: "team-policy-v1",
      allowlist: ["semantic.catalog.read", "network.fetch"],
    },
    network_policy: {
      mode: "ALLOWLIST",
      allowed_origins: [origin],
    },
  } as const;
}

function networkCandidate(origin = "https://api.example.com") {
  return {
    ...allowedCandidate,
    tool_name: "network.fetch",
    arguments: {
      path: "/v1/data",
    },
    network_access: {
      mode: "HTTPS",
      origin,
    },
  } as const;
}

const noNetworkSinkRevalidator = {
  async revalidate(input: AuthorizedTeamToolCall) {
    return {
      schema_version: input.schema_version,
      tool_call_id: input.tool_call_id,
      task_id: input.task_id,
      attempt_id: input.attempt_id,
      scope: input.scope,
      run_id: input.run_id,
      policy_version: input.policy_version,
      network_access: input.network_access,
      requested_origin: null,
      final_origin: null,
      redirect_origins: [],
      resolved_ips: [],
      revalidated: true,
    };
  },
};

describe("Team tool policy", () => {
  it("同时校验 Task allowlist、服务端 Descriptor Input Schema 与无网络声明", async () => {
    const result = await authorizeTeamToolCall(makeParentTask(), allowedCandidate, security());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tool_name).toBe("semantic.catalog.read");
      expect(result.value.arguments).toEqual({ metric: "revenue" });
      expect(result.value.network_access).toEqual({ mode: "NONE" });
      expect(result.value.budget_reservation).toEqual({
        status: "RESERVED",
        ordinal: 1,
      });
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it("拒绝未声明 Tool，并保留不含参数的非权威 Failure Receipt", async () => {
    const result = await authorizeTeamToolCall(
      makeParentTask(),
      {
        ...allowedCandidate,
        tool_name: "sql.execute",
        arguments: {
          sql: "select secret from credentials",
        },
      },
      security(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(toolPolicyFailureReceiptSchema.parse(result.failure_receipt)).toMatchObject({
        receipt_kind: "TOOL_POLICY_FAILURE",
        authority: "NON_AUTHORITATIVE_RUNTIME",
        code: "TEAM_TOOL_NOT_ALLOWED",
        tool_call_id: TOOL_CALL_ID,
        task_id: PARENT_TASK_ID,
        attempt_id: PARENT_ATTEMPT_ID,
        scope: APP_SCOPE,
        run_id: RUN_ID,
        role: "research-supervisor",
        tool_name: "sql.execute",
        policy_version: "team-policy-v1",
      });
      expect(JSON.stringify(result.failure_receipt)).not.toContain("select secret");
    }
  });

  it("拒绝不符合服务端 Input Schema 的参数和未注册 Descriptor", async () => {
    const invalidArguments = await authorizeTeamToolCall(
      makeParentTask(),
      {
        ...allowedCandidate,
        arguments: {
          metric: 42,
        },
      },
      security(),
    );
    const missingDescriptor = await authorizeTeamToolCall(
      {
        ...makeParentTask(),
        tool_policy: {
          policy_version: "team-policy-v1",
          allowlist: ["server.missing"],
        },
      },
      {
        ...allowedCandidate,
        tool_name: "server.missing",
      },
      security(),
    );

    expect(invalidArguments).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_ARGUMENTS_INVALID" },
    });
    expect(missingDescriptor).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_NOT_REGISTERED" },
    });
  });

  it("拒绝跨 Task、跨 Scope 和夹带未知授权字段的 Tool Call", async () => {
    await expect(
      authorizeTeamToolCall(
        makeParentTask(),
        {
          ...allowedCandidate,
          schema_version: "2.0.0",
        },
        security(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_CALL_CORRELATION_MISMATCH",
    });
    await expect(
      authorizeTeamToolCall(
        makeParentTask(),
        {
          ...allowedCandidate,
          task_id: SECOND_TOOL_CALL_ID,
        },
        security(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_CALL_CORRELATION_MISMATCH",
    });
    await expect(
      authorizeTeamToolCall(
        makeParentTask(),
        {
          ...allowedCandidate,
          scope: {
            ...APP_SCOPE,
            tenant_id: SECOND_TOOL_CALL_ID,
          },
        },
        security(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_CALL_CORRELATION_MISMATCH",
    });
    expect(() =>
      toolCallCandidateSchema.parse({
        ...allowedCandidate,
        tool_allowlist: ["sql.execute"],
      }),
    ).toThrow();
  });

  it("拒绝重复 Task allowlist、零预算与超出字节边界的参数", async () => {
    await expect(
      authorizeTeamToolCall(
        {
          ...makeParentTask(),
          tool_policy: {
            policy_version: "team-policy-v1",
            allowlist: ["semantic.catalog.read", "semantic.catalog.read"],
          },
        },
        allowedCandidate,
        security(),
      ),
    ).rejects.toBeDefined();

    const zeroBudget = await authorizeTeamToolCall(
      {
        ...makeParentTask(),
        budget: {
          ...makeParentTask().budget,
          max_tool_calls: 0,
        },
      },
      allowedCandidate,
      security(),
    );
    expect(zeroBudget).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_BUDGET_EXHAUSTED" },
    });

    expect(() =>
      toolCallCandidateSchema.parse({
        ...allowedCandidate,
        arguments: {
          payload: "x".repeat(70_000),
        },
      }),
    ).toThrow();
  });

  it("DENY Policy 与非网络 Descriptor 都拒绝 HTTPS 候选", async () => {
    const taskDenied = await authorizeTeamToolCall(
      {
        ...makeParentTask(),
        tool_policy: {
          policy_version: "team-policy-v1",
          allowlist: ["network.fetch"],
        },
      },
      networkCandidate(),
      security(),
    );
    const descriptorDenied = await authorizeTeamToolCall(
      networkTask(),
      {
        ...allowedCandidate,
        network_access: {
          mode: "HTTPS",
          origin: "https://api.example.com",
        },
      },
      security(),
    );

    expect(taskDenied).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_NETWORK_DENIED" },
    });
    expect(descriptorDenied).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_NETWORK_DENIED" },
    });
  });

  it("HTTPS Tool 必须显式提供 allowlist origin，并拒绝私网或未登记 Origin", async () => {
    const missingMetadata = await authorizeTeamToolCall(
      networkTask(),
      {
        ...networkCandidate(),
        network_access: { mode: "NONE" },
      },
      security(),
    );
    const privateOrigin = await authorizeTeamToolCall(
      networkTask("https://127.0.0.1"),
      networkCandidate("https://127.0.0.1"),
      security(),
    );
    const notAllowed = await authorizeTeamToolCall(
      networkTask(),
      networkCandidate("https://other.example.com"),
      security(),
    );

    expect(missingMetadata).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_NETWORK_METADATA_REQUIRED" },
    });
    expect(privateOrigin).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_NETWORK_PRIVATE_ORIGIN" },
    });
    expect(notAllowed).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_NETWORK_ORIGIN_NOT_ALLOWED" },
    });
    expect(() =>
      toolCallCandidateSchema.parse(networkCandidate("http://api.example.com")),
    ).toThrow();
  });

  it("预算 Reservation 按 Scope/Run/Task/Attempt 原子计数，重放失败关闭且不重复扣减", async () => {
    const ledger = new InMemoryAtomicTeamToolBudgetReservationLedger();
    const sharedSecurity = security(ledger);
    const task = {
      ...makeParentTask(),
      budget: {
        ...makeParentTask().budget,
        max_tool_calls: 1,
      },
    };

    const first = await authorizeTeamToolCall(task, allowedCandidate, sharedSecurity);
    const replay = await authorizeTeamToolCall(task, allowedCandidate, sharedSecurity);
    const exhausted = await authorizeTeamToolCall(
      task,
      {
        ...allowedCandidate,
        tool_call_id: SECOND_TOOL_CALL_ID,
      },
      sharedSecurity,
    );

    expect(first).toMatchObject({
      ok: true,
      value: { budget_reservation: { status: "RESERVED", ordinal: 1 } },
    });
    expect(replay).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_REPLAY_RESULT_REQUIRED" },
    });
    expect(exhausted).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_BUDGET_EXHAUSTED" },
    });
  });

  it("非幂等 Tool 重放不能取得新的可执行 Sink Authority", async () => {
    const ledger = new InMemoryAtomicTeamToolBudgetReservationLedger();
    const task = {
      ...makeParentTask(),
      tool_policy: {
        policy_version: "team-policy-v1",
        allowlist: ["artifact.commit"],
      },
    };
    const candidate = {
      ...allowedCandidate,
      tool_name: "artifact.commit",
      arguments: {
        revision: 1,
      },
    };
    let committedRevisions = 0;

    const execute = async (authorization: AuthorizedTeamToolCall) => {
      await authorizeTeamToolSinkInvocation(authorization, noNetworkSinkRevalidator);
      committedRevisions += 1;
    };

    const first = await authorizeTeamToolCall(task, candidate, security(ledger));
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("Fixture 必须先取得首次 Tool Authority。");
    }
    await execute(first.value);

    const replay = await authorizeTeamToolCall(task, candidate, security(ledger));
    if (replay.ok) {
      await execute(replay.value);
    }

    expect(replay).toMatchObject({
      ok: false,
      failure_receipt: { code: "TEAM_TOOL_REPLAY_RESULT_REQUIRED" },
    });
    expect(committedRevisions).toBe(1);
  });

  it("并发正预算只能产生一个新 Reservation，且同 call id 异载荷显式冲突", async () => {
    const ledger = new InMemoryAtomicTeamToolBudgetReservationLedger();
    const sharedSecurity = security(ledger);
    const task = {
      ...makeParentTask(),
      budget: {
        ...makeParentTask().budget,
        max_tool_calls: 1,
      },
    };
    const concurrent = await Promise.all([
      authorizeTeamToolCall(task, allowedCandidate, sharedSecurity),
      authorizeTeamToolCall(
        task,
        { ...allowedCandidate, tool_call_id: SECOND_TOOL_CALL_ID },
        sharedSecurity,
      ),
    ]);

    expect(concurrent.filter(({ ok }) => ok)).toHaveLength(1);
    expect(concurrent.filter(({ ok }) => !ok)).toHaveLength(1);

    await expect(
      authorizeTeamToolCall(
        task,
        {
          ...allowedCandidate,
          arguments: { metric: "profit" },
        },
        sharedSecurity,
      ),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_RESERVATION_CONFLICT",
    });
  });

  it("真实 Tool Sink 必须重新绑定同一 Policy 与 Network Origin 后才取得品牌", async () => {
    const authorizeFreshNetworkCall = () =>
      authorizeTeamToolCall(networkTask(), networkCandidate(), security());
    const authorized = await authorizeFreshNetworkCall();
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      throw new Error("Fixture 必须先取得运行时授权。");
    }

    const sinkInvocation = await authorizeTeamToolSinkInvocation(authorized.value, {
      async revalidate(input) {
        return {
          schema_version: input.schema_version,
          tool_call_id: input.tool_call_id,
          task_id: input.task_id,
          attempt_id: input.attempt_id,
          scope: input.scope,
          run_id: input.run_id,
          policy_version: input.policy_version,
          network_access: input.network_access,
          requested_origin:
            input.network_access.mode === "HTTPS" ? input.network_access.origin : null,
          final_origin: input.network_access.mode === "HTTPS" ? input.network_access.origin : null,
          redirect_origins: [],
          resolved_ips: ["8.8.8.8"],
          revalidated: true,
        };
      },
    });
    expect(isAuthoritativeTeamToolSinkInvocation(sinkInvocation)).toBe(true);

    let repeatedRevalidationCalled = false;
    await expect(
      authorizeTeamToolSinkInvocation(authorized.value, {
        async revalidate() {
          repeatedRevalidationCalled = true;
          return {};
        },
      }),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_CALL_CORRELATION_MISMATCH",
    });
    expect(repeatedRevalidationCalled).toBe(false);

    const mismatched = await authorizeFreshNetworkCall();
    if (!mismatched.ok) {
      throw new Error("Fixture 必须取得独立的运行时授权。");
    }
    await expect(
      authorizeTeamToolSinkInvocation(mismatched.value, {
        async revalidate(input) {
          return {
            schema_version: input.schema_version,
            tool_call_id: input.tool_call_id,
            task_id: input.task_id,
            attempt_id: input.attempt_id,
            scope: input.scope,
            run_id: input.run_id,
            policy_version: input.policy_version,
            network_access: {
              mode: "HTTPS",
              origin: "https://other.example.com",
            },
            requested_origin: "https://other.example.com",
            final_origin: "https://other.example.com",
            redirect_origins: [],
            resolved_ips: ["8.8.8.8"],
            revalidated: true,
          };
        },
      }),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_CALL_CORRELATION_MISMATCH",
    });

    const privateRedirect = await authorizeFreshNetworkCall();
    if (!privateRedirect.ok) {
      throw new Error("Fixture 必须取得独立的运行时授权。");
    }
    await expect(
      authorizeTeamToolSinkInvocation(privateRedirect.value, {
        async revalidate(input) {
          return {
            schema_version: input.schema_version,
            tool_call_id: input.tool_call_id,
            task_id: input.task_id,
            attempt_id: input.attempt_id,
            scope: input.scope,
            run_id: input.run_id,
            policy_version: input.policy_version,
            network_access: input.network_access,
            requested_origin: "https://api.example.com",
            final_origin: "https://api.example.com",
            redirect_origins: ["https://other.example.com"],
            resolved_ips: ["127.0.0.1"],
            revalidated: true,
          };
        },
      }),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_CALL_CORRELATION_MISMATCH",
    });
  });
});
