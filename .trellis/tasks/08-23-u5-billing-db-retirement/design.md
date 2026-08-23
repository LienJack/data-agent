# U5 设计

- `10700` 是历史不可变链后的唯一前向 retirement migration。
- 先记录对象 inventory/row count/digest，再撤销应用角色 grant，删除 mutation RPC/trigger，最后写 retirement receipt。
- 历史 price/fx/credit/hold/bill/audit 表保留只读；不 DROP/清空数据。
- renderer 若为仓库现有 migration source 约定的一部分则使用；否则提交单一 SQL，但 declaration/checksum 必须闭合。
