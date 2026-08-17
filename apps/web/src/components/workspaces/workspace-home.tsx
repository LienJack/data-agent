"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
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
    <main className="min-h-screen bg-[var(--color-bg-secondary)] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-lg border border-[var(--color-border-default)] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                  {access.role}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {access.workspace.slug}
                </span>
              </div>
              <h1 className="mt-3 text-3xl font-semibold">{access.workspace.display_name}</h1>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {t("workspace.identity")} · {access.workspace.workspace_id}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/workspaces"
                className="rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs font-medium hover:bg-[var(--color-bg-tertiary)]"
              >
                {t("workspace.switch")}
              </Link>
              <AccountControls />
            </div>
          </div>
        </header>

        <div className="mt-6 overflow-hidden rounded-lg">
          <GreenfieldJourneyPanel />
        </div>

        <section
          className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label={t("workspace.roleNavigation")}
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-[var(--color-border-default)] bg-white p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{t(labels[item.key])}</h2>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-700">
                  {item.phase === "AVAILABLE" ? t("workspace.available") : t("workspace.later")}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                {item.key === "platform-settings" && !controlPlaneEnabled
                  ? t("workspace.description.platform-settingsPaused")
                  : t(descriptions[item.key])}
              </p>
            </Link>
          ))}
        </section>

        <section className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
          {t("workspace.identityNote")}{" "}
          {controlPlaneEnabled ? t("workspace.controlPlaneLater") : t("workspace.extensionsLater")}
        </section>
      </div>
    </main>
  );
}
