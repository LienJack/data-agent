# 工作空间身份与 RBAC

## Goal

交付父任务 Phase 0 与 Phase 1：先冻结 workspace、identity、RBAC、price、FX、credit、
bill 和 semantic import/export 的公共契约与迁移基线，再建立封闭式账号、工作空间实体和
PostgreSQL 事务内重验的权限链，使登录用户只能取得其当前有效工作空间 capability。

## Requirements

- `项目` 不形成第二套标识；所有公共契约统一使用 `workspace_id`，它与现有底层
  `tenant_id` 一一对应。
- 用户是 App/Environment 级全局实体；全局角色只有 `SUPER_ADMIN / USER`，工作空间角色
  只有 `WORKSPACE_ADMIN / ANALYST / VIEWER`。
- 认证采用锁定版本的 Better Auth PostgreSQL + email/password Cookie session；关闭公开
  sign-up 和 impersonation，认证 schema 只能通过审查后的 SQL migration 安装。
- 会话只证明 auth user；业务 `principal_id`、账号状态、全局角色、workspace lifecycle、
  membership version 和 authz epoch 必须由服务端在数据库事务内重验。
- 只有 `SUPER_ADMIN` 能创建、停用、重置用户及创建、归档、恢复工作空间；
  `WORKSPACE_ADMIN` 只能管理当前工作空间中已存在用户的成员关系。
- 停用用户、撤销成员、改变角色或归档工作空间后，旧 session/capability 必须立即失败
  关闭；会话撤销副作用失败必须留下可恢复 operation receipt。
- 复用现有 `memberships` 与 `AppCapability`；产品角色映射到现有
  `OWNER / ANALYST / VIEWER`，不建立平行授权状态机。
- Phase 0 同时冻结后续计费和语义导入导出的 strict DTO、reason code 和精度/状态机术语，
  但本子任务不实现积分、价格同步、账单结算或语义导入执行。
- 保留现有固定 tenant、内存 datasource/model/conversation 的 characterization evidence；
  Phase 2 才切换这些业务 repository，不在本子任务宣称数据隔离迁移已完成。
- 首个超级管理员只能通过受控 CLI bootstrap；不存在公开 HTTP bootstrap 路径。

## Acceptance Criteria

- [x] 公共 DTO 均由 `@data-agent/contracts` 的 Zod 4 `strictObject` 解析；未知字段、未知角色、
  未知状态和不合法 ID 失败关闭，contracts build/typecheck/test 通过。
- [x] `.trellis/spec` 明确 app-global 私有对象例外、workspace 权限矩阵、账务精度与状态机；
  reason code 矩阵和现有表 workspace migration inventory 可审计。
- [x] Better Auth 版本、MIT 许可证以及 PostgreSQL/Next 16/Node 26 兼容证据被记录；生成的
  SQL 被纳入 Data Agent migration，应用启动不自动迁移。
- [x] migration 创建认证私有 schema、`app_users`、`workspaces`、成员扩展字段、lifecycle/
  authz epoch、operation receipt 和 audit；项目按全新 clean install 验证，不承诺保留或
  回填旧开发数据。
- [x] 无 session 的新受保护 resolver 稳定拒绝；客户端伪造 principal、role 或 workspace
  不能获得 capability。
- [x] authority 在同一事务重验 active user、active workspace、global role、membership
  version、user authz epoch、workspace lifecycle version 和 app epoch。
- [x] 用户停用、成员撤销、角色改变、workspace 归档后旧 capability 失败；跨 workspace
  对象探测返回同一无权限结果，不泄露目标是否存在。
- [x] 超级管理员用户/workspace 命令和 workspace admin 成员命令具备 principal-scoped
  idempotency；同键同载荷稳定重放，同键异载荷冲突，并追加不可变 audit/receipt。
- [x] 登录页、工作空间选择器和角色过滤导航骨架存在；只有一个 workspace 时可进入但仍
  可见切换控件，归档 workspace 不出现在普通列表。
- [x] bootstrap CLI 能在受控环境创建首个 active superadmin，并拒绝在已有 active
  superadmin 时无条件重复创建；至少保留一条系统恢复路径。
- [ ] 聚焦 unit/contract/typecheck、migration static check 与相关 PostgreSQL authority
  验证通过；Phase 2 之前旧业务 route 的匿名访问风险被明确记录为未完成项而非静默通过。

## Notes

- 父任务：`08-14-workspace-rbac-model-billing`。
- 本任务只交付父计划 Phase 0/1；Phase 2-7 仍由后续独立子任务承担。
- 项目尚未承载需保留的生产数据；允许重建数据库以换取开发效率，不设计在线升级、旧数据
  回填或无损迁移路径。
- 2026-08-14：本任务定向 gate 与真实 PG17 clean install 已通过；全量 Web lint 仍包含现有
  QA/Data Link 文件的 78 个错误，仓库级 static/smoke 仍被既有
  `u6-c2-physical-schema.test.ts:147` 冻结描述符断言阻断，因此最后一条综合验收保持未勾选，
  不能进入 finish/commit。
