# U2 Effective Run Config、Workspace Defaults 与 Context Receipt

## Goal

建立一个 PostgreSQL 权威的服务端解析与冻结层：把 Workspace Defaults、客户端有限 Overrides、结构化
`@` Resource Mention 与当前资源版本解析为不可变 Effective Run Config Receipt；Run 接受、Worker、U3
Provider Invocation/Usage Receipt 与 U12 Context Package 后续只能引用同一 `config_id/revision/hash`。

## Requirements

- 服务端先解析 authenticated Principal/App/Tenant/Workspace/Environment，再读取 Defaults 与当前资源 Authority；
  客户端不得提交 role、provider eligibility、有效 Release/Snapshot、资源 hash、sensitivity 或授权结论。
- Workspace Defaults 为版本化、内容寻址、CAS + principal-scoped idempotency 的 PostgreSQL Authority，覆盖
  Model、Datasource、Files、Knowledge、MCP、Skills、Semantic Release、Context Policy、Egress Policy 与
  Execution Safety Bounds。
- Requested Selection 必须区分 `INHERIT_DEFAULT`、`EXPLICIT_NONE` 与带 expected revision 的
  `RESOURCE_IDS`；单值/集合资源、显式空与 Default 删除不能混为一谈。
- `@` Mention 只接受 `mention_id + resource_kind + resource_id + expected_revision`；显示名、alias、客户端
  Resource 对象不能参与 Authority 解析，同名资源不会按名字猜测。
- Resolver 在一个 PostgreSQL 事务内重验 RBAC、Scope、状态、版本、Semantic active pointer、Schema Snapshot、
  Context/Egress/Safety Policy，计算 canonical hash，写不可变 Receipt，再原子接受 Run/Command/Event/Outbox。
- `QUESTION_RUN` 必须绑定 Published Semantic Release 与 Schema Snapshot；Greenfield `active_release=null` 时返回
  `BOOTSTRAP_REQUIRED`，不得创建无语义问答 Run。只有独立 `SEMANTIC_BOOTSTRAP_JOB` 可绑定 U1 Candidate hash
  并让 Release Ref 为 null。
- Egress Override 只能收紧 Provider/Audience/Classification；不得移除 sensitivity、扩大 audience 或自报
  provider eligibility。
- Run Command/Lease 只携带 Effective Config Ref；Worker 在任何 Tool/Provider/Effect 前从 PostgreSQL 重取并
  重验 Scope/Run/Hash/Revision/撤权，不能用 payload 中的 raw model/datasource 覆盖 Receipt。
- Context Receipt 在 U2 只冻结 config/release/snapshot/policy/provider/audience/classification/resource refs；
  U12 才实现检索、裁剪、Mandatory/Omitted 与 Context Package。
- 本单元不调用 Provider，不导入数据，不新增 Billing/Price/Credit/Cost/Settlement 行为，不引入 Mastra 公共类型。

## Stable Admission / Unavailable Reasons

- Admission: `READY | BLOCKED | BOOTSTRAP_REQUIRED`。
- Unavailable: `EXPLICITLY_CLEARED`、`DEFAULT_NOT_CONFIGURED`、`DEFAULT_REMOVED`、
  `RESOURCE_NOT_FOUND_OR_FORBIDDEN`、`RESOURCE_DISABLED`、`RESOURCE_REVISION_MISMATCH`、
  `RESOURCE_REVOKED`、`RESOURCE_KIND_MISMATCH`、`MODEL_NOT_AVAILABLE`、
  `SEMANTIC_RELEASE_NOT_PUBLISHED`、`SCHEMA_SNAPSHOT_STALE`、`POLICY_REJECTED`、
  `EGRESS_PROVIDER_DENIED`、`EGRESS_AUDIENCE_DENIED`、`MENTION_RESOURCE_ID_REQUIRED`。
- 跨 Workspace、已删除与无权限资源统一公开为 `RESOURCE_NOT_FOUND_OR_FORBIDDEN`，不泄漏存在性。

## Acceptance Criteria

- [x] Defaults + Overrides + Mentions 的 requested/effective diff、revision/hash 与稳定 unavailable reason 全部冻结。
- [x] 任一资源 revision/hash、Defaults version、Authz Epoch、Policy、Provider/Audience 改变都改变 config hash。
- [x] Client role/release/snapshot/status/sensitivity/provider eligibility/display-name claims 由 strict contract 拒绝。
- [x] `QUESTION_RUN + null semantic`、Release/Snapshot scope/datasource/generation 不一致均失败关闭；Bootstrap Job
      不会被当成问答 Run。
- [x] 同事务原子写 Effective Config Receipt、resource bindings、Run acceptance 与首个 consumption receipt；
      并发撤权或 stale CAS 不留下半成品。
- [x] 同 idempotency key + 同 request hash 返回原 Receipt；同 key + 不同 hash 冲突。
- [x] 两条 Web Run 创建入口都使用同一 Resolver；无 Published Release 时不接受 Run Command。
- [x] Worker restart/replay 只重取同一 Receipt；missing/tampered/cross-scope/revoked Receipt 在 Effect 前拒绝。
- [x] `10653` 只创建空 Authority tables/RPC/RLS/roles，不 backfill、不 dual-read/write、不导入数据。
- [x] Contracts/Platform/Web/Worker focused tests、renderer verify、SQL static/smoke、package typecheck/build 通过。

## Dependencies

- U1 commit `82a83d1`：Route Authorization、Greenfield Candidate、Coverage 与 capability baseline。

## Out of Scope

- 真实 Provider dispatch 与 Invocation/Usage Receipt（U3）。
- Resolved Context 检索/裁剪/压缩（U12）。
- Semantic Candidate 生成或发布（U4/U5/U11/U20）。
- 历史数据迁移、兼容 dual-read、Falcon 导入和任何商业计费功能。
