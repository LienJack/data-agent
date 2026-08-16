import { redirect } from "next/navigation";
import { workspacePath } from "@/lib/workspace-routes";

/** 旧 Data Link 语义页已由统一的 Node/Edge 本体工作台取代。 */
export default async function RetiredDataLinkPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(workspacePath(workspaceId, "semantic"));
}
