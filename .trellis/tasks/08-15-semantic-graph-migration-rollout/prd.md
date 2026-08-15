# Graph v1 迁移、治理与上线收口 PRD

## Goal

将现有内嵌语义确定性转换为新的 Node/Edge candidate，在不改写旧 release 的前提下完成审核、
发布、Query Runtime、端到端业务验收、分阶段上线和可恢复回滚。

## Scope

- Graph v1 → v2 converter、unresolved report、dual compile compare。
- Review/validation/publish/rollback authority 集成和 Query Grounding 隔离。
- Feature flags、监控、rebuild/rollback runbook、10k/E2E/权限验收。
- 三个业务正例与歧义/Formula/Join 负例的最终演示。

## Requirements

- 旧 source/release/query run bytes 与 digest 不变；转换只产生新 candidate/release。
- 转换只按稳定 identity 映射，名称或方向不唯一时进入 unresolved candidate。
- Candidate 在人工审核和 exact validation receipt 之前不能进入 active Query Grounding。
- 发布绑定 exact base release、candidate revision、compiler/policy/validation；stale approval 失败关闭。
- 上线按 read adapter、dual compile、allowlisted authoring、Graph v2 publish、full graph 分阶段。
- 回滚关闭 feature flags 并继续服务 last active release；不删除 revision/receipt 或破坏性 down migrate。
- PostgreSQL graph projection、community、Neo4j 可从 release source 重建。

## Out of Scope

- 自动身份合并、自动 approve/publish、删除旧 Graph v1 release、一次性全量强制切换所有 workspace。

## Acceptance Criteria

- [ ] v1 fixtures 的 entity/dimension/metric/formula/table/column/relationship 全部转换为预期 Node/Edge。
- [ ] 歧义 identity、绑定、方向和依赖进入 unresolved，不被自动发布。
- [ ] dual compile 证明代表性查询 runtime 结果等价，旧 digest/replay 不变。
- [ ] 三个正例完成 intent → tools → live graph → validation → review → publish → query。
- [ ] 重名、未知列、含糊状态、cycle、unit/grain、unsafe fanout 全部澄清或失败关闭。
- [ ] RLS、stale publish、并发发布、SSE reconnect、projection rebuild 和 rollback 演练通过。
- [ ] 新增维度演示的 migration ledger 中没有业务 schema DDL。
