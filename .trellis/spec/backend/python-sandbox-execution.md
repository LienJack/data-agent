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
- 修改Agent日期输入、Cell错误投影或FINAL解释时，另读 [Analysis Agent 反馈](./analysis-agent-feedback.md)；
  该叶子规范约束dtype/NULL/意图传递，不增加重试、结果来源或发布权限。

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

## Scenario: 有界月度多结果的描述性方法契约

### 1. Scope / Trigger

接受的QueryEvidence含一个MONTH Dimension和2–4个NUMBER结果列，恰好12个完整连续月；允许同Metric的本期/同期与已证明比例。
此契约仅定义新方法的输入、输出与计算规则；生产启用仍须独立oracle与原Sandbox/publication接线，不得将编译成功视为业务PASS。

### 2. Signatures

`compileMonthlyComparisonPlan({context,query_evidence_ref,query_evidence_document})` →
`{result_contract,required_operator_obligations:[],shape,execution_contract}`；
method ID为`published-monthly-multi-measure-comparison@1`，ResultContract为`monthly-multi-measure-comparison.result`。
`createMonthlyComparisonOracle(context).evaluate({node,governed_inputs,sandbox_outputs,sandbox_receipt})`独立验算；
`resolveAnalysisEvidenceTimeWindow(binding,context)`是原Brief与oracle共用的时间窗归一化，不改变原规则。
`AnalysisMethodRegistryEntry.execution_contract?`为Host-only执行规则，随原registry hash封存；不在模型candidate schema中。
生产`analysisContextPort`仅把当前节点匹配的规则放入`semantic_contract.method_execution_contracts`。

### 3. Contracts

- 原Metric最多3个，均须原发布`CHART_DATASET`、合法同月维度/时区/公式及原applicability；不改Skill限制。
- 原文档/ref/hash、Context四字段、Scope/Run、Release/Schema id/revision/hash必须一致；比例复用来源权威校验，不成为Metric。
- 严格3–5列、12行、唯一连续月份，DATE保留日历值、DATETIME按显式时区转日历月。未知role、多维、缺月份和全空measure不接受。
- `column.nullable=true`是来源允许空值，不等于本次结果含空月份；按实际12个时间值判定非空/连续性，输出仍保留原nullable元数据。
  不得仅因目录允许NULL拒绝完整结果，也不得把实际NULL时间改成日期或补零。
- observations为原DIRECT集合，各列显式source；保留原值和NULL，仅按月份排序。一个图的所有y通过现有Web分图展示。
- 每个measure独立JSON字段：观测/缺失数、极值、最低/最高3点、完整窗口首尾值/变化、最多3个相邻月下降；值与序数不得跨measure混算。
- 缺失或零分母导致undefined时保留NULL；不可移动窗口端点或跨缺口相减。排序同值按月份升序。`claim_strength=DESCRIPTIVE`。
- execution_contract只含Host规则、JSON Schema和source列名，不含行或预计算答案。无显著性检验、因果结论、自由文本事实或未声明结果字段。
- Oracle重验Context/原QueryEvidence/实际Arrow与原合同；只从源行做独立Host算术，不把模型结果、表或图当期望值输入。
  完整RESULT/TABLE/CHART内容分别与期望相等；scope/run、内容bytes/hash/ref、method/Metric/窗口、无算子义务必须同时闭合。
- `GENERATED_ANALYSIS.oracle_scope=FULL`只覆盖这里声明的描述性字段和原始表图，不覆盖因果或统计推断；`material_change=false`，
  不凭描述性差值启用需要阈值的分支。缺失/零分母保留undefined限制。implementation hash绑定实际oracle模块内容摘要与执行规则。
- 唯一production composition按接受输入形态注册：两列仍走原single-series编译器；多列必须通过完整月度比较编译器。
  不捕获失败后降级、不丢列、不按问题文字/题号路由。Context与oracle均要求exact单一method ID、skill和ResultContract hash。
  新方法缺执行规则即拒绝；原方法的Mann-Kendall/Theil-Sen义务、预算、Root动态编排与原子publisher均不变。

### 4. Validation & Error Matrix

来源/发布能力/公式/维度/时区漂移 → `MONTHLY_COMPARISON_AUTHORITY_INVALID`；
列/role/行数或值/月份不符 → `MONTHLY_COMPARISON_{SHAPE|VALUE|WINDOW}_INVALID`或原QueryEvidence拒绝码；
比例来源依赖缺失 → `ANALYSIS_PROGRAM_RESULT_SOURCE_AUTHORITY_INVALID`。拒绝后不得退回单序列方法或自动丢列/丢行。
Oracle的scope/contract/output/input漂移 → `MONTHLY_COMPARISON_ORACLE_*_INVALID`；RESULT/TABLE/CHART与源期望不同 →
`MONTHLY_COMPARISON_ORACLE_{RESULT|TABLE|CHART}_MISMATCH`；有限输入运算溢出 → `MONTHLY_COMPARISON_ORACLE_NUMERIC_RANGE_INVALID`。
生产节点方法/skill/contract不匹配 → `PRODUCTION_ANALYSIS_METHOD_BINDING_INVALID`；新方法缺规则 →
`PRODUCTION_ANALYSIS_EXECUTION_CONTRACT_REQUIRED`；无匹配oracle → `PRODUCTION_ANALYSIS_ORACLE_NOT_REGISTERED`。

### 5. Good / Base / Bad Cases

Good：12月收入、本期/同期同Metric及6个NULL的同比结果，各自按来源比较。
Base：单指标2列表继续原统计趋势方法，不改变其Mann-Kendall/Theil-Sen义务。
Bad：拼接不同窗口、把先后两个非空月假装相邻月、把ROI均值当合计ROI，或因字段叫ratio就猜身份。

### 6. Tests Required

角色/NULL/显式映射/不扩大Metric；行序、列序、别名、DATETIME；Context/Release/Schema/Scope/能力/公式/维度/时区漂移；
缺月、重复月、空时间、全空measure、非法值、单measure、多维和未选择比例依赖。后续oracle须逐数值、表/图和hash闭包反例。
Oracle测试必须用手写已知值作为正例，不调用oracle算法生成自己的测试期望；覆盖重新封hash后的错误数值/计数/同值排序/
换列/补零/跨缺口/额外总结/因果声明，真实Arrow的类型正确但数值漂移，以及零端点、中间缺失和溢出。
生产注册正例必须更换问题文字仍选相同输入方法；两列输入保留原算子与oracle，删算子仍拒绝。
月份DATE/DATETIME两种来源nullable=true但实际完整必须通过，实际空时间、重复月和缺月仍失败；类型/nullable元数据不得改写。
匹配执行规则不含行/预计算值，未注册方法/缺规则拒绝；新方法通过production oracle选择器，叙述投影保留逐measure受验数值。

### 7. Wrong vs Correct

Wrong：`first_value = series.dropna().iloc[0]`。
Correct：`first_value = original_monthly_series.iloc[0]`，缺失端点保持NULL，变化只能来自原窗口端点。

## Scenario: 全量已接受输入与显式时间窗

### 1. Scope / Trigger

原QueryEvidence的`time_window=null`进入描述性分析；不得用Metric coverage推测请求日期，也不能因此跳过Program窗口校验。
这只是输入范围契约，不是通用分析方法、业务通过或新发布权威。

### 2. Signatures

`resolveAnalysisEvidenceTimeWindow(binding,context)`保留显式null；有窗输入继续原日期/时区归一化。
`verifyAcceptedAnalysisQueryEvidence({context,run_id,query_evidence})`复用原QueryEvidence/Run/Scope/Context/Release/Schema重验。
Candidate `analysis-program-candidate@2.1.0`允许必填字段`time_window:null`；原1.0/2.0仍拒绝null。
全量Program使用`analysis-program@1.1.0`、Host compiler2.1及envelope1.1；原有窗Program仍1.0/Host2.0。

### 3. Contracts

- 全量仅由Host原resolveCommitted QueryEvidence授权，Compiler不能仅凭模型或Brief声称null；全部节点范围须与原输入完全一致。
- null节点只允许open-python/OPEN_ANALYSIS、空operator obligations、comparison_window=null、ResultContract无时间grain。
  具体方法仍须独立的输入形态、发布capability和oracle，不因null而获得统计/因果能力。
- Gate始终精确比较Brief与节点窗口，包括null；无窗Brief不能被擅自加窗，有窗Brief不能被删窗。
- 新Wire tuple显式注册；Program hash domain等于自身protocol_version。旧1.0非空封包golden hash保持；不改历史文档或hash。
- Host planning authority新增`approved_time_window`，模型只复制归一化后的原值，不从指标coverage猜范围。
  2.1 candidate在有窗场景编译结果与原2.0完全相同；原publisher、预算、动态Root与数据库权威不变。

### 4. Validation & Error Matrix

无来源/错Run、Scope、Context或Release/Schema/来源有窗但节点null → `ANALYSIS_PROGRAM_INPUT_TIME_SCOPE_INVALID`。
旧版null、新版null附对比窗、统计算子或时间grain → Schema拒绝`ANALYSIS_PROGRAM_ALL_INPUT_SCOPE_INVALID`。
Brief与节点窗口不同 → `ANALYSIS_PROGRAM_TIME_WINDOW_NOT_APPROVED`；缺必填字段或未知wire tuple仍严格拒绝。

### 5. Good / Base / Bad Cases

Good：全量渠道来源的null逐层保留，具体比较仍等待独立方法与oracle。
Base：12月趋势保留精确半开窗口、两个统计义务及旧Program格式。
Bad：把published min/max填成用户请求，或`if (brief.window)`后直接略过校验。

### 6. Tests Required

null传递、候选版本门禁、来源/Context/Run/Release/Schema漂移、擅自加窗/删窗/加对比窗；新版本封包与幂等引用；
旧候选和新候选的有窗Program逐字段相等、旧Wire golden hash；原单指标、月度比较、发布与Trace消费方回归。
这类fixture仅证明契约边界，不得将mock commit或方法fixture记为生产数据库/Sandbox/模型执行证据。

### 7. Wrong vs Correct

Wrong：`requested_time_window = binding.time_window ?? metric.time_domain`。
Correct：`requested_time_window = resolveAnalysisEvidenceTimeWindow(binding, context)`，显式null保留且由原接受输入证明。

## Scenario: 分类多结果的有界描述性比较

### 1. Scope / Trigger

已接受QueryEvidence有1–2个STRING/atomic分类维度和1–4个NUMBER结果列，1–64行；全量或已接受的显式窗口均可。
独立oracle与唯一production composition按此输入形态启用；不是月份×分类或混单位/粒度方法。

### 2. Signatures

`compileCategoryComparisonPlan({context,query_evidence_ref,query_evidence_document})`返回`result_contract/shape/execution_contract`及空算子义务。
method=`published-category-multi-measure-comparison@1`，contract=`category-multi-measure-comparison.result`。
`categoryComparisonMeasureSchema`规定原列、观测/缺失数、极值和最低/最高各最多3个`{source_row_index,group,value}`。
分类/月度叶子共用`buildDescriptiveResultContract`编码固定observations、JSON字段、原source/role/NULL、lineage与图表元数据；
该纯构造器不验证或授予权限，调用者仍须独立执行原来源、applicability与结果source proof。
`createCategoryComparisonOracle(context): AnalysisOraclePort`重编原来源合同并独立验算；公共`createAnalysisOracleOutputClosure`
只复用字节/ref/JSON检查，implementation digest同时绑定叶子与公共模块内容，不共享业务期望算法。

### 3. Contracts

- 完整分类tuple必须唯一且实际非空；nullable元数据原样保留。含分隔符的分类不能靠字符串拼接判断相同组。
- 原Metric1–3个且与Context精确一致，原公式、groupable维度和CHART_DATASET/applicability全部不变；不同单位/粒度/空值政策不能混算。
- FORMULA/REQUEST_DERIVED只进入已证明的DIRECT来源投影，不成为Metric。全部source列/角色/NULL/行序保留，不重新分组或平均比例。
- 有窗时验证原Metric时间维度/时区/日历；无窗保持null。结果grain为分类而非时间，不能凭这一方法计算增长或趋势。
- chart为`bar.grouped@1`，x取第一个来源分类，第二个分类原字段作series；每个measure仍独立。不可省掉第二分类或编造组合列。
- execution_contract只含字段与计算规则，不含行/预计算答案。排名同值按原始零基行号；group须包含原行的所有分类。
  `claim_strength=DESCRIPTIVE`，无统计、因果、跨期增长或自由文本事实；继续原publisher和预算。
- Oracle重验原QueryEvidence与真实Arrow、Scope/Run/Context/Release/Schema、method/contract/窗口/Metric/维度以及空算子义务，
  从原始行独立重算每项计数/极值/排名；RESULT/TABLE/CHART完整精确相等，重新封hash不豁免内容检查。
  FULL仅覆盖固定描述性合同，`material_change=false`；coverage按全部measure真实观测数计算，缺失数显式保留。
- production先按全部分类维度形态选择叶子，仍运行完整编译器；不按问题文字、不吞错误fallback、不删除列。
  exact method/skill/contract及Host执行规则必须匹配；原single-series统计义务和月度方法保持不变。

### 4. Validation & Error Matrix

来源/发布Metric/capability/维度/单位/粒度/空值政策漂移 → `CATEGORY_COMPARISON_AUTHORITY_INVALID`；
超过原BAR图64行限制、空输入、时间维度、未知role或重复tuple → `CATEGORY_COMPARISON_SHAPE_INVALID`；
实际NULL/空分类、非法数值或整列无观测 → `CATEGORY_COMPARISON_VALUE_INVALID`；派生来源仍走原authority拒绝码。
oracle合同/输入/字节闭包漂移 → `CATEGORY_COMPARISON_ORACLE_*_INVALID`或原Arrow拒绝码；受验内容不等 →
`CATEGORY_COMPARISON_ORACLE_{RESULT|TABLE|CHART}_MISMATCH`；缺生产执行规则与method绑定继续原production拒绝码。

### 5. Good / Base / Bad Cases

Good：4渠道×2人群分别展示投入、收入与已接受ROI，零分母NULL保留。
Base：只有渠道时series=null，来源显式时间窗不变。
Bad：把每个渠道的人群行合并成一点，或将4个ROI求平均后称总ROI。

### 6. Tests Required

1/2维×两比例role、NULL元数据/实际NULL、原始行序及含分隔符的tuple；精确有窗/全量；原授权漂移、混单位/粒度/空值政策、
空输入、超行数、重复tuple、全空measure、时间维度/未知role。oracle用手写已知值正例，覆盖全部结果字段、同值排名/缺失group/
补零/额外事实/因果、完整表图绑定与重新封hash、类型正确但篡改值的Arrow。真实投影保留两个分类与NULL，叙述保留受验值。
生产选择更换问题文字仍不变；匹配规则及oracle通过，缺规则/错绑定拒绝。stub Sandbox receipt仅是unit边界fixture，不是执行回执。
入口64行通过且可通过原V3 BAR schema，65行须在方法编译时拒绝；不能扩大图表预算或删行来迁就输入。
公共合同编码重构须保持改动前固定的5个ResultContract golden hash（月度1项、分类1/2维×两派生角色4项），不可通过改期望掩盖漂移。

### 7. Wrong vs Correct

Wrong：`key = channel + "|" + audience`。
Correct：`key = JSON.stringify([channel, audience])`，输出仍分别保留两个原始分类字段。

图表原始分类分面的完整契约见 [受治理分析图表](./governed-analysis-charts.md)。

完整月度分群的方法、独立 Oracle 与生产接线见 [受治理月度分群](./governed-monthly-panels.md)。
