import { channel } from "node:diagnostics_channel";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OPERATIONS_DIAGNOSTIC_CHANNEL,
  type OperationsDiagnostic,
  publishOperationsDiagnostic,
} from "@/lib/operations-diagnostics";

const diagnostics = channel(OPERATIONS_DIAGNOSTIC_CHANNEL);
const subscriptions: Array<(message: unknown) => void> = [];

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) diagnostics.unsubscribe(subscription);
});

function capture(): OperationsDiagnostic[] {
  const messages: OperationsDiagnostic[] = [];
  const subscription = (message: unknown) => messages.push(message as OperationsDiagnostic);
  subscriptions.push(subscription);
  diagnostics.subscribe(subscription);
  return messages;
}

describe("operations diagnostics", () => {
  it("publishes only stable operational fields", () => {
    const messages = capture();
    publishOperationsDiagnostic({
      level: "warn",
      event_name: "operations.member.access_denied",
      reason_code: "WORKSPACE_MEMBER_MANAGE_REQUIRED",
      principal_id: "00000000-0000-4000-8000-000000001002",
      workspace_id: "00000000-0000-4000-8000-00000000aa22",
      count: 1,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      level: "warn",
      event_name: "operations.member.access_denied",
      reason_code: "WORKSPACE_MEMBER_MANAGE_REQUIRED",
      principal_id: "00000000-0000-4000-8000-000000001002",
      workspace_id: "00000000-0000-4000-8000-00000000aa22",
      count: 1,
    });
  });

  it("does not forward nested values, credentials or raw errors", () => {
    const messages = capture();
    publishOperationsDiagnostic({
      event_name: "invalid event name",
      reason_code: "postgres://admin:secret@database.internal/app",
      principal_id: "Bearer raw-token",
      password: "Da!one-time-password",
      error: { message: "database table and SQL details" },
      headers: { authorization: "Bearer raw-token" },
    });

    expect(messages).toEqual([
      expect.objectContaining({
        level: "error",
        event_name: "operations.diagnostic.rejected",
        reason_code: "OPERATIONS_DIAGNOSTIC_INVALID",
      }),
    ]);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("database table");
  });
});
