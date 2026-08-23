# 模型计费结算设计

## 1. Authority 边界

Research Reservation/Invocation/Outcome Usage 继续定义模型调用是否开始、如何终止以及实际
usage。计费层只建立与 `invocation_id` 一一对应的财务派生记录，不向 Research 表写入新的调用
状态。PostgreSQL 是 bill、hold、ledger、mode、review 和 reconciliation 的唯一权威。

Billing Port 分为两个窄动作：

1. `authorize`：在真实 provider 调用前解析部署模式、身份、workspace 生命周期、模型配置、
   active price/FX 和预算上限，冻结不可变快照；必要时原子建立 credit hold。
2. `finalize`：只接受现有 invocation/usage authority 的引用，读取 terminal state 和不可变
   actual usage，原子结算、释放或标记 review。

调用方只能传业务标识和预算/usage 事实引用，不能传资金来源、价格、汇率、role 或 mode。

## 2. 数据模型

10631 clean-install migration 新增：

- `billing_runtime_state`：每个 deployment 的 `SHADOW / ENFORCED`、epoch 和最近批准信息。
- `model_bills`：每个 MODEL invocation 唯一；保存 principal、workspace、run/conversation、
  datasource、model profile、funding、mode、state、hold、价格/汇率版本、预算上限、actual usage、
  成本、rounding 和时间。
- `model_bill_price_components`：从 active price version 复制的不可变 component 快照。
- `model_bill_events`：append-only 状态事实。
- `model_billing_operations`：统一保存 authorize/finalize/review/mode 的 actor-scoped 幂等输入
  哈希和稳定 receipt，减少重复状态表。
- `billing_reconciliation_findings`：Shadow/Enforced 对账发现；未解决 ERROR 会阻止切换。

`model_bills` 通过 composite FK 绑定真实 workspace、principal、run 与 Research reservation，
`invocation_id` 在 app/environment 内唯一。Research reservation/invocation/usage 只通过由 U6
RPC Owner 持有的窄只读桥接函数验证，计费 Owner 与 Backend 都不获得原始 Research 表权限。
底表强制 RLS；Backend 仅有窄函数 execute 权限。component/event/operation/finding 不可
UPDATE/DELETE；bill 的有限状态推进由 owner 函数完成并写 event。

## 3. 价格和金额

授权时选择覆盖当前数据库时间的 active `model_price_versions`，复制全部 price components。
非 CNY 价格必须同时选择覆盖当前时间的 active FX version。支持的 usage 维度固定为 input、
output、cache read、cache write 和 tool call；active price 声明的未知维度或预算缺失失败关闭。

预算上限逐 component 采用 ceil，实际结算采用 half-up；最终保存官方币种 component 单价、
单位和数量、price/FX version、FX rate 和 source evidence hash、official cost、CNY cost、
charged microcredits、rounding delta 以及 `model-billing-formula@1.0.0`。

所有 TypeScript 边界为 decimal/integer string，数据库使用 `numeric`/`bigint`，禁止浮点累计。

## 4. 状态与事务

```text
SHADOW      authorize -> RESERVED(no hold) -> SETTLED | RELEASED | REVIEW_REQUIRED
SYSTEM      authorize -> RESERVED(no hold) -> SETTLED | RELEASED | REVIEW_REQUIRED
ENFORCED    authorize -> RESERVED(ACTIVE hold) -> SETTLED | RELEASED | REVIEW_REQUIRED
```

- 成功或失败且有完整 usage：计算 actual。若不超过 hold，原子写 CHARGE、关闭 hold、释放差额。
- 取消且 invocation 未 STARTED：`RELEASED`，释放全部 hold。
- outcome unknown、usage 缺失/未知、snapshot 损坏、actual 超 hold：`REVIEW_REQUIRED`，hold
  保持并写 finding，不允许负余额。
- 重复 callback：terminal operation 的幂等键与 canonical input hash 重放相同 receipt；同键
  异载荷冲突；已终态 bill 不接受不同结论。
- crash recovery 通过 terminal callback 的 actor-scoped 幂等 receipt 重放同一 finalize 窄函数；
  Shadow 对账持续识别 terminal invocation 与 bill 的遗漏，不直接改 Research 或账务底表。

管理员 review 支持 `SETTLE_VERIFIED / RELEASE`。前者仍受 available/hold 上限和非负约束；如需
补充积分，必须先走独立管理员调账。所有处理要求 reason 并写 audit。

## 5. Shadow、成本和界面

Shadow 会完整计算 bill，但不创建 hold/ledger；对账比较 terminal invocation、usage、bill、
hold、ledger 和 snapshot completeness。只有不存在未解决 ERROR finding，且显式超级管理员批准
时才能 `SHADOW -> ENFORCED`；MVP 不提供请求级开关。

成本查询从 model bills 聚合 workspace/run/conversation 的 official/CNY/microcredit 成本，
同时区分 `USER_CREDITS / SYSTEM_FUNDED` 和账单状态。个人设置页展示余额旁的个人账单；超级
管理员面板展示计费模式、Shadow 门禁、全局成本和 review 队列。复用现有 DataFoundry 设置页
的卡片、表格、Badge、按钮与低饱和绿色令牌，提供明确空态、错误态和操作回执。

## 6. 验证与回退

验证包含 strict contract、金额/状态单测、PostgreSQL 并发与幂等、权限/RLS、terminal recovery、
snapshot 重算、SYSTEM_FUNDED 零积分副作用和 Web API/UI 测试。界面仅做一次截图验收。

若 Enforced 验证失败，超级管理员可通过显式部署命令切回 Shadow，停止新的用户扣费授权；
历史账单、ledger、hold 和审计不回滚、不删除。
