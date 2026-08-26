import { createHash } from "node:crypto";
import { buildSensitiveExecutionArtifactReceipt } from "@data-agent/contracts/artifacts";
import { DEFAULT_RUN_EXECUTION_POLICY } from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createSensitiveExecutionArtifactAuthority } from "../../src/storage/sensitive-execution-artifact-authority.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
  artifact: "00000000-0000-4000-8000-000000000006",
} as const;
const ciphertext = new TextEncoder().encode("encrypted-u19-context");
const cipherHash = `sha256:${createHash("sha256").update(ciphertext).digest("hex")}` as const;
const lease = {
  scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
  principal_id: ids.principal,
  outbox_id: "00000000-0000-4000-8000-000000000009",
  run_id: ids.run,
  command_id: "00000000-0000-4000-8000-000000000010",
  command_kind: "START_L2_RESEARCH",
  attempt_id: "00000000-0000-4000-8000-000000000011",
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 30_000,
  worker_id: "u19-worker",
  lease_token: 1,
  worker_fence: 7,
  expires_at: "2026-08-17T00:05:00.000Z",
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
  payload: {
    kind: "START_L2_RESEARCH",
    effective_config_ref: {
      config_id: "00000000-0000-4000-8000-000000000012",
      config_revision: 1,
      config_hash: `sha256:${"3".repeat(64)}`,
    },
  },
} as const;

async function receipt() {
  return buildSensitiveExecutionArtifactReceipt({
    schema_version: "sensitive-execution-artifact@2.0.0",
    artifact_ref: {
      artifact_id: ids.artifact,
      artifact_type: "SensitiveExecutionArtifact",
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: `sha256:${"1".repeat(64)}`,
    },
    content_kind: "ANALYSIS_INPUT",
    plaintext_hash: `sha256:${"1".repeat(64)}`,
    ciphertext_hash: cipherHash,
    storage_key_hash: `sha256:${"2".repeat(64)}`,
    encryption: { algorithm: "AES-256-GCM", key_id: "kms/team-context-v1" },
    lifecycle: {
      status: "ACTIVE",
      expires_at: "2026-08-18T00:00:00.000Z",
      legal_hold: false,
      ref_count: 1,
      tombstoned_at: null,
      backup_expires_at: "2026-08-25T00:00:00.000Z",
    },
    committed_at: "2026-08-17T00:00:00.000Z",
  });
}

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("missing capability fixture");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function poolWith(value: unknown) {
  const calls: string[] = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string) {
          calls.push(text);
          if (text.includes("backend_context_matches"))
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          if (text.includes("sensitive_execution_artifact"))
            return { rows: [{ value }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { pool, calls };
}

describe("SensitiveExecutionArtifactAuthority", () => {
  it("stores ciphertext by content hash before committing exact metadata", async () => {
    const document = await receipt();
    const scripted = poolWith({
      schema_version: "sensitive-execution-artifact-commit-result@2.0.0",
      disposition: "CREATED",
      receipt: document,
    });
    const blobs = new Map<string, Uint8Array>();
    const auth = authority();
    const store = createSensitiveExecutionArtifactAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
      blobs: {
        putIfAbsent: async (key, bytes) => void blobs.set(key, bytes),
        get: async (key) => blobs.get(key) ?? null,
      },
    });
    const result = await store.commit(auth.capability, {
      command: {
        schema_version: "sensitive-execution-artifact-commit@2.0.0",
        receipt: document,
        idempotency_key: "u19-sensitive-artifact",
      },
      lease,
      ciphertext,
    });
    expect(result).toMatchObject({ ok: true, value: { disposition: "CREATED" } });
    expect(blobs.get(cipherHash)).toEqual(ciphertext);
    expect(
      scripted.calls.some((call) => call.includes("commit_sensitive_execution_artifact")),
    ).toBe(true);
  });

  it("rejects ciphertext substitution before database access", async () => {
    const document = await receipt();
    const scripted = poolWith(null);
    const auth = authority();
    const store = createSensitiveExecutionArtifactAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
      blobs: { putIfAbsent: async () => undefined, get: async () => null },
    });
    const result = await store.commit(auth.capability, {
      command: {
        schema_version: "sensitive-execution-artifact-commit@2.0.0",
        receipt: document,
        idempotency_key: "u19-sensitive-artifact",
      },
      lease,
      ciphertext: new TextEncoder().encode("substituted"),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SENSITIVE_EXECUTION_ARTIFACT_CIPHERTEXT_INVALID" },
    });
    expect(scripted.calls).toHaveLength(0);
  });
});
