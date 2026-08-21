# Legacy Attribution Destructive Cleanup — Design

## 1. Safety Boundary

```text
read-only inventory ──> canonical digest ──> pg_dump custom backup
       │                                           │
       └── exact 12-table allowlist                 └── sha256 + pg_restore --list
                         │
                         v
operational CLI ──> 10678 DB function ──> advisory + ACCESS EXCLUSIVE locks
                                             │
                                             ├─ recheck DB/system/env/ledger/schema
                                             ├─ recheck FK/hold/before counts/digest
                                             ├─ exact DELETE allowlist
                                             └─ immutable receipt + after=0
```

Migration、CLI 和 receipt 三层各自不能扩大 allowlist。Migration 只安装 authority，不执行清理；CLI 默认 inventory，
只有 `execute` + exact confirmation 才调用 destructive function。

## 2. 10678 Authority

### Inventory

`app_data_agent.legacy_attribution_cleanup_inventory(deployment_id)` 返回 strict JSON：

- `schema_version=legacy-attribution-cleanup-inventory@1.0.0`；
- app/environment/current database/`pg_control_system().system_identifier`；
- 10620 ledger checksum、10621 legacy zero ledger checksum、10621 source attestation checksum；
- 12 个 `{table_name,row_count,schema_fingerprint}`，按 code-unit table name 排序；
- `external_fk_count`、`hold_column_count`、`total_rows`；
- `inventory_digest=platform.canonical_sha256(document without digest)`。

Schema fingerprint 来自每个 target table 的 ordered columns、types、nullability、default、constraints、RLS/force-RLS，
避免只比较表名与 counts。

### Receipt

`legacy_attribution_cleanup_receipts` 是 app-global immutable audit，保存 request/receipt JSON 与 canonical hashes。
它不进入 target list，也不向 Web/Worker/browser roles 授权。`operation_id` 同 payload 重放原 receipt，异 payload
返回 `LEGACY_ATTRIBUTION_CLEANUP_OPERATION_CONFLICT`。

### Execute

`execute_legacy_attribution_cleanup(command jsonb)`：

1. strict key/schema/UUID/hash/timestamp/count/confirmation validation；
2. 只接受 `session_user=postgres`；
3. 校验 active deployment mapping；
4. advisory xact lock + 12 表 deterministic `ACCESS EXCLUSIVE` lock；
5. 事务内重算 inventory/digest，要求 external FK=0、hold column=0、counts exact；10679 forward repair 将 inventory
   row count 与 DELETE 都限定为 exact `app_id + environment`，同数据库其他环境永不进入本 operation；
6. backup verified timestamp 必须在过去 24 小时内，hash/system/database 与 command 绑定；
7. 逐表 exact DELETE，收集 counts；再次 inventory，要求全部为零；
8. 插入 immutable receipt，返回 `COMPLETED` 或 `NOOP`。

任何异常由 PostgreSQL statement/transaction 原子回滚。函数不 catch-and-continue。

## 3. Legacy 10621 Ledger Attestation

当前 generated 10621 migration 的 header checksum 是
`sha256:2d86b6622d4009169137716e398cc54f495d83114b69877ca2dbbc6b9049d26e`，但旧 renderer
把 ledger placeholder 规范化为 zero 后没有替回，live immutable ledger 因此保存 zero checksum。10678 不篡改该历史
ledger；它只在 migration preflight 与 inventory 中要求这个 exact known state、核验 10621 table/function closure，并记录
source attestation。未知值一律 HOLD。

## 4. Operational CLI

`scripts/legacy-attribution-cleanup.ts` 提供：

- `inventory`：打印 DB authority inventory；
- `backup-manifest --backup-file ... --inventory-file ...`：验证 file SHA-256 与 `pg_restore --list` 后生成 manifest；
  主机缺少 `pg_restore` 时使用只读 volume 的 PostgreSQL 17 container 校验同一 host file；
- `execute --inventory-file ... --backup-manifest ... --operation-id ... --retirement-commit 16f2734
  --confirm DELETE_LEGACY_ATTRIBUTION_AUTHORITY_ROWS_ONLY`：再次读取 live inventory，校验 files/hashes 后调用 DB function。

连接串只从 server environment 读取，输出必须 redact。执行 receipt 由 PostgreSQL签发，CLI 不复算 receipt hash。
新 operation 的 `requested_at` 确定性绑定 backup `created_at`；已有 operation 从 immutable request document 取回原值，
再以当前 inventory/backup/approval 重建 command，由 DB hash 门保证同 payload 幂等、异 payload conflict。

## 5. Current Preflight Snapshot

2026-08-22 对本地 `data_agent` PostgreSQL 17.10 的只读 preflight：12 个 target tables 均为 0 rows，external FK=0，
hold columns=0；`archive_mode=off`，因此不能声称有 PITR。执行前必须创建 custom-format pg_dump 作为明确的可恢复备份。
若执行时仍为零，权威结果应为 NOOP receipt；这仍完成精确 operational cleanup，但不等于删除了 generic 历史结果。

## 6. Executed Outcome

当前环境 inventory digest 为
`sha256:eef3d45e2b3aeade797aa7e229070160c13abbe9a3608fc23054e439c1b6f3c7`。完整 custom archive
SHA-256 为 `sha256:52dce34d6eebb835ea80974038c5b30db42b6bb49f3d6a3e856aa38d9c76639a`，除 TOC 校验外，
还在 disposable database 中按 `pre-data → post-data → data --disable-triggers` 完整恢复并核对 Run 39、Artifact 90、
Q&A 9、migration ledger 102、10678 checksum 与目标表 0 rows，随后删除 disposable database；主机备份保留。

operation `00000000-0000-4000-8000-000000000822` 返回并持久化
`NOOP / LEGACY_ATTRIBUTION_NO_ROWS_FOUND`，`total_deleted=0`，receipt hash 为
`sha256:91ccf090edc6943b5fa10df538167377b106cb8eff024deab1e2fc637eaaf0fb`。同 operation CLI 重放 byte-identical，
post inventory 仍为 0；通用 Run/Artifact/Q&A/ledger counts 未变化。

Trellis review 在 NOOP 后发现 10678 的动态 count/delete 尚未带 environment predicate；由于执行前全库目标行数为 0，
本次无误删。历史 migration/ledger 不改写，10679 以 exact-source fail-closed replacement 修复并在 live/fresh PostgreSQL
验证；其 checksum 为 `sha256:bdd263ebd13ba0025558f931b8419e51e1d4692f2eb51432c7b468ce75af7171`。
