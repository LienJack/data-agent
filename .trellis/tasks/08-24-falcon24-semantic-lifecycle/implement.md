# Implementation plan: Falcon24 语义生命周期唯一实现

## 执行状态

- [x] M0 固定基线、隔离 worktree、Falcon24 数据事实与 Semantica 固定快照。
- [x] 探索提交：Candidate/ChangeSet 与 hybrid retrieval 原型。它们是实现证据，不是最终合同；V3 包装必须删除。
- [x] M1 唯一合同与权威切换。
- [x] M2 语义生产工厂。
- [x] M3 多路召回与血缘扩展。
- [x] M4 逻辑推理与闭包裁剪。
- [ ] M5 DeepSeek Python Agent 与唯一 Result Publisher。
- [ ] M6 Falcon24 五题验收、反馈迭代与旧路径删除。
- [ ] Finish 全量检查、规范更新、提交、合并和 dirty-base 复验。

M5 当前已有固定模型调用、静态准入、OpenSandbox 双 Sandbox、治理算子和生产路由的实现基础；真实运行证明“分析成功但模型负责最终
文件工程”仍会失败。此前加入的强制输出 Cell、`open/json.dump` 提示和统一连续失败预算是待删除实验，不是完成证据。剩余工作必须先
建立 Result Publisher 边界，再进入真实 DeepSeek/Falcon 冷暖运行；缺少凭据或 Strict 能力认证时保持 HOLD。

RQ009 Governed Result Loop 已完成 19/20 条可重复故障门禁；逐条证据见 `rq009-acceptance.md`。剩余第 16 条的 Sandbox/egress 清零已通过，
但跨 run 过期 stage 的 U6 cleanup authority 尚未实现，因此 M5 仍保持 HOLD。DeepSeek Strict 0/100、Falcon24 0/30 和生产隔离也继续
保持外部硬 HOLD，不允许 fixture 或 fallback 冒充通过。

仓库级 `pnpm verify:release` 已在 2026-08-25 通过并返回 `GO / RELEASE_READY`；它证明构建、迁移清单和发布合同完整，不覆盖上述 RQ009、
Provider 与生产隔离门禁。本轮三类 OpenSandbox profile 实机均为 sandbox/egress `0→2→0`，测试 server 已停止，未被当前架构引用的
`data-agent-opensandbox-m0:2026-08-24` 镜像已删除；CORE/ML/CAUSAL/Operator 镜像是唯一运行时的有效依赖，继续保留。

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

## M5 DeepSeek Python Agent 与 Governed Result Bridge

- 固定 `deepseek-v4-flash` 的 `AnalysisProgramSourcePort`，只接收 bounded semantic/schema/evidence。
- 每题至少一个真实 `MODEL_GENERATED` Python 节点；Arrow/Parquet 输入，无 DSN/凭据/全量原始行。
- 完成 AST admission、固定 runtime/lock/seed、无网络 sandbox、资源预算、zero partial commit。
- 编译唯一 `AnalysisResultContract@1`，实现唯一 `publish_analysis_result@1` 与 server-owned Result Publisher；模型只引用白名单 Python
  symbol 和 chart template binding，不序列化最终 JSON/表格/图片，不写输出路径。
- Result Publisher 完成安全提取、类型归一、语义/Schema/Operator binding、确定性 table/chart、hash 和不可变暂存；独立 Oracle 接受后才
  原子提交完整闭包，Publisher 不得改变业务数值。
- 把开放 Tool Loop 改为穷尽状态机与分类修复预算；删除 `declared_output_names`、直接 `/workspace/outputs`、旧 output reader/publisher、
  强制最终 Cell 和统一连续失败预算，不保留兼容或双写。
- 从单一 Tool Manifest 生成服务端 Zod validator 与 DeepSeek Strict 投影；完成实际模型/endpoint 100 次探测，100/100 前保持 HOLD。
- OpenSandbox metadata 固定 `managed-by/run-id/node-id/role`；finally 经 Lifecycle API 删除并验零，加入启动/定时孤儿扫描和清理故障码。
- 定义唯一 `GovernedOperatorResultRef@1`、`ContextJournalEntry@1`、`AnalysisResultStage@1`、`AnalysisAuthorityCommit@1`，冻结 canonical bytes、
  幂等 identity、worker fence、hash chain、状态迁移和分层错误码。
- Operator 完成后先把 canonical result/receipt 持久化到 PostgreSQL result ledger，再由宿主固定 Binding Cell 绑定
  `__da_gov_<digest>`；模型只接收 symbol/hash/shape/receipt ref，删除 full output 与 sealed/temp path 投影。
- PostgreSQL Journal 按 seq 重放 `MODEL_CELL_COMMITTED` 与 `SERVER_BINDING_COMMITTED`；已提交结果从 ledger 重绑，禁止重跑算子。
- 以 `PostgresAnalysisResultStageAuthority` 直接替换内存 `createSingleStagePort()`；stage 后 freeze/delete Context，Oracle/Explanation 只读 stage。
- 最终窄 RPC 在单事务内验证 stage/publisher/operator/oracle/explanation/fence 并提交 artifact/current/receipt/outbox，故障只能 all-old/all-new。
- 完成 RQ009 的 20 条 crash/篡改/幂等/容量/旧路径/原子提交故障注入；任何一条未通过保持 HOLD。

## M6 Falcon24 五题验收与唯一切换

- 发布覆盖 9 表/70 字段、公式、Join、血缘、时间和异常规则的 Falcon24 Semantic Release。
- 建立 public/sealed 分离的唯一当前 `falcon24-agent-analysis-suite@2` 与五个独立 Oracle；旧 suite/oracle/run/gate shape 直接删除。
- 对五题 Oracle 已接受输出执行唯一 `falcon24-analysis-chart@1` 确定性投影，提交 V3 Chart Artifact，并把唯一 chart ref 注入完成事件与最终回答。
- 完成五题 Web Agent E2E、安全 report/receipt/limitation/chart projection、refresh/replay。
- 达到 5/5、generated Python=5/5、chart=30/30、冷 3 次+暖 3 次、result/chart dataset flake=0、无硬 HOLD。
- 将 miss/drift/Oracle failure 转为 Candidate，经 shadow+人审进入下一 Release。
- 运行旧符号/依赖扫描并删除所有旧路径；Neo4j/vector/sparse 删除后可从 PostgreSQL 重建。

## Validation matrix

- Contracts: build、unit、architecture boundary。
- Semantic: production/retrieval/inference/pruning golden、metamorphic、permission、frontier、degradation。
- Worker/Platform/Text2SQL: context/program binding、provider、repair、fence、idempotency、public projection。
- Sandbox: policy、attestation、timeout/OOM/cancel/malicious/zero-output、replay identity。
- Publisher: 不少于 1,000 个属性测试案例、symbol/type/size/NaN/date/Decimal/DataFrame 边界、每个错误码故障注入、原子提交失败零输出。
- Provider: 单一 Manifest 投影、DeepSeek Strict 真实 100/100 认证、非法 Tool/Publish 一次修复、无非 Strict fallback。
- Lifecycle: 每 Run OpenSandbox API `before=0、peak<=2、after=0`，egress sidecar 归零，Worker 重启孤儿扫描。
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
