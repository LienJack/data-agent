"use client";

import { useCallback, useState } from "react";
import type { Hypothesis } from "@/lib/run-projection";

interface SqlReceiptCardProps {
  hypothesis: Hypothesis;
}

export function SqlReceiptCard({ hypothesis }: SqlReceiptCardProps) {
  const [showSql, setShowSql] = useState(false);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setShowSql((prev) => !prev);
    }
  }, []);

  return (
    <div className="space-y-3">
      {/* SQL */}
      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            SQL 查询
          </h4>
          <button
            type="button"
            className="text-xs text-[var(--color-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            onClick={() => setShowSql(!showSql)}
            onKeyDown={handleKeyDown}
            aria-expanded={showSql}
            aria-controls="sql-content"
          >
            {showSql ? "隐藏 SQL" : "显示 SQL"}
          </button>
        </div>
        {showSql && hypothesis.sql && (
          <section id="sql-content" aria-label="SQL 查询内容">
            <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-bg-tertiary)] p-3 text-xs leading-relaxed">
              <code>{hypothesis.sql}</code>
            </pre>
          </section>
        )}
      </div>

      {/* Gate Receipts */}
      {hypothesis.gateReceipts && hypothesis.gateReceipts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            门禁校验
          </h4>
          <div className="space-y-1">
            {hypothesis.gateReceipts.map((receipt) => (
              <div
                key={receipt.gate}
                className="flex items-center justify-between rounded-md bg-[var(--color-bg-secondary)] px-3 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${
                      receipt.passed ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-[var(--color-text-secondary)]">{receipt.gate}</span>
                </div>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {receipt.reason ?? (receipt.passed ? "通过" : "未通过")}
                  {receipt.durationMs != null && ` · ${receipt.durationMs}ms`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Receipts */}
      {hypothesis.executionReceipts && hypothesis.executionReceipts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            执行记录
          </h4>
          <div className="space-y-1">
            {hypothesis.executionReceipts.map((receipt) => (
              <div
                key={receipt.queryId}
                className="rounded-md bg-[var(--color-bg-secondary)] px-3 py-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                    {receipt.queryId}
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {receipt.durationMs}ms · {receipt.rowCount} 行
                  </span>
                </div>
                {receipt.error && (
                  <p className="mt-0.5 text-xs text-red-500" role="alert">
                    {receipt.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
