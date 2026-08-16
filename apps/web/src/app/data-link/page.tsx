import { redirect } from "next/navigation";

/** @deprecated Data Link 语义视图已退役；必须从工作空间进入统一语义治理。 */
export default function RetiredGlobalDataLinkPage() {
  redirect("/workspaces");
}
