# M3 语义绑定影响候选设计

## Architecture Boundary

唯一维护链如下：

```text
PostgreSQL SchemaDriftEvent + exact active Published Release/Ontology Packages
  -> strict BindingImpactAuthorityBundle + authority_input_hash
  -> pure physical-binding matcher
  -> shared transitive-dependency closure
  -> content-addressed BindingImpactPlan
  -> atomic PostgreSQL receipt + optional existing DRAFT Candidate
  -> safe read projection for M4
```

运行时 Resolved Context、Graph V2 发布读取和 Text2SQL 不经过这条维护链。Planner 没有数据库、Provider、
SQL execution 或发布能力；PostgreSQL Adapter 没有 Approve/Publish 方法。

## Contract Shape

在 `packages/contracts/src/artifacts/semantic-binding-impact.ts` 定义一套新合同，不修改
`SchemaDriftEvent`：

- `BindingImpactAuthorityBundle`：内部输入，包含 scope、semantic domain、drift event + storage digest、
  exact release ref、active Ontology Package documents、`authority_input_hash`。
- `SemanticBindingImpactPlan`：内容寻址计划，包含 `impact_id`、authority refs、direct impacts、transitive
  impacts、unchanged hashes、risk、status、manual reasons、suggested actions 与 `plan_hash`。
- `SemanticBindingImpactCommitReceipt`：PostgreSQL 结果，包含 plan ref、可空 Candidate ref、authority、
  committed_at、created/replayed 与 `receipt_hash`。
- `SemanticBindingImpactSafeProjection`：M4 可消费的公开摘要；不含物理 locator、package JSON、完整 drift
  payload 或 Candidate source/diff payload。

新合同从 `packages/contracts/src/artifacts/index.ts` 与 semantic application port 统一导出。所有数组都要求
canonical order/unique，所有 hash builder 与 verifier 只存在于 Contracts。

## Direct Matching Policy

先把每个 drift operation 规范化为确定性 evidence ref，再匹配 Published Package 的
`physical_mappings`：

| Drift category | Exact target | Outcome |
| --- | --- | --- |
| `RELATION_REMOVED`, `RELATION_KIND_CHANGED` | TABLE/COLUMN/JOIN locator touching relation | `REVIEW_MAPPING`, mark stale |
| `COLUMN_REMOVED` | COLUMN/JOIN endpoint | `REMAP_COLUMN`, mark stale |
| type/nullability/default/identity/generated change | COLUMN/JOIN endpoint | `REVALIDATE_FORMULA` or `REVIEW_MAPPING`, mark stale |
| FK removed/changed | JOIN endpoints derived from before/after FK pairs | `REVALIDATE_JOIN`, mark stale |
| PK/UNIQUE/CHECK removed/changed | mappings on exact relation/columns plus dependent constraints/formulas | review, mark affected targets stale |
| comment/ordinal/index changes | none | `NO_SEMANTIC_ACTION` |
| added unbound relation/column/constraint | none | `NO_SEMANTIC_ACTION` |

若一个物理事实无法唯一关联到当前 mapping，保留证据并返回 `MANUAL_INVESTIGATION`，不按名称模糊匹配，
不生成 replacement locator。

## Dependency Closure

把 `impact-planner.ts` 的 BFS 提取为通用 `collectTransitiveDependents`：输入 canonical object IDs 与
`source -> dependent` edges，输出稳定闭包并处理循环/重复边。原 `planSemanticImpact` 改为调用该 helper，
行为与合同不变；新 binding planner 复用它，不用假 hash 伪装 induction change。

Binding dependency graph 由 exact Published Package 决定：

- physical mapping -> logical object；
- Graph V2 endpoint/object -> relationship object；
- dimension/grain/time/unit/formula -> metric；
- constraint provenance/target -> constraint/target dependent；
- package/object dependency 只在引用能闭合到 exact release set 时加入。

未知 endpoint、跨 package dangling ref 或映射冲突不被静默丢弃，而进入 manual reason。

## Candidate Reuse and Atomicity

重构 `candidate-generation/reducer.ts`：抽取一个从已验证 `SemanticCandidateOperation[]` 构造现有
`SemanticCandidateDraft` 的通用 builder；保留 Agent compile 的薄封装，M3 直接复用通用 builder，避免
复制 diff path、risk 与 `MARK_STALE` 转换。

- `REVIEW_REQUIRED` 且操作数在现有上限内：为直接/传递的可表达对象生成现有
  `semantic-candidate-operation@1.0.0` `MARK_STALE` 操作。
- `NO_SEMANTIC_ACTION`：receipt 的 Candidate ref 为 `null`。
- `MANUAL_INVESTIGATION` 且没有安全可表达操作，或操作数超限：只提交 receipt，不制造伪 Candidate。

`semantic.commit_semantic_binding_impact` 在同一事务内：

1. 锁定 scope authority fence；
2. 重新解析 active release、drift 与 exact release package closure，重算 `authority_input_hash`；
3. 验证 plan canonical hash 与 Candidate draft 对 plan hash/idempotency 的绑定；
4. 调用现有 `semantic.create_candidate_draft`（若需要）；
5. 组装并插入 append-only receipt，返回同一 Candidate ref。

因此不新增 Candidate/Revision/Publish 表，也不存在“Candidate 已创建但 receipt 未链接”的跨事务窗口。

## PostgreSQL Surface

10706 新增：

- `semantic.semantic_binding_impact_receipts`：完整 App/Tenant/Environment/Domain scope、datasource、drift
  identity/digest、release identity/digest、authority/plan/receipt hash、可空 Candidate FK、JSON receipt、
  committed_by/at；不可 update/delete。
- `semantic.load_semantic_binding_impact_authority(...)`：READ capability，返回内部 strict bundle。
- `semantic.commit_semantic_binding_impact(...)`：WRITE capability，原子 revalidation + Candidate reuse + receipt。
- `semantic.get_semantic_binding_impact(...)`：READ capability，只返回 safe projection。

新 RPC 没有版本后缀，因为这是首个且唯一当前实现；后续 shape breaking change 直接 forward replace，不保留
双函数。Migration 不读取或搬运历史 drift 数据，不自动创建历史 receipts。

## Application and Ports

在 semantic application port 新增一个窄 `SemanticBindingImpactPort`，只含 `loadAuthority`、`commit`、
`getSafeProjection`；`packages/semantic/src/application/binding-impact.ts` 负责：

1. 验证 authority scope 与请求；
2. load exact bundle；
3. 运行 pure planner；
4. 构造可选 Candidate draft；
5. 一次 commit 并返回 receipt。

Web 后续只能调用 application service，不能直接实例化 PostgreSQL adapter 或自己解析 receipt。

## Failure Semantics

公开 Port error 使用稳定 code：

- `SEMANTIC_BINDING_IMPACT_SCOPE_FORBIDDEN`
- `SEMANTIC_BINDING_IMPACT_AUTHORITY_NOT_FOUND`
- `SEMANTIC_BINDING_IMPACT_AUTHORITY_STALE`
- `SEMANTIC_BINDING_IMPACT_AUTHORITY_MISMATCH`
- `SEMANTIC_BINDING_IMPACT_IDEMPOTENCY_CONFLICT`
- `SEMANTIC_BINDING_IMPACT_INVALID`
- `SEMANTIC_BINDING_IMPACT_UNAVAILABLE`

Manual reason 属于成功 receipt 的领域结论，不用数据库异常替代。未知数据库异常保留内部 cause，公开结果不
返回 SQL、参数或 payload。

## Rollback and Compatibility

回退仅回退 10706 代码提交和未部署 migration；一旦 migration 已部署，表与历史 receipt 保留为不可变审计
数据，停用调用方即可。没有 V1/V2 兼容层、dual read/write、旧 event 回填或 runtime fallback。M3 不改变
Resolved Context V2、Published Release 或现有 Candidate publish 行为。

## Risks and Controls

- Package 内容过大：合同与 SQL 均设置 package/mapping/object/dependency 上限；超限 fail closed。
- 规则误报：只使用 exact locator；无唯一证据转 manual，不使用模糊匹配。
- TOCTOU：load 返回 authority hash，commit 在锁内重算并逐字段核验。
- Candidate 过大：沿用 256 operation 上限，绝不截断；改为 manual-only receipt。
- SQL/TypeScript hash 漂移：使用现有 canonical SHA helper，并以 PostgreSQL 17 round-trip 测试证明一致。
