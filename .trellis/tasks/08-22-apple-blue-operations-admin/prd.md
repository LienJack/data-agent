# 运营与管理页面重构

## Goal

完成 Data Sources、Tests、Jobs、Members、Settings 与 Admin 页面族的统一蓝色运营工作台，并收口 system dark theme。

## Requirements

- Data Sources 以连接列表为主，新增连接使用上下文表单/Sheet。
- Tests 拆分 Suite、Case、Run Config、Result Inspector 的视觉层级，不改变评测合同。
- Jobs 使用行 Skeleton 和可展开状态；Members/Settings/Admin 共用控制面布局。
- 提供 system/light/dark token，暗色不依赖反转滤镜且保持状态对比度。

## Acceptance Criteria

- [ ] 所有运营/管理页面状态、桌面/移动、light/dark 视觉通过。
- [ ] Attempt 0/1、PASS/FAIL、HOLD、认证与 authority 语义保持准确。
- [ ] 全站 unit、typecheck、build、responsive、a11y 检查与 scoped commit 通过。

## Out Of Scope

- 不改变安装、运行、计费、认证、成员或管理员 API。
