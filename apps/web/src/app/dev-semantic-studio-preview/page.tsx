import { notFound } from "next/navigation";
import { SemanticStudio } from "@/components/semantic/studio/semantic-studio";
import { semanticStudioPreviewSnapshot } from "@/lib/semantic-studio-preview";

export default function SemanticStudioPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <SemanticStudio
      workspaceId="10000000-0000-4000-8000-000000000001"
      initialSnapshot={semanticStudioPreviewSnapshot()}
      preview
    />
  );
}
