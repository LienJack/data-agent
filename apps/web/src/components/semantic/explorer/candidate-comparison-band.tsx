import type { SemanticExplorerCandidateComparison } from "@data-agent/contracts";

interface CandidateComparisonBandProps {
  readonly comparison: SemanticExplorerCandidateComparison | null;
}

export function CandidateComparisonBand({ comparison }: CandidateComparisonBandProps) {
  if (!comparison) return null;
  const stale = comparison.comparison_state.state === "stale";
  return (
    <section
      aria-label="候选版本对比"
      className={`rounded-lg border px-4 py-3 ${
        stale ? "border-amber-500/40 bg-amber-500/10" : "border-violet-500/40 bg-violet-500/10"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              stale
                ? "bg-amber-500/20 text-amber-800 dark:text-amber-200"
                : "bg-violet-500/20 text-violet-800 dark:text-violet-200"
            }`}
          >
            {stale ? "stale" : "candidate"}
          </span>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            候选对比带（不属于活动对象集合）
          </h2>
        </div>
        <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
          revision {comparison.revision_number}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
        {comparison.diff.summary} · {comparison.diff.operations.length} 个确定性操作
      </p>
      <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
        candidate {comparison.candidate_id} · revision {comparison.revision_id}
      </p>
      {stale ? (
        <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
          漂移原因：{comparison.comparison_state.reason_code}。此候选不会进入 published
          counts、graph 或 runtime。
        </p>
      ) : (
        <p className="mt-2 text-xs text-violet-800 dark:text-violet-200">
          仅供比较；审批、发布和回滚均不在 Explorer 中执行。
        </p>
      )}
    </section>
  );
}
