# U4 设计

- 删除 Contracts `billing.ts` 的商业部分和 Platform `billing/`、`pricing/` 最终剩余实现。
- 删除 Web billing/credits/prices/fx routes、settings/admin panels/helpers 与 navigation。
- 删除 Worker pricing cycle 和 legacy billing composition。
- 不提供 410、redirect、proxy、同名 error wrapper；历史数据只由 U5 数据库归档策略处理。
