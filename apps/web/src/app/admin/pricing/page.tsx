import { notFound, redirect } from "next/navigation";
import { PricingControlPanel } from "@/components/settings/pricing-control-panel";
import { getCurrentWorkspaceSession } from "@/lib/workspace-identity";

export default async function PricingAdminPage() {
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) {
    if (session.error.code.startsWith("AUTH_SESSION_")) redirect("/login");
    return (
      <main className="flex min-h-80 items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          {session.error.message}
        </div>
      </main>
    );
  }
  if (session.value.system_role !== "SUPER_ADMIN") notFound();

  return (
    <main className="mx-auto max-w-6xl p-6">
      <PricingControlPanel />
    </main>
  );
}
