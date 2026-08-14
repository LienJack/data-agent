# 实施计划

- [x] 扩展 strict contracts 与 bigint 计价器：Billing Context、authorize/finalize/review/mode、
  price snapshot、usage、bill、cost summary 和 reconciliation receipt。
- [x] 新增 10631 renderer/migration：mode、model bills/components/events、terminal/review operations、
  findings、不可变/RLS/grants 与 clean-install checksum。
- [x] 实现原子 authorize：服务端解析 funding/mode/price/FX，Shadow/System 无 hold，Enforced
  普通用户在 provider 前创建足额 hold，所有缺口失败关闭。
- [x] 实现 terminal finalize 和 review：复用 Research invocation/usage，覆盖 settle/release/
  review、重复 callback、actual 超限、失败有 usage、outcome unknown 和 crash recovery。
- [x] 实现 PostgreSQL Billing Port、个人/管理员账单、成本聚合、Shadow 对账和模式审批 API。
- [x] 在设置页交付个人账单与超级管理员模式/成本/复核面板，覆盖状态并做一次截图验收。
- [x] 通过 contracts/platform/web/static/PostgreSQL 门禁，更新父计划、完成子任务并单独提交。

## 验证命令

- `pnpm --filter @data-agent/contracts test:unit && pnpm --filter @data-agent/contracts typecheck`
- `pnpm --filter @data-agent/platform test:unit && pnpm --filter @data-agent/platform typecheck`
- `pnpm --filter @data-agent/web test:unit && pnpm --filter @data-agent/web typecheck`
- `infra/supabase/test-support/run-postgres-smoke.sh`
- `infra/supabase/test-support/static-check.sh`

## 验收证据

- Contracts：39 files / 589 tests；Platform：38 files / 265 tests；Web：32 passed、1 skipped /
  121 passed、1 skipped。
- PostgreSQL 17 clean-install、并发积分探针、10631 权限/RLS/Shadow/Enforced/System-funded
  断言及全量 smoke 通过。
- 本地数据库 ledger 已记录 10631，部署模式初始化为 `SHADOW:1`。
- 截图：`phase5-model-billing.png`，确认个人账单空态、部署模式、对账、成本与复核队列布局。

## 回退点

- 在 mode 保持 `SHADOW` 时完成所有实现和对账；未通过对账不得切换 Enforced。
- 若 Enforced 后发现异常，只通过审批命令回到 Shadow；不删除历史 bill/ledger/hold。
