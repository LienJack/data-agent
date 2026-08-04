"use client";

import { useState } from "react";
import { ClaimEvidenceTree } from "@/components/claim-evidence-tree";
import { WorkbenchSection } from "@/components/workbench-section";
import type { Report } from "@/lib/run-projection";
import { useWorkbenchStore } from "@/lib/workbench-store";

function ReportCard({ report }: { report: Report }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--color-border)]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)]"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
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
        <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
          {expanded ? "收起" : "展开"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-4">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{report.summary}</p>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              声明 · 证据
            </h4>
            <ClaimEvidenceTree claims={report.claims} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportSection() {
  const sectionStatus = useWorkbenchStore((s) => s.sections.report);
  const reports = useWorkbenchStore((s) => s.projection?.reports ?? []);

  return (
    <WorkbenchSection title="报告 · 声明 · 证据" status={sectionStatus}>
      <div className="space-y-3">
        {reports.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>
    </WorkbenchSection>
  );
}
