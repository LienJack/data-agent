# Legacy Attribution Destructive Cleanup

## Goal

在旧归因产品 route/runtime 已退役后，通过环境限定、可审计、失败关闭的 operational command，
仅删除 10620/10621 引入的 Attribution 专属 authority rows。保留表/函数/合同/migration ledger、
controlled-attribution eval、通用 Run/Event/Artifact、Q&A、计费、身份和安全审计记录。

本任务已于 2026-08-22 收到新的执行指令。执行仍以 inventory digest、可恢复备份、精确引用/hold/count
同事务重验为前置条件；任何漂移必须返回 HOLD 且不发生部分删除。

## Requirements

### R1. Exact Allowlist

唯一允许删除的表是：

- 10620：`attribution_owner_map_release`、`attribution_relationship_promotion_receipt`、
  `attribution_conclusion_policy`、`attribution_signer_assignment`、
  `attribution_verification_key_revision`、`attribution_active_pointer`、`attribution_nonce_ledger`；
- 10621：`attribution_capability_directory`、`attribution_eligibility_decision`、
  `attribution_profile_request`、`attribution_safety_verdict`、`attribution_profile_projection`。

禁止 wildcard、schema-wide DELETE、TRUNCATE、DROP 或基于 URL/question/Artifact type 的启发式删除。

### R2. Shared Objects Are Protected

- 不删除通用 `runs`、`run_events`、`artifacts`、`workspace_run_bindings`、provider usage、billing、
  identity、membership、security/admin audit、QA directory/message 数据。
- 不删除或改写 controlled-attribution eval、Attribution contracts、F9 lifecycle source、10619–10621
  migration 文件或既有 migration ledger rows。
- 清理 receipt、backup manifest 和 post-check evidence 必须保留。

### R3. Authoritative Inventory

- PostgreSQL inventory 固定包含 app/environment/database/system identifier、12 表精确行数、schema fingerprint、
  external FK count、hold-column count 与 10620/10621 ledger attestation。
- `inventory_digest` 由 PostgreSQL canonical JSON 计算；CLI 只能原样传播。
- 当前 10621 renderer 的 legacy ledger 参数为 zero checksum，而 migration header/source digest 为非零；不得更新
  immutable ledger。10678 forward migration 必须显式 attestation 该已知状态并把它纳入 inventory digest。

### R4. Backup And Approval

- 执行前创建当前 `data_agent` 的 PostgreSQL custom-format backup，计算 SHA-256，并通过
  `pg_restore --list` 验证 archive 可读。
- backup manifest 绑定 database、system identifier、inventory digest、backup hash、created_at 和 restore-list result。
- operational command 必须接收精确确认短语 `DELETE_LEGACY_ATTRIBUTION_AUTHORITY_ROWS_ONLY`、唯一
  `operation_id`、retirement commit、expected counts/total 与 `NO_HOLDS` attestation。

### R5. Atomic Cleanup Authority

- 10678 普通 forward migration只安装 read-only inventory function、immutable cleanup receipt table 与窄执行函数；
  不包含 DELETE。
- actual DELETE 仅由独立 CLI 调用 DB function；函数仅允许 `postgres` session，使用 advisory lock 与 12 表
  `ACCESS EXCLUSIVE` lock，在同一事务重验 environment、digest、FK、hold、before counts 和 backup freshness；
  inventory count 与 DELETE 都必须限定 exact `app_id + environment`，其他 environment rows 必须存活。
- 任一不匹配整个 statement/transaction 回滚；同 operation 同 payload 幂等重放，同 operation 异 payload 失败。
- after counts 必须全部为零，删除总数与逐表 counts 进入 immutable receipt；零行时返回 `NOOP` 而非伪造删除。

### R6. Evidence And Redaction

- 公开 receipt 不包含连接串、密码、消息正文、用户数据或 backup 内容，只含标识、hash、counts、terminal 和 reason code。
- 保存 preflight inventory、backup manifest、execution receipt 与 shared-object before/after counts；对 artifact 目录执行
  Secret/PII scan。

## Acceptance Criteria

- [x] **AC1**：10678 renderer/source/generated migration exact match；migration 顶层无 destructive DML，唯一 DELETE
  只能封装在 postgres-only execution function 内，且无 TRUNCATE/DROP。
- [x] **AC2**：inventory 只枚举 12 个 allowlisted table，且 database/system/schema/ledger/FK/hold/count 均进入 digest。
- [x] **AC3**：wrong database/system/digest/count/approval/backup/hold/FK 或非 postgres caller 全部失败关闭且零副作用。
- [x] **AC4**：fresh PostgreSQL smoke 证明有行清理、零行 NOOP、same-operation replay、payload mismatch rollback、
  receipt immutability、shared Run/Artifact/eval survival 与其他 environment Attribution row survival。
- [x] **AC5**：当前数据库 custom backup 的 SHA-256、`pg_restore --list` 与完整 disposable restore 均通过，manifest 绑定 preflight digest。
- [x] **AC6**：当前环境执行返回持久 receipt；deleted counts 精确，after counts 全零；若 before total 为零，必须明确
  `NOOP/LEGACY_ATTRIBUTION_NO_ROWS_FOUND`，不能声称删除了不存在的数据。
- [x] **AC7**：Web、Worker、Indexer、PostgreSQL/Neo4j health 保持正常，旧 `/analysis` 仍授权后重定向 `/qa`，正式归因
  请求仍为 `ATTRIBUTION_RUNTIME_NOT_READY`。
- [x] **AC8**：任务以 scoped commit 完成并归档；backup/receipt 可恢复，历史 generic data 未删除。

## Out Of Scope

- 删除 Attribution 表、函数、类型、合同或 migration ledger。
- 删除 generic Run/Artifact 或根据旧 URL/问题文本猜测历史归因结果。
- 重做未来归因产品。
