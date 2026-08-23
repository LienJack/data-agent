# U1 设计

- Ledger 使用机器可检查的稳定表格，字段至少含 surface、kind、current consumers、action、unit、current target、evidence。
- 验证器从 migration 文件名和 ledger 声明解析 identity，不修改任何历史 migration。
- Architecture tests 扫描生产 import/export；测试 fake 和 PostgreSQL reliability fallback 使用显式 allowlist 及原因。
- 旧路由只做当前状态 characterization，不把 redirect 行为冻结为未来要求。
