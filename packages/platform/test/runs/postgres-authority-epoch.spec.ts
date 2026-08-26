import { buildFalcon24E1StagingReceipt } from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresFalcon24AuthorityEpoch } from "../../src/runs/postgres-authority-epoch.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const ids = { app: id(1), tenant: id(2), analyst: id(3), deployment: id(4) };

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.analyst,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.analyst });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(handler: (text: string, values?: readonly unknown[]) => unknown) {
  const calls: { readonly text: string; readonly values?: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      calls.push({ text, ...(values ? { values } : {}) });
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
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

describe("PostgreSQL Falcon24 E1 authority epoch", () => {
  it("begins a strict staging session with a content-addressed command", async () => {
    const auth = authority();
    const stagingId = id(10);
    const scripted = scriptedPool((text) =>
      text.includes("begin_falcon24_e1_staging_session")
        ? {
            schema_version: "falcon24-e1-staging-session@1.0.0",
            staging_id: stagingId,
            retained_assets_hash: hash("a"),
            status: "STAGED",
          }
        : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).beginStaging(auth.capability, {
      staging_id: stagingId,
      retained_assets_hash: hash("a"),
    });

    expect(result).toMatchObject({ ok: true, value: { staging_id: stagingId } });
    expect(
      scripted.calls.find(({ text }) => text.includes("begin_falcon24_e1_staging_session"))?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-e1-staging-session-begin@1.0.0",
        staging_id: stagingId,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("verifies a staging receipt before PostgreSQL I/O", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    const receipt = await buildFalcon24E1StagingReceipt({
      schema_version: "falcon24-e1-staging-receipt@1.0.0",
      staging_id: id(11),
      component: "DATASET",
      subject_hash: hash("b"),
      evidence_hash: hash("c"),
      production_isolation_proven: false,
    });

    await expect(
      port.recordReceipt(auth.capability, { ...receipt, subject_hash: hash("d") }),
    ).rejects.toThrow("FALCON24_E1_STAGING_RECEIPT_HASH_INVALID");
    expect(scripted.calls).toHaveLength(0);
  });

  it("loads only the exact current E1 binding", async () => {
    const auth = authority();
    const binding = {
      schema_version: "falcon24-authority-binding@1.0.0",
      authority_epoch: "E1",
      baseline_id: id(20),
      baseline_hash: hash("e"),
      activation_attempt_id: id(21),
    };
    const scripted = scriptedPool((text) =>
      text.includes("load_falcon24_current_authority_epoch") ? binding : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).loadCurrent(auth.capability);

    expect(result).toEqual({ ok: true, value: binding });
  });
});
