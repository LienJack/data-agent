"use client";

import type {
  AdminUserProjection,
  AdminWorkspaceMemberProjection,
  IdentityOperationReceipt,
  WorkspaceRole,
} from "@data-agent/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";

interface WorkspaceMembersPanelProps {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly currentPrincipalId: string;
  readonly canManage: boolean;
  readonly isSuperAdmin: boolean;
}

const workspaceRoles = ["WORKSPACE_ADMIN", "ANALYST", "VIEWER"] as const;

const roleLabels: Readonly<Record<WorkspaceRole, string>> = {
  WORKSPACE_ADMIN: "工作空间管理员",
  ANALYST: "分析员",
  VIEWER: "只读成员",
};

const sourceLabels: Readonly<Record<AdminWorkspaceMemberProjection["source"], string>> = {
  EXPLICIT: "显式分配",
  SYSTEM_ROLE: "超级管理员覆盖",
  LEGACY: "兼容成员",
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

function operationKey(action: string) {
  return `workspace-member-${action}-${crypto.randomUUID()}`;
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function MemberStatus({ member }: { readonly member: AdminWorkspaceMemberProjection }) {
  if (member.revoked_at) {
    return (
      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        已撤销
      </span>
    );
  }
  if (member.user_status !== "ACTIVE") {
    return (
      <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
        账号已停用
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      有效
    </span>
  );
}

function RoleSelect({
  value,
  disabled,
  label,
  onChange,
}: {
  readonly value: WorkspaceRole;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (role: WorkspaceRole) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as WorkspaceRole)}
      className="h-8 rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 text-xs outline-none focus:border-[var(--color-accent)] disabled:bg-[var(--color-bg-secondary)]"
    >
      {workspaceRoles.map((role) => (
        <option key={role} value={role}>
          {roleLabels[role]}
        </option>
      ))}
    </select>
  );
}

export function WorkspaceMembersPanel({
  workspaceId,
  workspaceName,
  currentPrincipalId,
  canManage,
  isSuperAdmin,
}: WorkspaceMembersPanelProps) {
  const [members, setMembers] = useState<readonly AdminWorkspaceMemberProjection[]>([]);
  const [globalUsers, setGlobalUsers] = useState<readonly AdminUserProjection[]>([]);
  const [draftRoles, setDraftRoles] = useState<Readonly<Record<string, WorkspaceRole>>>({});
  const [selectedPrincipalId, setSelectedPrincipalId] = useState("");
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole>("ANALYST");
  const [loading, setLoading] = useState(canManage);
  const [pendingPrincipalId, setPendingPrincipalId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [revokeTarget, setRevokeTarget] = useState<AdminWorkspaceMemberProjection>();
  const [revokeReason, setRevokeReason] = useState("");

  const reload = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(undefined);
    try {
      const [nextMembers, nextUsers] = await Promise.all([
        api<readonly AdminWorkspaceMemberProjection[]>(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
        ),
        isSuperAdmin
          ? api<readonly AdminUserProjection[]>("/api/admin/operations/users")
          : Promise.resolve([]),
      ]);
      setMembers(nextMembers);
      setGlobalUsers(nextUsers);
      setDraftRoles(
        Object.fromEntries(nextMembers.map((member) => [member.principal_id, member.role])),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "成员列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [canManage, isSuperAdmin, workspaceId]);

  useEffect(() => void reload(), [reload]);

  const candidates = useMemo(() => {
    if (isSuperAdmin) {
      return globalUsers.filter((user) => user.status === "ACTIVE");
    }
    return members
      .filter((member) => member.user_status === "ACTIVE")
      .map((member) => ({
        principal_id: member.principal_id,
        display_name: member.display_name,
        email: member.email,
      }));
  }, [globalUsers, isSuperAdmin, members]);

  const activeCount = members.filter(
    (member) => member.user_status === "ACTIVE" && !member.revoked_at,
  ).length;
  const adminCount = members.filter(
    (member) => member.role === "WORKSPACE_ADMIN" && !member.revoked_at,
  ).length;

  async function upsertMember(principalId: string, role: WorkspaceRole) {
    setPendingPrincipalId(principalId);
    setError(undefined);
    setNotice(undefined);
    try {
      await api<IdentityOperationReceipt>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
        {
          method: "PATCH",
          body: JSON.stringify({
            schema_version: "workspace-member-action@1.0.0",
            operation_id: crypto.randomUUID(),
            idempotency_key: operationKey("upsert"),
            principal_id: principalId,
            action: "UPSERT",
            role,
          }),
        },
      );
      setSelectedPrincipalId("");
      setNotice("成员资格已更新，旧 capability 将按新的授权版本失效。");
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "成员更新失败");
    } finally {
      setPendingPrincipalId(undefined);
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!selectedPrincipalId) return;
    await upsertMember(selectedPrincipalId, selectedRole);
  }

  function requestMemberRevocation(member: AdminWorkspaceMemberProjection) {
    setRevokeReason("");
    setRevokeTarget(member);
  }

  async function revokeMember(reason: string) {
    if (!revokeTarget) return;
    setPendingPrincipalId(revokeTarget.principal_id);
    setError(undefined);
    setNotice(undefined);
    try {
      await api<IdentityOperationReceipt>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
        {
          method: "PATCH",
          body: JSON.stringify({
            schema_version: "workspace-member-action@1.0.0",
            operation_id: crypto.randomUUID(),
            idempotency_key: operationKey("revoke"),
            principal_id: revokeTarget.principal_id,
            action: "REVOKE",
            reason,
          }),
        },
      );
      setRevokeTarget(undefined);
      setRevokeReason("");
      setNotice("成员资格已撤销，相关授权版本已同步提升。");
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "成员撤销失败");
    } finally {
      setPendingPrincipalId(undefined);
    }
  }

  if (!canManage) {
    return (
      <section className="rounded-[var(--radius-panel)] border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
          Member manage required
        </p>
        <h1 className="mt-2 text-xl font-semibold">当前角色不能管理成员</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6">
          直接访问此地址不会返回成员目录。请联系工作空间管理员调整权限。
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="workspace-members-heading" className="space-y-5">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--color-accent)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              Workspace identity
            </p>
          </div>
          <h1
            id="workspace-members-heading"
            className="mt-2 text-2xl font-semibold tracking-[-0.03em]"
          >
            {workspaceName} · 成员
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            管理本空间已有账号的角色与成员资格。所有变更由 PostgreSQL 权威命令原子执行。
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void reload()}
          disabled={loading || !!pendingPrincipalId}
        >
          刷新目录
        </Button>
      </header>

      <div className="surface-reading grid overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border-default)] sm:grid-cols-3">
        <div className="border-b border-[var(--color-border-default)] px-5 py-4 sm:border-b-0 sm:border-r">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            有效成员
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{activeCount}</p>
        </div>
        <div className="border-b border-[var(--color-border-default)] px-5 py-4 sm:border-b-0 sm:border-r">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            空间管理员
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{adminCount}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            目录范围
          </p>
          <p className="mt-2 text-xs font-medium">
            {isSuperAdmin ? "全局有效用户" : "本空间已有用户"}
          </p>
        </div>
      </div>

      <form
        onSubmit={addMember}
        className="surface-reading rounded-[var(--radius-panel)] border border-[var(--color-border-default)] p-4"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
          <label className="grid gap-1.5 text-xs font-medium">
            账号
            <select
              required
              value={selectedPrincipalId}
              onChange={(event) => setSelectedPrincipalId(event.target.value)}
              className="h-9 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 text-xs outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">选择已有账号</option>
              {candidates.map((candidate) => (
                <option key={candidate.principal_id} value={candidate.principal_id}>
                  {candidate.display_name} · {candidate.email}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-1.5 text-xs font-medium">
            <span>工作空间角色</span>
            <RoleSelect value={selectedRole} label="新成员角色" onChange={setSelectedRole} />
          </div>
          <Button
            type="submit"
            className="h-9"
            disabled={!selectedPrincipalId || !!pendingPrincipalId}
          >
            添加或恢复成员
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
          {isSuperAdmin
            ? "可将任一全局有效账号加入当前空间；不在此处创建登录账号。"
            : "工作空间管理员只能调整本空间目录中已有账号，不会看到全局用户目录。"}
        </p>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"
        >
          {notice}
        </div>
      )}

      <div className="surface-reading overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border-default)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">成员目录</h2>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              包含已撤销成员，便于审计和恢复。
            </p>
          </div>
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
            {members.length} records
          </span>
        </div>

        {loading ? (
          <div className="space-y-3 p-5" role="status" aria-label="正在加载成员">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="skeleton-shimmer h-12 rounded-[var(--radius-control)] bg-[var(--color-bg-secondary)]"
              />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium">当前没有成员记录</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              从上方已有账号目录添加第一位成员。
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[780px] table-fixed text-left">
                <thead className="bg-[var(--color-bg-secondary)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  <tr>
                    <th className="w-[31%] px-4 py-2.5 font-semibold">用户</th>
                    <th className="w-[18%] px-4 py-2.5 font-semibold">状态</th>
                    <th className="w-[25%] px-4 py-2.5 font-semibold">角色</th>
                    <th className="w-[26%] px-4 py-2.5 text-right font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-default)]">
                  {members.map((member) => {
                    const isSelf = member.principal_id === currentPrincipalId;
                    const isSystem = member.source === "SYSTEM_ROLE";
                    const busy = pendingPrincipalId === member.principal_id;
                    const draftRole = draftRoles[member.principal_id] ?? member.role;
                    return (
                      <tr key={member.principal_id} className="align-middle">
                        <td className="px-4 py-3">
                          <p className="truncate text-xs font-semibold">
                            {member.display_name}{" "}
                            {isSelf && <span className="text-[var(--color-accent)]">（你）</span>}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                            {member.email}
                          </p>
                          <p
                            className="mt-0.5 font-mono text-[9px] text-[var(--color-text-muted)]"
                            title={member.principal_id}
                          >
                            {shortId(member.principal_id)} · v{member.membership_version}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <MemberStatus member={member} />
                          <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                            {sourceLabels[member.source]}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <RoleSelect
                            value={draftRole}
                            label={`${member.display_name} 的角色`}
                            disabled={busy || isSystem || member.user_status !== "ACTIVE"}
                            onChange={(role) =>
                              setDraftRoles((current) => ({
                                ...current,
                                [member.principal_id]: role,
                              }))
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              disabled={
                                busy ||
                                isSystem ||
                                member.user_status !== "ACTIVE" ||
                                (draftRole === member.role && !member.revoked_at)
                              }
                              onClick={() => void upsertMember(member.principal_id, draftRole)}
                            >
                              {member.revoked_at ? "恢复" : "保存"}
                            </Button>
                            <Button
                              variant="ghost"
                              className="text-red-700 hover:bg-red-50 hover:text-red-800"
                              disabled={busy || isSelf || isSystem || !!member.revoked_at}
                              onClick={() => requestMemberRevocation(member)}
                            >
                              撤销
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--color-border-default)] md:hidden">
              {members.map((member) => {
                const isSelf = member.principal_id === currentPrincipalId;
                const isSystem = member.source === "SYSTEM_ROLE";
                const busy = pendingPrincipalId === member.principal_id;
                const draftRole = draftRoles[member.principal_id] ?? member.role;
                return (
                  <article key={member.principal_id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold">
                          {member.display_name}{" "}
                          {isSelf && <span className="text-[var(--color-accent)]">（你）</span>}
                        </p>
                        <p className="mt-0.5 break-all text-[11px] text-[var(--color-text-muted)]">
                          {member.email}
                        </p>
                      </div>
                      <MemberStatus member={member} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                      <span>{sourceLabels[member.source]}</span>
                      <span>·</span>
                      <span className="font-mono">{shortId(member.principal_id)}</span>
                      <span>· v{member.membership_version}</span>
                    </div>
                    <RoleSelect
                      value={draftRole}
                      label={`${member.display_name} 的角色`}
                      disabled={busy || isSystem || member.user_status !== "ACTIVE"}
                      onChange={(role) =>
                        setDraftRoles((current) => ({ ...current, [member.principal_id]: role }))
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={
                          busy ||
                          isSystem ||
                          member.user_status !== "ACTIVE" ||
                          (draftRole === member.role && !member.revoked_at)
                        }
                        onClick={() => void upsertMember(member.principal_id, draftRole)}
                      >
                        {member.revoked_at ? "恢复成员" : "保存角色"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-red-700 hover:bg-red-50 hover:text-red-800"
                        disabled={busy || isSelf || isSystem || !!member.revoked_at}
                        onClick={() => requestMemberRevocation(member)}
                      >
                        撤销资格
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>

      {revokeTarget && (
        <ReasonDialog
          eyebrow="Revoke membership"
          title={`撤销「${revokeTarget.display_name}」的成员资格`}
          description={`撤销后，该用户对「${workspaceName}」的旧 capability 将立即失效；账号本身及其其他工作空间成员资格不受影响。`}
          reasonLabel="撤销原因"
          confirmLabel="确认撤销资格"
          destructive
          reason={revokeReason}
          pending={pendingPrincipalId === revokeTarget.principal_id}
          error={error}
          onReasonChange={setRevokeReason}
          onCancel={() => {
            setRevokeTarget(undefined);
            setRevokeReason("");
          }}
          onConfirm={(reason) => void revokeMember(reason)}
        />
      )}
    </section>
  );
}
