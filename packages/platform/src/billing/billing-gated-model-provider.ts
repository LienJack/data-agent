import type {
  AuthoritativeModelProviderInvocation,
  ModelBillingAuthorizationReceipt,
  ModelProviderEvent,
  ModelProviderPort,
} from "@data-agent/contracts";
import type { BoundaryResult } from "../tenancy/capability.js";
import type { ModelBillingPort } from "./postgres-model-billing.js";

export type ModelBillingProviderTerminalKind =
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED_BEFORE_START"
  | "OUTCOME_UNKNOWN";

export interface ModelBillingProviderLifecycle {
  prepare(input: AuthoritativeModelProviderInvocation): Promise<
    BoundaryResult<{
      readonly billing_context: unknown;
      readonly authorize_command: unknown;
    }>
  >;
  commitTerminal(input: {
    readonly request: AuthoritativeModelProviderInvocation;
    readonly authorization: ModelBillingAuthorizationReceipt;
    readonly terminal_kind: ModelBillingProviderTerminalKind;
    readonly provider_event: ModelProviderEvent | null;
  }): Promise<
    BoundaryResult<{
      readonly billing_context: unknown;
      readonly finalize_command: unknown;
    }>
  >;
}

export class ModelBillingProviderError extends Error {
  override readonly name = "ModelBillingProviderError";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

function requireBoundaryValue<T>(result: BoundaryResult<T>): T {
  if (!result.ok) {
    throw new ModelBillingProviderError(result.error.code, result.error.retryable);
  }
  return result.value;
}

/**
 * Agent Worker 的唯一模型调用组合门。
 *
 * PostgreSQL 计费 authorize 成功前不会创建底层 Provider iterator；Provider 终态也只有在
 * Research/Usage Authority 与 Billing finalize 都提交后才会向上游可见。调用方提前停止消费
 * stream 时，finally 会把已启动调用标记为 OUTCOME_UNKNOWN，避免静默释放积分冻结。
 */
export function createBillingGatedModelProvider(options: {
  readonly delegate: ModelProviderPort;
  readonly billing: Pick<ModelBillingPort, "authorize" | "finalize">;
  readonly lifecycle: ModelBillingProviderLifecycle;
}): ModelProviderPort {
  return Object.freeze({
    async *stream(
      request: AuthoritativeModelProviderInvocation,
    ): AsyncIterable<ModelProviderEvent> {
      const prepared = requireBoundaryValue(await options.lifecycle.prepare(request));
      const authorization = requireBoundaryValue(
        await options.billing.authorize(prepared.billing_context, prepared.authorize_command),
      );
      if (!authorization.provider_call_allowed) {
        throw new ModelBillingProviderError("MODEL_BILLING_PROVIDER_CALL_DENIED", false);
      }

      let providerStarted = false;
      let terminalAttempted = false;

      const commitTerminal = async (
        terminalKind: ModelBillingProviderTerminalKind,
        providerEvent: ModelProviderEvent | null,
      ): Promise<void> => {
        terminalAttempted = true;
        const terminal = requireBoundaryValue(
          await options.lifecycle.commitTerminal({
            request,
            authorization,
            terminal_kind: terminalKind,
            provider_event: providerEvent,
          }),
        );
        requireBoundaryValue(
          await options.billing.finalize(terminal.billing_context, terminal.finalize_command),
        );
      };

      try {
        for await (const event of options.delegate.stream(request)) {
          if (event.event_type === "STARTED") {
            providerStarted = true;
            yield event;
            continue;
          }
          if (event.event_type === "COMPLETED") {
            await commitTerminal("COMPLETED", event);
            yield event;
            return;
          }
          if (event.event_type === "FAILED") {
            await commitTerminal(providerStarted ? "FAILED" : "CANCELLED_BEFORE_START", event);
            yield event;
            return;
          }
          yield event;
        }
        if (!terminalAttempted) {
          await commitTerminal(
            providerStarted ? "OUTCOME_UNKNOWN" : "CANCELLED_BEFORE_START",
            null,
          );
        }
      } catch (error) {
        if (!terminalAttempted) {
          await commitTerminal(
            providerStarted ? "OUTCOME_UNKNOWN" : "CANCELLED_BEFORE_START",
            null,
          );
        }
        throw error;
      } finally {
        if (!terminalAttempted) {
          await commitTerminal(
            providerStarted ? "OUTCOME_UNKNOWN" : "CANCELLED_BEFORE_START",
            null,
          );
        }
      }
    },
  });
}
