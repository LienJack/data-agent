# 实施计划：Falcon24 Authority Epoch E1

详细文件清单、测试矩阵和门禁定义见
`docs/plans/2026-08-26-001-refactor-falcon24-e1-authority-reset-plan.md`。

## U1 - Retained Asset Bundle

- [x] 定义 baseline strict contract、hash builder 与安全投影。
- [x] 构建 db24 active subset、五题、语义、LLM、Operator/Sandbox、Oracle manifest。
- [x] 只读导出并解决 Published Release/source canonical diff。
- [x] 运行 Contracts/build/verify tests 并创建 U1 scoped commit。

## U2 - PostgreSQL E1 Authority

- [x] 先验证 migration frontier，再创建 10775 source/manifest/rendered migration。
- [x] 实现 Epoch/baseline/staging/gate authority、Run binding 与空运行面 preflight。
- [x] 运行 renderer/inventory、Contracts/Platform tests 和 PostgreSQL 17 smoke。
- [x] 创建 U2 scoped commit。

## U3 - Fresh Bootstrap

- [x] 实现 db24-only importer 与互斥 import mode。
- [x] 实现 Semantic Release、LLM/Profile、Operator/Sandbox staging bootstrap。
- [x] 在 disposable fresh environment 演练恢复；保持 E1 未激活。
- [x] 运行聚焦 tests/build/smoke 并创建 U3 scoped commit。

## U4 - Root V3 Only Router

- [x] 收敛 E1 Root、Agent Cards、provider AUTO tool choice 与 frozen admission。
- [x] 删除生产 Direct QA、regex/classifier、fixed query kind/template SQL、case resolver 引用。
- [x] 覆盖 direct/Semantic/Text2SQL/Analysis/Report/recovery/import-boundary tests。
- [x] 创建 U4 scoped commit。

## U5 - QueryEvidence and typed Arrow

- [ ] 关闭 exact semantic/schema/datasource column binding。
- [ ] 从 accepted QueryEvidence 唯一物化 bounded typed Arrow/input receipt。
- [ ] 覆盖五题通用数据形状与 tamper/replay tests。
- [ ] 创建 U5 scoped commit。

## U9 - Governed Analysis and Atomic Publisher

- [ ] 实现通用 AnalysisProgram、Operator obligations、Binding/Journal recovery。
- [ ] 接入独立 Oracle 与单事务 publication bundle（10776）。
- [ ] 覆盖 crash/fence/hash/privacy/reclamation/property tests。
- [ ] 创建 U9 scoped commit。

## U6 - E1 Trace and UI Gate

- [ ] 实现 E1-only trace/detail/preview（10777），拒绝旧 Epoch/fallback。
- [ ] 修复 Conversation/Run 切换 stale async state。
- [ ] 实现从真实问答到 exact trace 的 QA/Trace UI receipts。
- [ ] 运行 Web unit/typecheck/build 与 1440px/390px browser tests。
- [ ] 创建 U6 scoped commit。

## U8 - Legacy Retirement

- [ ] 用 production import graph/public export/database inventory 确认删除范围。
- [ ] 退役旧 runtime、RPC、parser 和无消费者空表（10778）。
- [ ] 更新旧 task 历史说明、Trellis specs 与 E1 runbook。
- [ ] 运行全包/architecture/migration/fresh smoke 并创建 U8 scoped commit。

## U7-A - Qualification and Campaign implementation

- [ ] 实现 immutable attempt、preflight、G1-G5 slot policy、atomic HOLD 与 UI/reclamation receipts（10779 或验证后的实际 frontier）。
- [ ] 覆盖 16/16 前禁止 G5、首败停止、不可 resume、跨 attempt 禁止拼接。
- [ ] 重跑 production import boundary、全包测试/typecheck/build/migration smoke。
- [ ] 创建并冻结 implementation commit 与 Web build；此后 E1 代码/合同/frozen asset 不再变化。

## U7-B - Final activation and formal gates

- [ ] 新 clean volume 重放完整 migrations、db24 bootstrap 与最终 Product Profiles。
- [ ] 构建 runtime baseline candidate 并原子激活 E1。
- [ ] 在门禁外按 L1-L6 完成 preflight fault isolation。
- [ ] 串行执行 `E1-Q1` G1-G4 16/16；任一失败立即 HOLD 并退出。
- [ ] 资格通过后串行执行 `E1-C1` G5 30/30；任一失败立即 HOLD 并退出。
- [ ] 验证全部 46 个 slot 的 exact QA/Trace UI receipts、Artifact/图表/同源表格和 residual=0。
- [ ] 写最终验收报告，明确 local/dev 与 production isolation readiness 的边界。
- [ ] 完成 Trellis check/spec update、final scoped commit 和 finish-work。
