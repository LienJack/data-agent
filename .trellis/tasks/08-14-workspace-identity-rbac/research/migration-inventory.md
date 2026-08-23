# Workspace Migration Inventory

## Closure Rule

当前 migration 中所有 `app_data_agent.*`、`semantic.*` 和 `catalog.*` 业务表都由验证脚本
枚举。分类规则如下：

1. 表定义包含 `tenant_id`：现有列原地映射为 `workspace_id`，不生成第二列；所有读写继续
   带 `app_id + tenant_id + environment`，公共 DTO 把该值命名为 `workspace_id`。
2. `app_data_agent.memberships`：继续作为 capability FK 权威；Phase 1 增加显式产品角色和
   superadmin override 元数据，并关联 `workspaces.workspace_id = memberships.tenant_id`。
3. `semantic.*`：全部已有 `tenant_id`，原地归入同 UUID workspace；Phase 2 才替换 Web
   固定 tenant resolver。
4. `catalog.*`：全部已有 `tenant_id`，原地归入同 UUID workspace；datasource 物理持久化
   与复合 FK 在 Phase 2 完成。
5. 仅有两个既有 app-global 私有例外：
   `app_data_agent.research_lifecycle_cleanup_operations` 和
   `app_data_agent.research_lifecycle_cleanup_batch_receipts`。它们是 app/environment 删除
   控制证据，按设计跨全部 tenant，不伪造 workspace。

`scripts/verify-workspace-migration-inventory.ts` 会从全部 SQL migration 重新发现表，证明
每一张表恰好落入上述分类，并在出现新的无 `tenant_id` 表时失败。Phase 1 新增的
`app_users`、identity operation/receipt/audit 属于已规范化的 app-global 私有对象；
`workspaces` 是 tenant/workspace 映射权威。项目按全新 clean install 交付，不执行旧数据
扫描或回填；已有开发库直接重建。

## Non-table Legacy State

| Legacy state | 当前行为 | 迁移阶段 |
| --- | --- | --- |
| Web datasource connection Map | 进程全局、无 workspace key | Phase 2 持久化并禁用 Map 写路径 |
| Web model Map | 进程全局、无持久权威 | Phase 3 全局模型控制面 |
| Web Q&A conversation Map | 进程全局、无 workspace key | Phase 2 workspace-scoped repository |
| 固定 tenant/principal env | semantic runtime 服务端固定值 | Phase 2 改为 session + workspace capability |
| Q&A `workspaceId="default"` | 客户端硬编码 | Phase 2 移除 |

这些对象没有可证明的可靠持久历史；上线切换前必须导出可恢复配置，不能声称 migration 已
自动保存进程内数据。
