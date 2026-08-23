import {
  buildInterruptionReplyCommand,
  buildInterruptionReplyReceipt,
  buildRunInterruption,
  buildRunInterruptionOpenCommand,
  buildRunInterruptionOpenReceipt,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSessionRecovery } from "../../src/runs/postgres-session-recovery.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const timestamp = "2026-08-17T12:00:00.000Z";

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: id(90), app_id: id(1), environment: "test" }],
    [{ subject: id(2), deployment_id: id(90), tenant_id: id(3), role: "OWNER" }],
  );
  const capability = registry.resolveForDeployment(id(90), { subject: id(2) });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function poolWith(handler: (text: string, values: readonly unknown[]) => unknown) {
  let connects = 0;
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      const value = handler(text, values);
      return {
        rows: value === undefined ? [] : [{ value }],
        rowCount: value === undefined ? 0 : 1,
      } as unknown as SqlQueryResult<Row>;
    },
    release() {},
  };
  return {
    get connects() {
      return connects;
    },
    pool: {
      connect: async () => {
        connects += 1;
        return client;
      },
    } satisfies SqlPool,
  };
}

async function openInterruption() {
  const scope = { app_id: id(1), tenant_id: id(3), environment: "test" } as const;
  const interruption = await buildRunInterruption({
    schema_version: "run-interruption@1.0.0",
    scope,
    interruption_id: id(4),
    run_id: id(5),
    kind: "CLARIFICATION",
    question: "Which metric?",
    options: [],
    checkpoint_ref: { snapshot_id: id(6), snapshot_version: 1, snapshot_hash: hash("1") },
    worker_fence: 2,
    state: "OPEN",
    version: 1,
    opened_at: timestamp,
    answered_at: null,
  });
  return buildRunInterruptionOpenCommand({
    schema_version: "run-interruption-open-command@1.0.0",
    operation_id: id(7),
    idempotency_key: "open:interruption:1",
    actor_principal_id: id(2),
    interruption,
  });
}

describe("PostgreSQL session recovery adapter", () => {
  it("verifies an exact interruption open receipt", async () => {
    const auth = authority();
    const command = await openInterruption();
    const receipt = await buildRunInterruptionOpenReceipt({
      schema_version: "run-interruption-open-receipt@1.0.0",
      disposition: "COMMITTED",
      command_hash: command.command_hash,
      interruption: command.interruption,
      committed_at: timestamp,
    });
    const scripted = poolWith((text) =>
      text.includes("open_run_interruption") ? receipt : undefined,
    );
    const recovery = createPostgresSessionRecovery({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(recovery.open(auth.capability, command)).resolves.toEqual({
      ok: true,
      value: receipt,
    });
  });

  it("rejects a tampered reply before opening a transaction", async () => {
    const auth = authority();
    const open = await openInterruption();
    const command = await buildInterruptionReplyCommand({
      schema_version: "interruption-reply-command@1.0.0",
      operation_id: id(8),
      idempotency_key: "reply:interruption:1",
      scope: open.interruption.scope,
      run_id: open.interruption.run_id,
      interruption_id: open.interruption.interruption_id,
      expected_version: 1,
      expected_worker_fence: 2,
      actor_principal_id: id(2),
      response: { kind: "FREE_TEXT", text: "Booked revenue" },
      submitted_at: timestamp,
    });
    const scripted = poolWith(() => undefined);
    const recovery = createPostgresSessionRecovery({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(
      recovery.reply(auth.capability, { ...command, expected_version: 2 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INTERRUPTION_REPLY_INVALID" } });
    expect(scripted.connects).toBe(0);
  });

  it("rejects a database reply that substitutes another interruption", async () => {
    const auth = authority();
    const open = await openInterruption();
    const command = await buildInterruptionReplyCommand({
      schema_version: "interruption-reply-command@1.0.0",
      operation_id: id(8),
      idempotency_key: "reply:interruption:2",
      scope: open.interruption.scope,
      run_id: open.interruption.run_id,
      interruption_id: open.interruption.interruption_id,
      expected_version: 1,
      expected_worker_fence: 2,
      actor_principal_id: id(2),
      response: { kind: "FREE_TEXT", text: "Booked revenue" },
      submitted_at: timestamp,
    });
    const { interruption_hash: _hash, ...openDraft } = open.interruption;
    const answered = await buildRunInterruption({
      ...openDraft,
      interruption_id: id(40),
      state: "ANSWERED",
      version: 2,
      answered_at: timestamp,
    });
    const receipt = await buildInterruptionReplyReceipt({
      schema_version: "interruption-reply-receipt@1.0.0",
      disposition: "COMMITTED",
      command_hash: command.command_hash,
      interruption: answered,
      reply_id: id(9),
      response_hash: hash("2"),
      resume: {
        command_id: id(10),
        event_id: id(11),
        outbox_id: id(12),
        projection_version: 4,
      },
      committed_at: timestamp,
    });
    const scripted = poolWith((text) =>
      text.includes("reply_run_interruption") ? receipt : undefined,
    );
    const recovery = createPostgresSessionRecovery({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(recovery.reply(auth.capability, command)).resolves.toMatchObject({
      ok: false,
      error: { code: "SESSION_RECOVERY_DATABASE_CONTRACT_INVALID" },
    });
  });
});
