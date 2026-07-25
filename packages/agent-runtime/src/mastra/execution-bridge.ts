import type { AuthoritativeModelProviderInvocation } from "@data-agent/contracts";
import { z } from "zod";

export const modelExecutionChunkSchema = z.discriminatedUnion("chunk_type", [
  z.strictObject({
    chunk_type: z.literal("TEXT_DELTA"),
    delta: z.string().min(1).max(100_000),
  }),
  z.strictObject({
    chunk_type: z.literal("TOOL_CALL_CANDIDATE"),
    tool_call_id: z.string().min(1).max(256),
    tool_name: z.string().min(1).max(128),
    arguments: z.json(),
  }),
  z.strictObject({
    chunk_type: z.literal("COMPLETED"),
    output_text: z.string().max(1_000_000),
    usage: z.strictObject({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      tool_calls: z.number().int().nonnegative(),
    }),
  }),
]);

export type ModelExecutionChunk = z.infer<typeof modelExecutionChunkSchema>;

export interface ModelExecutionBridge {
  stream(input: {
    readonly request: AuthoritativeModelProviderInvocation;
    readonly signal: AbortSignal;
  }): AsyncIterable<ModelExecutionChunk>;
}
