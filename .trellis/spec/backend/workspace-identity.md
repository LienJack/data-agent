# 工作空间、身份与商业归档权威

> 本规范冻结 Workspace/RBAC、身份管理与已退役商业数据的当前边界。商业能力不是产品能力，
> 历史表只作为 PostgreSQL 只读归档存在。

## 1. Scope 与术语

- 产品和公共 API 只使用 `workspace` / `workspace_id`，中文统一为“工作空间”。
- `workspace_id` 与 PostgreSQL `tenant_id` 一一对应，不增加 `project_id` 或第二级容器。
- Workspace 业务对象显式包含
  `app_id + tenant_id + environment + object_id`。
- 用户、认证映射、Model Control 等 app-global 私有控制面对象至少包含
  `app_id + environment`；用户对象还包含稳定 `principal_id`。
- app-global 对象不得伪造“系统工作空间”。

## 2. 身份与 Authority

- Cookie session 只证明 auth user id。服务端从 `app_users` 解析稳定 `principal_id`，再从受保护
  route 解析 `workspace_id`。
- 客户端 Header、JSON、Cookie Cache 中的 role/principal/workspace 声明不能直接签发
  `AppCapability`。
- 每次受保护事务重验 user status/epoch、workspace lifecycle/version、membership role/version、
  app lifecycle/epoch 与 deployment mapping。
- 账号停用、系统角色变化、成员撤销/角色变化和 workspace 归档必须单调提升对应 version；旧
  capability 立即失败关闭。
- 对无成员 workspace、跨 workspace object id 和不存在对象统一返回
  `WORKSPACE_ACCESS_DENIED`，公开响应不区分目标是否存在。

## 3. 角色矩阵

| 操作 | SUPER_ADMIN | WORKSPACE_ADMIN | ANALYST | VIEWER |
| --- | --- | --- | --- | --- |
| 创建/归档/恢复 workspace | 允许 | 拒绝 | 拒绝 | 拒绝 |
| 创建/停用/重置用户 | 允许 | 拒绝 | 拒绝 | 拒绝 |
| 管理当前 workspace 成员 | 允许 | 允许 | 拒绝 | 拒绝 |
| 管理 datasource/SecretRef | 允许 | 允许 | 拒绝 | 拒绝 |
| 管理 Provider 与 Model Control | 允许 | 拒绝 | 拒绝 | 拒绝 |
| 编辑语义候选 | 允许 | 允许 | 允许 | 拒绝 |
| 创建分析运行 | 允许 | 允许 | 允许 | 拒绝 |
| 查看 workspace 结果 | 允许 | 允许 | 允许 | 允许 |

产品角色映射固定为：`WORKSPACE_ADMIN -> OWNER`、`ANALYST -> ANALYST`、
`VIEWER -> VIEWER`。`SUPER_ADMIN` 可获得 owner override，但不能绕过 workspace scope 或审计。

## 4. 幂等管理命令

- Identity、Workspace、Member 与 Model Control mutation 接受
  `operation_id + idempotency_key`，并绑定 app/environment/actor scope。
- 规范输入由 PostgreSQL `platform.canonical_sha256(jsonb)` 计算；调用方 hash 不构成权威。
- 同键同载荷稳定重放同一 receipt；同键异载荷返回稳定 conflict reason code。
- 业务状态、operation receipt 与 immutable audit 在一个 PostgreSQL 事务提交。
- Better Auth 密码/session 副作用未完成时 receipt 保持
  `PENDING/RETRY_REQUIRED/FAILED`；Data Agent 状态先失败关闭。

## 5. 商业数据归档

- `10703` 之后，历史 price/FX/credit/hold/bill/audit 表只读冻结；产品、Worker、Web API 与
  application role 没有读写入口。
- 旧商业 RPC、helper、trigger 与 grant 必须从当前 catalog 删除，不得保留 wrapper、redirect、
  alias 或双写。
- `commercial_archive_retirement_receipts` 保存 22 张历史表在退役时的 row count 与内容 digest；
  receipt 自身不可变。
- Model Control 使用独立的 `model_control_operations` 与 `model_control_audit_log`，不得读取或写入
  历史商业表。
- 本项目不迁移、回填或转换历史商业数据。历史 migration 文件保持不可变，只允许 forward
  correction。

## 6. 必需验证

- Strict schema 对未知字段、角色与状态失败关闭。
- PostgreSQL 双连接覆盖权限撤销、workspace 归档和幂等命令竞争。
- Migration inventory 证明每张业务表是 workspace-scoped 或明确 app-global 例外。
- PostgreSQL 17 smoke 在 `10703` 前插入非空历史行，应用 migration 后逐字节比较行内容，并证明
  所有归档写入返回 `COMMERCIAL_ARCHIVE_READ_ONLY`。
- Model Control 必须能在没有价格、汇率、积分和账单状态时创建、激活和读取模型。
- 开发库 schema/ledger 漂移时重建明确的数据卷，不实现旧数据 backfill 或在线升级。
