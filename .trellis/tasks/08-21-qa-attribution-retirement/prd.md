# Legacy Attribution Route and Runtime Retirement

## Goal

下线旧“归因分析 / Attribution Analysis”产品入口和 Web/Worker 可达的旧 Attribution/F9
执行路径，使“对话分析 / Conversation Analysis”成为唯一分析入口；保留受控归因评测、通用
Run/Artifact、计费、身份与安全审计合同。历史归因数据的物理删除属于独立 destructive child，
本任务只产出只读 inventory，不执行 DELETE。

## Requirements

### R1. 唯一分析入口

- Workspace 桌面侧栏、移动导航、首页能力列表、Topbar 和中英文产品文案只保留“对话分析 /
  Conversation Analysis”。
- `WorkspaceNavigationKey` 不再包含 `analysis`，也不渲染旧 Workbench 最近运行快捷项。
- 共享的治理/评测状态可以继续存在，但不能作为旧归因产品入口或可执行按钮。

### R2. 授权后兼容重定向

- 旧 `/w/:workspaceId/analysis` route 必须先解析当前 cookie session、workspace membership、
  capability 与 `ANALYSIS_RUN_CREATE` action，再重定向至 `/w/:workspaceId/qa`。
- 未登录重定向登录；workspace 不存在、无成员关系、capability 失败或缺少 action 时统一重定向
  `/workspaces`，不能暴露对象存在性。
- 不恢复旧 deep link、Run、Artifact 或历史归因详情；必须保留原 workspace identity。

### R3. 正式归因请求稳定 deferred

- `ATTRIBUTION` 问题在 `SHADOW`、`ENFORCED` 与 `ROOT_ONLY_DEFER_DATA` 三种 rollout 下都必须返回
  durable `DEFERRED` admission：
  `reason_code=ATTRIBUTION_RUNTIME_NOT_READY`、
  `required_capabilities=[attribution.acceptance@1.0.0]`。
- 该分支不得生成 `LEGACY_FIXED@1` execution binding、Agent plan、Worker lease、SSE 或伪 Subagent。
- 对话可以给出明确标注边界的描述性分析，但不得把相关性图表称为正式归因结论。

### R4. 共享资产保留

- 保留 `controlled-attribution` eval、Attribution contracts、F9/feasibility/governance 证据、
  通用 Run/Artifact、计费、身份、权限与安全审计合同。
- 不删除或修改 10619–10622 历史 migration；不把旧 Attribution/F9 runtime 接入新版对话 UI。
- root `/` 继续只导向 workspace 选择，不成为旧 Workbench 的后门。

### R5. 只读 inventory 与删除边界

- 记录 UI 路由、planner/runtime、评测、数据库 authority 和共享对象的源码/表级 inventory。
- 普通 `/analysis` 与 Q&A 共用 generic Run/Artifact，当前没有 durable origin discriminator；禁止按
  URL、问题文本、Artifact type 或名称启发式识别和删除历史数据。
- 本任务不得执行历史数据 `DELETE`、Artifact purge、迁移回写或 filesystem cleanup。
- 独立 cleanup child 只能在再次 Go/No-Go 后处理 inventory 证明为旧 Attribution 专属的
  10620/10621 authority rows，并要求 PITR/备份、inventory digest、精确引用/hold/count 重验与 receipt。

## Out Of Scope

- 重做未来归因产品、合同、Agent、UI 或兼容旧 payload。
- 迁移历史归因结果到对话目录。
- 物理删除历史归因结果或共享审计/计费记录。
- 改写 controlled-attribution benchmark 或 F9 release gate。

## Acceptance Criteria

- [x] **AC1**：桌面/移动导航、Workspace 首页和 Topbar 不再包含 `analysis` 产品项，源码无
  `workspace.surface.analysis`、`workspace.description.analysis` 或“归因分析”产品文案。
- [x] **AC2**：已授权旧 route 重定向至同 workspace 的 `/qa`；未登录、capability 失败、无 membership
  和缺少 `ANALYSIS_RUN_CREATE` 均失败关闭，且不导入旧 root Workbench。
- [x] **AC3**：三种 rollout 对正式归因问题都返回同一 `ATTRIBUTION_RUNTIME_NOT_READY` deferred receipt，
  `shadow_plan=null`，不生成 execute admission。
- [x] **AC4**：root `/` 不可达旧归因 Workbench；现有通用 run effective-config helper 仅保留为共享 route
  characterization，不再由用户页面直接调用。
- [x] **AC5**：focused Web/Platform tests、Web/Platform typecheck、scoped Biome 与 `git diff --check` 通过。
- [x] **AC6**：只读 inventory 明确区分 product-only、shared/protected 与 ambiguous generic data；本任务 diff
  不含 migration、DELETE、purge 或历史 Artifact 清理。
- [x] **AC7**：controlled-attribution 与通用 Run/Artifact/账务/身份/审计源码和测试仍存在；任务报告明确完整
  destructive cleanup 仍为 HOLD。

## References

- Parent: `../08-21-qa-adaptive-activity-unified-analysis/{prd,design,implement}.md`
- Backend specs: `workspace-identity-billing.md`, `agent-team-runtime.md`, `error-handling.md`,
  `quality-guidelines.md`
- Frontend specs: `component-guidelines.md`, `type-safety.md`
