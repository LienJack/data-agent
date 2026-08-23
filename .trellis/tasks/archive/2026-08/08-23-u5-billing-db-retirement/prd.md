# U5 冻结计费历史对象与迁移治理

## Goal

以 forward migration 停止所有计费写入并把历史账务对象冻结为只读归档，同时治理 migration identity。

## Requirements

- 覆盖 R3、R13、R14；历史 migration 不修改。
- `10703` 移除计费 mutation function/view/trigger/grant，保留历史表和不可变 retirement receipt。
- Model availability/certification 当前函数不读取账务状态；应用角色没有历史表写权。
- 新 migration stem、14 位序号、ledger declaration、renderer/checksum 必须一致。

## Acceptance Criteria

- [x] Fresh install 到 `10703` 后 Model Control、Provider、Semantic 所需 RPC 不依赖 Billing 表。
- [x] 含历史账务 rows 的验证库应用 `10703` 后 row count/digest 不变且写入被拒绝。
- [x] 旧 billing mutation function/RPC 在最终 catalog 中不存在，无 retired wrapper。
- [x] SQL static、migration inventory 与 PostgreSQL smoke 通过。

## Notes

- 依赖：U4。
- 相关的两个 PostgreSQL smoke（商业归档、Operations/backup-restore）通过。完整 smoke 继续运行到
  `18zzzza-knowledge-semantic-release-assertions.sql` 后，被既有 Semantic V1
  `SEMANTIC_CANDIDATE_SELF_PUBLISH_INVALID` 夹具阻断；该文件不属于 U5，并将在 U6 V1 删除中处理。
