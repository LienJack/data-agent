import type { WorkspaceAccessProjection, WorkspaceAction } from "@data-agent/contracts";

export interface WorkspaceNavigationItem {
  readonly key: WorkspaceNavigationKey;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly requiredAction: WorkspaceAction;
  readonly phase: "AVAILABLE" | "PHASE_2";
}

export type WorkspaceNavigationKey =
  | "qa"
  | "tests"
  | "jobs"
  | "data-sources"
  | "knowledge"
  | "semantic"
  | "semantic-explorer"
  | "members"
  | "platform-settings";

interface WorkspaceNavigationDefinition extends Omit<WorkspaceNavigationItem, "href"> {
  readonly path: string;
}

const navigationDefinitions = [
  {
    key: "qa",
    label: "对话分析",
    description: "在当前工作空间创建和继续业务对话",
    path: "qa",
    requiredAction: "ANALYSIS_RUN_CREATE",
    phase: "AVAILABLE",
  },
  {
    key: "tests",
    label: "能力测试",
    description: "查看并运行当前工作空间的能力测试",
    path: "tests",
    requiredAction: "WORKSPACE_RESULT_READ",
    phase: "AVAILABLE",
  },
  {
    key: "jobs",
    label: "任务中心",
    description: "查看后台任务、重试和取消状态",
    path: "jobs",
    requiredAction: "WORKSPACE_RESULT_READ",
    phase: "AVAILABLE",
  },
  {
    key: "data-sources",
    label: "数据源",
    description: "管理连接与 SecretRef",
    path: "data-sources",
    requiredAction: "DATASOURCE_MANAGE",
    phase: "AVAILABLE",
  },
  {
    key: "knowledge",
    label: "知识库",
    description: "管理公司知识资产、版本与语义证据",
    path: "knowledge",
    requiredAction: "SEMANTIC_EDIT",
    phase: "AVAILABLE",
  },
  {
    key: "semantic",
    label: "语义工作台",
    description: "编辑、保存和审核语义候选",
    path: "semantic",
    requiredAction: "SEMANTIC_EDIT",
    phase: "AVAILABLE",
  },
  {
    key: "semantic-explorer",
    label: "语义浏览器",
    description: "只读浏览已发布对象、关系与溯源",
    path: "semantic/explorer",
    requiredAction: "WORKSPACE_RESULT_READ",
    phase: "AVAILABLE",
  },
  {
    key: "members",
    label: "成员管理",
    description: "管理当前工作空间的成员角色",
    path: "members",
    requiredAction: "MEMBER_MANAGE",
    phase: "AVAILABLE",
  },
  {
    key: "platform-settings",
    label: "模型配置",
    description: "管理模型供应商与运行配置",
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
