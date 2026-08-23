# U5 冻结计费历史对象与迁移治理

## Goal

以 forward migration 停止所有计费写入并把历史账务对象冻结为只读归档，同时治理 migration identity。

## Requirements

- 覆盖 R3、R13、R14；历史 migration 不修改。
- `10700` 移除计费 mutation function/view/trigger/grant，保留历史表和不可变 retirement receipt。
- Model availability/certification 当前函数不读取账务状态；应用角色没有历史表写权。
- 新 migration stem、14 位序号、ledger declaration、renderer/checksum 必须一致。

## Acceptance Criteria

- [ ] Fresh install 到 `10700` 后 Model Control、Provider、Semantic 所需 RPC 不依赖 Billing 表。
- [ ] 含历史账务 rows 的验证库应用 `10700` 后 row count/digest 不变且写入被拒绝。
- [ ] 旧 billing mutation function/RPC 在最终 catalog 中不存在，无 retired wrapper。
- [ ] SQL static、migration inventory 与 PostgreSQL smoke 通过。

## Notes

- 依赖：U4。
