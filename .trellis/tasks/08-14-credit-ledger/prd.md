# 全局用户积分账户与账本

## 目标

为每个全局用户建立跨工作空间共享、不可为负、可从不可变账本重建的积分账户；首期只允许
超级管理员人工调账，不接支付、退款或积分过期。

## 需求

- 固定 `1 credit = 1,000,000 microcredits`、`100 credits = 1 CNY`；所有边界使用整数/十进制
  字符串和 `bigint`，禁止浮点累计。
- PostgreSQL 保存 app-global `credit_accounts` 投影、append-only `credit_ledger_entries`、
  `credit_holds`、append-only hold events、幂等 billing operations 和不可变 audit。
- 超级管理员可用带 reason、idempotency key、expected account version 的命令调增或调减；
  调减后 `available = settled - active held` 不得小于零。
- 普通用户只能读取自己的账户和流水；超级管理员可读取全局账户、流水和调账审计。
- 账本是余额真值；提供只读对账和显式重建命令，重建不得修改账本。
- 为后续模型计费提供原子 hold reserve/release 数据库窄函数；同用户并发请求必须串行校验。

## 验收标准

- [x] 同键同载荷稳定重放，同键异载荷返回稳定冲突，不产生重复账本条目。
- [x] 并发调账与 hold reserve 不产生负 available，expected version 冲突失败关闭。
- [x] 账本、hold event 和 audit 禁止 UPDATE/DELETE；Backend 无底表 CRUD 权限。
- [x] 普通用户不能读取他人账户，非超级管理员不能调账或读取全局审计。
- [x] `100 credits = 1 CNY`、预约向上取整、结算四舍五入及 bigint 溢出/下溢均有测试。
- [x] 重建后账户投影与 ledger + active holds 完全一致，且可跨 repository 实例读取。
