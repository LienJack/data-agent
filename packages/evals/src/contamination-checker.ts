import { createHash } from "node:crypto";
import type { ArtifactReference, AuthoritativeEvalRun } from "@data-agent/contracts";
import type { ContaminationCheckResult, EvalAdapterContext } from "./index.js";

export class HoldoutContaminationChecker {
  async check(
    evalRun: AuthoritativeEvalRun,
    holdoutRegistry: ArtifactReference[],
    _context: EvalAdapterContext,
  ): Promise<ContaminationCheckResult> {
    const details: string[] = [];
    const contaminatedRefs: ArtifactReference[] = [];

    // 检查 holdout registry 中是否有与 evalRun 同源的引用
    for (const ref of holdoutRegistry) {
      // 检查是否引用同一 case
      if (
        ref.artifact_id === evalRun.case_ref.artifact_id &&
        ref.artifact_type === evalRun.case_ref.artifact_type
      ) {
        details.push(`Holdout 注册表包含与 evalRun case_ref 相同的引用：${ref.artifact_id}`);
        contaminatedRefs.push(ref);
      }

      // 检查是否引用同一 eval run
      if (ref.artifact_id === evalRun.eval_run_id && ref.artifact_type === "EvalRun") {
        details.push(`Holdout 注册表包含与 evalRun 相同的引用：${ref.artifact_id}`);
        contaminatedRefs.push(ref);
      }

      // 检查 content_hash 是否匹配（表示数据泄漏）
      if (
        ref.content_hash !==
          "sha256:0000000000000000000000000000000000000000000000000000000000000000" &&
        ref.content_hash === evalRun.eval_run_hash
      ) {
        details.push(`Holdout 注册表包含与 evalRun 相同的内容哈希：${ref.content_hash}`);
        contaminatedRefs.push(ref);
      }
    }

    // 对 evalRun 的 replay trace 做简单哈希检查
    if (evalRun.replay) {
      const traceHash = createHash("sha256")
        .update(
          JSON.stringify({
            trace_id: evalRun.replay.trace.trace_id,
            data_snapshot_hash: evalRun.replay.data_snapshot_hash,
            budget: evalRun.replay.budget,
          }),
        )
        .digest("hex");

      for (const ref of holdoutRegistry) {
        if (ref.content_hash === `sha256:${traceHash}`) {
          details.push(`Holdout 注册表包含与 evalRun trace 相同的内容哈希：${ref.content_hash}`);
          contaminatedRefs.push(ref);
        }
      }
    }

    const isContaminated = contaminatedRefs.length > 0;
    if (!isContaminated) {
      details.push("Holdout 污染检测通过：未发现与 evalRun 重叠的已注册引用。");
    }

    return {
      isContaminated,
      details,
      contaminatedRefs,
    };
  }
}
