import { Buffer } from "node:buffer";
import {
  type AppScope,
  authorizeExternalAgentAuditReceipt,
  authorizeExternalAgentInvocation,
  type ExternalAgentAuditReceipt,
  type ExternalAgentEvent,
  type ExternalAgentProfile,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  BoundedExternalAgentAdapter,
  createTrustedExternalAgentProcessHost,
  type ExternalAgentCompletionAuthority,
  type ExternalAgentOutputSecurity,
  type ExternalAgentProcessSession,
  type ExternalAgentProcessStartInput,
  type ExternalAgentProcessTerminationRequest,
  ServerExternalAgentRegistry,
} from "../src/external-agents/index.js";

const ids = {
  app: "60000000-0000-4000-8000-000000000001",
  tenant: "60000000-0000-4000-8000-000000000002",
  otherTenant: "60000000-0000-4000-8000-000000000003",
  run: "60000000-0000-4000-8000-000000000004",
  otherRun: "60000000-0000-4000-8000-000000000005",
  profile: "60000000-0000-4000-8000-000000000006",
  invocation: "60000000-0000-4000-8000-000000000007",
  attempt: "60000000-0000-4000-8000-000000000008",
  task: "60000000-0000-4000-8000-000000000009",
  receipt: "60000000-0000-4000-8000-000000000010",
  session: "60000000-0000-4000-8000-000000000011",
} as const;

const scope = {
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
} as const satisfies AppScope;

const profile = {
  profile_id: ids.profile,
  profile_version: "1.0.0",
  scope,
  kind: "EXTERNAL_AGENT",
  adapter: "test-external-agent",
  workspace_policy: {
    roots: ["/workspace/data-agent"],
    writable: false,
  },
  permission_policy: {
    allowed_tools: ["read"],
    allowed_command_ids: ["git.status"],
  },
  cancellation: {
    supported: true,
    timeout_ms: 30_000,
  },
  audit: {
    required: true,
    receipt_schema_version: "1.0.0",
  },
} as const satisfies ExternalAgentProfile;

function makeRequest(
  budget: {
    readonly timeout_ms: number;
    readonly max_output_bytes: number;
    readonly max_actions: number;
  } = {
    timeout_ms: 10_000,
    max_output_bytes: 1_024,
    max_actions: 2,
  },
) {
  return {
    schema_version: "1.0.0",
    invocation_id: ids.invocation,
    attempt_id: ids.attempt,
    scope,
    run_id: ids.run,
    profile_id: ids.profile,
    profile_version: "1.0.0",
    adapter: "test-external-agent",
    task_ref: {
      artifact_id: ids.task,
      artifact_type: "QuestionFrame",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: `sha256:${"a".repeat(64)}`,
    },
    context_refs: [],
    workspace_policy: {
      roots: ["/workspace/data-agent"],
      writable: false,
    },
    permission_policy: {
      allowed_tools: ["read"],
      allowed_command_ids: ["git.status"],
    },
    budget,
  } as const;
}

function auditReceiptRef() {
  return {
    artifact_id: ids.receipt,
    artifact_type: "ExternalAgentAuditReceipt",
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: `sha256:${"b".repeat(64)}`,
  } as const;
}

function outputSecurity(): ExternalAgentOutputSecurity {
  const containsSecret = (value: string) =>
    /authorization\s*:\s*bearer|(?:api[_-]?key|password)\s*[:=]/i.test(value);
  return {
    async scan({ delta }) {
      return { contains_secret: containsSecret(delta) };
    },
    async redact() {
      return { delta: "[REDACTED]" };
    },
  };
}

function completionAuthority(
  options: {
    readonly committed?: boolean;
    readonly mutate?: (receipt: ExternalAgentAuditReceipt) => unknown;
  } = {},
): ExternalAgentCompletionAuthority {
  return {
    async authorize({ receipt_ref, expectation }) {
      const invocation = expectation.invocation;
      const receipt = {
        schema_version: invocation.schema_version,
        receipt_ref,
        scope: invocation.scope,
        run_id: invocation.run_id,
        invocation_id: invocation.invocation_id,
        attempt_id: invocation.attempt_id,
        profile_id: invocation.profile_id,
        profile_version: invocation.profile_version,
        adapter: invocation.adapter,
        workspace_policy_hash: expectation.workspace_policy_hash,
        permission_policy_hash: expectation.permission_policy_hash,
        action_log_hash: expectation.action_log_hash,
        output_hash: expectation.output_hash,
        action_count: expectation.action_count,
        output_bytes: expectation.output_bytes,
        process_terminal: "EXITED",
        terminal: "COMPLETED",
        reason_code: "EXTERNAL_AGENT_COMPLETED",
        completed_at: "2026-07-25T00:00:00.000Z",
      } as const satisfies ExternalAgentAuditReceipt;
      return authorizeExternalAgentAuditReceipt(receipt_ref, expectation, {
        resolve: async () => options.mutate?.(receipt) ?? receipt,
        verifyCommitted: async () => options.committed ?? true,
      });
    },
  };
}

function terminationConfirmation(request: ExternalAgentProcessTerminationRequest) {
  return {
    schema_version: request.schema_version,
    session_id: request.session_id,
    invocation_id: request.invocation_id,
    attempt_id: request.attempt_id,
    scope: request.scope,
    run_id: request.run_id,
    process_terminal: "EXITED",
    reason_code: request.reason_code,
  } as const;
}

async function createHarness(
  execute: () => AsyncIterable<unknown>,
  options: {
    readonly limits?: {
      readonly max_timeout_ms: number;
      readonly max_termination_confirmation_ms: number;
      readonly max_output_bytes: number;
      readonly max_actions: number;
    };
    readonly budget?: Parameters<typeof makeRequest>[0];
    readonly terminate?: (request: ExternalAgentProcessTerminationRequest) => Promise<unknown>;
    readonly start?: (
      input: ExternalAgentProcessStartInput,
    ) => Promise<ExternalAgentProcessSession> | ExternalAgentProcessSession;
    readonly output_security?: ExternalAgentOutputSecurity;
    readonly completion_authority?: ExternalAgentCompletionAuthority;
  } = {},
) {
  const registry = new ServerExternalAgentRegistry();
  registry.register({
    enabled: true,
    profile,
    limits: options.limits ?? {
      max_timeout_ms: 20_000,
      max_termination_confirmation_ms: 100,
      max_output_bytes: 2_048,
      max_actions: 4,
    },
    process_host: createTrustedExternalAgentProcessHost({
      async start(input) {
        if (options.start) {
          return options.start(input);
        }
        return {
          session_id: ids.session,
          events: execute(),
          requestTermination:
            options.terminate ??
            (async (request) => {
              return terminationConfirmation(request);
            }),
        };
      },
    }),
  });
  const invocation = await authorizeExternalAgentInvocation(
    makeRequest(options.budget),
    registry.resolveProfile,
  );
  return {
    adapter: new BoundedExternalAgentAdapter(registry, {
      output_security: options.output_security ?? outputSecurity(),
      completion_authority: options.completion_authority ?? completionAuthority(),
    }),
    invocation,
  };
}

async function collect(events: AsyncIterable<ExternalAgentEvent>): Promise<ExternalAgentEvent[]> {
  const collected: ExternalAgentEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function permittedArtifactAction() {
  return {
    event_type: "AUDIT_ACTION",
    action_kind: "TOOL",
    action: "read",
    effect: "READ",
    target: {
      kind: "ARTIFACT_REFERENCE",
      reference: makeRequest().task_ref,
    },
    verdict: "ALLOWED",
  } as const;
}

describe("BoundedExternalAgentAdapter", () => {
  it("只在受信 Host 确认退出且权威 Receipt 已提交后投影唯一完成态", async () => {
    const { adapter, invocation } = await createHarness(async function* () {
      yield permittedArtifactAction();
      yield {
        event_type: "OUTPUT_DELTA",
        channel: "stdout",
        delta: "分析完成",
      };
      yield {
        event_type: "PROCESS_EXITED",
        exit_code: 0,
        audit_receipt_ref: auditReceiptRef(),
      };
    });

    const events = await collect(adapter.stream(invocation));

    expect(events.map(({ event_type }) => event_type)).toEqual([
      "STARTED",
      "AUDIT_ACTION",
      "OUTPUT_DELTA",
      "COMPLETED",
    ]);
    expect(
      events.map(({ sequence }) => sequence).every((sequence, index) => sequence === index),
    ).toBe(true);
  });

  it("拒绝 Host 自报但未由持久化 Authority 提交的 Receipt", async () => {
    const { adapter, invocation } = await createHarness(
      async function* () {
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        completion_authority: completionAuthority({ committed: false }),
      },
    );

    const events = await collect(adapter.stream(invocation));

    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE",
    });
    expect(events.some(({ event_type }) => event_type === "COMPLETED")).toBe(false);
  });

  it("拒绝 Receipt 篡改 Invocation/Policy/Action/Output 绑定", async () => {
    const { adapter, invocation } = await createHarness(
      async function* () {
        yield permittedArtifactAction();
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        completion_authority: completionAuthority({
          mutate: (receipt) => ({
            ...receipt,
            action_count: receipt.action_count + 1,
          }),
        }),
      },
    );

    const events = await collect(adapter.stream(invocation));

    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE",
    });
  });

  it("输出先扫描再脱敏，明文 Secret 不进入流事件或完成 Receipt 计数", async () => {
    const secret = "Authorization: Bearer external-super-secret";
    const { adapter, invocation } = await createHarness(async function* () {
      yield {
        event_type: "OUTPUT_DELTA",
        channel: "stdout",
        delta: secret,
      };
      yield {
        event_type: "PROCESS_EXITED",
        exit_code: 0,
        audit_receipt_ref: auditReceiptRef(),
      };
    });

    const events = await collect(adapter.stream(invocation));

    expect(JSON.stringify(events)).not.toContain(secret);
    expect(events).toContainEqual(expect.objectContaining({ delta: "[REDACTED]" }));
    expect(events.at(-1)).toMatchObject({ event_type: "COMPLETED" });
  });

  it("跨 chunk 拆分的 Secret 在 Invocation 级缓冲扫描后仍会被脱敏", async () => {
    const { adapter, invocation } = await createHarness(async function* () {
      yield {
        event_type: "OUTPUT_DELTA",
        channel: "stdout",
        delta: "Authorization: Bear",
      };
      yield {
        event_type: "OUTPUT_DELTA",
        channel: "stdout",
        delta: "er split-super-secret",
      };
      yield {
        event_type: "PROCESS_EXITED",
        exit_code: 0,
        audit_receipt_ref: auditReceiptRef(),
      };
    });

    const events = await collect(adapter.stream(invocation));
    const serialized = JSON.stringify(events);

    expect(serialized).not.toContain("Authorization: Bear");
    expect(serialized).not.toContain("split-super-secret");
    expect(events.filter(({ event_type }) => event_type === "OUTPUT_DELTA")).toEqual([
      expect.objectContaining({
        channel: "stdout",
        delta: "[REDACTED]",
      }),
    ]);
    expect(events.at(-1)).toMatchObject({ event_type: "COMPLETED" });
  });

  it("缓冲扫描后仍按 Process Event 顺序投影 stdout、stderr 与 Audit", async () => {
    const { adapter, invocation } = await createHarness(async function* () {
      yield {
        event_type: "OUTPUT_DELTA",
        channel: "stdout",
        delta: "first",
      };
      yield permittedArtifactAction();
      yield {
        event_type: "OUTPUT_DELTA",
        channel: "stderr",
        delta: "second",
      };
      yield {
        event_type: "OUTPUT_DELTA",
        channel: "stdout",
        delta: "third",
      };
      yield {
        event_type: "PROCESS_EXITED",
        exit_code: 0,
        audit_receipt_ref: auditReceiptRef(),
      };
    });

    const events = await collect(adapter.stream(invocation));
    const processProjection = events.flatMap((event) => {
      if (event.event_type === "OUTPUT_DELTA") {
        return [`${event.channel}:${event.delta}`];
      }
      if (event.event_type === "AUDIT_ACTION") {
        return [`audit:${event.action}`];
      }
      return [];
    });

    expect(processProjection).toEqual([
      "stdout:first",
      "audit:read",
      "stderr:second",
      "stdout:third",
    ]);
  });

  it("脱敏后的大缓冲按 UTF-8 安全边界重分块且每个公开 Delta 不超过十万字符", async () => {
    const secret = "password=short";
    const protectedDelta = `${"x".repeat(99_999)}😀${"y".repeat(10)}`;
    const { adapter, invocation } = await createHarness(
      async function* () {
        yield {
          event_type: "OUTPUT_DELTA",
          channel: "stdout",
          delta: secret,
        };
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        limits: {
          max_timeout_ms: 20_000,
          max_termination_confirmation_ms: 100,
          max_output_bytes: 300_000,
          max_actions: 4,
        },
        budget: {
          timeout_ms: 10_000,
          max_output_bytes: 300_000,
          max_actions: 2,
        },
        output_security: {
          async scan({ delta }) {
            return { contains_secret: delta === secret };
          },
          async redact() {
            return { delta: protectedDelta };
          },
        },
      },
    );

    const events = await collect(adapter.stream(invocation));
    const outputDeltas = events.flatMap((event) =>
      event.event_type === "OUTPUT_DELTA" ? [event.delta] : [],
    );

    expect(outputDeltas.join("")).toBe(protectedDelta);
    expect(outputDeltas.length).toBeGreaterThan(1);
    expect(outputDeltas.every((delta) => delta.length <= 100_000)).toBe(true);
    expect(
      outputDeltas.every((delta) => Buffer.from(delta, "utf8").toString("utf8") === delta),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ event_type: "COMPLETED" });
  });

  it("扫描器、脱敏器失败或脱敏后仍命中 Secret 时失败关闭", async () => {
    const secret = "Authorization: Bearer external-super-secret";
    const { adapter, invocation } = await createHarness(
      async function* () {
        yield {
          event_type: "OUTPUT_DELTA",
          channel: "stderr",
          delta: secret,
        };
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        output_security: {
          async scan() {
            return { contains_secret: true };
          },
          async redact() {
            return { delta: secret };
          },
        },
      },
    );

    const events = await collect(adapter.stream(invocation));

    expect(JSON.stringify(events)).not.toContain(secret);
    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "EXTERNAL_AGENT_OUTPUT_SECURITY_FAILED",
    });
  });

  it("脱敏器扩大输出后重新校验字节预算，且不会泄露部分输出", async () => {
    const secret = "password=short";
    const { adapter, invocation } = await createHarness(
      async function* () {
        yield {
          event_type: "OUTPUT_DELTA",
          channel: "stdout",
          delta: secret,
        };
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        limits: {
          max_timeout_ms: 20_000,
          max_termination_confirmation_ms: 100,
          max_output_bytes: 16,
          max_actions: 4,
        },
        output_security: {
          async scan({ delta }) {
            return { contains_secret: delta === secret };
          },
          async redact() {
            return { delta: "[REDACTED OUTPUT EXCEEDS BUDGET]" };
          },
        },
      },
    );

    const events = await collect(adapter.stream(invocation));

    expect(events.some(({ event_type }) => event_type === "OUTPUT_DELTA")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "EXTERNAL_AGENT_OUTPUT_BUDGET_EXCEEDED",
    });
  });

  it("拒绝未授权动作、Workspace 越界目标与只读 Workspace 写入", async () => {
    const attacks = [
      {
        event_type: "AUDIT_ACTION",
        action_kind: "COMMAND",
        action: "git.push",
        effect: "WRITE",
        target: { kind: "WORKSPACE_PATH", path: "/workspace/data-agent" },
        verdict: "ALLOWED",
      },
      {
        event_type: "AUDIT_ACTION",
        action_kind: "TOOL",
        action: "read",
        effect: "READ",
        target: { kind: "WORKSPACE_PATH", path: "/etc/passwd" },
        verdict: "ALLOWED",
      },
      {
        event_type: "AUDIT_ACTION",
        action_kind: "TOOL",
        action: "read",
        effect: "WRITE",
        target: { kind: "WORKSPACE_PATH", path: "/workspace/data-agent/result.txt" },
        verdict: "ALLOWED",
      },
    ] as const;

    for (const attack of attacks) {
      const terminationReasons: string[] = [];
      const { adapter, invocation } = await createHarness(
        async function* () {
          yield attack;
        },
        {
          terminate: async (request) => {
            terminationReasons.push(request.reason_code);
            return terminationConfirmation(request);
          },
        },
      );
      const events = await collect(adapter.stream(invocation));
      expect(terminationReasons).toEqual(["EXTERNAL_AGENT_PERMISSION_VIOLATION"]);
      expect(events.at(-1)).toMatchObject({
        event_type: "FAILED",
        reason_code: "EXTERNAL_AGENT_PERMISSION_VIOLATION",
      });
    }
  });

  it("Host 上报 BLOCKED 动作时只公开目标哈希，不把原始敏感目标写入事件", async () => {
    const sensitiveTarget = "/workspace/data-agent/api_key=external-super-secret";
    const { adapter, invocation } = await createHarness(async function* () {
      yield {
        event_type: "AUDIT_ACTION",
        action_kind: "TOOL",
        action: "read",
        effect: "READ",
        target: { kind: "WORKSPACE_PATH", path: sensitiveTarget },
        verdict: "BLOCKED",
      };
      yield {
        event_type: "PROCESS_EXITED",
        exit_code: 0,
        audit_receipt_ref: auditReceiptRef(),
      };
    });

    const events = await collect(adapter.stream(invocation));
    const serialized = JSON.stringify(events);

    expect(serialized).not.toContain(sensitiveTarget);
    expect(serialized).not.toContain("external-super-secret");
    expect(events).toContainEqual(
      expect.objectContaining({
        event_type: "AUDIT_ACTION",
        verdict: "BLOCKED",
        target: expect.stringMatching(/^blocked-target:sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(events.at(-1)).toMatchObject({ event_type: "COMPLETED" });
  });

  it.each([
    {
      title: "输出预算",
      limits: {
        max_timeout_ms: 20_000,
        max_termination_confirmation_ms: 100,
        max_output_bytes: 3,
        max_actions: 4,
      },
      budget: { timeout_ms: 10_000, max_output_bytes: 1_024, max_actions: 2 },
      execute: async function* () {
        yield { event_type: "OUTPUT_DELTA", channel: "stdout", delta: "四字节" };
      },
      reason: "EXTERNAL_AGENT_OUTPUT_BUDGET_EXCEEDED",
    },
    {
      title: "动作预算",
      limits: {
        max_timeout_ms: 20_000,
        max_termination_confirmation_ms: 100,
        max_output_bytes: 2_048,
        max_actions: 1,
      },
      budget: { timeout_ms: 10_000, max_output_bytes: 1_024, max_actions: 2 },
      execute: async function* () {
        yield permittedArtifactAction();
        yield permittedArtifactAction();
      },
      reason: "EXTERNAL_AGENT_ACTION_BUDGET_EXCEEDED",
    },
  ])("$title 超限时失败关闭", async ({ limits, budget, execute, reason }) => {
    const { adapter, invocation } = await createHarness(execute, { limits, budget });

    const events = await collect(adapter.stream(invocation));

    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: reason,
    });
    expect(events.some(({ event_type }) => event_type === "COMPLETED")).toBe(false);
  });

  it("只有 Host 返回精确 EXITED 确认后取消才成功并产生 CANCELLED", async () => {
    const { adapter, invocation } = await createHarness(
      async function* () {
        await new Promise(() => undefined);
      },
      {
        terminate: async (request) => {
          return terminationConfirmation(request);
        },
      },
    );
    const iterator = adapter.stream(invocation)[Symbol.asyncIterator]();
    await iterator.next();
    const pendingTerminal = iterator.next();

    await expect(
      adapter.cancel({
        schema_version: "1.0.0",
        invocation_id: ids.invocation,
        attempt_id: ids.attempt,
        scope,
        run_id: ids.run,
        reason_code: "USER_CANCELLED",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        cancelled: true,
        attempt_id: ids.attempt,
      },
    });
    await expect(pendingTerminal).resolves.toMatchObject({
      value: {
        event_type: "CANCELLED",
        reason_code: "USER_CANCELLED",
      },
      done: false,
    });
  });

  it("Host 忽略取消或返回错关联确认时不能宣称取消成功", async () => {
    let release: (() => void) | undefined;
    const { adapter, invocation } = await createHarness(
      async function* () {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        terminate: async (request) => ({
          ...terminationConfirmation(request),
          attempt_id: "60000000-0000-4000-8000-000000000099",
        }),
      },
    );
    const iterator = adapter.stream(invocation)[Symbol.asyncIterator]();
    await iterator.next();
    const pendingTerminal = iterator.next();

    await expect(
      adapter.cancel({
        schema_version: "1.0.0",
        invocation_id: ids.invocation,
        attempt_id: ids.attempt,
        scope,
        run_id: ids.run,
        reason_code: "USER_CANCELLED",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED" },
    });

    release?.();
    await expect(pendingTerminal).resolves.toMatchObject({
      value: { event_type: "COMPLETED" },
    });
  });

  it("取消请求必须匹配精确 Scope/Run/Attempt，旧 Attempt 不能取消新尝试", async () => {
    let release: (() => void) | undefined;
    const { adapter, invocation } = await createHarness(async function* () {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const iterator = adapter.stream(invocation)[Symbol.asyncIterator]();
    await iterator.next();
    const pendingTerminal = iterator.next();

    await expect(
      adapter.cancel({
        schema_version: "1.0.0",
        invocation_id: ids.invocation,
        attempt_id: ids.attempt,
        scope: { ...scope, tenant_id: ids.otherTenant },
        run_id: ids.run,
        reason_code: "USER_CANCELLED",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EXTERNAL_AGENT_INVOCATION_NOT_ACTIVE" },
    });
    await expect(
      adapter.cancel({
        schema_version: "1.0.0",
        invocation_id: ids.invocation,
        attempt_id: ids.attempt,
        scope,
        run_id: ids.otherRun,
        reason_code: "USER_CANCELLED",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EXTERNAL_AGENT_INVOCATION_NOT_ACTIVE" },
    });
    await expect(
      adapter.cancel({
        schema_version: "1.0.0",
        invocation_id: ids.invocation,
        attempt_id: "60000000-0000-4000-8000-000000000099",
        scope,
        run_id: ids.run,
        reason_code: "USER_CANCELLED",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EXTERNAL_AGENT_INVOCATION_NOT_ACTIVE" },
    });

    release?.();
    await expect(pendingTerminal).resolves.toMatchObject({
      value: {
        event_type: "FAILED",
        reason_code: "EXTERNAL_AGENT_PROTOCOL_INCOMPLETE",
      },
    });
  });

  it("Process Host start 挂起时总预算仍会中止边界并失败关闭", async () => {
    let abortObserved = false;
    const { adapter, invocation } = await createHarness(
      async function* () {
        yield* [];
      },
      {
        limits: {
          max_timeout_ms: 20,
          max_termination_confirmation_ms: 10,
          max_output_bytes: 2_048,
          max_actions: 4,
        },
        budget: { timeout_ms: 20, max_output_bytes: 1_024, max_actions: 2 },
        start: async ({ signal }) => {
          signal.addEventListener(
            "abort",
            () => {
              abortObserved = true;
            },
            { once: true },
          );
          return new Promise(() => undefined);
        },
      },
    );

    const events = await collect(adapter.stream(invocation));

    expect(abortObserved).toBe(true);
    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "EXTERNAL_AGENT_TIMEOUT",
    });
  });

  it("Output Scanner 或 Completion Authority 挂起时不会绕过总预算", async () => {
    const hangingOutput = await createHarness(
      async function* () {
        yield {
          event_type: "OUTPUT_DELTA",
          channel: "stdout",
          delta: "safe",
        };
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        limits: {
          max_timeout_ms: 20,
          max_termination_confirmation_ms: 10,
          max_output_bytes: 2_048,
          max_actions: 4,
        },
        budget: { timeout_ms: 20, max_output_bytes: 1_024, max_actions: 2 },
        output_security: {
          async scan() {
            return new Promise(() => undefined);
          },
          async redact() {
            return { delta: "[REDACTED]" };
          },
        },
      },
    );
    const hangingAuthority = await createHarness(
      async function* () {
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        limits: {
          max_timeout_ms: 20,
          max_termination_confirmation_ms: 10,
          max_output_bytes: 2_048,
          max_actions: 4,
        },
        budget: { timeout_ms: 20, max_output_bytes: 1_024, max_actions: 2 },
        completion_authority: {
          async authorize() {
            return new Promise(() => undefined);
          },
        },
      },
    );

    for (const harness of [hangingOutput, hangingAuthority]) {
      const events = await collect(harness.adapter.stream(harness.invocation));
      expect(events.at(-1)).toMatchObject({
        event_type: "FAILED",
        reason_code: "EXTERNAL_AGENT_TIMEOUT",
      });
    }
  });

  it("Host 终止确认 Promise 挂起时 cancel 在独立上限内返回未确认", async () => {
    let release: (() => void) | undefined;
    const { adapter, invocation } = await createHarness(
      async function* () {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield {
          event_type: "PROCESS_EXITED",
          exit_code: 0,
          audit_receipt_ref: auditReceiptRef(),
        };
      },
      {
        limits: {
          max_timeout_ms: 1_000,
          max_termination_confirmation_ms: 20,
          max_output_bytes: 2_048,
          max_actions: 4,
        },
        terminate: async () => new Promise(() => undefined),
      },
    );
    const iterator = adapter.stream(invocation)[Symbol.asyncIterator]();
    await iterator.next();
    const pendingTerminal = iterator.next();

    await expect(
      adapter.cancel({
        schema_version: "1.0.0",
        invocation_id: ids.invocation,
        attempt_id: ids.attempt,
        scope,
        run_id: ids.run,
        reason_code: "USER_CANCELLED",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED" },
    });

    release?.();
    await expect(pendingTerminal).resolves.toMatchObject({
      value: { event_type: "COMPLETED" },
    });
  });

  it("Deadline 与用户取消并发时不复用不同 reason 的终止确认，Deadline 不可逆获胜", async () => {
    const terminationReasons: string[] = [];
    const { adapter, invocation } = await createHarness(
      async function* () {
        await new Promise(() => undefined);
      },
      {
        limits: {
          max_timeout_ms: 20,
          max_termination_confirmation_ms: 100,
          max_output_bytes: 2_048,
          max_actions: 4,
        },
        budget: { timeout_ms: 20, max_output_bytes: 1_024, max_actions: 2 },
        terminate: async (request) => {
          terminationReasons.push(request.reason_code);
          await new Promise((resolve) => setTimeout(resolve, 40));
          return terminationConfirmation(request);
        },
      },
    );
    const iterator = adapter.stream(invocation)[Symbol.asyncIterator]();
    await iterator.next();
    const pendingTerminal = iterator.next();
    const cancellation = adapter.cancel({
      schema_version: "1.0.0",
      invocation_id: ids.invocation,
      attempt_id: ids.attempt,
      scope,
      run_id: ids.run,
      reason_code: "USER_CANCELLED",
    });

    await expect(pendingTerminal).resolves.toMatchObject({
      value: {
        event_type: "FAILED",
        reason_code: "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED",
      },
    });
    await expect(cancellation).resolves.toMatchObject({
      ok: false,
      error: { code: "EXTERNAL_AGENT_INVOCATION_NOT_ACTIVE" },
    });
    expect(terminationReasons).toEqual(["USER_CANCELLED"]);
  });

  it("运行超时先要求 Host 确认退出，再投影唯一 FAILED 终态", async () => {
    let terminationObserved = false;
    const { adapter, invocation } = await createHarness(
      async function* () {
        await new Promise(() => undefined);
      },
      {
        limits: {
          max_timeout_ms: 50,
          max_termination_confirmation_ms: 20,
          max_output_bytes: 2_048,
          max_actions: 4,
        },
        budget: { timeout_ms: 20, max_output_bytes: 1_024, max_actions: 2 },
        terminate: async (request) => {
          terminationObserved = true;
          return terminationConfirmation(request);
        },
      },
    );

    const events = await collect(adapter.stream(invocation));

    expect(terminationObserved).toBe(true);
    expect(events.filter(({ event_type }) => ["FAILED", "CANCELLED"].includes(event_type))).toEqual(
      [
        expect.objectContaining({
          event_type: "FAILED",
          reason_code: "EXTERNAL_AGENT_TIMEOUT",
        }),
      ],
    );
  });

  it("Host 异常与原始 Secret 不进入公开事件", async () => {
    const secret = "Authorization: Bearer raw-process-host-secret";
    const { adapter, invocation } = await createHarness(async function* () {
      yield* [];
      throw new Error(secret);
    });

    const events = await collect(adapter.stream(invocation));

    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "EXTERNAL_AGENT_EXECUTION_FAILED",
    });
    expect(JSON.stringify(events)).not.toContain(secret);
  });
});
