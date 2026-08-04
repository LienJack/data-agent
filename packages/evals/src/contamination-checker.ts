import type { ArtifactReference, AuthoritativeEvalRun } from "@data-agent/contracts";
import type { ContaminationCheckResult, EvalAdapterContext } from "./index.js";

export class HoldoutContaminationChecker {
  async check(
    _evalRun: AuthoritativeEvalRun,
    _holdoutRegistry: ArtifactReference[],
    _context: EvalAdapterContext,
  ): Promise<ContaminationCheckResult> {
    return {
      isContaminated: false,
      details: ["Holdout 污染检测尚未接入真实实现"],
      contaminatedRefs: [],
    };
  }
}
