import { redirect } from "next/navigation";
import {
  getCurrentWorkspaceSession,
  listSessionWorkspaces,
  resolveSessionWorkspaceCapability,
} from "@/lib/workspace-identity";
import { workspacePath } from "@/lib/workspace-routes";

/** Compatibility route for the retired workspace /analysis surface. */
export default async function LegacyAnalysisRedirect({
  params,
}: {
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
  if (!access?.allowed_actions.includes("ANALYSIS_RUN_CREATE")) redirect("/workspaces");
  redirect(workspacePath(workspaceId, "qa"));
}
