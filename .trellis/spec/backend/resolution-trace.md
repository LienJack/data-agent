# Resolution Trace 与 SQL History

> U9 的 Run 公开轨迹、SQL 证据索引、workspace read API 与前端消费合同。

## 1. Scope / Trigger

- 修改 Run Event 历史读取、Task Console/Trajectory、SQL History、Artifact lineage、Conversation deep link
  或 workspace trace route 时适用。
- PostgreSQL `run_events`、`artifacts`、`workspace_run_bindings` 与 `effective_run_config_receipts` 是事实源；
  Trace/SQL History 是同事务生成的只读投影，不新增可写 Trace Authority。
- 本单元不运行 Falcon、不调用真实 Provider/MCP，也不写 Run、Artifact 或 Effect 状态。

## 2. Signatures

```ts
buildResolutionTrace(input): Promise<ResolutionTrace>;
verifyResolutionTrace(input): Promise<ResolutionTrace>;
buildSqlHistoryEntry(input): Promise<SqlHistoryEntry>;
verifySqlHistoryResult(input): Promise<SqlHistoryResult>;
createPostgresResolutionTraceProjector({ pool, authorizer });
```

```text
GET /api/workspaces/{workspaceId}/runs/{runId}/resolution-trace
GET /api/workspaces/{workspaceId}/runs/{runId}/resolution-trace/details?node_id=
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
- `resolution-trace-detail@1.0.0` 是按 `run_id + node_id` 懒加载的严格公共投影。服务端必须先在同一
  Trace 快照中解析 node，再以 `source_event_id + sequence + exact ArtifactReference` 关闭身份；不得让请求方
  仅凭 call/artifact/config ID 读取对象。Tool detail 按 exact `call_id + profile_id + task_id + tool_name`
  合并 START/terminal，仅公开经过 `PublicRunEvent` 脱敏的 input/output/error/duration。
- Detail 的 Payload/Result/Schema 使用 `AVAILABLE/UNAVAILABLE/FORBIDDEN/UNSUPPORTED/STALE` 判别状态；
  缺少公共内容时返回稳定 reason code。Artifact 正文不进入 detail DTO，Web 必须继续通过 exact-reference
  Artifact Preview API 鉴权、验 source identity 并有界读取。
- Effective Config detail 只能消费本 Run 的 immutable `effective_config_json + config_hash`，展示冻结
  Provider/model/datasource/release/snapshot/policy/resource binding；禁止回查当前 Resource Catalog 覆盖历史。
- SQL History 固定 SqlArtifact、ExecutionReceipt、QueryEvidence、SandboxResult、Schema Snapshot 引用/哈希，
  compiler/AST/statement/parameter/query hash、status/time 与 `entry_hash`；statement/parameter 只公开 SHA-256。
- SQL 条目必须有权威 Conversation binding。`conversation_href` 必须逐字等于
  `/w/{tenant_id}/qa?conversation={conversation_id}&run={run_id}&tab=conversation`；不得生成 latest/none fallback。
- Client 对 route 响应再次执行 strict parse + hash verify。QA 入口消费 conversation/run 查询参数，轨迹与 SQL
  Tab 只格式化 DTO；移动端宽表只在表容器内横向滚动，页面本身不得溢出。
- Web Workbench 的四泳道、统计、时间/sequence domain、搜索与 edge hierarchy 由无 React/DOM 的纯模型从
  同一 `ResolutionTrace` 构建。时间轴、列表和 Inspector 只共享一个 `selectedNodeId`；10,000 节点列表必须
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
  statement/parameter hash、Run/Conversation filter 与 principal predicate。
- Web：route 注入授权 scope、not-found-or-denied、client hash verify、Trace/SQL/Artifact/empty/error 状态、键盘 Tab、
  1440px 与 390px 截图、长摘要和页面横向溢出检查。
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
