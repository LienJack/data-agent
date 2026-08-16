"use client";

import type {
  AdminUserProjection,
  AdminWorkspaceProjection,
  IdentityOperationReceipt,
  OperationsHealthGate,
  OperationsHealthProjection,
} from "@data-agent/contracts";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { visibleOperationsHealthGates } from "@/lib/billing-ui-policy";

interface OperationsAdminPanelProps {
  readonly currentPrincipalId: string;
  readonly billingUiEnabled: boolean;
}

type PanelTab = "overview" | "users" | "workspaces";

interface UserMutationResult {
  readonly receipt: IdentityOperationReceipt;
  readonly one_time_password: string | null;
}

interface IdentityRetryRequest {
  readonly path: string;
  readonly body: string;
  readonly label: string;
}

type AdminActionRequest =
  | {
      readonly kind: "USER";
      readonly user: AdminUserProjection;
      readonly action: "DISABLE" | "ENABLE" | "RESET_PASSWORD";
    }
  | {
      readonly kind: "WORKSPACE";
      readonly workspace: AdminWorkspaceProjection;
      readonly action: "ARCHIVE" | "RESTORE";
    };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as {
    readonly data?: T;
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? `请求失败 (${response.status})`);
  }
  return body.data;
}

function operationKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const gateLabels: Readonly<Record<OperationsHealthGate["key"], string>> = {
  IDENTITY_SIDE_EFFECTS: "身份副作用",
  PRICING_SYNC: "价格同步",
  PRICING_REVIEW: "价格审批",
  BILLING_REVIEW: "账单复核",
  BALANCE_INTEGRITY: "余额一致性",
  SHADOW_RECONCILIATION: "影子对账",
};

function gateTone(status: OperationsHealthGate["status"]) {
  if (status === "PASS") {
    return {
      dot: "bg-emerald-500",
      label: "通过",
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (status === "WARNING") {
    return {
      dot: "bg-amber-500",
      label: "注意",
      badge: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }
  return {
    dot: "bg-red-500",
    label: "阻断",
    badge: "border-red-200 bg-red-50 text-red-700",
  };
}

function adminActionCopy(request: AdminActionRequest) {
  if (request.kind === "WORKSPACE") {
    return request.action === "ARCHIVE"
      ? {
          eyebrow: "Archive workspace",
          title: `归档「${request.workspace.display_name}」`,
          description: "归档后将立即拒绝该工作空间的新写入和模型调用，历史数据仍可审计。",
          reasonLabel: "归档原因",
          confirmLabel: "确认归档",
          destructive: true,
        }
      : {
          eyebrow: "Restore workspace",
          title: `恢复「${request.workspace.display_name}」`,
          description: "恢复后，原成员仍需按最新权限版本重新通过数据库授权。",
          reasonLabel: "恢复原因",
          confirmLabel: "确认恢复",
          destructive: false,
        };
  }
  if (request.action === "RESET_PASSWORD") {
    return {
      eyebrow: "Reset credentials",
      title: `重置「${request.user.display_name}」的密码`,
      description: "系统将生成新的一次性密码，并撤销该用户的全部现有会话。",
      reasonLabel: "重置原因",
      confirmLabel: "确认重置",
      destructive: true,
    };
  }
  return request.action === "DISABLE"
    ? {
        eyebrow: "Disable account",
        title: `停用「${request.user.display_name}」`,
        description: "停用会立即提高授权版本并撤销现有会话，用户将无法继续访问工作空间。",
        reasonLabel: "停用原因",
        confirmLabel: "确认停用",
        destructive: true,
      }
    : {
        eyebrow: "Enable account",
        title: `恢复「${request.user.display_name}」`,
        description: "恢复凭证账号后，应用身份仍会由 PostgreSQL 重新验证。",
        reasonLabel: "恢复原因",
        confirmLabel: "确认恢复",
        destructive: false,
      };
}

function Metric(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="border-r border-[var(--color-border-default)] px-5 py-4 first:pl-0 last:border-r-0 last:pr-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
        {props.label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.04em]">{props.value}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{props.detail}</p>
    </div>
  );
}

export function OperationsAdminPanel({
  currentPrincipalId,
  billingUiEnabled,
}: OperationsAdminPanelProps) {
  const [tab, setTab] = useState<PanelTab>("overview");
  const [users, setUsers] = useState<readonly AdminUserProjection[]>([]);
  const [workspaces, setWorkspaces] = useState<readonly AdminWorkspaceProjection[]>([]);
  const [health, setHealth] = useState<OperationsHealthProjection>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [oneTimePassword, setOneTimePassword] = useState<string>();
  const [identityRetry, setIdentityRetry] = useState<IdentityRetryRequest>();
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<"USER" | "SUPER_ADMIN">("USER");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [adminAction, setAdminAction] = useState<AdminActionRequest>();
  const [actionReason, setActionReason] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextUsers, nextWorkspaces, nextHealth] = await Promise.all([
        api<readonly AdminUserProjection[]>("/api/admin/operations/users"),
        api<readonly AdminWorkspaceProjection[]>("/api/admin/operations/workspaces"),
        api<OperationsHealthProjection>("/api/admin/operations/health"),
      ]);
      setUsers(nextUsers);
      setWorkspaces(nextWorkspaces);
      setHealth(nextHealth);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "运维控制面加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void reload(), [reload]);

  const summary = useMemo(() => {
    const gates = visibleOperationsHealthGates(health?.gates ?? [], billingUiEnabled);
    return {
      activeUsers: users.filter((user) => user.status === "ACTIVE").length,
      activeWorkspaces: workspaces.filter((workspace) => workspace.lifecycle === "ACTIVE").length,
      pending: gates.reduce((total, gate) => total + gate.count, 0),
      blocked: gates.filter((gate) => gate.status === "BLOCKED").length,
    };
  }, [billingUiEnabled, health, users, workspaces]);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    setOneTimePassword(undefined);
    setIdentityRetry(undefined);
    try {
      const operationId = crypto.randomUUID();
      const result = await api<UserMutationResult>("/api/admin/operations/users", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "admin-user-create@1.0.0",
          operation_id: operationId,
          idempotency_key: operationKey("admin-user-create"),
          email: userEmail.trim(),
          display_name: userName.trim(),
          system_role: userRole,
        }),
      });
      setUserEmail("");
      setUserName("");
      setOneTimePassword(result.one_time_password ?? undefined);
      setNotice("用户已创建。初始密码仅在本次响应中显示。");
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "用户创建失败");
    } finally {
      setPending(false);
    }
  }

  function requestUserAction(
    user: AdminUserProjection,
    action: "DISABLE" | "ENABLE" | "RESET_PASSWORD",
  ) {
    setActionReason("");
    setAdminAction({ kind: "USER", user, action });
  }

  async function confirmAdminAction(reason: string) {
    if (!adminAction || !reason) return;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    setOneTimePassword(undefined);
    setIdentityRetry(undefined);
    try {
      if (adminAction.kind === "USER") {
        const { action, user } = adminAction;
        const path = `/api/admin/operations/users/${encodeURIComponent(user.principal_id)}`;
        const body = JSON.stringify({
          schema_version: "admin-user-action@1.0.0",
          operation_id: crypto.randomUUID(),
          idempotency_key: operationKey(`admin-user-${action.toLowerCase()}`),
          principal_id: user.principal_id,
          expected_version: user.authz_epoch,
          action,
          reason,
        });
        const result = await api<UserMutationResult>(path, { method: "PATCH", body });
        setAdminAction(undefined);
        setActionReason("");
        if (result.receipt.status === "RETRY_REQUIRED") {
          setIdentityRetry({
            path,
            body,
            label: action === "RESET_PASSWORD" ? "密码与会话副作用" : "封禁与会话副作用",
          });
          setNotice("应用授权已安全失效，但认证服务副作用尚未完成；请恢复认证服务后重试原操作。");
          await reload();
          return;
        }
        if (result.one_time_password) setOneTimePassword(result.one_time_password);
        setNotice(
          action === "RESET_PASSWORD"
            ? "密码已重置，所有旧会话已撤销。"
            : action === "DISABLE"
              ? "用户已停用，授权版本与会话均已失效。"
              : "用户已恢复使用。",
        );
        await reload();
        return;
      }

      const { action, workspace } = adminAction;
      await api<IdentityOperationReceipt>(
        `/api/admin/operations/workspaces/${encodeURIComponent(workspace.workspace_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            schema_version: "admin-workspace-action@1.0.0",
            operation_id: crypto.randomUUID(),
            idempotency_key: operationKey(`admin-workspace-${action.toLowerCase()}`),
            workspace_id: workspace.workspace_id,
            expected_version: workspace.lifecycle_version,
            action,
            reason,
          }),
        },
      );
      setAdminAction(undefined);
      setActionReason("");
      setNotice(action === "ARCHIVE" ? "工作空间已归档。" : "工作空间已恢复。");
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "管理操作失败");
    } finally {
      setPending(false);
    }
  }

  async function retryIdentitySideEffect() {
    if (!identityRetry) return;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    setOneTimePassword(undefined);
    try {
      const result = await api<UserMutationResult>(identityRetry.path, {
        method: "PATCH",
        body: identityRetry.body,
      });
      if (result.receipt.status === "RETRY_REQUIRED") {
        setNotice("认证副作用仍未完成；原 operation 保持 RETRY_REQUIRED，可继续安全重试。");
      } else {
        setIdentityRetry(undefined);
        if (result.one_time_password) setOneTimePassword(result.one_time_password);
        setNotice("认证副作用已完成，原 operation 已转为 SUCCEEDED。");
      }
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "认证副作用重试失败");
    } finally {
      setPending(false);
    }
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await api<IdentityOperationReceipt>("/api/admin/operations/workspaces", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "admin-workspace-create@1.0.0",
          operation_id: crypto.randomUUID(),
          idempotency_key: operationKey("admin-workspace-create"),
          workspace_id: crypto.randomUUID(),
          slug: workspaceSlug.trim(),
          display_name: workspaceName.trim(),
        }),
      });
      setWorkspaceName("");
      setWorkspaceSlug("");
      setNotice("工作空间已创建，并已为超级管理员建立系统成员关系。");
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "工作空间创建失败");
    } finally {
      setPending(false);
    }
  }

  function requestWorkspaceAction(workspace: AdminWorkspaceProjection) {
    const action = workspace.lifecycle === "ACTIVE" ? "ARCHIVE" : "RESTORE";
    setActionReason("");
    setAdminAction({ kind: "WORKSPACE", workspace, action });
  }

  return (
    <section aria-labelledby="operations-admin-heading" className="space-y-6">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_12%,transparent)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              Organization & operations
            </p>
          </div>
          <h2
            id="operations-admin-heading"
            className="mt-2 text-xl font-semibold tracking-[-0.03em]"
          >
            组织与运维
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            管理全局用户、工作空间与上线健康门。权限和状态均由 PostgreSQL 实时重验。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {health && (
            <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
              {billingUiEnabled && `${health.billing_mode} · epoch ${health.billing_epoch} · `}
              {formatTime(health.generated_at)}
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void reload()}
            disabled={loading || pending}
          >
            刷新状态
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-5 sm:grid-cols-4">
        <Metric
          label="Active users"
          value={String(summary.activeUsers)}
          detail={`${users.length} 个全局账户`}
        />
        <Metric
          label="Workspaces"
          value={String(summary.activeWorkspaces)}
          detail={`${workspaces.length} 个总空间`}
        />
        <Metric label="Open signals" value={String(summary.pending)} detail="待处理运行信号" />
        <Metric
          label="Blocked gates"
          value={String(summary.blocked)}
          detail={summary.blocked === 0 ? "当前可继续上线" : "需要先处理阻断"}
        />
      </div>

      <div
        className="flex items-center gap-1 border-b border-[var(--color-border-default)]"
        role="tablist"
      >
        {(
          [
            ["overview", "运行概览"],
            ["users", `用户 ${users.length}`],
            ["workspaces", `工作空间 ${workspaces.length}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            id={`operations-${value}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`operations-${value}-panel`}
            onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition ${
              tab === value
                ? "border-[var(--color-text-primary)] text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}
      {identityRetry && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold text-amber-900">待重试：{identityRetry.label}</p>
            <p className="mt-1 text-[10px] leading-5 text-amber-800">
              将精确重放同一 operation_id 与 idempotency_key，不会重复修改应用用户状态。
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => void retryIdentitySideEffect()}
          >
            重试认证副作用
          </Button>
        </div>
      )}
      {oneTimePassword && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold text-amber-900">一次性密码</p>
            <p className="mt-1 font-mono text-sm text-amber-950">{oneTimePassword}</p>
            <p className="mt-1 text-[10px] text-amber-700">
              关闭或刷新后不再显示，请通过安全渠道交付。
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(oneTimePassword)}
          >
            复制密码
          </Button>
        </div>
      )}

      <div id={`operations-${tab}-panel`} role="tabpanel" aria-labelledby={`operations-${tab}-tab`}>
        {loading && !health ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border-default)] py-12 text-center text-sm text-[var(--color-text-muted)]">
            正在读取数据库权威状态…
          </div>
        ) : tab === "overview" ? (
          <HealthOverview health={health} onNavigate={setTab} billingUiEnabled={billingUiEnabled} />
        ) : tab === "users" ? (
          <UsersPanel
            users={users}
            currentPrincipalId={currentPrincipalId}
            pending={pending}
            email={userEmail}
            name={userName}
            role={userRole}
            onEmailChange={setUserEmail}
            onNameChange={setUserName}
            onRoleChange={setUserRole}
            onCreate={createUser}
            onAction={requestUserAction}
          />
        ) : (
          <WorkspacesPanel
            workspaces={workspaces}
            pending={pending}
            name={workspaceName}
            slug={workspaceSlug}
            onNameChange={setWorkspaceName}
            onSlugChange={setWorkspaceSlug}
            onCreate={createWorkspace}
            onAction={requestWorkspaceAction}
          />
        )}
      </div>

      {adminAction && (
        <AdminActionDialog
          request={adminAction}
          reason={actionReason}
          error={error}
          pending={pending}
          onReasonChange={setActionReason}
          onCancel={() => {
            setAdminAction(undefined);
            setActionReason("");
          }}
          onConfirm={confirmAdminAction}
        />
      )}
    </section>
  );
}

function AdminActionDialog(props: {
  readonly request: AdminActionRequest;
  readonly reason: string;
  readonly error?: string;
  readonly pending: boolean;
  readonly onReasonChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
}) {
  const copy = adminActionCopy(props.request);
  return (
    <ReasonDialog
      {...copy}
      reason={props.reason}
      error={props.error}
      pending={props.pending}
      onReasonChange={props.onReasonChange}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}

function HealthOverview({
  health,
  onNavigate,
  billingUiEnabled,
}: {
  readonly health?: OperationsHealthProjection;
  readonly onNavigate: (tab: PanelTab) => void;
  readonly billingUiEnabled: boolean;
}) {
  if (!health) return null;
  const gates = visibleOperationsHealthGates(health.gates, billingUiEnabled);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-default)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">上线健康门</h3>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {gates.length} 项检查共享同一权威快照
            </p>
          </div>
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
            {gates.length} / {gates.length} observed
          </span>
        </div>
        <div className="divide-y divide-[var(--color-border-default)]">
          {gates.map((gate) => {
            const tone = gateTone(gate.status);
            return (
              <div
                key={gate.key}
                className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 hover:bg-[var(--color-bg-canvas)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{gateLabels[gate.key]}</p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-[var(--color-text-muted)]">
                      {gate.reason_code}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                    {gate.count}
                  </span>
                  <span
                    className={`min-w-12 rounded-full border px-2 py-0.5 text-center text-[9px] font-semibold ${tone.badge}`}
                  >
                    {tone.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
          Quick actions
        </p>
        <h3 className="mt-2 text-sm font-semibold">常用管理入口</h3>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => onNavigate("users")}
            className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2.5 text-left text-xs hover:border-[var(--color-border-focused)]"
          >
            创建或停用用户 <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("workspaces")}
            className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2.5 text-left text-xs hover:border-[var(--color-border-focused)]"
          >
            管理工作空间 <span aria-hidden="true">→</span>
          </button>
          {billingUiEnabled && (
            <Link
              href="/admin/pricing"
              className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2.5 text-left text-xs hover:border-[var(--color-border-focused)]"
            >
              审批价格候选 <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
        <div className="mt-5 border-t border-[var(--color-border-default)] pt-4">
          <p className="text-[10px] leading-5 text-[var(--color-text-muted)]">
            {billingUiEnabled
              ? "身份副作用、账单复核与余额漂移会阻断上线；同步或待审批项显示为注意。"
              : "身份副作用未完成时会阻断上线；待处理项显示为注意。"}
          </p>
        </div>
      </aside>
    </div>
  );
}

function UsersPanel(props: {
  readonly users: readonly AdminUserProjection[];
  readonly currentPrincipalId: string;
  readonly pending: boolean;
  readonly email: string;
  readonly name: string;
  readonly role: "USER" | "SUPER_ADMIN";
  readonly onEmailChange: (value: string) => void;
  readonly onNameChange: (value: string) => void;
  readonly onRoleChange: (value: "USER" | "SUPER_ADMIN") => void;
  readonly onCreate: (event: FormEvent) => void;
  readonly onAction: (
    user: AdminUserProjection,
    action: "DISABLE" | "ENABLE" | "RESET_PASSWORD",
  ) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-default)]">
        <div className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-3">
          <h3 className="text-sm font-semibold">全局用户目录</h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            账号全局唯一，成员关系按工作空间隔离
          </p>
        </div>
        <div className="divide-y divide-[var(--color-border-default)]">
          {props.users.map((user) => (
            <div
              key={user.principal_id}
              className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] text-xs font-semibold">
                  {user.display_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-xs font-semibold">{user.display_name}</p>
                    {user.system_role === "SUPER_ADMIN" && (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-semibold text-violet-700">
                        SUPER ADMIN
                      </span>
                    )}
                    <span
                      className={`size-1.5 rounded-full ${user.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-400"}`}
                    />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                    {user.email} · {shortId(user.principal_id)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-12 lg:pl-0">
                <span className="mr-1 text-[10px] text-[var(--color-text-muted)]">
                  {user.active_memberships} 空间 · epoch {user.authz_epoch}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.pending}
                  onClick={() => props.onAction(user, "RESET_PASSWORD")}
                >
                  重置密码
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.pending || user.principal_id === props.currentPrincipalId}
                  onClick={() =>
                    props.onAction(user, user.status === "ACTIVE" ? "DISABLE" : "ENABLE")
                  }
                >
                  {user.status === "ACTIVE" ? "停用" : "恢复"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={props.onCreate}
        className="h-fit rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-4"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Invite by admin
        </p>
        <h3 className="mt-1 text-sm font-semibold">创建全局用户</h3>
        <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
          首期不开放自主注册。系统生成一次性初始密码。
        </p>
        <label className="mt-4 block text-[11px] font-medium">
          显示名称
          <input
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            required
            maxLength={128}
            className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 text-xs outline-none focus:border-[var(--color-border-focused)]"
            placeholder="例如：陈分析师"
          />
        </label>
        <label className="mt-3 block text-[11px] font-medium">
          邮箱
          <input
            type="email"
            value={props.email}
            onChange={(event) => props.onEmailChange(event.target.value)}
            required
            className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 text-xs outline-none focus:border-[var(--color-border-focused)]"
            placeholder="analyst@example.com"
          />
        </label>
        <label className="mt-3 block text-[11px] font-medium">
          全局角色
          <select
            value={props.role}
            onChange={(event) => props.onRoleChange(event.target.value as "USER" | "SUPER_ADMIN")}
            className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 text-xs outline-none focus:border-[var(--color-border-focused)]"
          >
            <option value="USER">普通用户</option>
            <option value="SUPER_ADMIN">超级管理员</option>
          </select>
        </label>
        <Button
          className="mt-4 w-full"
          type="submit"
          disabled={props.pending || !props.email.trim() || !props.name.trim()}
        >
          {props.pending ? "正在创建…" : "创建用户"}
        </Button>
      </form>
    </div>
  );
}

function WorkspacesPanel(props: {
  readonly workspaces: readonly AdminWorkspaceProjection[];
  readonly pending: boolean;
  readonly name: string;
  readonly slug: string;
  readonly onNameChange: (value: string) => void;
  readonly onSlugChange: (value: string) => void;
  readonly onCreate: (event: FormEvent) => void;
  readonly onAction: (workspace: AdminWorkspaceProjection) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-3 sm:grid-cols-2">
        {props.workspaces.map((workspace) => (
          <article
            key={workspace.workspace_id}
            className="rounded-xl border border-[var(--color-border-default)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{workspace.display_name}</h3>
                <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {workspace.slug} · {shortId(workspace.workspace_id)}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${workspace.lifecycle === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
              >
                {workspace.lifecycle}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 border-y border-[var(--color-border-default)] py-3">
              <div>
                <p className="text-lg font-semibold tabular-nums">{workspace.active_members}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">活跃成员</p>
              </div>
              <div>
                <p className="text-lg font-semibold tabular-nums">{workspace.total_members}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">历史成员</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Link
                href={`/w/${workspace.workspace_id}/members`}
                className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
              >
                管理成员 →
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.pending}
                onClick={() => props.onAction(workspace)}
              >
                {workspace.lifecycle === "ACTIVE" ? "归档" : "恢复"}
              </Button>
            </div>
          </article>
        ))}
      </div>

      <form
        onSubmit={props.onCreate}
        className="h-fit rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-4"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Workspace provisioning
        </p>
        <h3 className="mt-1 text-sm font-semibold">创建工作空间</h3>
        <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
          项目即工作空间；创建后再从成员页分配角色。
        </p>
        <label className="mt-4 block text-[11px] font-medium">
          空间名称
          <input
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            required
            maxLength={128}
            className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 text-xs outline-none focus:border-[var(--color-border-focused)]"
            placeholder="增长分析"
          />
        </label>
        <label className="mt-3 block text-[11px] font-medium">
          Slug
          <input
            value={props.slug}
            onChange={(event) =>
              props.onSlugChange(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            required
            pattern="[a-z][a-z0-9-]*[a-z0-9]"
            className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 font-mono text-xs outline-none focus:border-[var(--color-border-focused)]"
            placeholder="growth-analytics"
          />
        </label>
        <Button
          className="mt-4 w-full"
          type="submit"
          disabled={props.pending || !props.name.trim() || !props.slug.trim()}
        >
          {props.pending ? "正在创建…" : "创建工作空间"}
        </Button>
      </form>
    </div>
  );
}
