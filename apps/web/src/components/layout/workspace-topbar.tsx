"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { CaretRight, FolderOpen, Globe, ShieldCheck, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import { useQAStore } from "@/lib/qa-store";
import { workspacePath } from "@/lib/workspace-routes";
import { ConversationDirectory } from "../qa/conversation-directory";

const surfaceKeys: Readonly<Record<string, MessageKey>> = {
  analysis: "workspace.surface.analysis",
  qa: "workspace.surface.qa",
  tests: "workspace.surface.tests",
  jobs: "workspace.surface.jobs",
  "data-sources": "workspace.surface.data-sources",
  semantic: "workspace.surface.semantic",
  members: "workspace.surface.members",
  "platform-settings": "workspace.surface.platform-settings",
};

function shortIdentity(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-5)}` : value;
}

export function WorkspaceTopbar({ access }: { readonly access: WorkspaceAccessProjection }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale, setLocale, t } = useWorkspaceI18n();
  const workspaceId = access.workspace.workspace_id;
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const loadConversations = useQAStore((state) => state.loadConversations);
  const relative = pathname.split(`/w/${workspaceId}/`)[1] ?? "";
  const surface = relative.split("/")[0] ?? "";
  const surfaceKey = surfaceKeys[surface];
  const resources = [
    ["runId", "workspace.resource.run"],
    ["taskId", "workspace.resource.task"],
    ["artifactId", "workspace.resource.artifact"],
  ] as const;

  return (
    <header className="glass-surface-strong relative z-40 flex min-h-13 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4">
      <nav className="flex min-w-0 items-center gap-1.5 text-[11px]" aria-label="Breadcrumb">
        <span className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-text-primary)] text-[9px] font-semibold text-white lg:hidden">
          DA
        </span>
        <span className="max-w-36 truncate font-semibold text-[var(--color-text-primary)]">
          {access.workspace.display_name}
        </span>
        <CaretRight
          aria-hidden="true"
          className="shrink-0 text-[var(--color-text-muted)]"
          size={12}
        />
        <span className="truncate text-[var(--color-text-secondary)]">
          {surfaceKey ? t(surfaceKey) : t("workspace.home")}
        </span>
        {resources.map(([parameter, labelKey]) => {
          const value = searchParams.get(parameter);
          return value ? (
            <span className="contents" key={parameter}>
              <CaretRight
                aria-hidden="true"
                className="shrink-0 text-[var(--color-text-muted)]"
                size={12}
              />
              <span className="hidden min-w-0 items-center gap-1 text-[var(--color-text-muted)] sm:flex">
                {t(labelKey)}
                <code className="truncate text-[10px] text-[var(--color-text-secondary)]">
                  {shortIdentity(value)}
                </code>
              </span>
            </span>
          ) : null;
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        {surface === "qa" && access.role === "WORKSPACE_ADMIN" && (
          <Link
            href={`/w/${workspaceId}/qa/admin`}
            className="glass-control-radius hidden h-8 items-center gap-1.5 border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] px-2.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] sm:flex"
          >
            <ShieldCheck aria-hidden="true" size={14} />
            对话审计
          </Link>
        )}
        {surface === "qa" && (
          <button
            type="button"
            aria-expanded={directoryOpen}
            onClick={() => {
              setDirectoryOpen(true);
              void loadConversations();
            }}
            className="glass-control-radius flex size-8 items-center justify-center border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] text-[var(--color-text-muted)] lg:hidden"
            aria-label={locale === "zh-CN" ? "打开对话目录" : "Open conversation directory"}
          >
            <FolderOpen aria-hidden="true" size={15} />
          </button>
        )}
        <fieldset className="glass-control-radius flex h-8 shrink-0 items-center border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] p-0.5">
          <legend className="sr-only">{t("locale.switch")}</legend>
          <Globe aria-hidden="true" className="mx-1 text-[var(--color-text-muted)]" size={14} />
          {(["zh-CN", "en-US"] as const).map((candidate) => (
            <button
              type="button"
              key={candidate}
              aria-pressed={locale === candidate}
              onClick={() => setLocale(candidate)}
              className={`h-6 rounded-[4px] px-2 text-[10px] font-medium ${
                locale === candidate
                  ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {candidate === "zh-CN" ? t("locale.zh") : t("locale.en")}
            </button>
          ))}
        </fieldset>
      </div>
      {directoryOpen && surface === "qa" && (
        <div className="glass-overlay fixed inset-x-0 top-0 z-50 h-[100dvh] lg:hidden">
          <aside
            data-directory-menu-boundary
            className="glass-surface-strong absolute inset-y-0 left-0 w-[min(88vw,340px)] overflow-y-auto border-r p-4 [border-radius:0_var(--glass-panel-radius)_var(--glass-panel-radius)_0]"
            aria-label={locale === "zh-CN" ? "对话目录" : "Conversation directory"}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">
                {locale === "zh-CN" ? "对话目录" : "Conversation directory"}
              </span>
              <button
                type="button"
                onClick={() => setDirectoryOpen(false)}
                className="flex size-8 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)]"
                aria-label={locale === "zh-CN" ? "关闭对话目录" : "Close conversation directory"}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
            <ConversationDirectory
              qaHref={workspacePath(workspaceId, "qa")}
              onNavigate={() => setDirectoryOpen(false)}
            />
          </aside>
          <button
            type="button"
            className="absolute inset-y-0 right-0 left-[min(88vw,340px)] cursor-default"
            onClick={() => setDirectoryOpen(false)}
            aria-label={locale === "zh-CN" ? "关闭对话目录" : "Close conversation directory"}
          />
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {surfaceKey ? t(surfaceKey) : t("workspace.home")}
      </p>
    </header>
  );
}
