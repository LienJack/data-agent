export type ExternalAgentRuntimeErrorCode =
  | "EXTERNAL_AGENT_INVOCATION_ALREADY_ACTIVE"
  | "EXTERNAL_AGENT_INVOCATION_NOT_ACTIVE"
  | "EXTERNAL_AGENT_INVOCATION_NOT_AUTHORIZED"
  | "EXTERNAL_AGENT_PROFILE_ALREADY_REGISTERED"
  | "EXTERNAL_AGENT_PROFILE_NOT_ENABLED"
  | "EXTERNAL_AGENT_REGISTRATION_INVALID";

export class ExternalAgentRuntimeError extends Error {
  override readonly name = "ExternalAgentRuntimeError";

  constructor(
    readonly code: ExternalAgentRuntimeErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
