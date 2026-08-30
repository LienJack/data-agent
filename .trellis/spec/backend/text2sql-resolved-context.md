# Resolved Context Text2SQL Authority

> U13 将 U12 Context Package、Published Mapping、Compiler、关系投影与 SQL Sandbox 串成不可旁路的只读执行链。

## Scenario: 从 Resolved Context 编译并执行 PostgreSQL SQL

### 1. Scope / Trigger

- 修改 Resolved Context 到 Grounding/Compiler 的绑定、`SqlArtifact`、Sandbox SQL request、PostgreSQL AST policy 或 `10664` 时适用。
- 历史 Grounding/SqlArtifact 可继续读取；新 U13 执行路径必须启用 `require_resolved_context_binding`。
- Neo4j 仍是可删除投影，PostgreSQL Published Release/Projection、RUN Context Receipt 与 Sandbox Authority 是执行真值。

### 2. Signatures

```ts
buildResolvedContextText2SqlBinding({ package, snapshot })
verifyResolvedContextText2SqlBinding(binding, { package, snapshot })
compilePostgresqlLogicalPlan({
  logical_plan_binding,
  grounding,
  resolved_context_binding,
})
createPostgresText2SqlSandboxAuthority({
  require_resolved_context_binding: true,
  ...
})
```

```sql
app_data_agent.verify_resolved_context_text2sql_binding(
  requested jsonb,
  requested_run_id uuid
) returns boolean
```

### 3. Contracts

- `resolved-context-text2sql-binding@1.0.0` 严格包含 scope、package ref、snapshot hash、Published Release、Schema Snapshot、query route、selected Metric/Ontology、canonical mapping refs、全部 semantic projection hashes、mapping closure hash 与 binding hash。
- Binding builder 只接受已验证的 U12 `READY/PARTIAL` Package；route 只能是 `METRIC/ONTOLOGY_TEXT2SQL`。Knowledge/Graph、无 Mapping 或非 Queryable Ontology 不可获得查询 binding。
- Builder/verifier 返回 WeakSet 品牌对象。Compiler 拒绝普通 schema-valid JSON，并把 binding hash 同时写入 Compiler Proof 和 `SqlArtifact.resolved_context_binding_hash`。
- Sandbox request 的 binding 必须与 request scope/datasource 相同；SqlArtifact hash 必须与 request binding hash 相同。
- PostgreSQL verifier 要求同 Scope/Run 已提交 `READY/PARTIAL` RUN Receipt，锁 active pointer 后锁 exact Published Release，重算三类 projection hash、Metric/Ontology Mapping closure 和 binding self-hash。
- Sandbox 在 durable claim 前调用 10664 verifier；拒绝后不允许 claim、grant、datasource callback 或 fallback SQL。
- Graph 加速继续使用 10625 checkpoint/build/manifest generation；缺失、过期、digest mismatch 或 pointer race 显式返回 PostgreSQL fallback reason。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 普通 JSON 冒充 Compiler binding | `POSTGRESQL_COMPILER_RESOLVED_CONTEXT_AUTHORITY_REQUIRED` |
| U12 Package/Snapshot scope、release 或 snapshot hash 换绑 | `RESOLVED_CONTEXT_TEXT2SQL_AUTHORITY_MISMATCH` |
| Knowledge/Graph route | `RESOLVED_CONTEXT_ROUTE_NOT_QUERYABLE` |
| Metric 缺 Mapping | `RESOLVED_CONTEXT_METRIC_MAPPING_NOT_QUERYABLE` |
| Ontology 非 Queryable/缺 Mapping | `RESOLVED_CONTEXT_ONTOLOGY_MAPPING_NOT_QUERYABLE` |
| Binding self-hash、projection 或 mapping closure 漂移 | 对应 `*_BINDING_INVALID/PROJECTION_STALE/MAPPING_CLOSURE_INVALID` |
| RUN Receipt 缺失或跨 Run | `RESOLVED_CONTEXT_TEXT2SQL_RUN_RECEIPT_REQUIRED` |
| SqlArtifact 与 request binding hash 不同 | `SANDBOX_AUTHORITY_REJECTED`，零 claim |
| Sandbox scope/datasource 与 binding 不同 | Schema Parse 失败，零数据库 I/O |
| DDL/DML、多语句、越权 relation/column 或危险函数 | 既有 `SANDBOX_*` Firewall reason，零 datasource I/O |
| Neo4j generation/digest/current pointer 漂移 | `POSTGRESQL_FALLBACK + exact reason` |

### 5. Good / Base / Bad Cases

- Good：DB-verified RUN Context → branded binding → validated LogicalPlan → deterministic Compiler → binding-bound SqlArtifact → 10664 currentness → AST Firewall → claim/grant/execution。
- Base：Neo4j 不可用时使用相同 PostgreSQL权限裁剪和有界遍历，Receipt 记录 fallback reason。
- Bad：把 binding 当可选 metadata、只比较 package hash、不锁 active pointer，或 Firewall 拒绝后让 RAG/LLM 再生成并执行第二条 SQL。

### 6. Tests Required

- Contracts：Metric/Ontology happy path、Knowledge/non-queryable/cross-snapshot/tamper、WeakSet brand。
- Text2SQL：未品牌 binding 拒绝；品牌 binding hash 同时进入 Proof/SqlArtifact；既有 AST/parameter/identifier suite 全绿。
- Platform：binding 缺失、callback 拒绝、默认 PostgreSQL 拒绝、RPC true 后 verifier-before-claim、cross-scope preflight。
- Graph：Neo4j success、disabled/not-ready/unavailable、digest mismatch、pointer race 和 PostgreSQL fallback。
- PostgreSQL 17：renderer/static、SECURITY DEFINER、窄 grant、direct table deny、VOLATILE + pointer/receipt `FOR SHARE`、真实 Backend invalid vector。

```bash
DATA_AGENT_POSTGRES_ASSERTION_FILTER=42-resolved-context-text2sql-assertions.sql \
  infra/supabase/test-support/run-postgres-smoke.sh
```

### 7. Wrong vs Correct

#### Wrong

```ts
await compilePostgresqlLogicalPlan({
  logical_plan_binding,
  grounding,
  resolved_context_binding: JSON.parse(agentOutput),
});
```

#### Correct

```ts
const contextBinding = await buildResolvedContextText2SqlBinding({ package, snapshot });
const compilation = await compilePostgresqlLogicalPlan({
  logical_plan_binding,
  grounding,
  resolved_context_binding: contextBinding,
});
const authority = createPostgresText2SqlSandboxAuthority({
  ...dependencies,
  require_resolved_context_binding: true,
});
```

## Model-authored relation rejection diagnostics

- Physical relations must remain exact schema-qualified members of the frozen allowlist. CTE references are local, unqualified names;
  both physical and CTE references require explicit aliases. No repair may broaden the allowlist or disable AST checks.
- Keep the public failure class `TEXT2SQL_SQL_SHAPE_REJECTED`, but carry the specific allowlisted diagnostic through the candidate
  rejection event, specialist repair context and Root Tool Result:

| Diagnostic suffix (`TEXT2SQL_SQL_`) | Meaning |
| --- | --- |
| `RELATION_SET_DUPLICATE` | Host allowlist has duplicate entries; not a model permission problem |
| `RELATION_SHAPE_REJECTED` | Unsupported RangeVar keys, ONLY or relation shape |
| `RELATION_ALIAS_REQUIRED` | Missing explicit physical/CTE relation alias |
| `RELATION_UNQUALIFIED` | Unqualified name is not a declared CTE |
| `RELATION_NOT_ALLOWED` | Schema-qualified relation is outside the frozen allowlist |

- Historical `RELATION_BINDING_REJECTED` remains readable. New diagnostics expose no SQL, identifiers, parameter values or raw provider
  payload. Candidate hashes alone cannot reconstruct rejected SQL; do not claim an exact historical SQL cause without preserved evidence.
- Required regression: actual parameterization/deparse/policy round trip for a monthly self-join; rejection of missing CTE aliases,
  unqualified physical relations, out-of-scope schemas, ONLY, duplicate Host allowlists; stable Worker error propagation and targeted repair
  guidance. Existing forbidden SQL and schema bounds must remain rejected.
