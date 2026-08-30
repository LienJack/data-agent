# Bug Analysis: Semantic continuation 被宿主提前终结

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract；D — Test Coverage Gap。
- E12 attempt `94cd5014-e6a1-4da5-a491-865e760fb9cf` 的 L2-02 Run
  `e0fa0832-8eb0-8516-be9e-753a27299108` 请求渠道投入/收入/ROAS 对比表，却只返回定义。
- 持久化 checkpoint 1 保留首次 Semantic `MODEL_STREAM_PROTOCOL_VIOLATION`；checkpoint 2 中恢复后的
  Semantic observation 仍为 `output_usage=CONTINUATION_INPUT`，其专职 Context 为 `SEMANTIC_FACTS_ONLY`。
  Root 的继续执行约定没有丢失；`terminalSemanticFactsDecision` 漏查 usage，直接生成了最终回答。
- 专职任务的回答范围不等于整个用户请求的完成条件。不能通过关键词识别或改写已验收 Context 来修补。

## 2. Why Fixes Failed

- 这是该具体缺陷的首次修复。既有 QueryEvidence/AnalysisReport 已检查 usage，Semantic 快捷终止路径遗漏了同一条件。
- 原测试只覆盖 Semantic 的 final usage；Report 的 continuation 覆盖不能证明 Semantic 同样正确。
- 回归先在原代码上稳定失败：7 tests 中两组 Semantic continuation 失败，错误地收到 `ok=true` 最终回答。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | Semantic 自动终止同时要求 final usage 与 semantic-only scope | DONE |
| P0 | Test coverage | Semantic/Report usage 笛卡尔组合，保留前序失败观察，检查后续 Root 调用 | DONE |
| P1 | Documentation | 更新 Agent runtime 的双层完成契约和恢复要求 | DONE |

## 4. Systematic Expansion

- 已检查 QueryEvidence 与 AnalysisReport 自动完成路径：它们已检查 final usage，没有扩大本修复。
- 发现另一独立风险：四个正常 Root turn 都用于串行委派时，最后的已验收结果可能在预算判断处直接失败；
  必须单独做确定性回归，不在本次改动中放宽模型预算。
- E12 失败业务收据 `sha256:1937ff15960a4368cf89167e147f98d71eeecbdcdf8d6404fe24f3abd40acc6c`、
  turn 收据 `sha256:0bb802d462cfca7538df7df85fd46237bb5b8be586c7bccbe26b35a950783add` 保持不可变。
  failure=`AGENT_CONTRACT_MISMATCH`，该题 QA/Trace 均未执行；不能重跑它或拼接六题通过前缀。

## 5. Knowledge Capture

- [x] 更新 `.trellis/spec/backend/agent-team-runtime.md`。
- [x] 当前仓库不存在 `src/templates/markdown/spec/`，不创建第二套无消费者的规范副本。
- [x] 聚焦回归通过；Worker typecheck、owned-file Biome 与 Trellis context validate 通过。
- [ ] 新 clean build + scratch canary + fresh epoch/attempt 后重跑全部 15 题；不是本次 unit 修复的通过声明。
