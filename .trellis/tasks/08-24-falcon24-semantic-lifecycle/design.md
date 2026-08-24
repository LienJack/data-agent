# Design: Falcon24 语义生命周期与 Agent 分析验收

## Authority and versioning

PostgreSQL Published Semantic Release、Schema Snapshot、Policy Snapshot 和 `SemanticContextPackage` 是运行权威。知识、Schema、旧版本、
用户编辑和模型结果先归一化成 `SemanticAssertionCandidate@1`，再聚合为 `SemanticChangeSet@1`。确定性 validator 与人审冻结 exact
revision 后才形成新 release。Neo4j、vector、sparse 和 lexicon index 均由 release event 重建，索引失败不回滚权威发布，但消费路径
必须记录降级。

`SemanticContextPackage@1` 是唯一语义消费合同，`AnalysisProgram@1` 是唯一分析执行合同。隔离 worktree 内直接更新所有消费者并删除
Resolved Context V2/V3、AnalysisPlan、旧 builder/reader/resolver/planner 与 adapter；没有包装、双读或运行时兼容期。`SandboxProgram@1`
继续作为 AnalysisProgram 的隔离执行载荷，不另起平行分析合同。

## Production pipeline

```text
Knowledge/Schema/Published/Agent
  -> typed assertions + provenance
  -> identity resolution + conflict groups
  -> SemanticChangeSet
  -> deterministic validation
  -> frozen review revision
  -> Published Semantic Release (PostgreSQL)
  -> lexicon/sparse/vector/graph projections
  -> drift and binding-impact candidates
```

断言 identity 使用 workspace + semantic kind + canonical key + applicability scope；Evidence locator 和 inference rule 参与 provenance digest，
但不改变业务对象 identity。冲突保留并阻断发布，不由模型选择胜者。

## Retrieval and reasoning pipeline

1. 解析 intent、requested measures/dimensions/time 与 principal scope。
2. 在每条 route 前应用 workspace、ACL、PUBLISHED、release/frontier 和时间预过滤。
3. 运行 deterministic lexicon、sparse、vector、typed graph 四路召回；不可用 route 写入降级 receipt。
4. 用固定参数 RRF 融合并保留 route ranks/scores。
5. 对 top seeds 按类型注册表扩展最多 3 hop/80 nodes/160 edges。
6. 规则引擎构造 Formula、Join、lineage、time、quality、policy 和 selected-evidence mandatory closure。
7. 预算截枝先删除低分 optional paths；mandatory closure 不截。闭包超预算时 fail closed，不返回残缺上下文。
8. 生成可 hash 的 `SemanticRetrievalReceipt@1`、`SemanticInferenceReceipt@1` 和唯一 `SemanticContextPackage@1`。

图规则采用显式 allowlist：Formula dependency、Metric subject、Dimension hierarchy、Physical binding、Join、Lineage、Quality constraint。
OWL 风格规则只运行已注册、安全且可解释的有限子集；推断结论必须带 rule id、premises 和 path。

## Falcon24 analysis flow

每题先由唯一语义解析入口得到 `SemanticContextPackage@1`，再编译唯一 `AnalysisProgram@1` 与其中的
`AnalysisResultContract@1`：

```text
governed SQL inputs -> bounded artifacts -> DeepSeek source generation
 -> static admission -> stateful attested sandbox Cells
 -> operator intent -> Operator Sandbox
 -> host canonicalizes/hashes and durably commits governed operator result
 -> server-owned Binding Cell binds a protected symbol in the Agent Context
 -> model receives only symbol/hash/shape/receipt metadata
 -> publish_analysis_result(symbol refs + chart intent)
 -> server Result Publisher re-extracts and verifies the governed result hash
 -> PostgreSQL durable immutable stage -> context freeze and physical delete
 -> independent Oracle reads only stage
 -> DeepSeek explanation reads only verified bounded projection
 -> one fenced PostgreSQL transaction commits authority/current/receipt/outbox
 -> public answer -> Sandbox/egress cleanup verified at zero
```

五题共享窗口/frontier 和安全边界，但不共享 sealed truth。每题采用独立方法模块和 Oracle adapter：

- Q1 月度指标、MoM 极值、分维度贡献、三因子对称 Shapley identity closure。
- Q2 6v6 趋势和多变量 binomial GLM；结论 projection 限制为 association。
- Q3 销量与双库存源分离；Theil-Sen、last3/previous9、BH FDR 和 no-hit watchlist。
- Q4 周级 funnel、0-4 lag、trend/seasonality、HAC、FDR，结果仅为 temporal association。
- Q5 cohort M0-M6、异常审计、总体 HOLD、排除 temporal-invalid 客户的敏感性结果。

图表不是第二份分析答案。DeepSeek 只负责受控 Python 数据变换、治理算子编排、选择已注册图表模板/字段绑定和解释；它不写最终
JSON、表格或图片。Result Publisher 从冻结 Python 符号提取候选数据，统一处理 pandas/numpy/date/Decimal/缺失值并执行结果语义契约，
但禁止修正业务值。独立 Oracle 按 Arrow 输入重算并接受暂存结果后，服务端固定 `falcon24-analysis-chart@1` 从同一暂存 dataset 投影为
`ArtifactWorkspaceDocument` V3，并将结果、表格、图表、解释和 Receipt 原子提交。Falcon suite/oracle/run/gate 直接切换到唯一当前版本 2/3/3/2，
不保留旧 shape 的 reader 或 adapter。Q1 使用三项 KPI 归一化趋势，Q2 使用前后 6 个月配送分位数，
Q3 使用销量与损坏恶化优先矩阵（无命中时仍返回零命中图），Q4 使用渠道/人群 ROAS，Q5 使用 cohort M0-M6 留存与复购曲线。
Chart document 绑定 QueryEvidence、DerivedAnalysisEvidence、Semantic Context package/receipt、runtime lock 与 dataset hash；只有 commit 成功后
才进入公开 tool event 和回答中的 `artifact://` 引用。

## Model-generated Python boundary

`AnalysisProgramSourcePort` 的 DeepSeek adapter 只接收 node descriptor、bounded schemas、semantic formulas、statistical method contract、
input artifact summaries 和 output JSON schema。它固定 provider profile/model=`deepseek-v4-flash`，要求纯源码响应并规范化 source hash。
Host 负责 AST/import policy、runtime/lock/seed/budget/result closure。模型唯一完成工具是 `publish_analysis_result`，其参数只能引用
当前 Context 的白名单 symbol、声明表格和已注册图表模板；固定提取 Cell 在同一 Context 冻结后运行，禁止 pickle/eval/任意文件路径，
并对行列数、字节数、嵌套深度、非有限值和类型做硬上限校验。模型无法写 `/workspace/outputs`，也不接收任意输出文件 API。

Tool Manifest 是唯一来源：它同时生成服务端完整 Zod validator 与 DeepSeek Strict 兼容 JSON Schema 投影。Strict 只保证 Provider 参数
形状，所有指标身份、血缘、grain、operator binding 和结果字段仍由服务端校验。实际 `deepseek-v4-flash`/endpoint 未认证时发布门禁保持
HOLD，不得把非 Strict 模式作为运行时 fallback。

工具编排与权威生命周期是同一个穷尽状态机：

```text
ANALYZE -> OPERATOR_INTENT -> OPERATOR_RESULT_COMMITTED -> RESULT_BOUND
        -> OPERATORS_CLOSED -> PUBLISH_REQUIRED -> PUBLISH_STAGED
        -> CONTEXT_FROZEN -> ORACLE_VERIFIED -> EXPLANATION_BOUND
        -> AUTHORITY_COMMITTED -> CLEANUP_VERIFIED
```

每类修复预算独立且不会扩大总模型调用/总时间：Python Cell、Tool Schema、Publish Symbol/Schema 各最多一次模型修复；Publisher I/O、
结果持久化、Binding hash、Journal replay、媒体渲染、原子提交、Operator Receipt、Oracle、KPI Identity 和 Cleanup 失败直接进入对应
基础设施/HOLD 终态。`PUBLISH_STAGED` 后禁止继续执行模型 Python/operator/bind/extractor，随后立即删除 Context；
`AUTHORITY_COMMITTED` 前不得公开结果。

## Result Publisher boundary

`AnalysisResultContract@1` 由 AnalysisProgram 编译并绑定 SemanticContextPackage 的指标、维度、关系、血缘、时间和数据质量闭包。
`publish_analysis_result@1` 只是小型引用清单，不传输大结果，也不产生 Authority。治理算子完成后，Host 必须先把 canonical bytes、
request/result hash、shape 与 receipt 提交到 PostgreSQL result ledger，再用固定 Binding Cell 在同一 Agent Context 绑定
`__da_gov_<digest>`；模型消息只获得符号/hash/shape/ref。Publisher 依次执行：固定符号提取、类型归一、与 ledger 原始 result hash
二次闭合、严格 schema/semantic binding、确定性 table/chart dataset 生成、规范 hash 和 PostgreSQL durable stage。它只能拒绝或忠实
投影，不能补数字、重算自由公式、改变分组或自动选择另一业务口径。

Context Journal 是 append-only PostgreSQL hash chain，按原执行顺序记录 Model Cell、operator intent/result、server binding、stage、freeze、
Oracle、explanation、authority 与 cleanup。恢复时创建新 generation，只按序重放已提交 Model Cell 和 Server Binding；Binding 从 ledger
读取原始 artifact，禁止盲目重跑算子。OpenSandbox RootFS snapshot 不保存 Python namespace，不构成恢复权威。

Stage 成功后立即逻辑冻结并物理删除 Python Context；Oracle 与 Explanation 只能读取 stage。Oracle 接受后，Artifact Authority 在有效
Fence 下以一个 PostgreSQL RPC/事务提交 machine result、tables、charts、operator closure、Oracle receipt、explanation、publisher receipt、
current/visibility 和 outbox。任一 hash/scope/run/frontier 漂移都只能观察 all-old，不得逐 artifact 顺序提交。

## Independent Oracle boundary

Suite manifest 只含公开题目、方法要求、输入 refs 和门槛；sealed fixtures/expected invariants 位于独立模块，生产 planner/executor 通过依赖
边界测试禁止引用。Oracle 重算或验证：窗口、join cardinality、zero fill、统计量/置信区间/FDR、identity closure、结论 vocabulary、quality
downgrade、program/runtime/receipt hashes。LLM confidence 不参与 pass/fail。

## Failure and rollback

- route/index failure：允许同一新编译器内使用 PostgreSQL 权威数据完成检索，receipt 明示 DEGRADED；不得调用旧 resolver，mandatory closure 不完整则 HOLD。
- semantic conflict、formula/join/ACL/frontier drift：fail closed 并产生新 Candidate/plan revision。
- provider unavailable：节点 HOLD，不用模板冒充生成 Python。
- policy/sandbox/output/oracle failure：zero partial commit；最多一次等能力 repair；再次失败 HOLD/PARTIAL。
- publish symbol/type/schema failure：只允许一次不扩权修复；Publisher I/O/渲染/提交失败不调用模型，零部分提交。
- sandbox cleanup：`finally` 通过 Lifecycle API delete 并轮询 metadata 过滤结果为零；Worker 启动及定时扫描 `managed-by=data-agent-analysis`
  的过期孤儿。TTL 只作为最后保险，不作为清理成功证据。
- 任一 suite hard gate 失败：新 release HOLD，原子切换不得合并或发布；不能用旧路径冒充可用。
- Neo4j/vector/sparse 投影可独立关闭并由 PostgreSQL 重建；语义合同与执行入口没有双轨 kill switch。
- 回滚通过 Git、发布版本和数据迁移整体恢复，不在运行时保留双读、旧 reader 或兼容 adapter。

## Security and public projection

公开事件只允许问题、方法名、语义对象引用、进度、接受后的图表/结论和限制。每个成功 Falcon 回答先发布携带唯一 V3 Chart ref 的
完成 tool event，再发布包含同一授权 `artifact://` 链接的 answer；Web 使用现有 Artifact Workspace/VChart renderer 内联展示。禁止原始行、Python source、provider request/response、stderr、
密封答案、提示词、凭据、DSN 和内部路径。授权后的 evidence drawer 仍只返回有界 artifact projection。
