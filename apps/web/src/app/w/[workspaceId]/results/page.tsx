import { redirect } from "next/navigation";
import { workspacePath } from "@/lib/workspace-routes";

export default async function LegacyWorkspaceResultsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(workspacePath(workspaceId, "tests"));
}
