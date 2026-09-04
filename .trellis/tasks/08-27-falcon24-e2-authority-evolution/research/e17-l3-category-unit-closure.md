# E17 L3 分类比较单位闭包

## 观测边界

- build commit：`43bcc1028a5fa2d6939c2b63cacc9272fec3cdf4`
- formal attempt：`9771bf1a-d0df-437c-9ba4-48dda36f78ea`
- L3-02 Run：`66f7c8ed-ae09-87de-836e-2aa141d923ec`
- attempt 终态：FAILED，历史证据保留，不重放、不拼接前八题 PASS

## 已证明链路

Semantic 在同一 Run 中选择了 v8 题面指定的 canonical Metric、Formula 与两个 Dimension。Text2SQL 随后生成并提交16行六列
`channel/target_audience/total_spend/marketing_revenue/conversions/roas` QueryEvidence；因此这次失败不是命名歧义、SQL 执行、
数据缺失或 Agent 未交接。

Analysis 在 Stage 创建前两次返回 `CATEGORY_COMPARISON_AUTHORITY_INVALID`。运行态 Semantic Context 的三项 Metric 单位分别为：

- `metric.conversions`：`unit.count`
- `metric.marketing_spend`：`unit.currency`
- `metric.marketing_revenue`：`unit.currency`

`evaluateAnalysisApplicability` 对 category comparison 要求全部选中 Metric 单位相等，故该输入确定性触发 `UNIT_MISMATCH`。这个约束阻止
数量与金额被误画在同一比较尺度，属于正确的失败关闭，不应为了门禁放宽。

## 前向决策

依据用户允许的门禁难度收敛，v9 仅修改 L3-02 冻结题面：复用 `metric.conversions` 与
`formula.conversions=SUM(conversions)`，按 `dimension.marketing_channel × dimension.target_audience` 查询全量三列事实表，再交给唯一
Analysis Stage 生成表与转化量对比图。该决策不创建影子语义对象、不修改通用单位守卫、不添加固定 Router/DAG，也不降低业务 Oracle、
Artifact lineage、QA/Trace 或 fresh one-shot 要求。

v9 canonical turns hash：
`sha256:04ee93aa5fc9eb0e21ae58c5d7b9503ffa8705866b1af11461e7881c444f7de9`。

10824 render checksum：
`sha256:6fd919c5ec352a795d329af3a7768d1454c3277b8046675b756087c4ce63cfd2`；真实 scratch 应用后的 begin RPC `prosrc` hash 为
`ab2e30b0743cbd8cbf84eb82e490ebcec93c85c18ae61282a08db56d5c783b51`。v1～v9 begin/replay/supersede 与 v8↔v9 双向混配拒绝均已通过。
