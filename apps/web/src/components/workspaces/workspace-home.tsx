"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { ArrowUpRight, CheckCircle, Clock } from "@phosphor-icons/react";
import Link from "next/link";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import type { WorkspaceNavigationItem, WorkspaceNavigationKey } from "@/lib/workspace-navigation";
import { AccountControls } from "./account-controls";
import { GreenfieldJourneyPanel } from "./greenfield-journey-panel";

const labels: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  analysis: "workspace.surface.analysis",
  qa: "workspace.surface.qa",
  tests: "workspace.surface.tests",
  jobs: "workspace.surface.jobs",
  "data-sources": "workspace.surface.data-sources",
  semantic: "workspace.surface.semantic",
  members: "workspace.surface.members",
  "platform-settings": "workspace.surface.platform-settings",
};

const descriptions: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  analysis: "workspace.description.analysis",
  qa: "workspace.description.qa",
  tests: "workspace.description.tests",
  jobs: "workspace.description.jobs",
  "data-sources": "workspace.description.data-sources",
  semantic: "workspace.description.semantic",
  members: "workspace.description.members",
  "platform-settings": "workspace.description.platform-settings",
};

export function WorkspaceHome({
  access,
  navigation,
  controlPlaneEnabled,
}: {
  readonly access: WorkspaceAccessProjection;
  readonly navigation: readonly WorkspaceNavigationItem[];
  readonly controlPlaneEnabled: boolean;
}) {
  const { t } = useWorkspaceI18n();
  return (
    <main className="min-h-full bg-[var(--color-bg-secondary)]">
      <div className="page-frame">
        <header className="page-heading">
          <div className="flex flex-wrap items-start justify-between gap-6 lg:contents">
            <div>
              <div className="flex items-center gap-2">
                <span className="page-eyebrow">Workspace / {access.workspace.slug}</span>
                <span className="border-l border-[var(--color-border-default)] pl-2 text-[10px] font-semibold text-[var(--color-accent)]">
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
                className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs font-medium hover:border-[var(--color-border-overlay)] hover:bg-white"
              >
                {t("workspace.switch")}
              </Link>
              <AccountControls />
            </div>
          </div>
        </header>

        <div className="mt-6 overflow-hidden border-y border-[var(--color-border-default)]">
          <GreenfieldJourneyPanel />
        </div>

        <section
          className="mt-8 border-t border-[var(--color-border-default)]"
          aria-label={t("workspace.roleNavigation")}
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group grid min-h-24 gap-3 border-b border-[var(--color-border-default)] py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_4%,transparent)] sm:grid-cols-[minmax(160px,0.7fr)_minmax(260px,1.6fr)_auto] sm:items-center sm:px-3"
            >
              <div className="flex items-center gap-2">
                {item.phase === "AVAILABLE" ? (
                  <CheckCircle
                    aria-hidden="true"
                    className="text-[var(--color-accent)]"
                    size={17}
                  />
                ) : (
                  <Clock aria-hidden="true" className="text-[var(--color-warning)]" size={17} />
                )}
                <h2 className="text-sm font-semibold">{t(labels[item.key])}</h2>
              </div>
              <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
                {item.key === "platform-settings" && !controlPlaneEnabled
                  ? t("workspace.description.platform-settingsPaused")
                  : t(descriptions[item.key])}
              </p>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="font-mono text-[9px] font-semibold uppercase text-[var(--color-text-muted)]">
                  {item.phase === "AVAILABLE" ? t("workspace.available") : t("workspace.later")}
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)]"
                  size={17}
                />
              </div>
            </Link>
          ))}
        </section>

        <section className="mt-6 border-l-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] px-4 py-3 text-xs leading-5 text-[var(--color-text-secondary)]">
          {t("workspace.identityNote")}{" "}
          {controlPlaneEnabled ? t("workspace.controlPlaneLater") : t("workspace.extensionsLater")}
        </section>
      </div>
    </main>
  );
}
