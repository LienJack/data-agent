import {
  buildArtifactExportReceipt,
  computeArtifactExportRequestHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresArtifactWorkspaceStore } from "../../src/artifacts/postgres-artifact-workspace-store.js";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "00000000-0000-4000-8000-000000007102",
  deployment: "00000000-0000-4000-8000-000000007103",
  principal: "00000000-0000-4000-8000-000000007104",
  run: "00000000-0000-4000-8000-000000007105",
  source: "00000000-0000-4000-8000-000000007106",
  receipt: "00000000-0000-4000-8000-000000007107",
} as const;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const sourceRef = {
  artifact_id: ids.source,
  artifact_type: "SandboxResult" as const,
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
  run_id: ids.run,
  revision: 1,
  content_hash: hash("1"),
};
const command = {
  schema_version: "artifact-export-command@1.0.0" as const,
  source_ref: sourceRef,
  format: "CSV" as const,
  filename_stem: "results",
  idempotency_key: "artifact-export-0001",
};

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
  if (!resolved.ok) throw new Error("authority fixture missing");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(resultValue: unknown) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          if (text.includes("artifact_export_receipt")) {
            return {
              rows: [{ value: resultValue }],
              rowCount: 1,
            } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

async function receipt() {
  return buildArtifactExportReceipt({
    schema_version: "artifact-export-receipt@1.0.0",
    receipt_ref: {
      ...sourceRef,
      artifact_id: ids.receipt,
      artifact_type: "ArtifactExportReceipt",
      content_hash: hash("0"),
    },
    source_ref: sourceRef,
    format: "CSV",
    renderer_version: "artifact-workspace-renderer@1.0.0",
    exporter_version: "artifact-workspace-exporter@1.0.0",
    formula_policy_version: "spreadsheet-formula-neutralization@1.0.0",
    mime_type: "text/csv; charset=utf-8",
    attachment_filename: "results.csv",
    row_count: 1,
    column_count: 2,
    request_hash: await computeArtifactExportRequestHash(command),
    output_hash: hash("2"),
    created_at: "2026-08-17T04:00:00.000Z",
  });
}

describe("PostgresArtifactWorkspaceStore", () => {
  it("uses narrow RPCs and verifies the returned receipt", async () => {
    const { capability, authorizer } = authority();
    const document = await receipt();
    const scripted = scriptedPool({
      schema_version: "artifact-export-create-result@1.0.0",
      disposition: "CREATED",
      receipt: document,
    });
    const store = createPostgresArtifactWorkspaceStore({ pool: scripted.pool, authorizer });
    const result = await store.create(capability, command, document);

    expect(result).toMatchObject({ ok: true, value: { disposition: "CREATED" } });
    expect(
      scripted.calls.some((call) => call.text.includes("create_artifact_export_receipt")),
    ).toBe(true);
    expect(JSON.stringify(scripted.calls)).not.toMatch(/billing|pricing|credit|falcon/iu);
  });

  it("rejects a DB receipt with a substituted source hash", async () => {
    const { capability, authorizer } = authority();
    const document = await receipt();
    const scripted = scriptedPool({
      schema_version: "artifact-export-create-result@1.0.0",
      disposition: "CREATED",
      receipt: { ...document, source_ref: { ...sourceRef, content_hash: hash("9") } },
    });
    const store = createPostgresArtifactWorkspaceStore({ pool: scripted.pool, authorizer });
    const result = await store.create(capability, command, document);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("loads only the exact receipt, source and output-hash tuple", async () => {
    const { capability, authorizer } = authority();
    const document = await receipt();
    const loadResult = {
      schema_version: "artifact-export-load-result@1.0.0",
      receipt: document,
    };
    const exact = scriptedPool(loadResult);
    const exactStore = createPostgresArtifactWorkspaceStore({
      pool: exact.pool,
      authorizer,
    });
    const command = {
      schema_version: "artifact-export-load@1.0.0",
      receipt_ref: document.receipt_ref,
      source_ref: document.source_ref,
      output_hash: document.output_hash,
    } as const;
    await expect(exactStore.load(capability, command)).resolves.toEqual({
      ok: true,
      value: document,
    });

    const substituted = scriptedPool(loadResult);
    const substitutedStore = createPostgresArtifactWorkspaceStore({
      pool: substituted.pool,
      authorizer,
    });
    await expect(
      substitutedStore.load(capability, { ...command, output_hash: hash("9") }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });
});
