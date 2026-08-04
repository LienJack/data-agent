"use client";

import { useWorkbenchStore } from "@/lib/workbench-store";
import { PairedComparison } from "./paired-comparison";
import { WorkbenchSection } from "./workbench-section";

const verdictLabel: Record<string, string> = {
  PASS: "通过",
  FAIL: "失败",
  INCONCLUSIVE: "无结论",
};

const verdictColor: Record<string, string> = {
  PASS: "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  FAIL: "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400",
  INCONCLUSIVE:
    "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

export function EvalSection() {
  const sectionStatus = useWorkbenchStore((s) => s.sections.eval);
  const evalResult = useWorkbenchStore((s) => s.projection?.eval);

  if (!evalResult) {
    return (
      <WorkbenchSection title="评测 · 对比" status={sectionStatus}>
        <p className="text-xs text-[var(--color-text-tertiary)]">暂无评测数据</p>
      </WorkbenchSection>
    );
  }

  return (
    <WorkbenchSection title="评测 · 对比" status={sectionStatus}>
      <div className="space-y-4">
        {/* 总体判定 */}
        <div className="flex items-center justify-between rounded-lg bg-[var(--color-bg-secondary)] p-3">
          <span className="text-sm font-medium">评测套件: {evalResult.suite}</span>
          <span className={verdictColor[evalResult.verdict]}>
            {verdictLabel[evalResult.verdict]}
          </span>
        </div>

        {/* 评分卡 */}
        {evalResult.scoreCard && (
          <div className="flex items-center gap-4 text-sm" aria-label="评分卡">
            <span className="text-[var(--color-text-tertiary)]">
              通过: <span className="font-medium text-[var(--color-success)]">{evalResult.scoreCard.passed}</span>
            </span>
            <span className="text-[var(--color-text-tertiary)]">
              失败: <span className="font-medium text-[var(--color-error)]">{evalResult.scoreCard.failed}</span>
            </span>
            <span className="text-[var(--color-text-tertiary)]">
              总计: <span className="font-medium">{evalResult.scoreCard.total}</span>
            </span>
          </div>
        )}

        {/* 成对对比 */}
        {evalResult.pairedComparison && (
          <PairedComparison
            baseline={evalResult.pairedComparison.baseline}
            candidate={evalResult.pairedComparison.candidate}
            improvement={evalResult.pairedComparison.improvement}
            metrics={evalResult.pairedComparison.metrics}
          />
        )}
      </div>
    </WorkbenchSection>
  );
}
