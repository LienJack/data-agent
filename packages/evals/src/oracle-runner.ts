import { randomUUID } from "node:crypto";
import type {
  AuthoritativeEvalRun,
  AuthoritativeOracleVerdictReceipt,
  OracleVerdictReceipt,
} from "@data-agent/contracts";
import type { EvalAdapterContext, OracleRunnerResult } from "./index.js";

export class OracleRunner {
  async run(
    evalRun: AuthoritativeEvalRun,
    _context: EvalAdapterContext,
  ): Promise<OracleRunnerResult> {
    const oracleReceiptId = randomUUID();
    const now = new Date().toISOString();

    const oracleReceipt = {
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
      suite: evalRun.suite,
      oracle_type: "ATTRIBUTION_MATCH" as const,
      suite_version: evalRun.suite_version,
      dataset_version: evalRun.dataset_version,
      oracle_version: evalRun.oracle_version,
      deterministic_verdict: "INCONCLUSIVE",
      oracle_result_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      evaluated_at: now,
      receipt_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    } as const;

    return {
      oracleReceipt: oracleReceipt as unknown as AuthoritativeOracleVerdictReceipt,
      evalRun,
    };
  }
}
