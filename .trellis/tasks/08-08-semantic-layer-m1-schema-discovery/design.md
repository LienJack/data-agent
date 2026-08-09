# M1 PostgreSQL Schema Discovery — Design

## 1. Authority boundary

`PhysicalSchemaSnapshot` 是 datasource catalog 的内容寻址观察，不是
`SchemaSnapshotDocument`、`SemanticRelease` 或 Join/Authorization Authority。M1 的所有
结果只能作为后续 Candidate 的 evidence。

```text
server Authority + datasource metadata + SecretRef
  -> authorized egress + short-lived credential
  -> PostgreSQL RR/RO catalog transaction
  -> decoded physical facts
  -> deterministic normalization + content hash
  -> Data Agent authority snapshot/scan/drift commit
  -> parsed API projection
  -> Physical Schema tree / selector / diff
```

Datasource 与 Authority PostgreSQL 不形成分布式事务。Catalog 观察成功但 authority commit
失败时，scan run 通过幂等输入重试；不能伪称 exactly-once。

## 2. Module ownership

```text
packages/contracts/src/catalog/
  physical-schema.ts
  schema-drift.ts
  index.ts

packages/platform/src/catalog/
  physical-schema.ts
  schema-drift.ts
  postgres-catalog.ts
  postgres-snapshot-store.ts

apps/web/src/app/api/datasources/[id]/schema-scans/
apps/web/src/app/api/schema-snapshots/
apps/web/src/components/semantic/physical-schema-*.tsx
```

Contracts 只拥有 strict DTO、结构化 identity、stable terminal 和纯规范化规则。Platform
拥有 PostgreSQL adapter、hash/drift kernel 和 authority store。Web 只组合 server-owned
Authority/SecretRef 并解析返回 DTO。

## 3. Snapshot identity

Snapshot content material 固定包含：

- datasource ID + server-owned fingerprint；
- PostgreSQL engine/version/database identity；
- 精确 allowlisted schemas；
- 规范排序的 relations、columns、constraints 与 indexes。

`scan_run_id`、`snapshot_id`、`captured_at`、持久化时间和公开 terminal 不进入 content hash。
对象 key 使用结构化 tuple，不使用 delimiter 拼接；任何 tuple 重复立即失败。

## 4. Drift algebra

纯函数仅比较同 datasource fingerprint 的两个已解析 snapshot。输出 operation 使用 strict
判别联合，identity 与 before/after 精确绑定，按
`kind + schema + relation + object identity` 稳定排序。M1 不推断 rename、不删除语义对象，
severity 只由 operation kind 的固定表派生。

## 5. Datasource transaction

一个 client 的固定顺序：

1. connect；
2. `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`；
3. 参数化设置 statement/lock/idle timeout；
4. readback `transaction_read_only=on`、server version、database identity；
5. 按稳定 cursor 分页执行固定 catalog SQL；
6. 在页间检查 `AbortSignal`，并把 signal 传给支持取消的 query；
7. 无论成功失败都 `ROLLBACK`，最后 release。

内部 schema、临时 schema 和未 allowlist schema 一律拒绝。Catalog row 必须先经过 strict row
decoder，不能以类型断言进入 snapshot。

## 6. Persistence and rollback

Additive migration 创建 immutable snapshots、append-only scan runs、immutable drift events 和
窄 RPC。所有行带完整 app/tenant/environment/datasource scope，Backend 只有 RPC execute，
Browser 无底表写权。关闭 scanner 后最后 snapshot 仍可读；不做 destructive down migration。

## 7. UI boundary

Physical Schema tree、selector 与 diff 都接收同一个 `snapshot_content_hash` 投影。所有页面
显示“物理证据，未发布为业务语义”；M1 不显示 Candidate/Published 成功样式，也不提供一键
发布动作。
