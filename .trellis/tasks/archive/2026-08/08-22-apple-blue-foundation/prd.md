# 蓝色设计系统与全局外壳

## Goal

建立 Data Agent Blue 设计系统和 Apple/OpenAI 全局外壳，使所有页面共享一致的颜色、材质、字体、圆角、状态和交互反馈。

## Requirements

- 统一 `globals.css` 与 `design-system.css` 的语义 token，主蓝固定为 `#3f63e8`。
- 删除全局 tracking 与圆角强制覆盖，建立可解释的字号/圆角层级。
- 升级 Button、Card、Tabs、Empty/Loading/Error primitives；Loading 使用布局匹配 Skeleton。
- Sidebar 不再在所有页面挂载会话目录；Workspace Topbar 和移动导航使用统一 Floating Chrome。
- 保留路由、store、RBAC 和 Q&A geometry。

## Acceptance Criteria

- [ ] 设计系统 CSS contract 测试覆盖蓝色、材质与无障碍 fallback。
- [ ] Shell 在 1440、1024、768、390px 无溢出，导航状态清晰。
- [ ] Web focused unit、typecheck、build 通过。
- [ ] scoped commit 不包含已有 resolution-trace 与生成物修改。

## Out Of Scope

- 不重构具体业务页面内容，不改变会话数据加载合同。
