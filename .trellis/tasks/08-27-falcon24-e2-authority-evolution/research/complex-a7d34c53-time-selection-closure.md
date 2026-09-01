# a7d34c53 B3 时间维度冻结闭包复盘

## 冻结事实

- commit：`a7d34c533e3b1f7abebfccd55c865b609e82741c`
- A1/A2/A3/B1/B2：同一 build/scratch 连续完成业务、QA/Trace 与刷新
- B3：Run `978479c0-63e6-805f-9537-86766d5be830`，FAILED，未重提

B3 共 55 个事件。第一次 Semantic 委派因结构化响应协议失败；后续三次均以 `TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE` 失败，
最终 `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`。没有 SemanticQueryContext、SqlArtifact、QueryEvidence、AnalysisReport 或图。诊断只读取公开事件、
Profile/task 状态与冻结 intent receipt，没有读取 Provider 原文、Secret 或 SQL。

## 对照证明

当前 Run 的 intent/context selection hash 与 retrieval query hash 均匹配，历史两题绑定正确。其 selected object IDs 含渠道、目标人群、营销投入和
营销收入，但不含营销事实日期列或营销日期维度。`f02d610a` 成功 B3 使用完整公开名“blinkit_marketing_performance date”，冻结集合同时包含
`contains.column.blinkit_marketing_performance.date` 与 `dimension.runtime_time_blinkit_marketing_performance_date`。`4.2.0` 改用泛称
“已发布营销日期”后，这两项消失；Semantic 尝试补选时被正确拒绝。

因此不修改 frozen closure 校验、不由 Host 添加对象，也不把内部 ID 写入问题。`4.3.0` 只恢复用户可见的精确维度标题；收入名、两个 request
operator、Text2SQL 完整面板先行、Analysis 渠道主筛选和待验证假设边界都保持不变。

## 前向验证

旧 B3 和本轮前五题全部保持历史。完成 scoped docs commit、live after audit 与运行清理后，必须用新 clean build/fresh physical scratch 和新会话
从 A1 重跑。新 B3 除业务/Stage/UI 外，还要显式复核 retrieval receipt 已选中日期列/维度、Context 使用当前 Run 引用；只有六题同 epoch
全部 PASS 才能进入 F5/F7 正式十五回合。
