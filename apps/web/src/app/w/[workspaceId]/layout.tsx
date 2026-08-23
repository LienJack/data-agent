import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import {
  getCurrentWorkspaceSession,
  listSessionWorkspaces,
  resolveSessionWorkspaceCapability,
} from "@/lib/workspace-identity";
import { navigationForWorkspace } from "@/lib/workspace-navigation";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) redirect("/login");
  const [workspaces, capability] = await Promise.all([
    listSessionWorkspaces(session.value),
    resolveSessionWorkspaceCapability(session.value, workspaceId),
  ]);
  if (!workspaces.ok || !capability.ok) redirect("/workspaces");
  const access = workspaces.value.find(
    (candidate) => candidate.workspace.workspace_id === workspaceId,
  );
  if (!access) redirect("/workspaces");
  const navigation = navigationForWorkspace(access);

  return (
    <WorkspaceShell access={access} navigation={navigation}>
      {children}
    </WorkspaceShell>
  );
}
