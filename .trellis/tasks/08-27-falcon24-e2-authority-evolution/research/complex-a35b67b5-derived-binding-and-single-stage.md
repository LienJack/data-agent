# a35b67b5 请求派生绑定与单 Stage 复盘

## 同 epoch 事实

- commit：`a35b67b5bc9b6f9d4a96619049aa499a6e8fc3dd`
- profile：`complex-l4-semantic-defined@4.3.0`
- A1、B1、B2：独立 source/stage/business Oracle 与同 Run QA/Trace PASS
- A2：Run `0eaaaa1b-8842-8b4e-a4b8-d3799657ad1f`，事实正确但产生四个重复 Analysis task/stage 和八张图，业务 FAIL
- B3：Run `b721daf0-620b-8205-ba2a-c154b309bbef`，FAILED，未重提、未启动业务 UI

## B3 日期闭包已经修复

B3 的 intent/context selection hash 和 retrieval query hash 均匹配。frozen selection 同时包含
`contains.column.blinkit_marketing_performance.date` 与 `dimension.runtime_time_blinkit_marketing_performance_date`；当前 Run
SemanticQueryContext 请求对象也引用该营销日期维度，并生成：

1. `RECENT_COMPLETE_PERIODS(metric.marketing_revenue, marketing date, MONTH, 2)`；
2. `AGGREGATE_RATIO(marketing_revenue, marketing_spend, SUBTRACT_DENOMINATOR, SUM_BEFORE_RATIO, NULL)`。

因此 `4.3.0` 的精确公开时间维度改动达成目标；不能回退到泛称或放宽 frozen closure。

## 新断点是显式输出绑定

Root 三次委派 Text2SQL。六次模型请求均正常完成，但每个委派的两个 compile candidate shape 相同，只包含月份、渠道、目标人群、投入、收入五列，
没有与净 ROI interpretation 对应的 request-derived 输出。Compiler 在 datasource I/O 前以
`QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID` 拒绝三次委派，最后 Root budget exhausted。没有 SqlArtifact、QueryEvidence、
Analysis Stage 或图。

对照 `f02d610a` 成功 B3，其六列面板显式包含 `net_roi`，binding 的 `semantic_object_id` 指向当前 Run request interpretation，且
`request_derivation.semantic_query_context_hash` 与当前 Context 一致。故前向题面必须明确六列逻辑 schema，而不是修改 compiler 或删掉派生校验。

## A2 的一次交接边界

A2 证明“必须交给 Analysis Agent”仍可能被 Root 拆成多个任务。四个 Stage 分别做整体趋势、三个月排名、客户类型贡献和发布，导致答案片段重复、
同一图表多次发布。数值正确不等于业务合同通过。前向题面必须要求一个 Analysis task/stage 在同一受验结果中完成全部操作并一次发布两类图。

## 前向验证

`4.4.0` 只增加两个显式合同：B3 六列32行面板必须包含请求级 `net_roi`；A2 只允许单 Analysis task/stage。关闭本 epoch 并证明 live
authority 零漂移后，以新 clean build/fresh scratch 从 A1 重跑。旧 A1/B1/B2 PASS、A2/B3 FAIL 只作为诊断证据，不跨 epoch 合成。
