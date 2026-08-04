"use client";

import { PairedComparison } from "./paired-comparison";
import { WorkbenchSection } from "./workbench-section";
import { useWorkbenchStore } from "@/lib/workbench-store";

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
        {/* 评测概览 */}
        <div className="flex items-center gap-4 rounded-lg bg-[var(--color-bg-secondary)] p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-tertiary)]">评测集:</span>
            <span className="text-sm font-mono font-medium">{evalResult.suite}</span>
          </div>
          <span className={verdictColor[evalResult.verdict]}>
            {verdictLabel[evalResult.verdict]}
          </span>
          {evalResult.scoreCard && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {evalResult.scoreCard.passed}/{evalResult.scoreCard.total} 通过
            </span>
          )}
        </div>

        {/* 评分卡 */}
        {evalResult.scoreCard && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              评分卡
            </h4>
            <div className="flex gap-4">
              <div className="flex-1 rounded-lg border border-[var(--color-border)] p-3 text-center">
                <p className="text-2xl font-bold text-[var(--color-success)]">
                  {evalResult.scoreCard.passed}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)]">通过</p>
              </div>
              <div className="flex-1 rounded-lg border border-[var(--color-border)] p-3 text-center">
                <p className="text-2xl font-bold text-[var(--color-error)]">
                  {evalResult.scoreCard.failed}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)]">失败</p>
              </div>
              <div className="flex-1 rounded-lg border border-[var(--color-border)] p-3 text-center">
                <p className="text-2xl font-bold">{evalResult.scoreCard.total}</p>
                <p className="text-xs text-[var(--color-text-tertiary)]">总数</p>
              </div>
            </div>
          </div>
        )}

        {/* 对比视图 */}
        {evalResult.pairedComparison && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              对比评估
            </h4>
            <PairedComparison {...evalResult.pairedComparison} />
          </div>
        )}
      </div>
    </WorkbenchSection>
  );
}
