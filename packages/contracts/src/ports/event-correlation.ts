import type { AppScope } from "../common/index.js";

export interface PortEventCorrelationContext {
  readonly schema_version: string;
  readonly attempt_id: string;
  readonly scope: AppScope;
  readonly run_id: string;
}

export interface PortEventCorrelationIdentifier {
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
}

export class PortEventCorrelationError extends Error {
  override readonly name = "PortEventCorrelationError";
  readonly code = "PORT_EVENT_CORRELATION_MISMATCH";
}

function scopesMatch(expected: AppScope, actual: AppScope): boolean {
  return (
    expected.app_id === actual.app_id &&
    expected.tenant_id === actual.tenant_id &&
    expected.environment === actual.environment
  );
}

export function assertPortEventCorrelation(
  portName: string,
  request: PortEventCorrelationContext,
  event: PortEventCorrelationContext,
  identifiers: readonly PortEventCorrelationIdentifier[],
): void {
  const correlationChecks = [
    { field: "schema_version", matches: request.schema_version === event.schema_version },
    { field: "attempt_id", matches: request.attempt_id === event.attempt_id },
    { field: "scope", matches: scopesMatch(request.scope, event.scope) },
    { field: "run_id", matches: request.run_id === event.run_id },
  ] as const;
  const mismatchedField =
    correlationChecks.find(({ matches }) => !matches)?.field ??
    identifiers.find(({ expected, actual }) => expected !== actual)?.field;

  if (mismatchedField) {
    throw new PortEventCorrelationError(
      `${portName} 流事件与发起请求的关联字段 ${mismatchedField} 不匹配。`,
    );
  }
}
