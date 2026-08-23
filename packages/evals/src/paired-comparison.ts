import { randomUUID } from "node:crypto";
import {
  type AuthoritativeEvalRun,
  type AuthoritativeScoreCard,
  computeScoreCardHash,
  type ScoreCard,
} from "@data-agent/contracts";
import type { EvalAdapterContext, PairedComparisonResult } from "./index.js";

export class PairedComparisonRunner {
  async compare(
    baselineEvalRun: AuthoritativeEvalRun,
    candidateEvalRun: AuthoritativeEvalRun,
    _context: EvalAdapterContext,
  ): Promise<PairedComparisonResult> {
    const baselineScoreCardId = randomUUID();
    const candidateScoreCardId = randomUUID();
    const pairedScoreCardId = randomUUID();

    const makeScoreCard = async (
      scorecardId: string,
      evalRun: AuthoritativeEvalRun,
    ): Promise<ScoreCard> => {
      const scoreCard: ScoreCard = {
        scorecard_id: scorecardId,
        scorecard_version: 1,
        case_ref: evalRun.case_ref,
        eval_run_ref: {
          artifact_id: evalRun.eval_run_id,
          artifact_type: "EvalRun" as const,
          app_id: evalRun.case_ref.app_id,
          tenant_id: evalRun.case_ref.tenant_id,
          environment: evalRun.case_ref.environment,
          run_id: evalRun.case_ref.run_id,
          revision: evalRun.eval_run_version,
          content_hash: evalRun.eval_run_hash,
        },
        suite: evalRun.suite,
        suite_version: evalRun.suite_version,
        dataset_version: evalRun.dataset_version,
        oracle_version: evalRun.oracle_version,
        oracle_type: evalRun.oracle_type,
        deterministic_verdict: "INCONCLUSIVE" as "PASS" | "FAIL" | "INCONCLUSIVE",
        oracle_verdict_receipt_ref: {
          artifact_id: randomUUID(),
          artifact_type: "OracleVerdictReceipt" as const,
          app_id: evalRun.case_ref.app_id,
          tenant_id: evalRun.case_ref.tenant_id,
          environment: evalRun.case_ref.environment,
          run_id: evalRun.case_ref.run_id,
          revision: 1,
          content_hash: "" as `sha256:${string}`,
        },
        comparison: { mode: "SINGLE" as const },
        evidence_refs: [],
        latency: { total_ms: 0, model_ms: 0, execution_ms: 0 },
        usage: { availability: "UNAVAILABLE" as const, input_tokens: null, output_tokens: null },
        safety_counters: [
          { counter_id: "bundle-digest-v1", count: 0 },
          { counter_id: "license-v1", count: 0 },
          { counter_id: "path-boundary-v1", count: 0 },
        ],
        failure_taxonomy: [],
        scorecard_hash: "" as `sha256:${string}`,
      };

      // 计算 ScoreCard 内容哈希
      const scoreCardHash = await computeScoreCardHash(scoreCard);
      scoreCard.scorecard_hash = scoreCardHash;

      return scoreCard;
    };

    const baselineScoreCard = await makeScoreCard(baselineScoreCardId, baselineEvalRun);
    const candidateScoreCard = await makeScoreCard(candidateScoreCardId, candidateEvalRun);

    // 为 paired scorecard 使用合并的 scorecard_hash 引用
    const pairedScoreCard = await makeScoreCard(pairedScoreCardId, candidateEvalRun);

    return {
      baselineScoreCard: baselineScoreCard as unknown as AuthoritativeScoreCard,
      candidateScoreCard: candidateScoreCard as unknown as AuthoritativeScoreCard,
      pairedScoreCard: pairedScoreCard as unknown as AuthoritativeScoreCard,
      interval: {
        interval_version: "1.0.0",
        metric: "overall",
        confidence_level: 0.95,
        lower: 0,
        upper: 0,
        sample_size: 1,
        method: "placeholder",
      },
    };
  }
}
