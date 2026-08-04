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

export function AuthorityStatusBar({
  authorityState,
  coreL2Status,
  attributionF9Status,
  fixtureEvidenceStatus,
  currentAction,
}: AuthorityStatusBarProps) {
  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Data Agent</h1>
          <span className="text-xs text-[var(--color-text-tertiary)]">分析工作台 · M1</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--color-text-secondary)]">
            当前动作:{" "}
            <span className="font-medium text-[var(--color-text-primary)]">{currentAction}</span>
          </span>
          <span className={authorityStateColors[authorityState]}>
            {authorityStateLabels[authorityState]}
          </span>
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-tertiary)]">Core L2:</span>
            <span className={verdictColors[coreL2Status]}>{verdictLabels[coreL2Status]}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-tertiary)]">归因 F9:</span>
            <span className={verdictColors[attributionF9Status]}>
              {verdictLabels[attributionF9Status]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-tertiary)]">Fixture Evidence:</span>
            <span className={verdictColors[fixtureEvidenceStatus]}>
              {verdictLabels[fixtureEvidenceStatus]}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
