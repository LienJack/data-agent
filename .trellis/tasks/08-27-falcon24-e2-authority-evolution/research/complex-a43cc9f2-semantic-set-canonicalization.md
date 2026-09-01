# a43cc9f2 B3 Semantic 集合序列化复盘

## 现场结论

`a43cc9f2` 在同一 clean build、fresh physical scratch 与 SERVER_PROXY runtime 上已连续通过 A1/A2/A3/B1/B2。B3 的唯一 Run
`ff20e734-2ad0-8166-94de-07af61678358` 没有重提；四个 Semantic provider call 全部以
`RESPONSE_SCHEMA_MISMATCH` 失败，raw-free issue 均定位到某个 set-like ID 字段的数组第 2 项 custom refinement。Run 无已接受
Semantic、SQL 或 Analysis Artifact。live before/after 348 张表一致，仍是 E16。

这与 `82aed231` 上 B3 的指纹相同。其间已把完整 ID 的 JavaScript 默认字符串升序写入 system prompt；再次失败说明模型能正确选择
成员却不可靠地承担无业务含义的集合排序。继续增加提示或重跑不会修复传输契约。

## 最小前向修复

新增 provider-only `semanticQuerySelectionProviderResponseSchema`：

1. 每个 ID 仍先通过原 `versionIdentifierSchema`，重复成员立即拒绝；
2. 只复制并按 JavaScript 默认字符串顺序排列 selected/candidate 数组；
3. ambiguity 以 `object_kind + canonical candidate_ids` 确定性排列；
4. 与最终 intent 共用非空、ambiguity 唯一、operation 唯一和 operation 引用已选 primitive 的跨字段校验；
5. production team tool 继续用原 `semanticQuerySelectionIntentSchema` strict parse 规范化结果。

Worker 只为 exact `semantic-query-selection-intent@1.0.0` 的 JSON_TEXT 注册 provider schema。它不增删或替换 ID，不生成 operation，
不读取题号/题面，不选择 Metric/Dimension/Formula/Relationship/Time/Quality，也不改变 SQL、Oracle、模型预算或发布权威。Semantic Agent
仍决定集合成员与请求级公式；Host 仅确定集合表示。

## 证明边界

聚焦测试先证明原 final schema 拒绝乱序响应，再证明 provider schema 对 selected IDs、candidate IDs 和 ambiguities 做确定性排列，结果可由
final schema接受；重复 ID 仍拒绝。Worker 测试锁定实际 registry 使用该 provider schema及prompt边界。组件通过不等于 B3 业务通过；必须在
新的 clean build/fresh scratch 从 A1 重跑六题，旧五题不得拼接。
