"use client";

import type { ReportClaim } from "@/lib/run-projection";

interface ClaimEvidenceTreeProps {
  claims: ReportClaim[];
}

const confidenceLabel: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

const confidenceColor: Record<string, string> = {
  HIGH: "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  MEDIUM:
    "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  LOW: "rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export function ClaimEvidenceTree({ claims }: ClaimEvidenceTreeProps) {
  if (claims.length === 0) {
    return <p className="text-xs text-[var(--color-text-tertiary)]">暂无声明与证据</p>;
  }

  return (
    <div className="space-y-3">
      {claims.map((claim, _i) => (
        <div key={claim.statement} className="relative pl-4">
          {/* 连接线 */}
          <div className="absolute left-0 top-0 h-full w-px bg-[var(--color-border)]" />
          <div className="absolute left-0 top-3 size-2 -translate-x-[3px] rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-bg-primary)]" />

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{claim.statement}</p>
              <span className={confidenceColor[claim.confidence]}>
                {confidenceLabel[claim.confidence]}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{claim.evidence}</p>
            {claim.supportingSources && claim.supportingSources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {claim.supportingSources.map((src) => (
                  <span
                    key={src}
                    className="rounded bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-xs font-mono text-[var(--color-text-tertiary)]"
                  >
                    {src}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
