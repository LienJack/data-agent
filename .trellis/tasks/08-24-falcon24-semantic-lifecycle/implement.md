# Implementation plan: Falcon24 语义生命周期唯一实现

## 执行状态

- [x] M0 固定基线、隔离 worktree、Falcon24 数据事实与 Semantica 固定快照。
- [x] 探索提交：Candidate/ChangeSet 与 hybrid retrieval 原型。它们是实现证据，不是最终合同；V3 包装必须删除。
- [x] M1 唯一合同与权威切换。
- [x] M2 语义生产工厂。
- [x] M3 多路召回与血缘扩展。
- [x] M4 逻辑推理与闭包裁剪。
- [ ] M5 DeepSeek Python Agent。
- [ ] M6 Falcon24 五题验收、反馈迭代与旧路径删除。
- [ ] Finish 全量检查、规范更新、提交、合并和 dirty-base 复验。

M5 当前已完成固定模型 Source Port、Provider 调用回执、一次 scrubbed repair、静态准入、Sandbox
执行器、PostgreSQL Analysis Artifact Port 与五题生产路由。剩余工作是严格 QueryEvidence 物化、Sensitive
Python Source 权威适配及真实 DeepSeek 冷暖运行；缺少凭据时必须保持 HOLD。

后续实现以 `semantica-plan/0 大纲.md` 与 M1-M6 为唯一执行依据。旧 U1/U2 命名和任何 V2/V3、AnalysisPlan 兼容设计均不再有效。

## M1 唯一合同与权威切换

- 定义唯一 `SemanticContextPackage@1` 与 `AnalysisProgram@1`，内容寻址并绑定 release/schema/permission/evidence hashes。
- 更新 contracts、semantic、Text2SQL、worker、platform、evals、web 全部消费者。
- 在同一原子切换中删除 Resolved Context V2/V3、AnalysisPlan、旧 resolver/planner、reader、adapter、fixture 和导出。
- 增加 architecture boundary test，禁止旧符号和第二入口重新出现。

## M2 语义生产工厂

- 统一 Knowledge/Schema/Lineage/Human/Model proposal 为 `SemanticAssertionCandidate` 和 `SemanticChangeSet`。
- 完成 identity、conflict、shape、Formula AST、grain/join/time/policy/quality/cycle 校验。
- 建立可执行 Competency Cases、人审冻结、PostgreSQL 发布事务、rollback/drift/binding-impact receipt。
- 索引和图只订阅发布事件并可完整重建。

## M3 多路召回与血缘扩展

- 在每条 route 前执行 workspace/RBAC/published/valid-time/sensitivity/conflict 硬过滤。
- 并行 exact alias、fuzzy/BM25、vector、typed graph，固定 RRF `k=60`。
- 关系模板驱动 Formula/Join/Bind/Lineage/Time/Policy/Quality 扩展，上限 3 hop/80 nodes/160 edges。
- 每个 route、路径、淘汰和降级进入 `SemanticRetrievalReceipt`。

## M4 逻辑推理与闭包裁剪

- 编译可终止、可解释的分层 Datalog/前向规则子集。
- 为每个结论记录 premises/rule/release/valid-time，并支持 premise 失效传播。
- 构造 mandatory closure；只裁 optional semantic clusters，保持路径连通。
- mandatory closure 超预算时 fail/clarify，不返回残缺上下文。

## M5 DeepSeek Python Agent

- 固定 `deepseek-v4-flash` 的 `AnalysisProgramSourcePort`，只接收 bounded semantic/schema/evidence。
- 每题至少一个真实 `MODEL_GENERATED` Python 节点；Arrow/Parquet 输入，无 DSN/凭据/全量原始行。
- 完成 AST admission、固定 runtime/lock/seed、无网络 sandbox、资源预算、zero partial commit。
- Attempt 0 保留；最多一次 scrubbed、非扩权 repair；独立 Oracle 决定接受。

## M6 Falcon24 五题验收与唯一切换

- 发布覆盖 9 表/70 字段、公式、Join、血缘、时间和异常规则的 Falcon24 Semantic Release。
- 建立 public/sealed 分离的 `falcon24-agent-analysis-suite@1` 与五个独立 Oracle。
- 完成五题 Web Agent E2E、安全 report/receipt/limitation projection、refresh/replay。
- 达到 5/5、generated Python=5/5、冷 3 次+暖 3 次、flake=0、无硬 HOLD。
- 将 miss/drift/Oracle failure 转为 Candidate，经 shadow+人审进入下一 Release。
- 运行旧符号/依赖扫描并删除所有旧路径；Neo4j/vector/sparse 删除后可从 PostgreSQL 重建。

## Validation matrix

- Contracts: build、unit、architecture boundary。
- Semantic: production/retrieval/inference/pruning golden、metamorphic、permission、frontier、degradation。
- Worker/Platform/Text2SQL: context/program binding、provider、repair、fence、idempotency、public projection。
- Sandbox: policy、attestation、timeout/OOM/cancel/malicious/zero-output、replay identity。
- Evals: public/sealed boundary、五个 Oracle、adversarial、cold/warm replay。
- Web: Test Center 和 Q&A 全 Agent browser acceptance。
- Git: `git diff --check`、显式 staging、`git diff --cached --check`、merge-tree overlap preflight。

## Commit boundaries

1. `refactor(semantic): establish unique context and program contracts`
2. `feat(semantic): publish governed semantic lifecycle`
3. `feat(semantic): compile bounded retrieval and inference context`
4. `feat(falcon): publish analysis semantics for db24`
5. `feat(analysis): execute DeepSeek generated Python programs`
6. `test(evals): certify Falcon24 agent analysis suite`
7. `chore(task): close Falcon24 semantic lifecycle acceptance`

## Rollback points

- 原子合同切换未通过完整门禁时不合并；已切换后只允许整体 Git/数据库迁移回滚。
- 索引故障在同一新编译器中使用 PostgreSQL 权威数据并记录 DEGRADED，不调用旧 resolver。
- Provider/Sandbox/Oracle 未通过时 AnalysisProgram 保持 HOLD，不用模板或旧 AnalysisPlan 代跑。
- 五题未达 5/5 时 Release 保持 HOLD，证据保留，任务不完成。
