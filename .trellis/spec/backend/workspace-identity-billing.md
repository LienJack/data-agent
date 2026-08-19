# 工作空间、身份与计费权威

> 本规范冻结 workspace/RBAC 以及后续计费的跨层边界。Phase 1 只实现身份和权限；价格、
> 积分与结算由后续阶段实现。

## 1. 唯一术语和 Scope

- 产品和公共 API 只使用 `workspace` / `workspace_id`，中文统一为“工作空间”。
- `workspace_id` 与现有 PostgreSQL `tenant_id` 一一对应，不增加 `project_id` 或第二级容器。
- workspace 业务对象继续显式包含
  `app_id + tenant_id + environment + object_id`。
- app-global 私有控制面对象是唯一例外：用户、认证映射、全局模型目录、价格/汇率版本和
  用户积分账户至少包含 `app_id + environment`，用户对象还包含 `principal_id`。
- app-global 对象不得伪造“系统工作空间”；任何 workspace 消费、账单和业务 audit 仍必须
  保存真实 `workspace_id/tenant_id`。

## 2. 身份与 Authority

- Cookie session 只证明 auth user id。服务端必须从 `app_users` 映射稳定
  `principal_id`，再从受保护 route 解析 `workspace_id`。
- 客户端 Header、JSON、Cookie Cache 中的 role/principal/workspace 声明都不能直接签发
  `AppCapability`。
- 每次受保护事务重验：user `ACTIVE`、user `authz_epoch`、workspace lifecycle/version、
  membership role/version、app lifecycle/epoch 和 deployment mapping。
- 账号停用、系统角色变化、成员撤销/角色变化和 workspace 归档必须单调提升对应 version；
  旧 capability 立即失败关闭。
- 对无成员 workspace、跨 workspace object id 和真实不存在对象统一返回
  `WORKSPACE_ACCESS_DENIED`，公开响应不区分目标是否存在。

## 3. 角色矩阵

| 操作 | SUPER_ADMIN | WORKSPACE_ADMIN | ANALYST | VIEWER |
| --- | --- | --- | --- | --- |
| 创建/归档/恢复 workspace | 允许 | 拒绝 | 拒绝 | 拒绝 |
| 创建/停用/重置用户 | 允许 | 拒绝 | 拒绝 | 拒绝 |
| 管理已有用户的当前 workspace 成员 | 允许 | 允许 | 拒绝 | 拒绝 |
| 管理 datasource/SecretRef | 允许 | 允许 | 拒绝 | 拒绝 |
| 编辑语义候选 | 允许 | 允许 | 允许 | 拒绝 |
| 创建分析运行 | 允许 | 允许 | 允许 | 拒绝 |
| 查看 workspace 结果 | 允许 | 允许 | 允许 | 允许 |
| 管理模型、价格、汇率、积分、账务复核 | 允许 | 拒绝 | 拒绝 | 拒绝 |

产品角色到现有 capability 的映射固定为：`WORKSPACE_ADMIN -> OWNER`、
`ANALYST -> ANALYST`、`VIEWER -> VIEWER`；`SUPER_ADMIN` 在数据库 authority 中得到
owner override，但不能绕过 workspace scope 或审计。

## 4. 幂等管理命令

- 所有 identity/workspace/member mutation 接受 `operation_id + idempotency_key`，键至少
  绑定 `app_id + environment + actor_principal_id`；workspace 命令再绑定 workspace。
- 规范输入由 PostgreSQL `platform.canonical_sha256(jsonb)` 计算。调用方 hash 不能成为
  权威。
- 同键同载荷稳定重放同一 receipt；同键异载荷返回
  `IDENTITY_OPERATION_CONFLICT`。
- 业务状态、operation receipt 与 immutable audit 在一个 PostgreSQL 事务提交。
- Better Auth 的密码/session 副作用若未完成，receipt 必须是
  `PENDING/RETRY_REQUIRED/FAILED`；Data Agent user status/epoch 仍先失败关闭，不能等待
  Cookie 删除才生效。

## 5. 账务精度和状态机

- `1 credit = 1,000,000 microcredits`；`1 CNY = 100,000,000 microcredits`。
- TypeScript 边界使用 bigint 可序列化整数字符串或 decimal string，数据库使用整数最小
  单位或 `numeric`；禁止 `number` 累计金额。
- 普通调用固定走 `reserve -> settle/release/review`。预约向上取整，结算保存舍入差值；
  available balance 永不小于零。
- Hold 状态固定为 `ACTIVE -> SETTLED | RELEASED | REVIEW_REQUIRED`。已开始但费用不确定时
  不得自动释放。
- Bill 必须绑定 workspace、principal、invocation、model、不可变 price/FX snapshot、
  actual usage、原币成本、CNY 成本和 microcredits。
- `SUPER_ADMIN` 调用使用 `SYSTEM_FUNDED` bill，不修改积分账户但不能省略 usage/cost。

## 6. 价格与汇率候选

- 自动同步只生成 candidate；状态固定为
  `FETCHED -> PARSED -> PENDING_REVIEW -> APPROVED | REJECTED | SUPERSEDED`。
- 只有 `SUPER_ADMIN` 审批后生成 active immutable version。同步失败、异常零价格或未知维度
  保留旧 active version；无完整 price/FX 链时普通调用失败关闭。
- 每个 bill 冻结官方原币 price version、FX version 和公式版本；后续版本变化不重算历史。

## 7. 必需验证

- Strict Zod 未知字段/角色/状态失败；金额不能以 JS number 通过。
- 真实 PostgreSQL 双连接覆盖权限撤销、workspace 归档和幂等命令竞争。
- 至少保留一名 active `SUPER_ADMIN`，bootstrap 不暴露 HTTP route。
- Migration inventory 必须证明每张现有业务表是 workspace-scoped 或明确 app-global 例外。
- Phase 2 前，固定 tenant 和进程内 Map 只能标记为 characterization/legacy，不得宣称已经
  完成 workspace 隔离。
- 本项目在无生产数据阶段只支持 clean install。普通 PostgreSQL Compose runner 必须先建立
  本地 Supabase 兼容对象，并为 10590/10600/10610 维护迁移在同一 `psql` session 注入固定
  deployment/database/window 绑定；不得删掉迁移自身的 executor、checksum 或维护窗口校验。
- 发现开发库 schema/ledger 漂移时直接重建明确的 PostgreSQL 数据卷，不实现旧数据 backfill
  或在线升级；Neo4j 等可重建投影应与 PostgreSQL authority 分开处理。

## 8. Scenario: `SHADOW -> ENFORCED` 计费发布

### 1. Scope / Trigger

- 只要部署准备从影子计费切换为真实冻结与扣费，就必须使用本节发布契约。
- UI、CLI 和运维脚本都不能直接更新 `billing_runtime_state`。

### 2. Signatures

```sql
app_data_agent.decide_billing_mode(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid,
  command jsonb
) returns jsonb
```

### 3. Contracts

- `command.schema_version = billing-mode-decision@1.0.0`。
- `operation_id` 是 UUID；`idempotency_key` 长度为 8..128。
- `reason` 去空白后长度为 1..500；`target_mode` 只能是 `SHADOW | ENFORCED`。
- `expected_epoch` 必须等于当前部署 epoch；成功后 epoch 原子加一。
- 返回值包含 `state`、切换前事务内生成的 `reconciliation` 和 `operation_id`。
- 只有 active `SUPER_ADMIN` 可以执行；批准人、原因、输入哈希与结果写入不可变 operation receipt。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| payload 版本、字段或 reason 非法 | `BILLING_MODE_DECISION_INVALID` |
| 非 active `SUPER_ADMIN` | authority reason code，失败关闭 |
| 同幂等键异载荷 | `MODEL_BILLING_OPERATION_CONFLICT` |
| `expected_epoch` 过期 | `BILLING_MODE_EPOCH_CONFLICT` |
| 启用 `ENFORCED` 时 reconciliation 非全绿 | `BILLING_RECONCILIATION_REQUIRED` |

### 5. Good / Base / Bad Cases

- Good：全量代码门、数据库门和六项运营 gate 通过，`ready_for_enforced=true`，以当前 epoch
  切换到 `ENFORCED`，返回 epoch+1。
- Base：同一幂等键、同一 payload 重放，返回原结果，不重复提升 epoch。
- Bad：跳过门禁直接 `UPDATE billing_runtime_state`，或用旧 epoch 覆盖另一位管理员的决定。

### 6. Tests Required

- PostgreSQL smoke 覆盖 `SHADOW -> ENFORCED -> SHADOW`、epoch 竞争、非超级管理员和对账失败。
- 发布前运行 lint、typecheck、unit、contract、Web production build、SQL static check 和完整
  PostgreSQL smoke；随后读取 `platform.read_operations_health`，确认六项 gate 全为 `PASS`。
- 切换后反查 `platform.get_billing_runtime_state`，断言 mode、epoch、approved_by 和 approved_at。

### 7. Wrong vs Correct

```sql
-- Wrong: 绕过 authority、对账、epoch 和 operation receipt。
update app_data_agent.billing_runtime_state set mode = 'ENFORCED';

-- Correct: 由超级管理员携带当前 epoch 调用权威命令；函数在事务内重跑 reconciliation。
select app_data_agent.decide_billing_mode(
  :deployment_id,
  :super_admin_principal_id,
  :billing_mode_decision_json
);
```

## 9. Scenario: 登录用户到 Agent 计费主体的贯通

### 1. Scope / Trigger

- 新增或修改登录标识、用户创建、Run Worker 或真实 Model Provider 调用时，必须验证本节。
- 目标是让认证、角色、Run 和积分共享同一个稳定 `principal_id`，同时禁止 Worker 串账。

### 2. Signatures

```text
Better Auth auth_user_id -> app_data_agent.app_users.principal_id
app_users INSERT -> app_users_ensure_credit_account trigger
RunWorkLease.principal_id -> runs.principal_id
ModelBillingPort.authorize({ deployment_id, principal_id }, command)
ModelBillingPort.finalize({ deployment_id, principal_id }, terminal)
```

### 3. Contracts

- `username` 为 3..30 位小写 `[a-z0-9_.]`，仅作登录标识；业务关系只能引用 UUID
  `principal_id`。
- 新 `app_users` 必须有且仅有一个同 `(app_id, environment, principal_id)` 的
  `credit_accounts`。
- Run、workspace binding、MODEL reservation/invocation、bill、hold、usage 和 ledger 的
  principal 必须相等。
- Worker 静态身份不能作为 Run owner；lease 必须携带数据库返回的 owner principal，并在
  执行前解析该用户的实时 workspace capability。
- Provider 只有在 model billing authorize 返回 `provider_call_allowed=true` 后可调用；终态
  必须 finalize，不能丢失或猜测 usage。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| username 冲突或非法 | 用户创建失败，补偿删除 auth orphan |
| Run principal 与 capability principal 不同 | `WORKSPACE_ACCESS_DENIED` / scope mismatch |
| 积分不足 | `CREDIT_AVAILABLE_INSUFFICIENT`，Provider 调用次数为 0 |
| price/FX/profile/reservation 不完整 | model billing authorize 失败关闭 |
| Provider 明确未开始 | release/cancel-before-start |
| Provider 已开始但终态或 usage 不确定 | `OUTCOME_UNKNOWN` / `REVIEW_REQUIRED`，不得释放 hold |

### 5. Good / Base / Bad Cases

- Good：普通用户登录后发起 Run，自己的积分被冻结，真实 usage 结算为自己的 ledger entry。
- Base：修改 username 或密码后继续使用原 principal、角色、余额和历史账单。
- Bad：Worker 使用启动时管理员 principal 执行其他用户 Run，或先调用 Provider 后补写账单。

### 6. Tests Required

- Contract：username normalization、Run lease principal 和未知字段失败。
- PostgreSQL：新用户自动积分账户、两个用户同 workspace 不串账、余额不足不产生 Provider
  side effect、SYSTEM_FUNDED 不修改积分。
- Worker：lease owner 与 capability/billing context 一致；Provider 成功、失败前、失败后和
  outcome unknown 四种终态都形成正确账务状态。
- E2E：邮箱和 username 登录同一用户，分别发起问答后个人账单接口只返回自己的账单。

### 7. Wrong vs Correct

```typescript
// Wrong: 用服务启动账号给所有 Run 计费。
const billingContext = { deployment_id, principal_id: process.env.WORKER_PRINCIPAL_ID };

// Correct: principal 来自数据库权威 Run lease，并在执行前重新解析 capability。
const billingContext = { deployment_id, principal_id: lease.principal_id };
```
