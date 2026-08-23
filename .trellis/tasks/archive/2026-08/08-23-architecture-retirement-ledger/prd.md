# 全仓退役账本与兼容面门禁

## Goal

建立覆盖全仓历史兼容面、可靠性 fallback、测试归档和一次性修复面的机器可检查退役账本。

## Requirements

- 每个 surface 记录 kind、owner、introduced_at、current_consumers、disposition、removal_condition、deadline、replacement、evidence 和 status。
- disposition 至少区分 `KEEP_RELIABILITY_FALLBACK`、`MIGRATE_THEN_DELETE`、`ARCHIVE_TEST`、`DELETE`、`FROZEN_HISTORY`。
- 首版必须覆盖旧环境变量别名、`LEGACY_TEST_ONLY`、Text2SQL characterization、迁移历史豁免和已存在的 PostgreSQL reliability fallback。
- 生产源码新增 legacy/compatibility surface 必须先进入账本；可靠性 fallback 不得被误判为兼容迁移。
- 复用现有 Semantic/Billing ledger 的 fail-closed 风格，不建立第二套相互冲突的 retirement authority。

## Acceptance Criteria

- [ ] 账本文档可被严格解析，未知字段、重复 surface、非法 disposition、缺少 owner/removal condition 时失败。
- [ ] 架构测试能发现未登记的新生产兼容面，并允许已登记的 reliability fallback。
- [ ] 当前仓库 inventory 通过，伪造新增兼容 export/别名测试失败。
- [ ] 相关测试和格式检查通过并创建 scoped commit。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
