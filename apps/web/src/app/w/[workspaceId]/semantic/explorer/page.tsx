import { workspacePath } from "@/lib/workspace-routes";
import SemanticExplorerPage from "../../../../semantic/explorer/page";

export default async function WorkspaceSemanticExplorerPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <SemanticExplorerPage returnHref={workspacePath(workspaceId, "semantic")} />;
}
