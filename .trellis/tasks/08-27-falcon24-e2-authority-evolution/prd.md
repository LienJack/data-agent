# Falcon24 E2 Authority Evolution

## Goal

保留已激活的 E1 baseline、两次正式 `E1-Q1` HOLD attempt、失败 Run、Artifact 和安全诊断证据，
把当前只接受 E1 literal 的 Falcon24 Authority 实现演进为可验证的 E2。E2 必须绑定修复后的代码、
Tool Contract、Web build 与全部冻结资产，以 `E2-Q1` 从 G1 重新执行 16/16；只有资格全胜后才允许
`E2-C1` 执行 30/30。任何 E1 行不得被覆盖、伪造为 E2 或计入 E2 成绩。

## Background

- E1 已在 PostgreSQL 中激活并产生正式 HOLD，首败依次暴露了 Provider credential 与 Root 批内依赖缺陷。
- 修复提交 `0a991d44` 改变了 Root native Tool schema 和代码闭包；原计划明确要求激活后的 code、contract、
  Web build 或 frozen component 变化进入下一 Authority Epoch，禁止创建 `E1-Q2`。
- 当前实现仍在 23 个生产源码、3 组 migration 和 28 个测试文件中把 `E1`、`E1-Q1`、`E1-C1`
  写成 literal；只替换展示文案无法形成 E2 authority closure。
- PostgreSQL 继续是 baseline、current pointer、Run、Artifact、gate attempt、HOLD、UI receipt 与 outbox 的唯一权威。

## Requirements

- **R-E2-01 历史不可变。** E1 baseline/document/hash、activation attempt、gate attempt/slot snapshot、Run、Artifact、
  Trace 和 UI receipt 保持原 identity 与 bytes；E2 激活不得 UPDATE/DELETE E1 事实。E1 可以不再 current，但仍保持
  “曾激活”的历史状态。
- **R-E2-02 版本化合同。** 保留 E1 v1 decoder，新增明确版本的 generic Epoch/baseline/staging/activation/gate/UI
  合同；Authority Epoch 只接受规范 `E[1-9][0-9]*`，Qualification/Campaign ID 必须由同一 Epoch 严格派生为
  `<epoch>-Q1` / `<epoch>-C1`。拒绝 `E0`、`E01`、`E2-Q2`、跨 Epoch gate 和未知字段。
- **R-E2-03 单一 current pointer。** Baseline 历史允许每个 Epoch 恰好一个已激活 baseline；整个 Scope 仍只有一个
  current pointer。E2 activation 必须在同一 PostgreSQL 事务内锁定 E1 current、验证 E2 完整 staging closure、
  激活 E2 并推进 pointer；失败时 pointer 仍为 E1，不能观察部分 E2。
- **R-E2-04 前向迁移。** 新 migration 必须支持含 E1 HOLD/Run/Artifact/UI receipt 的 PostgreSQL 17 数据库原位升级，
  通过 rename/constraint/RPC 演进形成一套 generic authority truth，不复制第二套 E2 真值表。Fresh migration chain
  也必须成功，但正式 E2 activation 在保留真实 E1 predecessor 的升级数据库执行。
- **R-E2-05 运行时从权威解析 Epoch。** Platform、Worker、Web、Trace 和 CLI 不再凭源码 literal 推断 E1；创建 Run、
  Effective Config、Artifact、Root 决策、Trace、UI receipt 与 gate fence 时必须从同一事务/Run binding 传播 exact
  current Epoch/baseline/activation/attempt。Root prompt 使用当前 Epoch 或中性描述，不把 E2 Run 称为 E1。
- **R-E2-06 Gate 隔离。** 开始 `E2-Q1` 前原样归档 current `E1-Q1` HOLD 与 16 个 slot snapshot；E2 attempt number、
  UUID 和 manifest 独立。E2-C1 只绑定同一 E2 baseline 下 16/16 的 winning E2 qualification，禁止引用 E1 PASS/HOLD。
- **R-E2-07 唯一生产链。** E2 继续只走
  `Root -> Text2SQL -> QueryEvidence -> typed Arrow -> Governed Analysis -> Oracle -> Publisher -> Trace/UI -> Reclamation`；
  不恢复 Direct QA、regex router、case/query-kind SQL 或 evaluator runtime 回流。
- **R-E2-08 安全公开面。** Trace/UI 只接受 exact E1 或 E2 versioned binding；历史 E1 可读，E2 不得回查 current Profile
  冒充历史 identity。Provider raw output、prompt、credentials、raw rows、sealed payload/path 和 private reasoning 不进入事件、
  Trace、Artifact preview 或规划证据。
- **R-E2-09 生产隔离如实。** 当前 OpenSandbox 只能证明 local functional closure；当
  `production_isolation_proven=false` 时 E2 baseline 继续 `production_gate=HOLD`。功能门禁全胜不得被描述为生产 GO。
- **R-E2-10 失败后演进。** E2 gate 使用 strict zero retry；slot claim 后首败使 attempt HOLD。若后续修复再次改变 frozen
  closure，则进入 E3，不能覆盖 E2 或创建 `E2-Q2`。

## Acceptance Criteria

- [ ] **AC-E2-01** E1 升级前后逐表行数、E1 identity/hash/document 与归档 slot snapshot 完全一致；migration 无 DELETE，
  无第二套 E2 authority/current 表。
- [ ] **AC-E2-02** Contract tests 同时证明 E1 v1 历史解码与 E2 v2 构建；malformed/cross-Epoch identity 全部 fail closed。
- [ ] **AC-E2-03** PostgreSQL 并发测试证明 E2 activation all-old/all-new、单一 current pointer、每 Epoch 单一 activated baseline，
  且 stale E1/E2 activation/gate fence 在 I/O 前拒绝。
- [ ] **AC-E2-04** PostgreSQL 17 fresh migration smoke 与“真实 E1 HOLD fixture -> E2”升级 smoke 均通过；迁移 ledger、
  grants、RLS、immutability trigger 与 rollback 证明闭合。
- [ ] **AC-E2-05** 生产 import graph 仍无 Direct QA、regex router、fixed query kind、模板 SQL、Falcon case runtime 或第二 evaluator executor。
- [ ] **AC-E2-06** E2 baseline 内容寻址地绑定 exact source commit、Web/Worker build、db24 import、Semantic Release、Model/Profile、
  Root Tool schema、Operator/Sandbox 和 acceptance contract；任何 byte 漂移改变 baseline hash。
- [ ] **AC-E2-07** `E2-Q1` 在单一 immutable attempt 中依次达到 G1 1/1、G2 5/5、G3 5/5、G4 5/5；每个 slot 有真实浏览器
  QA submit、从答案进入 exact Trace、同源 QA/Trace receipts、表格/图表/报告和 residual=0。
- [ ] **AC-E2-08** 只有 AC-E2-07 成立后才创建 `E2-C1`，并在单一 immutable attempt 中完成 30/30；不得拼接 attempt 或复用资格 Run。
- [ ] **AC-E2-09** Contracts、Platform、Agent Runtime、Worker、Web 的 focused/full tests、typecheck/build、migration inventory、
  browser gate 和安全扫描通过；所有任务文件变更按 scoped commit 提交。
- [ ] **AC-E2-10** 最终报告分别列出 E1 HOLD 历史、E2 winning identities、16/16、30/30、source/build/baseline hashes、
  证据清单和 `production_gate=HOLD` 的隔离声明，不把 local functional PASS 误报为 production GO。

## Out of Scope

- 删除、重写、压缩或把 E1 历史迁移到新 identity。
- 创建 `E1-Q2`、`E2-Q2` 或复用旧 v12-v15/E1 分数。
- 为通过 Falcon24 恢复 case-specific SQL/Python、第二 evaluator executor 或隐藏 compatibility shim。
- 在本任务内伪造 production isolation receipt、发布生产环境或变更外部 OpenSandbox 基础设施。
- 为未来所有 Epoch 预建无限抽象；只建立 E1 历史兼容、E2 current 和可验证的顺序演进不变量。

## Notes

- 父任务：`.trellis/tasks/08-26-falcon24-e1-authority-reset`。
- 权威计划：`docs/plans/2026-08-26-001-refactor-falcon24-e1-authority-reset-plan.md`，尤其是激活后变更、HOLD recovery 和 E2 规则。
- 当前实现分支：`codex/falcon24-e1-authority-reset`；root checkout 与历史审计数据库保持不动。
