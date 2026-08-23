# Semantic Relationship Index

> PostgreSQL 保存发布、指针、索引任务和 Checkpoint 权威；Neo4j 只保存可删除、可重建的关系投影。

## 场景：构建或消费语义关系索引

### 1. 范围 / 触发条件

- 新增或修改关系图 Manifest、10625 索引任务、Neo4j Adapter、索引 Worker、Web/Agent 关系搜索时适用。
- Neo4j 不得成为展示名称、权限裁剪、发布状态或 Active Pointer 的 Authority。

### 2. 签名

```ts
interface SemanticRelationshipGraphAdapter {
  initialize(): Promise<void>;
  stageBuild(input: { build_id: string; manifest: SemanticRelationshipGraphManifest }): Promise<void>;
  verifyAndSeal(input: {
    build_id: string;
    manifest: SemanticRelationshipGraphManifest;
  }): Promise<{ node_count: number; edge_count: number }>;
  search(input: {
    scope: AppScope;
    checkpoint: SemanticRelationshipIndexCheckpoint;
    request: SemanticRelationshipSearchRequest;
  }): Promise<SemanticRelationshipGraphSlice>;
  cleanup(input: {
    scope: AppScope;
    semantic_domain: string;
    keep_release_ids: readonly string[];
  }): Promise<number>;
  close(): Promise<void>;
}

SemanticRelationshipSearchService.search(
  { capability_input, scope },
  request: unknown,
): Promise<PortResult<SemanticRelationshipSearchResult>>;

POST /api/semantic/relationships/search
semantic_explorer_search_relationships@1
```

数据库操作只能通过 10625 的 scoped RPC 完成：discover、claim、heartbeat、commit、fail、reconcile、
read checkpoint 和 requeue。Browser/Auth 角色不得直接访问任务、Attempt 或 Checkpoint 表。

### 3. 契约

- Wire 版本固定为 `semantic-relationship-graph-manifest@1.0.0`、
  `semantic-relationship-index-checkpoint@1.0.0`、`semantic-relationship-search-request@1.0.0` 和
  `semantic-relationship-search-result@1.0.0`；公共边界使用 strict Schema。
- Category 只有 `BIZ/JOIN/FORMULA/BIND/GOVERN`。搜索限制为 1–6 hops、最多 250 nodes、
  500 edges；Category 不得重复。
- Manifest Digest 对排序后的完整图材料做内容寻址。Checkpoint 的 Release、Relationship Projection
  Digest、Build、Manifest、Attempt/Fence 和计数必须精确闭合；非 `READY` 不得携带 `indexed_at`。
- Worker 流程固定为 `PostgreSQL claim -> redacted snapshot -> deterministic manifest -> Neo4j staging ->
  verify/seal -> PostgreSQL checkpoint commit`。Lease/Fence 或 Authority 漂移时不能提交成功。
- Staging Build 对搜索不可见。Seal 必须在一个 Neo4j managed write transaction 内切换同一 Release 的
  Active Build；搜索只读取 exact sealed Build，不读取“最新”或部分 Build。
- Neo4j 只返回候选 node/edge key。服务必须在搜索前后读取 PostgreSQL exact snapshot，重新计算
  Manifest，并从第二次 PostgreSQL 快照水合展示字段；指针、Digest 或候选集合不一致即回退。
- Web 与 Agent 共用 `SemanticRelationshipSearchService`。Web 使用 POST/no-store；Agent descriptor
  只能暴露固定版本的只读工具，不得提供 raw SQL、raw Cypher、凭据或 mutation。
- Feature off 或 Neo4j 不可用时，Web/PostgreSQL 继续工作并返回有界 PostgreSQL fallback。
- 环境键：`SEMANTIC_RELATIONSHIP_INDEX_ENABLED`、`SEMANTIC_RELATIONSHIP_DOMAINS`、
  `SEMANTIC_RELATIONSHIP_INDEX_WORKER_ID`、`SEMANTIC_RELATIONSHIP_INDEX_INTERVAL_MS`、
  `SEMANTIC_RELATIONSHIP_INDEX_LEASE_SECONDS`、`SEMANTIC_RELATIONSHIP_INDEX_HEALTH_PORT`、
  `NEO4J_URI`、`NEO4J_USERNAME`、`NEO4J_PASSWORD`、`NEO4J_DATABASE`、
  `NEO4J_RELATIONSHIP_BATCH_SIZE`。密码只由运行时 Secret/Environment 提供，不能进入日志或 Receipt。
- Neo4j Driver 6 的 Cypher integer 参数必须使用 `neo4j.int(...)`；直接传 JS number 可能编码为 Float，
  从而让 `LIMIT` 等 Integer-only 位置在真实数据库失败。

### 4. 校验与错误矩阵

| 条件 | 稳定结果 |
| --- | --- |
| Feature 关闭 | `POSTGRESQL_FALLBACK + INDEX_DISABLED` |
| 配置缺失 | `POSTGRESQL_FALLBACK + INDEX_NOT_CONFIGURED` |
| Checkpoint 缺失或非 READY | `POSTGRESQL_FALLBACK + INDEX_NOT_READY` 或 Checkpoint Reason |
| Neo4j 连接/事务失败 | `POSTGRESQL_FALLBACK + INDEX_UNAVAILABLE` |
| Build/Manifest/Projection Digest 不一致 | `POSTGRESQL_FALLBACK + INDEX_DIGEST_MISMATCH` |
| 搜索前后 PostgreSQL Pointer/Release 漂移 | `POSTGRESQL_FALLBACK + AUTHORITY_CHANGED` |
| 旧 Attempt/Fence 提交 | `SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE` |
| Scope/Release/Projection Authority 漂移 | `SEMANTIC_RELATIONSHIP_INDEX_AUTHORITY_CHANGED` |
| 未知字段、重复 Category、越界 hops/nodes/edges | `SEMANTIC_RELATIONSHIP_REQUEST_INVALID` |

### 5. Good / Base / Bad

- Good：Neo4j exact sealed Build 返回候选 Key，服务在 PostgreSQL 二次核验后水合并返回 `source=NEO4J`。
- Base：Neo4j 停机或索引尚未 Ready，服务返回相同权限语义的 PostgreSQL 有界结果并说明 Reason。
- Bad：查询 `MATCH ... ORDER BY indexed_at DESC LIMIT 1` 后直接把 Neo4j 属性作为权威 DTO 返回。

### 6. 必需测试

- Contracts：Manifest canonical digest、Checkpoint 状态真值表、严格请求/响应、Category 和 DOM 上限。
- PostgreSQL 17：fresh install、checksum/ledger、RLS/GRANT、跨 Scope、Claim race、Lease expiry、旧 Fence、
  Authority 漂移、幂等 reconcile 和 append-only Attempt Receipt。
- Adapter：In-Memory conformance 与真实 Neo4j 均覆盖 staging 不可见、seal、同 Release rebuild 切换、
  cleanup、删除后 not-ready、完整重建和 Digest mismatch。
- Service/API/Agent：feature off、not-ready、unavailable、digest mismatch、pointer race、权限裁剪、
  Web/Agent DTO parity，以及不存在 mutation/raw SQL/raw Cypher 工具。
- UI：Category、方向/hop、搜索聚焦、拖拽、pan/zoom/fit、node/edge detail、键盘与 accessible table。
- Operations：10k nodes/9999 edges 的真实 Neo4j benchmark、Web/Worker Docker build、索引器 `/live`、
  feature-off rollback，且 Web/PostgreSQL 不依赖 Neo4j 健康。

### 7. Wrong vs Correct

#### Wrong

```ts
const graph = await neo4j.run("MATCH (n) RETURN n ORDER BY n.indexed_at DESC");
return graph.records.map(record => record.get("n").properties);
```

#### Correct

```ts
const initial = await postgres.readExactSnapshot(authority, request.release);
const checkpoint = await postgres.readCheckpoint(authority, initial.release_identity);
const keys = await neo4j.search({ scope, checkpoint, request });
const current = await postgres.readExactSnapshot(authority, request.release);
return exactSameAuthority(initial, current, checkpoint, keys)
  ? hydrateFromPostgres(current, keys)
  : boundedPostgresFallback(current, request, "AUTHORITY_CHANGED");
```
