# Semantic Layer Studio Delivery

## Goal

在现有 PostgreSQL 语义治理控制面之上，分阶段交付可展示、可从数据库结构发现、可由
Agent 编写指标和公式、且只能经确定性验证与人工审批发布的 Semantic Layer Studio。

用户价值是让业务语义从“隐藏在代码、SQL 和人工记忆里”变成可见、可编辑、可审计、
可回滚并能被 Query Runtime 精确引用的产品能力。

## Background and Confirmed Facts

- 产品路线图已由用户批准为执行来源：
  `docs/plans/2026-08-08-001-semantic-layer-studio-roadmap.md`。
- 当前代码已有语义对象合同、Candidate 状态机、Validation Receipt、U5 编译器以及
  10610 PostgreSQL Candidate/Review/Publish/Rollback 表和 RPC。
- 当前 `/semantic` 页面主要是 Review Workspace，不是完整 Studio。
- 当前 PostgreSQL Web Service 仍存在 Mock 默认、随机 digest、硬编码 principal、空
  revision diff、调用方 scope 等权威缺口。
- 当前工作区包含 DataFoundry 与 datasource/data-link 的既有未提交修改；本任务必须
  保留这些修改并对重叠文件执行逐文件 diff 审查。

## Requirements

### R1 — Governed authority

PostgreSQL 必须是 Source Revision、Candidate、Review、Release、Active Pointer、Outbox
和 Rollback 的唯一写权威。Agent、UI、缓存和图视图只能创建候选或读取投影。

### R2 — Semantic Layer Studio

Studio 必须提供 Explorer、Builder、Govern 三种工作面，并展示业务对象、指标、维度、
公式、关系、物理绑定、活动版本、候选 diff 与 lineage。

### R3 — Schema discovery

系统必须以只读权限扫描 PostgreSQL catalog，生成内容寻址的
`PhysicalSchemaSnapshot` 与 `SchemaDriftEvent`。物理事实不能自动升级为业务事实。

### R4 — AI-generated candidates

AI 可从 schema snapshot、当前 release 和已有元数据生成带 evidence、confidence、
assumption 和 impact 的 `SemanticChangeProposal`，但不能审批、发布或回滚。

### R5 — Metric Authoring Agent

用户输入指标和公式后，Agent 必须澄清 grain、unit、time、filter、null、fanout 和
dependency，生成 Formula AST，并通过确定性 compiler/validator 后提交 Candidate。

### R6 — Runtime closure

只有活动 `SemanticRelease` 可进入 Query Grounding。每个 Query Run 必须冻结 exact
semantic/schema/policy identity；发布、回滚和旧 Run 重放不能产生版本漂移。

### R7 — Incremental delivery

按 M0→M1→M2→M3→M4→M5 顺序交付。M6 的多引擎和外部图数据库只有在可重复 benchmark
证明必要时才准入。

## Acceptance Criteria

- [ ] M0：非 Demo 路径 fail-closed 使用 PostgreSQL Authority，不存在随机或占位 identity/digest。
- [ ] M1：PostgreSQL 只读 schema snapshot 与 drift fixture 闭合，扫描 zero-write。
- [ ] M2：Explorer 的 tree/table/graph/detail/diff/lineage 对同一 active release identity 一致。
- [ ] M3：Schema-to-semantic 只生成候选；未审批内容不会出现在 runtime grounding。
- [ ] M4：Metric Agent 的合法 allowlist 案例通过，歧义、unit/grain/cycle/fanout/authorization 负例失败关闭。
- [ ] M5：发布、并发 CAS、stale approval、roll-forward rollback 和 Query Run exact release E2E 闭合。
- [ ] 每个里程碑都有独立 Trellis 子任务、实现证据、自动测试、回滚点和边界说明。
- [ ] 任何提交只包含本任务文件，不吸收工作区既有无关修改。

## Out of Scope

- AI 直接执行 DDL、写业务库、审批、发布、回滚或修改 reviewer policy。
- 首版 Neo4j 双权威、非 PostgreSQL connector 和任意 SQL/Python 指标公式。
- 把外键、列名或图路径冒充业务事实、安全分析 Join、贡献或因果证明。
- 在 M5 完成前宣称 Studio 的候选已经被 Query Runtime 消费。

## Technical Notes

- 父任务只拥有总目标、依赖顺序和最终集成 Gate，不直接承载大范围实现。
- 当前实现目标是子任务 `08-08-semantic-layer-m0-authority-safety`。
- 后续里程碑在前一 Gate 完成后分别创建子任务，避免一次改动跨越全部 12–15 周范围。
