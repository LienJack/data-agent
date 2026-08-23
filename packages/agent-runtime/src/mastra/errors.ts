export const MODEL_EXECUTION_REASON_CODES = [
  "MODEL_PROVIDER_REQUEST_NOT_AUTHORIZED",
  "MODEL_PROVIDER_TIMEOUT",
  "MODEL_PROVIDER_EXECUTION_FAILED",
  "MODEL_PROVIDER_THROTTLED",
  "MODEL_PROVIDER_CREDENTIAL_UNAVAILABLE",
  "MODEL_PROVIDER_BINDING_MISMATCH",
  "MODEL_MESSAGE_ROLE_UNSUPPORTED",
  "MODEL_TOOL_NOT_REGISTERED",
  "MODEL_TOOL_NOT_ALLOWED",
  "MODEL_TOOL_CALL_BUDGET_EXCEEDED",
  "MODEL_INPUT_TOKEN_BUDGET_EXCEEDED",
  "MODEL_OUTPUT_TOKEN_BUDGET_EXCEEDED",
  "MODEL_USAGE_MISMATCH",
  "MODEL_STREAM_PROTOCOL_VIOLATION",
  "MODEL_PROVIDER_TOOL_EXECUTION_FORBIDDEN",
  "MODEL_RESPONSE_BLOCKED",
] as const;

export type ModelExecutionReasonCode = (typeof MODEL_EXECUTION_REASON_CODES)[number];

/**
 * The message is diagnostic-only and never copied into public stream events.
 * Public callers receive the stable code and retryability bit.
 */
export class MastraExecutionError extends Error {
  override readonly name = "MastraExecutionError";

  constructor(
    readonly code: ModelExecutionReasonCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

const AI_SDK_API_CALL_ERROR_MARKER = Symbol.for("vercel.ai.error.AI_APICallError");

function aiSdkApiCallMetadata(
  error: unknown,
): { retryable: boolean; status_code: number | null; retry_after_ms: number | null } | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  try {
    if (Reflect.get(error, AI_SDK_API_CALL_ERROR_MARKER) !== true) {
      return undefined;
    }
    const retryable = Reflect.get(error, "isRetryable");
    if (typeof retryable !== "boolean") return undefined;
    const status = Reflect.get(error, "statusCode");
    const retryAfter = Reflect.get(error, "retryAfterMs");
    return {
      retryable,
      status_code: typeof status === "number" && Number.isInteger(status) ? status : null,
      retry_after_ms:
        typeof retryAfter === "number" && Number.isSafeInteger(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 86_400_000)
          : null,
    };
  } catch {
    return undefined;
  }
}

export function normalizeMastraExecutionError(error: unknown): {
  readonly reason_code: ModelExecutionReasonCode;
  readonly retryable: boolean;
  readonly terminal_status: "FAILED" | "THROTTLED";
  readonly retry_after_ms: number | null;
} {
  if (error instanceof MastraExecutionError) {
    return {
      reason_code: error.code,
      retryable: error.retryable,
      terminal_status: error.code === "MODEL_PROVIDER_THROTTLED" ? "THROTTLED" : "FAILED",
      retry_after_ms: null,
    };
  }

  const aiSdkMetadata = aiSdkApiCallMetadata(error);
  if (aiSdkMetadata !== undefined) {
    return {
      reason_code:
        aiSdkMetadata.status_code === 429
          ? "MODEL_PROVIDER_THROTTLED"
          : "MODEL_PROVIDER_EXECUTION_FAILED",
      retryable: aiSdkMetadata.retryable,
      terminal_status: aiSdkMetadata.status_code === 429 ? "THROTTLED" : "FAILED",
      retry_after_ms: aiSdkMetadata.retry_after_ms,
    };
  }

  return {
    reason_code: "MODEL_PROVIDER_EXECUTION_FAILED",
    retryable: true,
    terminal_status: "FAILED",
    retry_after_ms: null,
  };
}
