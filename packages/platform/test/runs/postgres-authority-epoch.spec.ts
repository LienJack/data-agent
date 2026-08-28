import {
  buildFalcon24E1StagingReceipt,
  buildFalcon24StagingReceiptV2,
} from "@data-agent/contracts/runs";
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

describe("PostgreSQL Falcon24 versioned authority epoch", () => {
  it("begins an E2 staging session with a content-addressed generic command", async () => {
    const auth = authority();
    const stagingId = id(10);
    const scripted = scriptedPool((text) =>
      text.includes("begin_falcon24_authority_staging_session")
        ? {
            schema_version: "falcon24-staging-session@2.0.0",
            authority_epoch: "E2",
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
      schema_version: "falcon24-staging-session@2.0.0",
      authority_epoch: "E2",
      staging_id: stagingId,
      retained_assets_hash: hash("a"),
    });

    expect(result).toMatchObject({ ok: true, value: { staging_id: stagingId } });
    expect(
      scripted.calls.find(({ text }) => text.includes("begin_falcon24_authority_staging_session"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-staging-session@2.0.0",
        authority_epoch: "E2",
        staging_id: stagingId,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("verifies an E2 staging receipt before PostgreSQL I/O", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    const receipt = await buildFalcon24StagingReceiptV2({
      schema_version: "falcon24-staging-receipt@2.0.0",
      authority_epoch: "E2",
      staging_id: id(11),
      component: "DATASET",
      subject_hash: hash("b"),
      evidence_hash: hash("c"),
      production_isolation_proven: false,
    });

    await expect(
      port.recordReceipt(auth.capability, { ...receipt, subject_hash: hash("d") }),
    ).rejects.toThrow("FALCON24_STAGING_RECEIPT_HASH_INVALID");
    expect(scripted.calls).toHaveLength(0);
  });

  it("holds an exact pre-baseline E4 staging session with a content-addressed command", async () => {
    const auth = authority();
    const stagingId = id(12);
    const scripted = scriptedPool((text) =>
      text.includes("hold_falcon24_authority_staging_session")
        ? {
            schema_version: "falcon24-staging-hold@2.0.0",
            authority_epoch: "E4",
            staging_id: stagingId,
            retained_assets_hash: hash("a"),
            status: "HOLD",
            failure_code: "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
          }
        : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).holdStagingSession(auth.capability, {
      schema_version: "falcon24-staging-hold-request@2.0.0",
      authority_epoch: "E4",
      staging_id: stagingId,
      expected_retained_assets_hash: hash("a"),
      failure_code: "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { staging_id: stagingId, status: "HOLD" },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("hold_falcon24_authority_staging_session"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-staging-hold-request@2.0.0",
        authority_epoch: "E4",
        staging_id: stagingId,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("loads the exact current E2 binding", async () => {
    const auth = authority();
    const binding = {
      schema_version: "falcon24-authority-binding@2.0.0",
      authority_epoch: "E2",
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

  it("loads an exact historical E1 Run through the versioned read RPC", async () => {
    const auth = authority();
    const binding = {
      schema_version: "falcon24-authority-binding@1.0.0",
      authority_epoch: "E1",
      baseline_id: id(30),
      baseline_hash: hash("f"),
      activation_attempt_id: id(31),
    };
    const scripted = scriptedPool((text) =>
      text.includes("load_falcon24_run_authority_binding") ? binding : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).loadRunBinding(auth.capability, { run_id: id(32) });

    expect(result).toEqual({ ok: true, value: binding });
    expect(
      scripted.calls.find(({ text }) => text.includes("load_falcon24_run_authority_binding"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-run-authority-load@2.0.0",
        run_id: id(32),
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("rejects an E1 staging write before PostgreSQL I/O", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);
    const receipt = await buildFalcon24E1StagingReceipt({
      schema_version: "falcon24-e1-staging-receipt@1.0.0",
      staging_id: id(40),
      component: "DATASET",
      subject_hash: hash("a"),
      evidence_hash: hash("b"),
      production_isolation_proven: false,
    });

    await expect(
      createPostgresFalcon24AuthorityEpoch({
        pool: scripted.pool,
        authorizer: auth.authorizer,
      }).recordReceipt(auth.capability, receipt),
    ).rejects.toThrow();
    expect(scripted.calls).toHaveLength(0);
  });

  it("rejects non-atomic E4 activation before PostgreSQL I/O", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);

    await expect(
      createPostgresFalcon24AuthorityEpoch({
        pool: scripted.pool,
        authorizer: auth.authorizer,
      }).activate(auth.capability, {
        schema_version: "falcon24-activation-request@2.0.0",
        authority_epoch: "E4",
        attempt_id: id(50),
        baseline_id: id(51),
        expected_baseline_hash: hash("e"),
      }),
    ).rejects.toThrow("FALCON24_COMBINED_SEMANTIC_ACTIVATION_REQUIRED");
    expect(scripted.calls).toHaveLength(0);
  });
});
