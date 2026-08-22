import { channel } from "node:diagnostics_channel";
import type { RuntimeBuildIdentity } from "@data-agent/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL,
  type PersistenceDiagnosticLogRecord,
  registerPersistenceDiagnosticLogger,
} from "../../src/index.js";

const diagnosticChannel = channel(PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL);
const releases: Array<() => void> = [];

function identity(
  consumerRole: RuntimeBuildIdentity["consumer_role"] = "web",
): RuntimeBuildIdentity {
  return {
    schema_version: "runtime-build-identity@1.0.0",
    consumer_role: consumerRole,
    generation_id: `sha256:${"a".repeat(64)}`,
    build_id: `sha256:${"b".repeat(64)}`,
    built_at: "2026-08-22T00:00:00.000Z",
    git_commit: "abcdef1",
    git_dirty: false,
  };
}

afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe("persistence diagnostic logger", () => {
  it("projects one safe structured record with runtime build identity", () => {
    const records: PersistenceDiagnosticLogRecord[] = [];
    releases.push(
      registerPersistenceDiagnosticLogger({
        identity: identity(),
        logger: (record) => records.push(record),
      }),
    );

    diagnosticChannel.publish({
      operation_name: "runtime.accept",
      correlation_id: "safe-correlation-id",
      error_class: "DatabaseError",
      sqlstate: "42703",
      marker: "DA_PRIVATE_MARKER",
      error: new Error("select secret from runs"),
      connection_string: "postgres://admin:secret@database.internal/app",
      parameters: ["Bearer raw-token"],
    });

    expect(records).toEqual([
      {
        event_name: "persistence_transaction_failed",
        operation_name: "runtime.accept",
        correlation_id: "safe-correlation-id",
        sqlstate: "42703",
        process_role: "web",
        build_id: `sha256:${"b".repeat(64)}`,
        generation_id: `sha256:${"a".repeat(64)}`,
      },
    ]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("DatabaseError");
    expect(serialized).not.toContain("select secret");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("DA_PRIVATE_MARKER");
  });

  it("uses one process-global subscriber for duplicate registrations", () => {
    const logger = vi.fn();
    const firstRelease = registerPersistenceDiagnosticLogger({ identity: identity(), logger });
    const secondRelease = registerPersistenceDiagnosticLogger({ identity: identity(), logger });
    releases.push(firstRelease, secondRelease);

    diagnosticChannel.publish({ operation_name: "runtime.test" });
    expect(logger).toHaveBeenCalledTimes(1);

    firstRelease();
    diagnosticChannel.publish({ operation_name: "runtime.test" });
    expect(logger).toHaveBeenCalledTimes(2);

    secondRelease();
    diagnosticChannel.publish({ operation_name: "runtime.test" });
    expect(logger).toHaveBeenCalledTimes(2);
  });

  it("records null optional facts and contains logger failures", () => {
    const logger = vi.fn(() => {
      throw new Error("LOG_SINK_FAILED");
    });
    releases.push(registerPersistenceDiagnosticLogger({ identity: identity("worker"), logger }));

    expect(() =>
      diagnosticChannel.publish({
        operation_name: "invalid operation name",
        correlation_id: { secret: "raw" },
        sqlstate: "not-a-sqlstate",
      }),
    ).not.toThrow();
    expect(logger).toHaveBeenCalledWith({
      event_name: "persistence_transaction_failed",
      operation_name: "unknown",
      correlation_id: null,
      sqlstate: null,
      process_role: "worker",
      build_id: `sha256:${"b".repeat(64)}`,
      generation_id: `sha256:${"a".repeat(64)}`,
    });
  });
});
