import { z } from "zod";
import { artifactReferenceIdentity } from "../envelope.js";
import {
  researchBudgetBalanceSchema,
  researchBudgetLimitSchema,
  researchBudgetUsageSchema,
  versionFrontierSchema,
} from "./planning.js";
import {
  addUniqueIssues,
  contentHashSchema,
  nonNegativeIntSchema,
  U6_WIRE_LIMITS,
  uniqueReasonCodeArraySchema,
} from "./primitives.js";
import {
  atomicClaimRefSchema,
  evidencePlanRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  obligationExecutionDecisionRefSchema,
  proofObligationRefSchema,
  queryEvidenceRefSchema,
  supportDecisionRefSchema,
} from "./references.js";

const uniqueArtifactReferences = <T extends z.ZodType>(schema: T, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(
        values,
        (value) => artifactReferenceIdentity(value as never),
        ctx,
        [],
        "Artifact Reference 必须唯一。",
      );
    });

export const researchBudgetLedgerBindingSchema = z
  .strictObject({
    ledger_version: z.literal("research-budget-ledger@1.0.0"),
    evaluated_through_reservation_seq: nonNegativeIntSchema,
    effective_limit: researchBudgetLimitSchema,
    used: researchBudgetUsageSchema,
    remaining: researchBudgetBalanceSchema,
    top_up_allowed: z.boolean(),
    ledger_hash: contentHashSchema,
  })
  .superRefine((ledger, ctx) => {
    const equations: Array<[number, number, number, string]> = [
      [ledger.used.steps, ledger.remaining.steps, ledger.effective_limit.max_steps, "steps"],
      [
        ledger.used.model_calls,
        ledger.remaining.model_calls,
        ledger.effective_limit.max_model_calls,
        "model_calls",
      ],
      [
        ledger.used.sql_executions,
        ledger.remaining.sql_executions,
        ledger.effective_limit.max_sql_executions,
        "sql_executions",
      ],
      [
        ledger.used.source_calls,
        ledger.remaining.source_calls,
        ledger.effective_limit.max_source_calls,
        "source_calls",
      ],
      [
        ledger.used.elapsed_ms,
        ledger.remaining.elapsed_ms,
        ledger.effective_limit.max_elapsed_ms,
        "elapsed_ms",
      ],
      [
        ledger.used.provider_tokens,
        ledger.remaining.provider_tokens,
        ledger.effective_limit.max_provider_tokens_per_run,
        "provider_tokens",
      ],
      [
        ledger.used.provider_cost_microusd,
        ledger.remaining.provider_cost_microusd,
        ledger.effective_limit.max_provider_cost_microusd_per_run,
        "provider_cost_microusd",
      ],
    ];
    for (const [used, remaining, limit, field] of equations) {
      if (used + remaining !== limit) {
        ctx.addIssue({
          code: "custom",
          message: `${field} 必须满足 used + remaining === effective_limit。`,
          path: ["remaining", field],
        });
      }
    }
  });

export const obligationCoverageSchema = z.strictObject({
  obligation_ref: proofObligationRefSchema,
  materiality: z.enum(["CRITICAL", "SUPPORTING"]),
  state: z.enum(["OPEN", "SATISFIED", "BLOCKED", "FAILED", "STALE"]),
  obligation_execution_decision_refs: uniqueArtifactReferences(
    obligationExecutionDecisionRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  query_evidence_refs: uniqueArtifactReferences(
    queryEvidenceRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  support_decision_refs: uniqueArtifactReferences(
    supportDecisionRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  conflict_refs: uniqueArtifactReferences(evidenceRelationRefSchema, 0, 64),
  reason_codes: uniqueReasonCodeArraySchema(1),
});

export const coverageCountsSchema = z.strictObject({
  critical_total: nonNegativeIntSchema,
  critical_open: nonNegativeIntSchema,
  critical_satisfied: nonNegativeIntSchema,
  critical_blocked: nonNegativeIntSchema,
  critical_failed: nonNegativeIntSchema,
  critical_stale: nonNegativeIntSchema,
  supporting_total: nonNegativeIntSchema,
  supporting_open: nonNegativeIntSchema,
  supporting_satisfied: nonNegativeIntSchema,
  supporting_blocked: nonNegativeIntSchema,
  supporting_failed: nonNegativeIntSchema,
  supporting_stale: nonNegativeIntSchema,
});

function deriveCoverageCounts(
  obligations: readonly z.infer<typeof obligationCoverageSchema>[],
): z.infer<typeof coverageCountsSchema> {
  const counts = {
    critical_total: 0,
    critical_open: 0,
    critical_satisfied: 0,
    critical_blocked: 0,
    critical_failed: 0,
    critical_stale: 0,
    supporting_total: 0,
    supporting_open: 0,
    supporting_satisfied: 0,
    supporting_blocked: 0,
    supporting_failed: 0,
    supporting_stale: 0,
  };
  for (const obligation of obligations) {
    const materiality = obligation.materiality === "CRITICAL" ? "critical" : "supporting";
    const state = obligation.state.toLowerCase() as Lowercase<typeof obligation.state>;
    counts[`${materiality}_total`] += 1;
    counts[`${materiality}_${state}`] += 1;
  }
  return counts;
}

export const coverageStatePayloadSchema = z
  .strictObject({
    artifact_type: z.literal("CoverageState"),
    protocol_version: z.literal("coverage-state@1.0.0"),
    evidence_plan_ref: evidencePlanRefSchema,
    obligation_execution_decision_refs: uniqueArtifactReferences(
      obligationExecutionDecisionRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    query_evidence_refs: uniqueArtifactReferences(
      queryEvidenceRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    atomic_claim_refs: uniqueArtifactReferences(
      atomicClaimRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    evidence_relation_refs: uniqueArtifactReferences(evidenceRelationRefSchema, 0, 64),
    support_decision_refs: uniqueArtifactReferences(
      supportDecisionRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    hypothesis_assessment_refs: uniqueArtifactReferences(
      hypothesisAssessmentRefSchema,
      2,
      U6_WIRE_LIMITS.max_hypotheses,
    ),
    obligations: z.array(obligationCoverageSchema).min(1).max(U6_WIRE_LIMITS.max_obligations),
    derived_counts: coverageCountsSchema,
    material_conflict_refs: uniqueArtifactReferences(evidenceRelationRefSchema, 0, 64),
    budget_ledger: researchBudgetLedgerBindingSchema,
    version_frontier: versionFrontierSchema,
    version_frontier_hash: contentHashSchema,
    coverage_input_hash: contentHashSchema,
  })
  .superRefine((coverage, ctx) => {
    addUniqueIssues(
      coverage.obligations,
      ({ obligation_ref }) =>
        `${artifactReferenceIdentity(obligation_ref.container_ref)}\0${obligation_ref.node_id}`,
      ctx,
      ["obligations"],
      "Coverage 中 Obligation 必须唯一。",
    );
    const expected = deriveCoverageCounts(coverage.obligations);
    if (JSON.stringify(expected) !== JSON.stringify(coverage.derived_counts)) {
      ctx.addIssue({
        code: "custom",
        message: "Coverage derived_counts 必须从 Obligation 状态重算。",
        path: ["derived_counts"],
      });
    }
  });

export type ResearchBudgetLedgerBinding = z.infer<typeof researchBudgetLedgerBindingSchema>;
export type ObligationCoverage = z.infer<typeof obligationCoverageSchema>;
export type CoverageCounts = z.infer<typeof coverageCountsSchema>;
export type CoverageStatePayload = z.infer<typeof coverageStatePayloadSchema>;
