import { randomUUID } from "node:crypto";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  createDirectModelProviderInvocation,
  type ModelProviderEvent,
  type ModelProviderPort,
  parseModelProviderEventForRequest,
} from "@data-agent/contracts/ports";
import {
  type AvailableModelProfile,
  isAvailableModelProfile,
} from "@data-agent/contracts/providers";
import type { RunProviderDispatchCapability } from "../runs/run-execution-context.js";
import type { DeepSeekPythonGenerationPort } from "./deepseek-program-source.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";

type CompletedEvent = Extract<ModelProviderEvent, { readonly event_type: "COMPLETED" }>;

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
      const attemptId = deterministicAnalysisUuid(
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
        provider: "deepseek" as const,
        model_id: "deepseek-v4-flash" as const,
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

export function createRunBoundDeepSeekPythonGenerationProvider(
  capability: RunProviderDispatchCapability,
): DeepSeekPythonGenerationPort {
  return Object.freeze({
    async generate(request: Parameters<DeepSeekPythonGenerationPort["generate"]>[0]) {
      const logicalCallId = deterministicAnalysisUuid(
        `analysis-python-provider\0${request.lease.run_id}\0${request.analysis_program_ref.artifact_id}\0${request.node_id}\0${request.generation_attempt}`,
      );
      const result = await capability.invoke({
        logical_call_id: logicalCallId,
        analysis_python: {
          node_id: request.node_id,
          generation_attempt: request.generation_attempt,
          system: request.system,
          prompt: request.prompt,
          response_schema_version: request.response_schema_version,
          max_output_tokens: request.max_output_tokens,
        },
      });
      if (!result.ok) throw new TypeError(result.error.code);
      if (
        result.value.projection.invocation_id !== logicalCallId ||
        result.value.projection.status !== "COMPLETED" ||
        result.value.projection.provider !== "deepseek" ||
        result.value.projection.model_id !== "deepseek-v4-flash"
      ) {
        throw new TypeError("ANALYSIS_PYTHON_PROVIDER_IDENTITY_MISMATCH");
      }
      return {
        provider: "deepseek" as const,
        model_id: "deepseek-v4-flash" as const,
        output_text: result.value.output_text,
        provider_invocation_ref: {
          resource_id: logicalCallId,
          resource_revision: 1 as const,
          resource_hash: await sha256ContentHash({
            invocation_id: logicalCallId,
            provider: result.value.projection.provider,
            model_id: result.value.projection.model_id,
            output_text: result.value.output_text,
          }),
        },
      };
    },
  });
}
