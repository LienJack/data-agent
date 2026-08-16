import { redirect } from "next/navigation";
import { CreditLedgerPanel } from "@/components/settings/credit-ledger-panel";
import { ModelBillingPanel } from "@/components/settings/model-billing-panel";
import { OperationsAdminPanel } from "@/components/settings/operations-admin-panel";
import { PricingControlPanel } from "@/components/settings/pricing-control-panel";
import { SemanticPortabilityPanel } from "@/components/settings/semantic-portability-panel";
import { isBillingUiEnabled } from "@/lib/billing-ui";
import { getCurrentWorkspaceSession, listSessionWorkspaces } from "@/lib/workspace-identity";

/**
 * Settings 设置页面 — 模型配置管理。
 *
 * 展示环境系统模型与手工供应商配置。
 * 供应商使用卡片添加，供应商内按模型行选择。
 */
export default async function SettingsPage() {
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) {
    if (session.error.code.startsWith("AUTH_SESSION_")) redirect("/login");
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          {session.error.message}
        </div>
      </main>
    );
  }
  const isSuperAdmin = session.value.system_role === "SUPER_ADMIN";
  const billingUiEnabled = isBillingUiEnabled();
  const workspaceAccess = await listSessionWorkspaces(session.value);
  const workspaces = workspaceAccess.ok ? workspaceAccess.value : [];
  return (
    <div className="h-full overflow-y-auto">
      <div className="workspace-container">
        <header className="border-b border-[var(--color-border-default)] pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Platform settings
          </p>
          <div className="mt-1 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.03em]">平台设置</h1>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {billingUiEnabled
                  ? "账户、模型与计费输入的数据库权威控制面。"
                  : "账户、工作空间与语义治理的数据库权威控制面。"}
              </p>
            </div>
            <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
              {session.value.principal_id} · {session.value.system_role}
            </p>
          </div>
        </header>

        {isSuperAdmin && (
          <div className="mt-8 workspace-section">
            <OperationsAdminPanel
              currentPrincipalId={session.value.principal_id}
              billingUiEnabled={billingUiEnabled}
            />
          </div>
        )}

        {billingUiEnabled && (
          <>
            <div
              className={`${isSuperAdmin ? "mt-12 border-t border-[var(--color-border-default)] pt-8" : "mt-8"} workspace-section`}
            >
              <CreditLedgerPanel isSuperAdmin={isSuperAdmin} />
            </div>

            <div className="mt-12 border-t border-[var(--color-border-default)] pt-8">
              <ModelBillingPanel isSuperAdmin={isSuperAdmin} />
            </div>
          </>
        )}

        <div className="mt-12 border-t border-[var(--color-border-default)] pt-8">
          <SemanticPortabilityPanel workspaces={workspaces} />
        </div>

        {billingUiEnabled && isSuperAdmin && (
          <div className="mt-12 border-t border-[var(--color-border-default)] pt-8">
            <PricingControlPanel />
          </div>
        )}
      </div>
    </div>
  );
}
