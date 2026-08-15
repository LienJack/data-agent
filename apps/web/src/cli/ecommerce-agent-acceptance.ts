import { randomUUID } from "node:crypto";
import { SYSTEM_MODEL_DEPLOYMENT_OVERRIDES } from "@data-agent/agent-runtime";
import { executeEcommerceSqlAcceptance } from "../lib/test-center-runtime";

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
    process.env.TEST_CENTER_MODEL_PROVIDER ||= "deepseek";
    process.env.DATA_AGENT_MODEL_PROVIDER_OVERRIDES ||= JSON.stringify(
      SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
    );
    const run = await executeEcommerceSqlAcceptance({
      case_id: process.env.DATA_AGENT_ECOMMERCE_ACCEPTANCE_CASE_ID?.trim() || DEFAULT_CASE_ID,
      idempotency_key:
        process.env.DATA_AGENT_ECOMMERCE_ACCEPTANCE_IDEMPOTENCY_KEY?.trim() || randomUUID(),
      reflection_enabled: process.env.DATA_AGENT_ECOMMERCE_ACCEPTANCE_REFLECTION !== "NO",
    });
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
      cost_micros: attempt?.usage.cost_micros,
      latency_ms: attempt?.latency_ms,
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
