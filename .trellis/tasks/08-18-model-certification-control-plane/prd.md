# 模型认证控制面与前端入口

## Goal

唯一验收目标：点击认证 -> 服务端验证当前模型 API -> 保存认证状态 -> Q&A 模型可选择。

## Requirements

- 仅 `SUPER_ADMIN` 可执行“认证 / 重新认证”。
- 浏览器只提交 profile、当前 config version 和幂等键；API Key 只在服务端读取。
- 服务端只请求一次供应商模型目录；响应格式有效且数组非空即为 `PASS`。
- `PASS` 直接保存在现有模型目录行，绑定当前 config version；配置变化后自动回到待认证。
- 请求失败或空响应不修改旧状态。
- 提交过程中按钮禁用；相同幂等键不重复写入。
- Q&A 根据当前 profile/config 的 `PASS` 状态显示为可选择。

## Acceptance Criteria

- [x] 设置页显示“待认证 / 已认证”和“认证 / 重新认证”。
- [x] 非空 API 响应保存 `PASS`，空响应不保存。
- [x] Q&A 对当前已认证模型返回 `AVAILABLE/selectable=true`。
- [x] 权限拒绝、密钥不出服务端、提交防重复。
- [x] 浏览器验证设置页和 Q&A 状态。

## Out Of Scope

- Job、Worker、Run、Fence、异步进度和恢复机制。
- 认证证书、引用、哈希、历史表和跨 workspace Authority。
- 五项 Smoke、能力/质量/计费证明及 Provider Invocation 重构。
