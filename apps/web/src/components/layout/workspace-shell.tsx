"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { resetWorkspaceClientState } from "@/lib/workspace-client-state";
import type { WorkspaceNavigationItem } from "@/lib/workspace-navigation";
import { workspacePath } from "@/lib/workspace-routes";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";

interface WorkspaceShellProps {
  readonly access: WorkspaceAccessProjection;
  readonly navigation: readonly WorkspaceNavigationItem[];
  readonly children: ReactNode;
}

export function WorkspaceShell({ access, navigation, children }: WorkspaceShellProps) {
  const pathname = usePathname();
  const workspaceId = access.workspace.workspace_id;
  const boundWorkspaceId = useRef<string | null>(null);
  const usesEmbeddedRunStatus =
    pathname === workspacePath(workspaceId, "analysis") ||
    pathname === workspacePath(workspaceId, "qa");

  useLayoutEffect(() => {
    if (boundWorkspaceId.current === workspaceId) return;
    boundWorkspaceId.current = workspaceId;
    resetWorkspaceClientState();
  }, [workspaceId]);

  return (
    <div className="flex h-screen flex-row bg-[var(--color-bg-canvas)]">
      <Sidebar access={access} navigation={navigation} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        {!usesEmbeddedRunStatus && <StatusBar />}
      </div>
    </div>
  );
}
