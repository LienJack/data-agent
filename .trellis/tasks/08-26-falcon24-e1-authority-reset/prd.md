# Falcon24 E1 Authority Reset 与 Root Agent 生产链重建

## Goal

按已批准计划 `docs/plans/2026-08-26-001-refactor-falcon24-e1-authority-reset-plan.md`
建立全新的 Falcon24 `Authority Epoch E1`。E1 只保留六类定义性资产，不迁移历史 Agent
运行记录、Artifact、Trace、Qualification 或 Campaign，并在空运行面上重建唯一的
`Root -> Text2SQL -> QueryEvidence -> Governed Analysis -> Oracle -> Publisher -> Trace/UI`
生产链。

## Requirements

- E1 baseline 必须内容寻址地绑定 db24 数据、五题、语义、无敏感 LLM 配置、Operator/Sandbox、
  验收合同、冻结代码提交与 Web build；缺失任何组件不得激活。
- PostgreSQL 是 Epoch、Run、Artifact、Attempt、HOLD、Outbox 与 current pointer 的唯一权威；
  E1 只允许在历史运行状态为零的 fresh database 上激活。
- 定义资产保留 canonical bytes/hash，Release、Profile、Receipt、Run、Artifact 与 Campaign
  identity 全部重生；旧 identity 输入必须在 I/O 前失败关闭。
- `QUESTION_RUN` 只走 Root V3；Host 不按关键词、正则、case ID 或 `query_kind` 路由。
- 五题只走同一通用生产链；Evaluator 不得注入生产 SQL、AnalysisProgram、Python 或答案。
- accepted QueryEvidence 必须带 exact Semantic Release/schema/datasource/column binding，并稳定物化
  为 typed Arrow；不得从列类型猜业务语义。
- Governed Analysis 使用固定 Operator Registry、Context Journal、Binding Cell 和独立 Oracle；
  PASS 后由一个 fenced PostgreSQL 事务原子发布完整 bundle。
- Web/Trace 只接受 E1 exact reference/hash，无旧 lookup、latest-by-id、raw payload/path fallback。
- 正式门禁与排障分离：`E1-Q1` 完成 G1-G4 16/16 后，`E1-C1` 才可执行 G5 30/30；
  每个 slot 都必须从真实问答页面进入 exact Run 轨迹并产生同源 UI receipts。
- local/dev 功能验收不得被描述为 production isolation GO；当
  `production_isolation_proven=false` 时必须保持 production HOLD。
- 按 U1、U2、U3、U4、U5、U9、U6、U8、U7-A、U7-B 的依赖顺序实施，每个独立工作包
  完成聚焦验证后创建 scoped commit。

## Acceptance Criteria

- [ ] retained manifest 可重复构建，只含六类资产且无秘密、旧 runtime identity 或旧 receipt。
- [ ] fresh PostgreSQL 中历史运行面为零，且只导入与核验 `falcon_db_24`。
- [ ] E1 Semantic Release、LLM/Profile、Operator/Sandbox staging receipt 全部闭合并使用新 identity。
- [ ] 生产 import graph 无 Direct QA、正则 Router、fixed query kind、模板 SQL、Falcon case runtime
  或第二 evaluator executor。
- [ ] 五题均通过唯一 Root/Text2SQL/Analysis/Oracle/Publisher/UI/Reclamation 链。
- [ ] G1-G4 分别达到 1/1、5/5、5/5、5/5，G5 达到 30/30，且每个正式 slot 有 exact
  QA/Trace UI receipts、可用 Artifact/图表/同源表格和 residual=0 证明。
- [ ] Contracts、Platform、Worker、Web 的 focused test、typecheck/build、migration renderer/inventory、
  PostgreSQL 17 fresh smoke 与浏览器门禁通过。
- [ ] 最终验收报告记录 E1 identity、16/16、30/30、环境隔离声明和完整证据清单。

## Notes

- 权威详细计划：`docs/plans/2026-08-26-001-refactor-falcon24-e1-authority-reset-plan.md`。
- 源暂停 worktree 只读保留；本任务在 `codex/falcon24-e1-authority-reset` 隔离 worktree 实施。
- 当前数据库、暂停 worktree 的未提交 `10775`-`10777`、本地 `.data/` 和历史验收 Artifact
  均不进入本任务分支。
