import { type AppScope, appScopeSchema } from "@data-agent/contracts";
import type { ExternalAgentRegistration } from "./contracts.js";
import { ServerExternalAgentRegistry } from "./registry.js";

export const CLAUDE_CODE_ADAPTER = "claude-code";
export const CLAUDE_CODE_PROFILE_ID = "40000000-0000-4000-8000-000000000001";

export function createDisabledClaudeCodeRegistration(input: AppScope): ExternalAgentRegistration {
  const scope = appScopeSchema.parse(input);
  return {
    enabled: false,
    profile: {
      profile_id: CLAUDE_CODE_PROFILE_ID,
      profile_version: "1.0.0",
      scope,
      kind: "EXTERNAL_AGENT",
      adapter: CLAUDE_CODE_ADAPTER,
      workspace_policy: {
        roots: ["/workspace/data-agent"],
        writable: false,
      },
      permission_policy: {
        allowed_tools: [],
        allowed_command_ids: [],
      },
      cancellation: {
        supported: true,
        timeout_ms: 300_000,
      },
      audit: {
        required: true,
        receipt_schema_version: "1.0.0",
      },
    },
    limits: {
      max_timeout_ms: 300_000,
      max_termination_confirmation_ms: 5_000,
      max_output_bytes: 1_000_000,
      max_actions: 100,
    },
  };
}

/**
 * 仅登记禁用的配置示例。这里不会探测或启动本机 CLI，也不会把 Codex 审核映射为执行器。
 */
export function createDefaultExternalAgentRegistry(scope: AppScope): ServerExternalAgentRegistry {
  const registry = new ServerExternalAgentRegistry();
  registry.register(createDisabledClaudeCodeRegistration(scope));
  return registry;
}
