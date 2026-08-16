import {
  buildOntologyPackageValidationReceipt,
  computeOntologyPackageSourceBindingHash,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createOntologyPackageFixture } from "../../../semantic/test/fixtures/ontology-package.js";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresOntologyPackageStore } from "../../src/semantic/postgres-ontology-package.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000411",
  tenant: "00000000-0000-4000-8000-000000000412",
  deployment: "00000000-0000-4000-8000-000000000421",
  principal: "00000000-0000-4000-8000-000000000422",
  candidate: "00000000-0000-4000-8000-000000000423",
  revision: "00000000-0000-4000-8000-000000000424",
  validation: "00000000-0000-4000-8000-000000000425",
  preview: "00000000-0000-4000-8000-000000000426",
  projection: "00000000-0000-4000-8000-000000000427",
} as const;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const committedAt = "2026-08-17T00:00:00.000Z";

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

async function documents() {
  const candidate = await createOntologyPackageFixture();
  const compilerDigest = hash("8");
  const validation = await buildOntologyPackageValidationReceipt({
    schema_version: "ontology-package-validation@1.0.0",
    receipt_id: ids.validation,
    namespace: candidate.namespace,
    package_id: candidate.package_id,
    package_version: candidate.package_version,
    package_hash: candidate.package_hash,
    source_binding_hash: await computeOntologyPackageSourceBindingHash(candidate.source_binding),
    compiler_digest: compilerDigest,
    validator_version: "ontology-package-validator@1.0.0",
    valid: true,
    issues: [],
    validated_at: committedAt,
  });
  const preview = {
    schema_version: "ontology-package-preview@1.0.0" as const,
    namespace_id: candidate.namespace.namespace_id,
    package_id: candidate.package_id,
    package_version: candidate.package_version,
    package_hash: candidate.package_hash,
    graph_source_digest: hash("9"),
    mandatory_object_ids: candidate.mandatory_manifest.node_object_ids,
    runtime_queryable_object_ids: candidate.mandatory_manifest.node_object_ids,
    knowledge_only_object_ids: candidate.objects
      .filter((entry) => entry.resolution === "UNRESOLVED")
      .map((entry) => entry.object_id),
    formula_ast_digests: [],
    compiler_version: "ontology-package-compiler@1.0.0",
    compiler_digest: compilerDigest,
  };
  const command = {
    schema_version: "ontology-package-preview-binding@1.0.0" as const,
    preview_id: ids.preview,
    validation_receipt_id: validation.receipt_id,
    validation_receipt_hash: validation.receipt_hash,
    projection_id: ids.projection,
    projection_storage_digest: hash("a"),
    preview,
  };
  const previewHash = await sha256ContentHash(preview);
  return { candidate, validation, command, previewHash };
}

describe("PostgreSQL Ontology Package bootstrap store", () => {
  it("commits Candidate, Validation and Preview through the narrow scoped RPCs", async () => {
    const access = authority();
    const docs = await documents();
    const scripted = scriptedPool((text) => {
      if (text.includes("commit_ontology_package_candidate")) {
        return {
          rows: [
            {
              value: {
                namespace_id: docs.candidate.namespace.namespace_id,
                package_id: docs.candidate.package_id,
                package_version: 1,
                package_hash: docs.candidate.package_hash,
                candidate_id: ids.candidate,
                revision_id: ids.revision,
                revision_digest: hash("b"),
                committed_at: committedAt,
                replayed: false,
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("commit_ontology_package_validation")) {
        return {
          rows: [
            {
              value: {
                receipt_id: docs.validation.receipt_id,
                namespace_id: docs.validation.namespace.namespace_id,
                package_id: docs.validation.package_id,
                package_version: docs.validation.package_version,
                package_hash: docs.validation.package_hash,
                receipt_hash: docs.validation.receipt_hash,
                valid: true,
                committed_at: committedAt,
                replayed: false,
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("bind_ontology_package_preview")) {
        return {
          rows: [
            {
              value: {
                preview_id: ids.preview,
                namespace_id: docs.command.preview.namespace_id,
                package_id: docs.command.preview.package_id,
                package_version: 1,
                package_hash: docs.command.preview.package_hash,
                validation_receipt_id: ids.validation,
                validation_receipt_hash: docs.validation.receipt_hash,
                projection_id: ids.projection,
                projection_storage_digest: docs.command.projection_storage_digest,
                preview_hash: docs.previewHash,
                committed_at: committedAt,
                replayed: false,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const store = createPostgresOntologyPackageStore({
      pool: scripted.pool,
      authorizer: access.authorizer,
    });
    const candidate = await store.commitCandidate(access.capability, {
      semantic_domain: "commerce",
      candidate_id: ids.candidate,
      revision_id: ids.revision,
      candidate: docs.candidate,
    });
    const validation = await store.commitValidation(access.capability, {
      semantic_domain: "commerce",
      receipt: docs.validation,
    });
    const preview = await store.bindPreview(access.capability, {
      semantic_domain: "commerce",
      command: docs.command,
    });

    expect(candidate.ok && validation.ok && preview.ok).toBe(true);
    const domainCalls = scripted.calls.filter((call) => call.text.includes("app.semantic_domain"));
    expect(domainCalls).toHaveLength(3);
  });

  it("rejects a tampered Candidate before opening a database connection", async () => {
    const access = authority();
    const docs = await documents();
    const scripted = scriptedPool(() => undefined);
    const result = await createPostgresOntologyPackageStore({
      pool: scripted.pool,
      authorizer: access.authorizer,
    }).commitCandidate(access.capability, {
      semantic_domain: "commerce",
      candidate_id: ids.candidate,
      revision_id: ids.revision,
      candidate: { ...docs.candidate, package_hash: hash("f") },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ONTOLOGY_PACKAGE_CONTRACT_INVALID", retryable: false },
    });
    expect(scripted.calls).toHaveLength(0);
  });

  it("rejects a DB-substituted preview hash", async () => {
    const access = authority();
    const docs = await documents();
    const scripted = scriptedPool((text) =>
      text.includes("bind_ontology_package_preview")
        ? {
            rows: [
              {
                value: {
                  preview_id: ids.preview,
                  namespace_id: docs.command.preview.namespace_id,
                  package_id: docs.command.preview.package_id,
                  package_version: 1,
                  package_hash: docs.command.preview.package_hash,
                  validation_receipt_id: ids.validation,
                  validation_receipt_hash: docs.validation.receipt_hash,
                  projection_id: ids.projection,
                  projection_storage_digest: docs.command.projection_storage_digest,
                  preview_hash: hash("f"),
                  committed_at: committedAt,
                  replayed: false,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const result = await createPostgresOntologyPackageStore({
      pool: scripted.pool,
      authorizer: access.authorizer,
    }).bindPreview(access.capability, { semantic_domain: "commerce", command: docs.command });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ONTOLOGY_PACKAGE_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });
});
