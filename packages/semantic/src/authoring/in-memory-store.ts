import {
  type PortResult,
  SEMANTIC_AUTHORING_CHECKPOINT_VERSION,
  SEMANTIC_AUTHORING_RUN_VERSION,
  type SemanticAuthoringBeginTurnInput,
  type SemanticAuthoringCommitToolInput,
  type SemanticAuthoringCommitTurnInput,
  type SemanticAuthoringCompleteInput,
  type SemanticAuthoringPublicEvent,
  type SemanticAuthoringResumeInput,
  type SemanticAuthoringStartInput,
  type SemanticAuthoringState,
  type SemanticAuthoringStorePort,
  type SemanticAuthoringToolReceipt,
  semanticAuthoringStartInputSchema,
  semanticAuthoringStateSchema,
} from "@data-agent/contracts";
import { computeSemanticGraphDigest } from "../graph-v2/canonicalize.js";

class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function failure<T>(error: unknown): PortResult<T> {
  if (error instanceof StoreError) {
    return { ok: false, error: { code: error.code, message: error.message, retryable: false } };
  }
  return {
    ok: false,
    error: {
      code: "SEMANTIC_AUTHORING_STORE_FAILED",
      message: error instanceof Error ? error.message : "Semantic authoring store failed.",
      retryable: false,
    },
  };
}

function requireState(
  states: Map<string, SemanticAuthoringState>,
  authoringRunId: string,
): SemanticAuthoringState {
  const state = states.get(authoringRunId);
  if (state === undefined) {
    throw new StoreError("SEMANTIC_AUTHORING_RUN_NOT_FOUND", "Authoring run 不存在。");
  }
  return state;
}

function appendEvents(
  currentSequence: number,
  existing: SemanticAuthoringPublicEvent[],
  events: readonly SemanticAuthoringPublicEvent[],
): number {
  let sequence = currentSequence;
  for (const event of events) {
    if (event.sequence !== sequence + 1) {
      throw new StoreError(
        "SEMANTIC_AUTHORING_EVENT_SEQUENCE_CONFLICT",
        "Authoring public event sequence 必须连续递增。",
      );
    }
    existing.push(event);
    sequence = event.sequence;
  }
  return sequence;
}

function cloneState(state: SemanticAuthoringState): SemanticAuthoringState {
  return semanticAuthoringStateSchema.parse(state);
}

export interface InMemorySemanticAuthoringStoreOptions {
  readonly now?: () => string;
  readonly new_id?: () => string;
}

export class InMemorySemanticAuthoringStore implements SemanticAuthoringStorePort {
  readonly #states = new Map<string, SemanticAuthoringState>();
  readonly #events = new Map<string, SemanticAuthoringPublicEvent[]>();
  readonly #receipts = new Map<string, SemanticAuthoringToolReceipt>();
  readonly #startKeys = new Map<string, string>();
  readonly #resumeKeys = new Set<string>();
  readonly #now: () => string;
  readonly #newId: () => string;

  constructor(options: InMemorySemanticAuthoringStoreOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newId = options.new_id ?? (() => crypto.randomUUID());
  }

  async start(input: SemanticAuthoringStartInput): Promise<PortResult<SemanticAuthoringState>> {
    try {
      const parsed = semanticAuthoringStartInputSchema.parse(input);
      const existingRunId = this.#startKeys.get(parsed.idempotency_key);
      if (existingRunId !== undefined) {
        return { ok: true, value: cloneState(requireState(this.#states, existingRunId)) };
      }
      if (this.#states.has(parsed.authoring_run_id)) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_RUN_CONFLICT",
          "authoring_run_id 已被其他请求使用。",
        );
      }
      if (
        [...this.#states.values()].some(
          (state) =>
            state.run.scope.app_id === parsed.scope.app_id &&
            state.run.scope.tenant_id === parsed.scope.tenant_id &&
            state.run.scope.environment === parsed.scope.environment &&
            state.run.semantic_domain === parsed.semantic_domain &&
            state.run.candidate_id === parsed.candidate_id &&
            ["RUNNING", "WAITING_CLARIFICATION"].includes(state.run.status),
        )
      ) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_SINGLE_WRITER_CONFLICT",
          "同一 candidate 已有 active fenced writer。",
        );
      }
      const timestamp = this.#now();
      const state = semanticAuthoringStateSchema.parse({
        run: {
          schema_version: SEMANTIC_AUTHORING_RUN_VERSION,
          authority: "NON_AUTHORITATIVE_IN_MEMORY",
          scope: parsed.scope,
          semantic_domain: parsed.semantic_domain,
          authoring_run_id: parsed.authoring_run_id,
          candidate_id: parsed.candidate_id,
          graph_id: parsed.base_graph.metadata.graph_id,
          base_release_id: parsed.base_release_id,
          principal_id: parsed.principal_id,
          policy_version: parsed.policy_version,
          status: "RUNNING",
          working_revision: 0,
          graph_digest: await computeSemanticGraphDigest(parsed.base_graph),
          writer_fence: 1,
          current_turn: 0,
          pending_request_digest: null,
          used_tool_calls: 0,
          budget: parsed.budget,
          validation_receipt_digest: null,
          clarification: null,
          created_at: timestamp,
          updated_at: timestamp,
        },
        working_graph: parsed.base_graph,
        checkpoint: {
          checkpoint_version: SEMANTIC_AUTHORING_CHECKPOINT_VERSION,
          messages: [{ role: "user", content: parsed.instruction }],
          pending_agent_request: null,
          read_node_ids: [],
          read_edge_ids: [],
          searches: [],
          pending_tool_calls: [],
          last_validation: null,
        },
        event_sequence: 0,
      });
      this.#states.set(parsed.authoring_run_id, state);
      this.#events.set(parsed.authoring_run_id, []);
      this.#startKeys.set(parsed.idempotency_key, parsed.authoring_run_id);
      return { ok: true, value: cloneState(state) };
    } catch (error) {
      return failure(error);
    }
  }

  async load(input: {
    readonly scope: SemanticAuthoringState["run"]["scope"];
    readonly semantic_domain: string;
    readonly authoring_run_id: string;
  }): Promise<PortResult<SemanticAuthoringState | null>> {
    const state = this.#states.get(input.authoring_run_id);
    if (state === undefined) return { ok: true, value: null };
    if (
      state.run.scope.app_id !== input.scope.app_id ||
      state.run.scope.tenant_id !== input.scope.tenant_id ||
      state.run.scope.environment !== input.scope.environment ||
      state.run.semantic_domain !== input.semantic_domain
    ) {
      return {
        ok: false,
        error: {
          code: "SEMANTIC_AUTHORING_SCOPE_MISMATCH",
          message: "Authoring run 不属于当前 Scope。",
          retryable: false,
        },
      };
    }
    return { ok: true, value: cloneState(state) };
  }

  async commitTurn(
    input: SemanticAuthoringCommitTurnInput,
  ): Promise<PortResult<SemanticAuthoringState>> {
    try {
      const state = requireState(this.#states, input.authoring_run_id);
      if (
        state.run.status !== "RUNNING" ||
        state.run.writer_fence !== input.expected_writer_fence ||
        state.run.current_turn !== input.expected_turn ||
        state.run.pending_request_digest !== input.request_digest
      ) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_TURN_CONFLICT",
          "Authoring turn 的状态、fence 或 turn CAS 失败。",
        );
      }
      const events = this.#events.get(input.authoring_run_id) ?? [];
      const eventSequence = appendEvents(state.event_sequence, events, input.events);
      const next = semanticAuthoringStateSchema.parse({
        ...state,
        run: {
          ...state.run,
          current_turn: state.run.current_turn + 1,
          pending_request_digest: null,
          updated_at: this.#now(),
        },
        checkpoint: input.checkpoint,
        event_sequence: eventSequence,
      });
      this.#events.set(input.authoring_run_id, events);
      this.#states.set(input.authoring_run_id, next);
      return { ok: true, value: cloneState(next) };
    } catch (error) {
      return failure(error);
    }
  }

  async beginTurn(
    input: SemanticAuthoringBeginTurnInput,
  ): Promise<PortResult<SemanticAuthoringState>> {
    try {
      const state = requireState(this.#states, input.authoring_run_id);
      if (
        state.run.status !== "RUNNING" ||
        state.run.writer_fence !== input.expected_writer_fence ||
        state.run.current_turn !== input.expected_turn
      ) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_TURN_CONFLICT",
          "Begin Agent turn 的状态、fence 或 turn CAS 失败。",
        );
      }
      if (state.run.pending_request_digest !== null) {
        if (state.run.pending_request_digest !== input.request_digest) {
          throw new StoreError(
            "SEMANTIC_AUTHORING_PENDING_REQUEST_CONFLICT",
            "当前已有不同的 pending Agent request。",
          );
        }
        return { ok: true, value: cloneState(state) };
      }
      const events = this.#events.get(input.authoring_run_id) ?? [];
      const eventSequence = appendEvents(state.event_sequence, events, input.events);
      const next = semanticAuthoringStateSchema.parse({
        ...state,
        run: {
          ...state.run,
          pending_request_digest: input.request_digest,
          updated_at: this.#now(),
        },
        checkpoint: input.checkpoint,
        event_sequence: eventSequence,
      });
      this.#events.set(input.authoring_run_id, events);
      this.#states.set(input.authoring_run_id, next);
      return { ok: true, value: cloneState(next) };
    } catch (error) {
      return failure(error);
    }
  }

  async findToolReceipt(input: {
    readonly authoring_run_id: string;
    readonly tool_call_id: string;
  }): Promise<PortResult<SemanticAuthoringToolReceipt | null>> {
    return {
      ok: true,
      value: this.#receipts.get(`${input.authoring_run_id}:${input.tool_call_id}`) ?? null,
    };
  }

  async commitTool(
    input: SemanticAuthoringCommitToolInput,
  ): Promise<PortResult<SemanticAuthoringState>> {
    try {
      const state = requireState(this.#states, input.authoring_run_id);
      const receiptKey = `${input.authoring_run_id}:${input.receipt.tool_call_id}`;
      const existing = this.#receipts.get(receiptKey);
      if (existing !== undefined) {
        if (existing.input_digest !== input.receipt.input_digest) {
          throw new StoreError(
            "SEMANTIC_AUTHORING_TOOL_IDEMPOTENCY_CONFLICT",
            "相同 tool_call_id 对应了不同输入。",
          );
        }
        return { ok: true, value: cloneState(state) };
      }
      if (
        state.run.status !== "RUNNING" ||
        state.run.writer_fence !== input.expected_writer_fence ||
        state.run.working_revision !== input.expected_working_revision ||
        state.run.graph_digest !== input.expected_graph_digest ||
        input.receipt.from_working_revision !== state.run.working_revision ||
        input.receipt.before_digest !== state.run.graph_digest
      ) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_TOOL_CONFLICT",
          "Authoring tool 的状态、fence、revision 或 digest CAS 失败。",
        );
      }
      const nextDigest = await computeSemanticGraphDigest(input.next_graph);
      if (
        nextDigest !== input.receipt.after_digest ||
        input.receipt.to_working_revision !==
          state.run.working_revision + (input.receipt.mutation ? 1 : 0)
      ) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_TOOL_RECEIPT_INVALID",
          "Tool receipt 与 next Graph 不一致。",
        );
      }
      const events = this.#events.get(input.authoring_run_id) ?? [];
      const eventSequence = appendEvents(state.event_sequence, events, input.events);
      const clarification =
        input.receipt.status === "CLARIFICATION_REQUIRED"
          ? (() => {
              const result = input.receipt.result as {
                clarification_id?: unknown;
                question?: unknown;
                options?: unknown;
              };
              if (
                typeof result.clarification_id !== "string" ||
                typeof result.question !== "string" ||
                !Array.isArray(result.options) ||
                !result.options.every((option) => typeof option === "string")
              ) {
                throw new StoreError(
                  "SEMANTIC_AUTHORING_CLARIFICATION_INVALID",
                  "Clarification tool receipt 无效。",
                );
              }
              return {
                clarification_id: result.clarification_id,
                question: result.question,
                options: result.options,
                answer: null,
              };
            })()
          : state.run.clarification;
      const next = semanticAuthoringStateSchema.parse({
        ...state,
        run: {
          ...state.run,
          status:
            input.receipt.status === "CLARIFICATION_REQUIRED"
              ? "WAITING_CLARIFICATION"
              : state.run.status,
          working_revision: input.receipt.to_working_revision,
          graph_digest: input.receipt.after_digest,
          used_tool_calls: state.run.used_tool_calls + 1,
          validation_receipt_digest: input.checkpoint.last_validation?.receipt_digest ?? null,
          clarification,
          updated_at: this.#now(),
        },
        working_graph: input.next_graph,
        checkpoint: input.checkpoint,
        event_sequence: eventSequence,
      });
      this.#receipts.set(receiptKey, input.receipt);
      this.#events.set(input.authoring_run_id, events);
      this.#states.set(input.authoring_run_id, next);
      return { ok: true, value: cloneState(next) };
    } catch (error) {
      return failure(error);
    }
  }

  async resume(input: SemanticAuthoringResumeInput): Promise<PortResult<SemanticAuthoringState>> {
    try {
      const state = requireState(this.#states, input.authoring_run_id);
      const key = `${input.authoring_run_id}:${input.idempotency_key}`;
      if (this.#resumeKeys.has(key)) return { ok: true, value: cloneState(state) };
      if (
        state.run.status !== "WAITING_CLARIFICATION" ||
        state.run.clarification?.clarification_id !== input.clarification_id
      ) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_CLARIFICATION_CONFLICT",
          "Authoring run 未在等待对应的 clarification。",
        );
      }
      const event: SemanticAuthoringPublicEvent = {
        schema_version: "semantic-authoring-public-event@1.0.0",
        event_id: this.#newId(),
        run_id: state.run.authoring_run_id,
        sequence: state.event_sequence + 1,
        occurred_at: this.#now(),
        type: "clarification",
        payload: {
          clarification_id: input.clarification_id,
          question: state.run.clarification.question,
          options: state.run.clarification.options,
          status: "ANSWERED",
        },
      };
      const events = this.#events.get(input.authoring_run_id) ?? [];
      const eventSequence = appendEvents(state.event_sequence, events, [event]);
      const next = semanticAuthoringStateSchema.parse({
        ...state,
        run: {
          ...state.run,
          status: "RUNNING",
          clarification: { ...state.run.clarification, answer: input.answer },
          writer_fence: state.run.writer_fence + 1,
          updated_at: this.#now(),
        },
        checkpoint: {
          ...state.checkpoint,
          messages: [
            ...state.checkpoint.messages,
            { role: "user", content: `澄清答复：${input.answer}` },
          ],
        },
        event_sequence: eventSequence,
      });
      this.#resumeKeys.add(key);
      this.#events.set(input.authoring_run_id, events);
      this.#states.set(input.authoring_run_id, next);
      return { ok: true, value: cloneState(next) };
    } catch (error) {
      return failure(error);
    }
  }

  async complete(
    input: SemanticAuthoringCompleteInput,
  ): Promise<PortResult<SemanticAuthoringState>> {
    try {
      const state = requireState(this.#states, input.authoring_run_id);
      if (
        state.run.status !== "RUNNING" ||
        state.run.writer_fence !== input.expected_writer_fence ||
        state.run.working_revision !== input.expected_working_revision ||
        state.run.graph_digest !== input.expected_graph_digest ||
        input.validation_receipt.graph_digest !== state.run.graph_digest ||
        input.validation_receipt.receipt_digest !== state.run.validation_receipt_digest ||
        !input.validation_receipt.valid ||
        (await computeSemanticGraphDigest(input.final_graph)) !== state.run.graph_digest
      ) {
        throw new StoreError(
          "SEMANTIC_AUTHORING_COMPLETE_CONFLICT",
          "Complete 必须绑定当前 Graph、fence、revision 和 exact valid receipt。",
        );
      }
      const events = this.#events.get(input.authoring_run_id) ?? [];
      const eventSequence = appendEvents(state.event_sequence, events, [input.event]);
      const next = semanticAuthoringStateSchema.parse({
        ...state,
        run: { ...state.run, status: "READY_FOR_REVIEW", updated_at: this.#now() },
        event_sequence: eventSequence,
      });
      this.#events.set(input.authoring_run_id, events);
      this.#states.set(input.authoring_run_id, next);
      return { ok: true, value: cloneState(next) };
    } catch (error) {
      return failure(error);
    }
  }

  async fail(input: {
    readonly authoring_run_id: string;
    readonly expected_writer_fence: number;
    readonly error_code: string;
    readonly event: SemanticAuthoringPublicEvent;
  }): Promise<PortResult<SemanticAuthoringState>> {
    try {
      const state = requireState(this.#states, input.authoring_run_id);
      if (state.run.writer_fence !== input.expected_writer_fence) {
        throw new StoreError("SEMANTIC_AUTHORING_FENCE_CONFLICT", "Writer fence CAS 失败。");
      }
      const events = this.#events.get(input.authoring_run_id) ?? [];
      const eventSequence = appendEvents(state.event_sequence, events, [input.event]);
      const next = semanticAuthoringStateSchema.parse({
        ...state,
        run: { ...state.run, status: "FAILED", updated_at: this.#now() },
        event_sequence: eventSequence,
      });
      this.#events.set(input.authoring_run_id, events);
      this.#states.set(input.authoring_run_id, next);
      return { ok: true, value: cloneState(next) };
    } catch (error) {
      return failure(error);
    }
  }

  async listEvents(input: {
    readonly scope: SemanticAuthoringState["run"]["scope"];
    readonly semantic_domain: string;
    readonly authoring_run_id: string;
    readonly after_sequence?: number;
    readonly limit?: number;
  }): Promise<PortResult<readonly SemanticAuthoringPublicEvent[]>> {
    const loaded = await this.load(input);
    if (!loaded.ok) return loaded;
    if (loaded.value === null) return { ok: true, value: [] };
    const after = input.after_sequence ?? 0;
    return {
      ok: true,
      value: (this.#events.get(input.authoring_run_id) ?? [])
        .filter((event) => event.sequence > after)
        .slice(0, input.limit ?? 1_000),
    };
  }
}
