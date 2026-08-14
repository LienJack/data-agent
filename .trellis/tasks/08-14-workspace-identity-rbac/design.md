# 工作空间身份与 RBAC 技术设计

## 1. 边界

本任务新增一条受保护请求链：

```text
Better Auth Cookie -> auth user id -> app_users.principal_id
  -> route workspace_id -> workspace authority transaction
  -> branded AppCapability -> existing scoped repository/port
```

Better Auth 只拥有凭证与 session；Data Agent PostgreSQL 拥有账号状态、全局角色、工作空间
生命周期、成员角色和授权 epoch。浏览器提交的角色、principal 或 workspace 声明不参与
授权。

## 2. Contract 所有权

`packages/contracts/src/workspaces/` 统一拥有：

- workspace/identity/RBAC DTO 和权限动作；
- price/FX/credit/bill 的版本化 strict schema 与判别联合；
- `semantic-workspace-export@1.0.0` 及 import 状态 DTO；
- workspace/auth/billing/import reason code 白名单。

Web、Platform 和 Worker 只 import decoder/infer 类型，不复制字符串枚举。金额使用 decimal
string 或 bigint 可序列化字符串；契约中不使用 JS `number` 表示累计金额。

## 3. 数据库

新增 `10627` app migration，包含：

- 私有 `data_agent_auth` schema 及 Better Auth 1.6.23 生成并审查的 PostgreSQL 表；
- `app_data_agent.app_users`：`app_id + environment + principal_id`、唯一 auth user、
  `system_role`、`status`、`authz_epoch`；
- `app_data_agent.workspaces`：`workspace_id` 即 tenant UUID、`ACTIVE/ARCHIVED`、
  `lifecycle_version`；
- 扩展 `memberships`，保留显式 workspace 角色，并允许 superadmin owner override；
- `identity_operations` / `identity_operation_receipts` / `identity_audit_log`，全部按规范输入
  hash 和 idempotency key 绑定 actor；audit/receipt append-only；
- workspace authority 和管理命令窄函数，均为 `SECURITY DEFINER set search_path=''`，
  只授予精确 function signature。

本项目只支持全新 clean install；不扫描或回填旧开发数据。旧表继续使用 `tenant_id`，但
公共 DTO/API 仅称 `workspace_id`；两者由 resolver 精确比较。开发库如有旧数据，直接重建
数据库，不为在线升级增加兼容分支。

## 4. Authority

Platform 增加 workspace-aware resolver，签发仍是现有 `AppCapability`，但私有 issuance
record 额外冻结 `user_authz_epoch + workspace_lifecycle_version + membership_version +
app_epoch`。每次业务事务通过同一 SQL client 重验这些版本。

映射固定为：

| 产品角色 | Capability role |
| --- | --- |
| `SUPER_ADMIN` | `OWNER` |
| `WORKSPACE_ADMIN` | `OWNER` |
| `ANALYST` | `ANALYST` |
| `VIEWER` | `VIEWER` |

写操作要求 user/workspace/app 均 active。读取归档空间只留给 superadmin 审计；普通成员
resolver 不返回归档空间。拒绝结果统一为 `WORKSPACE_ACCESS_DENIED`，避免对象存在性泄露。

## 5. 身份适配器与 Web

Web 锁定 `better-auth@1.6.23`，使用现有 `pg@8.22.0` Pool 和非默认 auth schema。配置：

- `emailAndPassword.enabled=true`、`disableSignUp=true`；
- 数据库存储 session，不启用 cookie-only authority；
- Admin plugin 只作为服务端凭证管理适配器，禁用/不暴露 impersonation UI/API；
- `/api/auth/[...all]` 只挂载认证端点；业务管理命令仍经 Data Agent authority；
- Next 16 `proxy.ts` 只做导航重定向，安全检查仍在 route/page server boundary 完整执行。

新增 server-only session principal resolver；它把 Better Auth session user id 映射为 active
`app_users`。登录页使用 email/password，工作空间选择页读取服务端解析后的 workspace
projection，导航只消费已解析的角色投影。

## 6. 管理命令

业务状态和 audit 在一个 PostgreSQL 事务完成。Better Auth create/password/session revoke
属于认证适配器副作用，通过 operation receipt 记录 `PENDING/SUCCEEDED/FAILED`；业务
authority 先通过 status/authz epoch 立即失效，后台可安全重试认证副作用。

bootstrap CLI 需要显式环境开关、数据库连接和一次性密码输入，不接受公开请求。它在
事务内证明 active superadmin 不存在，创建 auth user/app user 并记录 receipt；日志不得
打印密码、cookie 或 session token。

## 7. 验证与回滚

- Contract：strict parse、round-trip、未知字段/状态失败。
- Characterization：固定 tenant、内存 datasource/model/conversation 行为被测试锁定。
- Authority：伪 capability、跨 workspace、停用/撤权/归档/epoch 漂移。
- PostgreSQL：clean install、幂等命令竞争、至少一名 superadmin；不验证旧数据回填。
- Web：无 session、sign-up disabled、工作空间选择和角色导航。

回滚应用时保留新 schema 和审计数据；不得重新开放匿名受保护入口。Phase 2 切换业务
repository 前，现有内存 Map 仍只属于已知 legacy 行为，不被本任务声明为持久权威。
