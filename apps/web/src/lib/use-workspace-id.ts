"use client";

import { useParams } from "next/navigation";
import { workspaceIdFromPathname } from "./workspace-routes";

export function useWorkspaceId(): string {
  const params = useParams<{ workspaceId?: string | string[] }>();
  const candidate = Array.isArray(params.workspaceId) ? params.workspaceId[0] : params.workspaceId;
  const workspaceId = candidate
    ? workspaceIdFromPathname(`/w/${candidate}`)
    : typeof window === "undefined"
      ? ""
      : workspaceIdFromPathname(window.location.pathname);
  return workspaceId;
}
