import {
  type AuthoritativeModelProviderInvocation,
  authorizePersistedModelProviderInvocation,
  type ModelExecutionProfileResolver,
  type ModelProviderEvent,
  type ModelProviderPort,
  modelProviderRequestSchema,
  type PortResult,
} from "@data-agent/contracts";
import type {
  AuditedProviderTransportResult,
  PrivateAuditedProviderTransport,
} from "./audited-model-provider.js";

function failure(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

export interface PersistedModelProviderPortFactory {
  create(input: {
    readonly mark_dispatched: () => Promise<void>;
    readonly signal: AbortSignal;
  }): ModelProviderPort;
}

/** @internal Only exported from this source module for bridge-shape conformance tests. */
export function normalizeAuditedProviderTerminalEvent(
  event: ModelProviderEvent,
): AuditedProviderTransportResult | null {
  if (event.event_type === "COMPLETED") {
    return {
      kind: "COMPLETED",
      output_text: event.output_text,
      response_hash: event.response_hash,
      tool_calls: [],
      usage:
        event.usage.availability === "AVAILABLE"
          ? {
              source: event.usage.source,
              input_tokens: event.usage.input_tokens,
              output_tokens: event.usage.output_tokens,
              tool_calls: event.usage.tool_calls,
            }
          : { source: "UNAVAILABLE" },
    };
  }
  if (event.event_type === "THROTTLED") {
    return {
      kind: "THROTTLED",
      reason_code: "PROVIDER_THROTTLED",
      retryable: true,
      delivery_certainty: event.delivery_certainty,
      ...(event.retry_after_ms === null ? {} : { retry_after_ms: event.retry_after_ms }),
    };
  }
  if (event.event_type === "FAILED") {
    return {
      kind: "FAILED",
      reason_code:
        event.reason_code === "MODEL_PROVIDER_CREDENTIAL_UNAVAILABLE"
          ? "PROVIDER_CREDENTIAL_UNAVAILABLE"
          : "PROVIDER_LOCAL_PREPARATION_FAILED",
      retryable: event.retryable,
      delivery_certainty: event.delivery_certainty,
    };
  }
  return null;
}

export function createPersistedModelProviderTransport(input: {
  readonly model_provider_factory: PersistedModelProviderPortFactory;
  readonly profile_resolver: ModelExecutionProfileResolver;
}): PrivateAuditedProviderTransport {
  const transport: PrivateAuditedProviderTransport = {
    async prepare({ payload, signal }) {
      if (signal.aborted) {
        return failure("RUN_EXECUTION_ABORTED", "Provider local prepare 前 Run 已中止。");
      }
      const request = modelProviderRequestSchema.safeParse(payload);
      return request.success
        ? { ok: true as const, value: { prepared: request.data } }
        : failure(
            "PROVIDER_LOCAL_PREPARATION_FAILED",
            "Provider request 未通过本地严格 schema preflight。",
          );
    },

    async dispatch({ permit, envelope, prepared, projection_resolver, mark_dispatched, signal }) {
      let request: AuthoritativeModelProviderInvocation;
      try {
        request = await authorizePersistedModelProviderInvocation(
          prepared,
          envelope,
          projection_resolver,
          permit,
          input.profile_resolver,
        );
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "provider_transport_authorization_rejected",
            error_name: error instanceof Error ? error.name : "UnknownError",
            reason:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "PROVIDER_LOCAL_PREPARATION_FAILED",
          }),
        );
        return {
          kind: "FAILED",
          reason_code: "PROVIDER_LOCAL_PREPARATION_FAILED",
          retryable: false,
          delivery_certainty: "NOT_DISPATCHED",
        };
      }

      const provider = input.model_provider_factory.create({
        signal,
        mark_dispatched: async () => {
          const marked = await mark_dispatched();
          if (!marked.ok) throw new Error("PROVIDER_DISPATCH_MARK_NOT_COMMITTED");
        },
      });
      const toolCalls: unknown[] = [];
      let terminal: AuditedProviderTransportResult | null = null;
      for await (const event of provider.stream(request)) {
        if (event.event_type === "TOOL_CALL_CANDIDATE") {
          toolCalls.push({
            tool_call_id: event.tool_call_id,
            tool_name: event.tool_name,
            arguments: event.arguments,
          });
          continue;
        }
        const observed = normalizeAuditedProviderTerminalEvent(event);
        if (!observed) continue;
        if (terminal) {
          return {
            kind: "FAILED",
            reason_code: "PROVIDER_PROTOCOL_VIOLATION",
            retryable: false,
            delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
          };
        }
        terminal =
          observed.kind === "COMPLETED" ? { ...observed, tool_calls: toolCalls } : observed;
      }
      return (
        terminal ?? {
          kind: "FAILED",
          reason_code: "PROVIDER_PROTOCOL_VIOLATION",
          retryable: false,
          delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
        }
      );
    },
  };
  return Object.freeze(transport);
}
