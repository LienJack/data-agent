# M0 Semantic Authority and Safety Foundation

## Goal

把当前语义治理 Web/Service/PostgreSQL 路径从“可演示但会静默 Mock、信任客户端身份、
使用占位 hash/identity”收敛为明确的安全地基：Demo 只能显式启用；PostgreSQL 路径必须
在同一事务内重验服务端 Authority、设置 scope、写入内容寻址 revision，并拒绝缺失的
compiler、projection、rollback 或 secret-provider 事实。

M0 不交付 Schema Discovery、AI 候选生成、Metric Agent 或完整 Studio；它只保证这些
后续能力不会建立在伪 Authority 上。

## Confirmed Facts

- `getSemanticGovernanceService()` 在未设置 `USE_POSTGRES_SERVICE=true` 时默认返回 Mock
  (`apps/web/src/lib/semantic-governance-service.ts:392`)。
- `setScopeContext()` 使用 transaction-local setting，但多个读方法没有围绕 setting 和
  query 建立同一显式事务 (`apps/web/src/lib/postgres-semantic-governance-service.ts:97`)。
- Candidate 写入硬编码 `agent-proposer`、空 structured diff、随机 revision/packet digest，
  且把 candidate revision ID 当作 source revision ID
  (`apps/web/src/lib/postgres-semantic-governance-service.ts:603`)。
- Prepare/Commit/Rollback 仍在生成随机 compiler/projection/authorization material
  (`apps/web/src/lib/postgres-semantic-governance-service.ts:730`)。
- Candidate/Decision API 接受客户端 scope、principal 和 role；当前 client 使用 Mock User
  自报审批身份 (`apps/web/src/lib/semantic-api.ts:24`, `:93`)。
- 10610 已有 Source Revision、Candidate Revision、Review、Publish、Rollback、Active
  Pointer 和 Outbox 表/RPC，但没有安全的 candidate-create RPC。
- 未提交 datasource scaffold 目前用进程内 Map 保存连接配置并包含原始 password；它是
  M0 的重叠风险文件，实施时必须逐项保留用户已有修改。

## Requirements

### M0-R1 — Explicit backend selection

- 使用单一、严格枚举的 server-only 配置选择 `postgres | mock`。
- 配置缺失或未知时返回稳定错误，不能静默使用 Mock。
- `mock` 只允许测试或显式本地 Demo；生产环境选择 Mock 必须失败关闭。
- `postgres` 缺数据库或 Authority resolver 配置时失败关闭，不降级。

### M0-R2 — Server-derived authority context

- API body/query 不得为 app、tenant、environment、principal 或 semantic role 提供权威值。
- Route 在进入 service 前从 server-owned resolver 得到 scope、verified principal、role、
  deployment/authority epoch 或明确的不可用终态。
- semantic domain 选择必须在 server-resolved allowlist 中验证。
- Postgres adapter 的 Authority revalidation、`SET LOCAL`、业务 SQL 和 commit/rollback 必须
  使用同一个 client 和同一个显式事务。

### M0-R3 — Canonical candidate persistence

- 在 contracts 中定义 strict、版本化 Candidate Draft、Source Payload、Diff 和结果 DTO；
  未知字段失败关闭。
- 新增 additive migration 和窄 RPC；不得重写已登记的 10610 migration。
- RPC 在 scope authority lock 内生成 source revision、candidate 和 candidate revision，
  PostgreSQL 计算 canonical digest 并返回；TypeScript 不自报权威 digest。
- Candidate 创建后保持 `DRAFT`，没有真实 `ValidationReceipt` 前不得创建 ReviewPacket。
- source revision、candidate revision、author、base release/generation 和 change class 必须
  exact 绑定；相同 idempotency material 可重放，异载荷冲突。

### M0-R4 — No placeholder publish or rollback material

- `preparePublish` 必须接收真实 compiler bundle digest、catalog epoch、dependency/target
  generation 和 idempotency digest。
- `commitPublish` 必须接收三个真实 projection ref/hash 及可选 profile manifest。
- `executeRollback` 必须接收已授权的 rollback identity、nonce 和 reason。
- Route 或 caller 缺任一材料时返回稳定 `SEMANTIC_*_MATERIAL_REQUIRED`，Postgres adapter
  不得生成 UUID/hash 代替。

### M0-R5 — Secret-reference datasource boundary

- 定义 `DataSourceCredentialRef` strict contract；持久/响应/日志中只出现 secret reference
  metadata，不出现 password、userinfo DSN 或 provider locator 明文。
- datasource API 不再把原始 password 放入进程 Map。
- 在 Secret Provider 尚未接入时，连接测试返回稳定的 Provider-not-configured 终态；不能
  为了演示继续持有明文凭据。

### M0-R6 — Stable errors and redaction

- API 只返回白名单 code/message/status；数据库原始 message、stack、DSN、SQL 和 secret
  不得进入 response。
- Postgres SQLSTATE/semantic reason 映射必须穷尽已支持分支；未知错误统一为脱敏内部错误。
- Mock/Demo 响应必须明确标记非权威，不能与 PostgreSQL success 使用相同生产语义。

### M0-R7 — Test and evidence gates

- 行为变更先有 characterization/failing test，再实现。
- 合同测试覆盖 backend selection、unknown fields、canonical payload、client identity 拒绝和
  missing material。
- PostgreSQL 测试覆盖 scope/RLS、同载荷 replay、异载荷 conflict、事务 rollback、source/
  candidate/revision exact binding 和无 ReviewPacket。
- 静态检查证明 semantic production code 不再包含 placeholder hash/identity 生成。
- Migration 使用 `ON_ERROR_STOP`、固定 ledger/checksum 和 clean-install evidence；仅 TypeScript
  unit PASS 不能关闭 M0。

## Acceptance Criteria

- [ ] 缺 backend 配置、未知 backend、production mock 和 postgres 缺 Authority/DB 都返回稳定 fail-closed 错误。
- [ ] 每个 PostgreSQL service 调用在一个 client 的事务内完成 Authority revalidation、scope setting 和业务 SQL。
- [ ] API 无法通过 body/query 覆盖 app/tenant/environment/principal/role。
- [ ] 相同 Candidate canonical input 得到同一权威 digest/幂等结果；任一字段变化产生显式冲突或新 revision。
- [ ] Candidate 创建保存真实 source/revision diff，author 来自 server context，且没有 ValidationReceipt 时不存在 ReviewPacket。
- [ ] Prepare/Commit/Rollback 缺权威材料时在 RPC 前失败；代码库中无随机 compiler/projection/rollback authority material。
- [ ] datasource boundary 不持有或返回原始 password；Secret Provider 缺失时失败关闭。
- [ ] API error/日志测试证明 DB cause、stack、DSN、password、token 不泄漏。
- [ ] contracts、web typecheck/lint、scoped unit/contract、PostgreSQL integration、migration ledger Gate 全部通过。
- [ ] 只提交 M0 owned files；DataFoundry 既有修改保持原样。

## Out of Scope

- Schema catalog scan、PhysicalSchemaSnapshot 和 drift。
- AI/LLM candidate generation、Metric Authoring Agent、Formula AST 扩展。
- Explorer/Builder UI；现有 Review Workspace 只做必要 DTO/错误兼容。
- 没有真实 validation/compile material 时开放 Postgres Review/Publish Demo。
- 选择具体 Secret Provider；M0 只定义 port/ref，并在缺实现时 fail-closed。
- 修改或宣称重新应用已登记的 10610 migration。

## Blocking Open Questions

None. The approved roadmap resolves the product boundary. Implementation remains gated on approval of
this final M0 planning summary.
