import {
  buildSemanticAssertionCandidate,
  buildSemanticReviewDecision,
  buildSemanticRuntimeClosureValidationReceipt,
  type SemanticSuccessorStageEnvelope,
  type StageReviewedSemanticSuccessorCommand,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  compileSemanticChangeSet,
  freezeSemanticChangeSetForReview,
} from "@data-agent/semantic/production";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const semanticMocks = vi.hoisted(() => ({
  compile: vi.fn(),
  verifyEnvelope: vi.fn(async (value: unknown) => value),
  validateClosure: vi.fn(),
}));

vi.mock("@data-agent/semantic/production", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@data-agent/semantic/production")>();
  return {
    ...actual,
    compileSemanticPublicationProjection: semanticMocks.compile,
    verifySemanticReleaseEnvelope: semanticMocks.verifyEnvelope,
    validateSemanticRuntimeClosure: semanticMocks.validateClosure,
  };
});

const id = (suffix: number) => `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = {
  appId: id(1),
  workspaceId: id(2),
  environment: "test",
  principalId: id(3),
  datasourceId: id(4),
  semanticDomain: "falcon24",
};
const contractScope = {
  app_id: scope.appId,
  tenant_id: scope.workspaceId,
  environment: "test" as const,
  semantic_domain: scope.semanticDomain,
};

async function sourceSnapshot() {
  const content = {
    schema_version: "physical-schema-content@1.0.0" as const,
    datasource_id: scope.datasourceId,
    datasource_fingerprint: hash("1"),
    engine: "postgresql" as const,
    engine_version: { major: 17, minor: 0 },
    database_identity: { database_name: "falcon_db_24", database_oid: 24 },
    included_schemas: ["public"],
    relations: [],
  };
  return {
    schema_version: "physical-schema-snapshot@1.0.0" as const,
    snapshot_id: id(5),
    scan_run_id: id(6),
    snapshot_content_hash: await sha256ContentHash(content),
    captured_at: "2026-08-28T00:00:00.000Z",
    content,
  };
}

async function reviewedChangeSet() {
  const assertion = await buildSemanticAssertionCandidate({
    schema_version: "semantic-assertion-candidate@1.0.0",
    assertion_id: id(7),
    scope: contractScope,
    target_kind: "QUALITY_CONSTRAINT",
    canonical_key: "quality.orders.nonnegative",
    applicability_scope: { datasource: "falcon_db_24" },
    assertion_payload: {
      constraint_id: "quality.orders.nonnegative",
      expression: "order_total >= 0",
      severity: "ERROR",
      sensitivity: "INTERNAL",
    },
    source_kind: "SCHEMA_FACT",
    evidence: [
      {
        evidence_id: "falcon24:quality-orders-nonnegative",
        source_kind: "SCHEMA_FACT",
        source_ref: {
          resource_id: "falcon24-schema",
          resource_revision: 1,
          resource_hash: hash("2"),
        },
        locator: { locator_kind: "SCHEMA_OBJECT", locator_value: "orders.order_total" },
        observation: "Fixed schema quality constraint.",
      },
    ],
    premise_assertion_ids: [],
    inference_rule_id: null,
    confidence: 1,
  });
  return freezeSemanticChangeSetForReview(
    await compileSemanticChangeSet({
      change_set_id: id(8),
      scope: contractScope,
      base_release: { release_id: id(9), generation: 1, release_hash: hash("3") },
      revision: 1,
      assertions: [assertion],
    }),
  );
}

async function arrange(
  reviewCandidateStatus:
    | "WAITING_REVIEW"
    | "APPROVED"
    | "REJECTED"
    | "REVIEW_EXPIRED"
    | "STALE_REBASE_REQUIRED"
    | "PUBLISHING"
    | "PUBLISHED" = "WAITING_REVIEW",
) {
  const snapshot = await sourceSnapshot();
  const changeSet = await reviewedChangeSet();
  const review = await buildSemanticReviewDecision({
    schema_version: "semantic-review-decision@1.0.0",
    review_id: id(10),
    scope: contractScope,
    change_set_id: changeSet.change_set_id,
    change_set_hash: changeSet.change_set_hash,
    reviewer_principal_id: scope.principalId,
    decision: "APPROVE",
    reason_codes: [],
    reviewed_at: "2026-08-28T00:01:00.000Z",
  });
  const projection = {
    release_id: id(11),
    source_revision_id: id(12),
    candidate_revision_id: id(13),
    validation_receipt_id: id(14),
    publish_attempt_id: id(15),
    executable_projection_id: id(16),
    relationship_projection_id: id(17),
    restriction_projection_id: id(18),
    graph_projection_id: id(19),
    review_decision_id: id(20),
    outbox_event_id: id(21),
    compiler_bundle_digest: hash("4"),
    executable_projection_digest: hash("5"),
    relationship_projection_digest: hash("6"),
    restriction_projection_digest: hash("7"),
    graph_projection_digest: hash("8"),
    release_digest: hash("9"),
    executable_projection: { server_compiled: "executable" },
    relationship_projection: { server_compiled: "relationship" },
    restriction_projection: { server_compiled: "restriction" },
    graph_projection: {
      compiler_version: "semantic-change-set-publication@2",
      server_compiled: "graph",
    },
    binding_impact_hashes: [hash("a")],
  } as const;
  semanticMocks.compile.mockResolvedValue(projection);
  semanticMocks.validateClosure.mockImplementation(
    async (envelope: SemanticSuccessorStageEnvelope) =>
      buildSemanticRuntimeClosureValidationReceipt({
        schema_version: "semantic-runtime-closure-validation-receipt@1.0.0",
        receipt_id: id(22),
        stage_id: envelope.stage.stage_id,
        stage_digest: envelope.stage.stage_digest,
        candidate_release: envelope.stage.candidate_release,
        projection_refs: envelope.stage.projection_refs,
        validator_identity: {
          validator_version: "semantic-runtime-closure-validator@1.0.0",
          validator_hash: hash("b"),
        },
        outcome: "PASS",
        reason_codes: [],
      }),
  );
  const command: StageReviewedSemanticSuccessorCommand = {
    schema_version: "stage-reviewed-semantic-successor-command@1.0.0",
    command_id: id(23),
    idempotency_key: "falcon24-generation-2",
    scope: contractScope,
    change_set_ref: {
      change_set_id: changeSet.change_set_id,
      change_set_hash: changeSet.change_set_hash,
    },
    review_ref: { review_id: review.review_id, review_hash: review.review_hash },
    source_snapshot_ref: {
      snapshot_id: snapshot.snapshot_id,
      snapshot_revision: 1,
      snapshot_hash: snapshot.snapshot_content_hash,
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: projection.compiler_bundle_digest,
    },
    expected_predecessor: {
      release_id: changeSet.base_release.release_id,
      generation: changeSet.base_release.generation,
      release_digest: changeSet.base_release.release_hash,
    },
    expected_pointer_version: 3,
    target_generation: 2,
  };
  const calls: Array<{ readonly text: string; readonly values?: readonly unknown[] }> = [];
  let connectCount = 0;
  let released = 0;
  const client = {
    async query<Row extends object = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      calls.push({ text, ...(values ? { values } : {}) });
      if (text.includes("from platform.deployment_mappings")) {
        return {
          rows: [{ deployment_id: id(24), membership_role: "owner" }] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("platform.backend_context_matches")) {
        return { rows: [{ allowed: true }] as Row[], rowCount: 1 };
      }
      if (text.includes("semantic.prepare_falcon24_successor_review")) {
        return {
          rows: [
            {
              prepared: {
                change_set_ref: {
                  change_set_id: changeSet.change_set_id,
                  change_set_hash: changeSet.change_set_hash,
                },
                review_packet_ref: {
                  review_id: review.review_id,
                  packet_digest: hash("c"),
                },
                candidate_status: reviewCandidateStatus,
                created: reviewCandidateStatus === "WAITING_REVIEW",
              },
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("semantic.prepare_falcon24_successor_publish_attempt")) {
        return {
          rows: [
            {
              prepared: {
                attempt_id: id(28),
                attempt_state: "PREPARED",
                change_set_ref: {
                  change_set_id: changeSet.change_set_id,
                  change_set_hash: changeSet.change_set_hash,
                },
                review_ref: { review_id: review.review_id, review_hash: review.review_hash },
                review_document: review,
                created: true,
              },
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("from semantic.semantic_active_pointer")) {
        return {
          rows: [
            {
              current_release_id: command.expected_predecessor.release_id,
              current_release_generation: "1",
              current_release_digest: command.expected_predecessor.release_digest,
              pointer_generation: "3",
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("from semantic.semantic_candidate as candidate")) {
        return {
          rows: [
            {
              candidate_status: "PUBLISHING",
              current_revision_id: id(25),
              source_revision_id: id(26),
              revision_digest: changeSet.change_set_hash,
              revision_payload: changeSet,
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("from semantic.semantic_source_revision")) {
        return {
          rows: [
            {
              revision_id: id(26),
              source_digest: changeSet.change_set_hash,
              source_payload: changeSet,
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("from semantic.semantic_review_task as task")) {
        return {
          rows: [
            {
              candidate_id: changeSet.change_set_id,
              decision_window_status: "CLOSED",
              review_outcome: "APPROVED",
              packet_payload: { change_set: changeSet },
              decision_id: id(27),
              decision_principal: scope.principalId,
              decision: "APPROVE",
              decision_digest: review.review_hash,
              review_document: review,
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("from semantic.semantic_publish_attempt")) {
        return {
          rows: [
            {
              attempt_id: id(28),
              attempt_state: "PREPARED",
              candidate_id: changeSet.change_set_id,
              packet_id: review.review_id,
              compiler_bundle_digest: projection.compiler_bundle_digest,
              target_generation: "2",
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (text.includes("from semantic.semantic_domain_registry")) {
        return { rows: [{ datasource_id: scope.datasourceId }] as Row[], rowCount: 1 };
      }
      if (text.includes("catalog.get_physical_schema_snapshot")) {
        return { rows: [{ snapshot }] as Row[], rowCount: 1 };
      }
      if (text.includes("app_data_agent.u2_canonical_sha256")) {
        return { rows: [{ digest: await sha256ContentHash(values?.[0]) }] as Row[], rowCount: 1 };
      }
      if (text.includes("semantic.record_semantic_successor_stage")) {
        const record = values?.[0] as { stage: unknown; projections: unknown };
        return {
          rows: [{ envelope: { stage: record.stage, projections: record.projections } }] as Row[],
          rowCount: 1,
        };
      }
      return { rows: [] as Row[], rowCount: 0 };
    },
    release() {
      released += 1;
    },
  };
  const pool = {
    async connect() {
      connectCount += 1;
      return client;
    },
  } as unknown as Pick<Pool, "connect">;
  return {
    snapshot,
    changeSet,
    review,
    projection,
    command,
    pool,
    calls,
    get connectCount() {
      return connectCount;
    },
    get released() {
      return released;
    },
  };
}

describe("PostgreSQL semantic successor publication authority", () => {
  beforeEach(() => {
    semanticMocks.compile.mockReset();
    semanticMocks.verifyEnvelope.mockClear();
    semanticMocks.validateClosure.mockReset();
  });

  it("loads authority-owned source and snapshot material before recording server projections", async () => {
    const fixture = await arrange();
    const { createPostgresSemanticPublicationAuthority } = await import(
      "../src/lib/postgres-semantic-publication.js"
    );
    const authority = createPostgresSemanticPublicationAuthority(fixture.pool, scope);
    const envelope = await authority.stageReviewedSuccessor(fixture.command);

    expect(envelope.stage.status).toBe("STAGED");
    expect(semanticMocks.compile).toHaveBeenCalledWith(fixture.changeSet, {
      source_snapshot: fixture.snapshot,
    });
    const recordCall = fixture.calls.find(({ text }) =>
      text.includes("semantic.record_semantic_successor_stage"),
    );
    const record = recordCall?.values?.[0] as {
      readonly projections: {
        readonly executable: { readonly projection_payload: unknown };
      };
      readonly stage: { readonly compiler_bundle_ref: unknown };
      readonly validation_receipt: { readonly outcome: string };
    };
    expect(record.projections.executable.projection_payload).toEqual(
      fixture.projection.executable_projection,
    );
    expect(record.stage.compiler_bundle_ref).toEqual(fixture.command.compiler_bundle_ref);
    expect(record.validation_receipt.outcome).toBe("PASS");
    expect(fixture.released).toBe(1);
  });

  it("opens the fixed change set for human review without accepting projection material", async () => {
    const fixture = await arrange();
    const { createPostgresSemanticPublicationAuthority } = await import(
      "../src/lib/postgres-semantic-publication.js"
    );
    const authority = createPostgresSemanticPublicationAuthority(fixture.pool, scope);
    const prepared = await authority.prepareSuccessorReview({
      idempotency_key: id(29),
      expected_predecessor: fixture.command.expected_predecessor,
      expected_pointer_version: fixture.command.expected_pointer_version,
      change_set: fixture.changeSet,
    });

    expect(prepared.change_set_ref).toEqual(fixture.command.change_set_ref);
    expect(prepared.review_packet_ref.review_id).toBe(fixture.review.review_id);
    const rpc = fixture.calls.find(({ text }) =>
      text.includes("semantic.prepare_falcon24_successor_review"),
    );
    expect(rpc?.values).toEqual([
      {
        schema_version: "prepare-falcon24-semantic-successor-review@1.0.0",
        scope: {
          app_id: scope.appId,
          tenant_id: scope.workspaceId,
          workspace_id: scope.workspaceId,
          environment: scope.environment,
        },
        semantic_domain: scope.semanticDomain,
        idempotency_key: id(29),
        expected_predecessor: fixture.command.expected_predecessor,
        expected_pointer_version: fixture.command.expected_pointer_version,
        change_set: fixture.changeSet,
      },
    ]);
    expect(JSON.stringify(rpc?.values)).not.toContain("projection_payload");
  });

  it("preserves the current approved state when the fixed review preparation is replayed", async () => {
    const fixture = await arrange("APPROVED");
    const { createPostgresSemanticPublicationAuthority } = await import(
      "../src/lib/postgres-semantic-publication.js"
    );
    const authority = createPostgresSemanticPublicationAuthority(fixture.pool, scope);

    await expect(
      authority.prepareSuccessorReview({
        idempotency_key: id(29),
        expected_predecessor: fixture.command.expected_predecessor,
        expected_pointer_version: fixture.command.expected_pointer_version,
        change_set: fixture.changeSet,
      }),
    ).resolves.toMatchObject({ candidate_status: "APPROVED", created: false });
  });

  it("prepares only an exact human-approved successor for server compilation", async () => {
    const fixture = await arrange();
    const { createPostgresSemanticPublicationAuthority } = await import(
      "../src/lib/postgres-semantic-publication.js"
    );
    const authority = createPostgresSemanticPublicationAuthority(fixture.pool, scope);
    const prepared = await authority.prepareApprovedSuccessor({
      review_id: fixture.review.review_id,
      change_set_ref: fixture.command.change_set_ref,
      compiler_bundle_digest: fixture.command.compiler_bundle_ref.compiler_bundle_hash,
      target_generation: fixture.command.target_generation,
      idempotency_digest: hash("d"),
      expected_predecessor: fixture.command.expected_predecessor,
      expected_pointer_version: fixture.command.expected_pointer_version,
    });

    expect(prepared).toMatchObject({
      attempt_state: "PREPARED",
      review_ref: { review_id: fixture.review.review_id, review_hash: fixture.review.review_hash },
      review_document: fixture.review,
    });
    const rpc = fixture.calls.find(({ text }) =>
      text.includes("semantic.prepare_falcon24_successor_publish_attempt"),
    );
    expect(JSON.stringify(rpc?.values)).not.toContain("projection_payload");
    expect(JSON.stringify(rpc?.values)).not.toContain("projection_digest");
    expect(JSON.stringify(rpc?.values)).not.toContain("candidate_release");
  });

  it("rejects a mismatched command scope before opening a database transaction", async () => {
    const fixture = await arrange();
    const { createPostgresSemanticPublicationAuthority } = await import(
      "../src/lib/postgres-semantic-publication.js"
    );
    const authority = createPostgresSemanticPublicationAuthority(fixture.pool, scope);
    await expect(
      authority.stageReviewedSuccessor({
        ...fixture.command,
        scope: { ...fixture.command.scope, tenant_id: id(99) },
      }),
    ).rejects.toThrow("SEMANTIC_SUCCESSOR_SCOPE_FORBIDDEN");
    expect(fixture.connectCount).toBe(0);
  });
});
