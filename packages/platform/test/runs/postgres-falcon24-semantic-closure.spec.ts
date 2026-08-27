import type { Falcon24SemanticAuthorityClosure } from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresFalcon24SemanticClosureReader } from "../../src/runs/postgres-falcon24-semantic-closure.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
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

const release = {
  release_id: id(10),
  generation: 2,
  release_digest: hash("a"),
  datasource_id: id(11),
};
const closure: Falcon24SemanticAuthorityClosure = {
  schema_version: "falcon24-semantic-authority-closure@1.0.0",
  scope: {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    semantic_domain: "falcon24",
  },
  authority: {
    schema_version: "falcon24-authority-binding@2.0.0",
    authority_epoch: "E4",
    baseline_id: id(12),
    baseline_hash: hash("b"),
    activation_attempt_id: id(13),
  },
  semantic_pointer: { version: 8, release },
  semantic_runtime: { version: 10, release },
  workspace_defaults: { version: 12, release },
};

function scriptedPool(value: unknown) {
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
      return {
        rows: text.includes("load_falcon24_semantic_authority_closure") ? [{ value }] : [],
        rowCount: text.includes("load_falcon24_semantic_authority_closure") ? 1 : 0,
      } as unknown as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

describe("PostgreSQL Falcon24 semantic closure readback", () => {
  it("loads all current authority pointers from one repeatable-read snapshot", async () => {
    const auth = authority();
    const scripted = scriptedPool(closure);

    const result = await createPostgresFalcon24SemanticClosureReader({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).load(auth.capability, { semantic_domain: "falcon24" });

    expect(result).toEqual({ ok: true, value: closure });
    expect(scripted.calls[0]?.text).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ");
    expect(
      scripted.calls.find(({ text }) => text.includes("load_falcon24_semantic_authority_closure"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-semantic-authority-closure-load@1.0.0",
        semantic_domain: "falcon24",
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      }),
    ]);
  });

  it("fails closed when PostgreSQL returns a mixed release closure", async () => {
    const auth = authority();
    const scripted = scriptedPool({
      ...closure,
      semantic_runtime: {
        ...closure.semantic_runtime,
        release: { ...release, release_id: id(14) },
      },
    });

    const result = await createPostgresFalcon24SemanticClosureReader({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).load(auth.capability, { semantic_domain: "falcon24" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID",
        message: "PostgreSQL 返回的 Falcon24 semantic authority closure 不符合合同。",
        retryable: false,
      },
    });
  });
});
