"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { ArrowRight, CheckCircle, Clock, ShieldCheck } from "@phosphor-icons/react";
import Link from "next/link";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import type { WorkspaceNavigationItem, WorkspaceNavigationKey } from "@/lib/workspace-navigation";
import { AccountControls } from "./account-controls";
import { GreenfieldJourneyPanel } from "./greenfield-journey-panel";

const labels: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  qa: "workspace.surface.qa",
  tests: "workspace.surface.tests",
  jobs: "workspace.surface.jobs",
  "data-sources": "workspace.surface.data-sources",
  knowledge: "workspace.surface.knowledge",
  semantic: "workspace.surface.semantic",
  "semantic-explorer": "workspace.surface.semanticExplorer",
  members: "workspace.surface.members",
  "platform-settings": "workspace.surface.platform-settings",
};

const descriptions: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  qa: "workspace.description.qa",
  tests: "workspace.description.tests",
  jobs: "workspace.description.jobs",
  "data-sources": "workspace.description.data-sources",
  knowledge: "workspace.description.knowledge",
  semantic: "workspace.description.semantic",
  "semantic-explorer": "workspace.description.semanticExplorer",
  members: "workspace.description.members",
  "platform-settings": "workspace.description.platform-settings",
};

export function WorkspaceHome({
  access,
  navigation,
}: {
  readonly access: WorkspaceAccessProjection;
  readonly navigation: readonly WorkspaceNavigationItem[];
}) {
  const { t } = useWorkspaceI18n();
  const primaryAction = navigation.find((item) => item.key === "qa") ?? navigation[0];
  const availableCount = navigation.filter((item) => item.phase === "AVAILABLE").length;

  return (
    <main className="min-h-full bg-[var(--color-bg-canvas)]">
      <div className="page-frame max-w-[1280px]">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-[var(--color-border-default)] pb-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="page-eyebrow">Workspace / {access.workspace.slug}</span>
              <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-[9px] font-semibold text-[var(--color-accent)]">
                {access.role}
              </span>
            </div>
            <h1 className="page-title">{access.workspace.display_name}</h1>
            <p className="mt-2 max-w-[64ch] font-mono text-[10px] text-[var(--color-text-muted)]">
              {t("workspace.identity")} · {access.workspace.workspace_id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/workspaces"
              className="control-pressable rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]"
            >
              {t("workspace.switch")}
            </Link>
            <AccountControls />
          </div>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.72fr)]">
          <section className="surface-reading overflow-hidden rounded-[var(--radius-panel)] border">
            <div className="border-b border-[var(--color-border-default)] px-5 py-4 sm:px-6">
              <p className="page-eyebrow">Continue</p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.035em]">继续你的工作</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                    从当前权限允许的分析入口开始，运行结果会保留在这个工作空间中。
                  </p>
                </div>
                {primaryAction ? (
                  <Link
                    href={primaryAction.href}
                    className="control-pressable flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)]"
                  >
                    {t(labels[primaryAction.key])}
                    <ArrowRight aria-hidden="true" size={15} weight="bold" />
                  </Link>
                ) : null}
              </div>
            </div>

            <nav
              className="divide-y divide-[var(--color-border-default)]"
              aria-label={t("workspace.roleNavigation")}
            >
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="control-pressable group grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 hover:bg-[var(--color-accent-soft)] sm:px-6"
                >
                  <span className="flex size-10 items-center justify-center rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] text-[var(--color-text-secondary)] group-hover:border-[color-mix(in_srgb,var(--color-accent)_22%,white)] group-hover:bg-white group-hover:text-[var(--color-accent)]">
                    <WorkspaceNavIcon navigationKey={item.key} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{t(labels[item.key])}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">
                      {t(descriptions[item.key])}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="hidden font-mono text-[9px] font-semibold uppercase text-[var(--color-text-muted)] sm:inline">
                      {item.phase === "AVAILABLE" ? t("workspace.available") : t("workspace.later")}
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-accent)]"
                      size={16}
                    />
                  </span>
                </Link>
              ))}
            </nav>
          </section>

          <aside className="space-y-5">
            <section className="surface-reading rounded-[var(--radius-panel)] border p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold">访问状态</p>
                <ShieldCheck aria-hidden="true" className="text-[var(--color-accent)]" size={18} />
              </div>
              <dl className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs text-[var(--color-text-muted)]">当前角色</dt>
                  <dd className="font-mono text-[10px] font-semibold text-[var(--color-text-secondary)]">
                    {access.role}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs text-[var(--color-text-muted)]">可用模块</dt>
                  <dd className="flex items-center gap-1.5 text-xs font-semibold">
                    <CheckCircle
                      aria-hidden="true"
                      className="text-[var(--color-success)]"
                      size={14}
                    />
                    {availableCount}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs text-[var(--color-text-muted)]">后续能力</dt>
                  <dd className="flex items-center gap-1.5 text-xs font-semibold">
                    <Clock aria-hidden="true" className="text-[var(--color-warning)]" size={14} />
                    {navigation.length - availableCount}
                  </dd>
                </div>
              </dl>
              <p className="mt-5 border-t border-[var(--color-border-default)] pt-4 text-[11px] leading-5 text-[var(--color-text-muted)]">
                {t("workspace.identityNote")} {t("workspace.extensionsLater")}
              </p>
            </section>

            <GreenfieldJourneyPanel />
          </aside>
        </div>
      </div>
    </main>
  );
}
