import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceMembersPanel } from "@/components/workspaces/workspace-members-panel";
import { getCurrentWorkspaceSession, listSessionWorkspaces } from "@/lib/workspace-identity";

export default async function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) redirect("/login");
  const workspaces = await listSessionWorkspaces(session.value);
  if (!workspaces.ok) redirect("/workspaces");
  const access = workspaces.value.find(
    (candidate) => candidate.workspace.workspace_id === workspaceId,
  );
  if (!access) redirect("/workspaces");

  return (
    <div className="page-frame">
      <div>
        <WorkspaceMembersPanel
          workspaceId={workspaceId}
          workspaceName={access.workspace.display_name}
          currentPrincipalId={session.value.principal_id}
          canManage={access.allowed_actions.includes("MEMBER_MANAGE")}
          isSuperAdmin={session.value.system_role === "SUPER_ADMIN"}
        />
        <Link
          href={`/w/${workspaceId}`}
          className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft aria-hidden="true" size={14} />
          返回工作空间概览
        </Link>
      </div>
    </div>
  );
}
