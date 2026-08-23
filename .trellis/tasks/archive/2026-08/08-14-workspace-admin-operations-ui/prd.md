# 完整管理界面、观测与上线门禁

## Goal

Phase 7：补齐全局与工作空间运营界面、观测指标、角色矩阵和 clean-install 上线证据。

## Requirements

- 超级管理员必须能查看和管理全局用户、工作空间、模型、价格、汇率、积分、账单与
  `REVIEW_REQUIRED` 队列；普通用户不能发现或调用这些全局写入口。
- 超级管理员创建账号时生成一次性初始密码；账号停用、启用、密码重置必须同步处理
  Better Auth 会话，并通过既有 identity operation receipt 留痕。
- 超级管理员可以创建、归档和恢复工作空间；工作空间管理员只能管理当前空间已有用户的
  `WORKSPACE_ADMIN / ANALYST / VIEWER` 成员资格。
- 成员、数据源、语义、Q&A、归因与成本页面必须保持工作空间路由和服务端 capability
  边界；归档空间拒绝写入但保留全局审计可见性。
- 运营视图必须展示价格/汇率同步失败、待完成身份副作用、账务复核、余额异常和 shadow
  对账状态；输出使用稳定 reason code，日志与 UI 不暴露凭据或数据库细节。
- 自动化验收覆盖系统角色、工作空间角色、工作空间切换、直接 URL 越权、会话撤销、并发
  账务和长文本/移动端布局；视觉核对仍只保留一张关键截图。
- 项目按 clean install 验收；允许重建开发数据库，不实现历史 backfill。
- 运维文档覆盖首个管理员、账号停用/启用、价格审批、积分调账、review 处理、shadow →
  enforced、回滚、备份恢复与灾难恢复。

## Acceptance Criteria

- [x] AC1：全局管理员控制台完整展示用户、工作空间、模型/价格/汇率、积分和账务健康，
  非超级管理员的 UI 不展示入口且 API 返回 403。
- [x] AC2：创建、停用、启用、重置密码和会话撤销形成可验证 identity receipt；失败副作用
  保持可重试且不会让停用账号继续访问。
- [x] AC3：工作空间创建、归档、恢复和成员增改删均走数据库权威命令；工作空间管理员不能
  管理其他空间、全局账号或超级管理员角色。
- [x] AC4：运营健康读模型能识别同步失败、待完成副作用、账务 review、余额异常与 shadow
  对账差异，且所有输出深度脱敏。
- [x] AC5：角色矩阵和直接 URL 自动化证明 PRD AC1、AC2、AC5、AC11、AC12、AC17、AC20。
- [x] AC6：clean-install、PostgreSQL smoke、shadow 对账、回滚与备份恢复演练有可复现命令和
  结果证据；只有全部门禁通过才允许启用 `ENFORCED`。
- [x] AC7：全量 lint、typecheck、unit、contract、数据库 smoke 和相关 E2E 通过，无 P0/P1
  安全或数据完整性问题。
- [x] AC8：一张关键截图证明桌面与窄屏层级、长文本和操作状态符合项目既有紧凑低饱和设计。

## Constraints

- Better Auth 只负责凭证和会话；业务角色、工作空间和成员权威仍在 PostgreSQL identity schema。
- 管理 UI 不得成为授权边界；所有写操作服务端重验 session、system role 和 workspace role。
- 计费仍先保持 `SHADOW`；文档和 UI 可以展示切换条件，但不能绕过最终门禁自动启用。
