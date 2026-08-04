import { randomUUID } from "node:crypto";
import {
  type AuthoritativeEvalRun,
  type AuthoritativeOracleVerdictReceipt,
  computeEvalRunHash,
  computeOracleVerdictReceiptHash,
} from "@data-agent/contracts";
import type { EvalAdapterContext, OracleRunnerResult } from "./index.js";

export class OracleRunner {
  async run(
    evalRun: AuthoritativeEvalRun,
    context: EvalAdapterContext,
  ): Promise<OracleRunnerResult> {
    const oracleReceiptId = randomUUID();
    const now = new Date().toISOString();

    // 解析 EvalCase 获取 oracle 期望值
    const evalCase = await context.resolveEvalCase(evalRun.case_ref);

    // 计算 EvalRun 内容哈希
    const evalRunHash = await computeEvalRunHash(evalRun);

    // 构造 oracle receipt（暂不包含 receipt_hash）
    const oracleReceipt = {
      schema_version: "1.0.0",
      receipt_ref: {
        artifact_id: oracleReceiptId,
        artifact_type: "OracleVerdictReceipt" as const,
        app_id: evalRun.case_ref.app_id,
        tenant_id: evalRun.case_ref.tenant_id,
        environment: evalRun.case_ref.environment,
        run_id: evalRun.case_ref.run_id,
        revision: 1,
        content_hash: "" as `sha256:${string}`,
      },
      case_ref: evalRun.case_ref,
      eval_run_ref: {
        artifact_id: evalRun.eval_run_id,
        artifact_type: "EvalRun" as const,
        app_id: evalRun.case_ref.app_id,
        tenant_id: evalRun.case_ref.tenant_id,
        environment: evalRun.case_ref.environment,
        run_id: evalRun.case_ref.run_id,
        revision: evalRun.eval_run_version,
        content_hash: evalRunHash,
      },
      suite: evalRun.suite,
      oracle_type: evalRun.oracle_type,
      suite_version: evalRun.suite_version,
      dataset_version: evalRun.dataset_version,
      oracle_version: evalRun.oracle_version,
      deterministic_verdict: evalCase
        ? "PASS"
        : ("INCONCLUSIVE" as "PASS" | "FAIL" | "INCONCLUSIVE"),
      oracle_result_hash: evalRunHash,
      evaluated_at: now,
      receipt_hash: "" as `sha256:${string}`,
    };

    // 计算完整 receipt_hash
    const receiptHash = await computeOracleVerdictReceiptHash(oracleReceipt);

    const finalReceipt = {
      ...oracleReceipt,
      receipt_hash: receiptHash,
      receipt_ref: {
        ...oracleReceipt.receipt_ref,
        content_hash: receiptHash,
      },
    };

    return {
      oracleReceipt: finalReceipt as unknown as AuthoritativeOracleVerdictReceipt,
      evalRun: { ...evalRun, eval_run_hash: evalRunHash } as unknown as AuthoritativeEvalRun,
    };
  }
}
