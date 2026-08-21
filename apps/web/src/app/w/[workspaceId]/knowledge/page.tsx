import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";

export default async function WorkspaceKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <KnowledgeWorkspace workspaceId={workspaceId} />;
}
