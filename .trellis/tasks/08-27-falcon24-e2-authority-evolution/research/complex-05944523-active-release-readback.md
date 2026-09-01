# 05944523 active Semantic Release 回读

## 结论

`05944523` 的 clean force build、full unit 与 fresh E17 scratch activation 均通过，但 E17 Finalizer 是 retained-semantic rollover。
active executable projection 仍是 E16 的 generation 2：

- `metric.marketing_revenue.aliases = ["marketing revenue", "营销归因收入"]`
- `metric.order_revenue.aliases = ["order revenue", "收入", "订单收入"]`
- `dimension.runtime_time_blinkit_marketing_performance_date.aliases = ["blinkit_marketing_performance date"]`

因此源码 ChangeSet 中新增的“营销收入/营销月份”尚未发布，不能作为本轮 B3 冻结权威，也不能用 E17 `terminal=ACTIVE` 代替发布证明。

## 有界处理

不修改 generation 2、不回退 E4、不另建 publisher。依据用户允许降低题目歧义的授权，B3 直接引用当前已发布的
“营销归因收入”与 `blinkit_marketing_performance date`，并在题面内把后者定义为所比较自然月的时间字段；净 ROI 继续沿用 B2 的
request-scoped `AGGREGATE_RATIO`，不复用 Published ROAS。

## 零模型检索证明

对 `d6484404` 冻结 B1/B2 conversation intent 和 exact generation 2 snapshot 做只读重编译，Provider 调用 0、authority write 0。
新 B3 同时选中：

- `dimension.marketing_channel`
- `dimension.runtime_time_blinkit_marketing_performance_date`
- `dimension.target_audience`
- `metric.marketing_revenue`
- `metric.marketing_spend`

旧泛化订单收入仍可能作为额外 recall candidate 出现，因此 Semantic Provider 必须依据 current request 的多 operation 引用选择完整营销集合；
Host 不补成员。该 probe 只证明进入 Provider 前的检索闭包，不能替代 Semantic -> Text2SQL -> Analysis、业务 Oracle 或浏览器 Trace。
