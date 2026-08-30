# Resolution Trace 与 SQL History

> E1 当前合同（2026-08-27）：U9 提供 Run 公开轨迹、SQL 证据索引、workspace read API 与前端消费合同；U6
> 进一步要求从问答答案入口打开 exact Run 轨迹，并将节点详情、工件引用、390/1440 viewport 与同一 Web build 写入 E1 UI receipt。

## 1. Scope / Trigger

- 修改 Run Event 历史读取、Task Console/Trajectory、SQL History、Artifact lineage、Conversation deep link
  或 workspace trace route 时适用。
- PostgreSQL `run_events`、`artifacts`、`analysis_system_artifacts`、`text2sql_system_artifacts`、
  `workspace_run_bindings` 与 `effective_run_config_receipts` 是事实源；Trace/SQL History 是同事务生成的
  只读投影，不新增可写 Trace Authority。
- 本单元不运行 Falcon、不调用真实 Provider/MCP，也不写 Run、Artifact 或 Effect 状态。

## 2. Signatures

```ts
buildResolutionTrace(input): Promise<ResolutionTrace>;
verifyResolutionTrace(input): Promise<ResolutionTrace>;
buildResolutionTraceDetail(input): Promise<ResolutionTraceDetail>;
verifyResolutionTraceDetail(input): Promise<ResolutionTraceDetail>;
buildSqlHistoryEntry(input): Promise<SqlHistoryEntry>;
verifySqlHistoryResult(input): Promise<SqlHistoryResult>;
createPostgresResolutionTraceProjector({ pool, authorizer });
```

```text
GET /api/workspaces/{workspaceId}/runs/{runId}/resolution-trace
GET /api/workspaces/{workspaceId}/runs/{runId}/resolution-trace/details?node_id=&expected_trace_hash=
GET /api/workspaces/{workspaceId}/sql-history?run_id=&conversation_id=&occurred_after=&occurred_before=&limit=
```

## 3. Contracts

- `ResolutionTrace` 固定 App/Tenant/Environment、Run、可选 Conversation/Effective Config ref、规范排序的
  nodes/edges 与 `trace_hash`。Event node ID 必须来自 `event_id`，Artifact node ID 必须来自 exact
  artifact ID/revision；客户端不能生成成功状态或补节点。
- Event node 同时携带 `source_event_id + sequence`；二者必须同时存在或同时为空。sequence 在同一 Run
  唯一且从 1 连续，nodes 按 sequence/node ID 升序，edges 按 from/to/kind 升序；重复、乱序、悬空端点
  全部失败关闭。
- Platform 在一个 READ transaction 中重验 capability scope、Run principal、Event document/relational/hash、
  Artifact relational/document/content hash 与每个 input/source ref 的 scope/type/revision/hash 存在性。Artifact
  document 可以是 committed L2 envelope，或由 Production Team 提交的 strict/hash-verified
  `product-team-artifact@1.0.0`；两者都必须与 relational exact identity 一致，禁止因 schema variant 跳过校验。
- Trace 只保存 bounded summary、status、duration、时间和 typed refs。禁止 Prompt、私有推理、raw Context、
  raw SQL、参数值、Result rows、credential 与 Provider body。
- `resolution-trace-detail@3.0.0` 是按 `run_id + expected_trace_hash + node_id` 懒加载的唯一严格公共投影，
  并为所有节点携带 content-first `run_context`、父 `trace_hash` 与自身 `detail_hash`。服务端必须在同一个
  `REPEATABLE READ` transaction 中重建 Trace；若其 hash 与调用方绑定值不同，返回
  `RESOLUTION_TRACE_SNAPSHOT_STALE`，不得拼接另一快照的 Detail。随后才以
  `source_event_id + sequence + exact ArtifactReference` 关闭身份；不得让请求方仅凭
  call/artifact/config ID 读取对象。Tool detail 按 exact `call_id + profile_id + task_id + tool_name` 合并
  START/terminal，仅公开经过 `PublicRunEvent` 脱敏的 input/output/error/duration。Detail v2 不再接受。
- Detail 的 Payload/Result/Schema 使用 `AVAILABLE/UNAVAILABLE/FORBIDDEN/UNSUPPORTED/STALE` 判别状态；
  缺少公共内容时返回稳定 reason code。Artifact 正文不进入 detail DTO，Web 必须继续通过 exact-reference
  Artifact Preview API 鉴权、验 source identity 并有界读取。
- Effective Config detail 只能消费本 Run 的 immutable `effective_config_json + config_hash`，展示冻结
  Provider/model/datasource/release/snapshot/policy/resource binding；禁止回查当前 Resource Catalog 覆盖历史。
- SQL History 的历史 L2 v1 固定 SqlArtifact、ExecutionReceipt、QueryEvidence、SandboxResult、Schema Snapshot 引用/哈希，
  compiler/AST/statement/parameter/query hash、status/time 与 `entry_hash`；当前 Product Team 使用本文件末尾的 v2。
  statement/parameter 只公开 SHA-256。
- SQL 条目必须有权威 Conversation binding。`conversation_href` 必须逐字等于
  `/w/{tenant_id}/qa?conversation={conversation_id}&run={run_id}&tab=conversation`；不得生成 latest/none fallback。
- Client 对 route 响应再次执行 strict parse + hash verify。QA 入口消费 conversation/run 查询参数，轨迹与 SQL
  Tab 只格式化 DTO；移动端宽表只在表容器内横向滚动，页面本身不得溢出。
- Trace 与 Detail route 必须返回 `Cache-Control: private, no-store`。Web Detail cache key 固定为
  `run_id:trace_hash:node_id`；任何 scope/run/trace/build identity 变化或 authority 验签失败都必须清空旧 ready
  DOM、所选节点与缓存，禁止继续展示旧快照。
- Web Workbench 先逐 Run 验签 `ResolutionTrace`，再按 Conversation 中每个 Run 的最早公开事件时间形成稳定
  Turn 1..N，并由无 React/DOM 的纯模型合并四泳道、统计、时间/sequence domain、搜索与 edge hierarchy。
  UUID 或 replay 数组顺序不能决定 Turn 顺序。每条 record 必须保留真实 `run_id/turn_index`，Inspector 按所选 record
  的 exact `run_id + node_id` 读取详情。时间轴、列表和 Inspector 只共享一个 `selectedNodeId`；10,000 节点列表必须
  使用有界虚拟窗口，时间轴按泳道有界采样并优先保留选中、搜索命中和异常状态。SQL/Artifact/Tool 只要有
  exact ref 就直接进入内容预览，不能以裸 ID/hash 作为完成态。

## 4. Validation & Error Matrix

| 条件 | 稳定结果 |
| --- | --- |
| Event document/relational/hash 不一致 | `RUN_EVENT_STORE_EVENT_CORRUPT` |
| sequence 缺口或从非 1 开始 | `RESOLUTION_TRACE_EVENT_GAP` |
| Artifact L2/Product Team document、hash、type 或 scope 换绑 | `RESOLUTION_TRACE_ARTIFACT_CORRUPT` |
| Artifact input ref 不存在或 identity 漂移 | `RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING` |
| SQL 缺 Effective Config/Schema Snapshot | `RESOLUTION_TRACE_CONFIG_MISSING` |
| SQL 缺 Conversation binding | `RESOLUTION_TRACE_CONVERSATION_MISSING` |
| 时间窗口非 RFC 3339 或 after >= before | `SQL_HISTORY_LOOKUP_INVALID`，数据库调用数为 0 |
| capability scope 或 Run principal 不匹配 | not-found-or-denied，不允许枚举 |
| Trace/entry 内容或 hash 篡改 | `RESOLUTION_TRACE_HASH_MISMATCH` / `SQL_HISTORY_ENTRY_HASH_MISMATCH` |
| Detail 内容或 hash 篡改 | `RESOLUTION_TRACE_DETAIL_SCHEMA_INVALID` / `RESOLUTION_TRACE_DETAIL_HASH_MISMATCH` |
| Detail 请求绑定旧 Trace hash | `RESOLUTION_TRACE_SNAPSHOT_STALE`，不返回另一快照内容 |
| unknown/private DTO field | strict Zod 拒绝，UI 不渲染 |

## 5. Good / Base / Bad Cases

- Good：同一 Event/Artifact snapshot 在刷新、重连和历史加载中生成同一 Trace hash；SQL 记录可跳回原会话。
- Base：Run 已创建但没有 Event/Artifact 时返回空 Trace；没有 SqlArtifact 时 SQL History 返回空列表。
- Bad：客户端从 Zustand `RunProjection` 猜六个节点、按 artifact ID 查 latest revision、把 SQL/parameters/rows
  塞进公开 DTO，或用 `conversation=none` 伪造 deep link。

## 6. Tests Required

- Contracts：node/edge/entry canonical hash、排序、重复 sequence、端点闭包、scope/ref splice、unknown field、
  deep-link identity 与 forbidden-key scan。
- Platform：稳定 reload、Event gap/hash、L2 与 Product Team Artifact relational/document/content hash、input/source ref existence、SQL
  statement/parameter hash、Run/Conversation filter、principal predicate，以及旧 `expected_trace_hash` 的 snapshot-stale 负例。
- Web：route 注入授权 scope、not-found-or-denied、client hash verify、Trace/SQL/Artifact/empty/error 状态、键盘 Tab、
  1440px 与 390px 截图、长摘要和页面横向溢出检查；Falcon24 gate 还必须用真实浏览器逐节点打开 Detail、
  打开 SQL/QueryEvidence/DerivedAnalysisEvidence/Chart/AnalysisReport exact preview，并观察图表 READY、同源表格
  可见且无 `role=alert`。
- Full gates：Contracts unit/typecheck/build、Platform unit/typecheck/build、Web unit/typecheck/build、Biome 与
  forbidden scan。若共享分支存在非 U9 fixture 失败，必须用 focused test 证明隔离并明确记录。

## 7. Wrong vs Correct

### Wrong

```ts
const trace = buildTraceFromZustand(runProjection);
return { sql: artifact.payload.sql, rows: execution.result };
```

### Correct

```ts
const result = await projector.loadTrace(capability, { scope: capability.scope, run_id });
const trace = await verifyResolutionTrace((await response.json()).data);
```

只有同事务重验后的 Event/Artifact projection 与客户端再次验签的 DTO 可以标记为可审计轨迹。

## Scenario: Content-first Resolution Trace Detail v3

### 1. Scope / Trigger

- 任何新增 Run/Conversation/Config/Event/Artifact/Team Inspector 字段，或把 ID/hash 展示升级为可读内容时适用。
- 该场景跨 Contracts、PostgreSQL projection、Platform projector 与 Web Inspector，必须版本化并失败关闭。

### 2. Signatures

```ts
type ResolutionTraceDetailV3 = {
  schema_version: "resolution-trace-detail@3.0.0";
  trace_hash: ContentHash;
  detail_hash: ContentHash;
  run_context: ResolutionTraceDetailSection;
  payload: ResolutionTraceDetailSection;
  result: ResolutionTraceDetailSection;
  // identity/timing/schema/relations/artifact_refs unchanged and strict
};

type AgentTeamPublicTraceV2 = {
  schema_version: "agent-team-public-trace@2.0.0";
  tasks: TeamTaskPublicContent[];
  handoffs: TeamHandoffPublicContent[];
  epochs: TeamEpochPublicContent[];
  verifier_decisions: TeamVerifierPublicContent[];
  trace_hash: ContentHash;
};

load_agent_team_public_projection_v2(requested_run_id uuid) returns jsonb;
```

### 3. Contracts

- `run_context` 在同一 owner `REPEATABLE READ` transaction 中提供用户问题、权威 Run 状态/时间、attempt count、active attempt/fence、Conversation title/version/message count、Datasource binding、公开回答摘要和冻结模型。
- Detail 请求必须携带父 `expected_trace_hash`；服务端重建同快照 Trace 后才生成 Detail，并对除
  `detail_hash` 外的完整 material 计算 canonical hash。客户端必须同时验 `trace_hash/detail_hash`。
- 历史 Config/Resource 没有冻结 display name 时返回 exact identity 和 `HISTORICAL_DISPLAY_NAME_UNAVAILABLE`；禁止查询当前 Catalog 补名。
- Artifact 行内摘要只允许从已校验 committed document 的安全字段生成；正文仍按 exact `ArtifactReference` 进入 Preview API。
- Team v2 只能投影 hash-verified authority document 的 allowlist：goal/bounds/required outputs/output ref、handoff child bounds、obligation counts、verifier dimensions/semantic status、acceptance status/reason/time。
- Team v1 保持可解析；Platform owner projector 调用 v2 RPC。RPC 必须先调用 v1 relational/document/hash closure，不得复制一套较弱校验。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| Detail v2、未知字段或伪造 detail hash | strict reject |
| Artifact ref scope/run/revision/hash 不闭合 | `RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING` 或 corrupt，禁止内容 fallback |
| Config 只有 exact identity、无历史公共 receipt | `HISTORICAL_CONFIG_CONTENT_UNAVAILABLE` + `HISTORICAL_DISPLAY_NAME_UNAVAILABLE` |
| Team obligation open/unknown/resolved 之和不等于 total | contract reject |
| Team completion output type 不在 required types | contract reject |
| Team v2 RPC owner predicate失败 | `null`/not-found-or-denied，不暴露对象存在性 |
| private reasoning/prompt/provider payload/SecretRef 出现 | projection/strict contract reject |

### 5. Good / Base / Bad Cases

- Good：Artifact 节点行内显示报告标题/SQL/行列摘要，Inspector 首屏直接加载 exact preview，ID/hash 收进身份区。
- Good：Team verifier 显示七项 verdict 与 acceptance reason；hash 只作为来源证明。
- Base：历史资源没有冻结名称，显示 unavailable reason 与 exact revision/hash。
- Bad：按 Datasource/Profile ID 回查当前 Catalog，把今天的名称显示成历史 Run 名称。
- Bad：把 verified document 整体 `JSON.stringify` 给浏览器。

### 6. Tests Required

- Contracts：Detail v3 十类节点矩阵、父/自身 hash 篡改、unknown/private key、scope/run splice；Team v1/v2 hash、unknown/private key、scope/run、output type、obligation closure。
- Platform：Run/Conversation/attempt/datasource 内容；Tool exact group；Artifact content summary；Config no-current-Catalog fallback；Team v2 RPC strict parse。
- Migration：baseline 10696、checksum、security definer/search_path、public revoke/backend grant、v1 verification call、allowlist source assertions。
- Web：Run context 主信息、Team goal/bounds/output/verifier/acceptance、Artifact exact preview，DOM 无 private material。

### 7. Wrong vs Correct

```ts
// Wrong: current mutable lookup masquerades as historical content.
const displayName = await catalog.getLatest(config.datasource.resource_id);

// Correct: frozen content when present; explicit unavailable otherwise.
const displayName = frozen.datasource_display_name ?? {
  state: "UNAVAILABLE",
  reason_code: "HISTORICAL_DISPLAY_NAME_UNAVAILABLE",
};
```

## Scenario: Current Product Team SQL History

### 1. Scope / Trigger

- SQL History / Trace SQL 页签读取当前 `product-team-artifact@2.0.0` 时适用；不得只识别旧 L2 envelope 而返回空列表。
- 仍从同一 owner-scoped `REPEATABLE READ` 事务重验现有 Run / Artifact，不新增表、发布器或镜像权威。

### 2. Signatures

- `buildSqlHistoryEntry` / `verifySqlHistoryEntry` 接受严格 `sql-history-entry@1.0.0 | @2.0.0`。
- `sql-history-result@1.0.0.items` 为版本化条目集合；现有 GET route、鉴权、bounded limit 不变。

### 3. Contracts

- v1 文档及 hash material 保持不变。v2 绑定 SqlArtifact、可选 QueryEvidence、statement/parameter/candidate/target-binding/schema hash。
- 当前 Product Team 仅在执行成功后提交 SqlArtifact：无 QueryEvidence 为 `EXECUTED`，存在唯一 exact 来源证据为 `VALIDATED`。
- v2 的 compiler_version、ast_hash、query_hash、execution_receipt_ref、result_ref、schema_snapshot_ref 必须为 null；不能用 candidate hash 伪造旧编译器/执行回执。
- SQL provenance 的 snapshot hash 必须等于 Run 冻结 hash；QueryEvidence 的 snapshot identity、datasource revision/hash、context package 与 target binding 必须等于 SQL 来源。
- 所有 ref 仍绑定同 Scope/Run/revision/hash；两个指向同一 SQL 的 QueryEvidence 失败关闭，不选择 latest。SQL/参数/结果正文只通过 exact Artifact preview 展示。
- 页面明确展示 `Product Team Text2SQL` 与 `Candidate hash`，不把该 hash 标为 Query hash；旧 v1 继续显示真实 compiler/query hash。
- 结果按 occurred_at、entry_hash 严格倒序；同时间条目也必须稳定排序，重复 hash 拒绝。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| SQL snapshot 与冻结 Run 不同 | `RESOLUTION_TRACE_CONFIG_MISMATCH` |
| QueryEvidence 与 SQL 冻结绑定不同 | `RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISMATCH` |
| 多个 QueryEvidence 竞争同 SQL | `RESOLUTION_TRACE_ARTIFACT_AUTHORITY_AMBIGUOUS` |
| 文档/关系 hash 换绑 | `RESOLUTION_TRACE_ARTIFACT_CORRUPT` |
| v2 伪造 legacy fields 或 VALIDATED 缺证据 | strict contract reject |
| candidate/statement/parameter hash 被篡改 | `SQL_HISTORY_ENTRY_HASH_MISMATCH` |

### 5. Good / Base / Bad Cases

- Good：当前 SQL 直接关联 exact QueryEvidence，页面能切换两个内容预览。
- Base：只提交 SQL、未提交 QueryEvidence 时显示 EXECUTED，不假定业务验收通过。
- Bad：忽略所有无 envelope 的 SQL；构造不存在的 ExecutionReceipt；让当前 Catalog 覆盖历史 snapshot。

### 6. Tests Required

- Contracts：v1/v2 reload/hash、伪造 legacy fields、跨 Run ref、unknown/private field、同时间倒序。
- Platform：当前 SQL +/− QueryEvidence、冻结 snapshot 不同、证据 binding/hash/歧义负例、只读稳定 reload 与 owner predicate。
- Web：v2 来源和 candidate label、SQL/QueryEvidence preview、无虚构 ExecutionReceipt；保留 v1 与 route/Trace 回归。
- 真实 scratch 只读读取可作修复诊断，不得折算成新构建的正式业务或 UI PASS。

### 7. Wrong vs Correct

```ts
// Wrong: map a current candidate digest into a legacy compiler fact.
query_hash: product.provenance.candidate_hash;
// Correct: v2 preserves the provenance category and explicitly missing legacy facts.
candidate_hash: product.provenance.candidate_hash;
query_hash: null;
```

## Scenario: Current Profile cards in Team Trace

### 1. Scope / Trigger

- Team 页签读取当前 Profile cards 时，必须显式请求 V2；不能把 V1 registry 空集解释为“未启用 Agent”。

### 2. Signatures

- `GET /api/workspaces/{workspaceId}/agent-profiles?schema_version=agent-product-profile-list-result@2.0.0`
- 同一 API 使用既有 `listDiscoverable(capability)`，仅 READ；返回 `agent-product-profile-list-result@2.0.0`。

### 3. Contracts

- V2 仅列出当前可发现的已启用、已批准 Profiles，继续使用现有 Profile/Skill closure；不是管理列表或历史内容补齐器。
- 默认/V1 请求与原 POST 保持既有合同；当前 Trace client 固定请求和验证 V2，不回退 V1。未识别版本在任何 registry 调用前拒绝。
- Client 对每个 V2 Revision 严格解析及验 hash；Team card 只有 exact profile/revision/hash 匹配任务时可作为该任务内容。未匹配的历史任务继续明确 unavailable，不套用当前名称/Workflow。

### 4. Validation & Error Matrix

- 未识别 list version → `AGENT_PROFILE_INPUT_INVALID`；无 registry 调用。
- 当前 client 收到 V1 或 Revision hash 漂移 → reject；不渲染伪当前 Profile。

### 5. Good/Base/Bad Cases

- Good：当前 Trace 请求 V2，复用 Root discovery reader。
- Base：真正无可发现 Profile 时返回空 V2 列表。
- Bad：用 V1 空集判定未配置；创建另一套 Profile 表；读取时隐式迁移或批准 Profile。

### 6. Tests Required

- Route 验证 READ、V2 reader、无 commit、默认 V1 合同与未知版本拒绝；client 验证版本明确且不接受 V1。
- 原 Team card/Trace SSR、Web typecheck 保持通过；后续真实 UI canary 必须覆盖非空 V2 cards。

### 7. Wrong vs Correct

```text
Wrong: Trace -> default V1 list -> empty -> "not enabled"
Correct: Trace -> explicit V2 list -> existing listDiscoverable -> exact revision/hash cards
```
