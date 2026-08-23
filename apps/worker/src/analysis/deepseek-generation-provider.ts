import { createHash, randomUUID } from "node:crypto";
import {
  type AvailableModelProfile,
  createDirectModelProviderInvocation,
  isAvailableModelProfile,
  type ModelProviderEvent,
  type ModelProviderPort,
  parseModelProviderEventForRequest,
} from "@data-agent/contracts";
import type { DeepSeekPythonGenerationPort } from "./deepseek-program-source.js";

type CompletedEvent = Extract<ModelProviderEvent, { readonly event_type: "COMPLETED" }>;

function stableUuid(material: string): string {
  const bytes = createHash("sha256").update(material).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function createDeepSeekPythonGenerationProvider(input: {
  readonly profile: AvailableModelProfile;
  readonly provider: ModelProviderPort;
}): DeepSeekPythonGenerationPort {
  if (
    !isAvailableModelProfile(input.profile) ||
    input.profile.provider !== "deepseek" ||
    input.profile.model_id !== "deepseek-v4-flash" ||
    input.profile.operational_constraints.context_window.verification_status !== "VERIFIED"
  ) {
    throw new TypeError("ANALYSIS_PYTHON_MODEL_PROFILE_INVALID");
  }
  const contextWindow = input.profile.operational_constraints.context_window;
  return Object.freeze({
    async generate(
      request: Parameters<DeepSeekPythonGenerationPort["generate"]>[0],
    ): ReturnType<DeepSeekPythonGenerationPort["generate"]> {
      const inputBytes =
        Buffer.byteLength(request.system, "utf8") +
        Buffer.byteLength(request.prompt, "utf8") +
        8_192;
      if (
        inputBytes + request.max_output_tokens > contextWindow.max_context_tokens ||
        request.max_output_tokens > contextWindow.max_output_tokens
      ) {
        throw new TypeError("ANALYSIS_PYTHON_MODEL_BUDGET_EXCEEDED");
      }
      const attemptId = stableUuid(
        `${request.lease.attempt_id}:${request.node_id}:${request.generation_attempt}`,
      );
      const invocation = createDirectModelProviderInvocation({
        schema_version: "1.0.0",
        request_id: randomUUID(),
        attempt_id: attemptId,
        scope: request.lease.scope,
        run_id: request.lease.run_id,
        provider: "deepseek",
        profile_id: input.profile.profile_id,
        profile_version: input.profile.profile_version,
        model_id: "deepseek-v4-flash",
        task_ref: request.analysis_program_ref,
        context_refs: [],
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        tool_allowlist: [],
        response_schema_version: request.response_schema_version,
        budget: {
          timeout_ms: 120_000,
          max_input_tokens: inputBytes,
          max_output_tokens: request.max_output_tokens,
          max_tool_calls: 0,
        },
      });
      let completed: CompletedEvent | null = null;
      for await (const candidate of input.provider.stream(invocation)) {
        const event = parseModelProviderEventForRequest(invocation, candidate);
        if (event.event_type === "FAILED") {
          throw new TypeError("ANALYSIS_PYTHON_PROVIDER_FAILED");
        }
        if (event.event_type === "THROTTLED") {
          throw new TypeError("ANALYSIS_PYTHON_PROVIDER_THROTTLED");
        }
        if (event.event_type === "COMPLETED") completed = event;
      }
      if (!completed) throw new TypeError("ANALYSIS_PYTHON_PROVIDER_INCOMPLETE");
      return {
        provider: "deepseek",
        model_id: "deepseek-v4-flash",
        output_text: completed.output_text,
        provider_invocation_ref: {
          resource_id: invocation.request_id,
          resource_revision: 1 as const,
          resource_hash: completed.response_hash as `sha256:${string}`,
        },
      };
    },
  });
}
