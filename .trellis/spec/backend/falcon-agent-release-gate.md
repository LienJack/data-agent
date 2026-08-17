# Falcon Agent Release Gate

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
