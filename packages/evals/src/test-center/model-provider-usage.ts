export function reportedTokenCounts(usage: {
  readonly availability: "AVAILABLE" | "UNAVAILABLE";
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
}): { readonly input_tokens: number; readonly output_tokens: number } {
  return usage.availability === "AVAILABLE"
    ? { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 }
    : { input_tokens: 0, output_tokens: 0 };
}
