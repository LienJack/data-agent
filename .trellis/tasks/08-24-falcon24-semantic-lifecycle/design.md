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

每题先由唯一语义解析入口得到 `SemanticContextPackage@1`，再编译唯一 `AnalysisProgram@1`：

```text
governed SQL inputs -> bounded artifacts -> DeepSeek source generation
 -> static admission -> attested sandbox -> output contract
 -> independent Oracle -> accepted evidence -> deterministic chart projection
 -> public answer + chart artifact
```

五题共享窗口/frontier 和安全边界，但不共享 sealed truth。每题采用独立方法模块和 Oracle adapter：

- Q1 月度指标、MoM 极值、分维度贡献、三因子对称 Shapley identity closure。
- Q2 6v6 趋势和多变量 binomial GLM；结论 projection 限制为 association。
- Q3 销量与双库存源分离；Theil-Sen、last3/previous9、BH FDR 和 no-hit watchlist。
- Q4 周级 funnel、0-4 lag、trend/seasonality、HAC、FDR，结果仅为 temporal association。
- Q5 cohort M0-M6、异常审计、总体 HOLD、排除 temporal-invalid 客户的敏感性结果。

图表不是第二份分析答案。DeepSeek 只负责生成受控 Python 和结构化结果；独立 Oracle 先按 Arrow 输入重算并接受结果，再由服务端固定
`falcon24-analysis-chart@1` 投影为 `ArtifactWorkspaceDocument` V3。Falcon suite/oracle/run/gate 直接切换到唯一当前版本 2/3/3/2，
不保留旧 shape 的 reader 或 adapter。Q1 使用三项 KPI 归一化趋势，Q2 使用前后 6 个月配送分位数，
Q3 使用销量与损坏恶化优先矩阵（无命中时仍返回零命中图），Q4 使用渠道/人群 ROAS，Q5 使用 cohort M0-M6 留存与复购曲线。
Chart document 绑定 QueryEvidence、DerivedAnalysisEvidence、Semantic Context package/receipt、runtime lock 与 dataset hash；只有 commit 成功后
才进入公开 tool event 和回答中的 `artifact://` 引用。

## Model-generated Python boundary

`AnalysisProgramSourcePort` 的 DeepSeek adapter 只接收 node descriptor、bounded schemas、semantic formulas、statistical method contract、
input artifact summaries 和 output JSON schema。它固定 provider profile/model=`deepseek-v4-flash`，要求纯源码响应并规范化 source hash。
Host 负责 AST/import policy、runtime/lock/seed/budget/output closure。repair prompt 只包含 scrubbed diagnostics；最多一次，且不能改变 plan、
profile、imports、inputs 或预算。

## Independent Oracle boundary

Suite manifest 只含公开题目、方法要求、输入 refs 和门槛；sealed fixtures/expected invariants 位于独立模块，生产 planner/executor 通过依赖
边界测试禁止引用。Oracle 重算或验证：窗口、join cardinality、zero fill、统计量/置信区间/FDR、identity closure、结论 vocabulary、quality
downgrade、program/runtime/receipt hashes。LLM confidence 不参与 pass/fail。

## Failure and rollback

- route/index failure：允许同一新编译器内使用 PostgreSQL 权威数据完成检索，receipt 明示 DEGRADED；不得调用旧 resolver，mandatory closure 不完整则 HOLD。
- semantic conflict、formula/join/ACL/frontier drift：fail closed 并产生新 Candidate/plan revision。
- provider unavailable：节点 HOLD，不用模板冒充生成 Python。
- policy/sandbox/output/oracle failure：zero partial commit；最多一次等能力 repair；再次失败 HOLD/PARTIAL。
- 任一 suite hard gate 失败：新 release HOLD，原子切换不得合并或发布；不能用旧路径冒充可用。
- Neo4j/vector/sparse 投影可独立关闭并由 PostgreSQL 重建；语义合同与执行入口没有双轨 kill switch。
- 回滚通过 Git、发布版本和数据迁移整体恢复，不在运行时保留双读、旧 reader 或兼容 adapter。

## Security and public projection

公开事件只允许问题、方法名、语义对象引用、进度、接受后的图表/结论和限制。每个成功 Falcon 回答先发布携带唯一 V3 Chart ref 的
完成 tool event，再发布包含同一授权 `artifact://` 链接的 answer；Web 使用现有 Artifact Workspace/VChart renderer 内联展示。禁止原始行、Python source、provider request/response、stderr、
密封答案、提示词、凭据、DSN 和内部路径。授权后的 evidence drawer 仍只返回有界 artifact projection。
