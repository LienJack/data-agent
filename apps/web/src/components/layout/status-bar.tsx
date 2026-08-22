"use client";

import { Circle, SpinnerGap } from "@phosphor-icons/react";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import type { RunConnectionState } from "@/lib/run-projection";
import { useWorkbenchStore } from "@/lib/workbench-store";

/**
 * 紧凑底部状态栏 — 参考 DataFoundry TUI 的 StatusBar 设计。
 *
 * 显示连接状态、数据源、模型信息，始终固定在页面底部。
 */
export function StatusBar({ className = "" }: { readonly className?: string }) {
  const { t } = useWorkspaceI18n();
  const connection = useWorkbenchStore((s) => s.connection);
  const activeRunId = useWorkbenchStore((s) => s.activeRunId);
  const projection = useWorkbenchStore((s) => s.projection);

  const statusDisplay = statusConfig(connection);
  const datasourceId = projection?.scope?.dataset ?? "—";
  const runId = activeRunId;

  return (
    <footer
      className={`flex h-7 shrink-0 items-center justify-between border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 ${className}`}
    >
      <div className="flex items-center gap-1.5">
        {statusDisplay.spinning ? (
          <SpinnerGap
            aria-hidden="true"
            className="animate-spin"
            color={statusDisplay.color}
            size={12}
          />
        ) : (
          <Circle aria-hidden="true" color={statusDisplay.color} size={9} weight="fill" />
        )}
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {t(statusDisplay.labelKey)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {datasourceId && datasourceId !== "—" && (
          <>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {t("status.source")}:
            </span>
            <span className="max-w-[160px] truncate text-[11px] text-[var(--color-text-primary)]">
              {datasourceId}
            </span>
          </>
        )}
        {runId && (
          <>
            <span className="hidden text-[11px] text-[var(--color-text-muted)] sm:inline">
              {t("status.run")}:
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
  labelKey: MessageKey;
  color: string;
  spinning: boolean;
}

function statusConfig(connection: RunConnectionState): StatusConfig {
  switch (connection) {
    case "live":
      return { labelKey: "status.live", color: "var(--color-success)", spinning: false };
    case "connecting":
      return { labelKey: "status.connecting", color: "var(--color-warning)", spinning: true };
    case "reconnecting":
      return { labelKey: "status.reconnecting", color: "var(--color-warning)", spinning: true };
    case "closed":
      return { labelKey: "status.closed", color: "var(--color-text-muted)", spinning: false };
    default:
      return { labelKey: "status.ready", color: "var(--color-success)", spinning: false };
  }
}
