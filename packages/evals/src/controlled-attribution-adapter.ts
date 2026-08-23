import { randomUUID } from "node:crypto";
import type {
  AuthoritativeEvalCase,
  AuthoritativeEvalRun,
  AuthoritativeOracleVerdictReceipt,
  AuthoritativeScoreCard,
  EvalRun,
  OracleVerdictReceipt,
  ScoreCard,
} from "@data-agent/contracts";
import type { EvalAdapterContext, EvalAdapterResult } from "./index.js";

export class ControlledAttributionAdapter {
  readonly suite = "controlled-attribution" as const;
  readonly suite_version = "1.0.0";
  readonly oracle_type = "ATTRIBUTION_MATCH" as const;

  async run(
    evalCase: AuthoritativeEvalCase,
    _context: EvalAdapterContext,
  ): Promise<EvalAdapterResult> {
    const evalRunId = randomUUID();
    const scoreCardId = randomUUID();
    const oracleReceiptId = randomUUID();
    const now = new Date().toISOString();

    const evalRun: EvalRun = {
      eval_run_id: evalRunId,
      eval_run_version: 1,
      case_ref: {
        artifact_id: evalCase.case_id,
        artifact_type: "EvalCase",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: evalCase.case_hash,
      },
      registry_assignment_ref: {
        artifact_id: evalCase.case_id,
        artifact_type: "EvalRegistryAssignment",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      suite: "controlled-attribution",
      suite_version: "1.0.0",
      dataset_version: evalCase.dataset_version,
      oracle_version: evalCase.oracle_version,
      oracle_type: "ATTRIBUTION_MATCH",
      manifest_version: "1.0.0",
      replay: {
        state: "REPLAYABLE",
        source_commit: evalCase.source_commit,
        data_snapshot_hash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        schema_version: "1.0.0",
        semantic_version: "1.0.0",
        policy_version: "1.0.0",
        model_profile_id: evalCase.case_id,
        model_profile_version: "1.0.0",
        prompt_version: "1.0.0",
        workflow_version: "1.0.0",
        evaluator_version: "1.0.0",
        seed: 42,
        budget: { max_cases: 1, max_duration_ms: 600000 },
        trace: {
          trace_id: `trace-${evalRunId}`,
          trace_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
      started_at: now,
      completed_at: now,
      status: "COMPLETED",
      eval_run_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };

    const oracleReceipt: OracleVerdictReceipt = {
      schema_version: "1.0.0",
      receipt_ref: {
        artifact_id: oracleReceiptId,
        artifact_type: "OracleVerdictReceipt",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      case_ref: {
        artifact_id: evalCase.case_id,
        artifact_type: "EvalCase",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: evalCase.case_hash,
      },
      eval_run_ref: {
        artifact_id: evalRunId,
        artifact_type: "EvalRun",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      suite: "controlled-attribution",
      oracle_type: "ATTRIBUTION_MATCH" as const,
      suite_version: "1.0.0",
      dataset_version: evalCase.dataset_version,
      oracle_version: evalCase.oracle_version,
      deterministic_verdict: "INCONCLUSIVE",
      oracle_result_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      evaluated_at: now,
      receipt_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };

    const scoreCard: ScoreCard = {
      scorecard_id: scoreCardId,
      scorecard_version: 1,
      case_ref: {
        artifact_id: evalCase.case_id,
        artifact_type: "EvalCase",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: evalCase.case_hash,
      },
      eval_run_ref: {
        artifact_id: evalRunId,
        artifact_type: "EvalRun",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      suite: "controlled-attribution",
      suite_version: "1.0.0",
      dataset_version: evalCase.dataset_version,
      oracle_version: evalCase.oracle_version,
      oracle_type: "ATTRIBUTION_MATCH" as const,
      deterministic_verdict: "INCONCLUSIVE",
      oracle_verdict_receipt_ref: {
        artifact_id: oracleReceiptId,
        artifact_type: "OracleVerdictReceipt",
        app_id: evalCase.case_id,
        tenant_id: "default",
        environment: "research",
        run_id: evalCase.case_id,
        revision: 1,
        content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      comparison: { mode: "SINGLE" },
      evidence_refs: [],
      latency: { total_ms: 0, model_ms: 0, execution_ms: 0 },
      usage: { availability: "UNAVAILABLE", input_tokens: null, output_tokens: null },
      safety_counters: [
        { counter_id: "bundle-digest-v1", count: 0 },
        { counter_id: "license-v1", count: 0 },
        { counter_id: "path-boundary-v1", count: 0 },
      ],
      failure_taxonomy: [],
      scorecard_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };

    return {
      scoreCard: scoreCard as unknown as AuthoritativeScoreCard,
      oracleReceipt: oracleReceipt as unknown as AuthoritativeOracleVerdictReceipt,
      evalRun: evalRun as unknown as AuthoritativeEvalRun,
    };
  }

  async oracle(
    evalRun: AuthoritativeEvalRun,
    _context: EvalAdapterContext,
  ): Promise<AuthoritativeOracleVerdictReceipt> {
    const oracleReceiptId = randomUUID();
    const now = new Date().toISOString();

    const oracleReceipt: OracleVerdictReceipt = {
      schema_version: "1.0.0",
      receipt_ref: {
        artifact_id: oracleReceiptId,
        artifact_type: "OracleVerdictReceipt",
        app_id: evalRun.case_ref.app_id,
        tenant_id: evalRun.case_ref.tenant_id,
        environment: evalRun.case_ref.environment,
        run_id: evalRun.case_ref.run_id,
        revision: 1,
        content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      case_ref: evalRun.case_ref,
      eval_run_ref: {
        artifact_id: evalRun.eval_run_id,
        artifact_type: "EvalRun",
        app_id: evalRun.case_ref.app_id,
        tenant_id: evalRun.case_ref.tenant_id,
        environment: evalRun.case_ref.environment,
        run_id: evalRun.case_ref.run_id,
        revision: evalRun.eval_run_version,
        content_hash: evalRun.eval_run_hash,
      },
      suite: "controlled-attribution",
      oracle_type: "ATTRIBUTION_MATCH" as const,
      suite_version: evalRun.suite_version,
      dataset_version: evalRun.dataset_version,
      oracle_version: evalRun.oracle_version,
      deterministic_verdict: "INCONCLUSIVE",
      oracle_result_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      evaluated_at: now,
      receipt_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };

    return oracleReceipt as unknown as AuthoritativeOracleVerdictReceipt;
  }
}
