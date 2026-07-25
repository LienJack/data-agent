import {
  type AppScope,
  authorizeExternalAgentInvocation,
  type ExternalAgentProfile,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_CODE_ADAPTER,
  CLAUDE_CODE_PROFILE_ID,
  createDefaultExternalAgentRegistry,
  createTrustedExternalAgentProcessHost,
  ExternalAgentRuntimeError,
  ServerExternalAgentRegistry,
} from "../src/external-agents/index.js";

const ids = {
  app: "50000000-0000-4000-8000-000000000001",
  tenant: "50000000-0000-4000-8000-000000000002",
  otherTenant: "50000000-0000-4000-8000-000000000003",
  run: "50000000-0000-4000-8000-000000000004",
  profile: "50000000-0000-4000-8000-000000000005",
  invocation: "50000000-0000-4000-8000-000000000006",
  attempt: "50000000-0000-4000-8000-000000000007",
  task: "50000000-0000-4000-8000-000000000008",
} as const;

const scope = {
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
} as const satisfies AppScope;

function makeProfile(overrides: Partial<ExternalAgentProfile> = {}): ExternalAgentProfile {
  return {
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
    ...overrides,
  };
}

function makeRequest() {
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
    budget: {
      timeout_ms: 10_000,
      max_output_bytes: 1_024,
      max_actions: 2,
    },
  } as const;
}

describe("ServerExternalAgentRegistry", () => {
  it("默认只登记禁用的 Claude Code 示例，不发现 CLI，也不会登记 Codex 审核执行器", async () => {
    const spawnLikeSideEffect = vi.fn();
    const registry = createDefaultExternalAgentRegistry(scope);

    expect(registry.list()).toEqual([
      expect.objectContaining({
        adapter: CLAUDE_CODE_ADAPTER,
        enabled: false,
        has_process_host: false,
      }),
    ]);
    await expect(
      registry.resolveProfile({
        scope,
        profile_id: CLAUDE_CODE_PROFILE_ID,
        profile_version: "1.0.0",
      }),
    ).resolves.toBeNull();
    expect(registry.list().some(({ adapter }) => adapter.includes("codex"))).toBe(false);
    expect(spawnLikeSideEffect).not.toHaveBeenCalled();
  });

  it("严格拒绝 Model Profile、任意结构 Executor、缺 Process Host 与超过 Profile 的服务端预算", () => {
    const registry = new ServerExternalAgentRegistry();

    expect(() =>
      registry.register({
        enabled: true,
        profile: {
          profile_id: ids.profile,
          scope,
          provider: "openai",
          model_id: "gpt-5.4-mini",
          profile_version: "1.0.0",
          capabilities: {
            structured_output: true,
            tool_calling: true,
            streaming: true,
            reasoning: true,
            vision: true,
          },
          certification_status: "UNVERIFIED",
        },
        limits: {
          max_timeout_ms: 1_000,
          max_termination_confirmation_ms: 100,
          max_output_bytes: 1_024,
          max_actions: 1,
        },
      }),
    ).toThrow(ExternalAgentRuntimeError);

    expect(() =>
      registry.register({
        enabled: true,
        profile: makeProfile(),
        limits: {
          max_timeout_ms: 1_000,
          max_termination_confirmation_ms: 100,
          max_output_bytes: 1_024,
          max_actions: 1,
        },
      }),
    ).toThrow("Process/Effect Host");

    expect(() =>
      registry.register({
        enabled: true,
        profile: makeProfile(),
        limits: {
          max_timeout_ms: 1_000,
          max_termination_confirmation_ms: 100,
          max_output_bytes: 1_024,
          max_actions: 1,
        },
        process_host: {
          async start() {
            return {
              session_id: ids.invocation,
              events: {
                async *[Symbol.asyncIterator]() {
                  yield* [];
                },
              },
              async requestTermination() {
                return null;
              },
            };
          },
        },
      }),
    ).toThrow("Process/Effect Host");

    expect(() =>
      registry.register({
        enabled: false,
        profile: makeProfile(),
        limits: {
          max_timeout_ms: 30_001,
          max_termination_confirmation_ms: 100,
          max_output_bytes: 1_024,
          max_actions: 1,
        },
      }),
    ).toThrow("超时");
  });

  it("只解析精确 Scope/Profile/Version 的启用项，并让调用继续受 Workspace/Permission 授权", async () => {
    const registry = new ServerExternalAgentRegistry();
    registry.register({
      enabled: true,
      profile: makeProfile(),
      limits: {
        max_timeout_ms: 20_000,
        max_termination_confirmation_ms: 100,
        max_output_bytes: 2_048,
        max_actions: 4,
      },
      process_host: createTrustedExternalAgentProcessHost({
        async start() {
          return {
            session_id: ids.invocation,
            events: {
              async *[Symbol.asyncIterator]() {
                yield* [];
              },
            },
            async requestTermination() {
              return null;
            },
          };
        },
      }),
    });

    await expect(
      registry.resolveProfile({
        scope: { ...scope, tenant_id: ids.otherTenant },
        profile_id: ids.profile,
        profile_version: "1.0.0",
      }),
    ).resolves.toBeNull();
    await expect(
      authorizeExternalAgentInvocation(
        {
          ...makeRequest(),
          workspace_policy: {
            roots: ["/workspace/other"],
            writable: false,
          },
        },
        registry.resolveProfile,
      ),
    ).rejects.toThrow("Workspace");
    await expect(
      authorizeExternalAgentInvocation(
        {
          ...makeRequest(),
          permission_policy: {
            allowed_tools: ["write"],
            allowed_command_ids: ["git.push"],
          },
        },
        registry.resolveProfile,
      ),
    ).rejects.toThrow("Permission");

    await expect(
      authorizeExternalAgentInvocation(makeRequest(), registry.resolveProfile),
    ).resolves.toMatchObject({
      invocation_id: ids.invocation,
      adapter: "test-external-agent",
    });
  });
});
