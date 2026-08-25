# Agent Team Product Runtime

> 当前约定（2026-08-25）：Q&A 只接受 `effective-config-team-lease@3.0.0` / `ROOT_HARNESS@1`。Root Agent 是唯一自然语言意图路由器；旧 Direct-QA、正则 Router、固定 `query_kind` 与 legacy lease 执行入口均已删除或拒绝，不存在兼容旁路。

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
Root turn (AUTO)
  -> strict FINAL_ANSWER
  -> or delegate_to_subagent@1 native tool call(s)
     -> admission against frozen Catalog and current exact V2 Profile
     -> Semantic | Governed Text2SQL | Report
```

## 3. Root Authority

- Run acceptance freezes the exact Subagent Capability Catalog in the V3 lease。
- Root uses the catalog's semantic `description/when_to_use/when_not_to_use/examples` and is the only component allowed to choose a Profile。
- Root direct answers are limited to `GENERAL_TEXT` based on general knowledge or visible user messages. Workspace facts, semantic definitions/relationships, aggregates, rankings, trends, rows and charts require delegation or accepted Artifact evidence。
- Root uses server-owned `toolChoice=AUTO`. When an initial direct answer is returned, the same Root performs one bounded `DIRECT_ANSWER_REVIEW`; it may retain a genuinely general answer or replace it with a native Subagent call. This is Root self-review, not a Host classifier。
- Provider output is normalized through the strict Root Harness. Mixed text/tool output, unknown tools, unknown Profiles and catalog hash mismatch fail closed。
- `ROOT_HARNESS@1` is the only Q&A executor. V1/V2/`LEGACY_FIXED@1` leases return `ROOT_AGENT_LEASE_VERSION_UNSUPPORTED` and never fall back。

## 4. Frozen V2 Product Profiles

| Profile | Use | Direct tools | Accepted output |
| --- | --- | --- | --- |
| `semantic-management-agent` | frozen definitions, relationships, lineage, dependencies and governance semantics | `semantic.catalog.read` | `AnalysisReport` |
| `governed-text2sql-agent` | rows, values, aggregates, comparisons, rankings and trends | `semantic.release.read`, `sql.compiler.compile`, `sql.sandbox.execute` | `QueryEvidence` |
| `report-writing-agent` | formal narrative from accepted evidence | `evidence.read`, `report.project` | `AnalysisReport` |

- Every revision binds runtime Profile, sorted direct tool allowlist, Skill refs, Context Policy, Execution Safety Policy, expected Artifact types and Verifier hash。
- Discovery and admission are V2 only. Unknown/revoked/stale revisions fail closed; no V1 projection or compatibility facade exists。
- Only Root-selected Profiles create child tasks, handoffs, capabilities and public Agent events。

## 5. Governed Text2SQL

### 5.1 Frozen input

The Text2SQL context contains only:

- exact datasource id/revision/hash;
- exact physical schema snapshot id/hash and safe relation/column/type/PK/FK/comment projection;
- exact Semantic Context Package and frozen release references;
- Root objective and bounded execution limits。

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
- Invalid candidates are not committed. `SqlArtifact` is committed only after the final compiled candidate executes successfully, then `QueryEvidence` references it。

### 5.3 Execution boundary

- Relation names must be schema-qualified and belong to the exact snapshot allowlist。
- Only one read-only `SELECT` or non-recursive read-only CTE is accepted; DDL/DML/COPY/CALL/locks/subqueries/set operations/dangerous functions/system catalogs are rejected。
- Target binding revalidates datasource status/revision/hash, active SecretRef/version, reader role and target capability hash before I/O。
- PostgreSQL execution uses `BEGIN READ ONLY`, fixed role, `search_path=pg_catalog`, statement/lock timeouts, `EXPLAIN`, row/byte limits and rollback。
- SQLSTATE is projected only into safe bounded classes such as `DATASOURCE_ADAPTER_SQL_TYPE_ERROR`; raw provider/database detail is never released。

## 6. Semantic and Report

- Semantic consumption verifies the exact historical release and current publication projection hashes. It reads executable metrics/dimensions/formulas, relationships, time semantics and quality constraints from the frozen release contract; no legacy Explorer projection is accepted。
- The semantic Artifact keeps retrieval/fusion/pruning, graph expansion, inference closure, lineage and release identity for audit; the public answer renders only its conclusion。
- Report can run only after accepted `QueryEvidence` is available and must bind source refs exactly。

## 7. Tables and Charts

- QueryEvidence always remains the authoritative table result。
- A chart is a separately committed `ArtifactWorkspaceDocument` derived deterministically from accepted QueryEvidence and bound to the same Semantic Context receipt。
- Explicit LINE/BAR/PIE intent is honored. When the candidate declares TABLE/NONE but typed output has one category/time column and numeric columns, Host derives BAR/LINE by result shape; it does not inspect question keywords。
- Chart title/description come from the validated candidate. Chart rows, dataset hash and source refs come only from committed evidence。

## 8. Failure and Recovery

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
| Artifact/Task replay correlation mismatch | `TEAM_ACCEPTED_REPLAY_CORRELATION_INVALID` |

- Team task/handoff/completion/verifier/acceptance remain durable and idempotent。
- Recovery reuses the frozen Catalog, Semantic Context, schema snapshot and selected Profile; it never reroutes through a new catalog or republishes an existing accepted Artifact。

## 9. Required Tests

- Root Harness: direct answer, native single/multi delegation, mixed response rejection, AUTO tool choice and direct-answer review。
- V2 Profile materialization/admission: exact revision/hash/tool/Skill closure; V1 and stale revision rejection。
- Semantic: exact release projection/hash verification, retrieval/graph/inference audit and no SQL execution。
- Text2SQL: strict candidate schema, literal parameterization, relation/function/AST rejection, exact binding, EXPLAIN/read-only transaction, SQLSTATE classes, bounded repair and result-shape closure。
- Artifact: `SqlArtifact -> QueryEvidence -> Chart/Report` source refs, hashes and accepted-state ordering。
- Real Falcon db24: DeepSeek Root selects Text2SQL for a business aggregate and the browser shows both QueryEvidence table and same-source chart; relationship question selects Semantic only; general knowledge remains direct。

## 10. Forbidden Patterns

- regex/keyword/switch natural-language Router;
- fixed `query_kind`, SQL templates or business-question registry;
- Direct-QA fallback, shadow dual route, feature-flag compatibility path or V1/V2 projection;
- model access to datasource credentials/target or direct model-side database I/O;
- committing an invalid/unexecuted SqlArtifact or constructing public values from model prose;
- chart/report without accepted source evidence。
