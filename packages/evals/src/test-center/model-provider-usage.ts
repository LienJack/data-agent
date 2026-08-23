export function projectProviderUsage(usage: {
  readonly availability: "AVAILABLE" | "UNAVAILABLE";
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly tool_calls: number | null;
}):
  | {
      readonly availability: "AVAILABLE";
      readonly input_tokens: number;
      readonly output_tokens: number;
      readonly tool_calls: number;
    }
  | {
      readonly availability: "UNAVAILABLE";
      readonly input_tokens: null;
      readonly output_tokens: null;
      readonly tool_calls: null;
    } {
  return usage.availability === "AVAILABLE"
    ? {
        availability: "AVAILABLE",
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        tool_calls: usage.tool_calls ?? 0,
      }
    : {
        availability: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        tool_calls: null,
      };
}
