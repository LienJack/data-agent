export const MODEL_EXECUTION_REASON_CODES = [
  "MODEL_PROVIDER_REQUEST_NOT_AUTHORIZED",
  "MODEL_PROVIDER_TIMEOUT",
  "MODEL_PROVIDER_EXECUTION_FAILED",
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

function aiSdkApiCallRetryability(error: unknown): boolean | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  try {
    if (Reflect.get(error, AI_SDK_API_CALL_ERROR_MARKER) !== true) {
      return undefined;
    }
    const retryable = Reflect.get(error, "isRetryable");
    return typeof retryable === "boolean" ? retryable : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeMastraExecutionError(error: unknown): {
  readonly reason_code: ModelExecutionReasonCode;
  readonly retryable: boolean;
} {
  if (error instanceof MastraExecutionError) {
    return {
      reason_code: error.code,
      retryable: error.retryable,
    };
  }

  const aiSdkRetryable = aiSdkApiCallRetryability(error);
  if (aiSdkRetryable !== undefined) {
    return {
      reason_code: "MODEL_PROVIDER_EXECUTION_FAILED",
      retryable: aiSdkRetryable,
    };
  }

  return {
    reason_code: "MODEL_PROVIDER_EXECUTION_FAILED",
    retryable: true,
  };
}
