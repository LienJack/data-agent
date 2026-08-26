# 技术设计：Falcon24 Authority Epoch E1

## Authority boundary

E1 以一个 strict、content-addressed `falcon24-authority-baseline@1.0.0` 为根。Git/source
builder 先生成不含最终 commit 的 retained manifest；代码、migration、合同和 Web build 冻结后，
最终 fresh environment 再把 staging receipts、source commit 与 Web build 组成 runtime baseline，
由 PostgreSQL activation RPC 原子推进 `STAGED -> ACTIVE`。

Run 接收时冻结 `authority_epoch=E1`、baseline hash、Agent Cards、Semantic Release、Schema
Snapshot、Datasource、Model/Profile、Operator Registry 与 Sandbox image。Artifact 经已锁定的
Run 解析 Epoch，不接受 caller 自报 Epoch。Neo4j、索引、模型上下文和 UI 都只是可重建投影。

## Data and execution flow

```text
retained sources
  -> strict retained manifest + semantic diff
  -> fresh PostgreSQL + db24-only import
  -> new Semantic Release + new LLM/Profile + runtime attestation
  -> E1 Root V3 + frozen Agent Cards
  -> Text2SQL candidate + governed PostgreSQL execution
  -> SqlArtifact -> QueryEvidence -> typed Arrow
  -> model-authored AnalysisProgram
  -> governed operators + Binding Cell + Context Journal
  -> independent sealed Oracle
  -> one fenced PostgreSQL publication transaction
  -> E1-only Trace/Artifact Preview/Web receipts
  -> Sandbox/egress reclamation residual=0
```

Root 是唯一自然语言 Router；Host 只做 admission、权限、预算、安全和证据提交。Semantic、
Text2SQL、Governed Analysis 与 Report 的边界来自冻结 Agent Cards，不来自问题关键词。Evaluator
只在 Run 终态后验证，不向生产链注入 case-specific 计划。

## Failure and recovery

- baseline 未 ACTIVE 时，Run 创建前失败，零 provider/database/Sandbox I/O。
- Artifact、release、schema、datasource、profile、operator、image 或 Epoch 漂移均在 I/O 前失败。
- Context Journal 只重放已提交 deterministic obligation；已提交 operator result 不重跑。
- Oracle reject、stale fence、publisher crash 或 outbox failure 只能观察 all-old 或 all-new。
- 正式 attempt 首个 slot 失败即 HOLD，后续 slot 不 claim；修复在门禁外完成并创建新 attempt。
- frozen component 改变时进入下一 Epoch，不能替换 E1 baseline。

## Compatibility and retirement

不实现历史 backfill、archive reader、dual read/write 或隐藏 fallback。U8 以实际 production import
graph 和数据库 inventory 为证据退役 Direct QA、regex router、fixed query kind、Falcon case runtime
及旧 RPC/parser；仍被 E1 shared kernel 使用的对象保留，但 E1 runtime role 不再拥有旧入口。

## Security and privacy

sealed Oracle、gold SQL、raw provider payload、prompt、CoT、credentials、connection target、raw rows、
stdout 和临时路径不进入 public surface。LLM retained manifest 只允许无 userinfo/query/fragment 的
HTTPS base URL 和无敏感配置。所有持久化、公开投影、日志与浏览器 detail 使用 strict allowlist、
exact reference/hash 和稳定 reason code。

## Source of truth

本设计只给执行任务提供导航。发生细节冲突时，以已批准计划、`.trellis/spec/` 及固定合同/测试为准。
