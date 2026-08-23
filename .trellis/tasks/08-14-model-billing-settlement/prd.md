# 模型调用冻结、结算与成本归因

## 目标

把全局积分、已批准价格/汇率和现有 Research Invocation/Usage 权威链连接起来，使每次真实
模型调用都能在调用前明确资金来源，在终止后得到唯一、可重算、可审计的账单结论。

## 需求

- Billing Port 必须绑定服务端解析的 AppScope、principal、workspace、run/conversation、
  datasource、model profile version、invocation、价格/汇率版本和请求预算；客户端不能选择
  principal、role、workspace、价格版本、资金来源或计费模式。
- `ENFORCED + USER_CREDITS` 必须在 provider 调用前原子创建 bill reservation 和足额 credit
  hold；余额不足、模型未启用、预算不能计价或价格/FX 链不完整时不允许启动真实 invocation。
- 调用事实继续复用 `research_resource_reservations`、`research_invocation_commits` 和
  `research_invocation_outcome_usage`；账务不得复制或改写 Research 调用状态机。
- terminal 结算覆盖成功、失败但有 usage、未开始取消、outcome unknown、实际费用超过冻结、
  未知计价维度和重复 callback。任何不确定费用保留冻结并进入 `REVIEW_REQUIRED`。
- 每个账单冻结完整 price/FX/component/formula 快照，保存官方原币成本、人民币成本、积分、
  rounding delta 和标准化 usage；历史价格变化不得改变历史账单。
- `SUPER_ADMIN` 调用生成同粒度 `SYSTEM_FUNDED` 账单，不创建 hold 或积分流水，但仍进入
  workspace/run/conversation 成本归因和全局审计。
- 计费模式是部署级服务端状态，默认 `SHADOW`。Shadow 生成账单和对账差异但不改变积分；
  只有超级管理员可在对账通过后批准切换 `ENFORCED`，请求不能覆盖模式。
- 普通用户只能查看自己的账单；超级管理员可查看全局账单、成本聚合、Shadow 对账和人工
  复核队列，并通过带 reason/幂等键的显式命令处理复核。

## 验收标准

- [x] `ENFORCED` 下普通用户每次真实 provider 调用前已有足额 ACTIVE hold，失败关闭时未创建
  invocation；并发授权不会使 available 小于零。
- [x] 每个已终态 MODEL invocation 恰好对应一个 `SETTLED`、`RELEASED` 或
  `REVIEW_REQUIRED` bill；重复 terminal callback 和 crash recovery 不重复扣费。
- [x] 成功和失败有 usage 均按实际维度结算并释放差额；取消未开始释放全部冻结；outcome
  unknown、未知维度或 actual 超限保留冻结进入 review。
- [x] 账单快照可以脱离当前价格表重算出原币、CNY 和 microcredit 结果，且价格/汇率更新后
  历史结果不变。
- [x] `SYSTEM_FUNDED` 账单有 usage/cost/workspace 归因但不改变超级管理员积分账户。
- [x] Shadow 对账可证明遗漏、重复、价格缺口、hold/ledger 差异；未通过时不能启用 Enforced。
- [x] 普通用户无法读取他人账单；非超级管理员无法切换模式、读取全局成本或处理复核。
- [x] API/UI 覆盖个人账单以及管理员模式、成本、对账、复核的 loading/error/empty/success 状态。
