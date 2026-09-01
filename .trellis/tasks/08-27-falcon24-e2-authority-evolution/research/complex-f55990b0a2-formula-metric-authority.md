# f55990b0a2 Formula-only Analysis Metric 权威复盘

## 不可变现场

- A1/A2/A3在同一`f55990b0` build与`falcon24-e17-f55990b0a2`物理scratch依次完成独立业务及同Run QA/Trace。
- B1唯一Run `21da02cb-8b29-8648-aa6a-95fbe56a6cb3` 终态FAILED，未重提。
- Semantic与Text2SQL已生成4渠道的投入、营销归因收入、ROAS、SQL、QueryEvidence和BAR图；源结果正确。
- 终态诊断为`CATEGORY_COMPARISON_AUTHORITY_INVALID`，随后Root预算耗尽；未生成AnalysisReport。

## 根因

本次Text2SQL合法选择`formula.marketing_spend`、`formula.marketing_revenue`、`formula.marketing_roas`，所以QueryEvidence三个数值列均保留
FORMULA角色。旧Governed Analysis仅从METRIC列生成`requested_metric_ids`；空数组让Published AnalysisContext回退到全部selected Metrics，
把语义召回中的无关`metric.order_revenue`也编入Context。Category planner要求原Metric集合与Context精确一致，因而正确失败关闭。

这不是数据、SQL、ROAS公式或Sandbox错误，也不能靠重提解决。把FORMULA强改为METRIC会破坏已发布公式身份和来源合同，同样不可接受。

## 前向闭包

Analysis从accepted binding反查最小支撑Metric集合：canonical Formula命中其已发布Metric；独立Formula只可通过精确表列来源覆盖Metric的完整
dependency columns；候选还必须属于原retrieval/mandatory/route closure。无关Metric裁剪，空集合失败。planner使用该精确Context做原能力验证，
但ResultContract、lineage和materialization继续保留FORMULA/REQUEST_DERIVED角色。

聚焦测试覆盖额外订单收入召回被裁剪、营销收入/投入支撑Metric被保留、结果角色不提升，以及category/monthly/monthly-panel原拒绝边界。
组件PASS仍不替代业务证明；提交后必须新clean build、fresh物理scratch，从A1重跑六题。
