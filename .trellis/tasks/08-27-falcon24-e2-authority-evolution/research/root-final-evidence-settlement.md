# Bug Analysis: 最后一次委派的最终证据没有收敛机会

## 1. Root Cause Category

- **Category**: E — Implicit Assumption；D — Test Coverage Gap。
- 四层设计允许 Semantic → Text2SQL → Analysis → Report 四次串行委派。正常 Root 决策上限为四次，原循环却在
  第四次委派完成后立即保存 `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`，没有机会调用已有的确定性最终证据逻辑。
- 这不是正式 Run 失败后重试得到的结论；在 E12 失败后的独立静态审计中发现，并用无模型回归稳定复现。

## 2. Why Fixes Failed

- 首次修复此缺陷。原测试只证明三次委派后由第四次 Root 决策结束，没有覆盖第四次委派本身产出最终证据。
- 新增四组测试在旧代码上 3 failed / 11 passed：最终表格、最终报告及 verifier 拒绝路径都被预算耗尽提前覆盖。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | 复用同一纯最终证据生成器，并仍交既有 answer verifier 验收 | DONE |
| P0 | Recovery | 最后工具结果 checkpoint 与答案验收 checkpoint 分开，恢复不重跑工具 | DONE |
| P0 | Budget | 不改变 `max_root_turns=4`、Provider 请求格式或任何调用上限 | DONE |
| P1 | Tests | 表格/报告 final、continuation 耗尽、verifier 拒绝、checkpoint 与终态 replay | DONE |

## 4. Systematic Expansion

- Semantic、QueryEvidence、AnalysisReport 的正常 Root 自动结束与预算边界收敛复用同一生成器；不复制新的完成规则。
- 生成器只选择已验收 final-usage Artifact；它既不选后续 Profile，也不解析问题关键词，不绕过 acceptance/lineage verifier。
- 四层真实业务仍须新构建 canary 和 fresh epoch/attempt。此处测试不等于业务问答或 UI 通过。

## 5. Knowledge Capture

- [x] 更新 `.trellis/spec/backend/agent-team-runtime.md` 的模型决策预算与确定性收敛边界。
- [x] 当前仓库无对应 `src/templates/markdown/spec/`，不创建影子规范。
- [x] 38 项相关 Worker 测试、Worker typecheck 通过；包含保持预算耗尽语义的既有回归。
