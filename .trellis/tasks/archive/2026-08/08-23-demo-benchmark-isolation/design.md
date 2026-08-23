# Demo/Benchmark 隔离设计

- 电商纯规则与 SQL compiler 归属 `@data-agent/evals` 的 ecommerce capability 子路径。
- Worker 的 `evals/ecommerce-direct-qa-adapter.ts` 负责把 capability 连接到通用 Run ports。
- Platform 只保留通用只读数据库执行与 firewall；若现有 executor 暂时依赖 PG adapter，则以领域命名子路径隔离并禁止通用入口 re-export。
- `run-workflow-executor-router` 依据冻结的 capability/profile 选择 adapter，不根据问题关键词自动把任意 Workspace 当作电商 Demo。
