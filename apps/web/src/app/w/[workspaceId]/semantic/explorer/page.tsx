import { SemanticExplorerPage } from "@/components/semantic/explorer/semantic-explorer-page";

export default async function WorkspaceSemanticExplorerPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <SemanticExplorerPage key={workspaceId} workspaceId={workspaceId} />;
}
