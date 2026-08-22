export interface TeamRuntimeBoundsConfig {
  readonly execution_safety_policy: {
    readonly max_elapsed_ms: number;
    readonly max_tool_calls: number;
  };
  readonly context_policy: {
    readonly max_context_tokens: number;
  };
}

export function deriveTeamRuntimeTaskBounds(config: TeamRuntimeBoundsConfig) {
  return {
    max_context_bytes: 65_536,
    max_input_tokens: Math.max(1, Math.min(32_768, config.context_policy.max_context_tokens)),
    max_output_tokens: 4_096,
    max_tool_calls: Math.min(32, config.execution_safety_policy.max_tool_calls),
    timeout_ms: Math.min(600_000, config.execution_safety_policy.max_elapsed_ms),
  } as const;
}
