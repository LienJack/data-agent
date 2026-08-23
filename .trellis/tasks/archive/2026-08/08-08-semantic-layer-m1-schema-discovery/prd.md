# M1 PostgreSQL Schema Discovery

## Goal

让用户以最小权限连接 PostgreSQL 后，能够浏览确定性的物理表结构快照并比较 drift；整个
扫描过程只读取 catalog，不读取业务行、不写 datasource，也不把物理事实自动发布为业务
语义。

## Requirements

### M1-R1 — Strict catalog contracts

- 在 `@data-agent/contracts` 中定义版本化、strict 的 `SchemaScanRequest`、
  `PhysicalSchemaSnapshot`、`SchemaDriftEvent` 和稳定错误码。
- 请求不能携带 app/tenant/principal/role、password、DSN、任意 SQL 或自报 snapshot hash。
- Snapshot 必须覆盖 PostgreSQL 表/视图、列、物理类型、nullable/default/comment、
  identity/generated、PK/FK/unique/check/index。

### M1-R2 — Deterministic normalization and drift

- 全部对象使用结构化 identity 和固定 tuple 顺序；重复 identity 失败关闭。
- `captured_at`、scan run ID 与持久化 ID 不进入 content hash；同一事实重复扫描 hash 相同。
- Drift 必须穷尽 table/column/PK/FK/unique/check/index 的 add/remove/change，并稳定排序。
- Rename 不靠相似名称猜测；固定表达为 remove + add。`binding_impact` 在 M1 固定为
  `UNKNOWN`，不能自称已影响活动语义。

### M1-R3 — Read-only PostgreSQL adapter

- 一个 datasource client 完成 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`、超时设置、
  只读 readback、固定 catalog 查询、keyset pagination、rollback 和 release。
- Schema allowlist、page size、timeout 和 cancellation 由服务端上限约束。
- 只允许参数化的固定 `information_schema` / `pg_catalog` SQL；禁止调用方 SQL。
- 成功和失败都 `ROLLBACK`；权限、超时、取消和解析错误都不能泄漏原始数据库错误。

### M1-R4 — Authority persistence

- 通过 additive migration 保存 immutable snapshot、append-only scan run 和 immutable drift。
- 全部主键、唯一键、RLS、Grant、RPC 和幂等绑定完整 app/tenant/environment/datasource scope。
- Datasource 与 Data Agent Authority 数据库是两个本地事务域，不宣称跨库 exactly-once。

### M1-R5 — API and Physical Schema browser

- Web route 从 server Authority、datasource metadata 和 SecretRef resolver 组合扫描，不接受
  客户端 Authority 或明文凭据。
- 提供启动/读取 scan、读取 snapshot、读取 diff 的薄 API。
- Physical Schema tree、snapshot selector 和 drift diff 只渲染已解析投影，并明确标记
  “物理证据，未发布为业务语义”。

### M1-R6 — Stable terminals and redaction

- 稳定支持 CANCELLED、TIMEOUT、PERMISSION_DENIED、DATASOURCE_UNAVAILABLE、
  CATALOG_CONTRACT_INVALID、LIMIT_EXCEEDED、SCOPE_FORBIDDEN、IDEMPOTENCY_CONFLICT。
- 未知 driver/connector 错误统一映射为脱敏、可重试的 datasource unavailable。

### M1-R7 — Verification

- Contract、drift fixture、fake-client transaction ordering、PG17 最小权限/zero-write、
  authority migration、route redaction 和 UI identity 均有自动测试。
- M1 不包含 LLM、schema-to-semantic proposal 或活动语义发布。

## Acceptance Criteria

- [x] 同一 catalog fixture 重复规范化得到同一 content hash；重复 identity 与未知字段失败。
- [x] table/column/PK/FK/unique/nullability/type drift fixture 100% 精确命中且顺序稳定。
- [x] Adapter 只执行固定 catalog SQL，并证明 BEGIN/read-only/timeouts/query/ROLLBACK/release 顺序。
- [x] PG17 最小权限角色可以扫描 allowlist，但 INSERT/UPDATE/DELETE/DDL/sequence/越权函数失败。
- [x] timeout、cancel、permission 和未知 connector error 返回稳定脱敏终态。
- [x] Snapshot/scan/drift 持久化具备 scope isolation、immutable、replay/conflict 和 ledger 证据。
- [x] API 无 Authority/credential 覆盖；UI 的 tree/selector/diff 使用同一 snapshot identity。
- [x] 扫描与 drift 不创建 Candidate、ReviewPacket、Release 或 active pointer mutation。
- [x] 只提交 M1 owned files；既有 DataFoundry 与其他脏文件保持原样。

部署说明：M1 提供 strict metadata/egress/SecretRef/connector 组合器；没有部署侧 Secret Provider、
egress approval 与 metadata resolver 绑定时，默认 Web runtime 返回脱敏 503。这是显式 fail-closed
状态，不以请求 DSN、明文密码或未审批本地连接降级。

## Out of Scope

- MySQL、ClickHouse、Trino、Snowflake 等非 PostgreSQL connector。
- LLM mapping、Metric Agent、业务实体/指标自动创建、语义发布或 runtime grounding。
- 读取业务样例行、列统计或把外键自动等同为安全分析 Join。
- Neo4j 或其他第二写权威。
