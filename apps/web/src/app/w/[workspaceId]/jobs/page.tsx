import { JobCenterView } from "@/components/jobs/job-center-view";

export default async function JobCenterPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <JobCenterView workspaceId={workspaceId} />;
}
