import type { SemanticContextCommitResult } from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import { FALCON24_AGENT_ANALYSIS_CASES } from "@data-agent/evals";

type Falcon24CaseId = Falcon24AgentAnalysisCase["case_id"];

/**
 * These are semantic identities, not words from the user question. The Root Agent
 * has already selected the analysis capability; this resolver only selects one
 * registered AnalysisProgram from the frozen semantic retrieval result.
 */
const CASE_ANCHORS = Object.freeze({
  "falcon24-business-review-18m": [
    "metric.active_buyers",
    "metric.average_order_value",
    "metric.order_revenue",
  ],
  "falcon24-delivery-experience-12m": ["metric.delivery_minutes", "metric.low_rating_rate"],
  "falcon24-inventory-damage-12m": ["metric.damaged_stock", "metric.stock_received"],
  "falcon24-marketing-lag-effect": ["metric.marketing_spend", "metric.marketing_revenue"],
  "falcon24-cohort-retention-m0-m6": ["metric.cohort_retention", "metric.repeat_purchase_rate"],
} as const satisfies Readonly<Record<Falcon24CaseId, readonly string[]>>);

function semanticClosure(packageDocument: SemanticContextCommitResult["package"]): Set<string> {
  return new Set([
    ...packageDocument.mandatory_closure.object_ids,
    ...packageDocument.mandatory_closure.relationship_ids,
    ...packageDocument.evidence.map(({ evidence_id: evidenceId }) => evidenceId),
  ]);
}

function hitRankByObject(
  packageDocument: SemanticContextCommitResult["package"],
): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const hit of packageDocument.retrieval_receipt.hits) {
    ranks.set(
      hit.object_id,
      Math.min(ranks.get(hit.object_id) ?? Number.MAX_SAFE_INTEGER, hit.rank),
    );
  }
  return ranks;
}

export function resolveFalcon24AnalysisCase(
  packageDocument: SemanticContextCommitResult["package"],
): Falcon24AgentAnalysisCase {
  if (packageDocument.semantic_domain !== "falcon24") {
    throw new TypeError("GOVERNED_ANALYSIS_DOMAIN_UNSUPPORTED");
  }
  const available = semanticClosure(packageDocument);
  const eligible = FALCON24_AGENT_ANALYSIS_CASES.filter((testCase) =>
    testCase.required_semantic_keys.every((key) => available.has(key)),
  );
  if (eligible.length === 1 && eligible[0]) return eligible[0];

  const ranks = hitRankByObject(packageDocument);
  const ranked = FALCON24_AGENT_ANALYSIS_CASES.map((testCase) => {
    const anchors = CASE_ANCHORS[testCase.case_id];
    const matchedAnchors = anchors.filter((anchor) => available.has(anchor));
    const bestHitRank = Math.min(...anchors.map((anchor) => ranks.get(anchor) ?? Infinity));
    return { testCase, matchedAnchors: matchedAnchors.length, bestHitRank };
  })
    .filter(({ matchedAnchors }) => matchedAnchors > 0)
    .sort(
      (left, right) =>
        left.bestHitRank - right.bestHitRank ||
        right.matchedAnchors - left.matchedAnchors ||
        left.testCase.case_id.localeCompare(right.testCase.case_id),
    );
  const selected = ranked[0];
  const next = ranked[1];
  if (
    !selected ||
    (next &&
      next.bestHitRank === selected.bestHitRank &&
      next.matchedAnchors === selected.matchedAnchors)
  ) {
    throw new TypeError("GOVERNED_ANALYSIS_SEMANTIC_PROGRAM_AMBIGUOUS");
  }
  return selected.testCase;
}

export const falcon24AnalysisCaseResolverInternals = Object.freeze({
  case_anchors: CASE_ANCHORS,
  semanticClosure,
});
