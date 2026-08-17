# U6 Technical Design

## Authority boundaries

U6 将“相同字节”“谁可以引用”和“是否安全可用”拆成三个独立事实：

1. `workspace_content_blobs`：按 `content_hash` 唯一，记录 server-observed size、detected MIME、storage key、
   refcount 与 GC 状态；调用方不能直接读写。
2. `workspace_file_revisions`：不可变授权 Revision，绑定 Scope、owner、Session/Workspace visibility、
   filename、blob hash、lineage、status 与 tombstone。
3. `workspace_file_scan_receipts` / deletion / retention / hold：追加式领域 Authority，决定 Revision 是否
   READY、字节是否仍可读、Blob 何时允许 GC。

普通 Zod parse、客户端 Hash、Storage Object 存在或 U10 Job 成功状态都不能单独授权下载或 Effective Config。

## Contracts

新增 `packages/contracts/src/workspaces/files.ts`，冻结：

- `WorkspaceFileReference`：scope + file_id + revision + revision_hash；用于 API/Effective Config，不伪装成
  run-scoped通用 Artifact Reference。
- `WorkspaceFileRevisionDocument`：server-observed blob hash/size/MIME、original filename、visibility、owner、
  optional session、parent/promotion lineage、status、scan/deletion refs 和 canonical revision hash。
- upload intent/result、promote command/result、delete command/result、download lookup、list projection。
- `WorkspaceFileScanReceipt`：exact Job/Attempt/Fence/File Revision/Blob identity、scanner engine/signature/policy、
  malware/credential/content verdict、observed bytes 与 terminal reason。
- `StorageRetentionPolicyRevision`、Legal Hold、Deletion Receipt 与 GC Receipt。

所有 schema strict；UUID 小写规范化、UTC 毫秒、safe integer、有界 filename/MIME/bytes；Hash material 排除
DB-owned timestamps/hash 本身，并对嵌套引用做 exact scope/revision closure。

## PostgreSQL 10660

新增 NOLOGIN `data_agent_u6_file_owner`，表建议：

- `workspace_content_blobs`
- `workspace_file_revisions`
- `workspace_file_scan_receipts`
- `storage_retention_policy_revisions`
- `workspace_file_legal_holds`
- `workspace_file_deletion_receipts`
- `workspace_content_gc_receipts`
- `workspace_file_idempotency`

RPC 分为 backend 和 worker/job 两组：prepare/commit upload、list/get、promote、request delete、resolve download、
commit scan receipt、evaluate GC/commit blob deletion、retention/hold admin。所有 mutating RPC 在同一 PostgreSQL
事务内锁 exact Scope/Revision/Blob，重算 canonical hash，校验 DB Authority Clock 和 idempotency。

10660 以 successor 方式：

- 放宽 U10 Job Kind CHECK 并注册 `file-scan-handler@1.0.0`；只有依赖已配置且 fresh Worker manifest 精确匹配时
  readiness 才 READY。
- 新增 FILE_SCAN input/output合同验证，不回写 10659 migration。
- 替换/增加 U2 optional FILE resolver helper：只解析 exact READY 文件 Revision；KNOWLEDGE/MCP/SKILL 保持原
  fail-closed行为。QUESTION 所有 admission 都保留 controlled optional closure。

## Object storage

复用 `StorageClient` 底层能力，但新增 `workspace-content-namespace.ts`。规范 key 是无歧义、版本化路径：

`workspace-content/v1/<app>/<tenant>/<environment>/<sha256-prefix>/<sha256>`

key 只由 server-computed hash 生成；ACL 不编码进 key，而由 PostgreSQL Revision 授权。Adapter put 后回读或
head 校验 size/hash；get 返回后重新计算 hash，任何漂移为 `WORKSPACE_FILE_BLOB_INTEGRITY_FAILED`。

跨对象存储/数据库不声称原子：先幂等 put 内容地址，再 commit PostgreSQL Revision。commit 前崩溃产生的对象
没有 Authority 引用、永远不可下载，并由有最小年龄阈值的 orphan GC 清理。

## Scan runtime

`FileScanPort` 接收 exact server bytes 与 policy，不接收外部路径。ClamAV Adapter 使用 TCP INSTREAM，设置
connect/read/total timeout 与最大字节；只接受受支持的 clean/infected协议终态。病毒库版本/更新时间进入 Receipt。

本地 policy 在同一字节上执行：允许 MIME/signature、archive/bomb/active content policy、credential patterns 与
UTF-8文本界限。任一 `MALICIOUS|CREDENTIAL_MATCH|UNSUPPORTED|UNKNOWN` 都不 READY；Scanner 不健康或签名过期
是可重试 Job failure，但文件继续 QUARANTINED。

Worker `FILE_SCAN` Handler 先按 Job resource ref 解析 exact File Revision，再取 blob、复核 hash/size，调用 Port，
最后通过 worker-only RPC 原子提交 Scan Receipt 和 Revision transition。Job output receipt引用领域 scan receipt；
不存在“Job succeeded但文件未 READY”的成功路径。

## Lifecycle

- Upload：`PENDING_BLOB -> QUARANTINED`，enqueue FILE_SCAN。
- Scan：`QUARANTINED -> READY | REJECTED`；UNKNOWN/timeout保持 QUARANTINED并按U10重试策略处理。
- Promote：READY Session Revision -> 新 READY/QUARANTINED Workspace Revision（复用同scan/blob，仅在policy仍current时
  才继承 READY），保留 parent lineage。
- Delete：任意非deleted Revision -> `DELETED` tombstone，立即拒绝 download/new selection；不删除其他引用。
- GC：refcount 为零、retention窗口到期、无 active legal hold、backup expiry满足后才删除blob并提交GC Receipt。

Legal Hold 不恢复用户访问；历史 Run只保留Revision/Blob Hash、MIME、Size和lineage。

## Web/API

- `POST /api/workspaces/:workspaceId/files`：multipart 上传，服务端限流/限长/Hash/MIME探测，返回QUARANTINED投影。
- `GET /api/workspaces/:workspaceId/files`：按Scope/visibility/status分页列举。
- `GET /api/workspaces/:workspaceId/files/:fileId`：经PG下载授权后从Storage读取并复核Hash；attachment disposition。
- `DELETE .../:fileId`：提交tombstone，不直接删blob。
- promotion command 使用同一资源Route的strict action body。

附件选择器只展示 READY；chat composer把exact file_id/revision加入U2 override/mention，不携带storage key或bytes。

## Security, privacy, rollback

所有错误去敏；日志不含原始文件、credential match、ClamAV body、Storage credential或object listing。Browser无表DML；
backend/worker仅RPC；FORCE RLS。Rollback应用代码不删除Authority或blob；未扫描文件保持quarantine，旧版本可以继续扫描。
不引入Billing、Provider、Claude/Anthropic或Falcon中间路径。
