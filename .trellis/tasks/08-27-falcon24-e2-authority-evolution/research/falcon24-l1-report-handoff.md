# Bug Analysis: L1-05 Report handoff protocol failure

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: L1-05 同时允许 Root 把 accepted table 直接格式化为答案或委派 Report Agent，但门禁又只接受精确的 Report Agent task。真实模型在这个分叉点连续生成非 JSON/错误 JSON，Report Tool Call 从未发生。

### 2. Why Fixes Failed (if applicable)

1. 仅依赖通用 Root JSON 提醒：它约束输出语法，但没有消除业务动作分叉，模型仍可能尝试直接回答。
2. 重试同一题面：第二次只改变了错误形态，未改变“直接回答或委派”的隐含选择，因此没有形成新的区分性证据。

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Documentation | 在 Agent Team 规范写明单一交接门禁必须显式指定专职 Agent，且不能转化为 Host Router | DONE |
| P0 | Test Coverage | 冻结 v1-v5，新增 v6 合同测试断言 L1-05 显式 Report Agent 且其余 Agent/rubric 不变 | DONE |
| P0 | Runtime proof | 新 commit/build/fresh scratch 从 L1-01 重跑，验证真实 native Report Tool Call、accepted input 和 Trace | TODO |
| P1 | Process | 题面降难只能改变版本化任务合同，不能放宽 Oracle、UI、Trace 或跨 attempt 合证 | DONE |

### 4. Systematic Expansion

- **Similar Issues**: 任何 expected Agent 为 EXACT、但题面同时允许 Root 自己完成的门禁题都可能出现相同分叉。
- **Design Improvement**: 把门禁所验证的唯一 handoff 写入自然语言任务合同；不在 Host 添加业务路由。
- **Process Improvement**: 协议失败重试一次后，先检查题面动作是否单义，再决定是否创建前向 manifest，禁止继续撞概率。

### 5. Knowledge Capture

- [x] 更新 `.trellis/spec/backend/agent-team-runtime.md`
- [x] 更新 Falcon24 PRD/design/implement
- [x] 新增 manifest v6 与 10821 前向迁移测试
- [ ] 真实 PostgreSQL 与 fresh formal attempt 完成后回填最终证据
