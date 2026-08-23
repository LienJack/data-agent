# U6 PostgreSQL Migration 生产安全合同

> `FROZEN_DESIGN_CONTRACT / PARTIAL_IMPLEMENTATION` ·
> `u6-research-migration-safety@1.1.0`
> `10590` 已作为本地 PG17 Oracle 基线提交；C2 候选作者管线已实现，但正式
> `10600`、PG17 C2 Oracle 与 Hosted/Docker 尚未实现。

本文是 U6 安装 `10590→10600` 的唯一安全合同。二者位于同一 application forward-only
迁移链，不是 Platform/App 第二链。对象、函数、ACL/Inventory 取 Database Surface；
Receipt/Hash 取 Derivation，Terminal FK 取 Reference Graph，执行表取 Execution
Storage，Key/deployment state 取 Result Key Lifecycle；C2 exact 20-addition/11-existing
tuple 与 Catalog facets 取 `u6-c2-physical-schema-descriptor-contract.md`。

## 1. 唯一产物与可维护源码

数据库 runner 按序只可执行：

```text
infra/supabase/apps/data-agent/migrations/
  20260725010590_app_data_agent_u6_research_authority.sql
  20260725010600_app_data_agent_u6_research_derivation.sql
```

`10590` 及其 ledger/inventory hash 自提交起不可修改。已冻结的 migration checksum 是
`sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678`，
Maintenance Manifest hash 是
`sha256:70b5acaf260521a4b8d8581ca2f33dcebbeb6cd826315d3c246cfa80b35f0723`；
升级 Inventory 必须继续逐字登记这两个旧值，不得以 `10600` 重算或覆盖。其可维护源码
历史投影是 `migration-sources/10590/*.sql.inc`；C2 只在
`migration-sources/10600/*.sql.inc` 与独立 renderer 中新增 forward DDL。`10590` 顺序为：

```text
00-preamble
10-existing-table-alterations
20-capability-key-metadata
30-artifact-authority
40-frontier-readiness
50-resource
60-invocation-system-records
70-cross-fks-indexes-triggers
80-internal-functions
81-root-rpcs
82-resource-invocation-rpcs
83-resolvers-provisioner
84-lifecycle-cleanup
90-rls-owner-grants
99-postconditions-commit
```

`10600` renderer 不复用或动态发现上述顺序；它只接受以下独立 closed list，并按此顺序
逐字连接：

```text
00-preamble.sql.inc
10-existing-relation-preflight-alterations.sql.inc
20-budget-policy-events.sql.inc
30-derivation-receipts.sql.inc
40-input-event-watermark.sql.inc
50-terminal-receipt-links.sql.inc
60-cross-fks-indexes-triggers.sql.inc
70-internal-functions.sql.inc
71-run-locked-artifact-rpcs.sql.inc
72-budget-resource-guard-rpcs.sql.inc
73-stop-root-rpcs.sql.inc
74-resolvers-provisioner.sql.inc
80-lifecycle-cleanup.sql.inc
90-rls-owner-grants.sql.inc
99-postconditions-ledger-commit.sql.inc
```

segment 多/少/重名/大小写/顺序漂移均失败，禁止目录推断。10590 renderer 只 verify；
C2 只生成唯一 `10600`、
`u6-schema-inventory-candidate@2.0.0`、升级后的
`u6-schema-inventory@2.0.0` 和 `sha256:<64hex>` ledger，并验证 plural `migrations`
保留 immutable 10590 name/hash；Candidate v2 绑定 reviewed
`physical_descriptor_hash`。`.inc` 不进 runner；禁止
`CONCURRENTLY`、autocommit、`\i`、远程 fetch、动态文件发现、修改已登记 Migration，
或在 `packages/platform/migrations`/`infra/supabase/platform/migrations` 建第二链。

`10600` 先验 10590 name/hash 与 baseline Inventory，再单事务安装 Receipt/Budget/Input
Event、v2 tuple、函数、Run-first guard、Owner/RLS/ACL/Inventory。旧 Budget Head 标
`LEGACY_BUDGET_EPOCH_UNPROVABLE`，正向 Root 失败；复用本文 executor/timeout/lock/
preflight/rollback/Hosted-Docker Gate。缺 10590 时仍按 10590→10600，禁止 squash。

## 2. Maintenance Manifest

维护窗口输入固定为 committed、无 secret 的
`infra/supabase/apps/data-agent/u6-migration-maintenance-manifest.json`：

```ts
type RelationLimit<Name extends string> = {
  qualified_name: Name;
  approved_max_rows: number;
  approved_max_total_bytes: number;
};
type MaintenanceManifest<P extends string, N extends string, R extends string> = {
  protocol_version: P;
  migration_name: N;
  deployment_scope: {
    app_id: ImmutableId;
    deployment_binding: "SESSION_ACTIVE_MAPPING";
    database_binding: "SESSION_DATABASE_IDENTITY";
  };
  maintenance_window: { window_id: ImmutableId; max_duration_ms: number };
  timeouts: {
    lock_timeout_ms: number;
    statement_timeout_ms: number;
    idle_in_transaction_session_timeout_ms: number;
  };
  relation_limits: ReadonlyArray<RelationLimit<R>>;
  manifest_hash: Sha256;
};
type ExistingU6C1Relation =
  | "app_data_agent.artifacts" | "app_data_agent.memberships"
  | "app_data_agent.outbox" | "app_data_agent.run_attempts"
  | "app_data_agent.runs" | "platform.app_environment_lifecycle"
  | "platform.deployment_mappings";
type U6C1MigrationMaintenanceManifest = MaintenanceManifest<
  "u6-migration-maintenance@1.0.0",
  "20260725010590_app_data_agent_u6_research_authority.sql",
  ExistingU6C1Relation
>;
```

`10600` 使用独立
`infra/supabase/apps/data-agent/u6-c2-migration-maintenance-manifest.json`。其 Schema
不是把 C1 的 relation union 换一个 migration name，而是以下独立 strict tuple：

```ts
type ExistingU6C2Relation =
  | "app_data_agent.artifacts" | "app_data_agent.memberships"
  | "app_data_agent.outbox"
  | "app_data_agent.research_artifact_commit_operations"
  | "app_data_agent.research_authority_capabilities"
  | "app_data_agent.research_domain_terminals"
  | "app_data_agent.research_resource_reservations"
  | "app_data_agent.research_resource_run_heads"
  | "app_data_agent.research_stop_terminal_commits"
  | "app_data_agent.run_attempts" | "app_data_agent.runs";
type U6C2MigrationMaintenanceManifest = MaintenanceManifest<
  "u6-c2-migration-maintenance@1.0.0",
  "20260725010600_app_data_agent_u6_research_derivation.sql",
  ExistingU6C2Relation
>;
```

C2 existing exact set 就是上述十一张 ALTER/ACL/function-lock/FK-parent 闭包：
`artifacts/runs/outbox/run_attempts` 服务 owner committer、吸收态与 ACL；
`memberships/research_authority_capabilities` 是 Receipt parent；
`research_artifact_commit_operations` 增加 Snapshot binding；其余四张承载
Budget/Terminal 变更。新增 relation 另由 Physical Schema Descriptor 断言为 15 张 core
semantic + 5 张 parent-specific companion 的 exact 20，与 15 个 source segments
独立验证。新增 existing parent 必须先修订合同、Manifest、rank 与 Oracle。

`10600` 以同签名 `CREATE OR REPLACE platform.reject_immutable_mutation()`，不得
ALTER/重建 trigger；前后 `pg_proc.oid` 相同，Cleanup 分册的 `tgfoid` 可清理 app 子集
16→28，其余 deny-only。除十一集已有三表外，另 13 张 eligible existing relation 禁止
ALTER/ACL/policy/trigger，锁集不变。Inventory 冻结函数 signature/body hash/owner/ACL/
`prosecdef=false`/language/volatility/空 search path/dependency set。

两个 Manifest strict 且 protocol/name/relation set 不可交换；C1 七张、C2 十一张各一次，
按 qualified-name UTF-8 bytes 升序。row/byte 为 `0..9007199254740991`；
`max_duration_ms=60000..7200000`、`lock_timeout_ms=100..5000`、
`statement_timeout_ms=30000..1800000`、
`idle_in_transaction_session_timeout_ms=30000..300000`。它们跨 Hosted/Docker 稳定，
不得含运行时 deployment/database/window identity 或 secret/KMS/key material。

唯一 executor 是 direct `postgres`；连接至 COMMIT 始终
`session_user=current_user='postgres'`，禁止 `SET ROLE`、impersonation、pooler
transaction mode、SECURITY DEFINER preflight。Runner 与 Migration 在任何用户表读取、
锁或 DDL 前查 `pg_roles` exact 一行且 `rolcanlogin/rolbypassrls=true`，并逐张断言 target
existing set（C1 七张/C2 十一张）的 SELECT 与 relowner
`pg_has_role(...,'USAGE')=true`。Hosted `rolsuper=false`、Docker `true` 均不能替代
BYPASSRLS；失败即在 maintenance lock 前报 `U6_MIGRATION_EXECUTOR_UNSAFE`，不得关闭
RLS、改 policy 或用 filtered count 继续。凭据仅由部署 secret 注入。

U6 固定 PostgreSQL 17，Inventory 断言 `server_version_num=170000..179999`；
`transaction_timeout` 不进 Manifest，绝对时限只取已签 window。Renderer 固化
`U6_MIGRATION_ARM_SAFETY_MS=5000` 与
`U6_MIGRATION_MIN_EFFECTIVE_BUDGET_MS=30000`，两者进入 Inventory/hash。
PostgreSQL 16 及以下、未知 major 或不能设置该 GUC 的连接一律拒绝安装。

`u6-deployment-command-request-hash@1.0.0` 是八个 deployment function 的唯一 request
codec。C1 七函数保持不变；C2 只新增第八个
`provision_u6_derivation_policy_manifest`。Purge 仍是一个函数的 Retention/Subject
Erasure 两个 strict protocol branch，不得误计为两个函数：

```text
sha256(UTF8(protocol_version || "\0") ||
       UTF8(JCS(strict input object without request_hash)))
```

extra key、nullability 或 branch union 先按各分册拒绝，再 hash；数据库必须重算。
Codec conformance fixture 固定
`{"operation_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","protocol_version":P}`（只测
codec，不是完整 command）。八函数因 Purge 双 branch 共有九个 P/hash 向量，依序为：

```text
u6-authority-manifest@1.0.0              sha256:1bd5bc3e4e55f4b0c896d00cfd34f5c455de4e4aafac138a8a6c8aeaf71e334c
u6-execution-policy-manifest@1.0.0       sha256:b5f214331a4cc1e52e65b973080fda99e18d9469d445e27da359e16483365fcb
u6-derivation-policy-manifest@1.0.0      sha256:ad54d771b008fdb11c1bc6e9245bb47352391a3eddca3af5446b003943272fa8
u6-result-key-stage@1.0.0                sha256:a467165bba7198ff55b69a644d079d61e75ed0c321d6d6063e4f4cadd28df9e6
u6-result-key-activate@1.0.0             sha256:4f85fba95dedfbb6d81a340e18350e808b5c5224d8170fbe50c7417eb7483fb4
u6-result-key-retire@1.0.0               sha256:8936ef5d7ca3af666da86dd233e114033b9c7d5c8ecf01c8d0c53d17a434536e
u6-result-key-compromise@1.0.0           sha256:01011e6bbac1ca95653f4c5895aa44073088f8fbbb72d49afc28990400c4ff5b
u6-audit-purge-retention@1.0.0           sha256:2f516716199841a82c826702d1a79e98f79493a1c0299ab2c7046c49397341f3
u6-audit-purge-subject-erasure@1.0.0     sha256:60cab37af3bfde3d485885a947327b259181c63357aa972f02d87ada5edcd03f
```

`manifest_hash` 固定为：

```text
sha256(
  UTF8(manifest.protocol_version || "\0")
  || UTF8(JCS(manifest without manifest_hash))
)
```

因此 C1 仍产生其已冻结的
`sha256:70b5acaf260521a4b8d8581ca2f33dcebbeb6cd826315d3c246cfa80b35f0723`，C2 必须使用
`u6-c2-migration-maintenance@1.0.0` domain；把 C1 domain 写死进 C2、跨 Manifest 复用
hash 或只比较 JSON body 都失败。

session 的 `database_identity_hash` 由数据库重算：

```text
sha256(
  UTF8("u6-migration-database@1.0.0\0")
  || UTF8(JCS([
    current_database(),
    manifest.deployment_scope.app_id,
    session.deployment_id,
    "sha256:28a47b75076c9248621af8dd9d0b16091693a2c44add6f3d0edad6bcff7d0ad4"
  ]))
)
```

最后一项必须来自 ledger 中 exact
`20260725000100_platform_foundation`，同名异 checksum 先失败。

runner 只接受 `"10590"|"10600"`，从编译期 closed descriptor 取
`migration name/protocol/manifest+migration path/segments/relation set/checksum/prior`；
禁止 caller override 或目录 latest。令
`H10590=sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678`：

```text
target=10590:
  absent -> verify immutable renderer/manifest bytes -> execute
  exact H10590 -> SKIP_EXACT
  same name/different hash -> fail
target=10600:
  require 10590 exact H10590 + baseline Inventory exact
  absent -> verify C2 renderer/manifest bytes -> execute
  same name/exact compiled hash -> SKIP_EXACT
  same name/different hash or bad 10590 -> fail
```

clean install 依次调用 10590→10600，populated C1 只调用 10600；均不得改写/render
10590。renderer 将 strict 策略、排序 limits 与 hash 固化进 Migration，运行时漂移失败。

runner 仅用 dedicated 非池化连接，先断言 libpq status=`IDLE`；skip 判定后在事务外执行：

```text
SET SESSION transaction_timeout=0；pg_settings(setting=0,unit='ms') 回读
→ 设置 session-scope app.u6_maintenance_manifest_hash/window_id/
  window_expires_at/deployment_id/database_identity_hash
→ 同一 DB clock_timestamp() 计算 remaining_at_probe_ms；
  session_arm_ms=remaining_at_probe_ms-5000
→ 要求 session_arm_ms>=30000 且 remaining_at_probe_ms<=max_duration_ms
→ 设置 app.u6_maintenance_session_arm_ms=session_arm_ms
→ SET SESSION transaction_timeout=session_arm_ms；pg_settings 逐数值回读
→ 无其他 SQL，立即 Migration BEGIN/bootstrap
```

六个 GUC 仅表达意图，不授权；仍须 exact executor/ledger/connection。window id 等于
固化值，expiry 在 DB time 后且不超过 `max_duration_ms`。

两 target 的 BEGIN 首句只能是零 DDL/用户锁 bootstrap：先断言激活的
`transaction_timeout=app.u6_maintenance_session_arm_ms`，取单一
`arm_now=clock_timestamp()` 并计算：

```text
effective_transaction_budget_ms =
  floor(extract(epoch from (
    window_expires_at::timestamptz - arm_now
  )) * 1000) - U6_MIGRATION_ARM_SAFETY_MS
```

预算须为 `30000..max_duration_ms`；随后连续执行并数值回读
`set_config('transaction_timeout','0',true)`、再
`set_config('transaction_timeout',effective_transaction_budget_ms||'ms',true)`。
正值后立即取 `rearm_verified_at=clock_timestamp()`，锁/DDL 前断言：

```text
rearm_verified_at
  + effective_transaction_budget_ms * interval '1 millisecond'
  <= window_expires_at
```

arm→re-arm 停顿超余量即回滚。PG17 正值覆盖正值不会缩短 active timer，故必须先 0 再
正值；timer 从 re-arm 起算，绝对 DB window、预扣 5000ms、deadline 与最终 DB-clock
共同保证到期前终止。`statement_timeout` 不可替代；Runner/SQL 禁止
`PREPARE TRANSACTION`/2PC。

## 3. 单事务、超时与锁

每个 target 只执行一个显式事务；bootstrap、timeout、executor、database/deployment/
window、advisory lock、容量、最终 DB-clock 与 ledger-last 规则相同。relation、
preflight、DDL、postcondition 只取所选 descriptor，不存在“共同七表”。C1 顺序固定为：

```text
BEGIN
→ 首条 bootstrap 验证 arm，按 DB window disable/re-arm transaction_timeout
→ SET LOCAL 三个 timeout（固化 Manifest）
→ 验证 postgres/BYPASSRLS、七表 SELECT+owner membership、database/deployment/window、
  ledger、六项 GUC、PG17
→ 取得既有 data-agent migration advisory lock
→ 七表按 qualified-name UTF-8 升序一次 ACCESS EXCLUSIVE NOWAIT
→ 锁后重验 deployment/window/ledger
→ 容量/data preflight → existing DDL → 新表/constraint/function/RLS/Owner/GRANT
→ Catalog/Inventory/postcondition exact
→ 新 clock_timestamp() 终验 window/deployment/database/Manifest/ledger
→ ledger-last
→ COMMIT
```

`10600` 不删减 C1 安全阶段或插入隐式阶段，顺序固定为：

```text
BEGIN
→ 首条 bootstrap 验证 target=10600 arm，按 DB window disable/re-arm transaction_timeout
→ SET LOCAL 三个 timeout（C2 Manifest）
→ 读表/锁/DDL 前验证 postgres/BYPASSRLS、C2 protocol/name/hash、十一表 SELECT+owner
  membership、database/deployment、六项 GUC、PG17、10590 ledger
  sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678
  与 baseline Inventory
→ migration lock `('platform',NULL)` → `('app',data-agent app_id)`，持至 COMMIT
→ 十一表按 UTF-8 升序一次 ACCESS EXCLUSIVE NOWAIT
→ 锁后重验 deployment/window/database/C2 Manifest/10590 ledger+Inventory
→ 十一表 bytes-before-count，再执行 Inventory data preflight；锁内 runs 即 pre-10600
  分类闭集，失败时零 DDL
→ 按 10600 segments 安装 existing columns/checks，原子分类 LEGACY Head/Reservation，
  给 Coverage/Stop v2 Artifact Operation 加 Wire protocol+Budget Snapshot binding，再建
  exact 20 relation（15 core+5 companion）、Terminal Receipt link、FK/index/trigger
→ 同事务 replace cleanup RPC + immutable guard，再替换其余 internal/Artifact/
  Resource/Stop/Resolver/Provisioner；安装 Owner、FORCE RLS、policy、ACL/GRANT
→ Catalog+v2 Inventory exact postcondition：新表闭集、十一表 maintenance 闭包、新列/
  CHECK/FK/function/trigger/ACL、10590 exact、10600 ledger absent、双 migration 投影 exact
→ 新 clock_timestamp() 终验 window/deployment/database/C2 Manifest/10590/Inventory
→ ledger-last：仅插入 10600 name+renderer checksum
→ COMMIT
```

`10600` 的 preflight 前不得撤销 ACL、创建表或加列；postcondition 与 ledger 之间只能做
最终只读复验和上述单条 ledger INSERT。不得把 legacy Head 标记、函数替换或 GRANT 放到
事务外，也不得让 `10600` ledger 先于 postcondition 可见。

existing ALTER 的 exact branch 必须在同一事务闭合：

- `research_artifact_commit_operations.wire_protocol_version` 从
  `candidate_json #>> '{payload,protocol_version}'` 回填、设 NOT NULL，之后由 RPC
  显式写入；
  禁止 generated JSON column。`budget_receipt_id/hash` 只能 both-null 或
  both-present，Coverage/Stop v2 必须 present，legacy/v1 与其他 tuple 必须 null；
- `research_resource_run_heads` 完成 backfill 后所有 seq/epoch 列均无长期 default，
  新 RPC 显式写整行；
- Reservation 的 ACTIVE MODEL/SQL 必须 exact Step；ACTIVE TOOL 可为 NULL，非 NULL
  时仍须 exact Step；legacy epoch 0 只允许 NULL；
- StopCommit 的 Stop Receipt ID/Hash 在 zero-row preflight 后固定 NOT NULL +
  both-present；DomainTerminal 使用 separately named both-or-neither 与
  authority/terminal branch CHECK，不能只依赖 Root function。

正式 constraint 名称、表达式与 exact FK 只取 Physical Schema Descriptor；自动命名或
实现后反向接受 live Catalog 均不允许。

Legacy 分类没有 nil-path 例外。取得十一表锁后，`runs` 的 exact locked rows 是迁移开始时的
pre-10600 Run set；迁移持锁期间不能新增 Run。对已有
`research_resource_run_heads` 行，`10600` 保留已验证的
`next_reservation_seq`，新增并设置
`next_step_seq=1/next_budget_event_seq=1/budget_epoch=0/
budget_epoch_state='LEGACY_BUDGET_EPOCH_UNPROVABLE'/
budget_started_at=NULL/last_budget_event_hash=NULL`。对没有 Head 的既有 Run，必须在同一
事务插入一行 LEGACY Head：

```text
next_reservation_seq =
  coalesce(max(locked matching research_resource_reservations.reservation_seq), 0) + 1
next_step_seq = 1
next_budget_event_seq = 1
budget_epoch = 0
budget_epoch_state = LEGACY_BUDGET_EPOCH_UNPROVABLE
budget_started_at = null
last_budget_event_hash = null
```

max 仅读已锁 C2 relation，并过 safe-integer/连续性 preflight；“无 Head 有 Reservation”
也按公式分类，不丢弃或猜 started_at。postcondition 要求 pre-10600 Run 与 LEGACY Head
一一对应，epoch/step/event/time/hash exact，出现多/少/ACTIVE 即回滚。`next_step_seq`
为 `bigint NOT NULL`、无 default、CHECK `1..9007199254740991`；回填后
`next_reservation_seq/next_step_seq/next_budget_event_seq/budget_epoch` 均无长期 default，
ACTIVE/LEGACY RPC 显式写入。迁移前无 Step 表，step backfill 只能为 1，不从
Run/Attempt/Reservation 猜历史。pre-10600 Run 永久拒绝 positive Root；新 Run 首个
current `ResearchBrief@2` 事务才建 `ACTIVE` epoch、`BUDGET_OPENED`、
`next_step_seq=1`，禁止原地激活 legacy Head。

locked Reservation 同事务回填 `budget_epoch=0/logical_step_id=NULL`，不得反推 Step；
Inventory/Catalog 固定 `budget_epoch bigint NOT NULL CHECK 0..9007199254740991`、
`logical_step_id uuid NULL`。ACTIVE MODEL/SQL 要求 epoch≥1、非空 exact Step FK；
ACTIVE TOOL 可空，非空也须 exact FK；legacy epoch 0 只配 null。

Relation 锁竞争保留 SQLSTATE `55P03`，runner 报
`U6_MIGRATION_LOCK_CONTENDED` 并停止；Migration 内不得 catch 后继续。超时分别报
`U6_MIGRATION_DDL_TIMEOUT`、`U6_MIGRATION_IDLE_TIMEOUT` 或
`U6_MIGRATION_TRANSACTION_TIMEOUT`；最终复验发现窗口已过报
`U6_MIGRATION_WINDOW_EXPIRED`。不得用无限等待、降低锁级别、
跳表、重排、`lock_timeout=0` 或重试局部语句规避维护窗口。外层可以在新的窗口内从头
重跑整个 Migration，不能从某个 `.inc` 续跑。

`U6_MIGRATION_*` 仅是 deployment runner diagnostic，不进入 public
`U6PlatformErrorCode` 或应用 API。

## 4. 容量与已有数据 preflight

取得所选 target 的全部 existing-relation 锁后，每张表先读取
`pg_total_relation_size(qualified_name)`；超过 approved bytes 立即
`U6_MIGRATION_RELATION_LIMIT_EXCEEDED`，且不执行 `count(*)`。未超限才执行 exact
`count(*)`，超过 approved rows 同样失败。禁止用 `reltuples`、采样或环境默认值代替。

immutable `u6-schema-inventory@1.0.0` 只描述已提交 10590 baseline；C2 target
`u6-schema-inventory@2.0.0` 必须以 plural `migrations=[10590,10600]` 保留其逐字投影，
并为 10600 的每张 existing relation 列出非空 `maintenance_reasons[]`，值域仅
`ALTER|ACL|FUNCTION_LOCK|IMMEDIATE_FK_PARENT`，并为其变更或 parent closure 列出
`preflight_check_id/query_hash/expected_count=0`。renderer 生成全限定、无调用方输入的
SQL，并至少覆盖：

- 新 candidate key 的 duplicate/null；Attempt exact UQ 必须包含 `worker_fence`；
- 新 FK 的 orphan 与跨 `S`/Run/Principal/Attempt/Fence 换绑；
- 新 NOT NULL、safe integer、状态/nullable、reserved current tuple 与 kind CHECK；
- C2 对 locked pre-10600 Run set 检查 Resource Head/Reservation 的 exact Scope/Run FK、
  `reservation_seq` 连续性与 `next_reservation_seq=max(seq)+1`；Head 缺失是须分类的
  nil-path，不是跳过 Run 的理由；preflight projection 还固定
  `next_step_seq=1`、Reservation `budget_epoch=0/logical_step_id=null`；
- C2 pre-DDL 断言 Coverage/Stop v2 Artifact Operation、全部 StopCommit、RESEARCH_STOP
  non-ready DomainTerminal 均为零，禁止合成历史 Receipt；v1 Operation 保留，DDL 后新
  Snapshot 列必须为 null，再由 postcondition 验证新列/CHECK/FK；
- Artifact Operation 的 `wire_protocol_version` 只从 strict
  `candidate_json #>> '{payload,protocol_version}'` 回填，null/unknown/与 Registry
  tuple 不一致失败；
  Budget Receipt ID/Hash、Stop Receipt ID/Hash 任一 half-pair 均失败；
- exact 20 张新增 relation 的 parent/Ref candidate key、companion path/ordinal
  duplicate/null/orphan 与 JSON/展开列换绑；JSONB 不能被计作 FK；
- 既有 Artifact current tuple、Relation pair identity 与 Membership UUID/type 漂移；
- 旧 cleanup RPC 的 OID/body hash/owner/ACL/prosecdef/空 search path exact，且在
  retained write/DELETE 前无条件 HOLD；其余 role/schema/object 无未知漂移；
- 将新增的 constraint/index/function/policy/trigger 名称无异 Hash 冲突。

任一 check 非零或 query hash 不匹配报 `U6_MIGRATION_DATA_PREFLIGHT_FAILED`，错误只含
check id/count，不回显业务行。C1 preflight 在其七张表锁定后执行，C2 preflight 在其
十一张表锁定后执行；检查通过与 DDL 之间不释放锁。

## 5. Existing-table DDL 规则

- exact 20 张新表直接建立完整 PK/UQ/FK/CHECK，不使用 `NOT VALID`；15 张 core
  semantic table 与 5 张 companion 分别验证，不能由 15 个 source segments 推断。
- Existing table 的 UQ 先在维护锁内执行普通 `CREATE UNIQUE INDEX`，再
  `ADD CONSTRAINT ... UNIQUE USING INDEX`；禁止 `CREATE INDEX CONCURRENTLY`。
- Existing table 的 FK/CHECK 可先 `NOT VALID`，但必须在同一事务
  `VALIDATE CONSTRAINT` 后才能进入 postcondition；不得提交未验证约束。
- Existing NOT NULL 只在 zero-null preflight 后设置；不得以长期弱 CHECK 冒充。
- Platform Schema 仅允许 Database Surface 的 Authority/Lifecycle immutable helper 与
  Cleanup evidence-lock helper；其他对象差异 postcondition 失败。
- Inventory 逐字断言 cleanup helper signature/owner/ACL/空 search path/zero-DML lock、
  Lock Owner 对五表的 SELECT+逐表 lock-column UPDATE、guard/trigger、Cleanup Owner
  Platform USAGE，及五表 `relrowsecurity/relforcerowsecurity=false`；已启用 RLS 须在
  锁/DDL 前 HOLD，不得由 10590 暗加/关闭。
- Inventory 还须逐字匹配 Database Surface 冻结的三张 FORCE-RLS core lock 表之
  column grant、六条 RPC Owner policy，以及
  `backend_run_object_matches(uuid,uuid,text,uuid,boolean)` EXECUTE；不得放宽为 table
  UPDATE 或把 Outbox/Attempt 的 write predicate 改为 read。
- Inventory 必须为每张相关 relation 固化
  `cleanup_owner/scope_columns/identity_order/cleanup_phases[]`，phase 固定
  `cleanup_rank/cleanup_group/static_predicate_id/identity_order`，并逐条列出 Terminal
  aggregate 的 runtime/cleanup deferrability；`84-lifecycle-cleanup` 只能生成
  Cleanup 分册冻结的两张 retained receipt 表与唯一 job-only 函数。
- Catalog 必须逐字匹配 Physical Schema Descriptor 与 v2 Inventory 的
  column/default、PK/UQ/FK/CHECK/deferrability、
  index/predicate、function signature/attributes/owner、ACL/RLS/policy、trigger/sequence、
  executor identity/BYPASSRLS/所选 target exact relation visibility、PG major、
  extension schema/version 与
  plural Migration name/hash。Candidate Inventory protocol 固定
  `u6-schema-inventory-candidate@2.0.0` 并绑定 `physical_descriptor_hash`；C1 live v1
  Inventory 在 C2 COMMIT 前保持 immutable。

所有 SQL 使用 schema-qualified 名称和空 search path；禁止 `CASCADE`、`GRANT ALL`、
default-privilege 扩权、临时关闭 RLS/trigger/constraint 或 `session_replication_role`
旁路。

## 6. 失败、恢复与部署对等

任何 Manifest、窗口、锁、容量、数据、DDL、VALIDATE、Catalog、ACL 或 postcondition
失败都必须回滚整个 target 事务。C1 失败时无 `10590` ledger/U6 对象/constraint/index/
trigger/role membership/GRANT/policy 残留；C2 失败时 `10590` baseline 逐字保留，且无
`10600` ledger、20 张新增 relation、existing alter、legacy classification、函数替换或
ACL 残留；live Inventory 仍为 immutable v1。COMMIT 后
runner 只在同名同 hash 时跳过；同名异 hash 失败关闭，禁止 checksum override 或直跑
SQL。

Hosted Supabase 与 Docker PostgreSQL 使用同一 renderer、Manifest/limits、Inventory、
Migration bytes 与 Oracle；两侧 executor 都必须是 `postgres` 且 BYPASSRLS，只有
`rolsuper`、session 绑定的 deployment/database identity 与 window expiry 可不同。
Docker 测试不得因本地 superuser 跳过 BYPASSRLS assertion。Hosted 未取得维护窗口或
relation 超限时必须拒绝安装，不能把 Docker clean install 当生产升级证据。

## 7. 必需 Oracle

- strict parse 交换 C1/C2 protocol/name、给 C2 十一表多/少/重排/重复任一 relation、复用
  C1 七表或 runtime override limit 时，均在 advisory/table lock 前失败；
- 从 C2 Manifest 分别移除 Membership、Authority Capability 或 Artifact Commit Operation，
  或让新增 immediate FK/函数锁访问第十二张 existing parent，renderer/Inventory 必须
  失败；不得在 SQL 执行期取得未登记 parent/rank；
- `target=10600` 遇到 10590 absent/旧 hash 不符/baseline Inventory 漂移时零锁零 DDL；
  clean install 必须显式走 `10590→10600`，C2 不得 render/覆盖 immutable 10590；
- 10600 source segment 多、少、重名或重排时 renderer 失败；中断 C2 任一 segment 或
  ledger 前均完整恢复 10590 baseline，无 10600 ledger/对象/ACL 残留；
- Candidate Inventory 不是 `u6-schema-inventory-candidate@2.0.0`、缺
  `physical_descriptor_hash`、target 不是 `u6-schema-inventory@2.0.0` plural
  migrations，或 exact additions 不是 15 core + 5 companion 时，均在执行 SQL 前失败；
  15 source segments 与 15 core tables 不得按 ordinal 一一映射；
- 任一 variable-length Artifact Ref 只存 JSON、companion 缺/重/乱序、strict Ref JSON
  与展开 identity/type/revision/hash 或 exact Artifact FK 不一致时失败；Budget historical
  input replay 必须使用已存 Event chain/Reservation projection，不读取当前 state 冒充
  历史输入；
- populated C1 中同时覆盖“已有 Head”“无 Head 无 Reservation”“无 Head 有锁定
  Reservation”三种 Run：升级后每个 pre-10600 Run 恰有一个按公式生成的 LEGACY Head，
  started/hash 均为 null、step/event seq 均为 1，既有 Reservation 均为
  `epoch=0/logical_step_id=null`，positive Root 全拒绝；新 ACTIVE genesis 的 step seq=1，
  MODEL/SQL 非空 Step FK、TOOL nullable，migration 不得猜测历史 step/started_at；
- populated 表存在 duplicate/orphan/null/range/reserved-tuple 漂移时，preflight 失败且
  Catalog/ledger/ACL 零变化；
- `data_agent_backend`、`service_role`、自建 non-bypass role、`SET ROLE postgres` 与
  pooled/impersonated session 都在 advisory/table lock/DDL 前
  `U6_MIGRATION_EXECUTOR_UNSAFE`；用 RLS 只可见一部分行构造隐藏 duplicate/orphan，
  也不得得到 zero-count 假通过；
- 任一 existing relation 有 writer 锁时 `NOWAIT` 失败，无死锁、无无限等待、无部分 DDL；
- bytes/rows 等于阈值成功，大于阈值失败；失败错误不泄露业务行；
- normal unique index、`NOT VALID → VALIDATE` 在同一事务闭合，Catalog exact；
- Artifact Operation protocol 回填/null/branch、Budget Receipt pair、Resource Head
  no-default、ACTIVE TOOL nullable-or-exact-Step、Stop/Domain Receipt pair 的每个正反例
  均在 PG17 Catalog/constraint Oracle 通过；
- Cleanup function/owner/ACL/retained receipt/deferrability exact；guard replacement
  必须 platform→app lock 串行、OID 不变、`tgfoid` 16→28 exact。伪 GUC、UPDATE、
  Platform DELETE、并发 replacement 与 cleanup rank/FK 漂移均失败；
- VIEWER 的 READ-authorized RPC 可锁 exact Run 但不能 UPDATE；不能锁
  Outbox/RunAttempt。Owner/Analyst write path 可按序锁三表，任何实际 core UPDATE 失败；
- 在每个 `.inc` 边界和 ledger 前强制中断，均观察零残留并可从头重装；
- 连接预存 0、极短或超长 `transaction_timeout` 时，runner 要么在 session reset
  安全终止且零 DDL，要么回读 exact arm；旧长值不能延长窗口，旧短值不能被静默吞掉；
- probe 后延迟 `BEGIN` 至 window 过期，bootstrap 在 advisory/table lock 前失败；把
  timeout 延迟到 `BEGIN` 后才设置，或以正值直接覆盖 active 正值，都不能通过 Oracle；
- 令每条 statement 均短于 `statement_timeout`、总时长跨 expiry，并在 DDL 持锁段注入
  delay；连接与锁必须不晚于 `window_expires_at` 终止，Catalog/ledger/ACL 零残留。
  删除 disable/re-arm 任一步、关闭 timeout、换 PG16 或尝试 `PREPARE TRANSACTION`
  均失败；最终 clock 复验不能冒充对窗口外锁持有的预防；
- 同名同 hash 重跑只跳过，同名异 hash、Manifest/GUC/hash/window/deployment/database
  换绑失败；
- Candidate Receipt
  `candidate-enumeration-receipt@2.0.0`/`u6-candidate-enumeration-receipt@2` 在 Head
  advance 前后可逐字 replay `enumerator_head_version`；缺字段、v1 冒充或 DB-only
  隐藏列失败；
- Stop Receipt 只接受
  `research-stop-derivation-receipt@2.0.0`/`u6-stop-derivation-receipt@2` 与 Candidate
  v2 subordinate graph；Stop v1 discriminant 冒充新父图失败；
- Hosted 与 Docker clean install、populated accepted install、contention 与 rollback
  Oracle 结果同构；两侧 Catalog 与 v2 Inventory exact。

正式 `10600` checksum、function body hash/preflight query hash、PG17 live Catalog 与
rollback、Hosted Supabase/Docker parity 未产生前，状态保持
`FROZEN_TABLE_SURFACE / installable=false / Release=HOLD`。
