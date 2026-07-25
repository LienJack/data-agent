export type ModelRuntimeErrorCode =
  | "CERTIFIED_MODEL_ID_MISMATCH"
  | "CREDENTIAL_NOT_CONFIGURED"
  | "CREDENTIAL_RESOLUTION_FAILED"
  | "CREDENTIAL_SMOKE_NOT_AUTHORIZED"
  | "CREDENTIAL_SMOKE_FAILED"
  | "DUPLICATE_MODEL_PROFILE"
  | "DUPLICATE_MODEL_PROVIDER_OVERRIDE"
  | "MODEL_CAPABILITY_NOT_SATISFIED"
  | "MODEL_CONTEXT_WINDOW_NOT_SATISFIED"
  | "MODEL_COST_BUDGET_NOT_SATISFIED"
  | "MODEL_FALLBACK_NOT_COMPATIBLE"
  | "MODEL_PROFILE_NOT_ALLOWED"
  | "MODEL_PROFILE_NOT_AUTHORIZED"
  | "MODEL_PROFILE_SCOPE_MISMATCH"
  | "MODEL_PROVIDER_NOT_REGISTERED"
  | "MODEL_REGION_PRIVACY_NOT_SATISFIED"
  | "PROVIDER_CREDENTIAL_UNAVAILABLE"
  | "PROVIDER_SMOKE_ERROR";

export class ModelRuntimeError extends Error {
  override readonly name: string = "ModelRuntimeError";

  constructor(
    readonly code: ModelRuntimeErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export class ModelRoutingError extends ModelRuntimeError {
  override readonly name = "ModelRoutingError";
}
