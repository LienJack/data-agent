# 技术设计

## 权威边界

docs/architecture/retirement-surface-ledger.json 是唯一机器权威。原 Semantic/Billing Markdown 保留为说明页，
不再维护可漂移表格；迁移 stem/checksum 的精确 allowlist 继续由 workspace-migration-inventory.ts 管理。

## 数据与校验

账本使用严格 JSON Schema，逐项记录 surface、kind、owner、introduced_at、current_consumers、
disposition、removal_condition、deadline、replacement、evidence、status。业务校验补充重复 surface、
deadline/status 组合和 reliability fallback 处置规则。

## Inventory 门禁

架构测试递归扫描 apps、packages、scripts、services 的生产 TypeScript/JavaScript 文件，排除测试与生成目录，
识别 @deprecated、LEGACY_TEST_ONLY、DeepSeekAPIKey/KimiAPIKey 和兼容 export。扫描器自身不作为生产
兼容 surface。

## 回滚

若严格门禁产生无法解释的误报，回滚扫描器模式与对应账本项；不得恢复第二份 Markdown 权威，也不得放宽
迁移历史的 fail-closed 校验。
