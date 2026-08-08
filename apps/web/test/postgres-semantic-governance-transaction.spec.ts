import type { SqlClient, SqlPool } from "@data-agent/platform";
import { createPostgresCapabilityAuthority } from "@data-agent/platform";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  datasource: "00000000-0000-4000-8000-000000000005",
  candidate: "00000000-0000-4000-8000-000000000006",
  revision: "00000000-0000-4000-8000-000000000007",
  sourceRevision: "00000000-0000-4000-8000-000000000008",
  packet: "00000000-0000-4000-8000-000000000009",
  attempt: "00000000-0000-4000-8000-000000000010",
  release: "00000000-0000-4000-8000-000000000011",
  receipt: "00000000-0000-4000-8000-000000000012",
  executableProjection: "00000000-0000-4000-8000-000000000013",
  relationshipProjection: "00000000-0000-4000-8000-000000000014",
  restrictionProjection: "00000000-0000-4000-8000-000000000015",
  legacyAttempt: "00000000-0000-4000-8000-000000000016",
  authorization: "00000000-0000-4000-8000-000000000017",
  nonce: "00000000-0000-4000-8000-000000000018",
} as const;

interface QueryCall {
  readonly clientId: number;
  readonly text: string;
  readonly values?: readonly unknown[];
}

interface FixtureOptions {
  readonly denyRevalidation?: boolean;
  readonly failBusinessQuery?: boolean;
  readonly candidateErrorMarker?: string;
}

function createFixture(options: FixtureOptions = {}) {
  const calls: QueryCall[] = [];
  const released: number[] = [];
  let nextClientId = 0;

  const authorityRow = {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    deployment_id: ids.deployment,
    principal_id: ids.principal,
    membership_role: "owner",
    membership_version: "1",
    app_epoch: "1",
    lifecycle_state: "ACTIVE",
    can_write: true,
  };

  const pool: SqlPool = {
    async connect(): Promise<SqlClient> {
      const clientId = ++nextClientId;
      return {
        async query<Row extends object = Record<string, unknown>>(
          text: string,
          values?: readonly unknown[],
        ) {
          calls.push({ clientId, text, ...(values ? { values } : {}) });
          if (text.includes("platform.resolve_backend_authority")) {
            return { rows: [authorityRow] as Row[], rowCount: 1 };
          }
          if (text.includes("platform.revalidate_backend_authority")) {
            return options.denyRevalidation
              ? { rows: [], rowCount: 0 }
              : { rows: [authorityRow] as Row[], rowCount: 1 };
          }
          if (text.includes("platform.backend_context_matches")) {
            return { rows: [{ allowed: true }] as Row[], rowCount: 1 };
          }
          if (text.includes("semantic.create_candidate_draft")) {
            if (options.candidateErrorMarker) {
              throw Object.assign(new Error(options.candidateErrorMarker), { code: "22023" });
            }
            return {
              rows: [
                {
                  create_candidate_draft: {
                    candidate_id: ids.candidate,
                    revision_id: ids.revision,
                    source_revision_id: ids.sourceRevision,
                    source_digest: `sha256:${"1".repeat(64)}`,
                    revision_digest: `sha256:${"2".repeat(64)}`,
                    idempotency_digest: `sha256:${"3".repeat(64)}`,
                    candidate_status: "DRAFT",
                    created: true,
                  },
                },
              ] as Row[],
              rowCount: 1,
            };
          }
          if (text.includes("SELECT task.semantic_domain")) {
            return { rows: [], rowCount: 0 };
          }
          if (text.includes("FROM semantic.semantic_review_task")) {
            return { rows: [{ candidate_id: ids.candidate }] as Row[], rowCount: 1 };
          }
          if (text.includes("semantic.prepare_publish_attempt")) {
            return {
              rows: [{ prepare_publish_attempt: { attempt_id: ids.attempt } }] as Row[],
              rowCount: 1,
            };
          }
          if (text.includes("FROM semantic.semantic_publish_attempt")) {
            return { rows: [{ attempt_id: ids.attempt }] as Row[], rowCount: 1 };
          }
          if (text.includes("semantic.commit_publish_attempt")) {
            return {
              rows: [{ commit_publish_attempt: { release_id: ids.release } }] as Row[],
              rowCount: 1,
            };
          }
          if (text.includes("semantic.execute_rollback")) {
            return {
              rows: [{ execute_rollback: { receipt_id: ids.receipt } }] as Row[],
              rowCount: 1,
            };
          }
          if (text.includes("semantic.semantic_domain_registry")) {
            if (options.failBusinessQuery) {
              throw Object.assign(new Error("postgresql://user:password@db/private"), {
                code: "XX000",
              });
            }
            return {
              rows: [
                {
                  semantic_domain: "revenue",
                  domain_display_name: "收入",
                  domain_description: null,
                  datasource_id: ids.datasource,
                  is_active: true,
                  domain_version: 1,
                },
              ] as Row[],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: null };
        },
        release() {
          released.push(clientId);
        },
      };
    },
  };

  return { pool, calls, released };
}

let PostgresSemanticGovernanceService: typeof import("../src/lib/postgres-semantic-governance-service").PostgresSemanticGovernanceService;

beforeAll(async () => {
  ({ PostgresSemanticGovernanceService } = await import(
    "../src/lib/postgres-semantic-governance-service"
  ));
});

async function arrange(options: FixtureOptions = {}) {
  const fixture = createFixture(options);
  const authority = createPostgresCapabilityAuthority(fixture.pool);
  const resolved = await authority.resolveForServerContext({
    deployment_id: ids.deployment,
    tenant_id: ids.tenant,
    principal_id: ids.principal,
    access: "READ",
  });
  if (!resolved.ok) throw new Error(resolved.error.code);
  const context = {
    authority: "POSTGRESQL" as const,
    capabilityInput: resolved.value,
    scope: {
      appId: ids.app,
      tenantId: ids.tenant,
      environment: "test",
      semanticDomain: "revenue",
    },
    deploymentId: ids.deployment,
    principal: ids.principal,
    semanticRole: "admin" as const,
    allowedDomains: ["revenue"],
  };
  fixture.calls.length = 0;
  fixture.released.length = 0;
  return {
    ...fixture,
    context,
    service: new PostgresSemanticGovernanceService(fixture.pool, authority.authorizer),
  };
}

describe("PostgresSemanticGovernanceService transaction boundary", () => {
  it("revalidates, sets local scope, runs business SQL and commits on one client", async () => {
    const fixture = await arrange();
    await expect(fixture.service.listDomains(fixture.context)).resolves.toHaveLength(1);

    expect(new Set(fixture.calls.map((call) => call.clientId))).toEqual(new Set([2]));
    const statements = fixture.calls.map((call) => call.text);
    expect(statements.indexOf("BEGIN")).toBeLessThan(
      statements.findIndex((text) => text.includes("platform.revalidate_backend_authority")),
    );
    expect(
      statements.findIndex((text) => text.includes("platform.revalidate_backend_authority")),
    ).toBeLessThan(statements.findIndex((text) => text.includes("SET LOCAL search_path")));
    expect(statements.findIndex((text) => text.includes("app.semantic_domain"))).toBeLessThan(
      statements.findIndex((text) => text.includes("semantic.semantic_domain_registry")),
    );
    expect(statements.at(-1)).toBe("COMMIT");
    expect(fixture.released).toEqual([2]);
  });

  it("rolls back and redacts a database cause", async () => {
    const fixture = await arrange({ failBusinessQuery: true });

    await expect(fixture.service.listDomains(fixture.context)).rejects.toMatchObject({
      code: "SEMANTIC_GOVERNANCE_UNAVAILABLE",
      message: "语义治理服务暂时不可用。",
    });
    expect(fixture.calls.map((call) => call.text).at(-1)).toBe("ROLLBACK");
    expect(fixture.released).toEqual([2]);
  });

  it("does not set scope or run business SQL after authority revalidation fails", async () => {
    const fixture = await arrange({ denyRevalidation: true });

    await expect(fixture.service.listDomains(fixture.context)).rejects.toMatchObject({
      code: "SEMANTIC_GOVERNANCE_UNAVAILABLE",
    });
    expect(fixture.calls.some((call) => call.text.includes("app.semantic_domain"))).toBe(false);
    expect(
      fixture.calls.some((call) => call.text.includes("semantic.semantic_domain_registry")),
    ).toBe(false);
    expect(fixture.calls.map((call) => call.text).at(-1)).toBe("ROLLBACK");
  });

  it("rejects an input domain that differs from server-resolved authority before checkout", async () => {
    const fixture = await arrange();

    await expect(
      fixture.service.executeRollback(fixture.context, {
        schema_version: "semantic-rollback@1.0.0",
        semantic_domain: "payroll",
        packet_id: ids.packet,
        authorization_id: ids.authorization,
        authorization_nonce: ids.nonce,
        rollback_reason: "attacker-selected domain",
      }),
    ).rejects.toMatchObject({ code: "SEMANTIC_SCOPE_FORBIDDEN" });
    expect(fixture.calls).toEqual([]);
  });

  it("expands the read-only all sentinel only to server-authorized domains", async () => {
    const fixture = await arrange();
    const allContext = {
      ...fixture.context,
      scope: { ...fixture.context.scope, semanticDomain: "all" },
      allowedDomains: ["customer", "revenue"],
    };

    await expect(fixture.service.getInboxItems(allContext, "completed")).resolves.toEqual([]);
    const inboxQuery = fixture.calls.find((call) =>
      call.text.includes("SELECT task.semantic_domain"),
    );
    expect(inboxQuery?.text).toContain("task.semantic_domain = ANY($4::text[])");
    expect(inboxQuery?.values?.[3]).toEqual(["customer", "revenue"]);
  });

  it("maps supported database markers to stable public errors", async () => {
    const fixture = await arrange({ candidateErrorMarker: "SEMANTIC_CANDIDATE_INVALID" });

    await expect(
      fixture.service.createCandidate(fixture.context, {
        schema_version: "semantic-candidate-draft@1.0.0",
        title: "Net revenue",
        description: "Include discounts.",
        semantic_domain: "revenue",
        change_class: "MAJOR",
        risk_level: "HIGH",
        idempotency_key: "00000000-0000-4000-8000-000000000006",
        source_payload: {
          schema_version: "semantic-source-payload@1.0.0",
          source_kind: "MANUAL",
          content: { metric_id: "net_revenue" },
        },
        diff: {
          schema_version: "semantic-diff@1.0.0",
          summary: "include discounts",
          operations: [
            {
              path: "metrics.net_revenue.formula",
              change_type: "ADD",
              after: "revenue-refund-discount",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "SEMANTIC_CANDIDATE_INVALID",
      message: "语义候选输入无效。",
    });
  });

  it("forwards canonical candidate material and the server principal exactly", async () => {
    const fixture = await arrange();
    const idempotencyKey = "00000000-0000-4000-8000-000000000006";
    const sourcePayload = {
      schema_version: "semantic-source-payload@1.0.0" as const,
      source_kind: "MANUAL" as const,
      content: { metric_id: "net_revenue", formula: "revenue-refund-discount" },
    };
    const diff = {
      schema_version: "semantic-diff@1.0.0" as const,
      summary: "include discounts",
      operations: [
        {
          path: "metrics.net_revenue.formula",
          change_type: "MODIFY" as const,
          before: "revenue-refund",
          after: "revenue-refund-discount",
        },
      ],
    };

    await fixture.service.createCandidate(fixture.context, {
      schema_version: "semantic-candidate-draft@1.0.0",
      title: "Net revenue",
      description: "Include discounts.",
      semantic_domain: "revenue",
      change_class: "MAJOR",
      risk_level: "HIGH",
      idempotency_key: idempotencyKey,
      source_payload: sourcePayload,
      diff,
    });

    const rpc = fixture.calls.find((call) => call.text.includes("semantic.create_candidate_draft"));
    expect(rpc?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      "revenue",
      ids.principal,
      idempotencyKey,
      "Net revenue",
      "Include discounts.",
      "MAJOR",
      "HIGH",
      JSON.stringify(sourcePayload),
      JSON.stringify(diff),
    ]);
  });

  it("forwards publish and rollback authority material without replacement", async () => {
    const fixture = await arrange();
    const hashA = `sha256:${"a".repeat(64)}`;
    const hashB = `sha256:${"b".repeat(64)}`;
    const hashC = `sha256:${"c".repeat(64)}`;
    const legacyPlan = { strategy: "preserve", generation: 12 };
    const childManifest = { children: ["one", "two"] };

    await fixture.service.preparePublish(fixture.context, {
      schema_version: "semantic-prepare-publish@1.0.0",
      semantic_domain: "revenue",
      packet_id: ids.packet,
      compiler_bundle_digest: hashA,
      catalog_epoch: 7,
      dependency_generation: 11,
      target_generation: 12,
      idempotency_digest: hashB,
      conditional_legacy_plan: legacyPlan,
    });
    await fixture.service.commitPublish(fixture.context, {
      schema_version: "semantic-commit-publish@1.0.0",
      semantic_domain: "revenue",
      packet_id: ids.packet,
      attempt_id: ids.attempt,
      executable_projection_ref: ids.executableProjection,
      executable_projection_hash: hashA,
      relationship_projection_ref: ids.relationshipProjection,
      relationship_projection_hash: hashB,
      runtime_restriction_projection_ref: ids.restrictionProjection,
      runtime_restriction_projection_hash: hashC,
      profile_child_manifest: childManifest,
      committed_legacy_attempt_ref: ids.legacyAttempt,
    });
    await fixture.service.executeRollback(fixture.context, {
      schema_version: "semantic-rollback@1.0.0",
      semantic_domain: "revenue",
      packet_id: ids.packet,
      authorization_id: ids.authorization,
      authorization_nonce: ids.nonce,
      rollback_reason: "Operator-approved rollback",
    });

    const prepare = fixture.calls.find((call) =>
      call.text.includes("semantic.prepare_publish_attempt"),
    );
    expect(prepare?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      "revenue",
      ids.packet,
      ids.candidate,
      hashA,
      7,
      11,
      12,
      hashB,
      JSON.stringify(legacyPlan),
    ]);

    const commit = fixture.calls.find((call) =>
      call.text.includes("semantic.commit_publish_attempt"),
    );
    expect(commit?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      "revenue",
      ids.attempt,
      ids.executableProjection,
      hashA,
      ids.relationshipProjection,
      hashB,
      ids.restrictionProjection,
      hashC,
      JSON.stringify(childManifest),
      ids.legacyAttempt,
    ]);

    const rollback = fixture.calls.find((call) => call.text.includes("semantic.execute_rollback"));
    expect(rollback?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      "revenue",
      ids.authorization,
      ids.nonce,
      "Operator-approved rollback",
    ]);
  });
});
