# U1 建立边界护栏与退役清单

## Goal

建立重构前可执行护栏，完整记录 Semantic/Billing surface、消费者、替代入口和 migration frontier。

## Requirements

- 覆盖计划 R3、R4、R5、R9、R10、R14–R16。
- Surface 只允许 `KEEP_CURRENT/MOVE_DIRECT/DELETE/ARCHIVE_DATA`，不得出现兼容或延迟退役分类。
- Architecture guard 禁止 Semantic 导入 App/Platform，禁止 App 复制 Semantic 公共 schema。
- Migration inventory 校验完整 stem、14 位序号、ledger 声明和 checksum；历史例外显式 grandfather。

## Acceptance Criteria

- [ ] `docs/architecture/semantic-billing-surface-ledger.md` 列出每项当前消费者、原子切换单元和最终入口/404。
- [ ] dependency/platform surface tests 能以受控坏例拒绝反向依赖和新计费/兼容导出。
- [ ] migration inventory verifier 及测试覆盖重复序号、stem/声明不一致和缺 checksum。
- [ ] Workspace Semantic、Model Provider 和 Relationship Index 可靠性降级 characterization 通过。

## Notes

- 依赖：无；完成后解锁 U2 和 U6。
