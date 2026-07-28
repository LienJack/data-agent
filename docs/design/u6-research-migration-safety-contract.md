# U6 PostgreSQL Migration 生产安全合同

> `FROZEN_DESIGN_CONTRACT / PARTIAL_IMPLEMENTATION` ·
> `u6-research-migration-safety@1.1.0`
> `10590` 已作为本地 PG17 Oracle 基线提交；C2 候选作者管线已实现，但正式
> `10600`、PG17 C2 Oracle 与 Hosted/Docker 尚未实现。

本文是 U6 安装 `10590→10600` 的唯一安全合同。二者位于同一 application forward-only
迁移链，不是 Platform/App 第二链。对象、函数、ACL/Inventory 取 Database Surface；
Receipt/Hash 取 Derivation，Terminal FK 取 Reference Graph，执行表取 Execution
Storage，Key/deployment state 取 Result Key Lifecycle。

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

多、少、重名、大小写变化或顺序变化任一 segment 都失败；renderer 不得按目录排序推断
闭集。现有 renderer 对 `10590` 只允许 verify；C2 renderer 只生成唯一 `10600`、升级后的
`u6-schema-inventory` 与 `10600` 的 `sha256:<64hex>` ledger，同时验证升级 Inventory
仍含上述 immutable `10590` name/hash。`.inc` 不进 runner。禁止
`CONCURRENTLY`、autocommit、`\i`、远程 fetch、动态文件发现、修改已登记 Migration，
或在 `packages/platform/migrations`/`infra/supabase/platform/migrations` 建第二链。

`10600` 必须先逐字验证已登记 `10590` name/hash 与 baseline Inventory，再以一个显式事务
完成 additive Receipt/Budget/Input Event 表、v2 tuple、函数替换、Artifact Run-first
guard、Owner/RLS/ACL/Inventory。现有预算 Head 不猜测回填：标为
`LEGACY_BUDGET_EPOCH_UNPROVABLE`，正向 Root 失败。它复用本文 executor、timeout、
maintenance lock、preflight、rollback/restore 与 Hosted/Docker 双连接 Gate；任何环境若
尚未安装 `10590`，runner 仍按 `10590→10600` 顺序安装，禁止 squash 同名旧 hash。

## 2. Maintenance Manifest

维护窗口输入固定为 committed、无 secret 的
`infra/supabase/apps/data-agent/u6-migration-maintenance-manifest.json`：

```ts
type ExistingU6C1Relation =
  | "app_data_agent.artifacts"
  | "app_data_agent.memberships"
  | "app_data_agent.outbox"
  | "app_data_agent.run_attempts"
  | "app_data_agent.runs"
  | "platform.app_environment_lifecycle"
  | "platform.deployment_mappings";
type U6C1MigrationMaintenanceManifest = {
  protocol_version: "u6-migration-maintenance@1.0.0";
  migration_name:
    "20260725010590_app_data_agent_u6_research_authority.sql";
  deployment_scope: {
    app_id: ImmutableId;
    deployment_binding: "SESSION_ACTIVE_MAPPING";
    database_binding: "SESSION_DATABASE_IDENTITY";
  };
  maintenance_window: {
    window_id: ImmutableId;
    max_duration_ms: number;
  };
  timeouts: {
    lock_timeout_ms: number;
    statement_timeout_ms: number;
    idle_in_transaction_session_timeout_ms: number;
  };
  relation_limits: ReadonlyArray<{
    qualified_name: ExistingU6C1Relation;
    approved_max_rows: number;
    approved_max_total_bytes: number;
  }>;
  manifest_hash: Sha256;
};
```

`10600` 使用独立
`infra/supabase/apps/data-agent/u6-c2-migration-maintenance-manifest.json`。其 Schema
不是把 C1 的 relation union 换一个 migration name，而是以下独立 strict tuple：

```ts
type ExistingU6C2Relation =
  | "app_data_agent.artifacts"
  | "app_data_agent.memberships"
  | "app_data_agent.outbox"
  | "app_data_agent.research_artifact_commit_operations"
  | "app_data_agent.research_authority_capabilities"
  | "app_data_agent.research_domain_terminals"
  | "app_data_agent.research_resource_reservations"
  | "app_data_agent.research_resource_run_heads"
  | "app_data_agent.research_stop_terminal_commits"
  | "app_data_agent.run_attempts"
  | "app_data_agent.runs";
type RelationLimit<Name extends ExistingU6C2Relation> = {
  qualified_name: Name;
  approved_max_rows: number;
  approved_max_total_bytes: number;
};
type U6C2MigrationMaintenanceManifest = {
  protocol_version: "u6-c2-migration-maintenance@1.0.0";
  migration_name:
    "20260725010600_app_data_agent_u6_research_derivation.sql";
  deployment_scope: {
    app_id: ImmutableId;
    deployment_binding: "SESSION_ACTIVE_MAPPING";
    database_binding: "SESSION_DATABASE_IDENTITY";
  };
  maintenance_window: {
    window_id: ImmutableId;
    max_duration_ms: number;
  };
  timeouts: {
    lock_timeout_ms: number;
    statement_timeout_ms: number;
    idle_in_transaction_session_timeout_ms: number;
  };
  relation_limits: readonly [
    RelationLimit<"app_data_agent.artifacts">,
    RelationLimit<"app_data_agent.memberships">,
    RelationLimit<"app_data_agent.outbox">,
    RelationLimit<"app_data_agent.research_artifact_commit_operations">,
    RelationLimit<"app_data_agent.research_authority_capabilities">,
    RelationLimit<"app_data_agent.research_domain_terminals">,
    RelationLimit<"app_data_agent.research_resource_reservations">,
    RelationLimit<"app_data_agent.research_resource_run_heads">,
    RelationLimit<"app_data_agent.research_stop_terminal_commits">,
    RelationLimit<"app_data_agent.run_attempts">,
    RelationLimit<"app_data_agent.runs">,
  ];
  manifest_hash: Sha256;
};
```

C2 exact set 就是上述十一张：实际 ALTER/ACL/function row/FK existing parent 的闭包。
`artifacts/runs/outbox/run_attempts` 服务 owner committer、吸收态与 ACL；
`memberships/research_authority_capabilities` 是 Receipt parent；
`research_artifact_commit_operations` 增加 Snapshot binding；其余四张承载
Budget/Terminal 变更。新表另由 Inventory closed set 断言；新增 existing parent 必须先
修订合同、Manifest、rank 与 Oracle。

`10600` 还以同签名 `CREATE OR REPLACE` 升级
`platform.reject_immutable_mutation()`，不得 ALTER/重建既有 trigger。执行前后
`pg_proc.oid` 必须相同；完整 `tgfoid` dependency set 取 Cleanup 分册，其中可 cleanup 的
app 子集由 16 增至 28，其他 dependency deny-only。除十一集已有三表外，其余 13 张
existing eligible relation 禁止 ALTER/ACL/policy/trigger DDL，故锁集不变。Inventory
冻结 signature/body hash/owner/ACL/`prosecdef=false`/language/volatility/空
search path/dependency set。

两个 Manifest 均 strict，不能交换 protocol/name/relation set。C1 七张、C2 十一张各
出现一次，按 qualified-name UTF-8 bytes 升序。row/byte 上限为
`0..9007199254740991`。
`max_duration_ms=60000..7200000`，
`lock_timeout_ms=100..5000`，
`statement_timeout_ms=30000..1800000`，
`idle_in_transaction_session_timeout_ms=30000..300000`。Manifest 跨 Hosted/Docker
稳定，禁止运行时 deployment/database/window identity 及 secret/KMS/key material。

唯一 migration executor identity 固定为 direct connection 的 PostgreSQL role
`postgres`；连接后到 COMMIT 前始终要求
`session_user=current_user='postgres'`，禁止 `SET ROLE`、impersonation、pooler
transaction mode 或 SECURITY DEFINER preflight。Runner 与所选 Migration 都在任何
advisory/table lock、用户表读取或 DDL 前查 `pg_roles`，要求 exact 一行、
`rolcanlogin=true`、`rolbypassrls=true`。`rolsuper` 在 Hosted 可为 false、Docker
可为 true，但不能替代 BYPASSRLS。对 target 的 exact existing relation set 逐张断言
当前 role 有 SELECT 且对 relowner
`pg_has_role(...,'USAGE')=true`：C1 是七张，C2 是十一张。任一不满足立即报
`U6_MIGRATION_EXECUTOR_UNSAFE`，且必须发生在 maintenance advisory/table locks 与
DDL 前；禁止关闭 RLS、改 policy 或以 filtered count 继续。凭据只由部署 secret 注入。

U6 的运行基线固定为 PostgreSQL 17；Inventory 必须断言
`server_version_num=170000..179999`。`transaction_timeout` 不由 Manifest 重复声明；
绝对时限只取已签 maintenance window。Renderer 固化
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

runner 只接受 target 参数 `"10590" | "10600"`，并从编译期 closed descriptor 选择
`migration_name/protocol/manifest path/migration path/source segment list/exact relation
set/expected checksum/prior migration`；不得接受调用方文件路径、name、hash、relation
override 或以目录 latest 推断 target。选择与 ledger 状态固定为：

```text
target=10590:
  10590 absent -> verify immutable renderer/manifest bytes, then execute 10590
  10590 exact sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678
    -> SKIP_EXACT
  10590 same name/different hash -> fail
target=10600:
  require 10590 exact
    sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678
    and baseline Inventory exact
  10600 absent -> verify C2 renderer/manifest bytes, then execute 10600
  10600 same name/exact compiled hash -> SKIP_EXACT
  10600 same name/different hash or 10590 absent/mismatched -> fail
```

clean install orchestrator 只能显式依次调用 `target=10590`、`target=10600`；populated C1
upgrade 只调用 `target=10600`。无论 target 如何，runner 都不得修改或重新 render
`10590`。renderer strict 解析并把全部策略、排序后的 target limits 与 hash 固化进对应
Migration；运行时文件与固化值任一差异即失败。

受控 runner 只能使用 dedicated、非池化连接，并先断言 libpq transaction
status=`IDLE`。跳过判定完成后，它对所选 target 在事务外按固定协议执行：

```text
SET SESSION transaction_timeout=0；pg_settings(setting=0,unit='ms') 回读
→ 设置 session-scope app.u6_maintenance_manifest_hash/window_id/
  window_expires_at/deployment_id/database_identity_hash
→ 用同一数据库 clock_timestamp() 计算 remaining_at_probe_ms
→ session_arm_ms = remaining_at_probe_ms - 5000
→ 要求 session_arm_ms>=30000 且 remaining_at_probe_ms<=max_duration_ms
→ 设置 app.u6_maintenance_session_arm_ms=session_arm_ms
→ SET SESSION transaction_timeout=session_arm_ms；pg_settings 逐数值回读
→ 不插入任何其他 SQL，立即执行所选 Migration 的 BEGIN 与 bootstrap
```

这六个 maintenance GUC 都只是操作意图，不是授权；授权仍来自上述 exact executor、
ledger checksum 与连接边界。window id 必须等于固化值；expiry 必须在 DB time 后且
不超过 `max_duration_ms`。

`10590` 与 `10600` 的 `BEGIN` 后第一条语句都只能是无 DDL/用户表锁的 bootstrap。它先断言
`pg_settings` 中已激活的 `transaction_timeout` 数值等于
`app.u6_maintenance_session_arm_ms`，捕获单一 `arm_now=clock_timestamp()`，再计算：

```text
effective_transaction_budget_ms =
  floor(extract(epoch from (
    window_expires_at::timestamptz - arm_now
  )) * 1000) - U6_MIGRATION_ARM_SAFETY_MS
```

预算须为 `30000..max_duration_ms`。Bootstrap 随后严格执行
`set_config('transaction_timeout','0',true)` 并验证 0，再执行
`set_config('transaction_timeout',effective_transaction_budget_ms||'ms',true)` 并从
`pg_settings(setting,unit='ms')` 数值回读；两步之间不得执行其他语句。正值回读后立即
捕获 `rearm_verified_at=clock_timestamp()`，并在任何锁/DDL 前断言：

```text
rearm_verified_at
  + effective_transaction_budget_ms * interval '1 millisecond'
  <= window_expires_at
```

进程若在取 `arm_now` 与 re-arm 之间停顿超过安全余量，该断言必须回滚。PostgreSQL 17
在事务中把一个正值改成另一个正值时不会缩短已激活 timer，因此禁止省略“先 0、再正值”
或声称 timer 自动回溯至事务起点。有效 timer 从 re-arm 时刻起算，但因预算来自绝对
DB window、预扣 `U6_MIGRATION_ARM_SAFETY_MS=5000` 且通过上述 deadline 断言，必须
先于窗口到期；最终 DB-clock 复验仍是第二道提交门。
`statement_timeout` 只约束单条语句，不能替代它。Runner 与 SQL 均禁止
`PREPARE TRANSACTION`/两阶段提交。

## 3. 单事务、超时与锁

两个 target 的共同规则是：每次只执行一个显式事务；bootstrap、timeout、executor、
database/deployment/window、advisory lock、目标 relation 容量检查、最终 DB-clock 复验
和 ledger-last 规则相同。relation 数量、preflight、DDL 与 postcondition 只取所选
descriptor，不存在“共同七表”。C1 `10590` 的 immutable 顺序仍固定为：

```text
BEGIN
→ 首条 bootstrap 验证 session arm，并按 clock_timestamp/window_expires_at
  将 transaction_timeout 精确 disable/re-arm
→ SET LOCAL lock_timeout / statement_timeout /
  idle_in_transaction_session_timeout（取固化 Manifest）
→ 校验 exact postgres/BYPASSRLS/七表 SELECT+owner membership、database identity、ledger、
  六项 maintenance GUC、PG17、窗口 DB time 与 active deployment mapping
→ 取得既有 data-agent migration advisory lock
→ 对七张 existing relation 按 qualified-name UTF-8 bytes 升序，
  在一个 LOCK TABLE 列表中 ACCESS EXCLUSIVE NOWAIT
→ 锁后重验 deployment/window/ledger
→ Relation 容量与已有数据 preflight
→ existing-table DDL
→ 新表、约束、函数、RLS、Owner 与 GRANT
→ Catalog/Inventory/postcondition exact assertion
→ 使用新的 clock_timestamp() 最终重验 window、deployment、database、Manifest 与 ledger
→ 最后写 Migration ledger
→ COMMIT
```

`10600` 不从 C1 流程删减或插入隐式阶段；它的 exact 顺序固定为：

```text
BEGIN
→ 首条 C2 bootstrap 验证 target=10600 session arm，按 DB window disable/re-arm
  transaction_timeout
→ SET LOCAL lock_timeout / statement_timeout /
  idle_in_transaction_session_timeout（只取 C2 Manifest）
→ 在任何用户表读取/锁/DDL 前校验 exact postgres/BYPASSRLS、C2 protocol/name/hash、
  十一表 SELECT+owner membership、database identity、六项 GUC、PG17、active deployment，
  并逐字校验 10590 ledger checksum sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678
  与 baseline Inventory
→ 依次调用既有 migration lock：`('platform',NULL)` 再 `('app',data-agent app_id)`；
  所有可替换 immutable guard 的 migration 同序持有到 COMMIT
→ 在一个 LOCK TABLE 列表中按 UTF-8 bytes 升序对 C2 exact 十一表执行
  ACCESS EXCLUSIVE NOWAIT
→ 锁后重验 deployment/window/database、C2 Manifest 与 immutable 10590 ledger/Inventory
→ 十一表依次做 bytes-before-count 容量 preflight，再执行 C2 Inventory 登记的全部
  data preflight；锁内 `runs` closed set 同时成为 pre-10600 Run 分类集合，任一失败时
  尚无 DDL
→ 按独立 10600 source segments 执行 existing columns/checks，并把该集合的每个 Run
  原子分类为 LEGACY Budget Head；给 Coverage/Stop v2 Artifact Commit Operation 增加
  exact Budget Snapshot binding，并把既有 Reservation 分类为 legacy epoch；随后建立
  Budget Policy/Event、
  Derivation Receipt、Input Event/Watermark、Terminal Receipt link、新 FK/index/trigger
→ 同事务 replace cleanup RPC + immutable guard，再替换其余 internal/Artifact/
  Resource/Stop/Resolver/Provisioner；安装 Owner、FORCE RLS、policy、ACL/GRANT
→ 对升级后的 Catalog 与 u6-schema-inventory 做 exact postcondition，并断言 C2 新表闭集、
  十一张 existing relation 的 alter/ACL/function-lock/FK-parent 闭包、新列/CHECK/FK、
  函数/trigger/ACL、
  immutable 10590 ledger exact、
  10600 ledger 尚不存在，以及升级 Inventory 的 10590+10600 migration 投影 exact
→ 用新的 clock_timestamp() 最终重验 window、deployment、database、C2 Manifest、
  immutable 10590 checksum 与 baseline Inventory
→ 事务最后一条业务写仅插入 10600 name+renderer checksum 到既有 Migration ledger
→ COMMIT
```

`10600` 的 preflight 前不得撤销 ACL、创建表或加列；postcondition 与 ledger 之间只能做
最终只读复验和上述单条 ledger INSERT。不得把 legacy Head 标记、函数替换或 GRANT 放到
事务外，也不得让 `10600` ledger 先于 postcondition 可见。

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

max 计算只允许读取已锁 C2 relation，并须通过 safe-integer/连续性 preflight；“无 Head
但有 Reservation”虽是异常旧形态，也按该公式分类，不能假定不存在、丢弃 Reservation 或
猜测起始时间。postcondition 要求 pre-10600 Run set 与 LEGACY Head 一一对应，且 epoch/
step seq/event seq/time/hash exact；多、少或 ACTIVE 任一行都回滚。`next_step_seq` 固定
`bigint NOT NULL`、无 default、CHECK `1..9007199254740991`，并进入 Inventory/Catalog
postcondition；迁移前没有 Step 表，所有
existing/missing-Head backfill 只能为 1，禁止从 Run/Attempt/Reservation 猜历史 step。
所有 pre-10600 Run 永久不得
进入 positive Root，调用方必须新建 Run，之后由首个 current `ResearchBrief@2` 事务创建
`ACTIVE` epoch 与 `BUDGET_OPENED`，并显式初始化 `next_step_seq=1`，不得把 legacy Head
原地激活。

所有 locked existing `research_resource_reservations` 同事务新增并 backfill
`budget_epoch=0/logical_step_id=NULL`；这是 legacy 标记，不得反推 Step。两列进入
Inventory/Catalog：`budget_epoch bigint NOT NULL CHECK 0..9007199254740991`，
`logical_step_id uuid NULL`。新 ACTIVE epoch 的 MODEL/SQL Reservation 必须
`budget_epoch>=1`、`logical_step_id` 非空并以完整 `S/run/budget_epoch/logical_step_id`
exact FK 到 Step；TOOL 可为 null。legacy epoch 0 只能搭配 null。

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

`u6-schema-inventory@1.0.0` 必须为所选 target 的每张 existing relation 列出非空
`maintenance_reasons[]`，值域仅
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
- 既有 Artifact current tuple、Relation pair identity 与 Membership UUID/type 漂移；
- 旧 cleanup RPC 的 OID/body hash/owner/ACL/prosecdef/空 search path exact，且在
  retained write/DELETE 前无条件 HOLD；其余 role/schema/object 无未知漂移；
- 将新增的 constraint/index/function/policy/trigger 名称无异 Hash 冲突。

任一 check 非零或 query hash 不匹配报 `U6_MIGRATION_DATA_PREFLIGHT_FAILED`，错误只含
check id/count，不回显业务行。C1 preflight 在其七张表锁定后执行，C2 preflight 在其
十一张表锁定后执行；检查通过与 DDL 之间不释放锁。

## 5. Existing-table DDL 规则

- 新表直接建立完整 PK/UQ/FK/CHECK，不使用 `NOT VALID`。
- Existing table 的 UQ 先在维护锁内执行普通 `CREATE UNIQUE INDEX`，再
  `ADD CONSTRAINT ... UNIQUE USING INDEX`；禁止 `CREATE INDEX CONCURRENTLY`。
- Existing table 的 FK/CHECK 可先 `NOT VALID`，但必须在同一事务
  `VALIDATE CONSTRAINT` 后才能进入 postcondition；不得提交未验证约束。
- Existing NOT NULL 只在 zero-null preflight 后设置；不得以长期弱 CHECK 冒充。
- Platform Schema 只允许 Database Surface 冻结的 Authority helper 与 Lifecycle
  identity immutable guard，以及 Cleanup 分册冻结的 cleanup evidence lock helper；
  Postcondition 对其他 Platform 对象差异失败。
- Inventory 逐字断言 cleanup helper 的 signature/owner/ACL/空 search path/zero-DML
  lock set、Platform Lock Owner 对五表的 SELECT 与逐表唯一 lock-column UPDATE、对应
  immutable guard/trigger、Cleanup Owner 的 Platform USAGE，及五表
  `relrowsecurity=false/relforcerowsecurity=false`；
  任一表已启用 RLS 必须在锁/DDL 前 HOLD，不得由 `10590` 暗加 policy 或关闭 RLS。
- Inventory 还须逐字匹配 Database Surface 冻结的三张 FORCE-RLS core lock 表之
  column grant、六条 RPC Owner policy，以及
  `backend_run_object_matches(uuid,uuid,text,uuid,boolean)` EXECUTE；不得放宽为 table
  UPDATE 或把 Outbox/Attempt 的 write predicate 改为 read。
- Inventory 必须为每张相关 relation 固化
  `cleanup_owner/scope_columns/identity_order/cleanup_phases[]`，phase 固定
  `cleanup_rank/cleanup_group/static_predicate_id/identity_order`，并逐条列出 Terminal
  aggregate 的 runtime/cleanup deferrability；`84-lifecycle-cleanup` 只能生成
  Cleanup 分册冻结的两张 retained receipt 表与唯一 job-only 函数。
- Catalog 必须逐字匹配 Inventory 的 column/default、PK/UQ/FK/CHECK/deferrability、
  index/predicate、function signature/attributes/owner、ACL/RLS/policy、trigger/sequence、
  executor identity/BYPASSRLS/所选 target exact relation visibility、PG major、
  extension schema/version 与
  Migration name/hash。

所有 SQL 使用 schema-qualified 名称和空 search path；禁止 `CASCADE`、`GRANT ALL`、
default-privilege 扩权、临时关闭 RLS/trigger/constraint 或 `session_replication_role`
旁路。

## 6. 失败、恢复与部署对等

任何 Manifest、窗口、锁、容量、数据、DDL、VALIDATE、Catalog、ACL 或 postcondition
失败都必须回滚整个 target 事务。C1 失败时无 `10590` ledger/U6 对象/constraint/index/
trigger/role membership/GRANT/policy 残留；C2 失败时 `10590` baseline 逐字保留，且无
`10600` ledger、新对象、alter、legacy classification、函数替换或 ACL 残留。COMMIT 后
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
- Hosted 与 Docker clean install、populated accepted install、contention 与 rollback
  Oracle 结果同构；两侧 Catalog 与 Inventory exact。
