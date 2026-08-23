import { channel } from "node:diagnostics_channel";
import type { RuntimeBuildIdentity } from "@data-agent/contracts";
import { PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL } from "./transaction.js";

export interface PersistenceDiagnosticLogRecord {
  readonly event_name: "persistence_transaction_failed";
  readonly operation_name: string;
  readonly correlation_id: string | null;
  readonly sqlstate: string | null;
  readonly process_role: RuntimeBuildIdentity["consumer_role"];
  readonly build_id: RuntimeBuildIdentity["build_id"];
  readonly generation_id: RuntimeBuildIdentity["generation_id"];
}

export interface PersistenceDiagnosticLoggerOptions {
  readonly identity: RuntimeBuildIdentity;
  readonly logger: (record: PersistenceDiagnosticLogRecord) => void;
}

interface Registration {
  references: number;
  readonly subscriber: (message: unknown) => void;
}

const registrySymbol = Symbol.for("data-agent.platform.persistence.diagnostic-logger@1");
const operationPattern = /^[a-z][a-z0-9._:-]{0,127}$/;
const correlationPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const sqlstatePattern = /^[0-9A-Z]{5}$/;

function processRegistry(): Map<string, Registration> {
  const processGlobal = globalThis as typeof globalThis & {
    [registrySymbol]?: Map<string, Registration>;
  };
  const existing = processGlobal[registrySymbol];
  if (existing) return existing;
  const registry = new Map<string, Registration>();
  processGlobal[registrySymbol] = registry;
  return registry;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function registrationKey(identity: RuntimeBuildIdentity): string {
  return [
    identity.schema_version,
    identity.consumer_role,
    identity.generation_id,
    identity.build_id,
  ].join(":");
}

export function registerPersistenceDiagnosticLogger(
  options: PersistenceDiagnosticLoggerOptions,
): () => void {
  const registry = processRegistry();
  const key = registrationKey(options.identity);
  const existing = registry.get(key);
  if (existing) {
    existing.references += 1;
    return releaseRegistration(key, existing);
  }

  const subscriber = (message: unknown): void => {
    const candidate = record(message);
    const operationName =
      typeof candidate.operation_name === "string" &&
      operationPattern.test(candidate.operation_name)
        ? candidate.operation_name
        : "unknown";
    const correlationId =
      typeof candidate.correlation_id === "string" &&
      correlationPattern.test(candidate.correlation_id)
        ? candidate.correlation_id
        : null;
    const sqlstate =
      typeof candidate.sqlstate === "string" && sqlstatePattern.test(candidate.sqlstate)
        ? candidate.sqlstate
        : null;
    const projected = Object.freeze({
      event_name: "persistence_transaction_failed",
      operation_name: operationName,
      correlation_id: correlationId,
      sqlstate,
      process_role: options.identity.consumer_role,
      build_id: options.identity.build_id,
      generation_id: options.identity.generation_id,
    } satisfies PersistenceDiagnosticLogRecord);

    try {
      options.logger(projected);
    } catch {
      // Diagnostics must never replace the transaction's stable public result.
    }
  };
  const registration: Registration = { references: 1, subscriber };
  registry.set(key, registration);
  channel(PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL).subscribe(subscriber);
  return releaseRegistration(key, registration);
}

function releaseRegistration(key: string, registration: Registration): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    registration.references -= 1;
    if (registration.references > 0) return;

    const registry = processRegistry();
    if (registry.get(key) !== registration) return;
    channel(PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL).unsubscribe(registration.subscriber);
    registry.delete(key);
  };
}
