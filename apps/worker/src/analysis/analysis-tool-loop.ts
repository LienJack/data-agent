import { createHash } from "node:crypto";
import {
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  type AnalysisAgentFinalResponse,
  type AnalysisCellObservation,
  type AnalysisOperatorFinalizationResult,
  type AnalysisStatisticalOperatorObservation,
  analysisCellObservationSchema,
  analysisOperatorFinalizationResultSchema,
  analysisStatisticalOperatorObservationSchema,
  type ModelProviderRequest,
  type PythonOutputContractV1,
  statisticalOperatorExecutionEvidenceSchema,
} from "@data-agent/contracts/ports";
import {
  type GeneratedAnalysisSourcePolicy,
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  type StatisticalOperatorObligation,
} from "@data-agent/contracts/statistical-operators";
import { z } from "zod";
import type {
  AnalysisSandboxProfile,
  OpenSandboxAnalysisSession,
} from "../runs/opensandbox-analysis-runtime.js";
import type {
  AnalysisAgentModelPort,
  AnalysisAgentModelTurnResult,
} from "./deepseek-analysis-agent.js";
import type { ProviderInvocationResourceRef } from "./executor.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const operatorToolResultSchema = z.strictObject({
  schema_version: z.literal("statistical-operator-tool-result@1.0.0"),
  call_id: z.string().min(1).max(128),
  operator_id: z.string().min(1).max(128),
  operator_registry_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  output: z.json(),
  execution_evidence: statisticalOperatorExecutionEvidenceSchema,
});

type OutputSpec = PythonOutputContractV1["outputs"][number];

export interface AnalysisToolLoopOutput {
  readonly name: string;
  readonly type: OutputSpec["type"];
  readonly path: string;
  readonly content: Uint8Array;
  readonly content_sha256: `sha256:${string}`;
  readonly bytes: number;
  readonly producer_cell_id: string;
}

export interface AnalysisExecutedCell {
  readonly cell_id: string;
  readonly source: string;
  readonly source_sha256: `sha256:${string}`;
  readonly observation: AnalysisCellObservation;
}

export interface AnalysisToolLoopResult {
  readonly final_response: AnalysisAgentFinalResponse;
  readonly outputs: readonly AnalysisToolLoopOutput[];
  readonly cells: readonly AnalysisExecutedCell[];
  readonly operator_observations: readonly AnalysisStatisticalOperatorObservation[];
  readonly operator_finalization: AnalysisOperatorFinalizationResult;
  readonly provider_invocation_refs: readonly ProviderInvocationResourceRef[];
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function outputPath(output: OutputSpec): string {
  const extension = {
    ARROW: "arrow",
    PARQUET: "parquet",
    CSV: "csv",
    JSON: "json",
    MARKDOWN: "md",
    VEGA_LITE: "vega.json",
    PNG: "png",
    SVG: "svg",
  }[output.type];
  return `/workspace/outputs/${output.name}.${extension}`;
}

function assertOutputBytes(output: OutputSpec, bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > output.max_bytes) {
    throw new TypeError("ANALYSIS_CELL_OUTPUT_SIZE_INVALID");
  }
  if (output.type === "PNG") {
    if (!Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new TypeError("ANALYSIS_CELL_OUTPUT_MEDIA_INVALID");
    }
    return;
  }
  if (output.type === "ARROW") {
    if (
      decoder.decode(bytes.subarray(0, 6)) !== "ARROW1" ||
      decoder.decode(bytes.subarray(bytes.byteLength - 6)) !== "ARROW1"
    ) {
      throw new TypeError("ANALYSIS_CELL_OUTPUT_MEDIA_INVALID");
    }
    return;
  }
  if (output.type === "PARQUET") {
    if (
      decoder.decode(bytes.subarray(0, 4)) !== "PAR1" ||
      decoder.decode(bytes.subarray(bytes.byteLength - 4)) !== "PAR1"
    ) {
      throw new TypeError("ANALYSIS_CELL_OUTPUT_MEDIA_INVALID");
    }
    return;
  }
  const text = decoder.decode(bytes);
  if (output.type === "JSON" || output.type === "VEGA_LITE") {
    JSON.parse(text);
    return;
  }
  if (output.type === "SVG") {
    if (
      !/<svg(?:\s|>)/iu.test(text.slice(0, 4_096)) ||
      /<script|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:|\/\/)/iu.test(text)
    ) {
      throw new TypeError("ANALYSIS_CELL_OUTPUT_MEDIA_INVALID");
    }
  }
}

function serverToolMessage(input: {
  readonly call: AnalysisAgentModelTurnResult & { readonly phase: "TOOL" };
  readonly result: unknown;
  readonly is_error: boolean;
}): ModelProviderRequest["messages"][number][] {
  return [
    {
      role: "assistant",
      content: JSON.stringify({
        kind: "TOOL_CALL_CANDIDATE",
        tool_call_id: input.call.tool_call.tool_call_id,
        tool_name: input.call.tool_call.tool_name,
        arguments: input.call.tool_call.arguments,
      }),
    },
    {
      role: "user",
      content: JSON.stringify({
        kind: "SERVER_TOOL_RESULT",
        tool_call_id: input.call.tool_call.tool_call_id,
        tool_name: input.call.tool_call.tool_name,
        result: input.result,
        is_error: input.is_error,
      }),
    },
  ];
}

function failedCellObservation(input: {
  readonly cell_id: string;
  readonly code: string;
  readonly value: string;
}): AnalysisCellObservation {
  return analysisCellObservationSchema.parse({
    schema_version: "analysis-cell-observation@1.0.0",
    cell_id: input.cell_id,
    status: "FAILED",
    execution_id: null,
    execution_count: null,
    elapsed_ms: 0,
    stdout: "",
    stderr: "",
    result_text: null,
    error: { name: input.code, value: input.value },
    declared_outputs: [],
  });
}

function runtimeCellObservation(input: {
  readonly observation: Awaited<ReturnType<OpenSandboxAnalysisSession["runAgentCell"]>>;
  readonly outputs: readonly AnalysisToolLoopOutput[];
}): AnalysisCellObservation {
  return analysisCellObservationSchema.parse({
    schema_version: "analysis-cell-observation@1.0.0",
    ...input.observation,
    declared_outputs: input.outputs.map((output) => ({
      name: output.name,
      path: output.path,
      content_sha256: output.content_sha256,
      bytes: output.bytes,
    })),
  });
}

function exactNames(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export async function executeAnalysisToolLoop(input: {
  readonly run_id: string;
  readonly analysis_program_id: string;
  readonly node_id: string;
  readonly generated_source_policy: Exclude<GeneratedAnalysisSourcePolicy, "NO_GENERATED_SOURCE">;
  readonly runtime_profile: AnalysisSandboxProfile;
  readonly output_contract: PythonOutputContractV1;
  readonly operator_obligations: readonly StatisticalOperatorObligation[];
  readonly initial_messages: ModelProviderRequest["messages"];
  readonly model: AnalysisAgentModelPort;
  readonly session: OpenSandboxAnalysisSession;
  readonly max_tool_turns: number;
  readonly max_output_tokens: number;
  readonly signal?: AbortSignal;
}): Promise<AnalysisToolLoopResult> {
  if (
    input.max_tool_turns < 1 ||
    input.max_tool_turns > 32 ||
    (input.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
      input.operator_obligations.length > 0
  ) {
    throw new TypeError("ANALYSIS_AGENT_LOOP_CONFIGURATION_INVALID");
  }
  const outputByName = new Map(
    input.output_contract.outputs.map((output) => [output.name, output] as const),
  );
  const outputs = new Map<string, AnalysisToolLoopOutput>();
  const cells: AnalysisExecutedCell[] = [];
  const operatorObservations: AnalysisStatisticalOperatorObservation[] = [];
  const operatorRequests: unknown[] = [];
  const providerInvocationRefs: ProviderInvocationResourceRef[] = [];
  const seenCellIds = new Set<string>();
  const messages = [...input.initial_messages];

  for (let turnIndex = 0; turnIndex < input.max_tool_turns; turnIndex += 1) {
    if (input.signal?.aborted) throw new TypeError("ANALYSIS_SANDBOX_CELL_CANCELLED");
    const requiredOutputsComplete = input.output_contract.outputs
      .filter(({ required }) => required)
      .every(({ name }) => outputs.has(name));
    if (requiredOutputsComplete && operatorRequests.length === input.operator_obligations.length) {
      break;
    }
    const turn = await input.model.turn({
      run_id: input.run_id,
      analysis_program_id: input.analysis_program_id,
      node_id: input.node_id,
      turn_index: turnIndex,
      phase: "TOOL",
      messages,
      max_output_tokens: input.max_output_tokens,
    });
    if (turn.phase !== "TOOL") throw new TypeError("ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID");
    providerInvocationRefs.push(turn.provider_invocation_ref);
    const candidate = turn.tool_call;
    if (candidate.tool_name === ANALYSIS_PYTHON_CELL_TOOL_NAME) {
      const args = candidate.arguments;
      if (seenCellIds.has(args.cell_id)) {
        const observation = failedCellObservation({
          cell_id: args.cell_id,
          code: "ANALYSIS_CELL_ID_DUPLICATE",
          value: "Choose a new cell_id and retry only the failed Cell.",
        });
        messages.push(...serverToolMessage({ call: turn, result: observation, is_error: true }));
        continue;
      }
      seenCellIds.add(args.cell_id);
      const unknownOutputs = args.declared_output_names.filter((name) => !outputByName.has(name));
      const duplicateOutputs = args.declared_output_names.filter((name) => outputs.has(name));
      if (unknownOutputs.length > 0 || duplicateOutputs.length > 0) {
        const observation = failedCellObservation({
          cell_id: args.cell_id,
          code: "ANALYSIS_CELL_OUTPUT_DECLARATION_INVALID",
          value: JSON.stringify({
            unknown_outputs: unknownOutputs,
            duplicate_outputs: duplicateOutputs,
          }),
        });
        messages.push(...serverToolMessage({ call: turn, result: observation, is_error: true }));
        continue;
      }
      const policy = await input.session.admitAgentCell({
        cell_id: args.cell_id,
        source: args.source,
        generated_source_policy: input.generated_source_policy,
        timeout_ms: Math.min(args.timeout_ms, 30_000),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (policy.status !== "ADMITTED") {
        const observation = failedCellObservation({
          cell_id: args.cell_id,
          code: "ANALYSIS_SANDBOX_CELL_POLICY_REJECTED",
          value: JSON.stringify(policy.violations),
        });
        messages.push(...serverToolMessage({ call: turn, result: observation, is_error: true }));
        continue;
      }
      const runtimeObservation = await input.session.runAgentCell({
        cell_id: args.cell_id,
        source: args.source,
        timeout_ms: args.timeout_ms,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const produced: AnalysisToolLoopOutput[] = [];
      let outputFailure: Error | null = null;
      if (runtimeObservation.status === "SUCCEEDED") {
        for (const name of args.declared_output_names) {
          const spec = outputByName.get(name) as OutputSpec;
          const path = outputPath(spec);
          try {
            const content = await input.session.readAgentFile({ path });
            assertOutputBytes(spec, content);
            produced.push({
              name,
              type: spec.type,
              path,
              content,
              content_sha256: sha256(content),
              bytes: content.byteLength,
              producer_cell_id: args.cell_id,
            });
          } catch (error) {
            outputFailure = error instanceof Error ? error : new Error("OUTPUT_INVALID");
            break;
          }
        }
      }
      const observation = outputFailure
        ? failedCellObservation({
            cell_id: args.cell_id,
            code: "ANALYSIS_CELL_DECLARED_OUTPUT_INVALID",
            value: outputFailure.message,
          })
        : runtimeCellObservation({ observation: runtimeObservation, outputs: produced });
      if (observation.status === "SUCCEEDED") {
        for (const output of produced) outputs.set(output.name, output);
      }
      cells.push({
        cell_id: args.cell_id,
        source: args.source,
        source_sha256: sha256(encoder.encode(args.source)),
        observation,
      });
      messages.push(
        ...serverToolMessage({
          call: turn,
          result: observation,
          is_error: observation.status !== "SUCCEEDED",
        }),
      );
      continue;
    }
    if (candidate.tool_name !== ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME) {
      throw new TypeError("ANALYSIS_AGENT_TOOL_CALL_INVALID");
    }
    const args = candidate.arguments;
    const obligation = input.operator_obligations[operatorRequests.length];
    if (
      !obligation ||
      obligation.call_id !== args.call_id ||
      obligation.operator_id !== args.operator_id
    ) {
      messages.push(
        ...serverToolMessage({
          call: turn,
          result: {
            schema_version: "analysis-statistical-operator-error@1.0.0",
            code: "ANALYSIS_OPERATOR_NOT_AUTHORIZED",
            expected: obligation
              ? { call_id: obligation.call_id, operator_id: obligation.operator_id }
              : null,
          },
          is_error: true,
        }),
      );
      continue;
    }
    const requestDocument = {
      schema_version: "statistical-operator-tool-call@1.0.0",
      call_id: args.call_id,
      operator_id: args.operator_id,
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      runtime_profile: input.runtime_profile,
      obligation,
      inputs: args.inputs,
      parameters: args.parameters,
    } as const;
    const request = encoder.encode(JSON.stringify(requestDocument));
    const runtimeResult = await input.session.runOperator({
      call_id: args.call_id,
      request,
      request_sha256: sha256(request),
      timeout_ms: 60_000,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const parsed = operatorToolResultSchema.parse(
      JSON.parse(decoder.decode(runtimeResult.output as Uint8Array)),
    );
    const sealedContent = encoder.encode(JSON.stringify(parsed.output));
    const sealedResultPath = `/workspace/sealed/${args.call_id}.json`;
    const sealedResultHash = sha256(sealedContent);
    await input.session.uploadAgentFile({
      path: sealedResultPath,
      content: sealedContent,
      content_sha256: sealedResultHash,
    });
    const observation = analysisStatisticalOperatorObservationSchema.parse({
      schema_version: "analysis-statistical-operator-observation@1.0.0",
      call_id: args.call_id,
      operator_id: args.operator_id,
      operator_registry_digest: parsed.operator_registry_digest,
      status: "SUCCEEDED",
      output: parsed.output,
      execution_evidence: parsed.execution_evidence,
      sealed_result_path: sealedResultPath,
      sealed_result_sha256: sealedResultHash,
    });
    operatorRequests.push(requestDocument);
    operatorObservations.push(observation);
    messages.push(...serverToolMessage({ call: turn, result: observation, is_error: false }));
  }

  const requiredOutputNames = input.output_contract.outputs
    .filter(({ required }) => required)
    .map(({ name }) => name);
  if (
    !requiredOutputNames.every((name) => outputs.has(name)) ||
    operatorRequests.length !== input.operator_obligations.length
  ) {
    throw new TypeError("ANALYSIS_AGENT_TOOL_BUDGET_EXHAUSTED");
  }
  const finalJsonOutputs = Object.fromEntries(
    [
      ...new Set(input.operator_obligations.map((item) => item.result_binding.result_output_name)),
    ].map((name) => {
      const output = outputs.get(name);
      if (output?.type !== "JSON") {
        throw new TypeError("ANALYSIS_OPERATOR_RESULT_BINDING_OUTPUT_MISSING");
      }
      return [name, JSON.parse(decoder.decode(output.content))];
    }),
  );
  let operatorFinalization: AnalysisOperatorFinalizationResult;
  if (operatorRequests.length === 0) {
    operatorFinalization = analysisOperatorFinalizationResultSchema.parse({
      schema_version: "statistical-operator-finalization-result@1.0.0",
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      operator_receipts: [],
      operator_receipt_closure_hash: sha256(encoder.encode("[]")),
    });
  } else {
    const finalizationRequest = encoder.encode(
      JSON.stringify({
        schema_version: "statistical-operator-finalization@1.0.0",
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        runtime_profile: input.runtime_profile,
        calls: operatorRequests,
        json_outputs: finalJsonOutputs,
      }),
    );
    const finalized = await input.session.finalizeOperators({
      finalization_id: "final-receipts",
      request: finalizationRequest,
      request_sha256: sha256(finalizationRequest),
      timeout_ms: 120_000,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    operatorFinalization = analysisOperatorFinalizationResultSchema.parse(
      JSON.parse(decoder.decode(finalized.output)),
    );
  }
  const receiptIdentities = operatorFinalization.operator_receipts.map(
    ({ call_id, operator_id }) => ({ call_id, operator_id }),
  );
  const obligationIdentities = input.operator_obligations.map(({ call_id, operator_id }) => ({
    call_id,
    operator_id,
  }));
  if (
    operatorFinalization.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
    JSON.stringify(receiptIdentities) !== JSON.stringify(obligationIdentities)
  ) {
    throw new TypeError("ANALYSIS_OPERATOR_RECEIPT_CLOSURE_MISMATCH");
  }
  messages.push({
    role: "user",
    content: JSON.stringify({
      kind: "ANALYSIS_OUTPUTS_VERIFIED",
      outputs: [...outputs.values()].map(({ name, type, content_sha256, bytes }) => ({
        name,
        type,
        content_sha256,
        bytes,
      })),
      operator_receipt_closure_hash: operatorFinalization.operator_receipt_closure_hash,
      instruction:
        "Return the final schema now. Explain the verified result without changing machine values.",
    }),
  });
  const finalTurn = await input.model.turn({
    run_id: input.run_id,
    analysis_program_id: input.analysis_program_id,
    node_id: input.node_id,
    turn_index: input.max_tool_turns,
    phase: "FINAL",
    messages,
    max_output_tokens: input.max_output_tokens,
  });
  if (finalTurn.phase !== "FINAL") throw new TypeError("ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID");
  providerInvocationRefs.push(finalTurn.provider_invocation_ref);
  if (!exactNames(finalTurn.response.output_names, [...outputs.keys()])) {
    throw new TypeError("ANALYSIS_AGENT_FINAL_OUTPUT_SET_MISMATCH");
  }
  return Object.freeze({
    final_response: finalTurn.response,
    outputs: Object.freeze([...outputs.values()]),
    cells: Object.freeze(cells),
    operator_observations: Object.freeze(operatorObservations),
    operator_finalization: operatorFinalization,
    provider_invocation_refs: Object.freeze(providerInvocationRefs),
  });
}

export const analysisToolLoopInternals = Object.freeze({ assertOutputBytes, outputPath });
