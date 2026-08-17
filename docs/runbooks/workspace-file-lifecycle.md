# Workspace File 生命周期运维

U6 文件字节采用内容寻址存储，PostgreSQL 10660 是 File Revision、扫描、删除、保留、Legal Hold
和 GC 的唯一 Authority。运维人员不得直接拼接对象路径、绕过扫描状态或直接修改 Authority 表。

## 运行依赖

- Web 与 Worker 必须共享 `DATA_AGENT_WORKSPACE_FILE_STORAGE_ROOT` 对应的私有持久卷。
- Worker 通过隔离的 ClamAV `INSTREAM` 扫描。Compose 使用固定版本的官方镜像与健康检查；Scanner
  不健康时 `FILE_SCAN` 保持失败关闭，文件继续为 `QUARANTINED`。
- 日志只能记录 File/Revision/Receipt/Job ID 与稳定错误码，不得记录原始字节、Storage Key、扫描器
  响应正文或 credential 命中内容。

## 上传与扫描

1. Web 服务端读取 multipart 字节，忽略浏览器 MIME，执行大小、签名和允许类型检查。
2. 服务端计算 SHA-256，并以内容地址幂等写入 Workspace Content namespace。
3. `commit_workspace_file_upload` 创建 `QUARANTINED` Revision；随后只向 U10 Job Center 提交
   `FILE_SCAN`，不创建旁路队列。
4. Worker 在 exact Job Attempt/Lease/Fence 下读取字节，提交扫描领域 Receipt 与新 Revision，再提交
   Job domain output。只有 `CLEAN` 可进入 `READY`。

Scanner timeout、签名过期、malware、credential 或 content policy 命中均不得人工改成 `READY`；修复
依赖后由 Job Center 的正常重试/新 Job 重新执行。

## Retention 与 Legal Hold

- Retention 更新必须由 Workspace Owner 通过 `updateRetentionPolicy` 的 CAS command 提交，携带 exact
  `expected_policy_ref`；同幂等键异请求会失败。
- Legal Hold 只通过 `setLegalHold` 创建或释放。Hold 不恢复已删除文件的下载权限，只阻止物理 GC。
- 删除立即创建 tombstone Revision 和不可变 Deletion Receipt。`active_reference_count`、policy TTL、
  backup expiry 与最新 Hold 都满足后，`evaluateGc` 才返回删除 Authority。
- 物理删除成功后必须调用 `commitGc`；不要直接把 Blob 表改成 `DELETED`。

## Refcount GC

维护程序使用 `createWorkspaceContentGcService`：

1. `evaluateGc` 在事务内锁定 Blob，并验证零引用、TTL、backup expiry、Hold；`ELIGIBLE` 时转换为
   `GC_PENDING`。
2. Storage namespace 复核 Scope/Key/Hash 后删除字节。
3. `commitGc` 重验 exact eligible Receipt、零引用和 `GC_PENDING`，再提交 `DELETED` Receipt。

任何一步失败都保留可重放 Authority。新的上传提交只接受 `AVAILABLE` Blob，不得复活
`GC_PENDING`/`DELETED` Blob。

## Orphan GC

对象写入成功、数据库提交失败时，内容对象不可被列出、下载或进入 Run。维护程序使用
`createWorkspaceContentOrphanGc` 做 bounded 收敛：

- 每轮最多 1000 个对象；只扫描当前 App/Workspace/Environment 前缀。
- 使用文件系统 `modified_at` 作为 observation，必须超过当前 Retention Policy 的
  `orphan_blob_ttl_seconds`。
- 删除前连续两次调用 PostgreSQL `classifyOrphan`，任何一次发现 Authority 引用都跳过。
- 删除时再次比较 observation 的 size/mtime；对象被替换时跳过，等待下一轮。

Orphan GC 不接受调用方声称的 Scope 或“无引用”结论。不要用对象 URL、目录遍历或直接 shell 删除
替代上述流程。

## 验证与审计

- `pnpm exec tsx scripts/render-10660-migration.ts --verify`
- fresh PostgreSQL 17、数据导入 hook 映射 `/dev/null` 后运行
  `infra/supabase/test-support/38-workspace-files-authority-assertions.sql`
- 查看领域 Receipt/Revision/Job event 时只使用 PostgreSQL 窄查询或 Platform Port，不输出原始文件内容。

Falcon 数据和评测不属于 U6 运维；它只在 U1–U20 全部完成后的最终门禁运行。
