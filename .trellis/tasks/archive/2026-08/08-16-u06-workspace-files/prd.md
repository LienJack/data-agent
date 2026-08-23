# U6 文件附件与 Workspace 资源生命周期

## Goal

提供 Workspace 文件上传、聊天附件、下载、删除、Session→Workspace 提升和完整保留生命周期，
并让已扫描的精确 File Revision 进入 U2 Effective Config。文件字节使用内容寻址存储，PostgreSQL
保存 Scope、授权引用、扫描结论、lineage、tombstone、Retention/Legal Hold 和 GC Authority。

## Requirements

1. 不信任客户端 MIME、扩展名、Scope、Hash、扫描结论或 Object Key；服务端读取实际字节后计算
   SHA-256、探测允许类型并执行大小门禁。
2. 不可变 Blob 与可变授权引用分离。同内容可以跨 Session 引用而物理去重，但任何引用都必须独立绑定
   App/Tenant/Environment/Principal、Session/Workspace visibility 与 revision。
3. 新上传固定进入 `QUARANTINED`，只有 U10 Job Center 的 `FILE_SCAN` Handler 在 exact
   Job Attempt/Lease/Fence 下提交 committed `WorkspaceFileScanReceipt` 后才可转 `READY`。
4. U6 通过 successor migration 10660 新增 `FILE_SCAN` Job Kind、真实 Handler Revision 和
   readiness dependency；不修改 10659，也不创建旁路队列。
5. 首个 `FileScanPort` 使用隔离 ClamAV `INSTREAM` 与本地 credential/content policy；Scanner
   unhealthy、timeout、signature stale、unknown、malware 或 credential match 均不得 READY。
6. Session→Workspace 提升创建新授权 Revision 并复用相同 Blob Hash，不复制字节、不改变内容身份；
   重放稳定，同键异 intent 冲突。
7. 删除立即撤销该引用的下载与新 Run 选择权限，写入不可变 Deletion Receipt；其他仍有效引用不受影响。
   最后一个引用释放后仅由 Retention/GC Authority 删除 Blob。
8. Legal Hold 只能由授权管理员创建/撤销；它不恢复普通用户字节访问，只延后物理 GC，并冻结
   backup expiry/audit facts。
9. 历史 Run 只保留 exact File Revision 的 metadata/hash/lineage；删除后默认不能继续读取字节。
10. Effective Config 的 FILE binding 必须解析 exact READY、未删除、未过期 Revision；stale revision、
    quarantine、scan failure、tombstone 或跨 Scope 均为不可用，新 Run 不得选择。
11. Web API 必须解析 multipart 边界和 public DTO，下载使用安全 MIME 与 attachment disposition；错误不泄漏
    文件是否存在于其他 Scope、Storage key、Scanner body、credential match 或内部路径。
12. 复用私有 `data-agent-artifacts` Bucket 的独立 Workspace Content namespace；对象 key 由服务端生成并
    校验，Storage Adapter 任何越界返回都视为 scope breach。
13. 全程不运行/导入 Falcon、不调用真实 Provider、不引入 Billing/Credit/Price，也不使用 Claude/Anthropic。

## Acceptance Criteria

- [x] Strict Contracts 覆盖 File Revision、upload/promote/delete/download command、scan/deletion/retention
      receipt、public projection 与 canonical hash/tamper/state transition。
- [x] 10660 建立 Blob/Revision/Scan/Retention/Hold/Deletion/GC Authority，FORCE RLS、NOLOGIN owner、窄 RPC，
      并以 successor 方式扩展 U10 FILE_SCAN 和 U2 FILE resolution。
- [x] 上传在对象写入与 DB commit 崩溃窗口可安全重放；孤立内容对象只能由 bounded orphan GC 清理，
      不会被未提交引用读取。
- [x] Platform PostgreSQL Adapter 和 Workspace Content Storage Adapter 对 scope/hash/revision/status/refcount
      逐项复核，稳定映射错误且不泄漏底层异常。
- [x] Worker FILE_SCAN Handler 使用 U10 exact lease/fence，真实调用注入的 ClamAV/本地 policy Port，
      提交 output receipt 后才成功；取消、timeout、scanner unavailable、stale signature 均 fail closed。
- [x] Web 文件 list/upload/download/delete/promote API、附件选择器与聊天输入接线完成；只有 READY 文件可选择。
- [x] Effective Config 对 READY 文件返回 AVAILABLE exact ref，对 deleted/quarantined/stale/cross-scope 返回
      truthful unavailable binding；历史 Config 仍可审计但不能绕过字节撤权。
- [x] 去重、独立 ACL、promotion、删除、legal hold、refcount GC、backup expiry、MIME spoof、malware、credential、
      scanner unknown、TOCTOU 与跨 Workspace 测试完整。
- [x] Contracts/Platform/Worker/Web focused/full relevant tests、typecheck/build、Biome、renderer/static、fresh PG17
      assertions、diff/forbidden scan 全绿。
- [x] Trellis check 无 U6-owned P0/P1，创建单一 scoped commit；Falcon 保留到 U1–U20 最终门禁。

## Non-goals

- 不在 U6 实现 U15 文档切片、Embedding、检索或知识库；U15 只消费 U6 READY File Revision。
- 不实现 U7 Artifact 预览/导出，也不把通用 Artifact ACL 当文件 ACL。
- 不承诺对象存储与 PostgreSQL 跨系统 exactly-once；采用内容寻址幂等写、Authority commit 与孤儿 GC 收敛。
- 不导入 Falcon 或运行 Falcon 评分；它只在所有单元完成后的最终验收执行。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
