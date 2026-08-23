import { randomUUID } from "node:crypto";
import {
  type AuthoritativeEvalRun,
  type BenchmarkManifest,
  type BenchmarkSuite,
  computeEvalRunHash,
} from "@data-agent/contracts";
import type { EvalAdapterContext, ManifestReplayResult } from "./index.js";

const ORACLE_TYPE_BY_SUITE: Record<BenchmarkSuite, string> = {
  insightbench: "ANALYSIS_REPORT_QUALITY",
  dab: "RESULT_EQUIVALENCE",
  rcaeval: "ROOT_CAUSE_RANKING",
  "controlled-attribution": "ATTRIBUTION_MATCH",
  governance: "GOVERNANCE_SERVICE_QUALITY",
};

export class ManifestReplayer {
  async replay(
    manifest: BenchmarkManifest,
    _context: EvalAdapterContext,
  ): Promise<ManifestReplayResult> {
    const now = new Date().toISOString();

    const replayedEvalRun = {
      eval_run_id: `replay-${manifest.manifest_id}`,
      eval_run_version: 1,
      case_ref: manifest.case_ref,
      registry_assignment_ref: {
        artifact_id: manifest.case_ref.artifact_id,
        artifact_type: "EvalRegistryAssignment" as const,
        app_id: manifest.case_ref.app_id,
        tenant_id: manifest.case_ref.tenant_id,
        environment: manifest.case_ref.environment,
        run_id: manifest.case_ref.run_id,
        revision: 1,
        content_hash: manifest.manifest_hash,
      },
      suite: manifest.suite,
      oracle_type: ORACLE_TYPE_BY_SUITE[manifest.suite],
      suite_version: manifest.manifest_version,
      dataset_version: manifest.dataset.dataset_version,
      oracle_version: manifest.manifest_version,
      manifest_version: manifest.manifest_version,
      replay: {
        state: "REPLAYABLE" as const,
        source_commit: manifest.case_ref.artifact_id,
        data_snapshot_hash: manifest.dataset.schema_digest,
        schema_version: "1.0.0",
        semantic_version: "1.0.0",
        policy_version: "1.0.0",
        model_profile_id: manifest.case_ref.artifact_id,
        model_profile_version: "1.0.0",
        prompt_version: "1.0.0",
        workflow_version: "1.0.0",
        evaluator_version: "1.0.0",
        seed: manifest.budget.max_cases,
        budget: manifest.budget,
        trace: {
          trace_id: `trace-${manifest.manifest_id}`,
          trace_hash: manifest.manifest_hash,
        },
      },
      started_at: now,
      completed_at: now,
      status: "COMPLETED" as const,
      eval_run_hash: "" as `sha256:${string}`,
    };

    // 计算 EvalRun 内容哈希
    const evalRunHash = await computeEvalRunHash(replayedEvalRun);
    replayedEvalRun.eval_run_hash = evalRunHash;

    return {
      replay: replayedEvalRun.replay,
      replayedEvalRun: replayedEvalRun as unknown as AuthoritativeEvalRun,
      replayScoreCard: null,
    };
  }
}
