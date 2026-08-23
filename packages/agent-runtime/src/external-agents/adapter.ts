import { Buffer } from "node:buffer";
import {
  type AuthoritativeExternalAgentInvocation,
  artifactReferenceIdentity,
  authorizeExternalAgentInvocation,
  canonicalizeJson,
  EXTERNAL_AGENT_PUBLIC_OUTPUT_DELTA_MAX_CHARACTERS,
  type ExternalAgentCancelConfirmation,
  type ExternalAgentCancelRequest,
  type ExternalAgentEvent,
  type ExternalAgentPort,
  externalAgentCancelRequestSchema,
  isAuthoritativeExternalAgentAuditReceipt,
  isAuthoritativeExternalAgentInvocation,
  isCanonicalPosixWorkspaceRoot,
  type PortResult,
  parseExternalAgentEventForRequest,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  type EnabledExternalAgentRegistration,
  type ExternalAgentCompletionAuthority,
  type ExternalAgentOutputSecurity,
  type ExternalAgentProcessEvent,
  type ExternalAgentProcessSession,
  type ExternalAgentProcessTerminationConfirmation,
  type ExternalAgentRuntimeLimits,
  externalAgentOutputRedactionResultSchema,
  externalAgentOutputScanResultSchema,
  externalAgentProcessEventSchema,
  externalAgentProcessTerminationConfirmationSchema,
  externalAgentProcessTerminationRequestSchema,
} from "./contracts.js";
import { ExternalAgentRuntimeError } from "./errors.js";
import type { ServerExternalAgentRegistry } from "./registry.js";

type FailedTerminal = {
  readonly event_type: "FAILED";
  readonly reason_code:
    | "EXTERNAL_AGENT_ACTION_BUDGET_EXCEEDED"
    | "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE"
    | "EXTERNAL_AGENT_EXECUTION_FAILED"
    | "EXTERNAL_AGENT_OUTPUT_BUDGET_EXCEEDED"
    | "EXTERNAL_AGENT_OUTPUT_SECURITY_FAILED"
    | "EXTERNAL_AGENT_PERMISSION_VIOLATION"
    | "EXTERNAL_AGENT_PROTOCOL_INCOMPLETE"
    | "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED"
    | "EXTERNAL_AGENT_TIMEOUT";
  readonly retryable: false;
};

type CancelledTerminal = {
  readonly event_type: "CANCELLED";
  readonly reason_code: string;
  readonly retryable: false;
};

type CompletedTerminal = {
  readonly event_type: "COMPLETED";
  readonly audit_receipt_ref: Extract<
    ExternalAgentProcessEvent,
    { readonly event_type: "PROCESS_EXITED" }
  >["audit_receipt_ref"];
};

type Terminal = FailedTerminal | CancelledTerminal | CompletedTerminal;

type PublicEventPayload =
  | { readonly event_type: "STARTED" }
  | {
      readonly event_type: "OUTPUT_DELTA";
      readonly channel: "stdout" | "stderr";
      readonly delta: string;
    }
  | {
      readonly event_type: "AUDIT_ACTION";
      readonly action: string;
      readonly target: string;
      readonly verdict: "ALLOWED" | "BLOCKED";
    }
  | Terminal;

type ProjectedAction = Readonly<{
  action_kind: "TOOL" | "COMMAND";
  action: string;
  effect: "READ" | "WRITE";
  target: string;
  verdict: "ALLOWED" | "BLOCKED";
}>;

type ProjectedOutput = Readonly<{
  channel: "stdout" | "stderr";
  delta: string;
}>;

type BufferedOutputRun = {
  readonly channel: "stdout" | "stderr";
  readonly chunks: string[];
};

type PendingPublicEvent =
  | Readonly<{
      kind: "OUTPUT";
      output_index: number;
    }>
  | Readonly<{
      kind: "AUDIT";
      action: ProjectedAction;
    }>;

interface ActiveInvocation {
  readonly key: string;
  readonly invocation: AuthoritativeExternalAgentInvocation;
  readonly registration: EnabledExternalAgentRegistration;
  readonly controller: AbortController;
  readonly limits: ExternalAgentRuntimeLimits;
  readonly actions: ProjectedAction[];
  readonly outputs: ProjectedOutput[];
  readonly pending_outputs: BufferedOutputRun[];
  readonly pending_events: PendingPublicEvent[];
  readonly deadline_at_ms: number;
  session: ExternalAgentProcessSession | null;
  termination_request: Promise<ExternalAgentProcessTerminationConfirmation | null> | null;
  termination_reason: string | null;
  deadline_expired: boolean;
  deadline_resolution: Promise<void> | null;
  next_sequence: number;
  buffered_output_bytes: number;
  output_bytes: number;
  action_count: number;
  process_exited: boolean;
  terminal: Terminal | null;
}

type IteratorOutcome =
  | { readonly kind: "ABORTED" }
  | { readonly kind: "ERRORED" }
  | { readonly kind: "NEXT"; readonly result: IteratorResult<unknown> };

type BoundaryOutcome<T> =
  | { readonly kind: "ABORTED" }
  | { readonly kind: "ERRORED" }
  | { readonly kind: "TIMEOUT" }
  | { readonly kind: "VALUE"; readonly value: T };

export interface BoundedExternalAgentAdapterSecurity {
  readonly output_security: ExternalAgentOutputSecurity;
  readonly completion_authority: ExternalAgentCompletionAuthority;
}

function invocationKey(input: {
  readonly scope: AuthoritativeExternalAgentInvocation["scope"];
  readonly run_id: string;
  readonly invocation_id: string;
  readonly attempt_id: string;
}): string {
  return canonicalizeJson([
    input.scope.environment,
    input.scope.app_id,
    input.scope.tenant_id,
    input.run_id,
    input.invocation_id,
    input.attempt_id,
  ]);
}

function effectiveLimits(
  invocation: AuthoritativeExternalAgentInvocation,
  registration: EnabledExternalAgentRegistration,
): ExternalAgentRuntimeLimits {
  return Object.freeze({
    max_timeout_ms: Math.min(
      invocation.budget.timeout_ms,
      registration.limits.max_timeout_ms,
      registration.profile.cancellation.timeout_ms,
    ),
    max_termination_confirmation_ms: Math.min(
      registration.limits.max_termination_confirmation_ms,
      registration.profile.cancellation.timeout_ms,
    ),
    max_output_bytes: Math.min(
      invocation.budget.max_output_bytes,
      registration.limits.max_output_bytes,
    ),
    max_actions: Math.min(invocation.budget.max_actions, registration.limits.max_actions),
  });
}

function reserveTerminal(state: ActiveInvocation, terminal: Terminal): boolean {
  if (state.terminal !== null || (terminal.event_type === "COMPLETED" && state.deadline_expired)) {
    return false;
  }
  state.terminal = terminal;
  if (!state.controller.signal.aborted) {
    state.controller.abort(terminal.event_type);
  }
  return true;
}

function reserveOrReadTerminal(state: ActiveInvocation, terminal: Terminal): Terminal {
  reserveTerminal(state, terminal);
  return state.terminal ?? terminal;
}

function closeIterator(iterator: AsyncIterator<unknown> | null): void {
  if (!iterator?.return) {
    return;
  }
  try {
    void Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // 清理异常不能覆盖已经确定的公开终态。
  }
}

async function readNextOrAbort(
  iterator: AsyncIterator<unknown>,
  signal: AbortSignal,
): Promise<IteratorOutcome> {
  if (signal.aborted) {
    return { kind: "ABORTED" };
  }

  return new Promise<IteratorOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: IteratorOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => {
      finish({ kind: "ABORTED" });
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      void Promise.resolve(iterator.next()).then(
        (result) => {
          finish({ kind: "NEXT", result });
        },
        () => {
          finish({ kind: "ERRORED" });
        },
      );
    } catch {
      finish({ kind: "ERRORED" });
    }
  });
}

async function waitForBoundary<T>(
  input: Promise<T> | T,
  options: {
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  },
): Promise<BoundaryOutcome<T>> {
  if (options.signal?.aborted) {
    return { kind: "ABORTED" };
  }

  return new Promise<BoundaryOutcome<T>>((resolve) => {
    let settled = false;
    const finish = (outcome: BoundaryOutcome<T>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => {
      finish({ kind: "ABORTED" });
    };
    const timer = setTimeout(
      () => {
        finish({ kind: "TIMEOUT" });
      },
      Math.max(1, options.timeout_ms),
    );
    options.signal?.addEventListener("abort", onAbort, { once: true });

    void Promise.resolve(input).then(
      (value) => {
        finish({ kind: "VALUE", value });
      },
      () => {
        finish({ kind: "ERRORED" });
      },
    );
  });
}

function notActiveResult(): PortResult<ExternalAgentCancelConfirmation> {
  return {
    ok: false,
    error: {
      code: "EXTERNAL_AGENT_INVOCATION_NOT_ACTIVE",
      message: "没有找到可取消的精确 Scope/Run/Attempt External Agent 调用。",
      retryable: false,
    },
  };
}

function terminationUnconfirmedResult(): PortResult<ExternalAgentCancelConfirmation> {
  return {
    ok: false,
    error: {
      code: "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED",
      message: "Process Host 未确认对应进程已经退出，不能声明取消成功。",
      retryable: false,
    },
  };
}

function isSameScope(
  left: AuthoritativeExternalAgentInvocation["scope"],
  right: AuthoritativeExternalAgentInvocation["scope"],
): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function utf8SafeBoundaryAtOrBefore(text: string, candidate: number, floor: number): number {
  let boundary = Math.max(floor, Math.min(candidate, text.length));
  if (
    boundary > floor &&
    boundary < text.length &&
    isHighSurrogate(text.charCodeAt(boundary - 1)) &&
    isLowSurrogate(text.charCodeAt(boundary))
  ) {
    boundary -= 1;
  }
  return boundary;
}

function splitUtf8SafePublicDelta(text: string): readonly string[] | null {
  if (text.length === 0) {
    return Object.freeze([]);
  }
  if (Buffer.from(text, "utf8").toString("utf8") !== text) {
    return null;
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const candidate = Math.min(
      start + EXTERNAL_AGENT_PUBLIC_OUTPUT_DELTA_MAX_CHARACTERS,
      text.length,
    );
    const end = utf8SafeBoundaryAtOrBefore(text, candidate, start);
    if (end === start) {
      return null;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return Object.freeze(chunks);
}

function partitionProtectedChannelOutput(
  protectedDelta: string,
  sourceDeltas: readonly string[],
): readonly string[] | null {
  if (sourceDeltas.length === 0 || protectedDelta.length === 0) {
    return null;
  }
  if (Buffer.from(protectedDelta, "utf8").toString("utf8") !== protectedDelta) {
    return null;
  }
  if (sourceDeltas.length === 1) {
    return Object.freeze([protectedDelta]);
  }

  const totalSourceCharacters = sourceDeltas.reduce((total, delta) => total + delta.length, 0);
  if (totalSourceCharacters === 0) {
    return null;
  }

  const partitions: string[] = [];
  let sourceCharacters = 0;
  let start = 0;
  sourceDeltas.forEach((sourceDelta, index) => {
    sourceCharacters += sourceDelta.length;
    const candidate =
      index === sourceDeltas.length - 1
        ? protectedDelta.length
        : Math.floor((protectedDelta.length * sourceCharacters) / totalSourceCharacters);
    const end = utf8SafeBoundaryAtOrBefore(protectedDelta, candidate, start);
    partitions.push(protectedDelta.slice(start, end));
    start = end;
  });
  return Object.freeze(partitions);
}

function isSession(value: unknown): value is ExternalAgentProcessSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const events = Reflect.get(value, "events");
  return (
    typeof Reflect.get(value, "session_id") === "string" &&
    typeof events === "object" &&
    events !== null &&
    typeof Reflect.get(events, Symbol.asyncIterator) === "function" &&
    typeof Reflect.get(value, "requestTermination") === "function"
  );
}

async function targetProjection(
  event: Extract<ExternalAgentProcessEvent, { event_type: "AUDIT_ACTION" }>,
): Promise<string> {
  if (event.verdict === "BLOCKED") {
    return `blocked-target:${await sha256ContentHash(event.target)}`;
  }
  return event.target.kind === "WORKSPACE_PATH"
    ? event.target.path
    : `artifact:${artifactReferenceIdentity(event.target.reference)}`;
}

function actionFitsInvocation(
  invocation: AuthoritativeExternalAgentInvocation,
  event: Extract<ExternalAgentProcessEvent, { event_type: "AUDIT_ACTION" }>,
): boolean {
  if (event.verdict === "BLOCKED") {
    return true;
  }

  const actionAllowed =
    event.action_kind === "TOOL"
      ? invocation.permission_policy.allowed_tools.includes(event.action)
      : invocation.permission_policy.allowed_command_ids.includes(event.action);
  if (!actionAllowed || (event.effect === "WRITE" && !invocation.workspace_policy.writable)) {
    return false;
  }

  if (event.target.kind === "WORKSPACE_PATH") {
    const targetPath = event.target.path;
    return (
      isCanonicalPosixWorkspaceRoot(targetPath) &&
      invocation.workspace_policy.roots.some(
        (root) => targetPath === root || targetPath.startsWith(`${root}/`),
      )
    );
  }

  if (event.effect !== "READ") {
    return false;
  }
  const allowedReferences = new Set(
    [invocation.task_ref, ...invocation.context_refs].map(artifactReferenceIdentity),
  );
  return allowedReferences.has(artifactReferenceIdentity(event.target.reference));
}

export class BoundedExternalAgentAdapter implements ExternalAgentPort {
  readonly #active = new Map<string, ActiveInvocation>();

  constructor(
    private readonly registry: ServerExternalAgentRegistry,
    private readonly security: BoundedExternalAgentAdapterSecurity,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async *stream(input: AuthoritativeExternalAgentInvocation): AsyncIterable<ExternalAgentEvent> {
    if (!isAuthoritativeExternalAgentInvocation(input)) {
      throw new ExternalAgentRuntimeError(
        "EXTERNAL_AGENT_INVOCATION_NOT_AUTHORIZED",
        "External Agent Adapter 只接受服务端授权调用。",
      );
    }

    let invocation: AuthoritativeExternalAgentInvocation;
    try {
      invocation = await authorizeExternalAgentInvocation(input, this.registry.resolveProfile);
    } catch {
      throw new ExternalAgentRuntimeError(
        "EXTERNAL_AGENT_INVOCATION_NOT_AUTHORIZED",
        "External Agent 调用未通过当前服务端 Registry 授权。",
      );
    }

    const registration = this.registry.resolveEnabledRegistration({
      scope: invocation.scope,
      profile_id: invocation.profile_id,
      profile_version: invocation.profile_version,
    });
    if (!registration || registration.profile.adapter !== invocation.adapter) {
      throw new ExternalAgentRuntimeError(
        "EXTERNAL_AGENT_PROFILE_NOT_ENABLED",
        "External Agent Profile 未在当前服务端 Registry 启用。",
      );
    }

    const key = invocationKey(invocation);
    if (this.#active.has(key)) {
      throw new ExternalAgentRuntimeError(
        "EXTERNAL_AGENT_INVOCATION_ALREADY_ACTIVE",
        "同一 Scope/Run/Invocation 的 External Agent 调用仍在执行。",
      );
    }

    const state: ActiveInvocation = {
      key,
      invocation,
      registration,
      controller: new AbortController(),
      limits: effectiveLimits(invocation, registration),
      actions: [],
      outputs: [],
      pending_outputs: [],
      pending_events: [],
      deadline_at_ms: Date.now() + effectiveLimits(invocation, registration).max_timeout_ms,
      session: null,
      termination_request: null,
      termination_reason: null,
      deadline_expired: false,
      deadline_resolution: null,
      next_sequence: 0,
      buffered_output_bytes: 0,
      output_bytes: 0,
      action_count: 0,
      process_exited: false,
      terminal: null,
    };
    this.#active.set(key, state);

    let iterator: AsyncIterator<unknown> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      timeout = setTimeout(() => {
        this.#expireDeadline(state);
      }, state.limits.max_timeout_ms);

      try {
        const started = await waitForBoundary(
          registration.process_host.start({
            invocation,
            limits: state.limits,
            signal: state.controller.signal,
          }),
          {
            timeout_ms: this.#remainingInvocationMs(state),
            signal: state.controller.signal,
          },
        );
        if (started.kind !== "VALUE" || !isSession(started.value)) {
          throw new TypeError("Process Host 返回了非法 Session。");
        }
        state.session = started.value;
        iterator = started.value.events[Symbol.asyncIterator]();
      } catch {
        if (state.terminal === null) {
          reserveTerminal(state, {
            event_type: "FAILED",
            reason_code:
              Date.now() >= state.deadline_at_ms
                ? "EXTERNAL_AGENT_TIMEOUT"
                : "EXTERNAL_AGENT_EXECUTION_FAILED",
            retryable: false,
          });
        }
      }

      yield this.#makeEvent(invocation, state, { event_type: "STARTED" });

      while (state.terminal === null && iterator !== null) {
        const outcome = await readNextOrAbort(iterator, state.controller.signal);
        if (state.terminal !== null || state.deadline_expired || outcome.kind === "ABORTED") {
          break;
        }
        if (outcome.kind === "ERRORED") {
          reserveTerminal(state, {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_EXECUTION_FAILED",
            retryable: false,
          });
          break;
        }
        if (outcome.result.done) {
          reserveTerminal(state, {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_PROTOCOL_INCOMPLETE",
            retryable: false,
          });
          break;
        }

        const rawEvent = externalAgentProcessEventSchema.safeParse(outcome.result.value);
        if (!rawEvent.success) {
          reserveTerminal(state, {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_EXECUTION_FAILED",
            retryable: false,
          });
          break;
        }

        if (rawEvent.data.event_type === "OUTPUT_DELTA") {
          const nextOutputBytes =
            state.buffered_output_bytes + Buffer.byteLength(rawEvent.data.delta, "utf8");
          if (nextOutputBytes > state.limits.max_output_bytes) {
            reserveTerminal(state, {
              event_type: "FAILED",
              reason_code: "EXTERNAL_AGENT_OUTPUT_BUDGET_EXCEEDED",
              retryable: false,
            });
            break;
          }
          state.buffered_output_bytes = nextOutputBytes;
          const previousEvent = state.pending_events.at(-1);
          const previousOutput =
            previousEvent?.kind === "OUTPUT"
              ? state.pending_outputs[previousEvent.output_index]
              : undefined;
          if (previousOutput?.channel === rawEvent.data.channel) {
            previousOutput.chunks.push(rawEvent.data.delta);
          } else {
            const outputIndex = state.pending_outputs.length;
            state.pending_outputs.push({
              channel: rawEvent.data.channel,
              chunks: [rawEvent.data.delta],
            });
            state.pending_events.push(
              Object.freeze({
                kind: "OUTPUT",
                output_index: outputIndex,
              }),
            );
          }
          continue;
        }

        if (rawEvent.data.event_type === "AUDIT_ACTION") {
          state.action_count += 1;
          if (state.action_count > state.limits.max_actions) {
            reserveTerminal(state, {
              event_type: "FAILED",
              reason_code: "EXTERNAL_AGENT_ACTION_BUDGET_EXCEEDED",
              retryable: false,
            });
            break;
          }
          if (!actionFitsInvocation(invocation, rawEvent.data)) {
            reserveTerminal(state, {
              event_type: "FAILED",
              reason_code: "EXTERNAL_AGENT_PERMISSION_VIOLATION",
              retryable: false,
            });
            break;
          }
          const action = Object.freeze({
            action_kind: rawEvent.data.action_kind,
            action: rawEvent.data.action,
            effect: rawEvent.data.effect,
            target: await targetProjection(rawEvent.data),
            verdict: rawEvent.data.verdict,
          });
          state.actions.push(action);
          state.pending_events.push(Object.freeze({ kind: "AUDIT", action }));
          continue;
        }

        state.process_exited = true;
        if (rawEvent.data.exit_code !== 0) {
          reserveTerminal(state, {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_EXECUTION_FAILED",
            retryable: false,
          });
          break;
        }

        const protectedOutputs = await this.#protectBufferedOutput(invocation, state);
        if (state.deadline_expired || state.terminal !== null) {
          break;
        }
        if (protectedOutputs === null) {
          reserveTerminal(state, {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_OUTPUT_SECURITY_FAILED",
            retryable: false,
          });
          break;
        }
        const protectedOutputBytes = protectedOutputs.reduce(
          (total, outputs) =>
            total +
            outputs.reduce(
              (outputTotal, output) => outputTotal + Buffer.byteLength(output.delta, "utf8"),
              0,
            ),
          0,
        );
        if (protectedOutputBytes > state.limits.max_output_bytes) {
          reserveTerminal(state, {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_OUTPUT_BUDGET_EXCEEDED",
            retryable: false,
          });
          break;
        }
        // Security 按 channel 观察完整缓冲，但公开投影严格回到 Process Event 顺序。
        for (const pendingEvent of state.pending_events) {
          if (pendingEvent.kind === "AUDIT") {
            yield this.#makeEvent(invocation, state, {
              event_type: "AUDIT_ACTION",
              action: pendingEvent.action.action,
              target: pendingEvent.action.target,
              verdict: pendingEvent.action.verdict,
            });
            continue;
          }
          for (const output of protectedOutputs[pendingEvent.output_index] ?? []) {
            state.outputs.push(output);
            state.output_bytes += Buffer.byteLength(output.delta, "utf8");
            yield this.#makeEvent(invocation, state, {
              event_type: "OUTPUT_DELTA",
              ...output,
            });
          }
        }
        const completed = await this.#authorizeCompletion(invocation, state, rawEvent.data);
        if (state.deadline_expired || state.terminal !== null) {
          break;
        }
        reserveTerminal(
          state,
          completed ?? {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE",
            retryable: false,
          },
        );
      }

      if (state.deadline_resolution !== null) {
        await state.deadline_resolution;
      }
      const terminal = await this.#settleTerminal(state);
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      this.#active.delete(key);
      closeIterator(iterator);
      iterator = null;
      yield this.#makeEvent(invocation, state, terminal);
    } catch {
      if (state.terminal === null) {
        reserveTerminal(state, {
          event_type: "FAILED",
          reason_code: "EXTERNAL_AGENT_EXECUTION_FAILED",
          retryable: false,
        });
      }
      const terminal = await this.#settleTerminal(state);
      yield this.#makeEvent(invocation, state, terminal);
    } finally {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      if (this.#active.get(key) === state) {
        this.#active.delete(key);
      }
      if (state.session !== null && !state.process_exited) {
        const reasonCode =
          state.terminal && state.terminal.event_type !== "COMPLETED"
            ? state.terminal.reason_code
            : "EXTERNAL_AGENT_CONSUMER_CLOSED";
        const confirmation = await this.#requestTermination(state, reasonCode);
        if (state.terminal === null) {
          reserveTerminal(
            state,
            confirmation
              ? {
                  event_type: "CANCELLED",
                  reason_code: "EXTERNAL_AGENT_CONSUMER_CLOSED",
                  retryable: false,
                }
              : {
                  event_type: "FAILED",
                  reason_code: "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED",
                  retryable: false,
                },
          );
        } else if (!confirmation) {
          state.terminal = {
            event_type: "FAILED",
            reason_code: "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED",
            retryable: false,
          };
        }
      }
      closeIterator(iterator);
    }
  }

  async cancel(
    input: ExternalAgentCancelRequest,
  ): Promise<PortResult<ExternalAgentCancelConfirmation>> {
    const parsed = externalAgentCancelRequestSchema.safeParse(input);
    if (!parsed.success) {
      return notActiveResult();
    }
    const state = this.#active.get(invocationKey(parsed.data));
    if (
      !state ||
      state.terminal !== null ||
      state.session === null ||
      parsed.data.schema_version !== state.invocation.schema_version
    ) {
      return notActiveResult();
    }

    const confirmation = await this.#requestTermination(state, parsed.data.reason_code);
    if (!confirmation) {
      return terminationUnconfirmedResult();
    }
    if (
      !reserveTerminal(state, {
        event_type: "CANCELLED",
        reason_code: parsed.data.reason_code,
        retryable: false,
      })
    ) {
      return notActiveResult();
    }
    return {
      ok: true,
      value: {
        cancelled: true,
        attempt_id: parsed.data.attempt_id,
      },
    };
  }

  async #settleTerminal(state: ActiveInvocation): Promise<Terminal> {
    let terminal = reserveOrReadTerminal(state, {
      event_type: "FAILED",
      reason_code: "EXTERNAL_AGENT_PROTOCOL_INCOMPLETE",
      retryable: false,
    });
    if (state.session !== null && !state.process_exited) {
      const reasonCode =
        terminal.event_type === "COMPLETED"
          ? "EXTERNAL_AGENT_TERMINATION_REQUIRED"
          : terminal.reason_code;
      if (!(await this.#requestTermination(state, reasonCode))) {
        terminal = {
          event_type: "FAILED",
          reason_code: "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED",
          retryable: false,
        };
        state.terminal = terminal;
      }
    }
    return state.terminal ?? terminal;
  }

  #expireDeadline(state: ActiveInvocation): void {
    if (state.terminal !== null || state.deadline_expired) {
      return;
    }
    state.deadline_expired = true;
    if (!state.controller.signal.aborted) {
      state.controller.abort("EXTERNAL_AGENT_TIMEOUT");
    }
    state.deadline_resolution = this.#resolveExpiredDeadline(state);
  }

  async #resolveExpiredDeadline(state: ActiveInvocation): Promise<void> {
    if (state.session === null) {
      reserveTerminal(state, {
        event_type: "FAILED",
        reason_code: "EXTERNAL_AGENT_TIMEOUT",
        retryable: false,
      });
      return;
    }
    const confirmation = await this.#requestTermination(state, "EXTERNAL_AGENT_TIMEOUT");
    reserveTerminal(state, {
      event_type: "FAILED",
      reason_code: confirmation
        ? "EXTERNAL_AGENT_TIMEOUT"
        : "EXTERNAL_AGENT_TERMINATION_UNCONFIRMED",
      retryable: false,
    });
  }

  async #requestTermination(
    state: ActiveInvocation,
    reasonCode: string,
  ): Promise<ExternalAgentProcessTerminationConfirmation | null> {
    if (state.session === null) {
      return null;
    }
    if (state.termination_request !== null) {
      return state.termination_reason === reasonCode ? state.termination_request : null;
    }

    const request = externalAgentProcessTerminationRequestSchema.parse({
      schema_version: state.invocation.schema_version,
      session_id: state.session.session_id,
      invocation_id: state.invocation.invocation_id,
      attempt_id: state.invocation.attempt_id,
      scope: state.invocation.scope,
      run_id: state.invocation.run_id,
      reason_code: reasonCode,
    });
    const session = state.session;
    state.termination_reason = reasonCode;

    state.termination_request = Promise.resolve()
      .then(() =>
        waitForBoundary(session.requestTermination(request), {
          timeout_ms: Math.min(
            state.registration.profile.cancellation.timeout_ms,
            state.limits.max_termination_confirmation_ms,
          ),
        }),
      )
      .then((outcome) => {
        if (outcome.kind !== "VALUE") {
          return null;
        }
        const result = externalAgentProcessTerminationConfirmationSchema.safeParse(outcome.value);
        if (
          !result.success ||
          result.data.schema_version !== request.schema_version ||
          result.data.session_id !== request.session_id ||
          result.data.invocation_id !== request.invocation_id ||
          result.data.attempt_id !== request.attempt_id ||
          !isSameScope(result.data.scope, request.scope) ||
          result.data.run_id !== request.run_id ||
          result.data.reason_code !== request.reason_code
        ) {
          return null;
        }
        state.process_exited = true;
        return result.data;
      })
      .catch(() => null);
    return state.termination_request;
  }

  async #protectBufferedOutput(
    invocation: AuthoritativeExternalAgentInvocation,
    state: ActiveInvocation,
  ): Promise<readonly (readonly ProjectedOutput[])[] | null> {
    const runIndexesByChannel = new Map<"stdout" | "stderr", number[]>();
    state.pending_outputs.forEach((output, outputIndex) => {
      const runIndexes = runIndexesByChannel.get(output.channel);
      if (runIndexes) {
        runIndexes.push(outputIndex);
      } else {
        runIndexesByChannel.set(output.channel, [outputIndex]);
      }
    });

    const protectedOutputs: ProjectedOutput[][] = state.pending_outputs.map(() => []);
    for (const [channel, runIndexes] of runIndexesByChannel) {
      const sourceDeltas = runIndexes.map(
        (outputIndex) => state.pending_outputs[outputIndex]?.chunks.join("") ?? "",
      );
      const delta = sourceDeltas.join("");
      if (delta.length === 0) {
        return null;
      }
      const protectedDelta = await this.#protectChannelOutput(invocation, state, channel, delta);
      if (protectedDelta === null) {
        return null;
      }
      const protectedRuns = partitionProtectedChannelOutput(protectedDelta, sourceDeltas);
      if (protectedRuns === null) {
        return null;
      }

      for (const [channelRunIndex, outputIndex] of runIndexes.entries()) {
        const chunks = splitUtf8SafePublicDelta(protectedRuns[channelRunIndex] ?? "");
        if (chunks === null) {
          return null;
        }
        protectedOutputs[outputIndex] = chunks.map((chunk) =>
          Object.freeze({
            channel,
            delta: chunk,
          }),
        );
      }
    }
    return Object.freeze(protectedOutputs.map((outputs) => Object.freeze(outputs)));
  }

  async #protectChannelOutput(
    invocation: AuthoritativeExternalAgentInvocation,
    state: ActiveInvocation,
    channel: "stdout" | "stderr",
    delta: string,
  ): Promise<string | null> {
    const scannerInput = {
      scope: invocation.scope,
      run_id: invocation.run_id,
      invocation_id: invocation.invocation_id,
      attempt_id: invocation.attempt_id,
      channel,
      delta,
      stream_final: true,
    } as const;
    try {
      const initialScanOutcome = await waitForBoundary(
        this.security.output_security.scan(scannerInput),
        {
          timeout_ms: this.#remainingInvocationMs(state),
          signal: state.controller.signal,
        },
      );
      if (initialScanOutcome.kind !== "VALUE") {
        if (initialScanOutcome.kind === "TIMEOUT") {
          this.#expireDeadline(state);
        }
        return null;
      }
      const initialScan = externalAgentOutputScanResultSchema.parse(initialScanOutcome.value);
      if (!initialScan.contains_secret) {
        return delta;
      }

      const redactionOutcome = await waitForBoundary(
        this.security.output_security.redact(scannerInput),
        {
          timeout_ms: this.#remainingInvocationMs(state),
          signal: state.controller.signal,
        },
      );
      if (redactionOutcome.kind !== "VALUE") {
        if (redactionOutcome.kind === "TIMEOUT") {
          this.#expireDeadline(state);
        }
        return null;
      }
      const redacted = externalAgentOutputRedactionResultSchema.parse(redactionOutcome.value);
      if (redacted.delta === delta) {
        return null;
      }
      const finalScanOutcome = await waitForBoundary(
        this.security.output_security.scan({
          ...scannerInput,
          delta: redacted.delta,
        }),
        {
          timeout_ms: this.#remainingInvocationMs(state),
          signal: state.controller.signal,
        },
      );
      if (finalScanOutcome.kind !== "VALUE") {
        if (finalScanOutcome.kind === "TIMEOUT") {
          this.#expireDeadline(state);
        }
        return null;
      }
      const finalScan = externalAgentOutputScanResultSchema.parse(finalScanOutcome.value);
      return finalScan.contains_secret ? null : redacted.delta;
    } catch {
      return null;
    }
  }

  async #authorizeCompletion(
    invocation: AuthoritativeExternalAgentInvocation,
    state: ActiveInvocation,
    event: Extract<ExternalAgentProcessEvent, { event_type: "PROCESS_EXITED" }>,
  ): Promise<CompletedTerminal | null> {
    try {
      const expectation = {
        invocation,
        workspace_policy_hash: await sha256ContentHash(invocation.workspace_policy),
        permission_policy_hash: await sha256ContentHash(invocation.permission_policy),
        action_log_hash: await sha256ContentHash(state.actions),
        output_hash: await sha256ContentHash(state.outputs),
        action_count: state.action_count,
        output_bytes: state.output_bytes,
      } as const;
      const authorityOutcome = await waitForBoundary(
        this.security.completion_authority.authorize({
          receipt_ref: event.audit_receipt_ref,
          expectation,
        }),
        {
          timeout_ms: this.#remainingInvocationMs(state),
          signal: state.controller.signal,
        },
      );
      if (authorityOutcome.kind !== "VALUE") {
        if (authorityOutcome.kind === "TIMEOUT") {
          this.#expireDeadline(state);
        }
        return null;
      }
      const receipt = authorityOutcome.value;
      if (
        !isAuthoritativeExternalAgentAuditReceipt(receipt) ||
        artifactReferenceIdentity(receipt.receipt_ref) !==
          artifactReferenceIdentity(event.audit_receipt_ref)
      ) {
        return null;
      }
      return {
        event_type: "COMPLETED",
        audit_receipt_ref: receipt.receipt_ref,
      };
    } catch {
      return null;
    }
  }

  #remainingInvocationMs(state: ActiveInvocation): number {
    return Math.max(1, state.deadline_at_ms - Date.now());
  }

  #previewEvent(
    input: AuthoritativeExternalAgentInvocation,
    state: ActiveInvocation,
    payload: PublicEventPayload,
  ): ExternalAgentEvent {
    return parseExternalAgentEventForRequest(input, {
      schema_version: input.schema_version,
      invocation_id: input.invocation_id,
      attempt_id: input.attempt_id,
      scope: input.scope,
      run_id: input.run_id,
      profile_id: input.profile_id,
      profile_version: input.profile_version,
      adapter: input.adapter,
      sequence: state.next_sequence,
      observed_at: this.now().toISOString(),
      ...payload,
    });
  }

  #makeEvent(
    input: AuthoritativeExternalAgentInvocation,
    state: ActiveInvocation,
    payload: PublicEventPayload,
  ): ExternalAgentEvent {
    const event = this.#previewEvent(input, state, payload);
    state.next_sequence += 1;
    return event;
  }
}
