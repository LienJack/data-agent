# 白蓝主题收口

## Goal

把全站视觉从黑蓝/深色可选主题收口为白色基底、冷浅灰层级与单一 Data Agent Blue 强调色。

## Requirements

- 删除 system/dark 外观入口、持久化脚本与暗色 token，不再跟随系统深色模式。
- 登录页身份区从深海军蓝改为浅蓝白材质，保留原有信息结构和交互。
- 页面、导航、面板与表单继续使用现有语义 token；代码、遮罩、用户消息等功能性深色元素不受影响。
- 同步前端设计规范和主题契约测试，避免黑蓝主题回归。

## Acceptance Criteria

- [x] 根节点始终使用 light color scheme，源码不再包含主题持久化或 dark media token。
- [x] 登录页桌面与 390px 移动视口均为白蓝视觉且无横向溢出。
- [x] 相关设计契约测试、Biome、typecheck 和 production build 通过。

## Notes

- 用户明确要求白色蓝色，而不是黑色蓝色。
- 不改变认证、设置或业务 API。
