# U4 Greenfield Ontology Package、Graph v2 与验证合同

## Goal

在不读取历史 Release、兼容 Fixture 或 Falcon sealed/gold/expected 输入的前提下，建立可重复、内容寻址的
`OntologyPackageCandidate` 合同及 `Canonicalize -> Compile -> Validate -> Persist Preview` 边界。U4 只定义并验证
Candidate；首次发布归 U5，真实 Schema/Business Source 归纳归 U11，Text2SQL runtime lowering 归 U13，Agent 编排归
U20。

## Requirements

1. Namespace 必须完整绑定 `app_id + tenant_id/workspace_id + environment + semantic_domain`；Package ID、版本、状态、
   依赖、导入和 Release Binding 都在该 Namespace 内解释，跨 Scope 引用失败关闭。
2. Stable Object ID 由 `namespace + source_object_identity + semantic_role` 确定性派生；相同输入重建必须得到相同 ID，
   不允许调用方以随机 ID 制造重复概念。
3. `BUSINESS_SUBJECT` 明确承载 `CONCEPT | CLASS | ENTITY | EVENT` 角色；`DIMENSION` 承载 Data Property 的类型、
   单位、敏感级别与物理映射。
4. Object Property/Taxonomy/Alignment 使用 typed Edge，表达正反语义、Domain/Range、基数，以及父子、等价、近似、
   互斥、别名和跨包目标；依赖/导入循环与悬空 Domain/Range 必须拒绝。
5. Constraint 支持 cardinality、required、data type、unique 和 deterministic business rule；Constraint 必须绑定目标
   Node/Edge、Provenance 和验证状态，不能用自由文本冒充可执行规则。
6. Physical Mapping 必须绑定 exact Schema Snapshot ID/hash 与 Datasource，并区分 `QUERYABLE | KNOWLEDGE_ONLY`。
   QUERYABLE 的 Column/Join 必须存在于当前 Snapshot；Join 必须引用 DDL、统计或查询探针证据。缺证据时降为
   KNOWLEDGE_ONLY 或 unresolved，不能进入 runtime。
7. Metric 必须闭合 Concept、Formula AST、Dimension、Grain、Time 与 Unit；Formula AST hash 必须与 compiler 输出摘要
   一致。无法确定的 Metric/Formula 保留为 unresolved，不允许模型猜测。
8. Node、Edge、Constraint、Formula、Mapping 均必须有 canonical Provenance；任何引用的 Evidence 必须存在、类型允许、
   属于同一 Candidate Source closure。
9. `MandatoryReleaseManifest` 中所有对象必须 `unresolved=0` 且验证通过；可选不确定对象排除出 v1 manifest，但保留在
   Candidate 中供后续治理。
10. Candidate 必须绑定一个 exact Schema Snapshot、Business Source Bundle ref/hash 与 Policy Digest；相同 Candidate
    版本在输入数组任意排序下产生相同 Package Hash。
11. Source classification 只允许 Schema、Business Context、Policy 与 deterministic compiler evidence。任何 Falcon
    Gold/Expected/Sealed/Holdout 或跨 Workspace 引用在 Contract/Validator 边界立即失败。
12. PostgreSQL 只持久化 immutable Candidate Package/Validation/Preview Authority；不得创建第二份 Graph/Release
    Authority，不得 backfill、dual-read 或修改旧 Release。

## Acceptance Criteria

- [x] `ontology-package@1.0.0` strict schemas、canonical hash builders/verifiers 与 deterministic stable-ID resolver 全部落地。
- [x] 固定 Greenfield Fixture 经 `canonicalize -> compile -> validate` 得到稳定 Package Hash；重排输入结果完全相同。
- [x] Namespace/依赖循环、重复 Stable ID、悬空 Domain/Range、矛盾基数/Constraint、缺 Provenance、AST 摘要漂移均失败。
- [x] QUERYABLE Mapping 的 Snapshot/Column/Join evidence 漂移失败；KNOWLEDGE_ONLY 不进入 runtime projection。
- [x] Mandatory Manifest 含 unresolved 或缺验证对象时失败；optional unresolved 保留 Candidate 且不进入 v1 manifest。
- [x] Falcon/benchmark sealed 输入与跨 Workspace Source 引用有机械反例并在持久化前拒绝。
- [x] PostgreSQL fresh install、RLS/NOLOGIN owner/grant、immutable replay、cross-scope 与 hash tamper assertions 通过。
- [x] Contracts/Semantic/Platform focused tests与build、Contracts/Platform typecheck、renderer/static、Biome、diff-check 全绿；Semantic 全包 typecheck 仅被共享 U3 测试 fixture 漂移阻断，U4 source build 通过。
- [x] 仅提交 U4 owned paths；不导入数据、不发布 Release、不调用 Provider、不运行 Falcon gate。

## Out of Scope

- Candidate 自动归纳、LLM/Agent proposal、真实 Business Source ingestion（U11）。
- 首版 Bootstrap Publish、后续 Review/Publish/Rollback（U5）。
- Text2SQL lowering、Neo4j projection、Studio 编辑 UX（U13/U17）。
- Falcon scoring、数据导入、真实 Provider 调用与全局 GO（U18/最终门禁）。
