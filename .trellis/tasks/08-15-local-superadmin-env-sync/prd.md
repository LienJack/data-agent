# 本地环境超级管理员同步

## Goal

让本地开发者只需在 Git 忽略的 `.env` / `.env.local` 中显式配置超级管理员，执行
`pnpm dev` 时即可创建或同步该账号，并允许登录页使用邮箱或唯一登录用户名认证；同时保留
PostgreSQL 业务权限权威、Better Auth 凭证边界和生产环境失败关闭。

## Background

- 当前 `apps/web/src/cli/bootstrap-superadmin.ts` 只允许在不存在 active `SUPER_ADMIN`
  时创建首个管理员；重复执行稳定返回失败，不能更新既有密码。
- 当前本地数据库已有一个 active、Better Auth 已关联的 `SUPER_ADMIN`，但 `.env` 不会
  改变其凭证；认证表也没有唯一 username 字段，登录页只调用 email endpoint。
- `scripts/local-dev-runtime.ts` 已拥有 `.env.local > .env > safe defaults` 的本地配置合并
  和 `pnpm dev` 编排，但 `dev:check` 按规范必须保持只读。
- 登录邮箱和密码由 Better Auth 验证；`app_users.system_role`、workspace membership 与
  capability 仍由 PostgreSQL 在事务内重验。

## Requirements

### R1 显式本地开关

- 仅当 `DATA_AGENT_LOCAL_SUPERADMIN_SYNC=YES` 时启用同步。
- 同步配置使用 `DATA_AGENT_BOOTSTRAP_USERNAME`，并复用现有变量：
  `DATA_AGENT_BOOTSTRAP_EMAIL`、`DATA_AGENT_BOOTSTRAP_NAME`、
  `DATA_AGENT_BOOTSTRAP_PASSWORD`、`DATA_AGENT_BOOTSTRAP_WORKSPACE_SLUG` 和
  `DATA_AGENT_BOOTSTRAP_WORKSPACE_NAME`。
- username 长度为 3–30，只接受英文字母、数字、下划线和点，统一规范化为小写并在同一
  auth store 中全局唯一；显示名称仍允许重复且不能用于登录。
- 密码只要求非空，不设置实际可达的最大字符数；变量缺失或其他配置非法时使用稳定 reason code 非零退出。

### R2 本地与数据库安全边界

- 仅允许非 production、deployment environment 为 `local`、且数据库执行身份为
  `session_user=current_user=postgres` 的同步。
- 不新增 HTTP bootstrap/sync route，不把 `.env` role、principal 或 workspace 声明当成
  capability 权威。
- 不记录、返回或测试快照化密码、密码哈希、Cookie、DSN Credential 或 API Key。

### R3 创建与幂等同步

- active `SUPER_ADMIN` 为零时，复用现有受控 bootstrap 创建 auth user、app user、主工作
  空间与 owner override membership。
- active `SUPER_ADMIN` 恰好为一时，比较规范化 email、username 与密码哈希；三者未变化则
  返回 `UNCHANGED`，不得提升 epoch、撤销 session 或追加重复 audit。
- email、username 或密码变化时走受审计的本地凭证同步数据库入口，原子更新 auth/app user
  邮箱镜像、username 和 password credential，提升 authz epoch 并撤销全部旧 session；不得
  直接伪造业务权限。
- active 超级管理员超过一个、目标邮箱已被其他账号占用、目标工作空间不存在/已归档或
  membership 不匹配时失败关闭，不猜测目标。

### R4 本地启动集成

- 新增可单独运行的 `pnpm dev:admin-sync`，便于显式同步和诊断。
- `pnpm dev` 在 `dev:infra` 完成、`dev:check` 之前按开关调用同一同步实现；未启用时完全
  保持现有启动行为。
- `pnpm dev:check` 保持只读，不创建用户、不更新密码、不撤销 session。
- 同步成功后，从 PostgreSQL 取得配置工作空间及管理员 `principal_id`，只在本次进程环境
  中设置 Web/Worker/Semantic/Test Center 的 tenant/principal 绑定，使 Authority check 与
  三个子进程使用同一数据库权威映射；不把生成 ID 回写 `.env`。

### R5 文档与兼容

- 更新本地开发和工作空间运维 Runbook，提供无 Secret 的变量名、启停语义、失败矩阵和
  手动同步命令。
- 保留 `pnpm bootstrap:superadmin` 的 one-shot clean-install 语义，并要求首次创建提供唯一
  username；生产部署和 `docker:up` 不自动同步管理员。

### R6 邮箱或用户名登录

- Better Auth server 启用锁定版本自带的 username plugin，client 启用对应
  `usernameClient`；不自建密码校验或 session token。
- 新增 `10634` checksum migration，为私有 auth user 和 app-global `app_users` 添加规范化
  username、唯一约束、索引和受控本地同步入口；不修改已登记的 `10627`。
- 登录页只有一个“邮箱或用户名”输入框：包含 `@` 时调用 email 登录，否则调用 username
  登录；两种失败都显示相同的脱敏文案，不能泄漏账号是否存在。
- 超级管理员创建普通用户时必须提供唯一 username；认证记录和 PostgreSQL app user 在同一
  业务操作中保持一致，用户名冲突返回稳定错误。

### R7 用户、角色、积分与 Agent 计费贯通

- username 只是 Better Auth 登录标识和 `app_users` 目录镜像；用户的稳定业务身份始终是
  `principal_id`。修改 username、显示名称或密码不得创建新 principal、积分账户或历史账单。
- 超级管理员创建任意普通用户或管理员用户时，必须在同一业务成功链中得到唯一
  `app_users` 记录；现有 `app_users_ensure_credit_account` 数据库触发器必须以同一
  `(app_id, environment, principal_id)` 创建唯一全局积分账户。
- 工作空间角色继续由 membership 决定；登录 username、显示名称和 `.env` 都不能声明角色。
- 用户发起问答 Run 后，`runs.principal_id`、`workspace_run_bindings.principal_id`、模型调用、
  hold、bill、usage 与 ledger 必须始终是同一个会话解析 principal，不得使用固定 Worker
  principal 代扣其他用户积分。
- 任何真实 Agent/LLM Provider 调用必须先通过 PostgreSQL model billing authorize；普通用户
  在 `ENFORCED` 模式冻结自己的积分，余额不足时 Provider 不得调用；终态必须按实际 usage
  settle/release/review。`SUPER_ADMIN` 继续生成 `SYSTEM_FUNDED` bill，不扣用户积分但保留用量。

## Acceptance Criteria

- [ ] AC1：开关未启用时，本地运行时不调用同步器，既有测试和启动拓扑不变。
- [ ] AC2：空库迁移完成后，合法 `.env` 配置可由 `dev:admin-sync` 创建唯一 active
  `SUPER_ADMIN`，其邮箱或唯一 username 均可在 `/login` 使用同一密码登录。
- [ ] AC3：相同配置重复同步返回 `UNCHANGED`，管理员、session、authz epoch、receipt 和
  audit 数量不变。
- [ ] AC4：修改 `.env` email、username 或密码后再次同步，旧登录标识/旧密码失败、新凭证成功、
  旧 session 被撤销，并且 PostgreSQL receipt/audit 形成一条可审计成功链。
- [ ] AC5：邮箱冲突、多 active superadmin、非 local deployment、production、非 postgres
  executor、非法/缺失配置均以稳定 reason code 失败，输出不包含 Secret。
- [ ] AC6：启用同步的 `pnpm dev` 使用数据库返回的 workspace/principal 通过 Authority
  门禁；Web、Worker、Indexer 启动后 `/`、`9091/live`、`9090/live` 均为 HTTP 200。
- [ ] AC7：`pnpm dev:check` 的只读契约由测试锁定；不会因新增能力产生用户、凭证或 session
  写入。
- [ ] AC8：定向 unit/typecheck/lint、真实 PostgreSQL 集成和实际登录验证通过；任何输出与
  测试 fixture 不包含真实 `.env` 密码。
- [ ] AC9：普通管理员创建用户时 username 必填且唯一；重复、大小写冲突、非法字符、过短或
  过长均在认证/数据库写入前失败关闭。
- [ ] AC10：创建普通用户后，`app_users.principal_id = credit_accounts.principal_id` 且只有一个
  积分账户；更改该用户登录 username/密码后 principal、余额、账本和角色均不变。
- [ ] AC11：两个用户在同一工作空间分别发起 Run，Run、模型 bill、hold、usage 和 ledger
  分别绑定各自 principal，不得串账；固定 Worker 启动身份不能替代 Run owner。
- [ ] AC12：`ENFORCED` 下余额不足会在 Provider 前失败；余额充足的真实调用形成
  authorize -> provider -> terminal usage -> settle/release/review 链，余额变化等于权威账单；
  `SHADOW` 和 `SYSTEM_FUNDED` 仍形成账单但按既有规则不扣普通积分。

## Out of Scope

- 用 `.env` 自动修改既有超级管理员系统角色或工作空间角色。
- 多超级管理员之间的目标选择、批量同步或生产环境 GitOps 身份管理。
- 自动登录、绕过 Better Auth、在浏览器保存明文密码或开放自助注册。
- 启动时自动执行 SQL migration，或把本地生成 ID 写回配置文件。
- 使用可重复的显示名称登录、用户名找回/改名 UI、公开 username availability endpoint。

## Key Decisions

- 本地唯一 active 超级管理员是同步目标；邮箱与唯一 username 都是可由本地同步器更新的登录标识。
- username 统一小写，3–30 字符，只接受 `[A-Za-z0-9_.]`；显示名称不参与认证。
- 同步必须显式开关、仅本地执行；`dev:check` 继续严格只读。
- 复用 Better Auth username plugin，不自建密码/session 状态机；PostgreSQL继续保存业务身份
  镜像和审计证据。
