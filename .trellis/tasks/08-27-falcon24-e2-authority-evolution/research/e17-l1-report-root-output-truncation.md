# Bug Analysis: L1-05 Root Tool Call 被 2048 输出硬上限截断

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract；D — Resource Boundary。
- v7 attempt `333ecf97-aae1-496b-ae68-6d0509725181` 的 L1-01～L1-04 已在同一 build/scratch 通过；L1-05 的 accepted
  table 也按 exact previous QueryEvidence seed 绑定，不是数据、Artifact 或 Report Profile 缺失。
- Run `f2937c92-55ed-8903-857d-5e69ae3cc3c4` 第一次 Root 调用返回完整非 JSON，既有有界反馈正确拒绝。第二次调用已生成
  `report-writing-agent` delegation 前缀，但参数在字段中间终止，最终 `ROOT_AGENT_TOOL_CALL_INVALID`。
- PostgreSQL provider authority 回读显示第二次 invocation 的 `reserved_output_tokens=2048` 且实际 `output_tokens=2048`；
  `run-bound-provider-dispatcher` 存在额外2048硬上限，而 Team runtime 已定义4096。

## 2. Why Earlier Task Clarification Was Insufficient

- manifest v6 已把 L1-05 明确成唯一 Report Agent 委派，v7 保留该题面；本轮第二次调用也确实选择了正确 Profile。
- 继续缩短题面不能消除 provider 在 hidden reasoning + Tool Call 达到硬上限时的结构截断，重跑同一 attempt 也违反一次性证据要求。
- Host 拼接残缺 JSON、补造 Tool Call 或把前四题 PASS 迁移到新 attempt 都会破坏权威链。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Budget alignment | Production Root ceiling 2048 → 4096，与 Team runtime 一致 | DONE |
| P0 | Effective bound | 继续取模型有效输出 ceiling 和 context headroom 的更小值 | DONE |
| P1 | Regression | 4000-token profile ceiling 必须原样进入 provider request | DONE |
| P1 | One-shot proof | 旧 Run/attempt immutable；新 commit/build/scratch/attempt 从 L1-01 重跑 | PENDING |

## 4. Scope Boundary

- 不改变 provider 调用次数、Root 四回合、Tool allowlist、Catalog admission、accepted Artifact 或答案 verifier。
- 不改变 v7 manifest、10822、Semantic/Text2SQL/Report Profile 或业务/QA/Trace rubric。
- 未闭合 Tool Call 仍失败关闭；4096 仍不足时只能保存新失败证据，不能补写响应。

## 5. Knowledge Capture

- [x] 更新 Agent runtime spec、PRD、design、implement。
- [x] 仓库无 `src/templates/markdown/spec/`，不创建影子模板。
- [x] Worker focused 2/2、typecheck/build、owned Biome、Trellis validate 与 diff check 通过。
- [ ] scoped commit 后从新 build/fresh physical scratch 启动 v7 正式15题单链路。
