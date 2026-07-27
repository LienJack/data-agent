# U6 一次性 PostgreSQL Migration 生产安全合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` · `u6-research-migration-safety@1.0.0`
> 本文冻结维护窗口、已有数据 preflight、DDL 与回滚边界；不证明 `10590` 已生成、安装
> 或在 Hosted/Docker 通过。

本文是 U6 对已有数据库安装 `10590` 的唯一安全合同。对象、函数、ACL 与 Schema
Inventory 取 Database Surface；Terminal candidate key/FK 取 Terminal Reference Graph；
表/nullable CHECK 取 Execution Storage。本文不会产生第二条迁移链。
Key metadata/operation 与部署状态机取 Result Key Lifecycle。

## 1. 唯一产物与可维护源码

数据库 runner 只可执行：

```text
infra/supabase/apps/data-agent/migrations/
  20260725010590_app_data_agent_u6_research_authority.sql
```

可维护源码只放在
`infra/supabase/apps/data-agent/migration-sources/10590/*.sql.inc`，依次为：

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

确定性 renderer 只生成唯一 `10590`、
`infra/supabase/apps/data-agent/u6-schema-inventory.json` 和一个
`sha256:<64hex>` ledger 字面量；`.inc` 不进 runner。禁止 `CONCURRENTLY`、autocommit
片段、`\i`、远程 fetch、动态 SQL 文件发现、修改已登记同名 Migration 或新增
`10585/10600`、Platform/App 第二链。

## 2. Maintenance Manifest

维护窗口输入固定为 committed、无 secret 的
`infra/supabase/apps/data-agent/u6-migration-maintenance-manifest.json`：

```ts
type ExistingU6Relation =
  | "app_data_agent.artifacts"
  | "app_data_agent.memberships"
  | "app_data_agent.outbox"
  | "app_data_agent.run_attempts"
  | "app_data_agent.runs"
  | "platform.app_environment_lifecycle"
  | "platform.deployment_mappings";
type U6MigrationMaintenanceManifest = {
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
    qualified_name: ExistingU6Relation;
    approved_max_rows: number;
    approved_max_total_bytes: number;
  }>;
  manifest_hash: Sha256;
};
```

Schema 为 strict object：七张 Relation 各出现一次，按 qualified-name UTF-8 bytes
升序；row/byte 上限是 `0..9007199254740991`。`max_duration_ms=60000..7200000`，
`lock_timeout_ms=100..5000`，
`statement_timeout_ms=30000..1800000`，
`idle_in_transaction_session_timeout_ms=30000..300000`。Manifest 是跨 Hosted/Docker
稳定的策略输入，不含具体 deployment/database/window 时间，也不含密码、connection
string、token、raw project ref、KMS URI 或 key material。

唯一 migration executor identity 固定为 direct connection 的 PostgreSQL role
`postgres`；连接后到 COMMIT 前始终要求
`session_user=current_user='postgres'`，禁止 `SET ROLE`、impersonation、pooler
transaction mode 或 SECURITY DEFINER preflight。Runner 与 `10590` 都在任何
advisory/table lock、用户表读取或 DDL 前查 `pg_roles`，要求 exact 一行、
`rolcanlogin=true`、`rolbypassrls=true`。`rolsuper` 在 Hosted 可为 false、Docker
可为 true，但不构成授权、不得替代 BYPASSRLS；两侧共同的 full-row visibility
property 固定为 `rolbypassrls=true`。对七张 existing relation 还逐张断言当前 role
有 SELECT 且对 relowner `pg_has_role(...,'USAGE')=true`。任一不满足立即报
`U6_MIGRATION_EXECUTOR_UNSAFE`，且必须发生在 maintenance advisory/table locks 与
DDL 前；禁止关闭 RLS、改 policy 或以 filtered count 继续。凭据只由部署 secret 注入。

U6 的运行基线固定为 PostgreSQL 17；Inventory 必须断言
`server_version_num=170000..179999`。`transaction_timeout` 不由 Manifest 重复声明；
绝对时限只取已签 maintenance window。Renderer 固化
`U6_MIGRATION_ARM_SAFETY_MS=5000` 与
`U6_MIGRATION_MIN_EFFECTIVE_BUDGET_MS=30000`，两者进入 Inventory/hash。
PostgreSQL 16 及以下、未知 major 或不能设置该 GUC 的连接一律拒绝安装。

`u6-deployment-command-request-hash@1.0.0` 是七个 deployment function（含 Purge
双分支）的唯一 request codec：

```text
sha256(UTF8(protocol_version || "\0") ||
       UTF8(JCS(strict input object without request_hash)))
```

extra key、nullability 或 branch union 先按各分册拒绝，再 hash；数据库必须重算。
Codec conformance fixture 固定
`{"operation_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","protocol_version":P}`（只测
codec，不是完整 command）。八个 P/hash 向量依序为：

```text
u6-authority-manifest@1.0.0              sha256:1bd5bc3e4e55f4b0c896d00cfd34f5c455de4e4aafac138a8a6c8aeaf71e334c
u6-execution-policy-manifest@1.0.0       sha256:b5f214331a4cc1e52e65b973080fda99e18d9469d445e27da359e16483365fcb
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
  UTF8("u6-migration-maintenance@1.0.0\0")
  || UTF8(JCS(manifest without manifest_hash))
)
```

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

renderer strict 解析并把全部策略、排序后的 limits 与 hash 固化进 `10590`；运行时文件
与固化值任一差异即失败。受控 runner 只能使用 dedicated、非池化连接，并先断言 libpq
transaction status=`IDLE`。它在事务外按固定协议执行：

```text
SET SESSION transaction_timeout=0；pg_settings(setting=0,unit='ms') 回读
→ 设置 session-scope app.u6_maintenance_manifest_hash/window_id/
  window_expires_at/deployment_id/database_identity_hash
→ 用同一数据库 clock_timestamp() 计算 remaining_at_probe_ms
→ session_arm_ms = remaining_at_probe_ms - 5000
→ 要求 session_arm_ms>=30000 且 remaining_at_probe_ms<=max_duration_ms
→ 设置 app.u6_maintenance_session_arm_ms=session_arm_ms
→ SET SESSION transaction_timeout=session_arm_ms；pg_settings 逐数值回读
→ 不插入任何其他 SQL，立即执行 10590 的 BEGIN 与 bootstrap
```

这六个 maintenance GUC 都只是操作意图，不是授权；授权仍来自上述 exact executor、
ledger checksum 与连接边界。window id 必须等于固化值；expiry 必须在 DB time 后且
不超过 `max_duration_ms`。

`10590` 的 `BEGIN` 后第一条语句只能是无 DDL/用户表锁的 bootstrap。它先断言
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

`10590` 必须是一个显式事务，顺序固定：

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

取得全部 existing-relation 锁后，每张表先读取
`pg_total_relation_size(qualified_name)`；超过 approved bytes 立即
`U6_MIGRATION_RELATION_LIMIT_EXCEEDED`，且不执行 `count(*)`。未超限才执行 exact
`count(*)`，超过 approved rows 同样失败。禁止用 `reltuples`、采样或环境默认值代替。

`u6-schema-inventory@1.0.0` 还必须为每个 existing-table 变更列出
`preflight_check_id/query_hash/expected_count=0`。renderer 生成全限定、无调用方输入的
SQL，并至少覆盖：

- 新 candidate key 的 duplicate/null；Attempt exact UQ 必须包含 `worker_fence`；
- 新 FK 的 orphan 与跨 `S`/Run/Principal/Attempt/Fence 换绑；
- 新 NOT NULL、safe integer、状态/nullable、reserved current tuple 与 kind CHECK；
- 既有 Artifact current tuple、Relation pair identity 与 Membership UUID/type 漂移；
- 预期 role/schema/extension/table/trigger/function 已存在且 owner/ACL 没有未知漂移；
- 将新增的 constraint/index/function/policy/trigger 名称无异 Hash 冲突。

任一 check 非零或 query hash 不匹配报 `U6_MIGRATION_DATA_PREFLIGHT_FAILED`，错误只含
check id/count，不回显业务行。所有 preflight 均在七张表锁定后执行；检查通过与 DDL
之间不释放锁。

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
  executor identity/BYPASSRLS/七表 visibility、PG major、extension schema/version 与
  Migration name/hash。

所有 SQL 使用 schema-qualified 名称和空 search path；禁止 `CASCADE`、`GRANT ALL`、
default-privilege 扩权、临时关闭 RLS/trigger/constraint 或 `session_replication_role`
旁路。

## 6. 失败、恢复与部署对等

任何 Manifest、窗口、锁、容量、数据、DDL、VALIDATE、Catalog、ACL 或 postcondition
失败都必须回滚整个事务：无 ledger、U6 对象、constraint、index、trigger、role
membership、GRANT 或 policy 残留。COMMIT 后 runner 只在同名同 hash 时跳过；同名异
hash 失败关闭，禁止 checksum override 或直跑 SQL。

Hosted Supabase 与 Docker PostgreSQL 使用同一 renderer、Manifest/limits、Inventory、
Migration bytes 与 Oracle；两侧 executor 都必须是 `postgres` 且 BYPASSRLS，只有
`rolsuper`、session 绑定的 deployment/database identity 与 window expiry 可不同。
Docker 测试不得因本地 superuser 跳过 BYPASSRLS assertion。Hosted 未取得维护窗口或
relation 超限时必须拒绝安装，不能把 Docker clean install 当生产升级证据。

## 7. 必需 Oracle

- populated 表存在 duplicate/orphan/null/range/reserved-tuple 漂移时，preflight 失败且
  Catalog/ledger/ACL 零变化；
- `data_agent_backend`、`service_role`、自建 non-bypass role、`SET ROLE postgres` 与
  pooled/impersonated session 都在 advisory/table lock/DDL 前
  `U6_MIGRATION_EXECUTOR_UNSAFE`；用 RLS 只可见一部分行构造隐藏 duplicate/orphan，
  也不得得到 zero-count 假通过；
- 任一 existing relation 有 writer 锁时 `NOWAIT` 失败，无死锁、无无限等待、无部分 DDL；
- bytes/rows 等于阈值成功，大于阈值失败；失败错误不泄露业务行；
- normal unique index、`NOT VALID → VALIDATE` 在同一事务闭合，Catalog exact；
- job cleanup function/owner/ACL、retained receipt 与 Terminal deferrability 和
  Cleanup Inventory exact；cleanup helper 的锁序/权限/RLS 漂移，或多/少一张 relation、
  一个 rank、一条 deferred FK 均失败；
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
