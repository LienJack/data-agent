import { handleListExplorerDomains } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleListExplorerDomains();
}
