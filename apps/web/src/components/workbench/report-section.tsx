"use client";

import { useCallback, useRef, useState } from "react";
import type { Report } from "@/lib/run-projection";
import { useWorkbenchStore } from "@/lib/workbench-store";
import { ClaimEvidenceTree } from "./claim-evidence-tree";
import { WorkbenchSection } from "./workbench-section";

function ReportCard({ report }: { report: Report }) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setExpanded((prev) => !prev);
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const siblings = cardRef.current
          ?.closest("[role='list']")
          ?.querySelectorAll<HTMLButtonElement>("[role='listitem'] > button");
        if (!siblings) return;
        const currentIndex = Array.from(siblings).indexOf(e.currentTarget);
        const nextIndex =
          e.key === "ArrowDown"
            ? Math.min(currentIndex + 1, siblings.length - 1)
            : Math.max(currentIndex - 1, 0);
        siblings[nextIndex]?.focus();
      }
    },
    [],
  );

  return (
    <div ref={cardRef} role="listitem" className="rounded-lg border border-[var(--color-border)]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        aria-controls={`report-content-${report.id}`}
      >
        <div className="min-w-0">
          <span className="text-sm font-medium">{report.title}</span>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            {report.isDemo && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Demo
              </span>
            )}
            <span>v{report.version}</span>
            {report.generatedAt && (
              <span>{new Date(report.generatedAt).toLocaleString("zh-CN")}</span>
            )}
          </div>
        </div>
        <span className="text-xs text-[var(--color-text-tertiary)] shrink-0" aria-hidden="true">
          {expanded ? "收起" : "展开"}
        </span>
      </button>

      {expanded && (
        <div
          id={`report-content-${report.id}`}
          className="border-t border-[var(--color-border)] px-4 py-3 space-y-4"
          role="region"
          aria-label={`${report.title} 详情`}
        >
          <p className="text-sm text-[var(--color-text-secondary)]">{report.summary}</p>
          {report.claims.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                声明与证据
              </h4>
              <ClaimEvidenceTree claims={report.claims} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReportSection() {
  const sectionStatus = useWorkbenchStore((s) => s.sections.report);
  const reports = useWorkbenchStore((s) => s.projection?.reports ?? []);

  if (reports.length === 0 && sectionStatus === "ready") {
    return (
      <WorkbenchSection title="报告 · 分析总结" status="empty">
        <p className="text-xs text-[var(--color-text-tertiary)]">暂无报告数据</p>
      </WorkbenchSection>
    );
  }

  return (
    <WorkbenchSection title="报告 · 分析总结" status={sectionStatus}>
      <div className="space-y-3" role="list" aria-label="报告列表">
        {reports.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>
    </WorkbenchSection>
  );
}
