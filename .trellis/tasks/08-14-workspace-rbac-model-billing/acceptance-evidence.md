# AC1-AC20 验收证据

## 需求矩阵

| AC | 自动化/人工证据 | 结论 |
| --- | --- | --- |
| AC1 | `19z-workspace-data-isolation-assertions.sql`、`workspace-data-repository.spec.ts` 和 workspace route tests | PASS |
| AC2 | 双 workspace SQL 断言、`postgres-workspace-authority.spec.ts` 和直接 URL 拒绝测试 | PASS |
| AC3 | datasource/conversation/run binding strict contracts、10628 复合 FK 和 repository tests | PASS |
| AC4 | `semantic-portability.spec.ts`、`postgres-semantic-portability.spec.ts` 和 10632 smoke | PASS |
| AC5 | pricing/credit/billing/operations Web 授权测试与 PostgreSQL `SUPER_ADMIN_REQUIRED` 断言 | PASS |
| AC6 | `19zz-credit-ledger-assertions.sql`、credit repository 和管理端调账测试 | PASS |
| AC7 | `19zzz-model-billing-settlement-assertions.sql`、model cost 与 PostgreSQL Billing Port tests | PASS |
| AC8 | 余额不足/超额冻结 SQL 断言、`billing-gated-provider.spec.ts` | PASS |
| AC9 | `/api/billing/me/**`、`/api/admin/credits/**`、`/api/admin/billing/**` 定向测试 | PASS |
| AC10 | `run-postgres-smoke.sh` 从空 PostgreSQL 17 安装至 10633，无 backfill | PASS |
| AC11 | `workspace-identity.spec.ts`、`operations-admin.spec.ts` 和 transaction authority tests | PASS |
| AC12 | user disabled/membership revoked/version drift/cross-object 单测与 SQL 断言 | PASS |
| AC13 | credit/billing 并发探针、幂等重放/异载荷冲突与 terminal callback 断言 | PASS |
| AC14 | 失败有 usage、outcome unknown、`REVIEW_REQUIRED` 与 review release SQL 断言 | PASS |
| AC15 | `19y-pricing-control-assertions.sql`、pricing sync cycle 和超级管理员审批测试 | PASS |
| AC16 | 价格/FX 时间版本、不可变 bill snapshot 和可重算 cost 断言 | PASS |
| AC17 | identity/pricing/credit operation receipt、append-only audit trigger 与 redaction tests | PASS |
| AC18 | 未知版本、错误 hash、映射缺失、Viewer/跨空间和事务回滚测试 | PASS |
| AC19 | `SYSTEM_FUNDED` 无 hold/无余额变更 SQL 断言和个人账单窄读函数测试 | PASS |
| AC20 | workspace archive/restore、lifecycle version 重验和归档写入拒绝断言 | PASS |

## 验证摘要

- `pnpm test:unit`：15/15 Turbo tasks 通过。
- `pnpm test:contract`：10/10 Turbo tasks 通过。
- 定向门：Contracts 29、Platform 37、Web 管理 35 项测试通过。
- `pnpm --filter @data-agent/web build`：生产构建通过。
- `run-postgres-smoke.sh`：完整 assertions 通过；clean install、shadow 对账、备份/恢复和
  `ENFORCED -> SHADOW` 回滚演练通过。
- 本任务 237 个干净已跟踪文件的 Biome 门禁通过。
- 视觉证据：
  `/Users/lienli/.codex/visualizations/2026/08/14/019fff6b-8633-72c1-ac95-e8f739243566/phase7-operations-console.png`。

## 发布状态

功能 AC 已全部通过，但父任务尚未达到“完成”定义：当前共享工作区的全局
`pnpm lint` 被其他未提交文件阻断，全局 `pnpm typecheck` 仅被未跟踪的
`packages/evals/test/model-analysis-agent.spec.ts:334` 中 `attempt_index` 字段错误阻断。
因此部署继续保持 `SHADOW`，不启用 `ENFORCED`。
