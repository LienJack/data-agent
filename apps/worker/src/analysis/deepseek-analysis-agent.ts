import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type AnalysisAgentFinalResponse,
  type AnalysisToolCallCandidate,
  analysisAgentFinalResponseSchema,
  analysisToolCallCandidateSchema,
  type ModelProviderRequest,
} from "@data-agent/contracts/ports";
import type { RunProviderDispatchCapability } from "../runs/run-execution-context.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import type { ProviderInvocationResourceRef } from "./executor.js";

export type AnalysisAgentModelTurnResult =
  | {
      readonly phase: "TOOL";
      readonly tool_call: AnalysisToolCallCandidate;
      readonly assistant_text: string;
      readonly provider_invocation_ref: ProviderInvocationResourceRef;
    }
  | {
      readonly phase: "FINAL";
      readonly response: AnalysisAgentFinalResponse;
      readonly provider_invocation_ref: ProviderInvocationResourceRef;
    };

export interface AnalysisAgentModelPort {
  turn(input: {
    readonly run_id: string;
    readonly analysis_program_id: string;
    readonly node_id: string;
    readonly turn_index: number;
    readonly phase: "TOOL" | "FINAL";
    readonly messages: ModelProviderRequest["messages"];
    readonly max_output_tokens: number;
  }): Promise<AnalysisAgentModelTurnResult>;
}

function parseJsonDocument(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  return JSON.parse(trimmed);
}

function toolCandidate(input: unknown): AnalysisToolCallCandidate {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("ANALYSIS_AGENT_TOOL_CALL_INVALID");
  }
  const candidate = input as {
    readonly tool_call_id?: unknown;
    readonly tool_name?: unknown;
    readonly arguments?: unknown;
  };
  return analysisToolCallCandidateSchema.parse({
    tool_call_id: candidate.tool_call_id,
    tool_name: candidate.tool_name,
    arguments: candidate.arguments,
  });
}

export function createRunBoundDeepSeekAnalysisAgentModel(
  capability: RunProviderDispatchCapability,
): AnalysisAgentModelPort {
  return Object.freeze({
    async turn(input: Parameters<AnalysisAgentModelPort["turn"]>[0]) {
      const logicalCallId = deterministicAnalysisUuid(
        `analysis-agent-provider\0${input.run_id}\0${input.analysis_program_id}\0${input.node_id}\0${input.turn_index}\0${input.phase}`,
      );
      const result = await capability.invoke({
        logical_call_id: logicalCallId,
        analysis_agent: {
          node_id: input.node_id,
          turn_index: input.turn_index,
          phase: input.phase,
          messages: input.messages,
          response_schema_version: "analysis-agent-final@1.0.0",
          max_output_tokens: input.max_output_tokens,
        },
      });
      if (!result.ok) throw new TypeError(result.error.code);
      if (
        result.value.projection.invocation_id !== logicalCallId ||
        result.value.projection.status !== "COMPLETED" ||
        result.value.projection.provider !== "deepseek" ||
        result.value.projection.model_id !== "deepseek-v4-flash"
      ) {
        throw new TypeError("ANALYSIS_AGENT_PROVIDER_IDENTITY_MISMATCH");
      }
      const providerInvocationRef = {
        resource_id: logicalCallId,
        resource_revision: 1 as const,
        resource_hash: await sha256ContentHash({
          invocation_id: logicalCallId,
          phase: input.phase,
          output_text: result.value.output_text,
          tool_calls: result.value.tool_calls,
        }),
      };
      if (input.phase === "TOOL") {
        if (result.value.tool_calls.length !== 1) {
          throw new TypeError("ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID");
        }
        return {
          phase: "TOOL" as const,
          tool_call: toolCandidate(result.value.tool_calls[0]),
          assistant_text: result.value.output_text,
          provider_invocation_ref: providerInvocationRef,
        };
      }
      if (result.value.tool_calls.length !== 0) {
        throw new TypeError("ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID");
      }
      return {
        phase: "FINAL" as const,
        response: analysisAgentFinalResponseSchema.parse(
          parseJsonDocument(result.value.output_text),
        ),
        provider_invocation_ref: providerInvocationRef,
      };
    },
  });
}

export const deepSeekAnalysisAgentInternals = Object.freeze({ parseJsonDocument, toolCandidate });
