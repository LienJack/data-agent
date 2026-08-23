import {
  type AgentTurnPort,
  type AgentTurnRequest,
  authorizeAgentTurnRequest,
  type PortResult,
  SEMANTIC_AUTHORING_POLICY_VERSION,
  SEMANTIC_AUTHORING_TOOL_RECEIPT_VERSION,
  type SemanticAuthoringCheckpoint,
  type SemanticAuthoringPublicEvent,
  type SemanticAuthoringResumeInput,
  type SemanticAuthoringStartInput,
  type SemanticAuthoringState,
  type SemanticAuthoringStorePort,
  type SemanticAuthoringToolCall,
  semanticAuthoringToolCallSchema,
  semanticAuthoringToolReceiptSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { SEMANTIC_AUTHORING_TOOL_NAMES, semanticAuthoringToolCatalog } from "./tool-catalog.js";
import {
  executeSemanticAuthoringTool,
  SemanticAuthoringToolError,
  type SemanticAuthoringToolExecutionContext,
} from "./tool-executor.js";

function portFailure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]*$/.test(error.code)
  ) {
    return error.code;
  }
  return "SEMANTIC_AUTHORING_TOOL_FAILED";
}

function publicMessage(error: unknown): string {
  if (error instanceof SemanticAuthoringToolError) return error.message;
  return "语义创作未能安全完成。";
}

function parseToolCalls(input: readonly unknown[]): SemanticAuthoringToolCall[] {
  return z.array(semanticAuthoringToolCallSchema).max(32).parse(input);
}

function toolMessage(
  call: SemanticAuthoringToolCall,
  content: unknown,
  isError: boolean,
): SemanticAuthoringCheckpoint["messages"][number] {
  return {
    role: "tool",
    tool_call_id: call.tool_call_id,
    tool_name: call.tool_name,
    content: JSON.stringify(content),
    is_error: isError,
  };
}

export interface SemanticAuthoringOrchestratorOptions {
  readonly agent: AgentTurnPort;
  readonly store: SemanticAuthoringStorePort;
  readonly new_id?: () => string;
  readonly now?: () => string;
  readonly compiler_version?: string;
  readonly provider_budget?: {
    readonly timeout_ms: number;
    readonly max_input_tokens: number;
    readonly max_output_tokens: number;
  };
  readonly before_step?: (state: SemanticAuthoringState) => Promise<PortResult<void>>;
}

export interface SemanticAuthoringOrchestrator {
  startAndRun(input: SemanticAuthoringStartInput): Promise<PortResult<SemanticAuthoringState>>;
  resumeAndRun(input: SemanticAuthoringResumeInput): Promise<PortResult<SemanticAuthoringState>>;
  continueRun(state: SemanticAuthoringState): Promise<PortResult<SemanticAuthoringState>>;
}

export function createSemanticAuthoringOrchestrator(
  options: SemanticAuthoringOrchestratorOptions,
): SemanticAuthoringOrchestrator {
  const newId = options.new_id ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const compilerVersion = options.compiler_version ?? "semantic-graph-compiler@2.0.0";
  const providerBudget = options.provider_budget ?? {
    timeout_ms: 60_000,
    max_input_tokens: 32_000,
    max_output_tokens: 8_000,
  };

  const event = (
    state: SemanticAuthoringState,
    value: Omit<
      SemanticAuthoringPublicEvent,
      "schema_version" | "event_id" | "run_id" | "sequence" | "occurred_at"
    >,
  ): SemanticAuthoringPublicEvent =>
    ({
      schema_version: "semantic-authoring-public-event@1.0.0",
      event_id: newId(),
      run_id: state.run.authoring_run_id,
      sequence: state.event_sequence + 1,
      occurred_at: now(),
      ...value,
    }) as SemanticAuthoringPublicEvent;

  const failRun = async (
    state: SemanticAuthoringState,
    code: string,
    summary: string,
  ): Promise<PortResult<SemanticAuthoringState>> =>
    options.store.fail({
      authoring_run_id: state.run.authoring_run_id,
      expected_writer_fence: state.run.writer_fence,
      error_code: code,
      event: event(state, {
        type: "authoring_terminal",
        payload: { status: "FAILED", summary, error_code: code },
      }),
    });

  const recordFailedTool = async (
    state: SemanticAuthoringState,
    call: SemanticAuthoringToolCall,
    turnIndex: number,
    error: unknown,
    remainingCalls: readonly SemanticAuthoringToolCall[],
  ): Promise<PortResult<SemanticAuthoringState>> => {
    const code = errorCode(error);
    const result = { error_code: code, message: publicMessage(error) };
    const inputDigest = await sha256ContentHash(call);
    const outputDigest = await sha256ContentHash(result);
    const receiptMaterial = {
      receipt_version: SEMANTIC_AUTHORING_TOOL_RECEIPT_VERSION,
      receipt_id: newId(),
      authoring_run_id: state.run.authoring_run_id,
      candidate_id: state.run.candidate_id,
      turn_index: turnIndex,
      tool_call_id: call.tool_call_id,
      tool_name: call.tool_name,
      idempotency_key: `${state.run.authoring_run_id}:${turnIndex}:${call.tool_call_id}`,
      input_digest: inputDigest,
      output_digest: outputDigest,
      status: "FAILED" as const,
      mutation: false,
      from_working_revision: state.run.working_revision,
      to_working_revision: state.run.working_revision,
      before_digest: state.run.graph_digest,
      after_digest: state.run.graph_digest,
      patch: null,
      result,
      error_code: code,
      committed_at: now(),
    };
    const receipt = semanticAuthoringToolReceiptSchema.parse({
      ...receiptMaterial,
      receipt_digest: await sha256ContentHash(receiptMaterial),
    });
    return options.store.commitTool({
      authoring_run_id: state.run.authoring_run_id,
      expected_writer_fence: state.run.writer_fence,
      expected_working_revision: state.run.working_revision,
      expected_graph_digest: state.run.graph_digest,
      receipt,
      next_graph: state.working_graph,
      checkpoint: {
        ...state.checkpoint,
        messages: [...state.checkpoint.messages, toolMessage(call, result, true)],
        pending_tool_calls: [...remainingCalls],
      },
      events: [
        event(state, {
          type: "tool",
          payload: {
            call_id: call.tool_call_id,
            tool_name: call.tool_name,
            status: "FAILED",
            summary: publicMessage(error),
            error_code: code,
          },
        }),
      ],
    });
  };

  const continueRun = async (
    initialState: SemanticAuthoringState,
  ): Promise<PortResult<SemanticAuthoringState>> => {
    let state = initialState;
    outer: while (state.run.status === "RUNNING") {
      if (options.before_step) {
        const ready = await options.before_step(state);
        if (!ready.ok) return ready;
      }
      const lastMessage = state.checkpoint.messages.at(-1);
      if (lastMessage?.role === "tool" && lastMessage.tool_name === "complete_authoring_run") {
        try {
          const recovered = JSON.parse(lastMessage.content) as {
            summary?: unknown;
            validation_receipt?: unknown;
          };
          const validation = state.checkpoint.last_validation;
          if (
            typeof recovered.summary !== "string" ||
            validation === null ||
            recovered.validation_receipt === undefined ||
            JSON.stringify(recovered.validation_receipt) !== JSON.stringify(validation)
          ) {
            throw new Error("invalid completion checkpoint");
          }
          return options.store.complete({
            authoring_run_id: state.run.authoring_run_id,
            expected_writer_fence: state.run.writer_fence,
            expected_working_revision: state.run.working_revision,
            expected_graph_digest: state.run.graph_digest,
            validation_receipt: validation,
            final_graph: state.working_graph,
            summary: recovered.summary,
            event: event(state, {
              type: "authoring_terminal",
              payload: {
                status: "READY_FOR_REVIEW",
                summary: recovered.summary,
                error_code: null,
              },
            }),
          });
        } catch {
          return failRun(
            state,
            "SEMANTIC_AUTHORING_COMPLETION_CHECKPOINT_INVALID",
            "完成工具已提交，但恢复所需的 exact validation evidence 无效。",
          );
        }
      }
      if (state.checkpoint.pending_tool_calls.length > 0) {
        const calls = [...state.checkpoint.pending_tool_calls];
        const turnIndex = state.run.current_turn;
        for (let index = 0; index < calls.length; index += 1) {
          const call = calls[index];
          if (call === undefined) continue;
          const remaining = calls.slice(index + 1);
          const prior = await options.store.findToolReceipt({
            authoring_run_id: state.run.authoring_run_id,
            tool_call_id: call.tool_call_id,
          });
          if (!prior.ok) return prior;
          if (prior.value !== null) {
            const current = await options.store.load({
              scope: state.run.scope,
              semantic_domain: state.run.semantic_domain,
              authoring_run_id: state.run.authoring_run_id,
            });
            if (!current.ok) return current;
            if (current.value === null) {
              return portFailure(
                "SEMANTIC_AUTHORING_RUN_NOT_FOUND",
                "恢复 tool receipt 时 authoring run 不存在。",
              );
            }
            state = current.value;
            continue outer;
          }
          let execution: Awaited<ReturnType<typeof executeSemanticAuthoringTool>>;
          try {
            const context: SemanticAuthoringToolExecutionContext = {
              new_id: newId,
              now,
              compiler_version: compilerVersion,
              turn_index: turnIndex,
            };
            execution = await executeSemanticAuthoringTool(state, call, context);
          } catch (error) {
            const recorded = await recordFailedTool(state, call, turnIndex, error, remaining);
            if (!recorded.ok) return recorded;
            return failRun(recorded.value, errorCode(error), publicMessage(error));
          }
          const committed = await options.store.commitTool({
            authoring_run_id: state.run.authoring_run_id,
            expected_writer_fence: state.run.writer_fence,
            expected_working_revision: state.run.working_revision,
            expected_graph_digest: state.run.graph_digest,
            receipt: execution.receipt,
            next_graph: execution.next_graph,
            checkpoint: {
              ...execution.checkpoint,
              messages: [
                ...execution.checkpoint.messages,
                toolMessage(call, execution.receipt.result, false),
              ],
              pending_tool_calls: remaining,
            },
            events: execution.events,
          });
          if (!committed.ok) return committed;
          state = committed.value;
          if (execution.requests_clarification) return { ok: true, value: state };
          if (execution.requests_completion) {
            const validation = execution.validation_receipt;
            if (validation === null) {
              return failRun(
                state,
                "SEMANTIC_AUTHORING_VALIDATION_RECEIPT_MISSING",
                "Agent 请求结束，但 exact validation receipt 缺失。",
              );
            }
            const summary =
              call.tool_name === "complete_authoring_run"
                ? call.arguments.summary
                : "语义创作已完成";
            return options.store.complete({
              authoring_run_id: state.run.authoring_run_id,
              expected_writer_fence: state.run.writer_fence,
              expected_working_revision: state.run.working_revision,
              expected_graph_digest: state.run.graph_digest,
              validation_receipt: validation,
              final_graph: state.working_graph,
              summary,
              event: event(state, {
                type: "authoring_terminal",
                payload: { status: "READY_FOR_REVIEW", summary, error_code: null },
              }),
            });
          }
        }
        continue;
      }

      if (state.run.current_turn >= state.run.budget.max_turns) {
        return failRun(
          state,
          "SEMANTIC_AUTHORING_TURN_BUDGET_EXCEEDED",
          "Authoring Agent turn budget 已耗尽。",
        );
      }

      let request: AgentTurnRequest;
      if (state.checkpoint.pending_agent_request !== null) {
        request = state.checkpoint.pending_agent_request;
      } else {
        request = {
          schema_version: "semantic-agent-turn@1.0.0",
          request_id: newId(),
          scope: state.run.scope,
          authoring_run_id: state.run.authoring_run_id,
          candidate_id: state.run.candidate_id,
          principal_id: state.run.principal_id,
          policy_version: state.run.policy_version,
          turn_index: state.run.current_turn + 1,
          messages: state.checkpoint.messages,
          tools: [...semanticAuthoringToolCatalog()],
          budget: providerBudget,
        };
      }
      const requestDigest = await sha256ContentHash(request);
      if (state.checkpoint.pending_agent_request === null) {
        const began = await options.store.beginTurn({
          authoring_run_id: state.run.authoring_run_id,
          expected_writer_fence: state.run.writer_fence,
          expected_turn: state.run.current_turn,
          request_digest: requestDigest,
          checkpoint: { ...state.checkpoint, pending_agent_request: request },
          events: [
            event(state, {
              type: "stage",
              payload: {
                phase: `semantic-turn-${request.turn_index}`,
                summary: "开始形成受治理的语义工具计划。",
                status: "RUNNING",
              },
            }),
          ],
        });
        if (!began.ok) return began;
        state = began.value;
      } else if (state.run.pending_request_digest !== requestDigest) {
        return failRun(
          state,
          "SEMANTIC_AUTHORING_PENDING_REQUEST_DIGEST_MISMATCH",
          "持久化 Agent request 与当前 checkpoint 摘要不一致。",
        );
      }

      const authoritative = authorizeAgentTurnRequest(request, {
        scope: state.run.scope,
        authoring_run_id: state.run.authoring_run_id,
        candidate_id: state.run.candidate_id,
        principal_id: state.run.principal_id,
        policy_version: state.run.policy_version,
        tool_names: SEMANTIC_AUTHORING_TOOL_NAMES,
      });
      let result: Awaited<ReturnType<AgentTurnPort["turn"]>>;
      try {
        result = await options.agent.turn(authoritative);
      } catch {
        return portFailure(
          "SEMANTIC_AGENT_PROVIDER_FAILED",
          "模型调用失败；已保留 checkpoint，可安全恢复。",
          true,
        );
      }
      if (result.terminal === "FAILED") {
        return result.retryable
          ? portFailure(result.reason_code, "模型调用暂时失败；已保留 checkpoint。", true)
          : failRun(state, result.reason_code, "模型未能完成本轮语义创作。");
      }
      if (result.terminal === "FINAL") {
        return failRun(
          state,
          "SEMANTIC_AGENT_STOPPED_WITHOUT_COMPLETE",
          "模型停止但未调用 complete_authoring_run，run 不会被标记成功。",
        );
      }

      let calls: SemanticAuthoringToolCall[];
      try {
        calls = parseToolCalls(result.tool_calls);
      } catch {
        return failRun(
          state,
          "SEMANTIC_AGENT_TOOL_CALL_INVALID",
          "模型提出了不在服务端工具策略内的调用。",
        );
      }
      const checkpoint: SemanticAuthoringCheckpoint = {
        ...state.checkpoint,
        pending_agent_request: null,
        messages: [
          ...state.checkpoint.messages,
          {
            role: "assistant",
            content: result.assistant_text,
            tool_calls: result.tool_calls,
          },
        ],
        pending_tool_calls: calls,
      };
      const committed = await options.store.commitTurn({
        authoring_run_id: state.run.authoring_run_id,
        expected_writer_fence: state.run.writer_fence,
        expected_turn: state.run.current_turn,
        request_digest: requestDigest,
        response_digest: result.response_digest,
        checkpoint,
        events: [
          event(state, {
            type: "stage",
            payload: {
              phase: `semantic-turn-${request.turn_index}`,
              summary: `已形成 ${calls.length} 个受策略约束的工具调用。`,
              status: "COMPLETED",
            },
          }),
        ],
      });
      if (!committed.ok) return committed;
      state = committed.value;
    }
    return { ok: true, value: state };
  };

  return {
    async startAndRun(input) {
      if (input.policy_version !== SEMANTIC_AUTHORING_POLICY_VERSION) {
        return portFailure(
          "SEMANTIC_AUTHORING_POLICY_MISMATCH",
          "请求的 semantic authoring policy version 不受支持。",
        );
      }
      const started = await options.store.start(input);
      return started.ok ? continueRun(started.value) : started;
    },
    async resumeAndRun(input) {
      const resumed = await options.store.resume(input);
      return resumed.ok ? continueRun(resumed.value) : resumed;
    },
    continueRun,
  };
}
