# Falcon Agent Release Gate

> E1 接管（2026-08-27）：本规范后文的经典 Falcon threshold/batch 规则保留为历史 evaluator 规范，不是当前
> Falcon24 E1 激活条件。当前 E1 只接受 `E1-Q1` 的 G1–G4 16/16，随后接受 `E1-C1` 的 G5 30/30；每个 slot 必须从真实
> Q&A 提交进入 exact Run 轨迹并持久化同源 QA/Trace UI receipts。v12–v15 不能重跑、续接或计入 E1。

## E1 Gate Authority

- `E1-Q1` 和 `E1-C1` 是唯一正式 gate identity；每次执行另有不可复用的 UUID `attempt_id` 和内容寻址 manifest。
- PostgreSQL 只保留一个 current attempt。只有 `HOLD` current attempt 可被新 attempt 替换；替换前必须原样归档 parent snapshot
  与 16/30 个 slot snapshot。归档行禁止 UPDATE/DELETE，旧 attempt 不能 resume、overwrite 或贡献成绩。
- `E1-C1` 只能绑定同一 active baseline 下已达 16/16 的 winning qualification attempt；不得跨 qualification attempt 拼接。
- submit fence 必须同时闭合 exact gate、attempt、Run 和 one-shot claim token。Web 只消费一次 session-scoped browser claim，正常用户请求
  不接受隐藏兼容 identity。
- slot claim 前必须完成 authority、commit、Web build、runtime attestation、Effective Config 和真实 Q&A composer preflight。preflight
  失败不 claim slot、不创建正式 Run；claim 后任一层首败使整个 attempt `HOLD`。
- 成功 slot 必须同时提交同一 Run、baseline、activation、Web build 和 viewport 的 `QA_E2E` 与 `TRACE_UI` receipts；缺答案、表格、
  图表、报告、exact trace 交互或任一错误横幅都不能进入 `VERIFIED`。

## Authority Boundary

`FalconTeamRunner` 是 Falcon Agent 计分的唯一执行组合层。Web/CLI 只能创建或读取 batch；不能以
客户端状态、inline SQL probe、自然语言完成或 `SubmittedAnswerAgent` 直接获得正式模型 Verdict。

正式 case 必须闭合：

```text
PublicCase + PublishedPackage + CertifiedProfile
  -> ProviderInvocation
  -> normalized PostgreSQL candidate
  -> read-only executor
  -> sealed Oracle (DEV only)
  -> Team/Usage/Query evidence
```

## Dataset Isolation

- `DEMO`/`TUNING` 配方属于 evaluator-only 工具，只允许在真实 Provider 调用之后作为公开调优
  fallback。
- `LOCAL_HOLDOUT` 在 Oracle 前完成 blind reflection；禁止配方和 Oracle feedback 回流。
- `OFFICIAL_TEST_BLIND` 不加载 sealed Oracle，不产生本地 Verdict。
- Provider messages、public trace、report 与 reflection 中禁止 Gold、expected、sealed payload。

## PostgreSQL Compatibility

Falcon snapshot 保留大小写物理列。执行前使用 package schema 恢复双引号标识符；不能修改冻结
bundle。SQLite 兼容规则只能来自公开 DEMO/TUNING，并必须通过 case-set guard 拒绝 Holdout。

Oracle 数值比较尊重 expected 数字字符串声明的十进制精度；整数、文本、日期、NULL、重复行和
ordered/unordered 语义仍严格比较。

## Recovery

以下 batch checkpoint 规则仅描述历史 evaluator，不适用于 E1。E1 的正式 attempt 没有续跑语义：`HOLD` 后先退出 gate runner，
门禁外排障；若 baseline bytes 未变，以新 attempt 从 G1 或 G5 slot 1 全量重跑；若代码、合同、Web build 或 frozen component 改变，
必须进入 E2。

E5+ 同样采用 canonical epoch identity。若唯一 diagnostic 首败且修复会改变 frozen closure，当前 epoch立即 HOLD；只有新 successor epoch可继续。
若旧 diagnostic Run已 FAILED、但 terminal receipt因 authority adapter/transaction context缺陷未提交，禁止用新 build直接补写。恢复必须通过
前向 activation transaction调用唯一 diagnostic completion authority，并与 successor frozen closure同时切换；否则会产生“旧失败已改写、
successor尚未激活”的不可审计窗口。

- batch checkpoint 只把 `PASS` 和 `SUBMITTED` 当作完成；`FAIL`、`AGENT_FAILED` 和中断会续跑。
- `--run-label` 隔离稳定性批次；`--fresh=true` 显式忽略旧 checkpoint。
- blind reflection 的两个候选都必须在 Oracle 前冻结。若修订版不可执行而首选可执行，保留首选；
  不得用 Oracle 选择候选。

## Absolute Gate

最终 Artifact 必须由合同 builder 生成并验 hash。阈值固定为 DEV 309 terminal、first>=217、
final>=248、每库>=60%、DEMO 10/10、db14 32/32、db24 17/17、Holdout>=4/5、TEST 191/191，
并闭合 500 个 Team/Usage/Invocation evidence、17 个唯一 Report citation 和 cold restart flake=0。

## Verification Points

- Contracts：bundle/usage/final gate schema、hash、required set、绝对阈值。
- Evals：sealed Oracle、精度、配方 registry guard、方言兼容。
- Worker：blind pre-Oracle、candidate executable fallback、TEST unscored、final aggregation。
- PostgreSQL 17：fresh migration、28 schema、reader role、冷启动。
- Artifact：U17 hash、source digest、model receipt、submission hash、stability outcomes。

## Semantic Accuracy Companion

`falcon-semantic-accuracy-summary@1.0.0` 是 M1/M4 当前语义路径的内容寻址安全摘要，不替代上面的 Agent Release Gate，也不能从历史 Falcon GO 推断词法召回收益。

- B0_EXACT 与 B1_LEXICAL 必须绑定同一 source commit、fixed corpus 与 exact Published Release；outcome 总数必须闭合。
- B1 的 exact ready 不得低于 B0，READY 总数不得回退；ambiguity misselection、cross-release hit 与 unauthorized hit 必须为零。
- B2_GOVERNED_RETRIEVAL 在 M2 NO-GO 期间只能是 `DEFERRED / M2_GATE_NO_GO`，不能标记 PASS 或构造第三条运行时代码。
- Summary builder 重算 comparison 与 hash；未知字段、scope/workspace 换绑、计数不闭合、非零安全计数或 hash 漂移全部失败关闭。

## Scenario: Retained Epoch 不能证明新语义已发布

### 1. Scope / Trigger

- 当 Falcon E5+ Finalizer 与源码 semantic catalog/ChangeSet 同时变化时触发。
- 目的：防止把新 build 中的别名单测或 `terminal=ACTIVE` 误报成 active Semantic Release 已改变。

### 2. Signatures

- 输入环境：`FALCON24_AUTHORITY_EPOCH=E5+`、`FALCON24_STAGING_ID`、exact Web/Worker build identity。
- Finalizer 输出：`falcon24-authority-finalization-result@2.0.0.retained_semantic_authority`。
- 权威读回：`semantic.semantic_active_pointer -> semantic.semantic_source_release -> semantic.semantic_executable_projection.projection_payload`。

### 3. Contracts

- E5+ 是 retained-semantic rollover：Semantic Release ID/generation/digest 与三个 projection refs 必须保持 exact current。
- 源码 catalog 变化只影响未来 ChangeSet；没有新 successor release/readback，就不是已发布事实。
- 验收题可引用 active projection 的 exact aliases，并在 request scope 内解释口径；不能修改旧 release 或创建旁路 publisher。

### 4. Validation & Error Matrix

- Finalizer 返回 ACTIVE，但 projection aliases 与源码不同 -> 记录 `RETAINED_SEMANTIC_SOURCE_NOT_PUBLISHED` 边界，禁止宣称术语发布，暂停模型门禁。
- active release/ref/digest 在 retained rollover 后变化 -> `RETAINED_SEMANTIC_READBACK_MISMATCH`，失败关闭。
- 题面所需 Metric/Dimension 未被只读检索选中 -> 不提交 Provider Run，先改用 active exact term 或走受治理 successor。
- 试图原地更新 gen2 projection -> 禁止。

### 5. Good/Base/Bad Cases

- Good：回读 gen2 不变；题面引用其 exact aliases；零模型检索选中全部所需对象后再运行。
- Base：catalog 源码含未来别名，但报告明确它尚未发布。
- Bad：只凭 ChangeSet 单测与 E17 ACTIVE 声称新别名已进入 production read port。

### 6. Tests Required

- Finalizer 单测：E5+ 不调用 ChangeSet/compiler/publisher，readback refs exact retained。
- Scratch 集成：active executable projection aliases 与 Finalizer 返回 ref/digest 一致。
- Gate probe：Provider 调用前，以 exact conversation intent 只读编译并断言所需 Metric/Dimension 全部 selected；不把 probe 计为业务 PASS。

### 7. Wrong vs Correct

#### Wrong

```text
catalog test GREEN + E17 ACTIVE => 新别名已发布
```

#### Correct

```text
active projection readback 不含新别名 => E17 retained gen2
=> 使用 gen2 exact term 做 request-scoped 预检，或另走唯一受治理 successor
```
