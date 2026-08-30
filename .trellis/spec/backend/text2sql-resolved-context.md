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

### Accepted-context binding diagnostics

- Keep the runtime failure class `TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE`, but distinguish result membership with
  `TEXT2SQL_SEMANTIC_RESULT_BINDING_OUT_OF_RANGE` from an unselected time dimension with
  `TEXT2SQL_SEMANTIC_TIME_BINDING_OUT_OF_RANGE`. Carry only the allowlisted code through rejection events, bounded repair and Root feedback.
- A selected Formula is not automatically a Metric; a time domain is not a Dimension. Do not invent identifiers or label a derived
  formula result as a different base metric to satisfy the existing wire contract. Missing output-binding expressiveness needs an explicit
  contract/acceptance fix, not a broader allowlist. A coverage domain alone does not request a time filter on an unbounded total.
- Never drop a requested temporal restriction to repair membership. Required missing context returns to Root for a fresh governed
  selection. Regressions must separately exercise bad output and bad time bindings before query I/O, preserve valid narrowed candidates,
  and prove raw SQL, values and errors remain absent from public diagnostics.
- Required regression: actual parameterization/deparse/policy round trip for a monthly self-join; rejection of missing CTE aliases,
  unqualified physical relations, out-of-scope schemas, ONLY, duplicate Host allowlists; stable Worker error propagation and targeted repair
  guidance. Existing forbidden SQL and schema bounds must remain rejected.

## Published time coverage at QueryEvidence acceptance

- A declared `HALF_OPEN` window must remain within every contributing temporal metric's non-null published `min_time` / `max_time`.
  The lower bound is inclusive; the upper bound is the exclusive frontier. Equality at either published boundary is allowed.
  Compare parsed instants, not lexicographic timestamp strings; published offset timestamps and UTC equivalents must agree.
- Reject an out-of-range candidate with `QUERY_EVIDENCE_TIME_WINDOW_OUT_OF_RANGE`; preserve the safe code through the existing bounded
  specialist repair turn and candidate rejection event. Repair SQL parameters and the declaration together, without deleting the window,
  shortening the request or altering authority. Invalid/reversed published bounds produce `QUERY_EVIDENCE_TIME_DOMAIN_INVALID` and are not
  a model-repairable error. Null bounds remain unbounded; they do not prove complete historical data.
- This check prevents accepting a falsely governed result after the existing read-only execution. It is not a pre-I/O ACL, a proof of all
  CTE/comparison-window coverage, or a proof that an omitted optional window is correct. Row-level unbounded requests remain supported.
- Required regressions: upper/lower overflow, exact boundaries, interior windows, offset-equivalent published bounds, null bounds,
  invalid/reversed authority bounds, safe rejection diagnostics and successful/failed bounded repair. Business acceptance must still
  independently verify the requested month buckets and values; Run success alone is insufficient.

## Parameterization must preserve grouped temporal expressions

- Repeated string literals in the same explicit `interval` cast context must share a generated parameter, just as matching
  `date_trunc` / `date_part` units do. Otherwise an originally identical SELECT/GROUP BY expression becomes `$n` versus `$m`, which
  PostgreSQL rejects with `42803` even when both bound values are equal.
- Keep original explicit parameter indices unchanged, and do not globally deduplicate untyped literals or merge different cast contexts.
  Different interval values remain distinct; all AST/relation/column/type/limit restrictions still run after rewriting.
- Regression proof includes real read-only PostgreSQL EXPLAIN before/after parameterization, both INTERVAL-literal and explicit CAST
  syntax, different values, and same text in a non-interval context. A model repair cannot reliably fix a rewrite that reintroduces the
  same structural mismatch; inspect database error statements before adding more model retries.

## Request-scoped relative period authority

### 1. Scope / Trigger

- `RECENT_COMPLETE_PERIODS` is a request-only semantic operator, not a Published term or a prearranged agent route. Semantic selects the
  exact metric/month dimension and requested integer month count (1–120); Host resolves the half-open window from that metric's published
  Gregorian month-aligned exclusive frontier. No wall clock, hard-coded Falcon dates or natural-language keyword dispatch is allowed.

### 2. Signatures

```ts
resolveSemanticRequestTimeWindow({ metrics, dimensions, request_scoped_interpretations })
// -> { dimension_id, start, end, semantics: "HALF_OPEN", timezone, period_unit: "MONTH", period_count } | null
// operator: { kind: "RECENT_COMPLETE_PERIODS", metric_id, time_dimension_id,
//             period_unit: "MONTH", period_count, anchor: "PUBLISHED_COMPLETE_FRONTIER" }
```

### 3. Contracts

- Require matching metric time-column/dimension/table, a known timezone and a usable frontier. Preserve the published boundary encoding
  and offset when subtracting calendar months. Missing/non-month-aligned frontier, ambiguous relative windows or insufficient coverage
  fail closed; never silently shorten the duration or change Semantic Release.
- Keep old context hashes readable: the new operator uses the existing optional request-scoped interpretations collection. New readers
  accept historical payloads unchanged; new operator payloads require the matching frozen deployed build. Input operations are independent
  declarations, so input order is not authoritative; duplicates remain rejected and Host sorts committed interpretations canonically.
- Text2SQL receives `semantic_context.resolved_time_window`, also frozen into its prepared context. Missing/changed current-window
  declarations or parameter values fail before datasource I/O with `TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH`, through the existing bounded
  repair path. This supplements, not replaces, AST admission, exact SQL predicate binding and published coverage checks.
- `PERIOD_COMPARISON_RATE.comparison_offset` governs bucket alignment separately from source filtering. For a one-year comparison,
  align `current_bucket = comparison_bucket + interval '1 year'` (parameterized), or shift the comparison projection once before the join.
  Do not join unshifted timestamps or apply the shift twice. LEFT JOIN alone proves neither alignment nor unavailable prior data.
  Provider guidance is not a new SQL proof: the independent business oracle must still validate covered prior values and rates.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No relative-period operator | `null`; historical request semantics unchanged |
| Multiple relative windows | `SEMANTIC_REQUEST_TIME_WINDOW_AMBIGUOUS` |
| Metric / table / time column / monthly dimension mismatch | `SEMANTIC_REQUEST_TIME_BINDING_INVALID` |
| Missing, invalid or non-month-aligned Gregorian frontier | `SEMANTIC_REQUEST_TIME_FRONTIER_UNAVAILABLE` |
| Invalid lower bound or requested start outside published coverage | `SEMANTIC_REQUEST_TIME_COVERAGE_UNAVAILABLE` |
| Candidate omits or changes resolved dimension / start / end | `TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH`, zero query I/O |

### 5. Good / Base / Bad Cases

- Good: Semantic extracts count, Host computes dates, Text2SQL copies the current window and independently restricts comparison coverage.
- Base: Old contexts without this optional operator retain their original payload and hash.
- Bad: Model subtracts months again, silently returns eleven months, or repairs a rejected query by deleting `time_window`.
- This proves compliance with the typed Semantic intent, not infallible interpretation of natural language or arbitrary SQL row semantics.
  Business gates independently verify the requested count, actual buckets, current/prior amounts, missing-period treatment and growth.
  Comparison periods outside published coverage remain unavailable; do not label partial physical rows as complete governed months.

### 6. Tests Required

- Contract: one/twelve months, leap year, preserved offsets, count bounds, missing frontier, insufficient coverage, duplicate and reversed
  independent operations, exact time-column binding, historical context verification without inserted defaults.
- Runtime: actual prepare/provider projection, omitted/wrong/shortened windows rejected before query I/O, exact window admitted, safe repair code.
- Business: twelve actual current buckets with independently checked amounts and unavailable prior periods kept NULL; no cross-Run evidence.
- Comparison regression: on a known covered month, unshifted joins reproduce a missing prior value while parameterized yearly alignment
  returns the independently known prior amount. Never mark an all-NULL prior column correct merely because current amounts match.

### 7. Wrong vs Correct

```ts
// Wrong: an in-range candidate alone does not prove the requested duration.
// accept(candidate.end <= published.max_time)
// Correct: compare the declaration against Host-resolved start/end/dimension before existing SQL validation.
const requestedWindow = resolveSemanticRequestTimeWindow(verifiedSemanticContext);
// validateCandidate({ ...prepared, requested_time_window: requestedWindow }, candidate)
```

## Published comparison source coverage before query I/O

### 1. Scope / Trigger

- A verified `PERIOD_COMPARISON_RATE` context requires source coverage checks. Derive them from its exact published metric time domain,
  selected time dimension, active same-datasource physical binding and frozen physical snapshot. No question keywords or Falcon dates.
- This supplements the declared current-window check: declaring valid dates does not prove every prior-period CTE filters its own source.

### 2. Signatures

```ts
// PreparedText2SqlContext -> PostgresqlText2SqlPolicyInput
published_time_coverage?: readonly {
  schema_name: string; relation_name: string; column_name: string;
  min_time: string | null; max_time: string | null;
}[];
```

### 3. Contracts

- Reject missing/ambiguous physical time bindings, absent physical columns and mismatched metric/dimension/domain before compilation.
  Multiple logical bindings to the same exact physical column deduplicate; distinct metric coverage constraints all remain applicable.
- At both candidate compilation and execution, inspect each physical scan in every SELECT. Its own WHERE must prove both non-null bounds
  with direct parameter comparisons joined by AND. Match the exact alias and time column; unqualified columns require a single range.
- The deliberately restricted proof accepts calendar-day dates or midnight-Z encodings and one safe temporal cast. Invalid dates, offsets,
  time-of-day boundaries and arbitrary arithmetic are not inferred. This is not a general timezone/SQL lineage theorem prover.
- OR/NOT branches, outer CTE filters and JOIN ON predicates do not establish the required source bounds. Another self-join alias's filter
  cannot prove coverage. An inclusive upper predicate is only safe strictly below the exclusive frontier.
- No comparison operator means historical query behavior is unchanged. Null published bounds impose no bound and prove no data availability.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing/ambiguous/mismatched semantic-to-physical coverage binding | `TEXT2SQL_SEMANTIC_TIME_COVERAGE_UNAVAILABLE` during prepare |
| Missing, unsupported or out-of-range SQL source predicates | `TEXT2SQL_SQL_TIME_COVERAGE_REQUIRED` before query I/O |
| Invalid, unsupported or reversed published bounds | `TEXT2SQL_SQL_TIME_COVERAGE_INVALID`; never execute |
| Direct clipped bounds for every required physical scan | Continue existing SQL and evidence validation |

### 5. Good / Base / Bad Cases

- Good: clip the prior source range to published coverage, retain current rows with LEFT JOIN and apply annual alignment exactly once.
- Base: unbounded ordinary row queries without a comparison interpretation retain their previous behavior.
- Bad: treat older/partial physical records outside the publication's coverage as complete prior periods; use an outer filter to hide an
  unbounded CTE. Never alter publication authority to make a rejected candidate pass.

### 6. Tests Required

- Direct/reversed bounds, exact frontier, narrower inclusive upper, wrong alias/column, OR/NOT, unfiltered self-join, outer-only filter,
  JOIN-only filter, null bounds, invalid calendar dates and unsupported offsets. Existing no-coverage SQL tests must still pass.
- Actual runtime prepare must derive coverage and reject missing binding/column. Compilation rejects overflow with zero query I/O.
- Allowlist only safe diagnostics through the existing bounded repair; do not expose raw SQL, parameters or database errors to Root.
- Read-only PostgreSQL proof and a fresh model canary independently verify all current buckets, covered prior amounts/rates and NULL gaps.

### 7. Wrong vs Correct

- Wrong: accept a valid `candidate.time_window` and assume every comparison source observes it.
- Correct: freeze source constraints from verified authority, prove each scan before I/O, then independently judge the returned business
  values. Passing this restricted SQL guard alone does not prove complete requested duration, year alignment or correct growth arithmetic.

## Host-resolved comparison windows and delegation conflicts

- For a paired `RECENT_COMPLETE_PERIODS` + `PERIOD_COMPARISON_RATE` on the same primary metric/time dimension,
  `resolveSemanticComparisonTimeWindows` shifts the resolved current complete-month window by the typed year offset, then intersects it
  with published coverage. Provider context receives `semantic_context.resolved_comparison_time_windows` with metric/dimension, requested
  prior bounds, effective `start/end`, half-open semantics, timezone, offset and `empty`.
- Use effective `start/end` as comparison source predicates. Requested prior bounds explain unavailable coverage, not permission to scan
  it. If no prior period is eligible, equal effective bounds describe an empty source; current output rows must still survive LEFT JOIN.
- Preserve calendar boundary encoding and explicit offset. Reject a partial-month published lower bound rather than presenting a partial
  comparison as complete. This current implementation requires one shared primary relative window; mismatched comparison bindings fail
  with `SEMANTIC_COMPARISON_TIME_BINDING_INVALID`. Unsupported coverage fails with `SEMANTIC_COMPARISON_TIME_COVERAGE_UNAVAILABLE`.
- With no paired relative/comparison intent, do not invent dates. Derivation is pure and does not add fields to historical SemanticQueryContext
  documents, alter context hashes or publish a term. Runtime behavior is bound to the frozen Worker build.
- Delegation objectives are intent descriptions, not authority. Dates proposed by Root cannot override Host-resolved current/prior windows.
  Do not subtract another year or shift the published frontier forward during repair. AST source coverage, exact current-window admission
  and business value/rate checks remain mandatory: publishing derived parameters to a model is not proof that the model used them.
- Required regressions: full/partial/absent prior coverage, all-unavailable empty source, leap year and preserved offsets, partial-month
  boundary rejection, missing paired intent, mismatched bindings, actual prepare/provider projection and unchanged historical context hashes.

## 独立 Published Formula 输出的物理证明

### 1. Scope / Trigger

当已发布、已选中的 Formula 没有对应 Metric 时，Candidate 必须使用 `object_kind=FORMULA` 与 exact node_id。
不得伪造同名 Metric、借基础 Metric 的身份/hash，或为完成一次查询修改 Semantic Release。

### 2. Signatures

- `resolvePostgresqlPublishedFormulaBindings`：编译前与 QueryEvidence acceptance 共用的纯校验入口，不生成或重写 SQL。
- `PreparedText2SqlContext.semantic_query_context_binding.formula_ids` 只来自验证后的 accepted Context；
  `binding_authority.formula_dependency_metric_ids` 同时限制编译与证据校验可使用的 Metric 依赖。
- Formula 列使用 `semantic_role=FORMULA`、NUMBER、`aggregate=null` 与非空 `formula_hash`。

### 3. Contracts

- 只接受 exact selected、ACTIVE 的 numeric/integer Formula。每个 SLOT 经已选 Metric 的 dependency_column_ids、
  active 同 datasource PhysicalBinding 与 exact SchemaSnapshot 解析；短名仅在物理来源唯一时成立。
  不从 Formula 名称猜物理列，不借未选 Metric 扩大依赖；不兼容跨 grain。
- 哈希域 `published-formula-physical-binding@1.0.0` 绑定 release hash、完整 Formula、实际使用的 Metric 与 slot/physical
  bindings；来源唯一且规范排序。QueryEvidence 原有 binding hash 继续封存该字段，旧 Metric/物理列算法和文档不变。
- 当前证明是有界数值子集：单个带 alias 的物理 FROM、直接外层输出；匹配 typed AST 的 SLOT/LITERAL、算术/比较、
  布尔、searched CASE、带单个输入的聚合、DISTINCT/FILTER。函数、操作数、参数值、零值/NULL 分支必须完全一致。
  CTE、join、表达式 cast、window、DATE_BUCKET/GROUP_COUNT、无依赖常量公式失败关闭，不做等价式推断。
- SQL 树相同仍可能发生整数截断：DIVIDE 至少一侧须被保守证明为非整数运算；COUNT/COUNT 与 SUM(integer)/SUM(integer)
  拒绝，AVG、SUM(bigint)、numeric/real/double precision 的合法组合可通过。不会自动添加 cast 修复业务 SQL。
- 原有 read-only AST、scope、snapshot、真实结果 OID、时间窗口、Artifact hash 校验继续执行。
  有请求窗口时，同时校验 Formula 所使用的真实 Metric 依赖；time-domain 本身不是时间 Dimension 或过滤请求。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 输出 Formula 不在 accepted Context | 原 membership 错误及 result-binding 精确诊断 |
| Formula/type/selection/grain 无效 | `QUERY_EVIDENCE_FORMULA_BINDING_INVALID` |
| SQL 算式、slot 或受支持结构未获证明 | `TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH` |
| active physical binding 缺失或快照漂移 | 原 physical-binding 失败码 |
| 合法且真实结果相符 | 原 QueryEvidence 成功路径；不产生新发布权威 |

### 5. Good / Base / Bad Cases

- Good：按正式 CASE 零值规则分别 SUM 收入/投入，再除法；Formula 与基础 Metric、渠道 Dimension 可在同表保留各自身份。
- Base：既有非 Formula 查询不增加此证明步骤，旧绑定仍原样回读。
- Bad：将 SUM 改 AVG、交换分子分母、用 NULLIF 改写已发布零值规则、给计算结果冒用收入 Metric，或通过整数除法截断。

### 6. Tests Required

合法/漂移表达式、参数、歧义/缺失/未选依赖、跨粒度、整数截断、hash 篡改与排序稳定性；编译零 query I/O、重复 evidence
校验、白名单诊断/repair 脱敏、Formula → Arrow → 真实 materialization receipt 的 role/hash 保留、旧路径回归。
离线测试不是业务验收；新 clean build、fresh scratch、单链路业务/QA/Trace 与 fresh 正式 attempt 仍必需。

### 7. Wrong vs Correct

Wrong：`formula.foo` 不被旧 enum 接受，就声明成 `metric.foo` 或 `metric.revenue`。
Correct：精确校验已有 Formula 与物理表达式，保留 Formula 身份；后续 Analysis 不因此获得一个新的 Published Metric。

## 未声明时间选择的反向校验

### 1. Scope / Trigger

`time_window=null` 表示 SQL 没有时间选择条件，不只是模型没有填写窗口字段。修改 Candidate compile、只读执行或
QueryEvidence acceptance 时，必须同时检查“声明与 SQL 相符”和“SQL 有时间选择却未声明”两个方向。

### 2. Signatures

- `assertPostgresqlQueryTemporalSelection`：Worker compile/adapter validate_statement 与 Platform evidence acceptance 共用。
- `assertPostgresqlTemporalSelectionDeclared`：纯 PostgreSQL AST/CTE 依赖分析；只拒绝遗漏，不生成 SQL 或证明已声明的窗口。

### 3. Contracts

- 时间来源包括 exact snapshot 的 date/timestamp/timestamptz 列、selected 时间 Dimension，以及 selected Metric 的
  time_column_id。文本日期列从该 Metric 的 active physical dependency 绑定定位到 exact relation 后验证 snapshot；
  不要求另有时间 Dimension 才能拒绝遗漏，也不会因此授权一个未选 Dimension。显式时间 cast/date_part/date_trunc 同样追踪。
- 无窗口时，WHERE/HAVING/JOIN ON、聚合 FILTER、CASE 条件引用上述时间来源即拒绝。CTE 输出逐级传递时间依赖，
  不因改 alias、转换为日期桶/布尔标志或把条件移动到外层就消失。各 SELECT 使用自己的 relation/CTE scope。
- 当前为保守有界合同：日期非空判断、时间列相等 JOIN 和时间 CASE 条件也属于时间选择，不能当作无窗口的普通过滤。
  不做谓词等价推断；unsupported/recursive CTE、歧义 alias 等失败关闭，原全量 SQL policy 仍先执行。
- 日期投影、分组及普通 latest-row 排序可保持 null；非时间 WHERE/FILTER/CASE 不受影响。
- 有声明时继续使用原请求窗口、Dimension membership、覆盖范围、参数与半开区间证明；本守卫的返回不构成这些证明。
  不修改历史 Candidate/QueryEvidence schema、hash 或已接纳记录。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| SQL 时间选择但 time_window=null | compile/evidence 拒绝，`TEXT2SQL_SQL_TIME_WINDOW_REQUIRED` |
| 直接调用 adapter 执行同一候选 | 既有脱敏 `DATASOURCE_ADAPTER_SQL_REJECTED`，零 explain/query I/O |
| 原请求明确有时间限制 | 不得删限制；取得缺失 governed Dimension/context 后重新编译 |
| 原请求是无界总量，但候选自行加覆盖期筛选 | 同时移除未请求的 SQL 时间条件与声明；不得只删声明 |
| 发布 coverage 域存在 | 只代表覆盖元数据，本身不授权给无界总量默认加时间筛选 |

### 5. Good / Base / Bad Cases

Good：全渠道总量保留原发布 Formula、聚合全量；最新十条仅按日期排序。
Base：明确请求窗口仍走原 exact bounds 校验。
Bad：COMPILE 提示时间 Dimension 越界后只将 time_window 改成 null，留下原 WHERE。

### 6. Tests Required

原始/文本时间列、无独立时间绑定、CTE 改名与多级时间桶/布尔派生、所有条件位置、schema/alias 隔离、无界 Formula、
日期展示/排序非误报、compile/execute 零 I/O、acceptance 重验、诊断白名单与 bounded repair。业务必须另用冻结 source oracle
核对全部请求数据；Run SUCCEEDED 或 Formula 身份合法都不能替代业务 PASS。

### 7. Wrong vs Correct

Wrong：`if (!candidate.time_window) return null` 直接跳过 SQL 时间语义。
Correct：先证明不存在未声明的时间选择，再允许签发 null-window evidence；已声明窗口仍须完整正向证明。
