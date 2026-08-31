import {
  buildSemanticContextAuthoritySnapshot,
  buildSemanticContextRequest,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticContextRegistry } from "../../src/semantic/postgres-semantic-context.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: id(90), app_id: id(1), environment: "test" }],
    [{ subject: id(2), deployment_id: id(90), tenant_id: id(3), role: "ANALYST" }],
  );
  const capability = registry.resolveForDeployment(id(90), { subject: id(2) });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function poolWith(value: unknown) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      if (text.includes("load_semantic_context_authority_snapshot")) {
        return { rows: [{ value }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

async function snapshot(scope: { app_id: string; tenant_id: string; environment: string }) {
  return buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: "commerce",
    question: "Gross Revenue",
    defaults_ref: { defaults_id: id(4), defaults_revision: 1, defaults_hash: hash("1") },
    semantic_release: {
      resource_id: id(5),
      resource_revision: 1,
      resource_hash: hash("2"),
      datasource_id: id(6),
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(7),
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: id(6),
      semantic_release_id: id(5),
      semantic_generation: 1,
    },
    context_policy: {
      resource_id: id(8),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: 4096,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(9),
      resource_revision: 1,
      resource_hash: hash("5"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    published_metrics: [],
    published_ontology: [],
    published_relationships: [],
    knowledge_refs: [],
    projection_hashes: [hash("6")],
  });
}

describe("PostgreSQL resolved context registry", () => {
  it.each(["exact", "omitted", "substituted", "preview"])(
    "checks frozen intent source: %s",
    async (mode) => {
      const auth = authority();
      const {
        snapshot_hash: _snapshotHash,
        question_hash: _questionHash,
        ...base
      } = await snapshot(auth.capability.scope);
      const reference = {
        ...auth.capability.scope,
        artifact_type: "ProviderTaskArtifact",
        artifact_id: id(20),
        run_id: id(21),
        revision: 1,
        content_hash: hash("a"),
      };
      const document = await buildSemanticContextAuthoritySnapshot({
        ...base,
        ...(mode === "omitted"
          ? {}
          : {
              conversation_intent: {
                task_ref: {
                  ...reference,
                  content_hash: mode === "substituted" ? hash("b") : reference.content_hash,
                },
                context_selection_hash: hash("c"),
                prior_user_questions: [{ message_id: id(22), content: "Gross Revenue by month" }],
              },
            }),
      });
      const request = await buildSemanticContextRequest({
        schema_version: "semantic-context-request@1.0.0",
        request_id: id(23),
        scope: auth.capability.scope,
        ...(mode === "preview"
          ? {
              question: base.question,
              basis: { consumer: "PREVIEW", defaults_ref: base.defaults_ref },
            }
          : {
              basis: {
                consumer: "RUN",
                run_id: id(21),
                config_ref: { config_id: id(24), config_revision: 1, config_hash: hash("d") },
                context_receipt_ref: { receipt_id: id(25), receipt_hash: hash("e") },
                provider_task_ref: reference,
              },
            }),
      });
      const registry = createPostgresSemanticContextRegistry({
        pool: poolWith(document).pool,
        authorizer: auth.authorizer,
      });
      const result = await registry.loadAuthoritySnapshot(auth.capability, request);
      expect(result).toMatchObject(
        mode === "exact"
          ? { ok: true, value: document }
          : {
              ok: false,
              error: { code: "SEMANTIC_CONTEXT_DATABASE_CONTRACT_INVALID" },
            },
      );
    },
  );

  it("rejects a cross-run or cross-scope task reference before a request can be hashed", async () => {
    const auth = authority();
    const reference = {
      ...auth.capability.scope,
      artifact_type: "ProviderTaskArtifact",
      artifact_id: id(20),
      run_id: id(21),
      revision: 1,
      content_hash: hash("a"),
    };
    for (const mutation of [
      { run_id: id(99) },
      { tenant_id: id(99) },
      { app_id: id(99) },
      { environment: "prod" },
    ]) {
      await expect(
        buildSemanticContextRequest({
          schema_version: "semantic-context-request@1.0.0",
          request_id: id(23),
          scope: auth.capability.scope,
          basis: {
            consumer: "RUN",
            run_id: id(21),
            config_ref: { config_id: id(24), config_revision: 1, config_hash: hash("d") },
            context_receipt_ref: { receipt_id: id(25), receipt_hash: hash("e") },
            provider_task_ref: { ...reference, ...mutation },
          },
        }),
      ).rejects.toThrow("SEMANTIC_CONTEXT_TASK_REFERENCE_MISMATCH");
    }
  });

  it("loads and verifies the exact PostgreSQL authority snapshot", async () => {
    const auth = authority();
    const document = await snapshot(auth.capability.scope);
    const scripted = poolWith(document);
    const registry = createPostgresSemanticContextRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    const request = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(10),
      scope: auth.capability.scope,
      question: "Gross Revenue",
      basis: { consumer: "PREVIEW", defaults_ref: document.defaults_ref },
    });
    await expect(registry.loadAuthoritySnapshot(auth.capability, request)).resolves.toEqual({
      ok: true,
      value: document,
    });
    expect(
      scripted.calls.some(({ text }) => text.includes("load_semantic_context_authority_snapshot")),
    ).toBe(true);
  });

  it("rejects a DB snapshot with a stale hash", async () => {
    const auth = authority();
    const document = await snapshot(auth.capability.scope);
    const registry = createPostgresSemanticContextRegistry({
      pool: poolWith({ ...document, provider: "kimi" }).pool,
      authorizer: auth.authorizer,
    });
    const request = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(11),
      scope: auth.capability.scope,
      question: "Gross Revenue",
      basis: { consumer: "PREVIEW", defaults_ref: document.defaults_ref },
    });
    const result = await registry.loadAuthoritySnapshot(auth.capability, request);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_CONTEXT_DATABASE_CONTRACT_INVALID" },
    });
  });

  it("rejects a request whose content no longer matches its request hash before SQL", async () => {
    const auth = authority();
    const document = await snapshot(auth.capability.scope);
    const scripted = poolWith(document);
    const registry = createPostgresSemanticContextRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    const request = await buildSemanticContextRequest({
      schema_version: "semantic-context-request@1.0.0",
      request_id: id(12),
      scope: auth.capability.scope,
      question: "Gross Revenue",
      basis: { consumer: "PREVIEW", defaults_ref: document.defaults_ref },
    });
    await expect(
      registry.loadAuthoritySnapshot(auth.capability, { ...request, question: "Net Revenue" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_CONTEXT_REQUEST_INVALID" },
    });
    expect(
      scripted.calls.some(({ text }) => text.includes("load_semantic_context_authority_snapshot")),
    ).toBe(false);
  });
});
