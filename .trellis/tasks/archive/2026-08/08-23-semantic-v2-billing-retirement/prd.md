# 语义层单一当前代重构与计费退役

## Goal

完成 `docs/plans/2026-08-22-004-refactor-semantic-architecture-billing-retirement-plan.md`
定义的 U1–U8，使语义子系统只保留一个当前代实现，完整移除商业计费，同时保持治理、模型调用和
PostgreSQL Authority 主路径可用。

## Requirements

- R1–R3：保留业务对象/维度/指标/公式/物理绑定及一等关系；AI 只能创建 Candidate；PostgreSQL 是持久
  Authority，Neo4j 和 UI 只做可重建投影。
- R4–R5：Contracts 只定义 strict contract/port，Semantic 只包含纯内核与应用用例，Platform 只实现 Adapter，
  Web/Worker 只做鉴权、组合和传输边界。
- R6–R9：语义核心 V2-only；删除 V1 schema、投影、fixture、数据路径、兼容导出、global/mock runtime、重复 API
  及旧 Semantic/Data Link 页面。
- R10–R13：删除 price/fx/credit/hold/bill/settlement/reconciliation 产品面与运行时依赖；保留 Provider/Model
  binding、技术预算和非商业 Usage 事实；历史账务对象只读冻结。
- R14–R16：历史 migration 不改写；新 migration 序号/stem/ledger 严格唯一；每个实施单元有 characterization、
  验证和 scoped commit；不保留 adapter、re-export、双读写、redirect、410 或 compatibility/composition fallback。
- Relationship Index 到 PostgreSQL Authority 的显式可靠性降级不是兼容层，必须保留 reason code 和测试。
- 不机械地把所有 `@1` 改成 `@2`；只有破坏性重设计的合同升版，单代且正确的合同继续作为唯一当前合同。

## Acceptance Criteria

- [x] U1–U8 八个子任务全部通过各自验收并归档，每个子任务至少一个 scoped commit。
- [x] 生产代码不存在 Semantic Source Bundle V1、V2→V1 投影、商业 Billing/Pricing/Credit/FX/Settlement surface
  或旧路由兼容层；独立的 Provider Invocation 技术对账不属于商业计费。
- [x] Model Control、Provider 直连、Q&A、Test Center、Semantic Candidate/Authoring 在无价格/账务数据下可用。
- [x] V2 Candidate → Review → Release → Explorer/Resolved Context/Relationship Index 全链通过，Candidate 无法越权发布。
- [x] `10703`/`10704` forward migration、静态 inventory 和 PostgreSQL smoke 证明账务只读与 V2-only 最终 catalog；
  `10705`–`10707` 继续收紧词汇解析、绑定影响与可选资源绑定。
- [x] lint、typecheck、相关 unit/contract/integration、Web production build、SQL static check 与最终全量门禁通过。
- [x] 计划状态改为 completed，最终范围审计逐项覆盖 R1–R16，无未处理 blocker 或兼容残留。

## Final Evidence

- 实施提交：U1 `1ebaba6`、U2 `c84f85e`、U3 `965b451`、U4 `7806ea7`、U5 `c041c21`、
  U6 `c69712b`、U7 `f606472`、U8 `858446e`；八个子任务均位于 `.trellis/tasks/archive/2026-08/`。
- 最终可靠性修复：`aca91b0` 恢复 effective config authority、resume payload 与 FILE/KNOWLEDGE/MCP/SKILL
  严格资源分派，不解析旧合同，也不增加兼容入口。
- 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test:unit --concurrency=1`、
  `pnpm test:contract --concurrency=1`、`pnpm test:integration --filter @data-agent/platform`、
  `infra/supabase/test-support/run-postgres-smoke.sh` 与 `pnpm verify:release` 全部通过；最终发布判定为
  `GO / RELEASE_READY`。
- 范围扫描仅命中 retirement ledger 对禁用兼容模式的规则本身；生产实现未发现 V1 投影、双读写、旧路由或
  commercial surface 残留。

## Notes

- 权威计划：`docs/plans/2026-08-22-004-refactor-semantic-architecture-billing-retirement-plan.md`。
- 本项目为绿地，不迁移或回填 V1 语义数据；历史计费数据物理销毁不在本任务范围。
