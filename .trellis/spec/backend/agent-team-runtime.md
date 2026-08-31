# Agent Team Product Runtime

> 当前约定（2026-08-27，E1）：Q&A 只生产 `effective-config-team-lease@3.0.0` / `ROOT_HARNESS@1`。Root Agent 是唯一自然语言意图路由器；旧 Direct-QA、adaptive-dispatch RPC/reader、正则 Router、固定 `query_kind` 与 legacy lease 执行入口均已删除或拒绝，不存在兼容旁路。合同层可保留 legacy lease parser 以给出稳定拒绝，但不得据此执行。

## 1. Scope / Trigger

- 修改 Root、Agent Card、Subagent admission、Team task/handoff、Specialist Tool、Text2SQL、Semantic、Report、公开 Trace 或 Artifact 链时适用。
- PostgreSQL 是 Profile、Team、Event、Artifact、Context 与 Receipt 权威；Mastra 只负责模型/工具适配。
- Host 不做自然语言关键词分类。Host 只做冻结目录校验、权限、预算、SQL AST、Datasource binding、证据与恢复闭包。

## 2. Current Signatures

```ts
createDataAgentTeamRunner({ root, root_runtime });
createRootAgentTurnExecutor();
createRootAgentDelegationRuntime({ profiles, runtime, artifacts });
createProductionTeamRuntime({ store, artifacts, create_tools });
createMastraProfileComposition({ profiles, tools, visibility, execution_tool_allowlists });
createPostgresqlText2SqlQueryRuntime({ pool, schema_snapshots, datasources, secrets });
```

```text
Root turn 0..3 (AUTO)
  -> strict FINAL_ANSWER -> Host verifier -> terminal or verifier feedback
  -> or delegate_to_subagent@2 current native tool call(s)
     -> admission against frozen Catalog, accepted input Artifacts and current exact V2 Profile
     -> accepted Artifact + safe Tool Result
     -> next Root turn decides the next action
```

## 3. Root Authority

- Run acceptance freezes the exact Subagent Capability Catalog in the V3 lease。
- Root uses the catalog's semantic `description/when_to_use/when_not_to_use/examples` and is the only component allowed to choose a Profile。
- Root direct answers are limited to `GENERAL_TEXT` based on general knowledge or visible user messages. Workspace facts, semantic definitions/relationships, aggregates, rankings, trends, rows and charts require delegation or accepted Artifact evidence。
- Root uses server-owned `toolChoice=AUTO` for at most four normal turns. Each turn decides only the current next action or final answer; there is no dedicated review stage or predeclared future call chain。
- AUTO 且有可选工具时不启用 Mastra `structuredOutput`；若实际没有 native Tool Call，必须严格解析完整 `fullOutput.text`
  为 JSON，再用同一注册 Response Schema 验证/规范化。不得读取未生成的 `fullOutput.object`、剥除 Markdown/prose，
  或通过伪 Tool Call 包装最终答案。REQUIRED/无可用工具的 structured-output 路径不变。
- Root system message 从实际 `rootAgentFinalAnswerOutputSchema` 派生完整 JSON Schema，不能只给 `sections:[...]` 占位形状。
  Schema 进入原 message projection/hash/token preflight；不另设模型输出或答案权威。
- 最后一次正常模型决策可以委派产出最终证据。其已验收 `FINAL_ANSWER_EVIDENCE` 在四次决策预算之外仍须通过既有
  Host answer verifier 进行纯确定性收敛；这不是第五次 Root/model/tool 决策，不增加任何模型或工具调用预算。
  先保存 `turn_index=4, terminal=false` 的最终证据 checkpoint，再验收并保存终态。中断恢复只重复幂等答案验收，
  不重跑委派/SQL/Sandbox；无可最终收敛证据仍为预算耗尽，verifier 拒绝仍为失败，不能借此把 continuation 变为终态。
- Subagent terminal results return to Root as strict safe Tool Results. A later turn may pass an exact accepted output only through ordinary `input_artifact_refs`。
- 已创建的 child task 在 Tool、Context、执行或验收失败时，必须先发出绑定其 exact Profile/Task 的 `agent_status=FAILED`，再向 Root 传播稳定错误码；仅发 Root 委派失败会使公开 Trace 与 Q&A 中的 child 永久停在 RUNNING。不得用后续新 task 的成功覆盖原 task 失败。
- `output_usage` 同样约束 `AnalysisReport`：只有 `FINAL_ANSWER_EVIDENCE` 可触发 Host 自动完成及 Provider delegation 关闭；`CONTINUATION_INPUT` 必须保留下一次 Root 决策。不得仅凭 Artifact 类型提前结束，也不得由 Host 固定插入报告步骤；后续能力仍须满足冻结 Catalog 的输入契约与剩余预算。
- `SemanticQueryContext` 的自动完成必须同时满足 Root 的 `output_usage=FINAL_ANSWER_EVIDENCE` 与专职结果的
  `answer_scope=SEMANTIC_FACTS_ONLY`。后者仅描述此次专职任务的回答范围，不能覆盖 Root 对整个用户请求的继续执行约定。
  `CONTINUATION_INPUT` 即使包含完整定义且没有歧义，也必须原样返回下一次 Root 决策；失败后恢复同样适用，不得删除旧失败观察。
  必须交叉测试 Semantic/Report 的两种 usage，证明 continuation 会调用下一次 Root，而 semantic-only final 不额外调用模型。
- `output_usage` 只衡量当前请求的剩余工作，不能为用户未来可能查询数据预留 continuation。之前的 continuation 不强制下一轮
  再委派：Root 仍可自主输出引用 accepted Artifact 的 FINAL_ANSWER，原观察及 Host verifier 不变。不得用 `answer_scope`
  覆盖 continuation，或通过关键词/placeholder 过滤器代替 Root 决策。
- Specialist Provider logical call identity必须绑定 exact `run_id + accepted child task_id + stage + call_index`。同一 task的同一
  call replay仍拒绝重复；不同 Root turn创建的不同 child task即使选择相同 Profile/stage也不得碰撞。`call_index`只表示同一
  task内部的有界候选修复，不能替代 task identity。
- Multiple calls in one turn are allowed only when each call already has every required accepted input and can execute independently. Their parallel execution is a performance optimization, not a Host business planner。
- Host validates only the current calls: frozen Card/Profile, scope, budget, accepted inputs, datasource/schema/release binding, SQL/Sandbox safety, idempotency and recovery. Host never selects a subsequent business capability。
- Provider output is normalized through the strict Root Harness. Mixed text/tool output, unknown tools, unknown Profiles and catalog hash mismatch fail closed。
- `ROOT_HARNESS@1` is the only Q&A executor. V1/V2/`LEGACY_FIXED@1` leases return `ROOT_AGENT_LEASE_VERSION_UNSUPPORTED` and never fall back。
- Root v3 ProviderTask commit 必须消费 exact EffectiveConfig conversation receipt 与冻结的 `visible_message_refs`；历史 `START_L2_RESEARCH` lease 没有 refs 时只允许在 live Conversation version 仍等于 command version 的条件下保留无摘要 replay。两条分支共用同一个 RPC，不存在 legacy fallback writer 或第二套上下文权威。
- Conversation summary 的确定性 UUID helper 由 `data_agent_provider_invocation_rpc_owner` 在 Security Definer 边界调用；该 owner 只获得 `extensions` schema lookup，`data_agent_backend` 不获得同类直接权限。

## 4. Frozen V2 Product Profiles

| Profile | Use | Direct tools | Accepted output |
| --- | --- | --- | --- |
| `semantic-management-agent` | frozen definitions, relationships, lineage, dependencies and governance semantics | `semantic.catalog.read` | `SemanticQueryContext` |
| `governed-text2sql-agent` | rows, values, aggregates, comparisons, rankings and trends | `semantic.release.read`, `sql.compiler.compile`, `sql.sandbox.execute` | `QueryEvidence` |
| `report-writing-agent` | formal narrative from accepted evidence | `evidence.read`, `report.project` | `AnalysisReport` |

- Every revision binds runtime Profile, sorted direct tool allowlist, Skill refs, Context Policy, Execution Safety Policy, expected Artifact types and Verifier hash。
- Discovery and admission are V2 only. Unknown/revoked/stale revisions fail closed; no V1 projection or compatibility facade exists。
- Only Root-selected Profiles create child tasks, handoffs, capabilities and public Agent events。

### 4.1 Falcon24 E1 staging boundary

- U3 bootstrap may run the built-in Profile builder only as a deterministic, non-materialized closure proof. The proof must bind the fresh E1 model Profile/version/projection hash and report `materialized=false`; it is not Agent Profile authority and is not runnable。
- Final Falcon24 E1 Profile/Skill/Context/Safety materialization happens only after the dedicated Agent authority reset. Old Profile revisions, certification refs, model Profile identities, or a disposable U3 build proof cannot be admitted by the final Campaign。
- Missing SecretRef keeps the fresh model Profile in `DRAFT` and the E1 Epoch in `STAGED_HOLD`. A successful provider authentication may establish LLM configuration evidence, but cannot activate the Epoch while runtime isolation remains `HOLD`。

## 5. Governed Text2SQL

### 5.1 Frozen input

The Text2SQL context contains only:

- exact datasource id/revision/hash;
- exact physical schema snapshot id/hash and safe relation/column/type/PK/FK/comment projection;
- exact Semantic Context Package and frozen release references;
- optional accepted `SemanticQueryContext` from an earlier Root turn. When present, Host revalidates its exact current-Run Artifact identity, Context Package receipt, release id/generation/digest, datasource and schema snapshot before loading the exact semantic release; it then checks catalog membership and closure before schema/datasource lookup or target I/O. The compiler projection and SQL relation firewall are both narrowed to that verified closure;
- Root objective and bounded execution limits。

The optional context travels only through ordinary `input_artifact_refs`; it does not create a Host-scheduled Semantic-to-Text2SQL edge. Direct Text2SQL without this Artifact remains valid. `SqlArtifact` provenance records the exact optional Context reference/hash together with the resulting target binding hash。

Host/port/database/credential values, SecretRef payloads, raw rows and private prompts are never projected to the model or public trace。

### 5.2 Candidate and compiler

The only model output contract is `text2sql-query-candidate@1.0.0`:

```ts
{
  schema_version: "text2sql-query-candidate@1.0.0";
  sql: string;
  parameters: Array<string | number | boolean | null>;
  result_columns: Array<{
    name: string;
    semantic_type: "NUMBER" | "STRING" | "DATE" | "DATETIME" | "BOOLEAN";
    label: string;
  }>;
  presentation: {
    title: string;
    summary: string;
    visualization: "NONE" | "LINE" | "BAR" | "PIE" | "TABLE";
    x_key: string | null;
    y_keys: string[];
  };
}
```

- There is no `query_kind`, template id or fixed business SQL。
- The Host compiler turns model-authored non-zero literals into an append-only parameter vector, reparses the SQL and applies the strict PostgreSQL AST policy. It never invents relations, expressions or values。
- One bounded repair is allowed for schema/policy/type/column/result-shape failures. The model receives only the rejected candidate, frozen context and a safe diagnostic code。
- Every compile/execution rejection emits a current-Run `text2sql.candidate.rejected` progress event before repair or rethrow. It records the stage, bounded attempt number, allowlisted reason code, candidate hash and parameter/result types only; never SQL text, values or raw errors. A failed repair must not erase the first execution diagnostic, and these events do not authorize an Artifact or a successful answer。
- Invalid candidates are not committed. `SqlArtifact` is committed only after the final compiled candidate executes successfully, then `QueryEvidence` references it。

### 5.3 Execution boundary

- Relation names must be schema-qualified and belong to the exact snapshot allowlist。
- Only one read-only `SELECT` or non-recursive read-only CTE is accepted; DDL/DML/COPY/CALL/locks/subqueries/set operations/dangerous functions/system catalogs are rejected。
- Target binding revalidates datasource status/revision/hash, active SecretRef/version, reader role and target capability hash before I/O。
- PostgreSQL execution uses `BEGIN READ ONLY`, fixed role, `search_path=pg_catalog`, statement/lock timeouts, `EXPLAIN`, row/byte limits and rollback。
- SQLSTATE is projected only into safe bounded classes such as `DATASOURCE_ADAPTER_SQL_TYPE_ERROR`; raw provider/database detail is never released。

## 6. Semantic and Report

- Semantic consumption verifies the exact historical release and current publication projection hashes. It reads executable metrics/dimensions/formulas, relationships, time semantics and quality constraints from the frozen release contract; no legacy Explorer projection is accepted。
- The Semantic model returns only `semantic-query-selection-intent@1.0.0`: canonical exact metric/dimension/formula/relationship/time/quality IDs or typed ambiguity candidates. It cannot author definitions, formulas, joins, bindings, SQL or an answer。
- `unresolved_ambiguities[].candidate_ids` 允许 0 或至少 2 个规范排序、唯一、最多 32 个 ID，禁止单候选。
  0 仅表示当前冻结范围内，所需映射没有安全解析；不是全局定义不存在、无权限或数据库无记录的证据。
  已知 primitives 能被现有 request-scoped operator 无歧义闭合时仍必须正常闭合，不得借澄清跳过支持的请求。
  Host 保留 exact 已选对象与 mandatory inference closure，不编造地区/公式/候选，也不新增发布权威。
- Accepted context 有任何 unresolved entry 时，Root 引用其 exact Artifact 的
  `projection.context.unresolved_ambiguities` 并提出简洁澄清；不能重复同一 lookup 或忽略约束后发 SQL。
  Host 不自动完成 unresolved semantic facts；Text2SQL 的 `TEXT2SQL_SEMANTIC_CONTEXT_AMBIGUOUS`
  继续在 schema/datasource/Secret/connection I/O 前拒绝。Root Prompt 不替代该执行侧拒绝。
- 该兼容扩展保持旧合法 payload/hash 字节不变；新的零候选 payload 要求同一冻结构建中的 producer/consumer 同步更新。
  回归必须覆盖零候选 round-trip、单候选/重复/乱序/超界拒绝、hash tamper、精确 Artifact 引用及 SQL pre-I/O 拒绝；
  provider 错误码不能替代原始响应证据，不得把可复现的合同缺口宣称为某个历史 provider failure 的唯一已证根因。
- Host validates every selected ID against the frozen retrieval/inference closure, expands required formula/time/dimension-parent/relationship and physical-binding context, then commits `semantic-query-context@1.0.0` with exact Scope/Run, release/generation/digest, schema snapshot, datasource, retrieval/inference receipts and `context_hash`。
- `SemanticQueryContext` returns to Root as a structured safe Tool Result. Root may answer a semantic-only question from allowlisted exact fields, or a later Root turn may pass the accepted Artifact through ordinary `input_artifact_refs`; Host does not schedule that later call。
- Report r5 consumes only ordinary admitted **current-Run** `QueryEvidence` / `AnalysisReport` references; discovery and execution agree.
  The single-QueryEvidence context is unchanged. Multiple inputs use the exact delegation receipt, not an arbitrary first query or conversation prose.
  Before provider I/O, verify every input hash/identity/Scope/Run, retained section refs, existing 16-source/100-section bounds and task context-byte budget.
  Host appends original analysis sections/charts unchanged; the new summary cites all admitted inputs. Completion independently resolves the same inputs,
  requires the exact union of input refs and their accepted report sources, and rejects dropped/rewritten sections or uncommitted sources.
  Report cannot execute SQL, invent calculations, elevate historical evidence, or weaken Analysis's single-query contract. Product revision advances; old revisions are immutable.
- Analysis 最终说明须同时接收当前 node 引用指标的已发布 `metric_ref + unit`，不得只给统计摘要后让模型猜单位。
  通用 `currency` 不等于 CNY/INR/USD；缺具体币种须披露“沿用数据源币种，具体币种未指定”，`unit=null` 须披露单位未指定。
  中文回答或数据源名称不能授权换币种、缩放或补单位；显式已发布单位原样沿用。Prompt 回归只证明上下文边界，不代替真实答案验收。

## 7. Tables and Charts

- QueryEvidence always remains the authoritative table result。
- A chart is a separately committed `ArtifactWorkspaceDocument` derived deterministically from accepted QueryEvidence and bound to the same Semantic Context receipt。
- Explicit LINE/BAR/PIE intent is honored. When the candidate declares TABLE/NONE but typed output has one category/time column and numeric columns, Host derives BAR/LINE by result shape; it does not inspect question keywords。
- Chart title/description come from the validated candidate. Chart rows, dataset hash and source refs come only from committed evidence。

## 8. Failure and Recovery

Falcon 专用、显式 opt-in 的 credential certification 失败必须保留稳定错误码及已观察到的
conformance 失败项。公开项只取 `PROVIDER_CONFORMANCE_CHECKS` 的固定白名单，持久化到
同 Run `run.tool_failed.summary` 并进入 CLI HOLD 报告；不得输出 raw provider error/response、
凭据、任意字符串字段，也不得为获取诊断重放已终态认证。此规则不向普通问答新增认证门禁。

Analysis planner 的 `MODEL_STREAM_PROTOCOL_VIOLATION` 须在同 Run `tool_failed.output`
保留闭合的 `analysis-program-protocol-diagnostic@1.0.0`：仅 JSON/schema 分类与至多8个
校验代码/白名单结构路径（每路径至多12项），不暴露值、未知键名、原始错误或响应。
仅该 stage 临时捕获至多64KiB文本，越界清空；原 schema、失败码、retryable和调用预算不变。
Dispatcher producer 与 Run display consumer 双重严格验证，其他 stage/error 的 output 仍为 null。
诊断不是候选修复或 PASS；旧失败内容未捕获时不能倒推出根因，已终态 Run 不重放。
回归须覆盖真实 pinned bridge 的 invalid-output TEXT_DELTA、producer→display、分块/超限、
schema refinement、未知字段脱敏、伪造 details 拒绝和非目标 stage/error 不透传。

| Condition | Stable result |
| --- | --- |
| non-V3 or non-Root lease | `ROOT_AGENT_LEASE_VERSION_UNSUPPORTED` |
| untrusted Run context | `RUN_EXECUTION_CONTEXT_NOT_TRUSTED` |
| catalog/Profile/hash/tool mismatch | Root/admission stable rejection code |
| Semantic Context not READY/PARTIAL | `SEMANTIC_CONTEXT_NOT_RUNNABLE` |
| schema/datasource/SecretRef binding drift | `TEXT2SQL_*_STALE` / datasource binding code |
| unsafe SQL before I/O | `TEXT2SQL_SQL_SHAPE_REJECTED` / `TEXT2SQL_SQL_DANGEROUS` |
| PostgreSQL type/column/data failure | bounded `DATASOURCE_ADAPTER_SQL_*` code |
| repair budget exhausted | `TEAM_TEXT2SQL_CANDIDATE_*` or final adapter code |
| same task/same Specialist call replay | `PROVIDER_LOGICAL_CALL_DUPLICATE`；Provider I/O=0 |
| different accepted child task uses same Specialist stage | 独立 logical call；继续当前 Tool Call admission与Provider边界 |
| Artifact/Task replay correlation mismatch | `TEAM_ACCEPTED_REPLAY_CORRELATION_INVALID` |

- Team task/handoff/completion/verifier/acceptance remain durable and idempotent。
- Recovery reuses the frozen Catalog, Semantic Context, schema snapshot and selected Profile; it never reroutes through a new catalog or republishes an existing accepted Artifact。

## 9. Required Tests

- Root Harness: direct answer, native single delegation, cross-turn serial delegation, same-turn independent calls, safe Tool Result feedback, verifier feedback, mixed response rejection, four-turn exhaustion and durable replay；另覆盖同 task replay仍duplicate、跨 turn不同 child task的相同 Specialist stage不碰撞、repair index分域。
- Pinned Mastra bridge 离线集成同时覆盖 AUTO native Tool 与 AUTO 无工具文本；合法 JSON 完成、非法 JSON/未知字段/prose/fence/空文本拒绝。
  Prompt 的 JSON Schema 必须等于可执行 Schema。continuation 后 Root 自主 final 与继续执行两条路径都需回归，不能只 mock 最终成功。
- 四次串行委派后的 QueryEvidence/AnalysisReport 确定性收敛、continuation 仍耗尽、verifier 拒绝、最终证据 checkpoint 恢复及终态 replay；断言 Root 决策始终四次、恢复不重跑工具。
- V2 Profile materialization/admission: exact revision/hash/tool/Skill closure; V1 and stale revision rejection。
- Semantic: strict selection intent, exact release/projection/hash/resource binding, metric/formula/dependency, dimension/grain/parent, relationship/join/cardinality, time/restriction, ambiguity, semantic-only final and no SQL execution。
- Text2SQL: strict candidate schema, literal parameterization, relation/function/AST rejection, exact binding, EXPLAIN/read-only transaction, SQLSTATE classes, bounded repair and result-shape closure。
- Artifact: `SemanticQueryContext` exact Run/resource/hash binding plus `SqlArtifact -> QueryEvidence -> Chart/Report` source refs, hashes and accepted-state ordering。
- Real Falcon db24: DeepSeek Root selects Text2SQL for a business aggregate and the browser shows both QueryEvidence table and same-source chart; relationship question selects Semantic only; general knowledge remains direct。

## 10. Forbidden Patterns

- regex/keyword/switch natural-language Router;
- fixed `query_kind`, SQL templates or business-question registry;
- Direct-QA fallback, shadow dual route, feature-flag compatibility path or V1/V2 projection;
- model access to datasource credentials/target or direct model-side database I/O;
- committing an invalid/unexecuted SqlArtifact or constructing public values from model prose;
- chart/report without accepted source evidence。
