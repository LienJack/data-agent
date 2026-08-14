import {
  SEMANTIC_WORKSPACE_EXPORT_FORMAT,
  type SemanticWorkspaceExport,
  semanticWorkspaceExportSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticPortabilityRepository } from "../../src/semantic/postgres-semantic-portability.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  import: "00000000-0000-4000-8000-000000000005",
  idempotency: "00000000-0000-4000-8000-000000000006",
  target: "00000000-0000-4000-8000-000000000007",
  candidate: "00000000-0000-4000-8000-000000000008",
  revision: "00000000-0000-4000-8000-000000000009",
  sourceRevision: "00000000-0000-4000-8000-000000000010",
} as const;
const hash = `sha256:${"a".repeat(64)}` as const;

function authority(role: "ANALYST" | "VIEWER" = "ANALYST") {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role,
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("fixture authority missing");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          const result = handle(text, values);
          if (result) return result as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

async function document(domains = ["commerce"]): Promise<SemanticWorkspaceExport> {
  const material = {
    format: SEMANTIC_WORKSPACE_EXPORT_FORMAT,
    compatibility: {
      semantic_protocol_version: "semantic-source-payload@1.0.0",
      minimum_importer_version: "data-agent@0.1.0",
    },
    datasource_refs: domains.map((domain) => ({
      logical_ref: `${domain}:primary`,
      display_name: `${domain} warehouse`,
      dialect: "postgresql" as const,
      schema_fingerprint: hash,
    })),
    domains: domains.map((domain) => ({
      semantic_domain: domain,
      datasource_logical_ref: `${domain}:primary`,
      source_release: { generation: "1", digest: hash },
      semantic: { metrics: { revenue: { expression: "sum(amount)" } } },
    })),
  };
  return semanticWorkspaceExportSchema.parse({
    ...material,
    exported_at: "2026-08-14T00:00:00.000Z",
    content_hash: await sha256ContentHash(material),
  });
}

describe("PostgreSQL semantic portability repository", () => {
  it("exports only portable published semantic material", async () => {
    const access = authority();
    const scripted = scriptedPool((text) =>
      text.includes("semantic.read_portable_published_semantic")
        ? {
            rows: [
              {
                semantic_domain: "commerce",
                datasource_name: "Warehouse",
                datasource_type: "postgresql",
                release_generation: 3,
                release_digest: hash,
                schema_fingerprint: hash,
                semantic_content: { metrics: { revenue: { expression: "sum(amount)" } } },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const result = await createPostgresSemanticPortabilityRepository(
      scripted.pool,
      access.authorizer,
    ).exportPublished(access.capability);

    expect(result).toMatchObject({
      ok: true,
      value: {
        format: SEMANTIC_WORKSPACE_EXPORT_FORMAT,
        domains: [{ semantic_domain: "commerce" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain(ids.tenant);
    expect(JSON.stringify(result)).not.toContain(ids.principal);
  });

  it("rejects a tampered file before opening a database transaction", async () => {
    const access = authority();
    const scripted = scriptedPool(() => undefined);
    const tampered = { ...(await document()), content_hash: hash };
    const result = await createPostgresSemanticPortabilityRepository(
      scripted.pool,
      access.authorizer,
    ).upload(access.capability, {
      schema_version: "semantic-import-upload@1.0.0",
      operation_id: ids.import,
      idempotency_key: ids.idempotency,
      file_name: "semantic.json",
      byte_size: 4096,
      document: tampered,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_IMPORT_CONTENT_HASH_MISMATCH" },
    });
    expect(scripted.calls).toHaveLength(0);
  });

  it("denies Viewer uploads before opening a database transaction", async () => {
    const access = authority("VIEWER");
    const scripted = scriptedPool(() => undefined);
    const result = await createPostgresSemanticPortabilityRepository(
      scripted.pool,
      access.authorizer,
    ).upload(access.capability, {
      schema_version: "semantic-import-upload@1.0.0",
      operation_id: ids.import,
      idempotency_key: ids.idempotency,
      file_name: "semantic.json",
      byte_size: 4096,
      document: await document(),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_WRITE_DENIED" },
    });
    expect(scripted.calls).toHaveLength(0);
  });

  it("rolls back every candidate when one draft creation fails", async () => {
    const access = authority();
    const sourceDocument = await document(["commerce", "finance"]);
    const mappings = [
      {
        logical_ref: "commerce:primary",
        target_datasource_id: ids.target,
        target_semantic_domain: "commerce",
      },
      {
        logical_ref: "finance:primary",
        target_datasource_id: ids.target,
        target_semantic_domain: "finance",
      },
    ];
    let candidateCalls = 0;
    const scripted = scriptedPool((text) => {
      if (text.includes("platform.canonical_sha256")) {
        return { rows: [{ content_hash: hash }], rowCount: 1 };
      }
      if (text.includes("from app_data_agent.semantic_import_operations")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("from app_data_agent.semantic_import_jobs as job")) {
        return {
          rows: [
            {
              import_id: ids.import,
              tenant_id: ids.tenant,
              principal_id: ids.principal,
              file_name: "semantic.json",
              byte_size: 4096,
              upload_hash: hash,
              document_content_hash: sourceDocument.content_hash,
              format: SEMANTIC_WORKSPACE_EXPORT_FORMAT,
              source_document: sourceDocument,
              state: "READY",
              reason_code: null,
              preview: {
                schema_version: "semantic-import-preview@1.0.0",
                compatible: true,
                missing_logical_refs: [],
                conflicts: [],
                domains: sourceDocument.domains.map((domain) => ({
                  source_semantic_domain: domain.semantic_domain,
                  target_semantic_domain: domain.semantic_domain,
                  target_datasource_id: ids.target,
                  change_kind: "CREATE_DRAFT",
                })),
              },
              candidate_refs: [],
              receipt_id: null,
              mappings,
              created_at: "2026-08-14T00:00:00.000Z",
              updated_at: "2026-08-14T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("semantic.read_portability_targets")) {
        return {
          rows: [
            {
              datasource_id: ids.target,
              display_name: "Warehouse",
              dialect: "postgresql",
              semantic_domains: ["commerce", "finance"],
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("semantic.create_candidate_draft")) {
        candidateCalls += 1;
        if (candidateCalls === 2) throw new Error("fixture candidate failure");
        return {
          rows: [
            {
              result: {
                candidate_id: ids.candidate,
                revision_id: ids.revision,
                source_revision_id: ids.sourceRevision,
                source_digest: hash,
                revision_digest: hash,
                idempotency_digest: hash,
                candidate_status: "DRAFT",
                created: true,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const result = await createPostgresSemanticPortabilityRepository(
      scripted.pool,
      access.authorizer,
    ).commit(access.capability, {
      schema_version: "semantic-import-command@1.0.0",
      operation_id: ids.import,
      idempotency_key: ids.idempotency,
      import_id: ids.import,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_TRANSACTION_FAILED" },
    });
    expect(candidateCalls).toBe(2);
    expect(scripted.calls.some((call) => call.text === "ROLLBACK")).toBe(true);
    expect(scripted.calls.some((call) => call.text.includes("semantic_import_receipts"))).toBe(
      false,
    );
  });
});
