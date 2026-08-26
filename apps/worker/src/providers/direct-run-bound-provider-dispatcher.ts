import {
  buildRootAgentSystemMessage,
  createDirectModelProviderPort,
  createRootModelProviderPort,
  getModelProviderBinding,
  type ModelProviderBinding,
  ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
  ROOT_AGENT_TOOL_ALLOWLIST,
  type RootModelProviderPortCompositionInput,
  rootAgentFinalAnswerOutputSchema,
  ServerModelResponseSchemaRegistry,
  SUBAGENT_DELEGATION_TOOL_DESCRIPTOR,
} from "@data-agent/agent-runtime";
import {
  analysisAgentFinalResponseSchema,
  createDirectModelProviderInvocation,
  effectiveConfigRunLeasePayloadSchema,
  MODEL_REQUEST_PERFORMANCE_SCHEMA_VERSION,
  modelRequestPerformanceSchema,
  type PortResult,
  sha256ContentHash,
  text2sqlQueryCandidateSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { analysisProgramCandidateSchema } from "../analysis/analysis-program-compiler.js";
import {
  ANALYSIS_MODEL_TOOL_ALLOWLIST,
  ANALYSIS_MODEL_TOOL_DESCRIPTORS,
} from "../analysis/analysis-tool-descriptors.js";
import type {
  RunBoundProviderDispatcher,
  RunModelProviderResult,
} from "../runs/run-execution-context.js";
import { createTrustedUtf8InputTokenUpperBoundCounter } from "./trusted-input-token-upper-bound.js";

const SPECIALIST_ANSWER_RESPONSE_SCHEMA_VERSION = "specialist-answer@1.0.0";
const PROVIDER_SMOKE_RESPONSE_SCHEMA_VERSION = "provider-smoke-answer@1.0.0";
const ANALYSIS_PYTHON_RESPONSE_SCHEMA_VERSION = "analysis-python-source@1.0.0";
const ANALYSIS_AGENT_FINAL_RESPONSE_SCHEMA_VERSION = "analysis-agent-final@1.0.0";
const ANALYSIS_PROGRAM_CANDIDATE_SCHEMA_VERSION = "analysis-program-candidate@1.0.0";
const TEXT2SQL_QUERY_CANDIDATE_SCHEMA_VERSION = "text2sql-query-candidate@1.0.0";
const specialistAnswerSchema = z.strictObject({ answer: z.string().trim().min(1).max(32_000) });
const analysisPythonSourceSchema = z.strictObject({
  schema_version: z.literal(ANALYSIS_PYTHON_RESPONSE_SCHEMA_VERSION),
  python_source: z.string().min(1).max(100_000),
});

interface DirectRunReader {
  getRun(
    capability: unknown,
    input: { readonly run_id: string },
  ): Promise<PortResult<{ readonly question: string } | null>>;
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function retryableReason(code: string): boolean {
  return (
    code === "MODEL_STREAM_PROTOCOL_VIOLATION" ||
    /(?:THROTTL|TIMEOUT|UNAVAILABLE|NETWORK|RATE_LIMIT)/u.test(code)
  );
}

function shouldRetryProviderCall(input: {
  readonly first_ok: boolean;
  readonly retryable: boolean;
  readonly signal_aborted: boolean;
  readonly max_attempts_per_call: 1 | 2;
}): boolean {
  return (
    !input.first_ok && input.retryable && !input.signal_aborted && input.max_attempts_per_call > 1
  );
}

function providerFailureCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)) {
    return error.message;
  }
  return "MODEL_PROVIDER_DIRECT_CALL_FAILED";
}

const ANALYSIS_MODEL_TOOL_NAME_SET = new Set<string>(ANALYSIS_MODEL_TOOL_ALLOWLIST);

function validAnalysisToolAllowlist(
  phase: "TOOL" | "FINAL",
  toolNames: readonly string[],
): boolean {
  if (phase === "FINAL") return toolNames.length === 0;
  return (
    toolNames.length > 0 &&
    new Set(toolNames).size === toolNames.length &&
    toolNames.every((toolName) => ANALYSIS_MODEL_TOOL_NAME_SET.has(toolName))
  );
}

function projectToolCallCandidate(
  event: Readonly<{
    readonly tool_call_id: string;
    readonly tool_name: string;
    readonly arguments: unknown;
  }>,
): Readonly<{
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly arguments: unknown;
}> {
  return Object.freeze({
    tool_call_id: event.tool_call_id,
    tool_name: event.tool_name,
    arguments: event.arguments,
  });
}

/**
 * Lightweight run-bound model gateway.
 *
 * The effective run config still freezes provider/model identity and budgets,
 * but dispatch no longer resolves certification receipts, commits invocation
 * intents, or consumes persisted permits.
 */
export function createDirectRunBoundProviderDispatcher(input: {
  readonly runs: DirectRunReader;
  readonly capability: unknown;
  readonly environment: NodeJS.ProcessEnv;
}): RunBoundProviderDispatcher {
  const schemas = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: SPECIALIST_ANSWER_RESPONSE_SCHEMA_VERSION,
      schema: specialistAnswerSchema,
    },
    {
      response_schema_version: PROVIDER_SMOKE_RESPONSE_SCHEMA_VERSION,
      schema: specialistAnswerSchema,
    },
    {
      response_schema_version: ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
      schema: rootAgentFinalAnswerOutputSchema,
    },
    {
      response_schema_version: ANALYSIS_PYTHON_RESPONSE_SCHEMA_VERSION,
      schema: analysisPythonSourceSchema,
    },
    {
      response_schema_version: ANALYSIS_AGENT_FINAL_RESPONSE_SCHEMA_VERSION,
      schema: analysisAgentFinalResponseSchema,
    },
    {
      response_schema_version: ANALYSIS_PROGRAM_CANDIDATE_SCHEMA_VERSION,
      schema: analysisProgramCandidateSchema,
    },
    {
      response_schema_version: TEXT2SQL_QUERY_CANDIDATE_SCHEMA_VERSION,
      schema: text2sqlQueryCandidateSchema,
    },
  ]);

  return Object.freeze({
    async invoke(
      requestInput: Parameters<RunBoundProviderDispatcher["invoke"]>[0],
    ): Promise<PortResult<RunModelProviderResult>> {
      const {
        lease,
        effective_config: config,
        context_receipt: context,
        logical_call_id: logicalCallId,
        signal,
      } = requestInput;
      if (signal.aborted) {
        return failure("RUN_EXECUTION_ABORTED", "Run 已中止。", false);
      }
      if (
        config.run_id !== lease.run_id ||
        context.run_id !== lease.run_id ||
        context.attempt_id !== lease.attempt_id ||
        context.worker_fence !== lease.worker_fence
      ) {
        return failure("PROVIDER_CONTEXT_RECEIPT_MISMATCH", "模型调用与 Run 上下文不一致。");
      }

      const analysisPython = requestInput.analysis_python;
      const analysisAgent = requestInput.analysis_agent;
      const providerSmoke = requestInput.turn?.kind === "PROVIDER_SMOKE";
      const rootTurn = requestInput.turn?.kind === "ROOT";
      const rootRequest = rootTurn ? requestInput.turn : null;
      const specialistTurn = requestInput.turn?.kind === "SPECIALIST" ? requestInput.turn : null;
      const selectedModes = [
        providerSmoke,
        rootTurn,
        specialistTurn !== null,
        analysisPython !== undefined,
        analysisAgent !== undefined,
      ].filter(Boolean).length;
      if (selectedModes !== 1) {
        return failure(
          "MODEL_DISPATCH_MODE_REQUIRED",
          "生产模型调用必须选择唯一的 Root、Specialist、Analysis 或 smoke turn。",
        );
      }

      const loaded = await input.runs.getRun(input.capability, { run_id: lease.run_id });
      if (!loaded.ok) return loaded;
      if (!loaded.value) return failure("RUN_NOT_FOUND", "无法读取当前 Run 问题。");

      let template: ModelProviderBinding;
      try {
        template = getModelProviderBinding(config.model.provider);
      } catch {
        return failure("MODEL_PROVIDER_NOT_CONFIGURED", "冻结模型 Provider 没有代码绑定。");
      }
      const credential = input.environment[template.credential_env]?.trim();
      if (!credential) {
        return failure("PROVIDER_CREDENTIAL_UNAVAILABLE", "模型 Provider 凭据不可用。");
      }
      const binding = Object.freeze({
        ...template,
        profile_id: config.model.resource_id,
        profile_version: config.model.profile_version,
        default_model_id: config.model.model_id,
      });
      if (analysisPython && analysisAgent) {
        return failure(
          "ANALYSIS_MODEL_REQUEST_AMBIGUOUS",
          "分析模型请求不能同时生成旧源码和执行 Cell Agent turn。",
        );
      }
      if (
        (analysisPython || analysisAgent || rootTurn || specialistTurn) &&
        (config.model.provider !== "deepseek" || config.model.model_id !== "deepseek-v4-flash")
      ) {
        return failure(
          "ANALYSIS_PYTHON_MODEL_IDENTITY_INVALID",
          "分析 Python 只能使用冻结的 DeepSeek V4 Flash Profile。",
        );
      }
      if (
        rootRequest &&
        (rootRequest.phase === "DIRECT_ANSWER_REVIEW"
          ? rootRequest.prior_output_text.trim().length === 0 ||
            rootRequest.prior_output_text.length > 100_000
          : rootRequest.phase !== "INITIAL")
      ) {
        return failure("ROOT_AGENT_TURN_INVALID", "Root Agent turn phase is invalid.");
      }
      if (
        (analysisPython || analysisAgent) &&
        (analysisPython?.response_schema_version ?? analysisAgent?.response_schema_version) !==
          (analysisPython
            ? ANALYSIS_PYTHON_RESPONSE_SCHEMA_VERSION
            : ANALYSIS_AGENT_FINAL_RESPONSE_SCHEMA_VERSION)
      ) {
        return failure(
          "ANALYSIS_PYTHON_MODEL_IDENTITY_INVALID",
          "分析模型请求的响应 Schema 与冻结阶段不一致。",
        );
      }
      if (
        analysisAgent &&
        !validAnalysisToolAllowlist(analysisAgent.phase, analysisAgent.allowed_tool_names)
      ) {
        return failure(
          "ANALYSIS_AGENT_TOOL_ALLOWLIST_INVALID",
          "分析 Agent turn 的状态级工具白名单无效。",
        );
      }
      if (
        specialistTurn &&
        ((specialistTurn.stage === "SEMANTIC" &&
          specialistTurn.profile_id !== "semantic-management-agent") ||
          (specialistTurn.stage === "TEXT2SQL" &&
            specialistTurn.profile_id !== "governed-text2sql-agent") ||
          (specialistTurn.stage === "ANALYSIS_PROGRAM" &&
            specialistTurn.profile_id !== "governed-analysis-agent") ||
          (specialistTurn.stage === "REPORT" &&
            specialistTurn.profile_id !== "report-writing-agent") ||
          specialistTurn.objective.trim().length === 0 ||
          specialistTurn.context_text.length === 0 ||
          specialistTurn.context_text.length > 100_000)
      ) {
        return failure(
          "SPECIALIST_MODEL_REQUEST_INVALID",
          "Specialist turn 与冻结 Profile 或 Context 不一致。",
        );
      }
      const rootPayload = rootTurn
        ? effectiveConfigRunLeasePayloadSchema.safeParse(lease.payload)
        : null;
      const rootLease =
        rootPayload?.success &&
        rootPayload.data.kind === "START_DATA_AGENT_TEAM" &&
        rootPayload.data.schema_version === "effective-config-team-lease@3.0.0"
          ? rootPayload.data
          : null;
      if (
        rootTurn &&
        (rootLease?.executor_version !== "ROOT_HARNESS@1" ||
          rootLease?.catalog_snapshot.run_id !== lease.run_id)
      ) {
        return failure("ROOT_AGENT_LEASE_INVALID", "Root turn 需要冻结的 V3 Catalog lease。");
      }
      const taskHash = await sha256ContentHash(
        rootTurn && rootLease
          ? {
              question: loaded.value.question,
              catalog_snapshot_hash: rootLease.catalog_snapshot.snapshot_hash,
              visible_message_refs: rootLease.visible_message_refs,
              phase: rootRequest?.phase ?? "INITIAL",
              prior_output_text:
                rootRequest?.phase === "DIRECT_ANSWER_REVIEW"
                  ? rootRequest.prior_output_text
                  : null,
            }
          : providerSmoke
            ? { purpose: "provider-smoke", model_profile_hash: config.model.resource_hash }
            : specialistTurn
              ? {
                  stage: specialistTurn.stage,
                  profile_id: specialistTurn.profile_id,
                  objective: specialistTurn.objective,
                  context: specialistTurn.context_text,
                }
              : analysisAgent
                ? {
                    node_id: analysisAgent.node_id,
                    turn_index: analysisAgent.turn_index,
                    phase: analysisAgent.phase,
                    allowed_tool_names: analysisAgent.allowed_tool_names,
                    messages: analysisAgent.messages,
                  }
                : analysisPython
                  ? {
                      node_id: analysisPython.node_id,
                      generation_attempt: analysisPython.generation_attempt,
                      system: analysisPython.system,
                      prompt: analysisPython.prompt,
                    }
                  : { question: loaded.value.question },
      );
      const messages =
        rootTurn && rootLease
          ? [
              {
                role: "system" as const,
                content: await buildRootAgentSystemMessage(rootLease.catalog_snapshot),
              },
              { role: "user" as const, content: loaded.value.question },
              ...(rootRequest?.phase === "DIRECT_ANSWER_REVIEW"
                ? [
                    {
                      role: "assistant" as const,
                      content: rootRequest.prior_output_text,
                    },
                    {
                      role: "user" as const,
                      content: [
                        "Self-review the routing decision above against the frozen Root Agent rules.",
                        "If answering the original question depends on workspace data, semantic definitions, relationships, calculations, rows, aggregates, comparisons, ranking, trends, charts, or missing governed evidence, replace the direct answer with the required native Subagent tool call now.",
                        "The absence of accepted evidence is a reason to delegate, not a reason to refuse.",
                        "Only retain a strict direct FINAL_ANSWER when the original question is genuinely answerable from general knowledge or explicitly visible user text without workspace evidence.",
                        "When retaining the direct answer, repeat the previous assistant JSON object exactly. Do not replace it with a review conclusion, routing explanation, critique, or other meta commentary.",
                      ].join("\n"),
                    },
                  ]
                : []),
            ]
          : providerSmoke
            ? [
                {
                  role: "system" as const,
                  content:
                    'Return exactly one JSON object shaped as {"answer":"READY"}. Do not include any other text.',
                },
                { role: "user" as const, content: "Verify this frozen provider binding." },
              ]
            : specialistTurn
              ? [
                  {
                    role: "system" as const,
                    content:
                      specialistTurn.stage === "SEMANTIC"
                        ? [
                            "You are the governed semantic-layer specialist.",
                            "Return exactly one JSON object with a non-empty answer field.",
                            "Answer the business question directly from the exact frozen published semantic catalog, retrieval receipt, graph expansion, inference closure, and pruning evidence supplied below.",
                            "Lead with the relevant entity, metric, dimension, formula, relationship, lineage, time, or quality definition instead of dumping the catalog.",
                            "State retrieval degradation or incomplete closure when material. Do not invent data values, schema objects, relationships, formulas, or causal claims.",
                            "A PARTIAL route must be described as incomplete retrieval. closure_complete means only that the selected mandatory closure is complete; it never proves the global graph has no missing relation.",
                            "Do not interpret row-preservation metadata as a foreign-key existence guarantee unless the published proof explicitly states that guarantee.",
                            `Frozen semantic evidence: ${specialistTurn.context_text}`,
                          ].join("\n")
                        : specialistTurn.stage === "TEXT2SQL"
                          ? [
                              "You are the governed PostgreSQL Text2SQL specialist.",
                              "Return exactly one text2sql-query-candidate@1.0.0 JSON object.",
                              'The only accepted JSON shape is {"schema_version":"text2sql-query-candidate@1.0.0","sql":"SELECT ...","parameters":[],"result_columns":[{"name":"ascii_alias","semantic_type":"NUMBER|STRING|DATE|DATETIME|BOOLEAN","label":"business label","semantic_binding":{"object_kind":"METRIC|DIMENSION","object_id":"exact-published-id"}}],"time_window":null,"presentation":{"title":"title","summary":"summary","visualization":"NONE|LINE|BAR|PIE|TABLE","x_key":null,"y_keys":[]}}.',
                              "Use exactly those property names. candidate_id, type, query, chart, expression, alias, columns, and any additional property are forbidden.",
                              "Generate one read-only SELECT statement. Use only relations and columns in the exact frozen context.",
                              "Schema-qualify every physical relation, give every relation an alias, and give every output expression an explicit unique ASCII alias.",
                              "Use positional parameters ($1, $2, ...) for literal values and put values in parameters in matching order.",
                              "Parameterize every literal, including date boundaries, labels, thresholds, and function arguments. The only permitted unparameterized literal is numeric 0 in a zero check.",
                              "Do not add LIMIT, comments, SELECT *, subqueries, set operations, locks, DDL, DML, volatile functions, system catalogs, or unlisted relations; the Host enforces result limits.",
                              "For complex logic use non-recursive CTEs, INNER/LEFT JOIN, parameterized predicates, GROUP BY and ORDER BY declared output aliases.",
                              "Safe built-ins include count, sum, avg, min, max, date_trunc, date_part, abs, coalesce and nullif.",
                              "Do not use ROUND in SQL; return the raw numeric value and let the artifact renderer control display precision. Avoid unsupported PostgreSQL overloads and unnecessary casts.",
                              "Declare output aliases in exact order in result_columns and make chart keys reference those aliases.",
                              "Bind every output to exactly one published metric or dimension id from the frozen context. These declarations are untrusted until the Host verifies the Release, formula, aggregate, grain, physical column, schema snapshot, datasource and real PostgreSQL result type.",
                              'For a bounded time query, set time_window to {"dimension_id":"exact-time-dimension","start_parameter":1,"end_parameter":2,"semantics":"HALF_OPEN"}; the indices must reference the exact lower and exclusive upper bound parameters used by SQL. Otherwise set time_window to null.',
                              "For NONE or TABLE, x_key must be null and y_keys must be empty. For LINE, BAR, or PIE, x_key must name one declared result column and y_keys must contain declared numeric result columns.",
                              "Prefer LINE for time trends, BAR for category comparisons, and PIE only for a valid non-negative composition. The Host always keeps the evidence table, so a request for a table does not prevent selecting a useful chart visualization.",
                              "When Frozen query context is a text2sql-repair-context, replace the rejected candidate. DATASOURCE_ADAPTER_SQL_TYPE_ERROR means remove unsupported function overloads or casts; DATASOURCE_ADAPTER_SQL_COLUMN_NOT_FOUND means choose exact listed columns; TEXT2SQL_RESULT_SHAPE_MISMATCH means make SELECT aliases and result_columns identical in order.",
                              "Return only the declared candidate JSON. Do not add template identifiers, Markdown, prose outside JSON, or invented schema.",
                              `Frozen query context: ${specialistTurn.context_text}`,
                            ].join("\n")
                          : specialistTurn.stage === "ANALYSIS_PROGRAM"
                            ? [
                                "You are the governed analysis-program planner.",
                                "Return exactly one analysis-program-candidate@1.0.0 JSON object and no prose.",
                                "Select only metric_ids and dimension_ids present in the frozen Published AnalysisContext.",
                                "Use the exact approved half-open time window. Never invent or widen a time range.",
                                "Do not return ResultContract, semantic hashes, physical lineage, limits, generated-source policy, benchmark-case identity, acceptance metadata, Python source, SQL, or chart data; those are Host-owned.",
                                "Choose only statistical operator obligations from the frozen registry and exact host-required operator ids. Every operator input must bind exact governed input, an approved server transform, or a preceding governed operator result.",
                                "Do not implement BH-FDR, Theil-Sen, Mann-Kendall, HAC, Shapley, cohort retention, or any other registered operator in generated Python.",
                                "The accepted shape is strict: schema_version, node_id, metric_ids, dimension_ids, time_window, comparison_window, parameters, operator_obligations.",
                                `Frozen analysis authority: ${specialistTurn.context_text}`,
                              ].join("\n")
                            : [
                                "You are the governed report-writing specialist.",
                                "Return exactly one JSON object with a non-empty answer field.",
                                "Use only the accepted evidence supplied in the frozen context; do not invent facts.",
                                `Frozen accepted evidence: ${specialistTurn.context_text}`,
                              ].join("\n"),
                  },
                  {
                    role: "user" as const,
                    content: `${specialistTurn.objective}\n\nOriginal workspace question: ${loaded.value.question}`,
                  },
                ]
              : analysisPython
                ? [
                    { role: "system" as const, content: analysisPython.system },
                    { role: "user" as const, content: analysisPython.prompt },
                  ]
                : analysisAgent
                  ? analysisAgent.messages
                  : [];
      const maxInputTokens = Math.max(1, config.context_policy.max_context_tokens);
      const maxOutputTokens =
        analysisAgent?.max_output_tokens ?? analysisPython?.max_output_tokens ?? 2_048;
      const toolAllowlist = rootTurn
        ? ROOT_AGENT_TOOL_ALLOWLIST
        : (analysisAgent?.allowed_tool_names ?? []);
      let request: ReturnType<typeof createDirectModelProviderInvocation>;
      try {
        request = createDirectModelProviderInvocation({
          schema_version: "direct-model-request@1.0.0",
          request_id: logicalCallId,
          attempt_id: lease.attempt_id,
          scope: lease.scope,
          run_id: lease.run_id,
          provider: config.model.provider,
          profile_id: config.model.resource_id,
          profile_version: config.model.profile_version,
          model_id: config.model.model_id,
          task_ref: {
            artifact_id: logicalCallId,
            artifact_type: "ProviderTaskArtifact",
            ...lease.scope,
            run_id: lease.run_id,
            revision: 1,
            content_hash: taskHash,
          },
          context_refs: [],
          messages,
          tool_allowlist: toolAllowlist,
          response_schema_version: rootTurn
            ? ROOT_AGENT_RESPONSE_SCHEMA_VERSION
            : specialistTurn?.stage === "TEXT2SQL"
              ? TEXT2SQL_QUERY_CANDIDATE_SCHEMA_VERSION
              : specialistTurn?.stage === "ANALYSIS_PROGRAM"
                ? ANALYSIS_PROGRAM_CANDIDATE_SCHEMA_VERSION
                : specialistTurn?.stage === "SEMANTIC" || specialistTurn?.stage === "REPORT"
                  ? SPECIALIST_ANSWER_RESPONSE_SCHEMA_VERSION
                  : (analysisAgent?.response_schema_version ??
                    analysisPython?.response_schema_version ??
                    PROVIDER_SMOKE_RESPONSE_SCHEMA_VERSION),
          ...(analysisAgent || rootTurn || specialistTurn ? { sampling: { temperature: 0 } } : {}),
          budget: {
            timeout_ms: Math.min(config.execution_safety_policy.max_elapsed_ms, 120_000),
            max_input_tokens: maxInputTokens,
            max_output_tokens: maxOutputTokens,
            max_tool_calls: rootTurn
              ? Math.min(8, config.execution_safety_policy.max_tool_calls)
              : analysisAgent?.phase === "TOOL"
                ? 1
                : 0,
          },
        });
      } catch {
        return failure("DIRECT_MODEL_REQUEST_INVALID", "模型直连请求不符合运行契约。");
      }

      let attemptCount = 0;
      const startedAt = Date.now();
      const invokeOnce = async (): Promise<PortResult<RunModelProviderResult>> => {
        attemptCount += 1;
        const providerInput: RootModelProviderPortCompositionInput = {
          credential_resolver: {
            resolve: async (candidate) =>
              candidate.provider === binding.provider &&
              candidate.credential_env === binding.credential_env
                ? credential
                : null,
          },
          binding_resolver: {
            resolve: async (candidate) =>
              candidate.provider === binding.provider &&
              candidate.profile_id === binding.profile_id &&
              candidate.profile_version === binding.profile_version
                ? binding
                : null,
          },
          response_schema_registry: schemas,
          input_token_counter: createTrustedUtf8InputTokenUpperBoundCounter(),
          dispatch_marker: { mark_dispatched: async () => {} },
          abort_signal: signal,
          tools: [...ANALYSIS_MODEL_TOOL_DESCRIPTORS, SUBAGENT_DELEGATION_TOOL_DESCRIPTOR],
        };
        const provider = rootTurn
          ? createRootModelProviderPort(providerInput)
          : createDirectModelProviderPort(providerInput);
        try {
          const toolCalls: unknown[] = [];
          for await (const event of provider.stream(request)) {
            if (event.event_type === "TOOL_CALL_CANDIDATE") {
              toolCalls.push(projectToolCallCandidate(event));
            }
            if (event.event_type === "COMPLETED") {
              if (
                (analysisAgent?.phase === "TOOL" && toolCalls.length !== 1) ||
                (analysisAgent?.phase === "FINAL" && toolCalls.length !== 0)
              ) {
                return failure(
                  "ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID",
                  "分析 Agent turn 没有满足唯一 Tool Call 协议。",
                );
              }
              const usage =
                event.usage.availability === "AVAILABLE"
                  ? {
                      ...event.usage,
                      total_tokens: event.usage.input_tokens + event.usage.output_tokens,
                    }
                  : { ...event.usage, total_tokens: null };
              return {
                ok: true,
                value: {
                  output_text: event.output_text,
                  tool_calls: Object.freeze(toolCalls),
                  request_performance: modelRequestPerformanceSchema.parse({
                    schema_version: MODEL_REQUEST_PERFORMANCE_SCHEMA_VERSION,
                    request_id: logicalCallId,
                    provider: config.model.provider,
                    profile_id: config.model.resource_id,
                    model_id: config.model.model_id,
                    status: "COMPLETED",
                    attempt_count: attemptCount,
                    duration_ms: Math.max(0, Date.now() - startedAt),
                    context_window_tokens: maxInputTokens,
                    reserved_output_tokens: maxOutputTokens,
                    usage,
                  }),
                  projection: {
                    invocation_id: logicalCallId,
                    status: "COMPLETED",
                    provider: config.model.provider,
                    model_id: config.model.model_id,
                  },
                },
              };
            }
            if (event.event_type === "FAILED" || event.event_type === "THROTTLED") {
              return failure(event.reason_code, "模型 Provider 调用失败。", event.retryable);
            }
          }
          return failure("MODEL_PROVIDER_TERMINAL_EVENT_MISSING", "模型调用缺少终态事件。");
        } catch (error) {
          const code = providerFailureCode(error);
          return failure(code, "模型 Provider 直连失败。", retryableReason(code));
        }
      };

      const first = await invokeOnce();
      if (
        !shouldRetryProviderCall({
          first_ok: first.ok,
          retryable: first.ok ? false : first.error.retryable,
          signal_aborted: signal.aborted,
          max_attempts_per_call: lease.execution_policy.max_provider_attempts_per_call,
        })
      )
        return first;
      return invokeOnce();
    },
  });
}

export const directRunBoundProviderDispatcherInternals = Object.freeze({
  projectToolCallCandidate,
  retryableReason,
  shouldRetryProviderCall,
  validAnalysisToolAllowlist,
});
