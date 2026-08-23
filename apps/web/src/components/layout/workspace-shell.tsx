"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { WorkspaceI18nProvider } from "@/i18n";
import { resetWorkspaceClientState } from "@/lib/workspace-client-state";
import type { WorkspaceNavigationItem } from "@/lib/workspace-navigation";
import { workspacePath } from "@/lib/workspace-routes";
import { MobileWorkspaceNav } from "./mobile-workspace-nav";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";
import { WorkspaceTopbar } from "./workspace-topbar";

interface WorkspaceShellProps {
  readonly access: WorkspaceAccessProjection;
  readonly navigation: readonly WorkspaceNavigationItem[];
  readonly children: ReactNode;
}

export function WorkspaceShell({ access, navigation, children }: WorkspaceShellProps) {
  const pathname = usePathname();
  const workspaceId = access.workspace.workspace_id;
  const boundWorkspaceId = useRef<string | null>(null);
  const usesEmbeddedRunStatus = pathname === workspacePath(workspaceId, "qa");

  useLayoutEffect(() => {
    if (boundWorkspaceId.current === workspaceId) return;
    boundWorkspaceId.current = workspaceId;
    resetWorkspaceClientState();
  }, [workspaceId]);

  return (
    <WorkspaceI18nProvider>
      <div className="workspace-glass-canvas flex min-h-[100dvh] flex-row">
        <Sidebar access={access} navigation={navigation} />
        <div className="flex min-h-[100dvh] min-w-0 flex-1 flex-col">
          <WorkspaceTopbar access={access} />
          <main className="min-h-0 flex-1 overflow-auto pb-16 lg:pb-0">{children}</main>
          {!usesEmbeddedRunStatus && <StatusBar className="hidden lg:flex" />}
        </div>
        <MobileWorkspaceNav navigation={navigation} />
      </div>
    </WorkspaceI18nProvider>
  );
}
