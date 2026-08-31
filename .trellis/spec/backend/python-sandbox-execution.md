# OpenSandbox 状态化 Python 与治理结果回路

> 状态（2026-08-27，E1）：`IMPLEMENTED / ACCEPTANCE HOLD`。OpenSandbox 是唯一 Python 执行层；production Worker 已组合通用 governed-analysis runtime、PostgreSQL Context Journal、durable stage、带 fence 的原子权威提交与敏感输入 authority。Falcon case-bound runtime 已删除。G1–G5 的真实运行、独立 Oracle 和零残留证明仍属于 U7，不得从单元测试推导 GO。

## Scenario: 状态化 Python 编排治理算子并原子发布结果

### 1. Scope / Trigger

- Agent 在状态化 Python Context 中变换治理输入、编排唯一统计算子、生成结果/表格/图表符号时适用。
- PostgreSQL 是算子结果账本、Context Journal、publish stage 与最终 visibility 的唯一权威；OpenSandbox Context、临时文件和模型消息都是可丢弃投影。
- 保留 Agent/Operator 两个 OpenSandbox 角色，不引入 E2B、Daytona、Jupyter 或宿主 Python 兼容层。
- 模型可以写 Python 和引用受控符号，但不能接收治理算子完整 output、sealed/temp path、DSN、凭据或 provider payload。

### 2. Signatures

```ts
type AnalysisJournalEvent =
  | "MODEL_CELL_COMMITTED"
  | "OPERATOR_INTENT_COMMITTED"
  | "OPERATOR_RESULT_COMMITTED"
  | "SERVER_BINDING_COMMITTED"
  | "CONTEXT_FROZEN"
  | "PUBLISH_STAGE_CREATED"
  | "ORACLE_VERIFIED"
  | "EXPLANATION_BOUND"
  | "AUTHORITY_COMMITTED"
  | "CLEANUP_VERIFIED";

interface GovernedOperatorResultRef {
  schema_version: "governed-operator-result-ref@1.0.0";
  scope: AppScope;
  run_id: string;
  node_id: string;
  attempt_id: string;
  context_generation: number;
  call_id: string;
  operator_id: string;
  request_sha256: Sha256;
  result_artifact_ref: ArtifactReference;
  result_sha256: Sha256;
  shape: GovernedResultShapeSummary;
  receipt_ref: ArtifactReference;
  worker_fence: number;
}

bindGovernedResult(input: {
  governed_result: GovernedOperatorResultRef;
  binding_template_version: "governed-result-binding@1.0.0";
}): Promise<{
  binding_id: string;
  result_symbol: string;
  result_sha256: Sha256;
  journal_seq: number;
}>;

appendAnalysisContextJournal(command: ContextJournalAppendCommand): Promise<ContextJournalEntry>;
commitGovernedOperatorResult(command: GovernedOperatorResultCommit): Promise<GovernedOperatorResultRef>;
stageAnalysisResult(command: AnalysisResultStageCommand): Promise<AnalysisResultStage>;
commitAnalysisAuthority(command: AnalysisAuthorityCommit): Promise<AnalysisAuthorityCommitReceipt>;
```

数据库窄 RPC 为：

```sql
commit_governed_operator_result(jsonb, bytea) returns jsonb
append_analysis_context_journal(jsonb) returns jsonb
stage_analysis_result(jsonb, bytea[]) returns jsonb
commit_analysis_authority(jsonb) returns jsonb
```

最终 RPC 必须在一个 PostgreSQL 事务中锁定 exact run/node/attempt/stage，复核 worker fence、publisher/operator/oracle/explanation hash，提交 artifact、current/visibility、receipt 与 outbox。

### 3. Contracts

- 唯一状态机：

```text
ANALYZE
→ OPERATOR_INTENT
→ OPERATOR_RESULT_COMMITTED
→ RESULT_BOUND
→ OPERATORS_CLOSED
→ PUBLISH_REQUIRED
→ PUBLISH_STAGED
→ CONTEXT_FROZEN
→ ORACLE_VERIFIED
→ EXPLANATION_BOUND
→ AUTHORITY_COMMITTED
→ CLEANUP_VERIFIED
```

- 算子幂等 identity 固定为 `(scope, run, node, attempt, program_hash, call_id, operator_id)`，同时绑定 `request_sha256`。同键同请求返回同一 result/receipt；同键异请求冲突。
- Operator Sandbox 完成后，宿主先规范化、哈希并持久化 `OPERATOR_RESULT`，再生成固定 Binding Cell。不得先把 output 放入模型消息或 Agent Sandbox 文件。
- Binding Cell 的符号由宿主按 binding identity 确定性生成 `__da_gov_<digest>`；不接受模型变量名、路径或源码。Cell 读取一次性字节，校验 SHA-256，按唯一 wire schema 解码，执行深度/键数/行列/非有限值/容量校验，并递归转换为只读 projection。
- 模型只看到 `status/call_id/result_symbol/result_sha256/shape/receipt_ref`。`output`、`sealed_result_path`、raw rows 和任何路径字段禁止进入 Provider request/message。
- Context Journal append-only，按 `seq + prev_entry_hash + entry_hash` 串联并绑定 context generation、worker fence、source/result/stage refs 和 runtime/policy/template/registry 版本。
- 恢复创建新的 `context_generation`，严格按原序重放已提交的 `MODEL_CELL_COMMITTED` 与 `SERVER_BINDING_COMMITTED`；Binding 从权威 result artifact 取字节，禁止重跑已提交算子。
- `PUBLISH_STAGED` 使用 PostgreSQL durable immutable stage，保存 closure/artifact/component hashes、Publisher receipt、TTL 与 fence。Stage 之后拒绝 model cell/operator/bind/extractor，立即 interrupt/delete Python Context；Oracle 与 Explanation 只读取 stage。
- 过期且未进入 authority commit 的 stage 只能由 `data_agent_u6_cleanup_owner` 的窄 RPC 有界清理；必须校验 EVIDENCE capability/backend scope，使用范围锁与 `FOR UPDATE SKIP LOCKED`，先删子记录并提交不可变、可重放 cleanup receipt。Worker 启动及每 60 秒调用一次，每批最多 100 条；已提交 stage 永不进入候选集。
- Publisher 再提取受控符号，规范化后必须与宿主治理结果的 `result_sha256` 一致。AST protected-prefix 策略是纵深防御，双哈希是 fail-closed 权威门禁。
- 资源起点：Agent 1 vCPU/2 GiB（ML/CAUSAL 2 vCPU/4 GiB），Operator 2 vCPU/2 GiB（ML/CAUSAL 4 GiB），`pids_limit` 128/256，全部 BLAS threads=1，Cell 30s，Operator 60–120s，result 16 MiB，closure 64 MiB，stdout/stderr 4/16 KiB。
- 每次 Run 逻辑 Sandbox 必须 `before=0、peak<=2、after=0`；cleanup 失败不得伪装成功，TTL sweeper 只清孤儿，不替代当次清理证明。

### Falcon24 E1 runtime attestation

- E1 attestation must recompute the retained operator manifest and generated Registry digests, OpenSandbox SDK versions, base image identity, Agent/Operator Dockerfiles, all three lockfiles, and every retained analysis implementation source. It also binds one canonical source-bundle hash over those inputs。
- A matching local attestation is only staging evidence while `production_isolation_proven=false`; it must produce `production_gate=HOLD` and cannot be translated into an active Epoch. Production `GO` requires separate runtime evidence proving the declared isolation and capacity boundary。
- Attestation, operator Registry, and runtime source drift fail closed before Agent Profile materialization or Campaign execution. No best-effort fallback to host Python, an older Registry, or an older attestation is allowed。

### 4. Validation & Error Matrix

| 条件 | 稳定错误/动作 |
| --- | --- |
| OpenSandbox 启动、容量或 secure runtime 不满足 | `PROVISIONING` / HOLD |
| Cell AST/import/protected prefix 越权 | `CELL_POLICY`，不执行 |
| Cell timeout/OOM/PID 耗尽 | `CELL_TIMEOUT` / `OOM` / `PIDS_EXHAUSTED`，新 generation 恢复 |
| 确定性算子失败 | `OPERATOR_DETERMINISTIC_FAILURE`，同能力修复或 HOLD |
| 有副作用或结果状态未知 | `OPERATOR_OUTCOME_UNKNOWN`，禁止自动重试 |
| result artifact 持久化/哈希失败 | `RESULT_DURABILITY`，禁止 Binding |
| Binding 字节或 Publisher 二次哈希不一致 | `BINDING_HASH`，丢弃 stage |
| Journal 缺项、乱序、hash chain 断裂 | `JOURNAL_REPLAY` / HOLD |
| worker fence 过期 | `STALE_FENCE`，零权威可见提交 |
| Publisher symbol/schema/size/closure 失败 | `PUBLISH_CONTRACT`，最多一次等能力修复 |
| Oracle 拒绝 | `ORACLE_REJECTED`，保留非公开 stage，零公开结果 |
| 同幂等键异 request 或最终事务冲突 | `COMMIT_CONFLICT`，all-old |
| Context/Sandbox/egress 未归零 | `CLEANUP_FAILED`，运行不成功 |

### 5. Good / Base / Bad Cases

- Good：Operator output 先成为 PostgreSQL 内容寻址 artifact；固定 Binding Cell 绑定只读符号；模型只收到 hash/shape/ref；Publisher 二次提取同 hash；durable stage 经 Oracle 后一次事务发布并清零两个 Sandbox。
- Base：题目无治理算子时仍记录 Model Cell/Stage/Freeze/Oracle/Commit Journal；不创建虚假 operator result。
- Bad：把完整 operator `output` 塞进 tool result、写 sealed path、只重放模型 Cell、用 RootFS snapshot 代替 Journal、用内存 stage、在同一解释器中把只读 global 当绝对安全边界、最终逐 artifact 顺序 commit。

### 6. Tests Required

1. model request/message 中不存在 operator raw output。
2. 模型投影不存在 sealed/temp path。
3. 宿主、Binding、Publisher 三个 hash 完全相等。
4. 临时 Binding 字节篡改在 decode 前失败。
5. protected prefix 的赋值、删除、alias、`globals()` 被拒绝。
6. 运行时绕过造成值变形时 Publisher 拒绝。
7. Binding 后 Cell timeout，恢复得到同符号/同 hash。
8. result committed 后 Binding 前 crash，从 ledger 恢复且不重跑算子。
9. 同幂等键同 request 返回同 result/receipt。
10. 同幂等键异 request 进入 conflict/HOLD。
11. Stage 后 Oracle 前 crash 可恢复但零公开 artifact。
12. Oracle reject 为零权威可见提交。
13. stale fence 提交被拒绝。
14. 最终事务逐点故障只能观察 all-old/all-new。
15. Stage 后任何 model cell/operator/bind/extractor 被拒绝。
16. Agent/Operator Sandbox 与 egress sidecar 归零，TTL sweeper 清 orphan stage。
17. `pids=32` 已知失败可复现，128/256 三 profile 记录峰值并通过。
18. operator result `16 MiB + 1`、closure `64 MiB + 1` 稳定拒绝。
19. `/workspace/outputs` 写入和生产引用均为零。
20. result/table/chart/operator receipts 指向同一 closure hash。

另需 Result Publisher 不少于 1,000 个属性案例、DeepSeek Strict 真实 100/100、Falcon24 五题冷/暖共 30 次图表 30/30，以及 PostgreSQL 17 migration/RLS/grant/rollback 测试。

### 7. Wrong vs Correct

#### Wrong

```ts
const output = JSON.parse(operatorBytes);
messages.push(serverToolResult({ output, sealed_result_path }));
await stageInMemory(publisherClosure);
for (const artifact of artifacts) await commitOne(artifact);
```

#### Correct

```ts
const governed = await authority.commitGovernedOperatorResult(intent, operatorBytes);
const binding = await session.bindGovernedResult({
  governed_result: governed,
  binding_template_version: "governed-result-binding@1.0.0",
});
messages.push(serverToolResult(projectBoundReference(binding, governed.shape)));
const stage = await stageAuthority.create(extractAndVerify(binding.result_sha256));
await session.freezeAndDeleteContext(stage.stage_hash);
await authority.commitAnalysisAuthority(buildVerifiedCommit(stage, oracle, explanation));
```

唯一 manifest + 精确实现源码继续生成统计 Registry digest；DeepSeek 编排 BH-FDR、Theil-Sen、Mann-Kendall、HAC、Shapley、分群留存等冻结算子，不能重写底层统计公式。

## Scenario: 直接表投影的精确输入列

### 1. Scope / Trigger

同一已发布 Metric 在一个已接受 QueryEvidence 中多次输出（如本期/同期值）时，语义ID不能唯一定位列。
这只消除直接数据投影的二义性，不授予新方法能力、不把 Formula/REQUEST_DERIVED 当成 Metric。

### 2. Signatures

`AnalysisResultContract@2.tables[].projection` 的 `RESULT_COLLECTION.column_mappings[]` 可选：

```ts
{ result_field: "current", table_column: "current", source: {
  input_name: "query_evidence", output_name: "current_revenue"
} }
```

`buildGovernedResultProjections({contract,governed_inputs})` 继续是唯一直接投影实现。

### 3. Contracts

- `source` 只能由Host结果契约提供，strict字段且进入原contract hash；不默认填充，未携带字段的旧契约结构/hash不变。
- input_name为1–63位ASCII标识符，output_name沿原1–128位field规则；同一表的显式input.output不可重复。
- 显式source仅允许DIRECT lineage，且该collection的source_physical_fields必须包含精确input.output。
- Worker必须同时匹配input_name、output_name、semantic_role、semantic_object_id，且唯一；缺显式source仍要求role/ID唯一。
- 先验证exact QueryEvidence/Arrow，再保留原类型、NULL、时间维度/时区、排序与有界行数规则。同表所有列来自同一输入，禁止跨输入拼接。
- 显式source不表示“本期/同期”业务授权；该含义仍由原SQL/QueryEvidence证明承担，不能按列名或位置推断。

### 4. Validation & Error Matrix

- source未知字段/非法标识符/非DIRECT/遗漏lineage/重复显式源 → ResultContract strict/refinement拒绝。
- source或其他内容变更而复用hash → `ANALYSIS_RESULT_CONTRACT_HASH_MISMATCH`。
- 错输入/列/角色/ID/类型/NULL约束、无source的多源匹配、混合或重复输入 → `ANALYSIS_GOVERNED_RESULT_PROJECTION_INVALID`。
- Arrow漂移仍由原 `verifyProductTeamQueryEvidenceInput` 拒绝，不能只信projection JSON。

### 5. Good / Base / Bad Cases

Good：本期/同期共用Metric，以显式source区分，NULL同期和全部月份保留。
Base：旧单序列契约不带source且唯一匹配，继续可读可执行。
Bad：取第一个同ID列，或仅因source列名存在就绕过role/ID校验。

### 6. Tests Required

契约source hash/strict/lineage/唯一性；重复Metric的真实Arrow投影；缺source/错输入/错列/错角色/身份/类型/NULL/跨输入与Arrow漂移。
原单序列趋势、Result Publisher、Program Compiler与publication闭包回归；无source契约固定golden hash。

### 7. Wrong vs Correct

Wrong：`candidates.find(c => c.semantic_object_id === id)`。
Correct：按显式source与语义role/ID共同筛选，要求exactly one，再走原类型/NULL/Arrow及同输入闭包。

## Scenario: 比例结果列的数据权限与方法权限分离

### 1. Scope / Trigger

Analysis消费已接受QueryEvidence的FORMULA或REQUEST_DERIVED列时适用。它们不是发布Metric；不得由role转换授予统计方法权限。

### 2. Signatures

`AnalysisResultContract@2.tables[].columns[].semantic_role` 保留这两种role；共享 `analysisResultTableSemanticRoleSchema` 供staged chart读取。
Host调用 `compileAnalysisProgramCandidate({... , query_evidence:{reference,document}})`，来源必须是原生产resolveCommitted的exact输入。
候选JSON没有该字段，模型不能提交Context、receipt、输入文档或结果契约作为权限。

### 3. Contracts

- 两种role仅允许NUMBER、DIRECT RESULT_COLLECTION、显式source、语义/物理lineage；该ID不得出现在metric_bindings。
- `resolveAnalysisResultSourceObjects` 重验contract/context/QueryEvidence，比较Run/Scope、Context四字段、Release和Schema的id/revision/hash。
- 每个新role表列必须exact匹配`query_evidence.output_name`、原role/ID/NUMBER以及NULL约束；REQUEST_DERIVED的解释依赖必须是节点已选的原Metric/Dimension。
- 只有经此证明的表列ID可进入结果lineage。指标选择、dimension权限、Skill capability与预算完全沿原Published AnalysisContext，不把新ID加入这些集合。
- 后续直接投影仍验证真实Arrow/语义绑定/NULL；Publisher将原role写入TABLE/CHART载荷。图表公开展示是投影，不能反向产生方法授权。
- 旧契约不增字段，不改历史hash。没有这两种role的旧程序保持原路径；有role而没有accepted输入必须拒绝，不存在兼容放行。

### 4. Validation & Error Matrix

新role缺DIRECT/source/lineage、非NUMBER或与metric_bindings同ID → ResultContract拒绝。
缺输入、exact ref/Run/Scope/Context/Release/Schema漂移、错source/role/ID或缺解释依赖 → `ANALYSIS_PROGRAM_RESULT_SOURCE_AUTHORITY_INVALID`。
候选把比例ID放进metric_ids → `ANALYSIS_PROGRAM_CANDIDATE_METRIC_NOT_PUBLISHED`；不能降级成数据消费。

### 5. Good / Base / Bad Cases

Good：原收入/投入Metric继续提供方法能力，净ROI列按REQUEST_DERIVED进入受治理结果与图表。
Base：输入层与编译fixture通过不是新方法、独立oracle、模型Run或正式验收通过。
Bad：把净ROI改成METRIC或把一个普通自洽JSON当成生产resolveCommitted证据。

### 6. Tests Required

两种role的契约/Program/data projection/chart parser正例、原Metric选择不变、真实Arrow保留NULL；缺输入、换ref/Run/Scope/package/receipt/
Release revision/Schema hash、Context hash、source列/role、解释依赖与ID升级的拒绝矩阵。原单序列、Publisher和publication回归。

### 7. Wrong vs Correct

Wrong：`metric_ids.push(requestDerivedId)`。
Correct：`metric_ids`仍选原发布指标，Host仅把exact来源证明得到的比例ID放入结果lineage允许集合。
