import type { TrustedModelInputTokenCounter } from "@data-agent/agent-runtime";
import { canonicalizeJson, type ModelProviderRequest } from "@data-agent/contracts";

export const U3_MODEL_SYSTEM_INSTRUCTIONS =
  "仅处理当前已授权请求，并只产生候选输出；不要扩大工具、网络或数据范围。";

export function computeTrustedInputTokenUpperBound(input: {
  readonly instructions: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly tool_names: readonly string[];
  readonly response_schema_version: string;
  readonly canonical_schema_bytes: number;
}): number {
  const projected = canonicalizeJson({
    instructions: input.instructions,
    messages: input.messages,
    tool_names: input.tool_names,
    response_schema_version: input.response_schema_version,
  });
  if (!Number.isSafeInteger(input.canonical_schema_bytes) || input.canonical_schema_bytes < 1) {
    throw new TypeError("Registered response schema 必须提供 canonical_schema_bytes。");
  }
  return Buffer.byteLength(projected, "utf8") + input.canonical_schema_bytes;
}

export function computeTrustedInputTokenUpperBoundForRequestMessages(input: {
  readonly messages: ModelProviderRequest["messages"];
  readonly tool_names: readonly string[];
  readonly response_schema_version: string;
  readonly canonical_schema_bytes: number;
}): number {
  const systemMessages = input.messages
    .filter(({ role }) => role === "system")
    .map(({ content }) => content);
  const projectedMessages = input.messages.filter((message) => message.role !== "system");
  return computeTrustedInputTokenUpperBound({
    instructions:
      systemMessages.length > 0 ? systemMessages.join("\n\n") : U3_MODEL_SYSTEM_INSTRUCTIONS,
    messages: projectedMessages,
    tool_names: input.tool_names,
    response_schema_version: input.response_schema_version,
    canonical_schema_bytes: input.canonical_schema_bytes,
  });
}

export function createTrustedUtf8InputTokenUpperBoundCounter(): TrustedModelInputTokenCounter {
  return Object.freeze({
    count: async (context: Parameters<TrustedModelInputTokenCounter["count"]>[0]) =>
      computeTrustedInputTokenUpperBound({
        instructions: context.instructions,
        messages: context.messages,
        tool_names: context.tools.map((tool) => tool.tool_name),
        response_schema_version: context.response_schema_version,
        canonical_schema_bytes: context.response_schema.canonical_schema_bytes,
      }),
  });
}
