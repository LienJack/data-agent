# Resolved Context Authority

> U12 建立的 Context Request、Authority Snapshot、Package 与 Receipt 身份闭包，以及 Preview/Worker 共用解析约定。

## Scenario: 解析、预览和提交 Resolved Context

### 1. Scope / Trigger

- 修改 Context request/package/receipt、Published Lexicon route、容量策略、Worker Provider 前置门禁、Preview API 或 `10705` 时适用。
- PostgreSQL 是 Authority Snapshot 与 append-only Receipt 的持久权威；Contracts 负责 strict wire/hash，Semantic 只负责纯解析，Platform 只调用窄 RPC。
- U12 不调用 Provider、不创建 Run、不执行 Falcon。U17 才扩展澄清提交和“以此配置运行”等交互。

### 2. Signatures

```ts
buildResolvedContextRequest(input): Promise<ResolvedContextRequest>;
verifyResolvedContextRequest(input): Promise<ResolvedContextRequest>;
buildResolvedContextAuthoritySnapshot(input): Promise<ResolvedContextAuthoritySnapshot>;
resolveContextPackage(snapshot): Promise<ResolvedContextPackage>;
verifyResolvedContextCommitCommand(input): Promise<ResolvedContextCommitCommand>;
createResolvedContextService({ authority }).resolve(capability, request);
```

```sql
app_data_agent.load_resolved_context_authority_snapshot(requested jsonb) returns jsonb
app_data_agent.commit_resolved_context_package(requested jsonb) returns jsonb
app_data_agent.resolved_context_published_lexicon(app_id,tenant_id,environment,domain,release_id) returns jsonb
app_data_agent.resolved_context_package_key_hash(package_document jsonb) returns text
app_data_agent.resolved_context_uuid_v8_from_hash(requested_hash text) returns uuid
app_data_agent.assert_resolved_context_integrity() returns void
```

```text
POST /api/workspaces/{workspaceId}/context/preview
body = { question: string[1..4000] }
```

### 3. Contracts

- `resolved-context-request@1.0.0` 包含 `request_id + request_hash + scope + basis`。PREVIEW 额外包含 question/defaults ref；RUN 只包含 exact run/config/context-receipt ref。`request_hash` 是去掉自身后的 canonical SHA-256。
- `resolved-context-authority-snapshot@2.0.0` 归一 PREVIEW Defaults 与 RUN Effective Config/WORKER_START Receipt，冻结 question、Published Release、Schema Snapshot、Context/Egress Policy、Provider、Published Metric/Ontology/Relationship、Published Lexicon 和 governed Knowledge refs。
- Published Lexicon 只由 exact Release 的 canonical name、alias 与 Graph V2 `DENOTES/TERM_LINK` 生成；优先级为 canonical → preferred → alias/synonym → abbreviation，`RELATED` 不产生等价命中。同层多目标必须澄清。
- `resolved-context-route-decision@2.0.0` 携带精确 lexical evidence；澄清候选必须闭合 target、term、match kind、phrase 与 evidence hash。
- `resolved-context-package@2.0.0` 将最终 lexical evidence 纳入 capacity/evidence；request、receipt、commit、capacity 与 Text2SQL binding 结构未变，继续使用各自 `@1.0.0`。
- Package 身份分三层：`package_key_hash` 只哈希 authority identity；`package_id` 是该 key 前 128 bit 设置 UUIDv8/variant 位后的确定性 ID；`package_hash` 哈希包含 key/id 的完整 package draft。
- Receipt 必须同时绑定 `request_id + request_hash`、consumer/run、package id/hash、snapshot hash、state/route。Receipt hash 是去掉 `receipt_hash` 后的 canonical SHA-256。
- commit RPC 独立重载当前 Snapshot，并逐项比较 scope、domain、question/defaults、release/snapshot、policies、provider、knowledge refs、package key/ID/hash 与 Receipt 闭包；不能相信 TypeScript 已验证的字段。
- PREVIEW 和 RUN 不把 consumer/request identity 放入 Package；相同归一化 Authority 输入产生相同 package hash，但 Receipt hash 可以不同。
- Worker 必须先消费一次性、WeakSet 品牌化的 Resolved Context capability；只有 `READY/PARTIAL` 才能继续取得 Provider dispatch capability。
- Context Preview 组件只接收已解析 `ResolvedContextCommitResult`，支持 `IDLE/RESOLVING/RESOLVED/ERROR` 视图并展示五种服务端状态；不得在组件内重建 package 或创建 Run。

### 4. Validation & Error Matrix

| 条件 | 稳定结果 |
| --- | --- |
| Request 未知字段或 request hash 漂移 | `RESOLVED_CONTEXT_REQUEST_INVALID`，数据库/Provider 调用数为 0 |
| Scope 与 Capability 不同 | `RESOLVED_CONTEXT_SCOPE_MISMATCH` |
| Defaults、Release、Model 或 Snapshot 已漂移 | 对应 `RESOLVED_CONTEXT_*_STALE` |
| RUN config/context receipt、Attempt、Lease 或 Fence 换绑 | `RESOLVED_CONTEXT_WORKER_AUTHORITY_MISMATCH` 或数据库 stale error |
| Package key hash 或派生 UUIDv8 不一致 | `RESOLVED_CONTEXT_COMMIT_CLOSURE_INVALID` |
| Package authority 字段与重载 Snapshot 不同 | `RESOLVED_CONTEXT_COMMIT_CLOSURE_INVALID` |
| Receipt request/package/snapshot/state/route 换绑 | `RESOLVED_CONTEXT_COMMIT_CLOSURE_INVALID` |
| 同 request identity 同载荷重放 | `REPLAYED`，返回原 package/receipt |
| 同 request identity 异载荷 | `RESOLVED_CONTEXT_IDEMPOTENCY_CONFLICT` |
| Mandatory context 超过容量 | package=`REJECTED`；Worker Provider 调用数为 0 |
| 低优先 Evidence 超限 | package=`PARTIAL`，记录 `CROPPED/ON_DEMAND` 原因 |

### 5. Good / Base / Bad Cases

- Good：Preview 与 Worker 分别构建已哈希请求，PostgreSQL 归一到同一 Snapshot，Semantic 生成同一 Package，数据库重算 key/UUID/hash 后提交各自 Receipt。
- Base：Published Lexicon 未命中时按 Knowledge → Graph 固定顺序降级；命中可查询 Ontology 时进入 Text2SQL，并保留 typed reason code。
- Bad：调用方直接拼请求、把 `request_id` 当内容完整性、仅验证 `package_hash` 而不验证 `package_key_hash/package_id`，或在 Provider 调用后补 Context Receipt。

### 6. Tests Required

- Contracts：request/snapshot/package/receipt hash tamper、package key 与 UUIDv8、Preview/Run package parity、cross-consumer splice。
- Semantic：canonical/preferred/alias/synonym/abbreviation/ambiguity、中文与 ASCII 边界、固定 route priority、输入顺序稳定、UTF-8 byte capacity 与裁剪原因。
- Platform：SQL 参数、Scope、DB snapshot/result substitution、request hash 在 SQL 前失败关闭。
- Worker：exact config/context/Attempt/Fence，缺失/拒绝 Context 时 Provider 调用数为 0，一次性 capability 不可复用。
- Web：Preview Route 使用当前 Defaults、不创建 Run；组件覆盖 idle/resolving/ready/partial/clarification/rejected/stale/error，且无 raw context 字段。
- PostgreSQL 17：renderer/static、FORCE RLS、NOLOGIN owner、窄 grants、固定 request/package key/UUID 跨运行时向量与 integrity。可用：

```bash
DATA_AGENT_POSTGRES_ASSERTION_FILTER=41-resolved-context-authority-assertions.sql \
  infra/supabase/test-support/run-postgres-smoke.sh
```

### 7. Wrong vs Correct

#### Wrong

```ts
const request = { request_id, scope, question, basis } as ResolvedContextRequest;
await provider.invoke(prompt);
await contextAuthority.commit(request);
```

#### Correct

```ts
const request = await buildResolvedContextRequest({
  schema_version: "resolved-context-request@1.0.0",
  request_id,
  scope,
  question,
  basis,
});
const resolved = await contextService.resolve(capability, request);
if (!resolved.ok || !["READY", "PARTIAL"].includes(resolved.value.receipt.state)) {
  return resolved;
}
return providerCapability.invoke(input);
```
