"use client";

import { useState } from "react";
import { SqlReceiptCard } from "@/components/sql-receipt-card";
import { WorkbenchSection } from "@/components/workbench-section";
import type { Hypothesis } from "@/lib/run-projection";
import { useWorkbenchStore } from "@/lib/workbench-store";

const hypothesisStatusLabel: Record<string, string> = {
  PROPOSED: "待验证",
  TESTING: "验证中",
  SUPPORTED: "已验证",
  REFUTED: "已排除",
  INCONCLUSIVE: "无结论",
};

const hypothesisStatusColor: Record<string, string> = {
  PROPOSED:
    "rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  TESTING:
    "rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SUPPORTED:
    "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  REFUTED:
    "rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400",
  INCONCLUSIVE:
    "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

function HypothesisCard({ hypothesis }: { hypothesis: Hypothesis }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)]"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={hypothesisStatusColor[hypothesis.status]}>
            {hypothesisStatusLabel[hypothesis.status]}
          </span>
          <span className="text-sm font-medium truncate">{hypothesis.statement}</span>
        </div>
        <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
          {expanded ? "收起" : "展开"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-4">
          {/* SQL */}
          {hypothesis.sql && <SqlReceiptCard hypothesis={hypothesis} />}

          {/* 证据 */}
          {hypothesis.evidence && hypothesis.evidence.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                证据
              </h4>
              <div className="space-y-2">
                {hypothesis.evidence.map((ev, _i) => (
                  <div
                    key={ev.claim}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{ev.claim}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          ev.support === "SUPPORT"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : ev.support === "REFUTE"
                              ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        }`}
                      >
                        {ev.support === "SUPPORT"
                          ? "支持"
                          : ev.support === "REFUTE"
                            ? "反驳"
                            : "中性"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      {ev.evidence} · 来源: {ev.source}
                      {ev.confidence &&
                        ` · 置信度: ${ev.confidence === "HIGH" ? "高" : ev.confidence === "MEDIUM" ? "中" : "低"}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 冲突 */}
          {hypothesis.conflicts && hypothesis.conflicts.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                冲突
              </h4>
              {hypothesis.conflicts.map((conflict, _i) => (
                <div
                  key={conflict.description}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20"
                >
                  <span className="text-amber-800 dark:text-amber-300">{conflict.description}</span>
                  <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                    (
                    {conflict.type === "DIRECT"
                      ? "直接冲突"
                      : conflict.type === "PARTIAL"
                        ? "部分冲突"
                        : "条件冲突"}
                    )
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 限制 */}
          {hypothesis.limitations && hypothesis.limitations.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                限制
              </h4>
              <ul className="list-inside list-disc space-y-1 text-xs text-[var(--color-text-tertiary)]">
                {hypothesis.limitations.map((lim, _i) => (
                  <li key={lim}>{lim}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HypothesisSection() {
  const sectionStatus = useWorkbenchStore((s) => s.sections.hypothesis);
  const hypotheses = useWorkbenchStore((s) => s.projection?.hypothesis ?? []);

  return (
    <WorkbenchSection title="假设 · 探索" status={sectionStatus}>
      <div className="space-y-3">
        {hypotheses.map((hypothesis) => (
          <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} />
        ))}
      </div>
    </WorkbenchSection>
  );
}
