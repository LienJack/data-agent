# 工作空间路由与侧栏统一：实施计划

## 1. Route and navigation primitives

- [x] 在 `workspace-navigation.ts` 扩充稳定导航 key 与完整工作空间业务入口，并保持 `allowed_actions` 过滤。
- [x] 新增纯函数工作空间路径构造/解析工具，统一编码和路径归一化。
- [x] 删除 `resolveWorkspaceId()` 的 `sessionStorage` 写入及回退，只接受当前 `/w/:workspaceId`。
- [x] 更新 `workspace-navigation.spec.ts`，覆盖角色过滤、规范路径和导航顺序。

## 2. Workspace shell and sidebar

- [x] 新增 `WorkspaceShell`，组合现有 Sidebar、主内容与 StatusBar。
- [x] 改造 Sidebar 接收服务端验证后的 `WorkspaceAccessProjection`/导航投影；删除全局业务 `navItems`。
- [x] 将 Logo、导航项、新建问题、最近会话、当前分析、切换工作空间全部改为工作空间感知链接。
- [x] 对没有 QA capability 的角色隐藏 QA 快捷区，保持折叠与可访问性行为。
- [x] 把 `/w/[workspaceId]/layout.tsx` 的顶部导航替换为 `WorkspaceShell`，继续保留服务端会话、成员和 capability 校验。

## 3. Canonical workspace pages

- [x] 增加 `/w/[workspaceId]/tests` 并把 `/results` 改为兼容跳转。
- [x] 退役重复的 Data Link 语义列表、编辑和详情入口；旧工作空间 URL 统一跳转到 Node/Edge 语义治理工作台。
- [x] 增加 Semantic Explorer 与 Physical Schema 的工作空间 route wrappers。
- [x] 修复 Data Link、Semantic Editor、Semantic Explorer 内部硬编码全局跳转。
- [x] 全仓搜索并消除 Web 业务 UI 中剩余的旧全局业务链接。

## 4. Legacy route closure

- [x] 在 `next.config.mjs` 配置 `/`、`/qa`、`/tests`、`/data-sources`、`/data-link/:path*`、`/semantic/:path*`、`/settings` 到 `/workspaces` 的 307 重定向。
- [x] 增加配置/路由测试，证明旧 URL 不会根据 `sessionStorage` 自动绑定工作空间。
- [x] 确认 `/login`、`/workspaces`、`/admin/*` 和 `/w/*` 不被错误匹配。
- [x] 确认 `/w/:workspaceId/data-link/*` 保留兼容跳转但不再显示第二套“数据语义”页面。
- [x] 标记旧 Data Link 适配层为 `@deprecated`，活动页面与 Workspace reset 不再引用旧 Store；当前 `/api/semantic/*` 保持服务新 Studio。

## 5. Client-state isolation

- [x] 为 QA、Workbench、Data Source、Data Link、Semantic 工作空间状态提供幂等 reset/bind 接口。
- [x] WorkspaceShell 在 `workspaceId` 变化时重置业务状态，保留纯布局状态。
- [x] 工作空间切换入口使用完整页面导航，经 `/workspaces` 重建客户端运行时，避免旧异步响应写入新工作空间。
- [x] 增加工作空间状态统一清理的隔离测试。

## 6. Validation

- [x] `pnpm --filter @data-agent/web exec vitest run test/workspace-navigation.spec.ts <新增路由与状态测试>`
- [x] 对任务触及文件运行 `pnpm exec biome check <明确文件列表>`。
- [x] `pnpm --filter @data-agent/web typecheck`。
- [x] `pnpm --filter @data-agent/web build`，验证 Next.js 16 动态路由、重定向和 Server/Client 边界。
- [x] 浏览器验收：访问旧 `/qa` 应到 `/workspaces`；进入 `/w/9e0ed5ae-7ab6-4896-b7eb-868e202f3725/analysis` 后左侧栏可见；逐项点击确认 URL 始终保留工作空间 ID。
- [x] 用无权限工作空间验证服务端回退，并用 Viewer、Analyst 与 Workspace Admin 投影单测验证导航过滤。
- [x] 记录定向验证与全仓既有脏改动的边界，不修复无关失败。

## 7. Review and rollback points

- [x] 审核实际 diff 仅按本任务 allowlist 验收；`apps/web/tsconfig.tsbuildinfo` 属于共享工作树且未纳入本任务。
- [x] 复查 `rg` 结果不存在未说明的全局业务链接。
- [x] 若配置级重定向影响开发入口，先撤销重定向单点，不回滚 API/状态逻辑。
- [x] 实现完成后运行 Trellis check；现有前端 spec 足以覆盖本任务，未新增通用规范。

## Validation Evidence

- 2026-08-15：Biome 定向检查 31 个文件通过，无自动修复。
- 2026-08-15：Vitest 4 个文件、11 个测试通过。
- 2026-08-15：`@data-agent/web` TypeScript 检查通过。
- 2026-08-15：Next.js 16 生产构建通过；保留 4 条既有 Turbopack 动态文件追踪警告。
- 2026-08-15：真实浏览器覆盖旧 URL 重定向、规范工作空间页面、子页面、无权限工作空间回退、侧栏折叠/展开与所有侧栏链接。
- 共享工作树含大量其他任务改动；本任务未创建提交，也未归档 Trellis 任务，以免把并行改动纳入提交。
