# M2 Semantic Explorer

## Goal

让用户按 Domain 浏览 PostgreSQL 当前活动语义版本，并能从同一份、同一代
`SemanticExplorerSnapshot` 在树、表、图、详情、版本差异和 lineage 之间导航。Explorer
必须清楚区分已发布对象、已弃用对象和候选对比；候选内容永远不能混入活动对象集合或被
显示成运行时真值。

## Confirmed Baseline

- M0 已提交并归档 PostgreSQL-first 的 Candidate/Review/Publish 安全基线；M1 已提交并归档
  PostgreSQL 物理结构快照与 drift。
- 当前活动版本由 `semantic_active_pointer` 指向 `semantic_source_release`，release 精确绑定
  executable、relationship、runtime-restriction 三份投影的 ID 与 digest。
- 当前 U5 executable projection 已含 metric、dimension 和 metric 内的 formula，但没有完整的
  BusinessOntology、PhysicalBinding 和 CatalogGovernance 展示面。
- `semantic_source_release.candidate_id` 不能单独证明某个可变 candidate current revision 就是
  当时发布的完整 source；M2 不从 candidate current revision 反推活动版本。
- 当前工作区的 `/semantic`、Sidebar、全局样式和 DataFoundry 组件有用户未提交修改；M2 使用
  自包含路由与组件，除非另行批准，不修改这些重叠文件。

## Requirements

### M2-R1 — One authoritative release snapshot

- 新增窄 PostgreSQL READ RPC，一次返回 active pointer、exact source release 和 release 精确
  绑定的三份 projection；Backend 只有 RPC `EXECUTE`，不能直接读取这些底表。
- RPC 必须验证完整 app/tenant/environment/domain scope、server-owned principal 和只读 Authority；
  Browser/Auth role 不能调用。
- 任何 release、projection ID、release ID 或 digest 不一致都失败关闭，不返回部分活动版本。
- API 返回 exact `release_identity`、当前 `pointer_observation`、`is_active` 和三份 projection
  identity；响应使用 `private, no-store`。活动请求只以 `pointer_generation` 处理新旧响应，历史
  release 永远按请求的 exact release ID 展示，不能伪装成当前活动版本。

### M2-R2 — Strict unified read model

- 在 `@data-agent/contracts` 定义 strict、版本化的 `SemanticExplorerSnapshot`、对象、边、
  release summary、diff、lineage、candidate comparison 和稳定错误码。
- 活动对象使用结构化 `{kind, object_id}` identity；跨类型同名不覆盖，重复 identity、悬空边和
  未知 payload 字段失败关闭。
- `@data-agent/semantic` 以纯函数从同一个 source envelope 构建 object index、edge index、
  counts、search index、details、diff 和 lineage，Web 组件不得重新解释原始 projection JSON。
- U5 executable projection 以 additive、版本化的 `explorer_sidecar@1.0.0` 携带从已验证
  `SemanticSourceBundle` 确定性派生的 BusinessOntology、RelationshipRegistry、
  PhysicalBinding、CatalogGovernance 和公式签名展示材料；sidecar 自身内容寻址，并随
  executable projection digest 被 release 绑定。
- 历史 release 没有 sidecar 时仍可展示其已绑定的 metric/dimension/relationship 核心投影；
  `capabilities` 明确标记缺失面。不得把 table、FK 或列名推断为 BusinessEntity。

### M2-R3 — Explorer information architecture

- 新增自包含 `/semantic/explorer`：左栏为 Domain 与 Entity/Metric/Dimension/Relationship/
  Datasource 分类树和搜索；中栏在表格与关系图间切换；右栏展示定义、别名、owner、公式、
  grain、unit、time、null/fanout、binding、proof、版本、状态与影响范围。
- Tree、table、graph、detail、diff、lineage 必须接收同一个已解析 snapshot；视图开关、选择、
  搜索和展开只改变本地 View State，不修改 read model。
- 图由对象和边在 Web 内确定性派生；全量 identity/count 与表格一致，实际 SVG 只渲染当前选择
  的有界邻域，不引入 Neo4j，也不把路径冒充安全 Join、贡献或因果证明。
- release timeline、历史 release 和 release-to-release diff 都按 exact immutable release ID
  读取；深链接详情/lineage 必须携带 release ID，不能默读“最新”后与页面 generation 混用。

### M2-R4 — Published and candidate states stay separate

- 活动集合中的状态只来自 exact released material：`published` 或显式 lifecycle 的
  `deprecated`。没有显式 lifecycle 时不能靠 tag/name 猜测弃用。
- Candidate comparison 是独立判别联合，绑定 exact candidate ID、revision ID、source revision、
  base release identity 和 candidate status；base identity 漂移或治理状态为
  `STALE_REBASE_REQUIRED` 时显示 `stale`，否则显示 `candidate`。
- Candidate diff 只能出现在对比带/叠层，不能插入活动 `objects`、改变活动 counts、成为 graph
  的 published 节点，或被对象详情标成当前 runtime 版本。
- M2 读取现有候选和确定性 diff；不新增 AI 生成、编辑、审批、发布或回滚动作。

### M2-R5 — Authorization and redaction

- Web 继续使用 server-resolved PostgreSQL Capability；请求不能提供 app/tenant/principal/role、
  projection payload、release digest 或权限覆盖。
- raw runtime-restriction projection 只在 server read-model builder 内使用，绝不进入 Public DTO。
- DENY/不可展示的 table/column 会在对象和边进入 read model 前被剔除；相关 dangling edge、binding、
  formula dependency 和 lineage 同步剪枝。RESTRICT policy 的 predicate/parameter 细节不向 UI 暴露。
- 无对象权限返回 permission-denied，不泄露对象是否存在；原始 SQL/DB/payload 错误统一脱敏。

### M2-R6 — Freshness and performance budget

- API、React state 和浏览器缓存都不得用旧 snapshot 覆盖更高 `pointer_generation`；并发请求按
  domain + request epoch 取消或丢弃过期响应。
- 10,000 对象基准：server decode/filter/index 的 10 次 warmed p95 不超过 750 ms、heap delta
  不超过 128 MiB；本地 PG17 warm API p95 不超过 1.5 s，压缩响应不超过 8 MiB。
- 表/树采用窗口化或分段渲染，DOM 同时不超过 250 个对象行；搜索、选择和视图切换的 warmed p95
  不超过 100 ms。图最多渲染 250 节点/500 边的选择邻域，不创建 10k 全量 SVG DOM。
- benchmark 输出结构化 JSON；超预算以非零退出码形成 M2 Gate，不能只写在文档中。

### M2-R7 — Rollout and compatibility

- Explorer 页面受 `SEMANTIC_EXPLORER_ENABLED` 控制；关闭后返回现有 Review Workspace 链接，
  不变更 active pointer、release 或 projection 数据。
- M2 不修改当前脏工作区的 `/semantic` 页面、Sidebar、AppShell、全局样式和 DataFoundry store。
  导航整合待这些用户修改提交后作为独立、可审查的 integration diff。
- 新 contract/SQL 都 additive；不改写 10610/10622/10623 已应用 migration。

## Acceptance Criteria

- [x] PG17 clean install 后，窄 READ RPC 只对 Backend 生效；Browser/Auth 无权限，Backend 对 active
      release/projection 底表无直接 DML/SELECT，跨 scope/domain 读取失败关闭。
- [x] pointer、release 和三份 projection 任一 ID/digest/release 绑定缺失或漂移时返回稳定错误，
      不产生 partial snapshot。
- [x] 同一 snapshot 的 tree/table/graph/detail 使用相同 `release_id + pointer_generation`；活动
      object identity/count 完全一致，所有 edge 端点都存在。
- [x] 一次更高 pointer generation 到达后，旧缓存或乱序响应不能覆盖；headed browser 刷新能看到
      新 generation，无 hydration/console error。
- [x] metric、dimension、formula、relationship、binding、proof、BusinessOntology（若 sidecar 存在）
      和 datasource 可导航；缺 sidecar 时明确显示能力缺失且不伪造 Entity。
- [x] `published/deprecated` 与独立的 `candidate/stale` 在合同、颜色、标签和说明上不可误认；candidate
      overlay 不改变活动 counts 或 active graph。
- [x] restricted/denied 字段、policy predicate 和悬空依赖不进入 Public DTO；对象不存在与无权不可被
      响应差异探测。
- [x] release diff 和 lineage 使用 exact release identity，循环、悬空引用、超 hop/node ceiling
      稳定失败或截断并给出显式状态。
- [x] 10k benchmark 达到 M2-R6 数字预算；表/tree/graph 的 DOM ceiling 有自动断言。
- [x] scoped lint、typecheck、unit/contract、PG17 integration、headed browser 和 Trellis check 全绿。
- [x] 只提交 M2 owned files，既有 DataFoundry/Sidebar/`/semantic`/global CSS 脏修改保持原样。

## Out of Scope

- M3 的 schema-to-semantic AI proposal、M4 的 Metric Authoring Agent、M5 的 Query Runtime closure。
- 修改、审批、发布、回滚、review policy、Secret/credential 或 datasource 业务数据读取。
- 从 table/FK/graph path 自动推断 BusinessOntology、安全分析 Join、归因或因果关系。
- M2 本次提交不实现 Neo4j；Neo4j 关系搜索投影已转入 M2.1，且不得成为非 PostgreSQL Authority
  或第二套 semantic object model。
- 为历史 release 补造它从未发布过的 ontology/binding；缺失只显示 capability gap。

## Rollback

关闭 `SEMANTIC_EXPLORER_ENABLED` 并回到现有 Review Workspace。M2 是只读投影与 additive RPC，
无需移动 active pointer、删除 release 或执行 destructive down migration。
