import type { WorkspaceAccessProjection, WorkspaceAction } from "@data-agent/contracts";

export interface WorkspaceNavigationItem {
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly requiredAction: WorkspaceAction;
  readonly phase: "AVAILABLE" | "PHASE_2";
}

interface WorkspaceNavigationDefinition extends Omit<WorkspaceNavigationItem, "href"> {
  readonly path: string;
}

const navigationDefinitions = [
  {
    label: "分析工作台",
    description: "创建研究与归因分析运行",
    path: "analysis",
    requiredAction: "ANALYSIS_RUN_CREATE",
    phase: "AVAILABLE",
  },
  {
    label: "结果浏览",
    description: "查看当前工作空间的分析结果",
    path: "results",
    requiredAction: "WORKSPACE_RESULT_READ",
    phase: "AVAILABLE",
  },
  {
    label: "语义治理",
    description: "编辑和审核语义候选",
    path: "semantic",
    requiredAction: "SEMANTIC_EDIT",
    phase: "AVAILABLE",
  },
  {
    label: "数据源",
    description: "管理连接与 SecretRef",
    path: "data-sources",
    requiredAction: "DATASOURCE_MANAGE",
    phase: "AVAILABLE",
  },
  {
    label: "成员管理",
    description: "管理当前工作空间的成员角色",
    path: "members",
    requiredAction: "MEMBER_MANAGE",
    phase: "AVAILABLE",
  },
  {
    label: "平台配置",
    description: "管理模型、价格、汇率和账务复核",
    path: "platform-settings",
    requiredAction: "MODEL_MANAGE",
    phase: "PHASE_2",
  },
] as const satisfies readonly WorkspaceNavigationDefinition[];

export function navigationForWorkspace(
  access: WorkspaceAccessProjection,
): readonly WorkspaceNavigationItem[] {
  const allowed = new Set(access.allowed_actions);
  return navigationDefinitions
    .filter((item) => allowed.has(item.requiredAction))
    .map(({ path, ...item }) => ({
      ...item,
      href: `/w/${access.workspace.workspace_id}/${path}`,
    }));
}
