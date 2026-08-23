# 全仓退役 Surface Ledger

机器权威是同目录的 retirement-surface-ledger.json。本页只解释规则，不维护第二份清单。

账本覆盖 Semantic/Billing 已完成退役面、生产兼容 API、旧环境变量别名、测试归档、迁移历史豁免和可靠性
fallback。每项必须记录 owner、引入时间、当前消费者、处置、移除条件、截止日期、替代面、证据和状态。

处置语义：

- KEEP_CURRENT：当前权威面，不属于兼容迁移。
- KEEP_RELIABILITY_FALLBACK：经过测试刻画的可靠性降级路径，不能因名称含 fallback 而误删。
- MIGRATE_THEN_DELETE：先迁移消费者，满足条件后删除。
- ARCHIVE_TEST：仅用于历史比较或 replay，退出生产依赖后归档。
- DELETE：已删除或等待无迁移删除。
- FROZEN_HISTORY：不可改写的历史数据、契约或迁移豁免。

scripts/lib/retirement-surface-ledger.ts 使用严格 Schema 解析该 JSON，并由架构测试扫描生产源码中的
@deprecated、LEGACY_TEST_ONLY、旧环境变量别名和兼容导出。新增兼容面必须先登记；未知字段、重复
surface、非法处置、缺 owner 或缺移除条件均失败关闭。

历史迁移仍由 scripts/lib/workspace-migration-inventory.ts 执行精确 stem/checksum 校验；本账本只记录这些
豁免为何存在和何时允许结束，不复制具体 allowlist。
