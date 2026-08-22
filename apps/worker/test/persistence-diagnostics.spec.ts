import { channel } from "node:diagnostics_channel";
import type { RuntimeBuildIdentity } from "@data-agent/contracts";
import {
  PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL,
  registerPersistenceDiagnosticLogger,
} from "@data-agent/platform";
import { describe, expect, it } from "vitest";

const diagnosticChannel = channel(PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL);

function identity(consumerRole: RuntimeBuildIdentity["consumer_role"]): RuntimeBuildIdentity {
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

describe("worker persistence diagnostics", () => {
  it.each(["worker", "relationship-indexer", "semantic-authoring"] as const)(
    "emits safe JSON for the %s process role and releases its subscriber",
    (processRole) => {
      const lines: string[] = [];
      const release = registerPersistenceDiagnosticLogger({
        identity: identity(processRole),
        logger: (record) => lines.push(JSON.stringify(record)),
      });

      diagnosticChannel.publish({
        operation_name: "runtime.persist",
        correlation_id: "safe-correlation-id",
        sqlstate: "XX001",
        error: new Error("private database detail"),
        sql: "select secret from runs",
        parameters: ["raw-token"],
      });
      release();
      diagnosticChannel.publish({ operation_name: "runtime.persist", sqlstate: "XX001" });

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toEqual({
        event_name: "persistence_transaction_failed",
        operation_name: "runtime.persist",
        correlation_id: "safe-correlation-id",
        sqlstate: "XX001",
        process_role: processRole,
        build_id: `sha256:${"b".repeat(64)}`,
        generation_id: `sha256:${"a".repeat(64)}`,
      });
      expect(lines[0]).not.toContain("private database detail");
      expect(lines[0]).not.toContain("select secret");
      expect(lines[0]).not.toContain("raw-token");
    },
  );
});
