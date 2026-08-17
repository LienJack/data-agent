# U6 Implementation Plan

## 1. Contracts first

- [x] 新增 Workspace File reference/revision/scan/deletion/retention/GC strict schemas、builders、verifiers。
- [x] 将 `FILE_SCAN` 加入 U10 Job Kind，并冻结精确 input/output resource contract。
- [x] 添加 canonical hash、tamper、state/closure、MIME/size/filename/scope/revision tests。

## 2. PostgreSQL 10660

- [x] 建立 migration source/renderer/rendered migration/ledger postconditions。
- [x] 建立 Blob/Revision/Scan/Retention/Hold/Deletion/GC/Idempotency Authority，FORCE RLS、NOLOGIN owner。
- [x] 实现 upload prepare/commit、list/load/promote/delete/download、scan commit、retention/hold/GC窄RPC。
- [x] successor扩展 U10 FILE_SCAN handler/readiness 和 U2 FILE Effective Config resolution；不修改10659/10653。
- [x] 新增 assertion 38，覆盖RLS/grants/hash/idempotency/refcount/stale revision/delete/hold/GC/Effective Config。

## 3. Platform storage and ports

- [x] 新增 Workspace Content namespace 与实际 StorageClient composition，服务端key/hash/size回验。
- [x] 新增 PostgreSQL Workspace File repository，所有DB结果经Contracts verifier并逐项scope/ref/status校验。
- [x] 新增 ClamAV + local content/credential `FileScanPort`，timeout/unhealthy/signature stale去敏且fail closed。
- [x] fake adapter/conformance tests覆盖scope breach、hash drift、orphan replay和scanner truth table。

## 4. Worker FILE_SCAN

- [x] 注册真实 `file-scan-handler@1.0.0`，以U10 exact attempt/lease/fence读取Revision和Blob。
- [x] 原子提交领域Scan Receipt+Revision transition，再提交Job output；取消/重试/stale fence均不产生READY。
- [x] 接Worker composition、handler heartbeat/readiness与bounded shutdown；无第二队列。

## 5. Web and Effective Config

- [x] 新增list/upload/download/delete/promote Routes及授权/输入边界。
- [x] 新增附件选择器并接chat input/qa-store，只有READY exact revision可进入Run request。
- [x] 验证U2 Resolution/Effective Config冻结AVAILABLE File Revision；删除后新Run拒绝、旧Runmetadata-only。
- [x] Route/component tests覆盖跨Workspace、MIME spoof、quarantine、promotion、delete、download headers与去敏错误。

## 6. Runtime and operations

- [x] compose增加隔离ClamAV健康检查与Worker非secret配置；scanner不健康只使FILE_SCAN NOT_READY。
- [x] 记录retention/legal hold/orphan/refcount GC运维流程，不输出secret/object key。

## 7. Verification and commit

- [x] focused/full relevant tests、typecheck/build、Biome、diff-check。
- [x] 10660 renderer/static、fresh PG17 + assertion 38，所有import hooks `/dev/null`。
- [x] forbidden scan：Falcon/import/provider/Billing/Credit/Price/Claude/Anthropic、旁路队列、raw file/secret logs。
- [x] Trellis check修复全部U6-owned P0/P1。
- [x] 更新Trellis task/evidence，精确stage owned paths并创建单一scoped commit。

## Rollback points

1. Contract/10660未闭合前不接Web Route。
2. Scanner/Storage dependency未READY时文件保持QUARANTINED，Capability NOT_READY。
3. 对象已写但DB commit失败时不暴露对象，由orphan GC收敛；禁止用直接object URL恢复。
4. 删除/GC race未通过fresh PG并发测试前不启用物理删除。
5. Falcon只在U1–U20最终门禁运行，不作为U6回归。
