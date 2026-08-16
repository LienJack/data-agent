import { SemanticAuthoringTrace } from "@/components/semantic/authoring/semantic-authoring-trace";

export default async function SemanticAuthoringTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; runId: string }>;
  searchParams: Promise<{ domain?: string }>;
}) {
  const [{ workspaceId, runId }, query] = await Promise.all([params, searchParams]);
  return (
    <SemanticAuthoringTrace
      workspaceId={workspaceId}
      runId={runId}
      semanticDomain={query.domain?.slice(0, 64) || "ecommerce"}
    />
  );
}
