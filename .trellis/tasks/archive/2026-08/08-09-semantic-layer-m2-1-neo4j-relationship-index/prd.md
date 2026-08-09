# M2.1 Neo4j Relationship Index

## Goal

在 M2 PostgreSQL exact-release Semantic Explorer 之上，增加一个可重建、可降级的 Neo4j
关系搜索投影，让用户和 Agent 能按业务、Join、公式、物理绑定与治理关系搜索和遍历语义图，
并以参考图的方向、关系标签、聚焦与路径解释方式展示。PostgreSQL 始终是唯一语义权威；
Neo4j 不拥有 Candidate、Review、Release、Pointer、权限或发布状态。

## Confirmed facts

- M2 已在提交 `3cb4646` 交付并归档：同一 `SemanticExplorerSnapshot` 已提供 exact release、
  redacted objects/edges、diff、lineage 与 bounded graph。
- PostgreSQL `semantic.semantic_outbox` 已在发布事务写入 `SOURCE_RELEASE_CREATED` /
  `SOURCE_RELEASE_ACTIVATED`，但当前没有 Neo4j adapter、关系索引 checkpoint 或 worker。
- 既有 roadmap 原本把 Neo4j 放在证据准入的 M6；用户已明确要求 PostgreSQL 为核心权威、
  Neo4j 保存并搜索关系，因此本任务以可选投影方式提前交付，不改变 M3–M5 的发布链。
- RQ297/RQ298 与 Graphify 查询要求 projection receipt 匹配 exact release/generation/digest，
  stale/down/mismatch 时回退 PostgreSQL；Neo4j bookmark 只提供因果读取，不是发布授权。
- 当前 Neo4j JavaScript Driver 为 `6.2.0`；官方当前 API 使用 `executeRead/executeWrite`，
  session 必须指定 database 并在 `finally` 关闭，managed transaction callback 必须幂等。

## Requirements

### M2.1-R1 — PostgreSQL authority and projection receipt

- PostgreSQL 保存关系索引 job/checkpoint、attempt/fence、exact release/projection identity、
  graph manifest digest、对象/边数量、状态和稳定错误码；这些是投影运行证据，不是新的语义真值。
- 每次构建输入必须来自 M2 strict builder 产出的 redacted exact-release snapshot，禁止从
  Candidate、raw restriction payload 或请求体拼装 Neo4j 内容。
- `READY` checkpoint 只在 Neo4j build seal 已原子切换且回读 count/digest 一致后提交；
  旧 attempt/fence、另一 release digest 或另一 projection digest 不能提交成功。
- 发布 outbox 可被幂等发现并排队；定时 reconciliation 也能为缺失/失败/stale checkpoint
  补建。重复处理同一 release 必须收敛到同一 manifest，不产生重复可见节点/边。

### M2.1-R2 — Rebuildable Neo4j graph

- Neo4j 中每个 build 按完整 App/Tenant/Environment/Domain/Release/Digest 隔离；节点和边还
  绑定 `build_id`、canonical digest 与 relationship projection digest。
- build 使用不可见 staging generation；只有 `GraphReleaseSeal.active_build_id` 的 exact
  build 可查询。构建失败或进程崩溃不会暴露半图；旧 build 可在新 seal 切换后回收。
- 图使用固定、不可由请求扩展的五类关系：`BIZ | JOIN | FORMULA | BIND | GOVERN`。
  节点至少覆盖可显示语义对象，以及 release、executable/relationship/restriction projection
  等治理身份；治理节点只含 ID/digest/version 等安全字段。
- Neo4j 可以完全删除并从任意 PostgreSQL immutable release 重建；删除 Neo4j 数据不影响
  PostgreSQL Explorer、发布、权限或 Query Runtime。

### M2.1-R3 — Exact-release relationship search

- 搜索只接受 strict domain、active 或 exact historical release、可选 root/term、五类 edge
  filter、`upstream | downstream | both`、hop 1–6、node <=250、edge <=500 与 server timeout。
- 服务先从 PostgreSQL 解析 Capability 和 exact release，再查询只匹配该 release/digest/
  projection digest/active build 的 Neo4j；返回后再次重验 PostgreSQL pointer/permission。
  active identity 在窗口内变化时返回稳定 stale/retry，不混合两个 generation。
- Neo4j 只返回对象身份和关系候选；可显示名称、详情与 restricted 状态由同一 PostgreSQL
  snapshot hydrate。找不到对象与无权对象保持不可区分。
- Neo4j disabled/down/not-ready/stale/digest-mismatch 时返回明确状态，并用 M2 bounded
  PostgreSQL read model 形成 `POSTGRESQL_FALLBACK`；不得返回部分 Neo4j 结果冒充 current。
- 客户端与 Agent 永远不能提交 raw Cypher、label、property、scope、release digest、Capability
  或数据库 credential。

### M2.1-R4 — Agent read parity

- 注册版本化 server-owned read descriptors 与 executor：列 Domain、读取 active/exact release、
  搜索关系、读取 bounded lineage、diff release、比较 Candidate。
- Web 与 Agent 调用同一 server service 和 Public DTO；Agent 不能使用另一套 Neo4j 查询或
  绕过 PostgreSQL capability/release fence。
- 不注册 approve、publish、rollback、policy mutation、raw SQL、raw Cypher 或 Neo4j direct
  access；请求 allowlist 不能增加服务器未注册能力。

### M2.1-R5 — Rich graph interaction

- Explorer Graph 显示五类 edge filter、方向箭头和关系合同标签；支持名称/ID 搜索聚焦、
  节点选择、拖拽、缩放/适配画布、上游/下游/both 与 hop 控制。
- 右侧详情区区分 Node 与 Edge contract，显示 PostgreSQL release identity、索引状态和
  traversal explanation；历史/active、Neo4j/fallback 状态不可误认。
- SVG 节点不超过 250、边不超过 500；键盘可选择节点/边，并提供同内容的可访问关系表。
- Graph 操作只改变视图状态，不修改 snapshot、active pointer、Candidate 或 index checkpoint。

### M2.1-R6 — Operations, configuration and observability

- Neo4j URI、database、user 和 credential 只从 server configuration/SecretRef 解析；Public
  DTO、日志、错误和 PostgreSQL checkpoint 不保存 credential/URI userinfo。
- `SEMANTIC_RELATIONSHIP_INDEX_ENABLED=0` 是完整 PostgreSQL-only rollback；Web/Agent 仍可
  使用 fallback。Neo4j 不是 Web、发布或 Query Runtime 的启动依赖。
- Compose 可启动 Neo4j 与独立 indexer，但 Web 只依赖 PostgreSQL 健康；Neo4j 故障不得使
  `/semantic/explorer` 或 PostgreSQL 发布链不可用。
- 记录稳定 event/reason code、scope、release/build/attempt ID、count/digest 与 duration；
  不记录 raw projection、restriction predicate、Cypher 参数、credential 或数据库原始错误。

## Acceptance Criteria

- [x] Contract strict-parse 和 round-trip 覆盖 manifest/receipt/search/status/Agent tool；未知字段、
      超限、raw Cypher/credential/policy 形状全部失败。
- [x] PostgreSQL 17 clean install 证明 10625 ledger/checksum、RLS、精确 grants、job claim/fence/
      retry/reconciliation、跨 scope/domain 隔离与旧 attempt commit 拒绝。
- [x] Neo4j integration 证明首次 build、同 release 幂等 rebuild、staging 不可见、seal 原子切换、
      stale build 清理、exact counts/digest 与完全删除后重建。
- [x] Active search 在 query 前后都重验 PostgreSQL exact pointer；双连接 pointer swap 注入时只返回
      `AUTHORITY_CHANGED`/retry，不返回旧图与新 pointer 的混合结果。
- [x] Neo4j down、disabled、not-ready、digest mismatch 均回退 PostgreSQL；fallback 结果 obey 同一
      redaction、hop/node/edge ceiling，且状态对 Web/Agent 一致。
- [x] Web 与 Agent 对同一 request 得到相同 release identity、节点/边 identity、source/status；
      Agent registry 中不存在 mutation/raw SQL/raw Cypher tool。
- [x] Graph 可过滤 BIZ/JOIN/FORMULA/BIND/GOVERN，显示方向/合同标签、搜索聚焦、拖拽、缩放、
      Node/Edge 详情和 traversal explanation，并有键盘/表格 fallback。
- [x] 10k node/代表性关系 benchmark 达到冻结预算：Neo4j warm search p95 <= 300 ms、service
      end-to-end p95 <= 1.5 s、UI interaction p95 <= 100 ms、DOM ceiling 不超限。
- [x] Package tests/typecheck、scoped Biome、migration verify、PostgreSQL 17、Neo4j integration、
      compose health 与 headed-browser proof 全绿。
- [x] 精确提交清单不包含现有 DataFoundry、Sidebar、`/semantic`、global CSS、UI primitive、
      `tsconfig.tsbuildinfo` 或父级 roadmap 脏文件。

## Out of Scope

- Neo4j 写回 Candidate/Review/Release/Pointer/Policy，或把 bookmark/checkpoint 当作发布授权。
- Agent approve/publish/rollback/policy mutation、raw SQL/Cypher 或任意图算法执行。
- 自动推断新的业务关系、Join 合法性、因果/归因；图只索引已发布且已验证的关系合同。
- M3 schema-to-candidate、M4 Metric Authoring Agent、M5 Query Runtime closure。
- Neo4j 高可用集群、Aura provisioning、CDC/Kafka；首版使用 outbox discovery + reconciliation。

## Rollback

关闭 `SEMANTIC_RELATIONSHIP_INDEX_ENABLED`，停止独立 indexer/Neo4j 服务。所有读取立即使用
PostgreSQL M2 fallback；不移动 active pointer、不删除 release、不回滚 10625。Neo4j 数据与
checkpoint 可保留审计或稍后完全重建。
