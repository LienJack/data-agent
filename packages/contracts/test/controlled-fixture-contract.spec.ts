import { describe, expect, it } from "vitest";
import { controlledFixtureContractSchema } from "../src/artifacts/index.js";

const partialPreconditions = {
  hard_budget_cap: true,
  deliverable_supported_subset: true,
  budget_executable_query_count: 0,
} as const;
const partialTerminal = {
  terminal: "PARTIAL",
  reason_code: "EVIDENCE_PARTIAL",
} as const;
const staleTerminal = { terminal: "STALE", reason_code: "RUN_STALE" } as const;
const failedTerminal = {
  terminal: "FAILED",
  reason_code: "INTERNAL_EXECUTION_FAILED",
} as const;

const mutations = [
  ["citation-only", partialPreconditions, partialTerminal, "EVIDENCE_SUPPORT_INSUFFICIENT"],
  ["hidden-conflict", partialPreconditions, partialTerminal, "MATERIAL_CONFLICT_UNDISCLOSED"],
  ["critical-query-failure", partialPreconditions, partialTerminal, "CRITICAL_OBLIGATION_FAILED"],
  ["stale-cross-revision", null, staleTerminal, "EVIDENCE_REVISION_STALE"],
  [
    "budget-false-complete",
    partialPreconditions,
    partialTerminal,
    "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION",
  ],
  ["writer-bypass", null, failedTerminal, "REPORT_PROJECTION_AUTHORITY_INVALID"],
  [
    "false-source-independence",
    partialPreconditions,
    partialTerminal,
    "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED",
  ],
  [
    "wrong-successful-sql",
    partialPreconditions,
    partialTerminal,
    "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
  ],
  [
    "wrong-filter-successful-sql",
    partialPreconditions,
    partialTerminal,
    "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
  ],
  [
    "bounded-universe-disclosure-omission",
    partialPreconditions,
    partialTerminal,
    "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED",
  ],
  ["supervisor-certificate-bypass", null, null, "REPORT_READY_AUTHORITY_REQUIRED"],
  ["certificate-tamper", null, null, "REPORT_READY_CERTIFICATE_TAMPERED"],
  ["certificate-semantic-hash-tamper", null, null, "CERTIFICATE_SEMANTIC_HASH_MISMATCH"],
  ["current-ready-revocation-race", null, staleTerminal, "READINESS_REVOKED_DURING_CONSUMPTION"],
] as const;

const mutationIds = mutations.map(([mutationId]) => mutationId);
const partialMutationIds = [
  "citation-only",
  "hidden-conflict",
  "critical-query-failure",
  "budget-false-complete",
  "false-source-independence",
  "wrong-successful-sql",
  "wrong-filter-successful-sql",
  "bounded-universe-disclosure-omission",
] as const;

function makeControlledFixture() {
  return {
    protocol_version: "u6-controlled-fixture@1.0.0",
    fixture_id: "retail-revenue-investigation-v1",
    authority_kind: "SYNTHETIC_PROTOCOL_FIXTURE",
    benchmark_eligible: false,
    demo_truth_eligible: false,
    release_evidence_eligible: false,
    question:
      "2025 年第一季度华南区净收入同比为什么下降？哪些竞争解释得到数据支持，哪些仍不能确认？",
    hypotheses: [
      {
        hypothesis_id: "promotion-mix",
        metric_alias: "promotion_decline_share",
        support_predicate: { operator: "GTE", threshold: 0.6 },
        refute_predicate: { operator: "LTE", threshold: 0.3 },
        expected_assessment: "SURVIVED",
      },
      {
        hypothesis_id: "late-refund",
        metric_alias: "late_refund_decline_share",
        support_predicate: { operator: "GTE", threshold: 0.4 },
        refute_predicate: { operator: "LTE", threshold: 0.2 },
        expected_assessment: "REFUTED",
      },
    ],
    queries: [
      {
        query_id: "Q1",
        depends_on_query_ids: [],
        rows: [
          {
            baseline_net_revenue: 1000,
            current_net_revenue: 800,
            decline_amount: 200,
            promotion_contribution: 140,
            late_refund_contribution: 20,
            other_contribution: 40,
          },
        ],
      },
      {
        query_id: "Q2",
        depends_on_query_ids: ["Q1"],
        rows: [
          {
            promotion_decline_share: 0.7,
            late_refund_decline_share: 0.1,
          },
        ],
      },
    ],
    rq092_mutation_ids: mutationIds,
    mutation_count: 14,
    partial_mutation_count: 8,
    generated_partial_pair_count: 16,
    mutation_registry: mutations.map(([mutationId, preconditions, terminal, domainReason]) => ({
      mutation_id: mutationId,
      partial_preconditions: preconditions,
      public_terminal: terminal,
      domain_reason_code: domainReason,
      certificate_issued: false,
      grant_issued: false,
    })),
    partial_pair_generation: {
      base_mutation_ids: [...partialMutationIds],
      continue_suffix: "--continue",
      replan_suffix: "--replan",
      continue_template: {
        hard_budget_cap: false,
        deliverable_supported_subset: true,
        budget_executable_query_count: 1,
        executable_replan_count: 0,
        expected_decision: "CONTINUE",
        expected_reason_code: "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE",
        public_terminal: null,
        certificate_issued: false,
        grant_issued: false,
      },
      replan_template: {
        hard_budget_cap: false,
        deliverable_supported_subset: true,
        budget_executable_query_count: 0,
        waiting_query_count: 0,
        budget_blocked_query_count: 0,
        open_obligation_count: 1,
        replan_trigger: "PLAN_INVALIDATED",
        executable_with_remaining_budget: true,
        expected_decision: "REPLAN",
        expected_reason_code: "EVIDENCE_PLAN_REPLAN_REQUIRED",
        public_terminal: null,
        certificate_issued: false,
        grant_issued: false,
      },
      generated_count: 16,
    },
    required_disclosures: [
      "SINGLE_AUTHORITY_SOURCE",
      "L2_NON_CAUSAL",
      "BOUNDED_HYPOTHESIS_UNIVERSE",
    ],
    expected: {
      promotion_mix: "SURVIVED",
      late_refund: "REFUTED",
      stop_decision: "STOP_READY",
      public_terminal: "READY",
      public_reason_code: "RUN_READY",
      release_decision: "HOLD",
    },
  };
}

describe("U6 Controlled Fixture Contract", () => {
  it("严格接受固定 Q1/Q2、14 Mutation、8 Partial 与 16 Pair", () => {
    const fixture = controlledFixtureContractSchema.parse(makeControlledFixture());
    expect(fixture.queries.map(({ query_id }) => query_id)).toEqual(["Q1", "Q2"]);
    expect(fixture.mutation_registry).toHaveLength(14);
    expect(
      fixture.mutation_registry.filter(
        ({ partial_preconditions }) => partial_preconditions !== null,
      ),
    ).toHaveLength(8);
    expect(fixture.partial_pair_generation.generated_count).toBe(16);
  });

  it("拒绝未知嵌套字段、额外行和额外列", () => {
    const unknownNested = makeControlledFixture();
    Object.assign(unknownNested.queries.at(1)?.rows.at(0) ?? {}, { unexpected: true });
    expect(controlledFixtureContractSchema.safeParse(unknownNested).success).toBe(false);

    const extraRow = makeControlledFixture();
    const q1Rows = extraRow.queries.at(0)?.rows;
    const q1Row = q1Rows?.at(0);
    if (!q1Rows || !q1Row) throw new Error("测试 Fixture 缺少 Q1 Row。");
    (q1Rows as unknown[]).push({ ...q1Row });
    expect(controlledFixtureContractSchema.safeParse(extraRow).success).toBe(false);

    const extraColumn = makeControlledFixture();
    Object.assign(extraColumn.queries.at(0)?.rows.at(0) ?? {}, { extra_metric: 1 });
    expect(controlledFixtureContractSchema.safeParse(extraColumn).success).toBe(false);
  });

  it("拒绝 Q1/Q2、Mutation 与 Partial Pair 顺序漂移", () => {
    const queryDrift = makeControlledFixture();
    queryDrift.queries.reverse();
    expect(controlledFixtureContractSchema.safeParse(queryDrift).success).toBe(false);

    const mutationDrift = makeControlledFixture();
    mutationDrift.mutation_registry.reverse();
    expect(controlledFixtureContractSchema.safeParse(mutationDrift).success).toBe(false);

    const pairDrift = makeControlledFixture();
    pairDrift.partial_pair_generation.base_mutation_ids.reverse();
    expect(controlledFixtureContractSchema.safeParse(pairDrift).success).toBe(false);
  });

  it("拒绝 14/8/16 Count 与 Pair 模板漂移", () => {
    for (const changed of [
      { mutation_count: 13 },
      { partial_mutation_count: 7 },
      { generated_partial_pair_count: 14 },
    ]) {
      expect(
        controlledFixtureContractSchema.safeParse({
          ...makeControlledFixture(),
          ...changed,
        }).success,
      ).toBe(false);
    }
    const pairDrift = makeControlledFixture();
    pairDrift.partial_pair_generation.continue_template.budget_executable_query_count = 0;
    expect(controlledFixtureContractSchema.safeParse(pairDrift).success).toBe(false);
  });
});
