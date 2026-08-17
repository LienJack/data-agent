# 工作空间路由与侧栏统一

## Goal

把旧的全局业务页面迁入显式的工作空间 URL，使页面只有在服务端确认当前用户可访问该工作空间后才能使用；同时在所有工作空间业务页恢复并持续显示现有可折叠左侧栏，避免工作空间页面退回成顶部导航。

## Background and Confirmed Facts

- 当前根布局由 `AppShell` 包装，但 `apps/web/src/components/layout/app-shell.tsx:23-30` 明确跳过全部 `/w/*` 路由，因此工作空间页面没有旧工作台侧栏。
- 现有 `apps/web/src/app/w/[workspaceId]/layout.tsx:18-30` 已在服务端解析登录会话、工作空间列表和 capability；无权访问时会跳转到 `/workspaces`。
- 同一工作空间布局在 `apps/web/src/app/w/[workspaceId]/layout.tsx:32-62` 另外实现了一套顶部导航，和左侧栏形成两个并行导航模型。
- 旧侧栏链接在 `apps/web/src/components/layout/sidebar.tsx:107-115`、`apps/web/src/components/layout/sidebar.tsx:216-218` 和 `apps/web/src/components/layout/sidebar.tsx:270-277` 写死为全局路由。
- 客户端工作空间解析器会优先读取 `/w/:workspaceId`，但在非工作空间路由会回退到 `sessionStorage`（`apps/web/src/lib/api-client.ts:28-41`）；这使旧全局页面仍可能借用上一次工作空间继续访问。
- 已有工作空间页面 `/w/[workspaceId]/analysis`、`qa`、`results`、`semantic`、`data-sources`、`members`、`platform-settings`，其中多个页面直接复用旧页面组件；Data Link 与语义子页面尚未完整建立工作空间子路由。
- `/workspaces` 已处理登录、无工作空间、单工作空间自动进入和多工作空间选择（`apps/web/src/app/workspaces/page.tsx:6-66`）。

## Requirements

### R1. 工作空间成为业务页面的唯一运行上下文

- 归因分析、对话分析、能力测试、数据源、数据语义、语义治理及其已存在的子页面必须使用 `/w/:workspaceId/*` 规范 URL。
- 规范入口固定为 `/w/:workspaceId/analysis`、`qa`、`tests`、`data-sources`、`data-link`、`semantic` 和 `platform-settings`；既有 `/w/:workspaceId/results` 仅作为兼容别名跳转到 `tests`。
- 页面及其内部链接、按钮跳转、会话列表跳转不得返回 `/qa`、`/tests`、`/data-sources`、`/data-link`、`/semantic` 等全局业务 URL。
- 工作空间 ID 以当前 URL 动态段和服务端授权结果为准，不得通过旧全局页面复用 `sessionStorage` 中的工作空间 ID 来绕过选区。
- `/`、`/qa`、`/tests`、`/data-sources`、`/data-link/**`、`/semantic/**`、`/settings` 统一临时重定向到 `/workspaces`；不自动沿用最近工作空间。若账号只有一个工作空间，沿用 `/workspaces` 已有的自动进入逻辑。
- 未登录访问工作空间页时进入登录页；无该工作空间权限时进入工作空间选择页；不得泄露目标工作空间内容。

### R2. 工作空间页面统一使用左侧栏

- `/w/:workspaceId/*` 业务页持续显示现有可折叠左侧栏，视觉结构与用户截图中的工作台一致。
- 左侧栏所有业务链接保留当前 `workspaceId`，并正确标记当前项。
- “新建业务问题”、最近对话、当前分析等快捷入口保留当前 `workspaceId`。
- 工作空间名称、角色和“切换工作空间”入口应在统一外壳中可见；不得保留一套重复的顶部业务导航。
- 左侧栏只展示当前 capability 允许访问的入口；权限来源仍为服务端解析的 `WorkspaceAccessProjection`，不由客户端猜测角色。

### R3. 路由覆盖完整

- 为目前仍只有全局实现的 Data Link 与语义子页面补齐对应的工作空间路由。
- 搜索所有硬编码全局业务链接并改为工作空间感知链接。
- 平台级管理路由 `/admin/*`、身份路由 `/login`、工作空间选择 `/workspaces` 不纳入工作空间业务路由迁移。

### R4. 保持现有业务行为

- 只改变业务页面的路由归属和外壳，不重写 Run、对话、数据源、语义、测试中心的业务逻辑。
- 保持工作空间 API、SSE 事件流、会话持久化及现有 capability 校验契约不变。
- 不修改与本任务无关的并行未提交文件。

## Acceptance Criteria

- [x] 访问任一规范工作空间业务 URL 时，服务端先验证会话和工作空间访问权；无权用户不能看到页面内容。
- [x] `/w/:workspaceId/analysis`、`qa`、`tests`、`data-sources`、`data-link`、`semantic`、`members`、`platform-settings` 及已迁移子页面都显示同一套可折叠左侧栏。
- [x] 左侧栏和页面内部导航产生的 URL 始终包含当前 `workspaceId`，不会回到旧全局业务 URL。
- [x] 切换工作空间后，导航、会话、数据请求与页面 URL 同步使用新工作空间，不沿用旧工作空间数据。
- [x] 旧全局业务 URL 全部返回到 `/workspaces`，不从 `sessionStorage` 恢复工作空间；单工作空间账号仍由选择页自动进入。
- [x] Viewer、Analyst、Workspace Admin、Super Admin 的入口可见性继续服从服务端 `allowed_actions`。
- [x] 登录页、工作空间选择页与 `/admin/*` 不错误显示工作空间业务侧栏。
- [x] 针对路由生成、权限过滤、旧 URL 行为和关键内部跳转增加或更新自动化测试。
- [x] Web 包定向 lint/typecheck/test 通过；若全仓检查受并行修改影响，单独记录且不归因于本任务。

## Out of Scope

- 新增或重定义工作空间角色、WorkspaceAction、计费权限。
- 重做截图中的业务页面内容、Run 投影或 SSE 协议。
- 将 `/admin/*` 强制绑定到单一工作空间。
- 清理本任务以外的既有脏工作树。

## Notes

- 这是跨路由、服务端授权布局、客户端导航和回归测试的复杂任务；最终规划需要 `design.md` 与 `implement.md`。
