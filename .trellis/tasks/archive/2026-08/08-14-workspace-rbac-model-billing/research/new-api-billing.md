# QuantumNous/new-api 计费参考研究

## Research Scope

- Repository: `https://github.com/QuantumNous/new-api`
- Reviewed commit: `58d4e9bd3bb035df8ea235dd682ccc8a45d0332a` (2026-08-13)
- Purpose: 研究模型价格表达、预扣/结算/退款、余额并发控制、费用日志和价格同步交互，作为 Data Agent 规划参考。
- License note: 仓库使用 AGPL-3.0。本文只总结架构思想，不复制源代码；实施时必须独立实现并保持本项目自己的契约与安全边界。

## Useful Patterns

### 1. A Billing Session Owns The Lifecycle

`service/billing_session.go` 把单次请求的预扣、追加冻结、实际结算和失败退款收拢到一个 `BillingSession`，并冻结本次请求使用的计费状态。这个生命周期与本任务选择的“冻结后结算”一致。

Data Agent 应采用更持久化的状态机：`RESERVED -> SETTLED | RELEASED | REVIEW_REQUIRED`。状态和每次转换写入 PostgreSQL，而不是依赖进程内互斥锁。

### 2. Price Snapshot Is Frozen Before Provider Execution

`pkg/billingexpr/types.go` 的 `BillingSnapshot` 保存模型、表达式、表达式 hash、预估 token、分组倍率和单位换算；`pkg/billingexpr/settle.go` 用同一快照与实际 token 重新计算费用。这样配置更新不会改变正在执行或已经完成的请求。

Data Agent 应保留这一原则，但使用不可变 `model_price_version_id` 与结构化价格快照，不把任意表达式作为 MVP 的账务真值。

### 3. Multiple Billing Dimensions Are Explicit

`pkg/billingexpr/types.go` 区分输入、输出、缓存读取、缓存写入、图像、音频等用量；`relay/helper/price.go` 同时支持按 token、按次和复杂分层价格。`service/text_quota.go` 使用实际 Provider usage 结算并记录额外工具费用。

Data Agent MVP 至少需要结构化支持：

- input tokens
- output tokens
- cached input/read tokens（供应商支持时）
- cache creation/write tokens（供应商支持时）
- fixed per-request price（部分模型/能力需要时）
- tool call surcharge（官方定价存在时）

未知或缺失用量不得默认为零价成功结算，应进入失败关闭或人工复核状态。

### 4. Atomic Reservation Prevents Concurrent Overspend

`model/quota_reserve.go` 使用 Redis Lua 或数据库条件更新实现“余额足够才扣减”的原子预扣。数据库路径的核心语义是单条条件更新，而不是先读余额再写余额。

Data Agent 已选择 PostgreSQL 作为权威，因此 MVP 直接在数据库事务中锁定账户/条件更新并写入冻结记录；Redis 不应成为余额权威。

### 5. Usage Logs Preserve Billing Inputs

`model/log.go` 的消费日志记录用户、模型、输入/输出 token、额度、请求 ID 和扩展计费信息；前端详情页展示计费模式、输入/输出价格、缓存与工具附加费。

Data Agent 应提供同等可解释性，但将账务真值拆成规范化的 `model_invocation_usage`、`billing_reservation`、`billing_settlement` 和 append-only `credit_ledger_entry`，日志只做投影，不承担余额权威。

### 6. Price Sync Requires Explicit Conflict Resolution

`web/src/features/system-settings/models/upstream-ratio-sync.tsx` 会比较本地与上游配置，区分固定价格、倍率和动态表达式，并在计费类别冲突时要求管理员确认。

Data Agent 的官方价格抓取可借鉴“候选差异 + 冲突确认”交互，但抓取来源必须是配置好的官方 URL/官方结构化端点，不能把任意上游渠道价格当作官方证据。

## Patterns Not To Copy

- 不允许负余额：`new-api` 的部分追加冻结路径允许余额变负以保证事后对账，这与本任务“余额不足失败关闭”冲突。
- 不使用 `float64` 作为账务真值：价格、汇率、积分和人民币展示都使用整数最小单位或 PostgreSQL `numeric`，服务层用 `bigint`/十进制定点运算。
- 不把退款只放在异步内存任务：释放冻结额必须是可重放、幂等、持久化的状态转换；异步通知使用 outbox。
- 不把累计余额作为唯一账本：余额是账本投影，任何调账、冻结、结算和释放都必须有不可变条目。
- 不在 MVP 引入任意计费表达式语言：官方常规模型价格优先使用结构化价格维度；只有明确出现无法表达的阶梯/条件定价时，才另行设计受限规则 DSL。
- 不照搬 Token/API key 级配额、渠道倍率、订阅套餐或支付能力；它们不属于当前 MVP。

## Planning Consequences

- 模型配置与模型价格分离；模型可启停，价格按版本生效。
- 每次 Provider invocation 在发送前绑定价格版本并创建冻结记录。
- Provider 返回实际 usage 后，在同一事务中结算费用、释放差额并追加积分账本。
- Provider 未返回可信 usage、结算计算溢出或价格版本缺失时，不得静默免费；进入 `REVIEW_REQUIRED` 并保留冻结额，等待超级管理员处理。
- 用户消费明细展示实际用量、价格快照、人民币成本、积分变动、工作空间、对话/运行和请求 ID。

## Primary Source Links

- Billing lifecycle: `https://github.com/QuantumNous/new-api/blob/58d4e9bd3bb035df8ea235dd682ccc8a45d0332a/service/billing_session.go`
- Atomic quota reservation: `https://github.com/QuantumNous/new-api/blob/58d4e9bd3bb035df8ea235dd682ccc8a45d0332a/model/quota_reserve.go`
- Frozen billing snapshot: `https://github.com/QuantumNous/new-api/blob/58d4e9bd3bb035df8ea235dd682ccc8a45d0332a/pkg/billingexpr/types.go`
- Actual-usage settlement: `https://github.com/QuantumNous/new-api/blob/58d4e9bd3bb035df8ea235dd682ccc8a45d0332a/pkg/billingexpr/settle.go`
- Consume logs: `https://github.com/QuantumNous/new-api/blob/58d4e9bd3bb035df8ea235dd682ccc8a45d0332a/model/log.go`
- Price sync conflict UI: `https://github.com/QuantumNous/new-api/blob/58d4e9bd3bb035df8ea235dd682ccc8a45d0332a/web/src/features/system-settings/models/upstream-ratio-sync.tsx`
