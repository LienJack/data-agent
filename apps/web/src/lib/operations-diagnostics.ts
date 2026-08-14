import "server-only";

import { channel } from "node:diagnostics_channel";

export const OPERATIONS_DIAGNOSTIC_CHANNEL = "data-agent.web.operations";

export type OperationsDiagnostic = Readonly<{
  timestamp: string;
  level: "info" | "warn" | "error";
  event_name: string;
  reason_code: string;
  principal_id?: string;
  workspace_id?: string;
  operation_id?: string;
  count?: number;
}>;

const diagnosticChannel = channel(OPERATIONS_DIAGNOSTIC_CHANNEL);
const eventNamePattern = /^[a-z][a-z0-9._:-]{0,127}$/;
const reasonCodePattern = /^[A-Z][A-Z0-9_]{0,127}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && uuidPattern.test(value) ? value : undefined;
}

export function publishOperationsDiagnostic(input: unknown): void {
  if (!diagnosticChannel.hasSubscribers) return;
  const candidate = record(input);
  const level =
    candidate.level === "info" || candidate.level === "warn" || candidate.level === "error"
      ? candidate.level
      : "error";
  const eventName =
    typeof candidate.event_name === "string" && eventNamePattern.test(candidate.event_name)
      ? candidate.event_name
      : "operations.diagnostic.rejected";
  const reasonCode =
    typeof candidate.reason_code === "string" && reasonCodePattern.test(candidate.reason_code)
      ? candidate.reason_code
      : "OPERATIONS_DIAGNOSTIC_INVALID";
  const principalId = safeId(candidate.principal_id);
  const workspaceId = safeId(candidate.workspace_id);
  const operationId = safeId(candidate.operation_id);
  const count =
    typeof candidate.count === "number" &&
    Number.isSafeInteger(candidate.count) &&
    candidate.count >= 0
      ? candidate.count
      : undefined;

  diagnosticChannel.publish(
    Object.freeze({
      timestamp: new Date().toISOString(),
      level,
      event_name: eventName,
      reason_code: reasonCode,
      ...(principalId ? { principal_id: principalId } : {}),
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      ...(operationId ? { operation_id: operationId } : {}),
      ...(count === undefined ? {} : { count }),
    } satisfies OperationsDiagnostic),
  );
}
