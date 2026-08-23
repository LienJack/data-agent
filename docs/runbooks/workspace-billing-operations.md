# 工作空间、身份与模型计费运维 Runbook

## 1. 适用范围与权威边界

本文覆盖 clean-install 项目的首个管理员、账号与工作空间运维、价格/汇率审批、积分调账、
模型账单复核、`SHADOW → ENFORCED`、回滚、备份恢复与灾难恢复。

- PostgreSQL 是用户状态、工作空间角色、价格版本、积分账本和模型账单的唯一业务权威。
- Better Auth 只负责凭证和会话；不能用 Better Auth 的角色代替 PostgreSQL 授权。
- 管理界面不是授权边界。所有操作仍由服务端会话和 PostgreSQL RPC 重验。
- 本项目只按空库安装验收，不执行历史 backfill。开发环境允许直接重建数据库。
- 不直接更新积分余额、账单、成员或价格版本；只使用管理 UI、API 或权威命令。
- 一次性密码、Cookie、Authorization、API Key、DSN 和原始数据库错误不得进入日志或工单。

## 2. Clean install 与发布前验证

从仓库根目录执行：

```bash
pnpm install --frozen-lockfile
./infra/supabase/test-support/static-check.sh
./infra/supabase/test-support/run-postgres-smoke.sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm --filter @data-agent/web build
```

PostgreSQL smoke 使用一次性 PostgreSQL 17 容器，从空库应用全部迁移。它还会自动完成：

1. migration ledger 和数据库 postcondition；
2. 角色、工作空间隔离、积分并发和模型结算断言；
3. `pg_dump` / `pg_restore` 演练；
4. migration ledger、身份、积分账本和模型账单恢复前后指纹比对；
5. 六项运营 health gate、shadow reconciliation；
6. `ENFORCED → SHADOW` 回滚演练。

成功终态必须同时出现：

```text
Operations release drill passed: clean install, reconciliation, backup/restore, rollback.
Supabase/PostgreSQL smoke assertions passed.
```

本地/部署数据库迁移使用：

```bash
pnpm docker:migrate
pnpm docker:up
docker compose --profile deploy ps
```

不要在非空数据库上盲目重放失败的非幂等 SQL。新项目需要重置时，应创建新的空数据库或
空卷后重新执行 clean install。

## 3. 创建首个超级管理员

仅在空库完成迁移、且系统中尚无超级管理员时执行一次。命令必须使用数据库 `postgres`
超级用户连接；CLI 会再次验证 `session_user` 和 `current_user`。

通过安全的 Secret 注入方式提供以下环境变量：

```bash
export DATA_AGENT_ALLOW_SUPERADMIN_BOOTSTRAP=YES
export DATA_AGENT_BOOTSTRAP_EMAIL='admin@example.com'
export DATA_AGENT_BOOTSTRAP_USERNAME='platform.admin'
export DATA_AGENT_BOOTSTRAP_NAME='Platform Admin'
export DATA_AGENT_BOOTSTRAP_PASSWORD='<secure-secret-12-to-128-chars>'
export DATA_AGENT_BOOTSTRAP_WORKSPACE_SLUG='main-workspace'
export DATA_AGENT_BOOTSTRAP_WORKSPACE_NAME='Main workspace'
pnpm bootstrap:superadmin
unset DATA_AGENT_ALLOW_SUPERADMIN_BOOTSTRAP DATA_AGENT_BOOTSTRAP_PASSWORD
```

`DATABASE_URL`（或 `AUTH_DATABASE_URL`）与 `WORKSPACE_DEPLOYMENT_ID`（或
`SEMANTIC_DEPLOYMENT_ID`）必须已配置。保存成功响应中的 `principal_id`、`workspace_id` 和
receipt 引用；不要记录密码。成功后立即撤销 bootstrap 环境变量，不允许常驻启用。

## 4. 日常管理入口

| 操作 | 页面 | 权限 |
| --- | --- | --- |
| 用户、工作空间、运营健康 | `/settings` 的“组织与运维” | `SUPER_ADMIN` |
| 模型、价格、汇率 | `/settings`、`/admin/pricing` | `SUPER_ADMIN` |
| 积分账户与人工调账 | `/settings` | `SUPER_ADMIN` |
| 账单、成本、review、计费模式 | `/settings` | `SUPER_ADMIN` |
| 当前空间成员 | `/w/:workspaceId/members` | `SUPER_ADMIN` 或该空间 `WORKSPACE_ADMIN` |
| 个人积分与账单 | `/settings` | 当前登录用户 |

普通用户不应看到全局入口；直接调用全局 API 必须返回 403。成员管理 API 还会在进入
repository 前验证当前工作空间写 capability 和 `OWNER` 能力，数据库 RPC 再次重验。

## 5. 用户与会话操作

### 5.1 创建用户

在“组织与运维 → 用户”填写唯一登录用户名、邮箱、显示名和系统角色。创建成功时：

- Better Auth 账号先创建，PostgreSQL app user 后创建；后者失败会清理认证孤儿。
- username 全局唯一、统一小写，只允许 3–30 位字母、数字、下划线和点；邮箱或 username
  均可登录，显示名不能登录。
- `app_users` 成功插入后，数据库按同一 `principal_id` 自动创建唯一积分账户；username、
  显示名和密码变化不改变 principal、角色、积分余额或历史账单。
- 初始密码只在当前 HTTPS 响应显示一次，刷新后不可恢复。
- 使用安全渠道把密码交给用户，并要求首次登录后重置。
- 不在日志、截图、工单或聊天中粘贴一次性密码。

### 5.2 停用用户

1. 在用户列表选择“停用”，填写可审计原因。
2. PostgreSQL 先将 app user 设为 `DISABLED` 并提升 `authz_epoch`。
3. Better Auth 随后执行 ban 和 session revoke。
4. 确认 identity receipt 为 `SUCCEEDED`，并刷新运营健康。

如果认证服务暂时失败，app user 已先失效，旧 capability 不能继续访问。控制台会显示
“待重试”条，恢复认证服务后点击“重试认证副作用”。它会精确重放原
`operation_id + idempotency_key`，不会重复业务状态变更。不要先重新启用账号来规避失败。

### 5.3 启用与密码重置

- 启用：先解除 Better Auth ban，再提交 PostgreSQL 启用命令；数据库失败时会尽力重新 ban，
  app user 仍保持 `DISABLED`。
- 密码重置：PostgreSQL 先提升授权版本，再设置新密码并撤销全部旧会话。新密码只显示一次。
- 副作用失败时使用同一控制台重试条；成功前 `IDENTITY_SIDE_EFFECTS` gate 保持阻断。

## 6. 工作空间与成员

- 只有超级管理员可创建、归档或恢复工作空间。
- 归档拒绝新写入和新运行，但保留全局管理员审计历史。
- 恢复后沿用原成员记录，并按最新 membership/lifecycle/authz epoch 重新授权。
- 工作空间管理员只能管理本空间目录中的已有用户，不能读取全局用户目录、操作其他空间或
  修改超级管理员覆盖角色。
- 撤销成员必须填写原因；撤销后旧 capability 由 membership version 失效。

成员列表中的 `SYSTEM_ROLE` 是超级管理员覆盖关系，不能在工作空间成员页撤销。

## 7. 价格与汇率审批

1. 同步任务只生成候选，不直接改变生效价格。
2. 在 `/admin/pricing` 检查来源、evidence hash、parser version、风险和有效时间。
3. 选择批准或拒绝并填写原因；只有批准会生成新的不可变版本。
4. 确认 `PRICING_SYNC` 没有最近失败，`PRICING_REVIEW` 没有待审批候选。
5. 不直接修改 active pointer、候选状态或版本表。

任何来源失败都保留最后一个 active 版本；先修复同步适配器再重新生成候选。

## 8. 积分调账与账单复核

### 8.1 人工调账

在 `/settings` 的积分面板选择用户，输入带符号的 microcredits、原因和当前 account version。

- 正数为增加，负数为扣减。
- 命令使用 expected version 和幂等键；冲突时刷新后重新决策。
- 结果不得产生负 `available_microcredits`。
- 不直接更新 `credit_accounts`；账本条目、账户版本和审计必须在同一事务内产生。

调账后执行账户 reconciliation；出现 `BALANCE_INTEGRITY` 阻断时停止新强制扣费并调查，
修复只能追加补偿账本条目。

### 8.2 `REVIEW_REQUIRED` 账单

在 `/settings` 的模型计费面板处理人工复核队列：

- 已取得可信实际用量：选择“按核实用量结算”，填写五类 usage 和依据。
- 无法证明调用发生或应扣费：选择“释放”，明确填写原因。
- 在决定前冻结额保持占用；不能用直接改 bill/hold 状态跳过复核。
- 队列清空后重新运行 reconciliation，确认 `BILLING_REVIEW` gate 为 `PASS`。

### 8.3 Agent 模型调用主体

- Web 只把会话解析出的 `principal_id` 写入 Run；浏览器不能提交或覆盖计费用户。
- Worker 启动账号只用于发现工作空间成员。每次领取任务后，Lease 中的
  `principal_id` 必须与实时 capability、Run owner、事件和 checkpoint 一致。
- Agent Worker 的模型组合必须使用 billing-gated provider：先提交 PostgreSQL
  authorize，再创建真实 Provider stream；余额不足、价格缺失或主体不一致时 Provider
  不会被调用。
- `COMPLETED` 只有在不可变 usage 和 billing finalize 都提交后才向工作流可见；调用中断或
  Provider 结果不确定时进入 `OUTCOME_UNKNOWN`/人工复核，不能静默释放冻结额。
- 当前确定性研究内核没有调用 LLM，因此不会伪造模型账单；一旦工作流启用模型阶段，必须从
  上述组合根注入，不允许直接持有原始 Provider adapter。

## 9. `SHADOW → ENFORCED` Go/No-Go

默认保持 `SHADOW`。只有以下项目全部满足时才是 Go：

- [ ] clean-install、静态检查和完整 PostgreSQL smoke 通过。
- [ ] lint、typecheck、unit、contract、Web production build 通过。
- [ ] `/api/admin/operations/health` 的六项 gate 全部 `PASS`。
- [ ] billing reconciliation 的 `ready_for_enforced = true`。
- [ ] `missing_bills = 0`、`duplicate_bills = 0`、`open_review_findings = 0`、
      `hold_ledger_mismatches = 0`。
- [ ] identity side effect 没有 `PENDING` 或 `RETRY_REQUIRED`。
- [ ] 价格/汇率无失败同步、无待审批候选，active 版本在预期生效期。
- [ ] 最近一次备份恢复演练和权威数据指纹比对通过。
- [ ] 超级管理员已记录显式批准原因。

全部通过后，在模型计费面板点击“审批启用 Enforced”。命令必须携带当前
`expected_epoch`；数据库会在同一操作中再次运行 reconciliation。任一项不满足时保持
`SHADOW`，不能直接更新 `billing_runtime_state`。

## 10. 回滚

### 10.1 计费回滚

发现账务异常时立即：

1. 在模型计费面板选择“退回 Shadow”，填写 incident 原因。
2. 暂停新的普通用户模型运行；保留只读查询和超级管理员审计。
3. 保留现有 bill、hold、ledger 和 operation receipt，不删除或改写历史。
4. 处理 review/差异，重新运行 reconciliation。
5. 只有完整 Go/No-Go 再次通过后才重新启用 `ENFORCED`。

自动化 smoke 已证明 `ENFORCED → SHADOW` 使用权威 `decide_billing_mode` 命令并提升 epoch。

### 10.2 应用版本回滚

迁移采用 clean-install 前进链，不提供破坏性 DOWN migration。应用版本回滚时：

1. 先把计费退回 `SHADOW`。
2. 停止 Web、Worker 和 Indexer 的新写入。
3. 部署上一已验证应用镜像，但保留数据库 schema 和权威事实。
4. 运行 health、migration ledger 和只读查询验证。
5. 旧应用不兼容当前 schema 时保持服务停止，使用前进修复版本；不要手工删除新表/列。

## 11. 备份、恢复与灾难恢复

### 11.1 备份

```bash
OPERATIONS_BACKUP="/absolute/secure/path/data-agent-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres \
  pg_dump -U postgres -d data_agent -F c > "$OPERATIONS_BACKUP"
```

备份文件应加密、限制访问并按组织策略异地保存。记录备份时间、数据库版本、应用 commit、
migration ledger 最新版本和文件校验值，不记录数据库密码。

### 11.2 恢复演练

始终恢复到新的空数据库，不覆盖源数据库：

```bash
RESTORE_DATABASE="data_agent_restore_$(date +%Y%m%d%H%M%S)"
docker compose exec -T postgres createdb -U postgres "$RESTORE_DATABASE"
docker compose exec -T postgres \
  pg_restore -U postgres -d "$RESTORE_DATABASE" --exit-on-error --no-owner \
  < "$OPERATIONS_BACKUP"
```

验证至少包括：

- migration ledger 的 `(owner_kind, app_id, version, checksum)` 完整一致；
- `app_users / workspaces / memberships / identity_operation_receipts` 计数一致；
- `credit_ledger_entries` 数量与 signed microcredits 合计一致；
- `model_bills` 数量与 charged microcredits 合计一致；
- 超级管理员可读取六项 operations health；
- billing reconciliation 可运行，当前模式和 epoch 与备份一致。

仓库中的 `run-postgres-smoke.sh` 已自动执行上述指纹比对，可作为每次发布的恢复演练证据。

### 11.3 灾难恢复

1. 停止 Web、Worker 和 Indexer，阻止旧主库继续写入。
2. 选择已校验的最近备份，在隔离的新 PostgreSQL 实例恢复。
3. 验证 migration ledger、身份、积分账本、模型账单和 health gates。
4. 将恢复实例计费模式保持或切回 `SHADOW`。
5. 更新 `DATABASE_URL` / `AUTH_DATABASE_URL`，先启动 Web 做只读与管理员验证。
6. 再启动 Worker 和 Indexer；Neo4j/索引按 PostgreSQL 权威事实重建。
7. 记录 RPO、RTO、缺失时间窗、恢复数据库标识和审批人。

如果无法证明账本与账单一致，不启动强制扣费或普通用户模型运行。

## 12. 证据与诊断

运营控制台展示六项 gate：

| Gate | 阻断/告警含义 |
| --- | --- |
| `IDENTITY_SIDE_EFFECTS` | 认证 ban/password/session revoke 尚未完成 |
| `PRICING_SYNC` | 最近 24 小时有价格或汇率同步失败 |
| `PRICING_REVIEW` | 存在待人工审批候选 |
| `BILLING_REVIEW` | 存在 `REVIEW_REQUIRED` 账单 |
| `BALANCE_INTEGRITY` | 余额、冻结额或非负约束异常 |
| `SHADOW_RECONCILIATION` | shadow 对账存在 warning/error finding |

Web 通过 `data-agent.web.operations` diagnostics channel 发布严格结构化事件，只允许时间、
级别、event name、reason code、ID 和计数。原始请求、密码、Header、数据库消息和未知嵌套值
不会进入诊断事件。运行日志只用于诊断；最终审计证据以 PostgreSQL 不可变 receipt/audit 为准。
