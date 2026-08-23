import { randomUUID } from "node:crypto";
import { SYSTEM_MODEL_DEPLOYMENT_OVERRIDES } from "@data-agent/agent-runtime";
import { CERTIFIED_MODEL_SQL_AGENT_ID } from "@data-agent/contracts";
import { loadEcommerceDeterministicAnalysisSuite } from "@data-agent/evals";
import { executeTestCenterRun } from "../lib/test-center-runtime";

const CONFIRMATION = "DATA_AGENT_ALLOW_ECOMMERCE_AGENT_ACCEPTANCE";
const DEFAULT_CASE_ID = "ec100000-0000-4000-8000-000000000004";

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (process.env[CONFIRMATION]?.trim() !== "YES") {
  report({
    schema_version: "ecommerce-agent-acceptance-result@1.0.0",
    terminal: "NOT_RUN",
    reason_code: "EXPLICIT_CONFIRMATION_REQUIRED",
    confirmation_variable: CONFIRMATION,
  });
  process.exitCode = 2;
} else {
  try {
    const deterministicSuite = await loadEcommerceDeterministicAnalysisSuite();
    process.env.TEST_CENTER_MODEL_PROVIDER ||= "deepseek";
    process.env.DATA_AGENT_MODEL_PROVIDER_OVERRIDES ||= JSON.stringify(
      SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
    );
    const caseId = process.env.DATA_AGENT_ECOMMERCE_ACCEPTANCE_CASE_ID?.trim() || DEFAULT_CASE_ID;
    const reflectionEnabled = process.env.DATA_AGENT_ECOMMERCE_ACCEPTANCE_REFLECTION !== "NO";
    const run = await executeTestCenterRun(
      {
        suite_id: "ecommerce-production",
        suite_version: "1.0.0",
        case_ids: [caseId],
        agent_id: CERTIFIED_MODEL_SQL_AGENT_ID,
        reflection_enabled: reflectionEnabled,
        seed: 20260815,
        budget: {
          max_cases: 1,
          max_attempts_per_case: reflectionEnabled ? 2 : 1,
          max_case_duration_ms: 120_000,
          max_batch_duration_ms: 240_000,
          max_output_tokens_per_attempt: 4_096,
          concurrency: 1,
        },
      },
      process.env.DATA_AGENT_ECOMMERCE_ACCEPTANCE_IDEMPOTENCY_KEY?.trim() || randomUUID(),
    );
    const attempt = run.case_runs[0]?.attempts.at(-1);
    report({
      schema_version: "ecommerce-agent-acceptance-result@1.0.0",
      terminal: run.status,
      batch_run_id: run.batch_run_id,
      case_id: run.case_runs[0]?.case_id,
      verdict: attempt?.verdict,
      answer_hash: attempt?.answer_hash,
      oracle_receipt_hash: attempt?.oracle_feedback.oracle_receipt_hash,
      scorecard_hash: run.scorecard?.scorecard_hash,
      post_reflection_pass_rate: run.scorecard?.post_reflection_pass_rate,
      usage_availability: attempt?.usage.availability,
      latency_ms: attempt?.latency_ms,
      deterministic_analysis_suite: {
        version: deterministicSuite.manifest.suite_version,
        manifest_hash: deterministicSuite.manifest.manifest_hash,
        case_count: deterministicSuite.manifest.case_count,
        minimum_score: deterministicSuite.manifest.minimum_score,
        hard_fail_on_any_case: deterministicSuite.manifest.hard_fail_on_any_case,
        release_readiness: deterministicSuite.manifest.readiness,
        release_readiness_reason: deterministicSuite.manifest.readiness_reason,
      },
    });
  } catch (error) {
    report({
      schema_version: "ecommerce-agent-acceptance-result@1.0.0",
      terminal: "HOLD",
      reason_code:
        error instanceof Error && "code" in error
          ? error.code
          : "ECOMMERCE_AGENT_ACCEPTANCE_FAILED",
      message: error instanceof Error ? error.message : "E-commerce Agent 验收失败。",
    });
    process.exitCode = 2;
  }
}
