# M2 受治理召回量化门禁

## Goal

基于 M1 固定回放与 Falcon 证据审计 unresolved/clarification 缺口；只有有批准数据证明显式词汇不足时才实施 governed retrieval，否则记录 NO-GO。

## Requirements

- 审计现有 M1 测试与 Falcon 固定数据，区分“整体执行质量”与“词法召回缺口”两类证据。
- 门禁必须基于 M1 之后、绑定 exact source commit 与 Published Release 的同一固定语料回放。
- 回放至少记录 `case_id`、预期路由、实际路由、词法证据、澄清原因及人工归因，能够计算 unresolved、clarification 和 retrieval-resolvable 数量。
- 没有完整分母、归因和同语料对照时，结论必须是 NO-GO，不新增 knowledge/vector/graph retrieval 运行时代码、端口或兼容开关。
- 记录重新进入 M2 的证据条件；未来即使 GO，非确定性候选也只能补充证据，不能绕过 exact release、消歧、ACL 或发布权威边界。

## Acceptance Criteria

- [x] 现有 Falcon 产物的 source commit、数据版本、聚合结果和字段能力有明确审计记录。
- [x] 明确说明现有证据能证明什么、不能证明什么，不能从整体成功率推断词法缺口。
- [x] 给出 GO/NO-GO 结论与原因；NO-GO 时语义运行时代码保持不变。
- [x] 给出未来固定回放的数据契约、同语料基线/候选比较和安全非回归条件。
- [x] M2 方案文档同步门禁结论，后续维护者无需从临时 artifact 反推决策。

## Notes

- 本任务是门禁审计任务，保持 PRD-only；除文档和任务元数据外不修改产品代码。
