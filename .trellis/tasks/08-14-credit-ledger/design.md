# 全局用户积分账户与账本设计

## Authority 与数据模型

账户属于 `app_id + environment + principal_id`，不伪造 workspace。`credit_accounts` 仅是
快速投影；`credit_ledger_entries` 是 settled balance 的追加真值，`credit_hold_events` 是
active-held 的追加事实。workspace 只在真实消费/hold 上记录。

10630 clean-install migration 建立 accounts、ledger、holds、hold events、billing operations
和 billing audit。所有底表强制 RLS，归 `data_agent_identity_rpc_owner`；Backend 只能执行窄
函数，不能 CRUD。账本、hold event、operation、audit 禁止 UPDATE/DELETE。

## 事务与幂等

管理员调账先重验 `ACTIVE SUPER_ADMIN`，取得 actor-scoped idempotency advisory lock，再锁定
目标 app user 和 account。账户不存在时以零余额创建；expected version 必须精确匹配，负向
调整后 settled 不得小于 active held。账本、账户投影、operation receipt 和 audit 在同一事务
提交。

Hold reserve/release 同样锁定账户；reserve 检查 `available`，release 只允许
`ACTIVE -> RELEASED`。后续 Phase 5 在同一 authority 上扩展 settle/review，不建立第二套账户。

## 金额运算

TypeScript money library 只接受规范十进制字符串或 `bigint`。固定最大值为 PostgreSQL
`bigint` 上限。credit/CNY 转 microcredits 使用十进制缩放；预算预约使用正整数有理数向上
取整，结算使用 half-up，所有溢出、负值和非规范输入失败关闭。

## 查询、重建与 Web

普通用户窄函数只返回自己的账户/流水；超级管理员函数返回全局用户账户、流水和 audit。
对账比较投影与 `sum(ledger)`、`sum(active holds)`；显式 rebuild 在 super-admin 事务中锁定
账户并从真值重算，写 operation/audit 但不修改 ledger。

Web 提供 `/api/billing/me`、`/api/billing/me/ledger` 和 `/api/admin/credits/**`，所有客户端
role/principal 字段无效。设置页增加余额与调账面板。
