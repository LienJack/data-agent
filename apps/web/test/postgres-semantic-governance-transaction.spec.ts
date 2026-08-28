import {
  buildSemanticAssertionCandidate,
  buildSemanticChangeSet,
  type SemanticApplicationAuthority,
  type SemanticGovernancePort,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { SqlClient, SqlPool } from "@data-agent/platform";
import { createPostgresCapabilityAuthority } from "@data-agent/platform";
import { createSemanticGovernanceService } from "@data-agent/semantic/application";
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
  readonly reviewTask?: Record<string, unknown>;
  readonly reviewCandidate?: Record<string, unknown>;
  readonly reviewCandidateRevisions?: readonly Record<string, unknown>[];
  readonly reviewDecisions?: readonly Record<string, unknown>[];
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
          if (text.includes("semantic.human_record_semantic_review_decision")) {
            return {
              rows: [
                {
                  human_record_semantic_review_decision: {
                    decision_id: ids.revision,
                    decision_digest: `sha256:${"4".repeat(64)}`,
                    packet_closed: true,
                    outcome: "APPROVED",
                    total_approvals: 1,
                    total_rejections: 0,
                    required_approvals: 1,
                  },
                },
              ] as Row[],
              rowCount: 1,
            };
          }
          if (text.includes("SELECT task.semantic_domain")) {
            return { rows: [], rowCount: 0 };
          }
          if (text.includes("FROM semantic.semantic_candidate_revision")) {
            return {
              rows: [...(options.reviewCandidateRevisions ?? [])] as Row[],
              rowCount: options.reviewCandidateRevisions?.length ?? 0,
            };
          }
          if (text.includes("FROM semantic.semantic_review_decision")) {
            return {
              rows: [...(options.reviewDecisions ?? [])] as Row[],
              rowCount: options.reviewDecisions?.length ?? 0,
            };
          }
          if (text.includes("FROM semantic.semantic_candidate") && options.reviewCandidate) {
            return { rows: [options.reviewCandidate] as Row[], rowCount: 1 };
          }
          if (text.includes("FROM semantic.semantic_review_task")) {
            if (options.reviewTask) return { rows: [options.reviewTask] as Row[], rowCount: 1 };
            return { rows: [{ candidate_id: ids.candidate }] as Row[], rowCount: 1 };
          }
          if (text.includes("semantic.human_prepare_publish_attempt")) {
            return {
              rows: [{ prepare_publish_attempt: { attempt_id: ids.attempt } }] as Row[],
              rowCount: 1,
            };
          }
          if (text.includes("FROM semantic.semantic_publish_attempt")) {
            return { rows: [{ attempt_id: ids.attempt }] as Row[], rowCount: 1 };
          }
          if (text.includes("semantic.human_commit_publish_attempt")) {
            return {
              rows: [{ commit_publish_attempt: { release_id: ids.release } }] as Row[],
              rowCount: 1,
            };
          }
          if (text.includes("semantic.human_execute_rollback")) {
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

let PostgresSemanticGovernanceService: typeof import("@data-agent/platform").PostgresSemanticGovernanceService;

beforeAll(async () => {
  ({ PostgresSemanticGovernanceService } = await import("@data-agent/platform"));
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

const conformanceDomain = {
  domain: "revenue",
  displayName: "收入",
  description: "",
  datasourceId: ids.datasource,
  isActive: true,
  domainVersion: 1,
} as const;

async function expectGovernanceListConformance(
  port: SemanticGovernancePort,
  authority: SemanticApplicationAuthority,
) {
  await expect(createSemanticGovernanceService(port).listDomains(authority)).resolves.toEqual({
    ok: true,
    value: [conformanceDomain],
  });
}

describe("PostgresSemanticGovernanceService transaction boundary", () => {
  it("runs the same application conformance fixture against memory and PostgreSQL ports", async () => {
    const fixture = await arrange();
    const memoryPort = {
      listDomains: vi.fn(async () => ({ ok: true as const, value: [conformanceDomain] })),
      getInboxItems: vi.fn(),
      getPacketDetail: vi.fn(),
      submitDecision: vi.fn(),
      createCandidate: vi.fn(),
      preparePublish: vi.fn(),
      commitPublish: vi.fn(),
      executeRollback: vi.fn(),
    } as unknown as SemanticGovernancePort;

    await expectGovernanceListConformance(memoryPort, fixture.context);
    await expectGovernanceListConformance(fixture.service, fixture.context);
  });

  it("revalidates, sets local scope, runs business SQL and commits on one client", async () => {
    const fixture = await arrange();
    await expect(fixture.service.listDomains(fixture.context)).resolves.toMatchObject({
      ok: true,
      value: [{ domain: "revenue" }],
    });

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

    await expect(fixture.service.listDomains(fixture.context)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PERSISTENCE_TRANSACTION_FAILED",
        message: "持久化事务失败；数据库错误细节已从公开响应中移除。",
      },
    });
    expect(fixture.calls.map((call) => call.text).at(-1)).toBe("ROLLBACK");
    expect(fixture.released).toEqual([2]);
  });

  it("does not set scope or run business SQL after authority revalidation fails", async () => {
    const fixture = await arrange({ denyRevalidation: true });

    await expect(fixture.service.listDomains(fixture.context)).resolves.toMatchObject({
      ok: false,
      error: { code: "APP_AUTHORITY_STALE_OR_FORBIDDEN" },
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
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_SCOPE_FORBIDDEN" },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("expands the read-only all sentinel only to server-authorized domains", async () => {
    const fixture = await arrange();
    const allContext = {
      ...fixture.context,
      scope: { ...fixture.context.scope, semanticDomain: "all" },
      allowedDomains: ["customer", "revenue"],
    };

    await expect(fixture.service.getInboxItems(allContext, "completed")).resolves.toEqual({
      ok: true,
      value: [],
    });
    const inboxQuery = fixture.calls.find((call) =>
      call.text.includes("SELECT task.semantic_domain"),
    );
    expect(inboxQuery?.text).toContain("task.semantic_domain = ANY($4::text[])");
    expect(inboxQuery?.values?.[3]).toEqual(["customer", "revenue"]);
  });

  it("keeps packets already decided by the current principal out of my-decision", async () => {
    const fixture = await arrange();

    await fixture.service.getInboxItems(fixture.context, "my-decision");
    const inboxQuery = fixture.calls.find((call) =>
      call.text.includes("SELECT task.semantic_domain"),
    );
    expect(inboxQuery?.text).toContain("own_decision.principal = $5");
    expect(inboxQuery?.values?.[4]).toBe(ids.principal);
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
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_INVALID",
        message: "语义候选输入无效。",
      },
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

  it("submits a human decision only through the scoped review wrapper", async () => {
    const fixture = await arrange();

    const result = await fixture.service.submitDecision(fixture.context, {
      schema_version: "semantic-decision@1.0.0",
      semantic_domain: "revenue",
      packet_id: ids.packet,
      decision: "APPROVE",
      decision_reason: "Reviewed against the frozen successor change set.",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { packetClosed: true, outcome: "APPROVED", totalApprovals: 1 },
    });

    const rpc = fixture.calls.find((call) =>
      call.text.includes("semantic.human_record_semantic_review_decision"),
    );
    expect(rpc?.values).toEqual([
      {
        schema_version: "human-semantic-review-decision@1.0.0",
        scope: {
          app_id: ids.app,
          tenant_id: ids.tenant,
          workspace_id: ids.tenant,
          environment: "test",
        },
        semantic_domain: "revenue",
        packet_id: ids.packet,
        principal_id: ids.principal,
        semantic_role: "admin_reviewer",
        decision: "APPROVE",
        decision_reason: "Reviewed against the frozen successor change set.",
      },
    ]);
    expect(
      fixture.calls.some((call) => call.text.includes("semantic.record_review_decision(")),
    ).toBe(false);
  });

  it("returns the exact frozen successor ChangeSet and real quorum through the review API", async () => {
    const reviewScope = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test" as const,
      semantic_domain: "revenue",
    };
    const assertion = await buildSemanticAssertionCandidate({
      schema_version: "semantic-assertion-candidate@1.0.0",
      assertion_id: ids.candidate,
      scope: reviewScope,
      target_kind: "METRIC",
      canonical_key: "metric.order_revenue",
      applicability_scope: { datasource: "falcon_db_24" },
      assertion_payload: { metric: { metric_id: "metric.order_revenue" } },
      source_kind: "CURRENT_SEMANTIC_FACT",
      evidence: [
        {
          evidence_id: "falcon24:metric.order_revenue",
          source_kind: "CURRENT_SEMANTIC_FACT",
          source_ref: {
            resource_id: "falcon24-semantic-blueprint",
            resource_revision: 1,
            resource_hash: `sha256:${"5".repeat(64)}`,
          },
          locator: { locator_kind: "SEMANTIC_OBJECT", locator_value: "metric.order_revenue" },
          observation: "Verified frozen Falcon24 semantic assertion.",
        },
      ],
      premise_assertion_ids: [],
      inference_rule_id: null,
      confidence: 1,
    });
    const changeSet = await buildSemanticChangeSet({
      schema_version: "semantic-change-set@1.0.0",
      change_set_id: ids.candidate,
      scope: reviewScope,
      base_release: {
        release_id: ids.release,
        generation: 1,
        release_hash: `sha256:${"6".repeat(64)}`,
      },
      revision: 1,
      assertions: [assertion],
      conflicts: [],
      competency_results: [],
      validation: {
        outcome: "PASS",
        reason_codes: [],
        formula_cycle_free: true,
        evidence_closed: true,
        identity_conflict_free: true,
        shapes_valid: true,
        formulas_valid: true,
        grain_join_time_valid: true,
        policy_quality_valid: true,
        competency_cases_passed: true,
      },
      lifecycle_state: "REVIEW_FROZEN",
    });
    const packetPayload = {
      schema_version: "semantic-successor-review-packet@1.0.0" as const,
      title: "Falcon24 executable semantic successor",
      description: "Forward-only reviewed successor.",
      riskLevel: "critical" as const,
      proposer_principal: "falcon24-successor-builder@1",
      review_policy_ref: {
        policy_version: 7,
        policy_digest: `sha256:${"7".repeat(64)}`,
      },
      change_set: changeSet,
    };
    const packetDigest = await sha256ContentHash(packetPayload);
    const fixture = await arrange({
      reviewTask: {
        semantic_domain: "revenue",
        packet_id: ids.packet,
        packet_kind: "CANDIDATE_REVIEW",
        packet_digest: packetDigest,
        packet_payload: packetPayload,
        candidate_id: ids.candidate,
        decision_window_status: "OPEN",
        review_outcome: "PENDING",
        decision_expires_at: "2026-09-01T00:00:00.000Z",
        publish_expires_at: "2026-09-02T00:00:00.000Z",
        created_at: "2026-08-28T00:00:00.000Z",
        created_by: ids.principal,
        closed_at: null,
        quorum_rules_snapshot: { required_approvals: 3 },
      },
      reviewCandidate: {
        candidate_id: ids.candidate,
        proposer_principal: "falcon24-successor-builder@1",
        candidate_status: "WAITING_REVIEW",
        current_revision_id: ids.revision,
        created_at: "2026-08-28T00:00:00.000Z",
        updated_at: "2026-08-28T00:00:00.000Z",
      },
      reviewCandidateRevisions: [
        {
          revision_id: ids.revision,
          revision_number: 1,
          revision_payload: changeSet,
          author_principal: "falcon24-successor-builder@1",
          change_description: "Frozen Falcon24 successor ChangeSet",
          change_class: "MAJOR",
          created_at: "2026-08-28T00:00:00.000Z",
        },
      ],
      reviewDecisions: [],
    });

    await expect(
      fixture.service.getPacketDetail(fixture.context, ids.packet),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        quorum: { required: 3, current: 0 },
        diff: {
          additions: [{ path: "metric.order_revenue" }],
        },
        impact: {
          affectedMetrics: ["metric.order_revenue"],
          breakingChanges: true,
        },
        authorityEvidence: {
          schemaVersion: "semantic-successor-review-evidence@1.0.0",
          packetDigest,
          packetPayload,
        },
      },
    });
  });

  it("forwards publish and rollback authority material without replacement", async () => {
    const fixture = await arrange();
    const hashA = `sha256:${"a".repeat(64)}`;
    const hashB = `sha256:${"b".repeat(64)}`;
    const hashC = `sha256:${"c".repeat(64)}`;
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
      call.text.includes("semantic.human_prepare_publish_attempt"),
    );
    expect(prepare?.values).toEqual([
      {
        schema_version: "human-prepare-publish-attempt@1.0.0",
        scope: {
          app_id: ids.app,
          tenant_id: ids.tenant,
          workspace_id: ids.tenant,
          environment: "test",
        },
        semantic_domain: "revenue",
        packet_id: ids.packet,
        candidate_id: ids.candidate,
        compiler_bundle_digest: hashA,
        catalog_fence_epoch: 7,
        dependency_generation: 11,
        target_generation: 12,
        idempotency_digest: hashB,
      },
    ]);

    const commit = fixture.calls.find((call) =>
      call.text.includes("semantic.human_commit_publish_attempt"),
    );
    expect(commit?.values).toEqual([
      {
        schema_version: "human-commit-publish-attempt@1.0.0",
        scope: {
          app_id: ids.app,
          tenant_id: ids.tenant,
          workspace_id: ids.tenant,
          environment: "test",
        },
        semantic_domain: "revenue",
        attempt_id: ids.attempt,
        executable_projection_ref: ids.executableProjection,
        executable_projection_hash: hashA,
        relationship_projection_ref: ids.relationshipProjection,
        relationship_projection_hash: hashB,
        runtime_restriction_projection_ref: ids.restrictionProjection,
        runtime_restriction_projection_hash: hashC,
        profile_child_manifest: childManifest,
      },
    ]);

    const rollback = fixture.calls.find((call) =>
      call.text.includes("semantic.human_execute_rollback"),
    );
    expect(rollback?.values).toEqual([
      {
        schema_version: "human-execute-rollback@1.0.0",
        scope: {
          app_id: ids.app,
          tenant_id: ids.tenant,
          workspace_id: ids.tenant,
          environment: "test",
        },
        semantic_domain: "revenue",
        authorization_id: ids.authorization,
        nonce: ids.nonce,
        rollback_reason: "Operator-approved rollback",
      },
    ]);
  });
});
