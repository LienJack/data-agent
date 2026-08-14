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
- `pnpm lint`：最新干净 HEAD 为 0 error、63 个非阻断 warning；共享工作区仍被
  `packages/contracts/src/evals/index.ts` 的 2 个未提交格式/导出排序错误阻断。
- `pnpm typecheck`：已提交 contracts/text2sql 干净检出的自身导出构建前置；共享工作区
  当前只剩未跟踪的 `packages/evals/test/model-analysis-agent.spec.ts:334` 中
  `attempt_index` 类型错误。
- 定向门：Contracts 29、Platform 37、Web 管理 35 项测试通过。
- `pnpm --filter @data-agent/web build`：生产构建通过。
- `static-check.sh`：10627-10633 migration checksum 与 SQL 静态门禁通过。
- `run-postgres-smoke.sh`：2026-08-15 完整 assertions 复跑通过；clean install、shadow 对账、备份/恢复和
  `ENFORCED -> SHADOW` 回滚演练通过。
- `platform.read_operations_health`：`SHADOW`、epoch 1，六个运营门禁均为 `PASS` 且
  count 为 0，`SHADOW_RECONCILIATION_CLEAR`。
- 2026-08-15 继续执行后再次复跑全量非浏览器门：unit 15/15 tasks、contract 10/10 tasks、
  SQL static check 与完整 PostgreSQL smoke 全部通过；实时 reconciliation 再次返回
  `ready_for_enforced = true`，`missing_bills`、`duplicate_bills`、`open_review_findings` 和
  `hold_ledger_mismatches` 均为 0。
- detached clean worktree 对提交 `930a9eb` 的复核中，`pnpm lint` 通过；`pnpm typecheck`
  因已提交 Web 调用方引用尚未提交的 Test Center、Semantic Candidate 和 UI 组件而失败。
  这证明当前发布提交也在等待并行任务的原子提交，不能绕过共享门禁启用 `ENFORCED`。
- 复制全部共享改动到临时集成 worktree 后，两个不改变产品行为的候选修复使 lint、typecheck、
  unit 15/15 tasks 和 contract 10/10 tasks 全绿：对 Eval 合约入口执行 Biome 格式/导出排序，
  并删除 SQL reflection 测试中不属于 `BenchmarkSqlAgentInvocationContext` 的
  `attempt_index`。候选修复只用于隔离验证，未写回或提交其他任务的源文件。
- 请求边界复审：`/api/admin/**` 全部先执行数据库重验后的 `SUPER_ADMIN` 守卫；旧 datasource、
  Q&A 与 tests 无作用域入口返回 `WORKSPACE_ROUTE_REQUIRED`（410）；兼容 semantic URL 统一进入
  Cookie session + workspace capability guard，不接受客户端自报 principal/role。
- 全目录固定身份扫描：已提交的 Phase 2 产品路径无 `workspaceId="default"`；共享工作区中另一个
  未提交的 Semantic Candidate 任务仍在 `semantic-candidate-runtime.ts` 保留固定 tenant/principal
  兼容 fallback。现有 workspace semantic route 会显式注入 request-scoped resolver，不会进入该
  fallback，但在其所属任务收口前，不能宣称当前整个工作区静态扫描零命中。
- 前端交互复审：用户停用/密码重置、工作空间归档与成员撤销、价格/汇率审批、积分投影重建、
  计费模式切换及冻结释放全部使用站内审计原因对话框；管理产品路径中的原生
  `window.prompt / confirm / alert` 已归零，并由 `legacy-workspace-characterization.spec.ts` 固化。
  对话框复用原生 modal focus/escape 语义，窄屏自适应，并在失败时保留原因供安全重试。
- 价格控制面复审：模型草稿、目录状态、价格/汇率候选补齐响应式层级、字段标签、空/错/
  loading/成功状态和不可变版本影响说明；`/admin/pricing` 在 Server Component 内重新验证会话，
  未登录跳转登录、非超级管理员直接 404，页面边界 3 项测试通过。
- 视觉证据：
  `/Users/lienli/.codex/visualizations/2026/08/14/019fff6b-8633-72c1-ac95-e8f739243566/phase7-operations-console.png`。

## 发布状态

功能 AC 与数据库六项运营门禁已全部通过，但父任务尚未达到“完成”定义：当前共享工作区
的全局 `pnpm lint` 被其他未提交文件的 2 个错误阻断，全局 `pnpm typecheck` 仅被未跟踪的
`packages/evals/test/model-analysis-agent.spec.ts:334` 中 `attempt_index` 字段错误阻断。因此
部署继续保持 `SHADOW`，不绕过最后仓库门启用 `ENFORCED`。
