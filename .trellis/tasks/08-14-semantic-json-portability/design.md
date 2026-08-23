# 技术设计

## 1. 边界与数据流

```text
published semantic authority
  -> workspace export repository
  -> strict portable document + canonical SHA-256
  -> upload validation
  -> durable import job
  -> explicit datasource/domain mapping
  -> dry-run READY receipt
  -> atomic semantic.create_candidate_draft per domain
  -> existing review / publish / rollback
```

PostgreSQL 继续是发布版本、导入任务、映射、receipt、audit 与候选草稿的唯一权威。React 组件只消费 contracts 解码后的 DTO，不解析任意上传 JSON。

## 2. Portable contract

`SemanticWorkspaceExport` 分为 envelope 与 hash material。哈希材料包含 format、兼容性、逻辑数据源和按 `semantic_domain` 排序的已发布语义内容；`exported_at` 与 `content_hash` 不参与内容哈希。每个 domain 仅携带 release generation/digest、逻辑数据源引用和规范 semantic source 内容，不携带 release/candidate/revision ID 或 principal。

导入 DTO 使用判别联合表达状态，并额外定义 upload、mapping、dry-run、commit、receipt 与 datasource option。所有对象均 `z.strictObject`，未知字段失败。

## 3. PostgreSQL model

Migration 10632 clean-install 创建：

- `semantic_import_jobs`：完整 AppScope、principal、upload hash、受验证 document、状态、原因和规范 mapping hash；
- `semantic_import_mappings`：逻辑引用到目标 datasource + semantic domain 的复合 FK；
- `semantic_import_receipts`：DRAFT_CREATED 结果、candidate refs 与不可变输入哈希；
- principal-scoped operation 表用于 upload/map/commit 幂等；
- 追加 audit 只保存 import/receipt/candidate ID、schema version、文件/映射 hash 与结果，不保存原文件或身份之外的内容。

RLS 同时校验 app/tenant/environment/principal；SUPER_ADMIN override 仍必须处于真实 workspace scope。Backend 仅得到这些表的必要访问和 `semantic.create_candidate_draft` 现有窄 RPC，不获得原语义表写权。

## 4. Repository 与原子提交

平台 repository 统一通过 `withAppTransaction`：

- export READ 查询 active pointer、release、candidate source、domain registry、datasource 和最新 schema snapshot；无 published release 时返回空导出状态。
- upload 在 I/O 前限制字节数、解析严格 schema、递归 secret 检测、重算 canonical hash，再写 job。
- mapping 锁 job，验证每个 logical ref 恰好映射一次，并查询目标 workspace ACTIVE datasource 与 active domain registry。
- commit 锁 READY job，在同一事务依次调用现有 `semantic.create_candidate_draft`，再写 receipt/audit 和终态；任何一个 domain 失败全部回滚。

映射与内容共同派生确定性 commit idempotency key，确保 round-trip 重放不会复制草稿。

## 5. HTTP 与 UI

工作空间 route：

- `GET /api/workspaces/:workspaceId/semantic/portability/export`
- `GET|POST /api/workspaces/:workspaceId/semantic/imports`
- `GET /api/workspaces/:workspaceId/semantic/imports/:importId`
- `POST .../:importId/mappings`
- `POST .../:importId/dry-run`
- `POST .../:importId/commit`
- `POST .../:importId/cancel`

设置页增加 workspace semantic portability panel：导出按钮、拖放/文件选择、导入任务列表、逐引用 mapping、dry-run 摘要和创建草稿动作。映射缺失时明确暂停并引导先创建数据源，绝不暗示自动创建。

## 6. Failure closed

- 公开错误只返回稳定 reason code 与中文脱敏消息。
- 上传 document 与导出查询只接触 portable allowlist；secret 检测为额外防线。
- commit 不更新 active pointer、release 或 published candidate。
- 已发布历史只读；导入只新增 DRAFT。
- 由于无生产数据，migration 失败时重建本地 PostgreSQL 卷，不做兼容 backfill。
