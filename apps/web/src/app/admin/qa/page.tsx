import { notFound, redirect } from "next/navigation";
import { AdminConversationAudit } from "@/components/qa/admin-conversation-audit";
import { getCurrentWorkspaceSession, listSessionWorkspaces } from "@/lib/workspace-identity";

export default async function GlobalQaAdminPage() {
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) {
    if (session.error.code.startsWith("AUTH_SESSION_")) redirect("/login");
    return <main className="p-6 text-sm text-amber-900">{session.error.message}</main>;
  }
  if (session.value.system_role !== "SUPER_ADMIN") notFound();
  const workspaceAccess = await listSessionWorkspaces(session.value);
  if (!workspaceAccess.ok) {
    return <main className="p-6 text-sm text-amber-900">{workspaceAccess.error.message}</main>;
  }
  const workspaces = workspaceAccess.value.map(({ workspace }) => ({
    workspace_id: workspace.workspace_id,
    name: workspace.display_name,
  }));
  if (workspaces.length === 0) {
    return (
      <main className="p-6 text-sm text-[var(--color-text-muted)]">当前没有可审计的工作空间。</main>
    );
  }
  return (
    <AdminConversationAudit
      globalMode
      initialWorkspaceId={workspaces[0]?.workspace_id ?? ""}
      workspaces={workspaces}
    />
  );
}
