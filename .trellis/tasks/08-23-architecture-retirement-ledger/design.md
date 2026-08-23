# 全仓退役账本设计

- 权威文档：`docs/architecture/architecture-retirement-ledger.md`。
- 严格解析与扫描：`scripts/lib/architecture-retirement-ledger.ts`。
- 验证：根 `tests/architecture-retirement-ledger.spec.ts`。
- 扫描只针对生产源码和受控配置，不以关键词命中直接授权删除；测试 fixture 与迁移历史单独分类。
- 现有 `semantic-billing-surface-ledger.md` 保持领域专项账本，新的全仓账本通过引用/覆盖检查连接它，不复制其 row。
