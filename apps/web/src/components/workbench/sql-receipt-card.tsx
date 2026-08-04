"use client";

import { useState } from "react";
import type { Hypothesis } from "@/lib/run-projection";

interface SqlReceiptCardProps {
  hypothesis: Hypothesis;
}

export function SqlReceiptCard({ hypothesis }: SqlReceiptCardProps) {
  const [showSql, setShowSql] = useState(false);

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
            className="text-xs text-[var(--color-accent)] hover:underline"
            onClick={() => setShowSql(!showSql)}
          >
            {showSql ? "隐藏 SQL" : "显示 SQL"}
          </button>
        </div>
        {showSql && hypothesis.sql && (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-bg-tertiary)] p-3 text-xs leading-relaxed">
            <code>{hypothesis.sql}</code>
          </pre>
        )}
      </div>

      {/* Gate Receipts */}
      {hypothesis.gateReceipts && hypothesis.gateReceipts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            门禁回执
          </h4>
          <div className="space-y-1.5">
            {hypothesis.gateReceipts.map((receipt, _i) => (
              <div
                key={receipt.gate}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${
                      receipt.passed ? "bg-[var(--color-success)]" : "bg-[var(--color-error)]"
                    }`}
                  />
                  <span className="text-xs font-medium">{receipt.gate}</span>
                  {receipt.issuer && (
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {receipt.issuer}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                  {receipt.reason && <span>{receipt.reason}</span>}
                  {receipt.durationMs != null && <span>{receipt.durationMs}ms</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Receipts */}
      {hypothesis.executionReceipts && hypothesis.executionReceipts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            执行回执
          </h4>
          <div className="space-y-2">
            {hypothesis.executionReceipts.map((receipt) => (
              <div
                key={receipt.queryId}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-[var(--color-text-tertiary)]">
                    {receipt.queryId}
                  </span>
                  <span className="text-[var(--color-text-tertiary)]">
                    {receipt.durationMs}ms · {receipt.rowCount} 行
                  </span>
                </div>
                {receipt.astHash && (
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                    AST Hash: <code className="font-mono">{receipt.astHash}</code>
                  </p>
                )}
                {receipt.error && (
                  <p className="mt-1 text-xs text-[var(--color-error)]">错误: {receipt.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
