# 入口与工作空间页面重构

## Goal

将登录、Workspace 选择和 Workspace 首页改造成内容优先、任务导向的蓝色 Apple/OpenAI 入口体验。

## Requirements

- 登录页使用深蓝黑身份区与清晰表单状态。
- Workspace 选择改为最近访问式列表，不使用通用等宽卡片阵列。
- Workspace 首页突出继续工作、进行中运行、待治理事项和健康状态。
- 保留身份、角色、Greenfield Journey 与真实导航能力。

## Acceptance Criteria

- [ ] 桌面与 390px 登录、选择和首页视觉/状态通过。
- [ ] Loading、Empty、Error、Permission 状态完整。
- [ ] focused test、typecheck、build 通过并 scoped commit。

## Out Of Scope

- 不改变登录接口、Workspace 路由和 Journey authority。
