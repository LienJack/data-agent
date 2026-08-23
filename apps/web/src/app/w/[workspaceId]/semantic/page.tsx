import { SemanticStudio } from "@/components/semantic/studio/semantic-studio";
import { semanticStudioPreviewSnapshot } from "@/lib/semantic-studio-preview";

export default async function WorkspaceSemanticPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    preview?: string;
    intent?: string;
    domain?: string;
    runId?: string;
    evidenceSelectionId?: string;
    evidenceSelectionHash?: string;
  }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const preview = query.preview === "1" && process.env.NODE_ENV !== "production";
  return (
    <SemanticStudio
      key={workspaceId}
      workspaceId={workspaceId}
      initialSnapshot={preview ? semanticStudioPreviewSnapshot() : null}
      initialDraft={
        query.intent?.slice(0, 20_000) ??
        (query.evidenceSelectionId
          ? "根据我选择的知识段落生成或更新指标、公式、维度、术语及其关系；无法唯一映射的内容请向我确认。"
          : "")
      }
      initialDomain={query.domain?.slice(0, 64)}
      initialRunId={query.runId}
      initialEvidenceSelectionId={query.evidenceSelectionId}
      initialEvidenceSelectionHash={query.evidenceSelectionHash}
      preview={preview}
    />
  );
}
