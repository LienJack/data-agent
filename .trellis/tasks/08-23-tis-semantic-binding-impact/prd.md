# M3 语义绑定影响候选

## Goal

把不可变的物理 `SchemaDriftEvent` 与唯一当前 Published Semantic Release 做精确绑定，确定性回答
“哪些已发布物理映射和下游语义对象受影响、为什么、需要什么人工动作”，并把可执行的失效建议送入
现有 Candidate 人审链。该能力应降低错误语义绑定继续参与查询的风险，同时不引入第二套候选、发布或兼容
体系。

## Background

- `packages/contracts/src/catalog/schema-drift.ts` 已完整表达物理漂移事实，但
  `binding_impact` 固定为 `UNKNOWN`，事实本身不可被派生结论回写。
- 当前 Published Release 的 Ontology Package 已保存精确 `physical_mappings`、Graph V2、
  `metric_bindings` 与 release/snapshot hash；PostgreSQL 是唯一权威。
- `packages/semantic/src/induction/impact-planner.ts` 已实现有环依赖图的稳定传递闭包，但当前 API 只服务
  induction object hash 变化，不能用伪造 hash 直接套用到物理绑定漂移。
- 现有 Candidate 合同支持 `MARK_STALE` 与 `PHYSICAL_BINDING`，治理发布能力已与 Candidate 创建分离；
  M3 不需要新 Candidate 表或新发布入口。
- migration inventory 已确认 frontier 为 `20260725010705`，下一编号为 `20260725010706`。

## Requirements

- R1. `SchemaDriftEvent` 保持 `schema-drift-event@1.0.0`、`binding_impact: UNKNOWN` 和 append-only
  事实语义；不得为派生影响升级、改写或迁移旧 event。
- R2. 新建唯一的 `semantic-binding-impact` 当前合同，闭合 Workspace scope、datasource、drift event
  及 storage digest、base/current snapshot hash、精确 active release ref 与 authority input hash。
- R3. Authority input 只从 PostgreSQL 当前 active release 绑定的 Ontology Package 读取；release、
  datasource、package 或 snapshot 任一不一致均 fail closed，不读取 latest 替代、不读取 Candidate/草稿。
- R4. 直接影响匹配以 Published Release 的 `physical_mappings` 为准；relation/column/FK/constraint
  locator 必须精确匹配。多映射歧义、未知 lineage、过量结果和不可解析 locator 必须显式记录为人工调查，
  不猜 replacement id。
- R5. 依赖闭包复用一个通用、纯函数、可终止的 deterministic closure helper；induction impact 与 binding
  impact 不得各自维护一套 BFS/排序实现。
- R6. 删除/改变已绑定 relation、column、FK、PK、unique/check 等可能改变查询含义的操作，产生受控的
  `MARK_STALE` / review 建议；comment、ordinal、index 和新增未绑定对象不得被夸大为必然语义破坏。
- R7. 影响 artifact 区分 direct/transitive/no-op，携带稳定 risk、建议动作、reason code、证据 hash、
  unchanged object hash 与 canonical order；相同 authority input 必须得到相同 plan hash。
- R8. 有可执行失效项时，复用现有 `semantic.create_candidate_draft` 原子创建一个 DRAFT Candidate；
  Candidate 只表达 `MARK_STALE`/待审内容，不自动重绑、Approve、Submit 或 Publish。无语义动作时只提交
  no-op receipt，不制造空 Candidate。
- R9. PostgreSQL 10706 只新增 append-only receipt/RPC 及必要的不可变、scope、FK、RLS、grant 和
  idempotency 约束；不得复制 Candidate/Release 表，不做旧数据迁移或 backfill，不创建 `_v1`/`_v2`
  双 RPC。
- R10. load 与 commit 之间必须重新核验 active release、drift storage digest、snapshot closure 与 authority
  input hash；同键同输入返回同一 receipt/Candidate，同键异输入显式冲突。
- R11. 内部 authority bundle 可携带 package/drift 详情；公开 read contract 只返回安全摘要、内容寻址 ref、
  risk/count/reason 与 Candidate ref，不暴露 package JSON、raw source payload、SQL、DSN、prompt 或 provider
  载荷。
- R12. M3 只交付 Contracts、Semantic、Platform、PostgreSQL 和应用用例；Studio/API 交互属于 M4，
  governed vector/knowledge retrieval 属于有量化门禁的 M2，均不在本任务实现。

## Acceptance Criteria

- [ ] AC1. relation/column 删除与类型、可空性、默认/生成规则变化能定位精确直接 mapping，并通过
  Graph V2、metric binding 与 constraint dependency 得到稳定传递影响。
- [ ] AC2. FK、PK、unique/check 的删除或变化能生成 join/formula/constraint 的复核建议；多映射、未知
  lineage 显式进入 `MANUAL_INVESTIGATION`。
- [ ] AC3. comment、ordinal、index 变化以及新增未绑定 relation/column/constraint 产生可验证 no-op
  receipt，不创建 Candidate。
- [ ] AC4. 循环依赖终止；输入乱序、重复依赖和重复运行不改变 plan hash、排序或 Candidate idempotency。
- [ ] AC5. stale release、release digest mismatch、drift digest mismatch、base/current snapshot mismatch、
  datasource/scope 越界全部 fail closed，且无 receipt/Candidate 写入。
- [ ] AC6. review-required plan 与 Candidate 在一个 PostgreSQL 事务内提交；Candidate 为 DRAFT 且只有
  `MARK_STALE` 建议，planner 和 RPC 都不能触发 Submit/Approve/Publish。
- [ ] AC7. receipt 表不可 update/delete，重复提交返回 `created: false`；同 idempotency key 异 plan 返回
  typed conflict；跨 workspace/datasource 读写被 RLS/capability 拒绝。
- [ ] AC8. safe projection 可由 impact ref 读取，且敏感字段不在返回契约中；内部 bundle 和公开 projection
  使用不同 strict schema。
- [ ] AC9. Contracts、Semantic、Platform typecheck/unit tests、migration renderer/inventory/static tests 与
  PostgreSQL 17 focused smoke 通过；旧 `binding_impact: UNKNOWN` 事实仍通过既有测试。
- [ ] AC10. 仓库中不存在新旧 binding-impact runtime 并存、兼容 adapter、fallback、数据迁移或第二套
  Candidate/Publish 实现。

## Out of Scope

- 自动推断或写入 replacement physical locator、自动重绑、自动提交 Candidate、自动批准或发布。
- 修改历史 schema drift event、回填历史 drift、为旧数据生成 receipt。
- Studio/Explorer UI、公开 API route、通知和浏览器验收；这些由 M4 消费 safe projection。
- 向量召回、知识检索、Neo4j 作为权威或对 TIS ObjectType/XML 模型的复制。

## Technical Notes

- 首选迁移编号：`20260725010706_app_data_agent_semantic_binding_impact`；开始实施前再次运行 inventory，
  若并行任务占用则只前移编号，不改变协议设计。
- Candidate 操作数量沿用现有 256 上限；超限时提交 `MANUAL_INVESTIGATION` receipt，不截断并发布部分
  结论。
- 当前无阻塞的产品、兼容、UX 或风险决策；M4 只消费本任务的 safe projection。
