# Bug Analysis: Root AUTO 最终答案的文本闭包

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract；C — Change Propagation Failure；D — Test Coverage Gap。
- 正式 E13 attempt `c31efada-c780-43dc-8151-e8167db5af9e`，首题 Run
  `8ef759dc-cbd8-8132-8df3-a8ba87e6ac16` FAILED/49 events。Semantic 已验收，但 Root 后续产生两次
  placeholder/no-op Text2SQL native 调用，分别在 context budget/formula binding 失败，最终 Provider outcome unknown。
  后续 14 题没有 Run；失败 attempt 不重试，服务/browser 停止。production isolation=false/HOLD。
- 只读 checkpoint 对照 E12 ROAS Run `e0fa0832-8eb0-8516-be9e-753a27299108`：二者均为
  `CONTINUATION_INPUT + SEMANTIC_FACTS_ONLY`。前者只问口径，后者要求渠道数据表；仅这两个字段无法区分完整用户意图。
  证据索引：formal-e13-bb23f0bb-c31efada/runtime/e13-root-contract-comparison.json（不复制私有模型文本）。
- 已确定的实现缺陷：AUTO 有工具时不启用 Mastra structuredOutput；无工具返回值只有 text，结束分支却仍验证 object。
  原代码对合法 JSON 也返回 MODEL_STREAM_PROTOCOL_VIOLATION。Pinned Mastra + offline AI SDK 模型已稳定复现。
- Root prompt 只给最终答案的 `sections:[...]` 框架，没有像工具那样提供完整可执行 Schema；usage 还可能被理解为
  为假想未来数据请求预留工作。补齐明确当前请求约束和 schema，而不让 Host 解析自然语言。

## 2. Why Fixes Failed

1. E12 的提前收敛修复正确保留 continuation，却揭露原 AUTO no-tool 的未覆盖分支；不能回退该修复。
2. 原集成只断言 AUTO native tool 的 toolChoice，没有验证 AUTO no-tool 的真实 Mastra 输出形态。
3. 新增七项测试在旧代码上 1 failed/6 passed：只有合法 JSON 错误失败；非法形状原本失败不代表正向路径可用。
4. Prompt schema 对齐测试先 RED，再由实际 Zod Schema 派生后 GREEN，避免手写平行结构。

置信边界：text/object 缺陷由源码与离线复现确认；无法仅凭持久化 UNKNOWN 证明最后一次 E13 Provider 失败一定由它导致。
也不能把 prompt 改进等同于真实模型稳定性，须 fresh scratch 双反例验证。未改变未知调用的 replay 安全策略。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | AUTO no-tool 严格 JSON.parse，再用原注册 Schema 验证；不剥离 prose/fence | DONE |
| P0 | Authority | 保留 continuation/answer_scope 双条件；下一轮 Root 自主 final 仍走原 verifier | DONE |
| P1 | Prompt | 完整输出 Schema 从实际定义派生；usage 只衡量当前请求，不用占位委派格式化答案 | DONE |
| P1 | Tests | 实际 Mastra AUTO tool/no-tool、非法输入、Schema 等价、Root continuation 自主完成交叉矩阵 | DONE |
| P1 | Verification | 新 build、fresh scratch 的 semantic-only 与 ROAS 两个反例都通过后才前向 E14 | PENDING |

## 4. Systematic Expansion

- Direct Root 与持久化 Root 共用同一个 `createRootModelProviderPort`/bridge，修复两条组装路径，不新增 fallback。
- 只有未观察到 native Tool Call 的 AUTO 分支读 text；原生工具以工具候选为权威，不从伴随文本恢复答案。
- 无可选工具/REQUIRED 的结构化输出、凭据、scope、预算、dispatch marker、schema registry 和 Artifact verifier 不变。
- Model 仍可能产生无效或多余动作；保持 strict parse/fail closed 和真实业务 gate，不新增关键词 router、SQL 模板或重试循环。
- 单元测试命令排除 integration，故后续每次修改桥接协议都必须显式跑 pinned Mastra integration suite。

## 5. Knowledge Capture

- [x] 更新 backend/agent-team-runtime.md 的 AUTO 输出、当前请求 completion 与必需测试。
- [x] 更新当前 task design/implement，保留 E13 不可变失败、记录 fresh E14 下一步。
- [x] 仓库无 src/templates/markdown/spec 对应目录，不创建影子规范。
- 验证结果记入 implement；此修复完成不意味着四层业务完成，task 保持 in_progress。
