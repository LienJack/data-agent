const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function workspacePath(workspaceId: string, suffix = ""): string {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!WORKSPACE_ID_PATTERN.test(normalizedWorkspaceId)) {
    throw new Error("工作空间 ID 无效");
  }
  const normalizedSuffix = suffix.trim().replace(/^\/+|\/+$/g, "");
  const base = `/w/${encodeURIComponent(normalizedWorkspaceId)}`;
  return normalizedSuffix ? `${base}/${normalizedSuffix}` : base;
}

export function workspaceIdFromPathname(pathname: string): string {
  const routed = pathname.match(
    /^\/w\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i,
  )?.[1];
  return routed && WORKSPACE_ID_PATTERN.test(routed) ? routed : "";
}

export function workspaceStorageKey(workspaceId: string, key: string): string {
  const canonicalPath = workspacePath(workspaceId);
  const normalizedKey = key.trim();
  if (!normalizedKey) throw new Error("工作空间存储键不能为空");
  return `data-agent.workspace.${canonicalPath.slice(3)}.${normalizedKey}`;
}
