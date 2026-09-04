# E17 L3-02 营销转化术语闭包

## 观察

- v7 attempt `4b851d00-eded-4ebd-a6c6-1e3bf8eaf3f3` 前八题同 build/scratch PASS；不得复用。
- L3-02 Run `9ea0054a-eade-8373-8e98-e941e517153c` 的 Root objective 已保留六项业务范围且没有新增请求时间窗口。
- Semantic 选择了渠道、目标人群、营销投入、营销归因收入和 ROAS，但“营销转化”形成空候选 METRIC；Text2SQL 因 accepted Context
  有 unresolved ambiguity 在任何 SQL I/O 前拒绝。
- active generation 2 已发布 `metric.conversions` 与 `formula.conversions=SUM(conversions)`，物理依赖是
  `blinkit_marketing_performance.conversions`，公开中文别名为“转化量”。

## 结论

不创建 `metric.marketing_conversions`，也不提交只存在源码而无法进入 retained finalizer 的 alias。manifest v8 仅将 L3-02 显式绑定既有
canonical IDs，并冻结 Semantic→Text2SQL→单 Analysis Stage、all-time 六列面板和非因果结论。业务 Oracle、QA/Trace、同 Run lineage 与
一次性 attempt 标准保持不变。
