# 技术设计

## 1. 管理读模型

新增 clean-install migration `10633`，只增加 backend 可执行的 `SECURITY DEFINER` 读 RPC：

- `platform.list_admin_users(deployment_id, actor_principal_id)`：仅超级管理员。
- `platform.list_admin_workspaces(...)`：包含 ACTIVE/ARCHIVED 工作空间和成员计数。
- `platform.list_workspace_members(..., workspace_id)`：超级管理员或该空间管理员。
- `platform.read_operations_health(...)`：聚合 identity side effect、价格/汇率同步、账务 review、
  余额异常和 shadow 对账信号，不返回原始 payload 或 secret。

读模型由 contracts strict schema 解码；platform repository 不直读业务表。RPC 固定 app 与
environment，调用人状态和角色在同一数据库调用内验证。

## 2. 身份写编排

复用 `app_data_agent.apply_identity_command`，不建立第二套 RBAC 状态机。Web 服务端编排：

- CREATE_USER：Better Auth 创建凭证账号 → identity command 建立 app user；失败时补偿删除刚
  创建的 auth orphan。初始密码只在当前 HTTPS 响应返回一次，不写日志/receipt。
- DISABLE_USER：identity command 先提高 authz epoch 并进入 RETRY_REQUIRED → Better Auth
  ban/revoke sessions → complete side effect。
- ENABLE_USER：先解除 Better Auth ban，再提交 identity command；identity 失败时账号仍受
  app-user DISABLED 边界保护。
- RESET_USER_PASSWORD：identity command 先失效 capability → Better Auth 设置新密码并撤销
  sessions → complete side effect；新密码仅返回一次。
- Workspace/Member：直接执行数据库权威命令，使用 expected version 和幂等键。

## 3. API 与权限

全局路由位于 `/api/admin/operations/users/**` 和 `/api/admin/operations/workspaces/**`，
统一验证 `SUPER_ADMIN`。成员路由位于
`/api/workspaces/:workspaceId/members/**`，统一验证当前空间 `MEMBER_MANAGE` 对应写 capability；
Repository 内的数据库 RPC 再验证角色，防止路由误配。

公开错误只返回稳定 code、中文消息和 retryable。任何密码、auth hash、数据库错误、命令原始
payload 均不得进入响应日志。

## 4. 界面信息架构

`/settings` 继续作为平台运营控制台，在现有积分、模型计费、价格汇率和语义移植基础上加入：

- `用户与工作空间`：概览指标、用户表、创建账号、停用/启用/重置、空间表、创建/归档/恢复。
- `运营健康`：五类门禁卡片和 review queue 入口。

`/w/:workspaceId/members` 由占位页升级为成员控制台。保持现有低饱和绿色、1px 边框、紧凑
表格和明确空/错/加载状态；窄屏转为卡片，破坏性操作要求填写原因。

## 5. 观测与上线门禁

结构化诊断使用既有 diagnostics channel/JSON event 约定，只记录 ID、状态、reason code 和计数。
Runbook 提供可复制的 clean-install、备份/恢复、shadow reconciliation 和 rollback 命令。自动化
角色矩阵以 repository/API tests 和 PostgreSQL smoke 为权威，浏览器只保留一张关键截图。
