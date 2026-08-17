"use client";

import type { RunConnectionState } from "@/lib/run-projection";
import { useWorkbenchStore } from "@/lib/workbench-store";

/**
 * 紧凑底部状态栏 — 参考 DataFoundry TUI 的 StatusBar 设计。
 *
 * 显示连接状态、数据源、模型信息，始终固定在页面底部。
 */
export function StatusBar() {
  const connection = useWorkbenchStore((s) => s.connection);
  const activeRunId = useWorkbenchStore((s) => s.activeRunId);
  const projection = useWorkbenchStore((s) => s.projection);

  const statusDisplay = statusConfig(connection);
  const datasourceId = projection?.scope?.dataset ?? "—";
  const runId = activeRunId;

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px]" style={{ color: statusDisplay.color }}>
          {statusDisplay.icon}
        </span>
        <span className="text-[11px] text-[var(--color-text-muted)]">{statusDisplay.label}</span>
      </div>

      <div className="flex items-center gap-3">
        {datasourceId && datasourceId !== "—" && (
          <>
            <span className="text-[11px] text-[var(--color-text-muted)]">source:</span>
            <span className="max-w-[160px] truncate text-[11px] text-[var(--color-text-primary)]">
              {datasourceId}
            </span>
          </>
        )}
        {runId && (
          <>
            <span className="hidden text-[11px] text-[var(--color-text-muted)] sm:inline">
              run:
            </span>
            <span className="hidden max-w-[120px] truncate text-[11px] text-[var(--color-text-primary)] sm:inline">
              {runId.slice(0, 12)}
            </span>
          </>
        )}
        <span className="text-[11px] text-[var(--color-text-muted)]">Data Agent</span>
      </div>
    </footer>
  );
}

interface StatusConfig {
  label: string;
  color: string;
  icon: string;
}

function statusConfig(connection: RunConnectionState): StatusConfig {
  switch (connection) {
    case "live":
      return { label: "Live", color: "#88C980", icon: "●" };
    case "connecting":
      return { label: "Connecting", color: "#D8B76A", icon: "◐" };
    case "reconnecting":
      return { label: "Reconnecting", color: "#D8B76A", icon: "◐" };
    case "closed":
      return { label: "Closed", color: "#5F6975", icon: "○" };
    default:
      return { label: "Ready", color: "#88C980", icon: "●" };
  }
}
