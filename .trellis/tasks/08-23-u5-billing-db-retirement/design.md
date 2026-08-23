# U5 设计

- `10703` 是历史不可变链后的唯一前向 retirement migration；`10700` 至 `10702` 已被现有迁移占用。
- 先记录对象 inventory/row count/digest，再撤销应用角色 grant，删除 mutation RPC/trigger，最后写 retirement receipt。
- 历史 price/fx/credit/hold/bill/audit 表保留只读；不 DROP/清空数据。
- renderer 若为仓库现有 migration source 约定的一部分则使用；否则提交单一 SQL，但 declaration/checksum 必须闭合。
- Model Control operation/audit 使用全新表，不复制旧 pricing operation/audit rows。
- PG17 smoke 在 `10703` 前插入非空历史 marker，保存 `to_jsonb(row)::text`，迁移后比较完全相等并验证拒写。
