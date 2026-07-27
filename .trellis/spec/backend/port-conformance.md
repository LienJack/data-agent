# Port Conformance

> Hosted、Docker 与 In-Memory Adapter 必须共享 Scope、幂等、终态和错误语义。
>
> U6 Research/Readiness Port 状态：
> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED`；当前 Conformance Fixture 尚未包含下述
> U6 Port，只有实现与真实 PostgreSQL Adapter 通过后才能标记交付。

## 场景：实现 Storage、Queue、Cache 或 Sandbox Adapter

### 1. 范围 / 触发条件

- 新增或修改 `StoragePort`、`QueuePort`、`CachePort`、`SandboxPort` 实现时适用。
- U1 的 In-Memory Fixture 是最小语义基线；U2、U4、U5、U9 的真实 Adapter 必须复用这些断言。

### 2. 签名

```ts
type AppScope = {
  app_id: string;
  tenant_id: string;
  environment: string;
};

StoragePort.put({ scope, key, content_hash, value });
QueuePort.enqueue({ scope, command_id, idempotency_key, payload });
QueuePort.lease({ scope, worker_id });
QueuePort.ack({ scope, lease_id, fencing_token });
CachePort.set({ scope, key, value, ttl_seconds });
authorizeModelProviderInvocation(request, resolveAvailableProfile);
authorizeExternalAgentInvocation(request, resolveServerOwnedProfile);
parseModelProviderEventForRequest(request, event);
parseExternalAgentEventForRequest(request, event);
parseBenchmarkAdapterEventForRequest(request, event);
authorizeBenchmarkAdapterReceipt(receipt, benchmarkAuthority);
SandboxPort.execute({
  schema_version,
  scope,
  run_id,
  execution_id,
  idempotency_key,
  language: "sql",
  budget: {
    timeout_ms,
    lock_timeout_ms,
    max_rows,
    max_bytes,
    max_memory_mb,
  },
  payload: {
    dialect: "postgresql",
    sql_artifact_ref,
    execution_permit_ref,
    resource_admission_ref,
    datasource_id,
    settings_hash,
    execution_settings,
    snapshot_requirement,
    parameters,
  },
});

// 仅从 @data-agent/contracts/server 导出；三个阶段是三个本地原子边界。
const preparation = await prepareSandboxExecution(request, sandboxAuthority);
const handle = await pythonSqlSandbox.start({
  ...resolveOperation(preparation.grant),
  grant: preparation.grant,
});
const outcome = await handle.outcome;
const transition =
  outcome.terminal === "FAILED"
    ? await failSandboxExecution(outcome, sandboxAuthority)
    : await finalizeSandboxExecution(outcome, sandboxAuthority);

await cancelSandboxExecution(
  {
    identity: preparation.grant.identity,
    expected_cancel_epoch: preparation.grant.cancel_epoch,
    requested_at,
  },
  sandboxAuthority,
);

createCoordinatedSandboxPort({
  authority: sandboxAuthority,
  python: pythonSqlSandbox,
  resolve_operation(grant) {
    return resolveDatasourceOperation(grant);
  },
});

for (const contractCase of PORT_CONFORMANCE_CASES) {
  await contractCase.run(createAdapterHarness);
}

// U6 目标 Port。capabilityInput 与 strictInput 必须是两个参数；
// strictInput 中的 scope/principal 只是待比较声明，不能自证 Authority。
type CapabilityInput = unknown;
type ArtifactReferenceFor<T extends KnownArtifactType> =
  ArtifactReference & Readonly<{ artifact_type: T }>;
type ReadinessRevocationReason =
  | "SEMANTIC_REVISION_CHANGED"
  | "SCHEMA_REVISION_CHANGED"
  | "DATA_SNAPSHOT_STALE"
  | "POLICY_CHANGED"
  | "IDENTITY_AUTHORITY_CHANGED"
  | "EVIDENCE_REVOKED"
  | "CERTIFICATE_TAMPERED";
type ResearchAgentRole =
  | "research-supervisor"
  | "semantic-sql"
  | "evidence"
  | "report-projector";

type ResearchArtifactCommitInput = Readonly<{
  schema_version: "1.0.0";
  scope: AppScope;
  run_id: string;
  attempt_id: string;
  worker_fence: number;
  candidate: L2ArtifactCandidate;
  expected_parent_ref: ArtifactReference | null;
}>;

type L2HistoricalDocument = Readonly<{
  document: L2ArtifactDocument;
  authority: "HISTORICAL_READ_ONLY";
  can_authorize_current: false;
}>;

interface ResearchArtifactAuthorityPort {
  commitCurrent(
    capabilityInput: CapabilityInput,
    input: ResearchArtifactCommitInput,
  ): Promise<PortResult<ArtifactReference>>;

  // 历史 Reader 不产生 Authority Brand，也不能被 Current/GO 路径调用。
  readHistorical(
    capabilityInput: CapabilityInput,
    reference: ArtifactReference,
  ): Promise<PortResult<L2HistoricalDocument | null>>;
}

// U6 平台与资源 Port 不在本文件复制字段：
// - CurrentReadinessPort / ResearchStopTerminalPort / ResearchVersionFrontierPort
//   唯一取自 docs/design/u6-research-platform-contract.md；
// - ResearchResourceReservationPort / ResearchInvocationPort
//   唯一取自 docs/design/u6-research-resource-invocation-contract.md；
// - Invocation 状态迁移唯一取自 docs/design/u6-invocation-state-contract.md。
// - System Record 生命周期唯一取自
//   docs/design/u6-system-record-lifecycle-contract.md。
// 实现由对应 strict Zod Schema infer 类型；Hosted/Docker/In-Memory Adapter 必须直接
// import 同一导出，禁止在 Adapter 内重声明“等价”Request/Result。
```

### 3. 契约

- 所有 Key、Idempotency Record 与 Lease 都绑定 `environment/app_id/tenant_id`。
- Scope 与业务 Key 使用无歧义的规范化数组编码，不使用字符串分隔符拼接。
- Storage 的同 Scope/Key/Hash/规范化内容重复写入返回 `created: false`。
- 同 Scope/Key 下 Hash 不同，或 Hash 相同但规范化内容不同，返回 `STORAGE_CONTENT_CONFLICT`。
- Queue 的 Idempotency 只在同 Scope 内生效。
- Queue 的同 Scope/Idempotency Key 只有在 Command ID 与规范化 Payload 都相同时才允许重放；同键异载荷必须显式冲突，不能静默返回旧 Command。
- Active Lease 绑定 Scope、Lease ID、Command、Fencing Token 与 `expires_at`；未到期 Command 不得重复 Lease，到期后才允许更高 Fence 接管；Ack 原子校验后完成 Command 并撤销 Lease。
- Cache 的 `authority` 固定为 `NON_AUTHORITATIVE`，不能保存唯一 Run/Artifact 真值。
- Cache 必须在精确 TTL 边界过期。
- Sandbox Request/Receipt 使用 strict、版本化 SQL/Python Schema；缺 `schema_version` 失败关闭。
- Sandbox Receipt 必须回显 Scope、Run、Execution ID、Idempotency Key、Input Hash 与内容寻址 Execution Hash；同键同输入重放同一 Receipt，同键不同输入返回冲突。
- SQL Sandbox Request 必须逐字段绑定已提交且当前有效的 `ExecutionPermit`、
  `ResourceAdmissionReceipt`、Datasource、Schema、PostgreSQL Settings 与五维预算；调用方
  不能只提交 SQL 和 Parameters 后让执行器自行猜测授权上下文。Request Parameters
  必须与同一内容寻址 `SqlArtifact` 的冻结 Parameters 做 Canonical Exact Match。
- Sandbox Resolver 返回的 Permit/SqlArtifact Payload 必须由事务内 Exact Revision
  Verifier 与完整 Reference 精确绑定；`verifyCommitted(ref A)` 不能替错误缓存返回的
  Payload B 背书，即使 B 自身的 Query Hash 合法也不得进入真实执行。
- Sandbox 在事务开始时重新验证 Permit Principal、PolicyReceipt、有效期和 Authority
  Epoch；Seal 后撤权、换绑 Policy 或跨过 `expires_at` 的请求不得开始执行。
- Sandbox 不得把独立 Authority PostgreSQL 与 Datasource 宣称为一个跨库事务。
  U5 固定为三个本地原子边界：
  `Authority Prepare -> Datasource RR/RO Execute -> Authority CAS Finalize`。
  Prepare 必须在 Authority 本地事务内完成 Permit/Policy 锁、Exact Revision、Fence、
  Claim/Lease 与 Grant；Datasource 必须在独立 `REPEATABLE READ READ ONLY`
  Transaction 内完成 Manifest/OID 复核与查询；Finalize/Fail 必须在 Authority 本地
  事务内按 Attempt/Lease/Fence/Cancel Epoch 做 CAS。
- ExecutionGrant 不是可重放的成功凭据，只能收窄到一个
  Scope/Run/Principal/Execution/Attempt/Fence/SQL/Snapshot/Budget。Datasource 已完成
  但 Authority Finalize 未提交的窗口必须进入 Lease Recovery 或
  `REPLAY_UNAVAILABLE`，不能伪报跨库 exactly-once。
- PostgreSQL SQL 必须在 Authority 创建 Claim 及 Python 创建子进程/连接 Datasource
  之前通过原生 AST 门禁。只允许当前 deterministic compiler 的单条
  `SELECT/WITH SELECT` 子集；`SqlArtifact.compiler_version` 必须是
  `postgresql-compiler@1.1.0`，所有 SQL Primitive、Operator 与 Cast 都必须显式限定
  到 `pg_catalog`。多语句、DML CTE、危险函数、子查询、越界 Relation、自定义
  Operator/Cast 与非参数化业务常量全部失败关闭，不能借当前 `search_path` 解析到用户
  Schema 中的同名对象。
- `CONTROLLED_REVISION` 的完整 schema/data manifest、精确 Relation/OID 校验和查询
  必须共享同一个 RR/RO Snapshot；不得在另一连接预检后复用结果。
- Snapshot Manifest 与 Query Result 使用两套不可混淆的预算。U5 的独立、版本化
  Manifest Runtime Ceiling 固定为最多 256 个 Relation、每 Relation 256 列、跨全部
  Relation 合计 10,000 行与 64 MiB JCS Digest Material；必须使用 PostgreSQL
  server-side cursor 小批读取并共享同一个总计数器，不能使用会让 libpq 或 Python
  先完整物化的 `fetchall()`。该固定 Ceiling 不是 Request 签名的 Result Budget，也
  不能被调用方放大。
- Datasource Transaction 的实际 `search_path` 必须由服务端固定：
  `NONE = [pg_catalog]`，`CONTROLLED_REVISION = [sealed_schema,pg_catalog]`；调用方
  不能追加或覆盖。Python 连接成功后、开始事务前，必须查询
  `data_agent_sandbox_control.datasource_identity`，并把数据库记录的
  `datasource_id/fingerprint` 与 Execution Grant 做精确匹配；连接字符串或调用方
  自报身份不能代替连接后的数据库事实。
- Authority Prepare 的 `authority_revalidation.revalidated_at` 可以早于 Datasource
  实际 `started_at`，但不能晚于该时间；Permit 必须继续以 Datasource 实际
  `started_at` 校验，而不是以较早的 Prepare 时间替代事务起点。Permit 只授权“在半开
  有效期内开始事务”；合法开始的事务不因执行中跨过
  `expires_at` 被改判失败，但 `completed_at - started_at` 和服务端记录的
  `elapsed_ms` 必须分别不超过同一 Timeout Budget，防止低报耗时绕过超时。
- Authority Claim 必须在 Prepare 本地事务内按
  `app_id + tenant_id + environment + principal_id + idempotency_key`
  原子 Claim/Load；`principal_id` 来自服务端解析的 Permit。同键同规范 Input Hash
  并发只签发一个 Active Attempt，同键异 Hash 在真实查询前冲突，不同 Principal
  使用同 Key 互不观察。终态重放必须返回最初提交的 Receipt；动态
  `authority_revalidation.revalidated_at` 不得改变幂等身份。
- Claim/Lease 的到期与恢复判定必须使用 PostgreSQL 数据库时钟，不能信任 Worker
  本地时间；本地时钟即使提前到 Lease 未来也不能抢占尚未到期的 Attempt。已提交
  `FAILED` 或 `CANCELLED` 的终态必须像 `COMPLETED` 一样稳定重放，不能在重启或重复
  请求时重新执行 Datasource。
- Cancel 必须在 Authority 行锁下比较 `expected_cancel_epoch` 并单调递增；旧 Attempt、
  旧 Fence 或旧 Epoch 的 Outcome 不得覆盖新 Attempt。Late Cancel 必须丢弃候选并
  提交 `CANCELLED`，不能伪称数据库已确认取消。
- 成功 Receipt 记录数据库实际应用的 Datasource、Schema、Settings、只读事务、
  Snapshot/Watermark、重放状态和资源用量；Request 中的期望值不能冒充实际执行事实，
  Receipt 的行数、字节数、耗时与峰值内存必须精确匹配服务端 Execution Record。
- `SandboxResult` 是内容寻址的严格二维结果，列名/类型、行列数、规范字节数和 Hash
  必须可重算并满足上限；Receipt 只能引用同一 Execution 的权威 Result。
- 完成 Outcome 的 `observed_rows` 必须等于 Result 行数，
  `observed_bytes = retained_canonical_bytes = Result.canonical_bytes`，且完成时
  `current_batch_estimated_bytes = 0`。实际进程 RSS 高水位可以作为观测事实，但
  `cgroup_memory_limit_enforced=false` 时不得把逻辑内存估计称为硬隔离。
- `text2sql_system_artifacts`、Execution Record 与事件是专用 System Authority：
  System Artifact append-only，Execution Record 每 Attempt 唯一且不可变，事件只追加；
  通用 `artifacts` 镜像不能代替领域 Authority。Browser 角色不得读取或写入，Backend
  只能在当前 App/Tenant/Environment 下读取并调用窄状态转换函数。
- Model Provider、External Agent 与 Benchmark Suite 使用彼此独立的版本化 Port；所有请求和响应 Artifact Reference 都必须与事件属于同一 App/Tenant/Environment/Run。
- Model Provider Port 只接受绑定同 Scope、Profile Version、Model ID 且已经 `AVAILABLE` 授权的调用。
- External Agent Port 只接受由服务端 Profile Resolver 授权的调用；请求只能收窄 Workspace Root、可写权限、Tool、Command ID 与超时预算，不能自行扩权。
- Model、External Agent 与 Benchmark 的每个流事件都必须用原始请求校验 Scope、Run、Attempt 及各自的 Request/Invocation/Adapter ID 与版本元组，不能只做孤立 Schema Parse。
- 所有 U6 Port 固定使用 `method(capabilityInput, strictInput)`。Adapter 先从
  `capabilityInput` 在同一数据库事务派生 Scope、Principal、Role、Deployment 与
  Authority Epoch，再逐项比较 `strictInput` 的声明；不得从请求 Header、Payload 或
  Agent 自报字段直接构造 Authority。公开返回统一为 `PortResult<T>`，错误不得泄漏
  Capability、SQL、原始 Projection 或数据库内部状态。
- `ResearchArtifactAuthorityPort.commitCurrent` 的 In-Memory 与 PostgreSQL Adapter
  都只接受 Wire Registry 中声明为 Current Writer 的严格元组及 `COMMITTED`
  Revision。V1、未知元组、Candidate/Rejected/Superseded 一律
  `L2_WIRE_VERSION_WRITE_UNSUPPORTED` 或 Schema 失败；`readHistorical` 只返回未品牌化
  历史文档，不能被 Current Readiness、Run Terminal 或 Release GO 消费。
  PostgreSQL Adapter 还必须在同一事务重新验证 Attempt、Lease、`worker_fence`、
  Exact Parent/Input Revision、Domain Semantic 与窄化 Committer Capability。
- U6 Domain Terminal/Consumption 使用独立数据库 Authority，不追加既有
  `run_events`，不经过 Runtime Reducer，也不改变 `run.completed`。历史
  `RunTerminal` 只追加且每 Run 最多一条；`CurrentReadiness` 是独立的
  `CURRENT | REVOKED` 可变状态。READY 后撤权只改变 current 状态，不把历史 READY
  改成 STALE；只有 DOMAIN_TERMINAL consume 与撤权竞争、撤权在 READY 提交前胜出且
  尚无 Terminal 时，该 consume 才提交唯一 `STALE/RUN_STALE`。单独撤权不创建
  RunTerminal。
- `CurrentReadinessPort.publish` 是创建 `CURRENT` 的唯一入口。只有无 Domain
  Terminal 时，才能用新的 exact Certificate/Frontier 执行 `ABSENT -> CURRENT`、
  `CURRENT -> CURRENT` 或 `REVOKED -> CURRENT` CAS；相同已撤 Certificate 不得复活，
  已有 Terminal 时必须创建新 Run。
- Publish 每次调用（含同键重放）都先锁 Run/Current/Frontier 并重验 current；同键
  同载荷且 exact Certificate 仍 CURRENT 才返原结果。Publish 后撤权再重放返回
  `CURRENT_READINESS_REVOKED`，历史 Publication 只供审计。
- CurrentReadiness、ReportReadGrant 与 RevocationOperation 的返回类型必须是 strict
  discriminated union，且与数据库 CHECK 使用同一状态/nullable 字段真值表。重发布
  新 Certificate 时 CURRENT 清空当前代 revocation pointer/time、保留单调
  `revocation_seq`；任何 schema-valid 但状态不可能的行都失败关闭。
- `CurrentReadinessPort.consume` 的两个 strict 分支是
  `DOMAIN_TERMINAL | REPORT_READ`。每次调用，包括相同 idempotency key 重放，都必须
  重新核验 exact `report-ready@2.0.0` Certificate、四张 Gate、Projection、Stop、
  material Support、Semantic/**Schema**/Data/Policy/Identity Frontier、
  Authority Epoch 与 current Revocation Head。`DOMAIN_TERMINAL` 只能返回
  `READY_COMMITTED | STALE_COMMITTED`；`REPORT_READ` 只能返回
  `GRANT_ISSUED`，不能顺便提交 Terminal。若历史 READY 已存在但 current 已
  `REVOKED`，重放返回 `CURRENT_READINESS_REVOKED` 错误并保留历史 READY，不能伪造
  `STALE_COMMITTED`。
  `REPORT_READ` 还必须锁定并验证同 Run、同 Certificate 的不可变
  `READY/RUN_READY` Domain Terminal；仅有 CURRENT row 或 STOP_READY 不能签 Grant。
- `CurrentReadinessPort.revoke` 使用独立服务级 Revocation Capability，不接受 Worker
  Lease/Fence 冒充，也不获得提交其他 Research Artifact 或执行 SQL 的权限。它必须
  创建/重放 `operation_id`；提交 L2 Revocation Receipt 时固定
  `envelope.attempt_id=operation_id` 且数据库 `worker_fence=0`
  (`SERVICE_OPERATION_FENCE`)。该值只允许专用 narrow committer 写入，普通 Research
  Committer 必须拒绝。重复同一规范输入幂等返回同一撤权结果。
- `ReportReadGrant` 必须绑定 exact Certificate/Report、认证派生 Principal、服务端
  Deterministic Report Projector 从 exact Report 生成的
  `canonical-response@1.0.0` immutable Projection/Digest、current readiness version、
  revocation seq、frontier hash 和短 TTL。Issue strict input 不接受调用方自报的
  Digest/Bytes；Response 也只读取并重投影已绑定 Report，不接受待发送 Bytes。
  JSONB 传输使用有界 base64url，Adapter 以域分离 SHA-256 重算。Issue、Consume、
  Response 是三个独立线性化点：
  `consumeGrant` 与 `commitResponse` 都重新锁定并核验 current Frontier/Revocation；
  Response CAS 成功前不得发送任何字节。撤权在 Response 前胜出时 Grant 进入
  `REVOKED`；Response 先胜出后才允许发送与服务端 Projection 逐字节相等的
  canonical bytes。
- `CurrentReadinessPort.commitGo` 必须在一个 PostgreSQL 事务内锁定 Current
  Readiness、五维 Frontier、Revocation Head、同一 exact Certificate 的不可变
  `READY/RUN_READY` Domain Terminal 与 Release Idempotency Row，解析全部 Release
  Evidence，调用 server-only GO Authorizer，并在释放锁前追加不可变
  ReleaseDecision Commit。每次调用（含同键重放）先重验 current 与 READY Terminal，
  再读取历史幂等结果；GO 后撤权再重放必须返回 `CURRENT_READINESS_REVOKED`，历史
  GO 只能用于审计。不得先返回普通 readiness snapshot 再在内存中签 GO。
  旧 `authorizeReleaseDecision(GO)` 直接调用固定返回
  `CURRENT_RELEASE_COMMIT_REQUIRED`；尚无 READY Terminal、V1、REVOKED、Frontier
  漂移或旧 Authority Epoch 均失败关闭。
- `ResearchResourceReservationPort` 必须完整实现
  `reserve/begin/settle/cancel/expire/markAbandoned`。Reserve
  按 `min(server,tenant,ResearchBrief)` 计算有效上限，并在
  tenant/principal/run 三个维度原子占位；Reservation ID、Resource Kind、请求 Hash、
  Brief/Policy、Reserved/Actual、TTL 与状态全部持久化。同键同载荷稳定重放，同键异
  载荷冲突；每次 Model/SQL/Tool 真实调用前必须 Begin 并绑定
  reservation_seq/lease/invocation/attempt/fence/request hash/bounds。只有未 Begin
  Reservation 可直接 Expire；IN_USE 到期但 Adapter 未确认终止时进入 ABANDONED 且不
  释放占位。迟到 Usage 仍 append-only 计费；实际超额记录 `SETTLED_OVER_LIMIT` 并
  阻断成功 Authority。
- `ResearchInvocationPort.authorizeAgentDataProjection` 只返回权威 Receipt 加进程内
  `AuthorizedAgentDataProjection`，不返回原始 Sandbox 行。调用方提供的 canonical
  Request 只是待验证 Candidate；Receipt 和返回值必须绑定
  exact Scope/Run/Attempt/Request、Provider/Profile Version/Model、Input References、
  字段 Allowlist、Lineage 分类、Redaction、小群组抑制、DLP、canonical egress bytes、
  byte/token count、Provider/Role Policy 与 tenant/scope Keyed HMAC。Profile 使用
  `profile_id + profile_version + profile_hash + certification_receipt_ref`，并绑定
  exact Model Reservation/Lease/Invocation；不能伪装成通用 Artifact Reference。
- `ResearchInvocationPort.invokeModel` 必须重新 canonicalize 最终
  Model Request 的 messages/tool allowlist，逐项匹配 Projection Receipt 的
  request/provider/profile/model、byte/token count 与 HMAC 后才调用 Adapter。授权
  一份 Projection 后替换 messages、增加 Tool、切换 Model 或 Request ID 都必须在
 真实 Provider 调用前失败；普通 SHA-256 不能用于低熵敏感值。
- U6 Port 的 Hosted、Docker 与 In-Memory Conformance 必须共享 Public Terminal 和
  Domain Reason 语义，但 In-Memory PASS 不能替代 PostgreSQL current-ready race、
  crash-recovery 或签名部署证据。
- Benchmark 与 Sandbox 的成功 Receipt 必须处于规定成功终态、引用已提交并经各自
  Authorizer 品牌化；通用 `isCommitted=true` 不能代替领域成功语义。Sandbox 的
  Registrar/Authorizer 只从显式 `@data-agent/contracts/server` 服务端组合子路径导出，
  不从 `@data-agent/contracts` 根导出；Text2SQL Compiler/Gate/Oracle Registrar 同理
  只从 `@data-agent/text2sql/server` 导出。验收必须使用真实 package specifier 组合，
  普通调用方不能通过根入口或结构化 callback 自签 Authority。
- `@data-agent/contracts/testing` 导出框架无关 `PORT_CONFORMANCE_CASES`；Vitest 只负责调用这些 Case，不能进入 Runtime Contract。

### 4. 校验与错误矩阵

| 条件 | 稳定结果 |
| --- | --- |
| 同 Scope/Key 不同内容 | `STORAGE_CONTENT_CONFLICT` |
| Queue 同 Scope/幂等键但 Command 或 Payload 不同 | `QUEUE_IDEMPOTENCY_CONFLICT` |
| 过期 Fencing Token | `QUEUE_STALE_FENCE` |
| Active Command 再次 Lease | `null` |
| 当前 Fence 搭配错误 Lease ID | `QUEUE_LEASE_MISMATCH` |
| 其他 Scope 尝试 Ack | `QUEUE_STALE_FENCE` |
| Ack 后再次 Lease | `null` |
| Cache TTL 到期 | `null` |
| Sandbox 同幂等键、不同规范输入 | `SANDBOX_IDEMPOTENCY_CONFLICT` |
| Sandbox 缺协议版本或 Response Reference 跨 Scope | Schema Parse 失败 |
| SQL Request 缺 Permit/Admission/Settings 或任一预算不一致 | `SANDBOX_EXECUTION_REQUEST_NOT_AUTHORIZED` |
| Reference A 对应的 Resolver 返回 Payload B | `SANDBOX_EXECUTION_REQUEST_NOT_AUTHORIZED` |
| Sandbox 同 Principal/Key 并发异规范输入 | `SANDBOX_IDEMPOTENCY_CONFLICT` |
| Seal 后 Policy 撤销、Principal/Policy 换绑或 Permit 已过期 | `SANDBOX_EXECUTION_REQUEST_NOT_AUTHORIZED` |
| SQL 多语句、DML CTE、子查询、越界 Relation 或非参数化业务常量 | `SANDBOX_SQL_SHAPE_REJECTED` |
| SQL 危险函数、自定义 Operator/Cast 或时钟/序列访问 | `SANDBOX_DANGEROUS_FUNCTION_REJECTED` |
| Manifest、Relation OID 或 Owner/Admin 在同一 Snapshot 内漂移 | `SANDBOX_SNAPSHOT_AUTHORITY_BREACH` |
| Python 观察到数据库实际 `search_path` 不等于策略固定值 | `SANDBOX_QUERY_FAILED` |
| 连接后的 Datasource ID/Fingerprint 与 Grant 不一致 | `SANDBOX_SNAPSHOT_AUTHORITY_BREACH` |
| Authority 重验证时间晚于 Datasource 实际开始时间 | `SANDBOX_EXECUTION_RECEIPT_NOT_AUTHORITATIVE` |
| Datasource 实际开始时间不在 Permit 半开有效期内 | `SANDBOX_EXECUTION_RECEIPT_NOT_AUTHORITATIVE` |
| Attempt/Lease/Fence/Cancel Epoch 与 Outcome 不一致 | `SANDBOX_OUTCOME_BINDING_MISMATCH` 或 `SANDBOX_STALE_EXECUTION_FENCE` |
| Datasource 已结束但没有可提交的完整 Outcome | `SANDBOX_EXECUTION_OUTCOME_UNKNOWN`，由 Lease Recovery 收敛 |
| Receipt 回显期望值但与数据库实际事务、Settings、Snapshot 不一致 | `SANDBOX_EXECUTION_RECEIPT_NOT_AUTHORITATIVE` |
| Result 行列形状、字节数、Hash、Schema 或 Execution 绑定不一致 | `SANDBOX_RESULT_NOT_AUTHORITATIVE` |
| Model 请求未绑定 `AVAILABLE` Profile | `MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED` |
| External Agent 请求扩大 Workspace/Permission/Budget | `EXTERNAL_AGENT_INVOCATION_NOT_AUTHORIZED` |
| 流事件与原始请求的 ID、Scope、Run、Attempt 或版本不一致 | `PORT_EVENT_CORRELATION_MISMATCH` |
| Benchmark/Sandbox 成功 Receipt 未提交或未授权 | 对应领域 Authority Error |
| U6 strictInput 的 Scope/Principal 与 Capability 不同 | `RESEARCH_CAPABILITY_SCOPE_MISMATCH` |
| V1/未知 Wire 元组尝试 `commitCurrent` | `L2_WIRE_VERSION_WRITE_UNSUPPORTED` |
| V1 尝试 current-ready/Grant/RunTerminal/GO | `READINESS_PROTOCOL_VERSION_UNSUPPORTED` |
| Current Readiness 缺 Semantic/Schema/Data/Policy/Identity 任一 Frontier | `READINESS_FRONTIER_INCOMPLETE` |
| SchemaSnapshot、Frontier Version/Hash 或 Authority Epoch 漂移 | `READINESS_FRONTIER_STALE` |
| 撤权先于 DOMAIN_TERMINAL consume 的 READY 提交 | consume 返回 `STALE/RUN_STALE`；不提交 READY/Grant |
| READY 已提交后撤权 | current=`REVOKED`；历史 READY 不变且不追加 STALE |
| READY 后撤权再重放 consume | `CURRENT_READINESS_REVOKED`，不把历史 READY 当 current |
| Grant 过期、已消费、已响应或已撤权 | `REPORT_READ_GRANT_NOT_CONSUMABLE` |
| Grant Consume 后、Response 前撤权 | `REPORT_READ_GRANT_REVOKED`，零响应字节 |
| Response canonical bytes 与 Grant Digest 不同 | `REPORT_READ_RESPONSE_DIGEST_MISMATCH` |
| Worker Fence 冒充服务撤权或 Service Fence 提交普通 L2 | `RESEARCH_AUTHORITY_FENCE_MISMATCH` |
| Reservation 同键异载荷或重复非法状态迁移 | `RESEARCH_RESOURCE_RESERVATION_CONFLICT` |
| 实际用量超过 Reservation | 记录 `SETTLED_OVER_LIMIT` 并返回 `RESEARCH_RESOURCE_LIMIT_EXCEEDED` |
| Active Cancel 解析到 COMPLETED | 不得 `CANCELLED`；写 `SETTLED` |
| Active Cancel 解析到任一超额 Usage | 不得 `CANCELLED`；写 `SETTLED_OVER_LIMIT` 并返回 Limit Error |
| Active Cancel 解析到 FAILED、Termination 匹配且未超额 | 唯一允许的 Active `CANCELLED` 分支 |
| Invocation 非法跳转、跨阶段复用 Key 或不同 Terminal | `RESEARCH_INVOCATION_TRANSITION_CONFLICT` 或 `RESEARCH_INVOCATION_TERMINAL_CONFLICT` |
| COMPLETED 的对应调用计数为 0 | Strict 拒绝，不释放 Reservation |
| Projection Receipt 与最终 Request bytes/provider/profile/model/request 不同 | `MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED` |
| Redis/Cache 丢失 | 从 PostgreSQL 权威状态重建 |

### 5. Good / Base / Bad

- Good：两个 App 使用相同业务 Key 时各自读写、去重和 Lease，互不观察。
- Base：同一请求重复投递只返回原 Command ID。
- Bad：Map 或 Redis 只以 `key`、`idempotency_key` 建索引。
- Sandbox Good：同一 sealed Snapshot 内先重算完整 Manifest/OID，再执行编译器 SQL，
  Outcome 经 Attempt/Fence/CAS 提交后可在 Authority 重启后重放同一 Receipt。
- Sandbox Base：Datasource 完成但 Finalize 前崩溃，Claim 保持可恢复状态并由 Lease
  Recovery 明确收敛，不生成成功 Receipt。
- Sandbox Bad：在 Authority 事务里返回“授权对象”，换一条 Datasource 连接执行任意
  SQL，再把调用方自报行数或期望 Settings 写成成功 Receipt。
- U6 Good：READY 已提交后撤权，历史 Terminal 保持 READY，current 变为 REVOKED，
  未响应 Grant 失效；任何路径都不修改 Runtime Event/Projection。
- U6 Base：同一 REPORT_READ 幂等请求每次都重新比较五维 Frontier 与 Revocation；
  仍 current 才重放相同 Grant，已撤权则拒绝。
- U6 Bad：把历史 READY UPDATE 成 STALE、凭历史 Consumption 绕过 current 检查，
  或在 Issue 时一次授权未来所有 Grant Consume/Response。
- Egress Good：Projection Authority 返回 exact canonical bytes 与 Receipt，Model
  Authority 对最终 Request 重算相同 HMAC/Byte/Token 后才调用 Provider。
- Egress Bad：只审核字段名或 Artifact Ref，随后让 Agent 自行拼接另一份 messages。

### 6. 必需测试

- 两个 App/Tenant 对相同 Storage/Cache Key 隔离。
- 两个 Scope 对相同 Idempotency Key 分别创建 Command。
- 同 Scope/幂等键的同载荷重放稳定，异 Command 或异 Payload 显式冲突。
- 伪造 Lease、跨 Scope Ack、重复 Ack 与 Ack 后空队列。
- Active Lease 未到期不可重复获取；到期后新 Worker 取得更高 Fence。
- Cache 拒绝非法 TTL，在 TTL 前可读、边界时刻过期。
- Sandbox 相同规范输入重放、不同输入生成不同 Hash、同键冲突。
- SQL Sandbox 对 Permit、Admission、Datasource、Schema、Settings 和五维预算做精确绑定；
  SQL Parameters 篡改、Seal 后撤权、过期、换绑 Principal/Policy 与 Authority Epoch
  漂移全部失败；Authority Fence 失败时真实查询 callback 不得运行。还要覆盖
  Reference A/Payload B 换绑、同 Principal/Key 同输入并发只执行一次、异输入在
  Operation 前冲突，以及同 Scope/Key 不同 Principal 隔离。
- PostgreSQL AST 门禁覆盖单条合法 CTE 聚合，以及多语句、DML CTE、危险函数、递归
  CTE、子查询、RangeFunction、SELECT INTO/锁/集合操作、越界 Relation、自定义
  Operator/Cast 和非参数化业务常量；所有负例都要证明 Claim 尚未创建且 Datasource
  Process 尚未启动。Compiler Fixture 还要断言版本为 `postgresql-compiler@1.1.0`，
  且所有 Primitive、Operator 与 Cast 都经 `pg_catalog` 限定。
- `CONTROLLED_REVISION` 在真实 PG17 覆盖 schema/data manifest、Relation/OID、
  JSON/JSONB 递归值、int8/numeric、Owner/Admin 漂移和同 Snapshot TOCTOU；每条
  Datasource 路径最终都必须 `ROLLBACK`。另需分别断言
  `NONE = [pg_catalog]`、`CONTROLLED_REVISION = [sealed_schema,pg_catalog]`，并用
  `data_agent_sandbox_control.datasource_identity` 的 ID/Fingerprint 错绑证明真实
  连接在查询前失败关闭。Manifest 还必须用真实 named server-side cursor 覆盖跨
  Relation 总行数/总字节越界，并证明超限时 `manifest_revalidated=false`、用户 SQL
  未执行。
- Authority Store 在真实 PG17 覆盖同输入双连接 Claim 竞争、Cancel Epoch CAS、
  跨 Scope/RLS/Grant、同键异输入、重启重放、Late Cancel、旧 Fence、不可变
  Execution Record 与 append-only System Artifact/Event；还要用 Worker 未来时钟证明
  Lease Recovery 服从数据库时钟，并证明 `FAILED/CANCELLED` 在 Authority 重启后稳定
  重放且不再次启动 Python。
- 时间边界测试必须覆盖 Prepare 重验证早于 Datasource `started_at` 的合法路径、晚于
  `started_at` 的失败路径，以及 Permit 虽在 Prepare 时有效但在 Datasource 实际
  `started_at` 已过期时仍失败关闭。
- Process 协议覆盖 EXECUTE/OUTCOME、单调 CANCEL、超时、stdout 上限、旧
  Attempt/Fence/Epoch 换绑与 TypeScript/Python Schema/Wire Fixture 一致。
- 真实 PostgreSQL 集成必须覆盖
  `Coordinator -> PostgreSQL Authority -> Python child -> 同一 PostgreSQL Datasource
  -> 耐久 Receipt/Result -> Authority 重启后 replay`，并断言 replay 不会第二次启动
  Python 子进程。
- Receipt 证明实际只读事务、Settings 与 Snapshot；Result 覆盖 ragged row、重复列、非法类型、
  错误字节数/Hash、低报实际资源、真实墙钟超时、跨 Execution/Schema 以及
  256 列、10,000 行、64 MiB、512 MiB 上限。
- Environment/Key 包含分隔符时不能发生复合键碰撞。
- Hosted、Docker、In-Memory Adapter 使用相同 Conformance Case。
- Model/External Agent 未授权调用失败；请求授权不能由调用方自证 Profile 或扩大权限。
- Model、External Agent、Benchmark 的事件在所有事件分支上都要拒绝请求关联不一致。
- Benchmark 的 `CASE_LOADED`、`SCORE_CANDIDATE`、`COMPLETED` 和 Sandbox 的响应引用跨 Scope 时失败。
- Benchmark/Sandbox 只有成功终态、已提交引用的 Receipt 能取得领域品牌。
- U6 所有 Port 覆盖伪造 capability、Scope/Principal/Role/Epoch 换绑；strictInput
  不能自证 Authority，错误不得泄漏其他 Tenant/Principal 是否存在。
- `commitCurrent` 覆盖 V1 historical read-pass/write-deny、未知 Wire 元组、
  Candidate/Rejected/Superseded、错误 Parent Hash、旧 Attempt/Lease/worker_fence；
  Release GO 与 current-ready 也必须拒绝 V1。
- Current Readiness 在真实 PostgreSQL 双连接覆盖 `READY vs revoke` 两种锁顺序：
  READY 前撤权只提交唯一 STALE；READY 后撤权保持历史 READY、current=REVOKED，且
  `run_events`/Runtime Projection 不变化。
- Research Stop 在真实 PostgreSQL 双连接覆盖 `Stop vs Publish`、`Stop vs Frontier
  Advance` 两种锁顺序；锁内重验 Current 不存在、Terminal 不存在、Frontier/Coverage
  exact current 且无 STALE，绝不允许 CURRENT 与非 Ready Terminal 共存。
- Publication 覆盖 publish/revoke 两种锁顺序及 publish 后撤权的同键重放；不得用
  历史 Publication 返回伪 CURRENT。
- Current Readiness 覆盖缺 Semantic/Schema/Data/Policy/Identity 任一 Frontier、
  SchemaSnapshot 换 Revision、Frontier Hash/Version 和 Authority Epoch 漂移。
- Release GO 使用真实 PostgreSQL 双连接覆盖 `commitGo vs revoke` 两种锁顺序；只有
  先取得并持有锁且同事务提交 Decision 的一方可胜出，普通 readiness snapshot 不能
  在锁外品牌化 GO；另覆盖 GO-before-READY 与
  `GO committed -> revoke -> same-key replay`，后者不得返回历史 GO。
- Grant 覆盖 Issue、Consume、Response 三个线性化点，以及 revoke-before-consume、
  revoke-before-response、response-before-revoke、TTL 边界、重复调用、跨 Principal/
  Report、Projector/Envelope/Bytes/Digest 换绑及调用方自报任意字节；所有拒绝路径
  断言 Provider/HTTP 输出为零字节。
- Revocation 覆盖 `operation_id == envelope.attempt_id`、数据库
  `worker_fence=0`、同键同载荷重放和同键异载荷冲突；普通 Committer 不可使用 Service
  Fence，Revoker 不可提交其他 Artifact 或执行 SQL。
- Resource Port 覆盖 Reserve/Settle/Cancel/Expire、tenant/principal/run 并发、同键
  重放/冲突、Begin/Abandoned/in-flight expiry/late usage/Cancel Leak、COMPLETED/
  FAILED/超额三分支、Settle-vs-Cancel 和数据库时钟；每次真实 Model/SQL/Tool 调用前匹配
  Reservation/Seq/Lease/Invocation/Attempt/Fence/Request/Bounds。
- Invocation State 覆盖 Begin 原子创建 AUTHORIZED、STARTED 在真实 callback 前提交、
  非法跳转、吸收 Terminal、三类 COMPLETED 零计数、UNKNOWN→ABANDONED→late
  Terminal→SETTLED 单次入账及跨阶段 Key 冲突。
- System Record Lifecycle 覆盖 Termination exact binding、Permit Issue/Revoke/Expire、
  DB TTL 边界、Job 延迟仍拒绝 I/O、Result 到期原子 Tombstone、正文不可重放及
  Expiry/Retention Owner 不可扩权。
- AgentDataProjection/Model Provider 覆盖 canonical bytes、HMAC、Byte/Token、
  Provider/Profile/Model/Request、Tool Allowlist 与 Input Ref 换绑；失败发生在真实
  Provider callback 之前。Hosted/Docker/In-Memory 共享相同 Case，但 HMAC 与
  PostgreSQL race 仍需真实 Adapter 证据。

### 7. Wrong vs Correct

#### Wrong

```ts
const authorization = await authorizeInAuthorityDatabase(request);
const rows = await datasource.query(authorization.sql);
return createSuccessReceipt({ ...request.budget, rows });
```

#### Correct

```ts
const preparation = await prepareSandboxExecution(request, authority);
const handle = await python.start({
  ...resolveOperation(preparation.grant),
  grant: preparation.grant,
});
const outcome = await handle.outcome;
return outcome.terminal === "FAILED"
  ? failSandboxExecution(outcome, authority)
  : finalizeSandboxExecution(outcome, authority);
```

#### U6 Wrong

```ts
const grant = await readiness.consume(request);
return provider.send(agentBuildsMessagesAfterAuthorization(grant));
```

#### U6 Correct

```ts
const candidate = buildCanonicalModelRequest(projectionCandidate);
const reserved = expectOk(await resourcePort.reserve(resourceCapability, reserveInput));
const begun = expectOk(await resourcePort.begin(resourceCapability, {
  ...beginInputFrom(reserved),
  resource_kind: "MODEL",
  canonical_request_digest: sha256(candidate),
}));
const projection = expectOk(await invocationPort.authorizeAgentDataProjection(
  projectionCapability,
  projectionInputFrom(begun, candidate),
));
const invocation = expectOk(await invocationPort.invokeModel(
  modelInvocationCapability,
  modelInputFrom(begun, projection),
));
return invocation.state === "OUTCOME_UNKNOWN"
  ? resourcePort.markAbandoned(resourceCapability, abandonedInputFrom(invocation))
  : resourcePort.settle(resourceCapability, settleInputFrom(invocation));
```
