# 本地环境超级管理员同步技术设计

## 1. 边界与数据流

```text
.env.local / .env
  -> local-dev-runtime 严格合并
  -> DATA_AGENT_LOCAL_SUPERADMIN_SYNC=YES
  -> local superadmin sync CLI/service
  -> PostgreSQL local/executor/deployment guard
  -> [无管理员] existing bootstrap transaction
     [唯一管理员] compare normalized email/username + verify credential
  -> governed local credential sync
  -> Better Auth username/password + session revoke
  -> PostgreSQL operation receipt/audit
  -> 返回 principal_id + workspace_id（无 Secret）
  -> 仅注入本次 pnpm dev 子进程环境
```

Better Auth 继续拥有 credential/session，PostgreSQL 继续拥有 active user、system role、
workspace 与 capability。同步结果只提供数据库已经证明的 ID，不从 `.env` 接受 role、
principal 或 workspace UUID。

## 2. 配置契约

同步器集中解析以下配置，未知配置不进入输出：

- `DATA_AGENT_LOCAL_SUPERADMIN_SYNC`：精确为 `YES` 才启用；
- `DATA_AGENT_BOOTSTRAP_EMAIL`：规范化为小写，3–320 字符；
- `DATA_AGENT_BOOTSTRAP_USERNAME`：规范化为小写，3–30 字符，只接受
  `[A-Za-z0-9_.]`；
- `DATA_AGENT_BOOTSTRAP_NAME`：1–128 字符，仅首次创建使用；
- `DATA_AGENT_BOOTSTRAP_PASSWORD`：必须为非空字符串，不设置实际可达的最大字符数；
- workspace slug/name：沿用 bootstrap 默认值。

禁用返回 `SKIPPED`；启用但配置非法返回
`DEV_SUPERADMIN_SYNC_CONFIGURATION_INVALID`。结构化结果只含 terminal、reason code、
email、principal/workspace ID 和 `CREATED|UPDATED|UNCHANGED` action，不含密码或哈希。

## 3. 数据库选择与安全 Guard

同步开始后在同一 client 验证：

1. `NODE_ENV !== production`；
2. `session_user = current_user = postgres`；
3. 配置 deployment mapping active，app id 为 Data Agent，environment 精确为 `local`；
4. app lifecycle active；
5. active superadmin 数量只能是 0 或 1。

已有管理员时，`app_users.email` 与 auth user email 必须在更新前一致，配置的新邮箱不能被其他
账号占用；工作空间 slug 必须解析到 active workspace，且该管理员拥有未撤销的 system override owner membership。
任何歧义返回稳定 HOLD/non-zero，不修改数据。

## 4. 10634 Username Migration

新增 content-addressed `20260725010634_app_data_agent_username_login`，不修改已登记的 10627：

- `data_agent_auth."user"` 增加 nullable `username` 与 `displayUsername`，并为规范化 username
  建立唯一约束；字段名与 Better Auth 1.6.23 username plugin schema 精确一致；
- `app_data_agent.app_users` 增加 nullable `username`、格式 CHECK 和
  `(app_id, environment, username)` 唯一约束，使管理目录与审计可引用业务身份镜像；
- clean install 的新账号必须写入 username；既有本地账号先保持 nullable，由显式 local
  sync 补齐，不伪造不可知的用户名；
- 新增只允许 `session_user=current_user=postgres`、deployment environment=`local` 且显式
  transaction GUC 开启的 narrow sync function；它锁定唯一 active superadmin，原子更新 auth
  username/app user username/password hash、提升 authz epoch、删除 session，并追加不含 Secret
  的 immutable receipt/audit；
- 普通应用角色不获得该函数 EXECUTE，公开 auth route 也不暴露 sync。

迁移提供 source segments、renderer、checksum ledger、postcondition 与 static-check 注册。

## 5. 创建与更新事务

### 5.1 Create

零 active superadmin 时复用当前 bootstrap 逻辑：创建带 username 的 Better Auth
user/account、workspace，
再调用 `app_data_agent.bootstrap_super_admin`。保留 advisory lock、唯一 active superadmin
检查和 bootstrap audit；bootstrap 输入/audit 增加规范化 username，但不包含密码。

### 5.2 Unchanged

比较 auth/app user 中的规范化 username，并使用 Better Auth 的密码校验实现验证 hash。
两者都匹配时立即返回，不调用 sync function、不删除 session、不改变 authz epoch。

### 5.3 Email/username/password update

username 或密码不匹配时，在一个数据库事务内：

1. CLI 用 Better Auth `hashPassword` 生成新 hash，但不输出；
2. 设置 transaction-local sync GUC；
3. 调用 10635 更新后的 narrow sync function，传入 deployment、新邮箱、规范化 username、新 hash、
   operation id 和非敏感 idempotency key；
4. 数据库重新锁定并验证唯一 active superadmin、邮箱唯一性、workspace 和 executor，更新两份
   email/username 镜像与 credential，提升 epoch、撤销 session、写入 receipt/audit；
5. 提交并返回 `UPDATED`。

任一步失败整体回滚，公开输出只有 `DEV_SUPERADMIN_SYNC_FAILED`。密码和哈希不进入 command、
receipt、audit、runtime log 或测试快照。username 变化属于凭证标识变化，必须出现在 audit
的非敏感 before/after username 字段中。

## 6. 邮箱或用户名登录

Server auth config 加载 `username()`；client 加载 `usernameClient()`。登录表单只提交一个
`identifier`：

- 去空白后包含 `@`：调用 `authClient.signIn.email`；
- 否则：规范化小写后调用 `authClient.signIn.username`；
- 两条路径统一 `rememberMe=true`、成功跳转 `/workspaces`，失败统一显示“邮箱、用户名或
  密码不正确，或账号已停用”，不根据 401/422 区分账号存在性。

Better Auth username plugin 保持默认 3–30 长度、ASCII 字母/数字/下划线/点 validator 和
lowercase normalization。`is-username-available` endpoint 不在 UI 暴露；创建用户仍通过受
保护的超级管理员 API，由数据库唯一约束做最终并发裁决。

## 7. 本地运行时集成

`local-dev-runtime.ts` 增加纯配置判定/环境绑定 helper 和 `admin-sync` command。`dev` 流程为：

```text
infra -> optional admin sync -> authority/ledger/port check -> apps
```

`check` 仍直接执行只读 readiness，不调用同步。同步返回的 workspace/principal 只覆盖传给
readiness 与三个 child process 的内存 environment：

- `SEMANTIC_TENANT_ID` / `SEMANTIC_PRINCIPAL_ID`
- `WORKER_TENANT_ID` / `WORKER_PRINCIPAL_ID`
- `TEST_CENTER_TENANT_ID` / `TEST_CENTER_PRINCIPAL_ID`

这消除 bootstrap 随机 UUID 与旧 safe defaults 的漂移，不持久化派生 ID。

## 8. 错误与输出

稳定错误至少覆盖：

- `DEV_SUPERADMIN_SYNC_CONFIGURATION_INVALID`
- `DEV_SUPERADMIN_SYNC_PRODUCTION_FORBIDDEN`
- `DEV_SUPERADMIN_SYNC_EXECUTOR_UNSAFE`
- `DEV_SUPERADMIN_SYNC_DEPLOYMENT_INVALID`
- `DEV_SUPERADMIN_SYNC_AMBIGUOUS`
- `DEV_SUPERADMIN_SYNC_EMAIL_CONFLICT`
- `DEV_SUPERADMIN_SYNC_EMAIL_STATE_INVALID`
- `DEV_SUPERADMIN_SYNC_USERNAME_INVALID`
- `DEV_SUPERADMIN_SYNC_USERNAME_CONFLICT`
- `DEV_SUPERADMIN_SYNC_WORKSPACE_INVALID`
- `DEV_SUPERADMIN_SYNC_FAILED`

CLI 捕获内部 cause，但只输出白名单 reason code；不输出原始数据库错误。

登录路径不把 Better Auth 的 `USER_NOT_FOUND`、username 长度或 credential 细节直接显示给
浏览器，统一为现有认证失败文案。

## 9. 兼容、回滚与风险

- 开关默认关闭，回滚只需移除/关闭 `DATA_AGENT_LOCAL_SUPERADMIN_SYNC`；现有 bootstrap、
  `dev:check`、Docker deploy 路径不受影响。
- 10634 扩展私有认证 schema、app-global username 镜像和 postgres-only local sync function；
  10635 在相同安全边界内增加邮箱镜像同步；两者都不新增公开业务 HTTP route。
- 最大风险是启动时意外旋转登录标识或密码；显式开关、local deployment、唯一管理员、目标
  邮箱唯一性和 hash compare 五层门禁共同降低风险。
- username plugin 可以独立回滚应用代码，但数据库 nullable 字段、receipt 与 audit 保留；
  已设置 username 不影响邮箱登录。
- 10635 仅扩展 postgres-only 的本地受审计同步函数，邮箱更新与 username/password 更新保持
  同事务；不开放 HTTP identity mutation。

## 10. 稳定 Principal 与积分账户

认证链固定为 `auth user id -> app_users.principal_id`。username 是可更新登录标识，不参与
积分、membership、Run 或账单主键。超级管理员创建用户时，Better Auth 成功创建 auth user
后由 identity command 写入 `app_users`；既有 `app_users_ensure_credit_account` trigger 使用
同一 principal 创建 `credit_accounts`。数据库写入失败时继续清理刚创建的 auth user，不能
留下无业务 principal 的可登录账号。

用户目录投影同时返回 username、principal、角色和积分账户是否存在；不返回余额以避免把
身份目录扩张成账务接口。余额仍通过 personal credit API 读取。

## 11. Agent/LLM 计费组合

浏览器只提交问题、workspace 和 datasource/conversation 绑定。服务端会话解析得到的
principal 写入 Run；Worker 领取任务后必须从权威 Run 重新得到 owner principal 并解析该
principal 的实时 workspace capability，不能用 `WORKER_PRINCIPAL_ID` 作为业务消费者。

真实模型调用统一走下列顺序：

```text
Run owner principal
  -> research MODEL reservation/invocation authority
  -> model billing authorize(principal, workspace, run, profile, budget)
  -> Provider stream（只有 authorize 允许后）
  -> immutable terminal usage
  -> model billing finalize
  -> credit hold settle/release/review + bill + ledger
```

Worker 的静态 principal 只作为受信服务启动/发现身份；每个 Run 的业务 authority 与账务
context 都必须切换为 Run owner 并在 PostgreSQL 事务内重验。若当前 queue lease 未携带
principal，扩展 lease 投影从 `runs.principal_id` 返回只读 `principal_id`，并在 heartbeat、
event、terminal 操作中校验 lease scope/run/principal 一致。

Provider 抛错但已可能产生用量时不能释放 hold，必须标记 `OUTCOME_UNKNOWN`/review；只有明确
未开始调用才允许 release。余额不足、价格/FX/profile 不完整或 principal 不匹配均在 Provider
前失败关闭。
