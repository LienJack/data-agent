import { SemanticStudio } from "@/components/semantic/studio/semantic-studio";
import { semanticStudioPreviewSnapshot } from "@/lib/semantic-studio-preview";

export default async function WorkspaceSemanticPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ preview?: string; intent?: string }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const preview = query.preview === "1" && process.env.NODE_ENV !== "production";
  return (
    <SemanticStudio
      workspaceId={workspaceId}
      initialSnapshot={preview ? semanticStudioPreviewSnapshot() : null}
      initialDraft={query.intent?.slice(0, 20_000) ?? ""}
      preview={preview}
    />
  );
}
