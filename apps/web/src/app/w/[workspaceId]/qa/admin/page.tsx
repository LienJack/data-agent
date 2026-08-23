import { notFound, redirect } from "next/navigation";
import { AdminConversationAudit } from "@/components/qa/admin-conversation-audit";
import {
  getCurrentWorkspaceSession,
  resolveSessionWorkspaceCapability,
} from "@/lib/workspace-identity";

export default async function WorkspaceQaAdminPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) {
    if (session.error.code.startsWith("AUTH_SESSION_")) redirect("/login");
    return <main className="p-6 text-sm text-amber-900">{session.error.message}</main>;
  }
  const capability = await resolveSessionWorkspaceCapability(session.value, workspaceId, "READ");
  if (!capability.ok || capability.value.role !== "OWNER") notFound();
  return <AdminConversationAudit initialWorkspaceId={workspaceId} />;
}
