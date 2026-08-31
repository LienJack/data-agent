import type { AnalysisResultContract } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type AnalysisAgentFinalResponse,
  type AnalysisToolCallCandidate,
  analysisAgentFinalResponseSchema,
  analysisToolCallCandidateSchema,
  type ModelProviderRequest,
} from "@data-agent/contracts/ports";
import type { RunProviderDispatchCapability } from "../runs/run-execution-context.js";
import {
  analysisModelToolCallCandidateSchema,
  analysisOperatorArgumentSymbols,
} from "./analysis-tool-descriptors.js";
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
      readonly phase: "INVALID_TOOL";
      readonly error_code:
        | "ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID"
        | "ANALYSIS_AGENT_TOOL_CALL_INVALID";
      readonly validation_issues: readonly AnalysisToolValidationIssue[];
      readonly provider_invocation_ref: ProviderInvocationResourceRef;
    }
  | {
      readonly phase: "FINAL";
      readonly response: AnalysisAgentFinalResponse;
      readonly provider_invocation_ref: ProviderInvocationResourceRef;
    };

export interface AnalysisToolValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly identifiers?: readonly string[];
}

export interface AnalysisAgentModelPort {
  turn(input: {
    readonly run_id: string;
    readonly analysis_program_id: string;
    readonly node_id: string;
    readonly turn_index: number;
    readonly phase: "TOOL" | "FINAL";
    readonly result_contract: AnalysisResultContract;
    readonly allowed_tool_names: readonly AnalysisToolCallCandidate["tool_name"][];
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

function safeValidationIssueIdentifiers(issue: {
  readonly code: string;
  readonly keys?: unknown;
}): readonly string[] {
  if (issue.code !== "unrecognized_keys" || !Array.isArray(issue.keys)) return [];
  return Object.freeze(
    issue.keys
      .filter(
        (key): key is string =>
          typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u.test(key),
      )
      .slice(0, 8),
  );
}

function validateToolCandidate(
  input: unknown,
  identity: {
    readonly run_id: string;
    readonly node_id: string;
    readonly turn_index: number;
    readonly result_contract: AnalysisResultContract;
  },
):
  | { readonly candidate: AnalysisToolCallCandidate; readonly issues: readonly [] }
  | { readonly candidate: null; readonly issues: readonly AnalysisToolValidationIssue[] } {
  if (typeof input !== "object" || input === null) {
    return {
      candidate: null,
      issues: Object.freeze([{ path: "$", code: "invalid_type" }]),
    };
  }
  const candidate = input as {
    readonly tool_call_id?: unknown;
    readonly tool_name?: unknown;
    readonly arguments?: unknown;
  };
  const parsed = analysisModelToolCallCandidateSchema.safeParse({
    tool_call_id: candidate.tool_call_id,
    tool_name: candidate.tool_name,
    arguments: candidate.arguments,
  });
  if (parsed.success) {
    const modelCandidate = parsed.data;
    let argumentsWithServerIdentity: AnalysisToolCallCandidate["arguments"];
    if (modelCandidate.tool_name === "python_cell") {
      argumentsWithServerIdentity = {
        schema_version: "analysis-python-cell-tool@1.0.0",
        cell_id: `cell-${deterministicAnalysisUuid(
          `analysis-model-cell\0${identity.run_id}\0${identity.node_id}\0${identity.turn_index}\0${modelCandidate.arguments.source}`,
        )}`,
        ...modelCandidate.arguments,
      };
    } else if (modelCandidate.tool_name === "statistical_operator") {
      argumentsWithServerIdentity = {
        schema_version: "analysis-statistical-operator-tool@1.0.0",
        ...modelCandidate.arguments,
        ...analysisOperatorArgumentSymbols(modelCandidate.arguments.call_id),
      };
    } else {
      const modelArguments = modelCandidate.arguments;
      const tableBindings = new Map(
        modelArguments.table_bindings.map((binding) => [binding.table_id, binding]),
      );
      const chartBindings = [];
      for (const binding of modelArguments.chart_bindings) {
        const chart = identity.result_contract.charts.find(
          ({ chart_id: chartId }) => chartId === binding.chart_id,
        );
        const tableBinding = chart ? tableBindings.get(chart.table_id) : undefined;
        const templateId = chart?.allowed_template_ids[0];
        if (!chart || !tableBinding || !templateId) {
          return {
            candidate: null,
            issues: Object.freeze([
              {
                path: "arguments.chart_bindings",
                code: "unknown_contract_binding",
                identifiers: Object.freeze([binding.chart_id]),
              },
            ]),
          };
        }
        chartBindings.push({
          ...binding,
          intent: chart.intent,
          template_id: templateId,
          data_symbol: tableBinding.data_symbol,
        });
      }
      argumentsWithServerIdentity = {
        schema_version: chartBindings.some((binding) => binding.facet_field !== undefined)
          ? "analysis-result-publish-tool@1.1.0"
          : "analysis-result-publish-tool@1.0.0",
        ...modelArguments,
        chart_bindings: chartBindings,
      };
    }
    return {
      candidate: analysisToolCallCandidateSchema.parse({
        ...modelCandidate,
        arguments: argumentsWithServerIdentity,
      }),
      issues: [],
    };
  }
  return {
    candidate: null,
    issues: Object.freeze(
      parsed.error.issues.slice(0, 16).map((issue) =>
        (() => {
          const identifiers = safeValidationIssueIdentifiers(issue);
          return Object.freeze({
            path: issue.path.length === 0 ? "$" : issue.path.map(String).join("."),
            code: issue.code,
            ...(identifiers.length > 0 ? { identifiers } : {}),
          });
        })(),
      ),
    ),
  };
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
          allowed_tool_names: input.allowed_tool_names,
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
          return {
            phase: "INVALID_TOOL" as const,
            error_code: "ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID" as const,
            validation_issues: Object.freeze([{ path: "tool_calls", code: "invalid_length" }]),
            provider_invocation_ref: providerInvocationRef,
          };
        }
        const validated = validateToolCandidate(result.value.tool_calls[0], {
          run_id: input.run_id,
          node_id: input.node_id,
          turn_index: input.turn_index,
          result_contract: input.result_contract,
        });
        if (validated.candidate !== null) {
          return {
            phase: "TOOL" as const,
            tool_call: validated.candidate,
            assistant_text: result.value.output_text,
            provider_invocation_ref: providerInvocationRef,
          };
        }
        return {
          phase: "INVALID_TOOL" as const,
          error_code: "ANALYSIS_AGENT_TOOL_CALL_INVALID" as const,
          validation_issues: validated.issues,
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

export const deepSeekAnalysisAgentInternals = Object.freeze({
  parseJsonDocument,
  validateToolCandidate,
  safeValidationIssueIdentifiers,
});
