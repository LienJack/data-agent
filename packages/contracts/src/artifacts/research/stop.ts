import { z } from "zod";
import { artifactReferenceIdentity } from "../envelope.js";
import { researchBudgetLedgerBindingSchema } from "./coverage.js";
import { researchBudgetDemandSchema } from "./planning.js";
import {
  addUniqueIssues,
  contentHashSchema,
  nonNegativeIntSchema,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  uniqueReasonCodeArraySchema,
  versionIdentifierSchema,
} from "./primitives.js";
import {
  atomicClaimRefSchema,
  coverageStateRefSchema,
  embeddedNodeReferenceIdentity,
  proofObligationRefSchema,
  queryContractRefSchema,
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

const uniqueEmbeddedReferences = <T extends z.ZodType>(schema: T, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(
        values,
        (value) => embeddedNodeReferenceIdentity(value as never),
        ctx,
        [],
        "Embedded Reference 必须唯一。",
      );
    });

function demandWithinBalance(
  demand: z.infer<typeof researchBudgetDemandSchema>,
  remaining: z.infer<typeof researchBudgetDemandSchema>,
): boolean {
  return (
    demand.steps <= remaining.steps &&
    demand.model_calls <= remaining.model_calls &&
    demand.sql_executions <= remaining.sql_executions &&
    demand.source_calls <= remaining.source_calls &&
    demand.elapsed_ms <= remaining.elapsed_ms &&
    demand.provider_tokens <= remaining.provider_tokens &&
    demand.provider_cost_microusd <= remaining.provider_cost_microusd
  );
}

export const candidateQueryAssessmentSchema = z.strictObject({
  query_contract_ref: queryContractRefSchema,
  obligation_refs: uniqueEmbeddedReferences(
    proofObligationRefSchema,
    1,
    U6_WIRE_LIMITS.max_obligations,
  ),
  admissibility: z.enum([
    "EXECUTABLE_NOW",
    "WAITING_EXTERNAL_CAPABILITY",
    "BUDGET_BLOCKED",
    "INADMISSIBLE",
  ]),
  expected_information_gain_microunits: nonNegativeIntSchema.max(1_000_000),
  required_budget: researchBudgetDemandSchema,
  waiting_on_codes: uniqueIdentifierArraySchema(0, U6_WIRE_LIMITS.max_obligations),
  reason_codes: uniqueReasonCodeArraySchema(1),
  assessment_hash: contentHashSchema,
});

export const supportedSubsetBindingSchema = z.strictObject({
  claim_refs: uniqueArtifactReferences(atomicClaimRefSchema, 0, U6_WIRE_LIMITS.max_obligations),
  support_decision_refs: uniqueArtifactReferences(
    supportDecisionRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  required_disclosures: uniqueIdentifierArraySchema(0, U6_WIRE_LIMITS.max_required_disclosures),
  subset_hash: contentHashSchema,
});

const candidateSetSchema = z
  .strictObject({
    enumerator_version: versionIdentifierSchema,
    unresolved_obligation_refs: uniqueEmbeddedReferences(
      proofObligationRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    no_candidate_obligation_refs: uniqueEmbeddedReferences(
      proofObligationRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    candidate_set_hash: contentHashSchema,
  })
  .superRefine((candidateSet, ctx) => {
    const unresolved = new Set(
      candidateSet.unresolved_obligation_refs.map(embeddedNodeReferenceIdentity),
    );
    if (
      candidateSet.no_candidate_obligation_refs.some(
        (reference) => !unresolved.has(embeddedNodeReferenceIdentity(reference)),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "no_candidate_obligation_refs 必须是 unresolved_obligation_refs 的子集。",
        path: ["no_candidate_obligation_refs"],
      });
    }
  });

const researchStopCommonShape = {
  artifact_type: z.literal("ResearchStopDecision"),
  protocol_version: z.literal("research-stop@1.0.0"),
  coverage_ref: coverageStateRefSchema,
  budget_ledger: researchBudgetLedgerBindingSchema,
  candidate_queries: z.array(candidateQueryAssessmentSchema).max(U6_WIRE_LIMITS.max_obligations),
  candidate_set: candidateSetSchema,
  supported_subset: supportedSubsetBindingSchema,
  reason_codes: uniqueReasonCodeArraySchema(1),
  eig_policy_version: versionIdentifierSchema,
  decision_input_hash: contentHashSchema,
} as const;

const continueStopSchema = z.strictObject({
  ...researchStopCommonShape,
  decision: z.literal("CONTINUE"),
  selected_next_query_ref: queryContractRefSchema,
});
const replanStopSchema = z.strictObject({
  ...researchStopCommonShape,
  decision: z.literal("REPLAN"),
  replan_obligation_refs: uniqueEmbeddedReferences(
    proofObligationRefSchema,
    1,
    U6_WIRE_LIMITS.max_obligations,
  ),
  replan_assessment: z.strictObject({
    trigger: z.enum(["PLAN_INVALIDATED", "QUERY_COMPILATION_GAP"]),
    executable_with_remaining_budget: z.literal(true),
    assessment_hash: contentHashSchema,
  }),
});
const readyStopSchema = z.strictObject({
  ...researchStopCommonShape,
  decision: z.literal("STOP_READY"),
});
const partialStopSchema = z.strictObject({
  ...researchStopCommonShape,
  decision: z.literal("STOP_PARTIAL"),
  non_ready_terminal: z.literal("PARTIAL"),
  partial_disclosure_codes: uniqueIdentifierArraySchema(1, U6_WIRE_LIMITS.max_required_disclosures),
});
const needsMoreStopSchema = z.strictObject({
  ...researchStopCommonShape,
  decision: z.literal("STOP_NEEDS_MORE_RESEARCH"),
  non_ready_terminal: z.literal("NEEDS_MORE_RESEARCH"),
  resume_requirement_codes: uniqueIdentifierArraySchema(1, U6_WIRE_LIMITS.max_required_disclosures),
});
const inconclusiveStopSchema = z.strictObject({
  ...researchStopCommonShape,
  decision: z.literal("STOP_INCONCLUSIVE"),
  non_ready_terminal: z.literal("INCONCLUSIVE"),
  inadmissibility_summary_hash: contentHashSchema,
});

export const researchStopDecisionPayloadSchema = z
  .discriminatedUnion("decision", [
    continueStopSchema,
    replanStopSchema,
    readyStopSchema,
    partialStopSchema,
    needsMoreStopSchema,
    inconclusiveStopSchema,
  ])
  .superRefine((decision, ctx) => {
    addUniqueIssues(
      decision.candidate_queries,
      ({ query_contract_ref }) => artifactReferenceIdentity(query_contract_ref),
      ctx,
      ["candidate_queries"],
      "同一 QueryContract 只能出现一次。",
    );
    for (const [index, candidate] of decision.candidate_queries.entries()) {
      const fits = demandWithinBalance(candidate.required_budget, decision.budget_ledger.remaining);
      if (
        candidate.admissibility === "EXECUTABLE_NOW" &&
        (candidate.expected_information_gain_microunits === 0 ||
          candidate.waiting_on_codes.length !== 0 ||
          !fits)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "EXECUTABLE_NOW 要求正 EIG、无等待且预算可执行。",
          path: ["candidate_queries", index],
        });
      }
      if (
        candidate.admissibility === "WAITING_EXTERNAL_CAPABILITY" &&
        candidate.waiting_on_codes.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: "WAITING_EXTERNAL_CAPABILITY 必须声明等待条件。",
          path: ["candidate_queries", index, "waiting_on_codes"],
        });
      }
      if (candidate.admissibility === "BUDGET_BLOCKED" && fits) {
        ctx.addIssue({
          code: "custom",
          message: "BUDGET_BLOCKED 的 required_budget 必须超过当前余额。",
          path: ["candidate_queries", index, "required_budget"],
        });
      }
    }

    const unresolved = new Set(
      decision.candidate_set.unresolved_obligation_refs.map(embeddedNodeReferenceIdentity),
    );
    const noCandidate = new Set(
      decision.candidate_set.no_candidate_obligation_refs.map(embeddedNodeReferenceIdentity),
    );
    const assessed = new Set(
      decision.candidate_queries.flatMap(({ obligation_refs }) =>
        obligation_refs.map(embeddedNodeReferenceIdentity),
      ),
    );
    if ([...assessed].some((identity) => !unresolved.has(identity))) {
      ctx.addIssue({
        code: "custom",
        message: "Candidate Assessment 只能覆盖 candidate_set 中的 unresolved Obligation。",
        path: ["candidate_queries"],
      });
    }
    const candidateExpected = [...unresolved].filter((identity) => !noCandidate.has(identity));
    if (
      candidateExpected.length !== assessed.size ||
      candidateExpected.some((identity) => !assessed.has(identity))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Candidate Assessment 覆盖必须严格等于 unresolved 与 no-candidate 的补集。",
        path: ["candidate_set"],
      });
    }

    const executable = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility === "EXECUTABLE_NOW",
    );
    const waiting = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility === "WAITING_EXTERNAL_CAPABILITY",
    );
    const budgetBlocked = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility === "BUDGET_BLOCKED",
    );
    const nonInadmissible = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility !== "INADMISSIBLE",
    );

    if (decision.decision === "CONTINUE") {
      const rankedExecutable = [...executable].sort((left, right) => {
        const eig =
          right.expected_information_gain_microunits - left.expected_information_gain_microunits;
        if (eig !== 0) return eig;
        const leftIdentity = artifactReferenceIdentity(left.query_contract_ref);
        const rightIdentity = artifactReferenceIdentity(right.query_contract_ref);
        return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
      });
      const selected = rankedExecutable[0];
      if (
        !selected ||
        artifactReferenceIdentity(selected.query_contract_ref) !==
          artifactReferenceIdentity(decision.selected_next_query_ref)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "CONTINUE 必须选择稳定排序后的最高 EIG 可执行 Query。",
          path: ["selected_next_query_ref"],
        });
      }
    }
    if (decision.decision === "REPLAN") {
      if (
        executable.length !== 0 ||
        waiting.length !== 0 ||
        budgetBlocked.length !== 0 ||
        unresolved.size === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: "REPLAN 要求无可执行、等待或预算阻塞 Query，且至少一个 unresolved Obligation。",
          path: ["decision"],
        });
      }
      if (
        decision.replan_obligation_refs.some(
          (reference) => !unresolved.has(embeddedNodeReferenceIdentity(reference)),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "REPLAN 只能引用 candidate_set 中的 unresolved Obligation。",
          path: ["replan_obligation_refs"],
        });
      }
    }
    if (decision.decision === "STOP_NEEDS_MORE_RESEARCH") {
      const waitingCodes = new Set(waiting.flatMap(({ waiting_on_codes }) => waiting_on_codes));
      const resumable =
        waiting.length > 0 || (budgetBlocked.length > 0 && decision.budget_ledger.top_up_allowed);
      if (executable.length !== 0 || !resumable) {
        ctx.addIssue({
          code: "custom",
          message: "NEEDS_MORE_RESEARCH 要求无可执行 Query，并存在等待条件或可补充预算的路径。",
          path: ["decision"],
        });
      }
      if ([...waitingCodes].some((code) => !decision.resume_requirement_codes.includes(code))) {
        ctx.addIssue({
          code: "custom",
          message: "Resume Requirement 必须覆盖全部等待条件。",
          path: ["resume_requirement_codes"],
        });
      }
    }
    if (decision.decision === "STOP_PARTIAL") {
      const supportedSubsetIsDeliverable =
        decision.supported_subset.claim_refs.length > 0 &&
        decision.supported_subset.support_decision_refs.length > 0 &&
        decision.supported_subset.claim_refs.length ===
          decision.supported_subset.support_decision_refs.length &&
        decision.supported_subset.required_disclosures.length > 0;
      if (
        executable.length !== 0 ||
        waiting.length !== 0 ||
        decision.budget_ledger.top_up_allowed ||
        budgetBlocked.length === 0 ||
        nonInadmissible.some(({ admissibility }) => admissibility !== "BUDGET_BLOCKED") ||
        unresolved.size === 0 ||
        !supportedSubsetIsDeliverable
      ) {
        ctx.addIssue({
          code: "custom",
          message: "PARTIAL 要求硬预算封顶、仅余预算阻塞路径和非空可交付 Supported Subset。",
          path: ["decision"],
        });
      }
    }
    if (
      decision.decision === "STOP_INCONCLUSIVE" &&
      (unresolved.size === 0 ||
        decision.candidate_queries.some(({ admissibility }) => admissibility !== "INADMISSIBLE"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "INCONCLUSIVE 要求存在 unresolved Obligation，且全部 Candidate 均不可采纳。",
        path: ["decision"],
      });
    }
  });

export type CandidateQueryAssessment = z.infer<typeof candidateQueryAssessmentSchema>;
export type SupportedSubsetBinding = z.infer<typeof supportedSubsetBindingSchema>;
export type ResearchStopDecisionPayload = z.infer<typeof researchStopDecisionPayloadSchema>;
