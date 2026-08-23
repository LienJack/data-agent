import {
  buildJobWorkLease,
  buildSemanticInductionReceipt,
  jobInputSchema,
  type SemanticInductionCommitCommand,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSemanticInductionJobHandler } from "../../src/jobs/semantic-induction-job-handler.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

async function fixture() {
  const request = {
    schema_version: "semantic-induction-request@1.0.0" as const,
    scope,
    semantic_domain: "commerce",
    induction_id: id(3),
    induction_kind: "SCHEMA_INDUCTION" as const,
    base_release_ref: null,
    sources: [
      {
        schema_version: "semantic-induction-source@1.0.0" as const,
        source_kind: "PHYSICAL_SCHEMA" as const,
        source_ref: {
          resource_kind: "SCHEMA_SNAPSHOT" as const,
          resource_id: id(4),
          resource_revision: 1,
          resource_hash: hash("a"),
        },
        corpus_class: "SEMANTIC_BOOTSTRAP_CORPUS" as const,
        taint: {
          contains_holdout_or_test: false as const,
          contains_gold_or_expected_output: false as const,
          contains_oracle_feedback: false as const,
          sealed_benchmark: false as const,
        },
      },
    ],
    idempotency_key: "semantic-induction:worker-fixture",
  };
  const lease = await buildJobWorkLease({
    schema_version: "job-work-lease@1.0.0",
    scope,
    principal_id: id(5),
    job_id: id(6),
    kind: "SEMANTIC_INDUCTION",
    request_hash: hash("b"),
    input: jobInputSchema.parse({
      schema_version: "job-input@1.0.0",
      kind: "SEMANTIC_INDUCTION",
      resource_refs: [],
      parameters: { request },
    }),
    attempt_id: id(7),
    attempt_no: 1,
    delivery_attempt_no: 1,
    worker_id: "semantic-induction-worker",
    lease_token: 1,
    worker_fence: 1,
    lease_duration_ms: 30_000,
    expires_at: "2026-08-17T10:00:30.000Z",
    handler_revision: "semantic-induction-handler@1.1.0",
  });
  return { request, lease };
}

describe("semantic induction job handler", () => {
  it("loads exact source authority and commits a review-only U5 candidate", async () => {
    const { request, lease } = await fixture();
    const source = request.sources[0];
    if (!source) throw new Error("source fixture missing");
    const commit = vi.fn(
      async (
        _capability: unknown,
        _lease: typeof lease,
        command: SemanticInductionCommitCommand,
      ) => {
        const receipt = await buildSemanticInductionReceipt({
          schema_version: "semantic-induction-receipt@1.0.0",
          scope,
          semantic_domain: "commerce",
          induction_id: request.induction_id,
          request_hash: lease.request_hash,
          proposal_hash: command.proposal.proposal_hash,
          impact_plan_ref: {
            resource_id: id(8),
            resource_revision: 1,
            resource_hash: command.impact_plan.plan_hash,
          },
          metric_dry_run_ref: null,
          candidate_ref: { resource_id: id(9), resource_revision: 1, resource_hash: hash("d") },
          terminal: "CANDIDATE_CREATED",
          created_at: "2026-08-17T10:00:01.000Z",
        });
        return {
          ok: true as const,
          value: {
            schema_version: "semantic-induction-commit-result@1.0.0" as const,
            receipt,
            candidate: {
              schema_version: "semantic-candidate-create-result@1.0.0" as const,
              authority: "POSTGRESQL" as const,
              candidate_id: id(9),
              revision_id: id(10),
              source_revision_id: id(11),
              source_digest: hash("c"),
              revision_digest: hash("d"),
              idempotency_digest: hash("e"),
              candidate_status: "DRAFT" as const,
              created: true,
            },
          },
        };
      },
    );
    const handler = createSemanticInductionJobHandler({
      capability: {},
      registry: {
        loadTarget: vi.fn(async () => ({
          ok: true as const,
          value: {
            request,
            sources: [
              {
                source_ref: source.source_ref,
                content_hash: hash("f"),
                metric_format: null,
                facts: [
                  {
                    namespace: "commerce",
                    object_role: "ENTITY" as const,
                    name: "Order",
                    aliases: ["Orders"],
                    mapping_identities: ["relation:public.orders"],
                    evidence_identities: ["evidence:orders"],
                    payload: { name: "Order" },
                  },
                ],
                metrics: [],
                document_chunks: [],
              },
            ],
            previous_objects: [],
            dependencies: [],
          },
        })),
        commit,
        reject: vi.fn(),
      },
    });
    const result = await handler.execute(lease, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[2].candidate_draft.source_payload.content.review_only).toBe(true);
    if (result.ok) {
      const output = result.value[0];
      expect(output && "resource_kind" in output ? output.resource_kind : null).toBe(
        "SEMANTIC_INDUCTION_RECEIPT",
      );
    }
  });

  it("checks cancellation before loading or committing", async () => {
    const { lease } = await fixture();
    const loadTarget = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const result = await createSemanticInductionJobHandler({
      capability: {},
      registry: { loadTarget, commit: vi.fn(), reject: vi.fn() },
    }).execute(lease, controller.signal);
    expect(result.ok).toBe(false);
    expect(loadTarget).not.toHaveBeenCalled();
  });

  it("persists a rejected metric dry-run before returning a stable failure", async () => {
    const source = {
      schema_version: "semantic-induction-source@1.0.0" as const,
      source_kind: "METRIC_EXCHANGE" as const,
      source_ref: {
        resource_kind: "METRIC_EXCHANGE_PACKAGE" as const,
        resource_id: id(20),
        resource_revision: 1,
        resource_hash: hash("a"),
      },
      corpus_class: "SEMANTIC_BOOTSTRAP_CORPUS" as const,
      taint: {
        contains_holdout_or_test: false as const,
        contains_gold_or_expected_output: false as const,
        contains_oracle_feedback: false as const,
        sealed_benchmark: false as const,
      },
    };
    const request = {
      schema_version: "semantic-induction-request@1.0.0" as const,
      scope,
      semantic_domain: "commerce",
      induction_id: id(21),
      induction_kind: "METRIC_IMPORT" as const,
      base_release_ref: null,
      sources: [source],
      idempotency_key: "semantic-metric:worker-fixture",
    };
    const lease = await buildJobWorkLease({
      schema_version: "job-work-lease@1.0.0",
      scope,
      principal_id: id(5),
      job_id: id(22),
      kind: "METRIC_IMPORT",
      request_hash: hash("b"),
      input: jobInputSchema.parse({
        schema_version: "job-input@1.0.0",
        kind: "METRIC_IMPORT",
        resource_refs: [],
        parameters: { request },
      }),
      attempt_id: id(23),
      attempt_no: 1,
      delivery_attempt_no: 1,
      worker_id: "semantic-metric-worker",
      lease_token: 1,
      worker_fence: 1,
      lease_duration_ms: 30_000,
      expires_at: "2026-08-17T10:00:30.000Z",
      handler_revision: "metric-import-handler@1.1.0",
    });
    const reject = vi.fn(async (_capability, _lease, command) => ({
      ok: true as const,
      value: {
        schema_version: "semantic-induction-reject-result@1.0.0" as const,
        receipt: await buildSemanticInductionReceipt({
          schema_version: "semantic-induction-receipt@1.0.0",
          scope,
          semantic_domain: "commerce",
          induction_id: request.induction_id,
          request_hash: lease.request_hash,
          proposal_hash: null,
          impact_plan_ref: null,
          metric_dry_run_ref: {
            resource_id: request.induction_id,
            resource_revision: 1,
            resource_hash: command.metric_dry_run.receipt_hash,
          },
          candidate_ref: null,
          terminal: "DRY_RUN_REJECTED",
          created_at: "2026-08-17T10:00:01.000Z",
        }),
      },
    }));
    const commit = vi.fn();
    const result = await createSemanticInductionJobHandler({
      capability: {},
      kind: "METRIC_IMPORT",
      registry: {
        loadTarget: vi.fn(async () => ({
          ok: true as const,
          value: {
            request,
            sources: [
              {
                source_ref: source.source_ref,
                content_hash: hash("a"),
                metric_format: "OSI_METRIC_EXCHANGE" as const,
                facts: [],
                metrics: [
                  {
                    external_id: "gmv",
                    name: "Gross Revenue",
                    expression: "drop table orders",
                    unit: "CNY",
                  },
                ],
                document_chunks: [],
              },
            ],
            previous_objects: [],
            dependencies: [],
          },
        })),
        commit,
        reject,
      },
    }).execute(lease, new AbortController().signal);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_METRIC_DRY_RUN_REJECTED", retryable: false },
    });
    expect(reject).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });
});
