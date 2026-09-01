# d6484404 B3 Semantic 术语闭包复盘

## 现场结论

同一 `d6484404` clean build、fresh NAS physical scratch 与 SERVER_PROXY runtime 中，A1/A2/A3/B1/B2 已依次通过独立来源、阶段、
业务和同 Run QA/Trace。B3 唯一 Run `fdd08691-e2b0-805c-8fec-8b6030add4e0` 没有重提；四个 Semantic provider call 均以
`RESPONSE_SCHEMA_MISMATCH` 失败，raw-free issue 为同一顶层集合第 1 项 custom refinement。Run 在 Root 预算内正确 FAILED，冻结历史 5 条，
没有创建 SemanticQueryContext、SqlArtifact、QueryEvidence、AnalysisReport 或 Chart。

冻结 authority receipt 显示 mandatory objects 为 `dimension.marketing_channel`、`dimension.target_audience`、`metric.order_revenue`。
`metric.marketing_revenue` 与 `metric.marketing_spend` 只通过 optional recall 进入 selected objects；
`dimension.runtime_time_blinkit_marketing_performance_date` 在 pruned objects 中。发布词典中订单收入 Metric 把无限定“收入”作为 alias，
营销收入 Metric/Formula 只有“营销归因收入”，营销事实日期维度只有技术名。于是题面“营销收入 + 最近两个完整月”不能形成唯一且完整的
营销 Metric + 月份 Dimension 原语闭包。该缺口发生在 Semantic selection，尚未进入 Text2SQL 或 Analysis。

## 最小前向修复

1. `metric/formula.marketing_revenue` 增加“营销收入”，保留“营销归因收入”。
2. `metric.order_revenue` 删除无限定“收入”，保留“订单收入”。
3. 营销事实日期维度增加“营销日期/营销月份”；新版 B3 显式定义并使用“营销月份”。其他时间维度不共享该别名。
4. Semantic system prompt 要求多个 request-scoped operation 的 Metric/Dimension 引用做全集 membership 自检；Host 不添加或替换成员。
5. 净 ROI 继续是请求级 `AGGREGATE_RATIO`：收入减投入后除以投入、先聚合后相除、零投入为 NULL；不发布新全局公式，不复用 ROAS。

## 证明边界

change-set 与 provider prompt 两个聚焦测试先稳定 RED，再以 22/22 GREEN 锁定词典和多操作约束。组件测试不等于 B3 业务通过。
提交后必须新 clean force build、fresh 专用物理 scratch，从 A1 重跑 A/B 六题；只有 B3 真实形成
Semantic -> Text2SQL -> Analysis、独立 source/stage/business Oracle 与同 Run 浏览器 Trace 才证明修复有效。旧五题 PASS 与本 B3 FAILED
都保持不可变，不拼接到新构建。
