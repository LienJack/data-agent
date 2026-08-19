export type AuthorityState = "LOADING" | "ACTIVE" | "STALE" | "ERROR" | "PERMISSION_DENIED";
export type Verdict = "GO" | "HOLD" | "STOP";
export type RegistrationStatus = "REGISTERED" | "NOT_REGISTERED";

export interface AuthorityStatusBarProps {
  authorityState: AuthorityState;
  coreL2Status: Verdict | "HOLD";
  attributionF9Status: RegistrationStatus;
  fixtureEvidenceStatus: Verdict | "HOLD";
  currentAction: string;
}

const authorityStateLabels: Record<AuthorityState, string> = {
  LOADING: "加载中",
  ACTIVE: "运行中",
  STALE: "已过期",
  ERROR: "错误",
  PERMISSION_DENIED: "权限不足",
};

const authorityStateColors: Record<AuthorityState, string> = {
  LOADING: "status-badge status-badge--inconclusive",
  ACTIVE: "status-badge status-badge--pass",
  STALE: "status-badge status-badge--hold",
  ERROR: "status-badge status-badge--fail",
  PERMISSION_DENIED: "status-badge status-badge--fail",
};

const verdictLabels: Record<string, string> = {
  GO: "GO",
  HOLD: "HOLD",
  STOP: "STOP",
  REGISTERED: "已注册",
  NOT_REGISTERED: "未注册",
};

const verdictColors: Record<string, string> = {
  GO: "status-badge status-badge--pass",
  HOLD: "status-badge status-badge--hold",
  STOP: "status-badge status-badge--fail",
  REGISTERED: "status-badge status-badge--pass",
  NOT_REGISTERED: "status-badge status-badge--not-registered",
};

/**
 * 紧凑型权威状态栏 — 参考 DataFoundry 设计。
 *
 * 信息密度高，去除装饰元素，语义化色彩指示。
 */
export function AuthorityStatusBar({
  authorityState,
  coreL2Status,
  attributionF9Status,
  fixtureEvidenceStatus,
  currentAction,
}: AuthorityStatusBarProps) {
  return (
    <header className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
      <div className="workspace-container">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">
              当前动作:
            </span>
            <span className="text-xs font-medium text-[var(--color-text-primary)]">
              {currentAction}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <section className="flex items-center gap-2 text-[11px]" aria-label="系统状态指示器">
              <span className="text-[var(--color-text-muted)]">Core L2:</span>
              <span className={verdictColors[coreL2Status]}>{verdictLabels[coreL2Status]}</span>
            </section>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[var(--color-text-muted)]">归因 F9:</span>
              <span className={verdictColors[attributionF9Status]}>
                {verdictLabels[attributionF9Status]}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[var(--color-text-muted)]">Fixture:</span>
              <span className={verdictColors[fixtureEvidenceStatus]}>
                {verdictLabels[fixtureEvidenceStatus]}
              </span>
            </div>
            <span className={authorityStateColors[authorityState]}>
              {authorityStateLabels[authorityState]}
            </span>
          </div>
        </div>
      </div>

      {/* 读屏软件 — 当前动作播报 */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {authorityStateLabels[authorityState]} — {currentAction}
      </div>
    </header>
  );
}
