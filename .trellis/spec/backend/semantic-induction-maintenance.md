# Semantic Induction Maintenance

U11 将 Schema、受治理知识文档、Metric 交换包与基础本体包转换为 U5 `Candidate`，但不拥有 Review、Approve 或 Publish 权限。PostgreSQL 是 Source Package、Proposal、Impact Plan、Metric Dry-run 与 Induction Receipt 的唯一持久 Authority；Semantic 包仅提供纯确定性内核。

## 固定边界

- 所有执行通过 U10 `SEMANTIC_INDUCTION` 或 `METRIC_IMPORT` Job lease/fence；Worker 不直接 DML。
- Stable Object ID 由 canonical namespace、role、Unicode normalized name、排序后的 mapping/evidence identity 派生，不依赖输入顺序或随机数。
- `FOUNDATIONAL_ONTOLOGY` 只能携带 `ONTOLOGY_ALIGNMENT` fact；`METRIC_EXCHANGE` 只能携带至少一个 metric entry。两类包不得混合角色。
- 文档源必须来自 U15 已提交且允许投影的 Knowledge Revision；Holdout、TEST、gold、expected output、Oracle feedback 与 benchmark 标记在 Candidate 写入前拒绝。
- `base_release_ref` 必须与当前 active release 一致；首次无 release 时才允许 `null`。
- Metric import 先持久化 dry-run 结果；`INVALID` 或 `CONFLICT` 只产生 rejection receipt，不产生 Candidate。
- 漂移只计算依赖图的 transitive affected closure，未受影响对象保留原 content hash。
- 成功提交只调用 U5 `semantic.create_candidate_draft`；U11 migration 不创建第二套 Candidate 表或 publish RPC。

## Schema Drift Binding Impact

- `SchemaDriftEvent` 始终是 append-only 物理事实，`binding_impact` 保持 `UNKNOWN`；派生结论只写入
  `app_data_agent.semantic_binding_impact_receipts`，不回写或迁移历史漂移。
- Binding Impact authority 只读取精确 drift event 和唯一 active Published Release 所绑定的 Ontology
  Package。按目标 datasource 筛选的 physical mapping 必须绑定 drift base snapshot；不存在 latest、Candidate
  或草稿 fallback。
- Planner 只做 exact locator matching，并与 induction 共用 deterministic dependency closure。comment、ordinal、
  index 与新增未绑定结构产生 no-op；歧义、dangling reference、未知 lineage 和超限显式转为人工调查。
- 只有 `REVIEW_REQUIRED` 才在同一 PostgreSQL 事务内复用 `semantic.create_candidate_draft` 创建 DRAFT
  Candidate，且操作仅为 `MARK_STALE`。该路径没有 Submit、Approve、Publish 或自动重绑权限。
- Commit 重新读取并锁定 active release pointer，复核 authority/plan hash 后才创建 Candidate 与不可变 receipt；
  同 impact 同输入重放原回执，异输入返回 typed conflict。
- `get_semantic_binding_impact` 只返回 safe projection；package JSON、完整 drift payload、Candidate source/diff、
  SQL、连接信息和 provider payload 不进入公开读取合同。
- Binding Impact 只有一个无版本后缀的当前 RPC 面，不提供 `_v1`/`_v2`、dual read/write、历史 backfill 或
  第二套 Candidate/Release authority。

## 验证要求

- Contracts 验 canonical hash、stable identity 与跨文档引用闭合。
- Platform 在事务内绑定 AppCapability、scope、Job attempt/fence 与 replay。
- Fresh PostgreSQL 17 验证时可将 ecommerce/Falcon import hook 映射到 `/dev/null`；U11 不导入或执行 benchmark，也不调用 Provider。
- Binding Impact 变更还必须通过 10706 deterministic renderer、migration inventory/static check、
  `53-semantic-binding-impact-assertions.sql` 以及 Contracts/Semantic/Platform 的 hash/substitution 测试。
