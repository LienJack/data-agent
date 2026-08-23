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

- [ ] U1–U8 八个子任务全部通过各自验收并归档，每个子任务至少一个 scoped commit。
- [ ] 生产代码不存在 Semantic V1、V2→V1 投影、Billing/Pricing/Credit/FX/Settlement surface 或旧路由兼容层。
- [ ] Model Control、Provider 直连、Q&A、Test Center、Semantic Candidate/Authoring 在无价格/账务数据下可用。
- [ ] V2 Candidate → Review → Release → Explorer/Resolved Context/Relationship Index 全链通过，Candidate 无法越权发布。
- [ ] `10700`/`10701` forward migration、静态 inventory 和 PostgreSQL smoke 证明账务只读与 V2-only 最终 catalog。
- [ ] lint、typecheck、相关 unit/contract/integration、Web production build、SQL static check 与最终全量门禁通过。
- [ ] 计划状态改为 completed，最终范围审计逐项覆盖 R1–R16，无未处理 blocker 或兼容残留。

## Notes

- 权威计划：`docs/plans/2026-08-22-004-refactor-semantic-architecture-billing-retirement-plan.md`。
- 本项目为绿地，不迁移或回填 V1 语义数据；历史计费数据物理销毁不在本任务范围。
