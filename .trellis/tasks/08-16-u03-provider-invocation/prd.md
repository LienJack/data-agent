# U3 Provider Invocation、真实模型切换与 Usage Receipt

## Goal

把 U2 冻结的 Model Profile/Config/Context 与真实 Worker Provider 调用连成一条可审计链：每次调用都在外部
I/O 前由 PostgreSQL 提交脱敏 Intent，最终形成绑定 Run/Attempt/Fence、Profile/Model/Certification、Dispatch/
Response Hash 与技术 Usage 的权威 Receipt。模型选择必须可由最终 Provider Receipt 反向证明，而不是只停留在 UI
或 Conversation 状态。

## Requirements

- Selector 只提交 `model_profile_id + expected config version`；服务端解析当前 execution-ready Profile。客户端不能
  自报 Provider、Model、Certification、Credential、Context Window、Invocation Capability 或可用性。
- QA Run 必须把 Conversation 已选的 Model/Datasource 解析为 `RESOURCE_IDS + expected revision`，不能回退为
  Workspace Defaults；U2 原子 acceptance 继续锁 Conversation 并复验 ID/version，TOCTOU 失败关闭。
- U2 `EffectiveRunConfigReceipt`、`WORKER_START ContextReceipt` 与 ACTIVE `RunWorkLease` 是 dispatch 的唯一入口；
  任一 Scope/Run/Config/Context/Attempt/Outbox/Command/Worker/Lease/Fence 不一致都必须在网络前失败。
- 调用顺序固定为 `Context Compiler -> Data Projection/Taint Check -> ProviderDispatchEnvelope validation ->
  PostgreSQL Intent CAS -> STARTED -> Provider transport -> terminal Outcome + Usage Receipt`。
- `ProviderDispatchEnvelope` 冻结 data-minimized payload hash、U2 config/context ref、Profile/Model revision、
  Certification、response schema、tool allowlist、技术预算与 lease/fence；原始 prompt/messages/response/tool args
  不得进入 Invocation Store、日志、公共事件或错误。
- 内部生命周期为 `INTENT_COMMITTED -> DISPATCH_MARKED -> RESPONSE_OBSERVED -> COMPLETED | FAILED |
  THROTTLED | OUTCOME_UNKNOWN`，公共 `STARTED` 只投影已提交的 `DISPATCH_MARKED`。Provider 明确未
  启动的 preflight 拒绝可直接形成 `FAILED` 且 `provider_call_started=false`；可能已送达但本地无可信终态时只能
  `OUTCOME_UNKNOWN`。
- Certified Profile 必须声明且冻结一种执行语义：`IDEMPOTENT_REQUEST`、`INVOCATION_STATUS_QUERY`、
  `INVOCATION_RECONCILIATION` 或 `AT_LEAST_ONCE_ONLY`。`AT_LEAST_ONCE_ONLY` 不得与前三者混用；Unknown 不能普通
  retry，只能在能力与证据允许时 reconcile。
- 每个终态都必须有一份 Usage Receipt。Token source 为 `PROVIDER_REPORTED | ESTIMATED | UNAVAILABLE`；不可用时
  counts 为 null 并给稳定 reason。技术 counts/latency/tool calls 只用于容量、重复调用检测和诊断，不参与价格、
  Credit、余额、结算或 Falcon 准确率。
- Dispatch 前用可信 counter 计算实际输入，并对 U2 Context Policy、Execution Safety Policy 与已认证 Profile
  Context Window 取最严格上限。Context Window 未认证、输入加保留输出超限或 Provider call budget 耗尽时，
  Provider 调用次数必须为 0 且留下技术拒绝 Receipt。
- 新执行路径不构造 `ModelBillingPort`，不读取 Billing/Pricing/Credit 表，不以 `UNBILLABLE`、价格、FX、余额或
  Price Verification 决定可执行性。现有商业模块保持不变且不进入 U3 owned commit。
- PostgreSQL 只保存 Scope、Run/Task/Attempt/Fence、Profile/Model/Connection/Certification revision/hash、Intent/
  Dispatch/Response hash、状态、稳定 reason、技术 Usage 与 ACL Artifact refs；禁止 credential/SecretRef value、
  headers、URL query、sealed payload 或未授权 Context ref。
- `COMPLETED` 必须绑定同 Run 的 committed protected Response Artifact ref，且其 content hash 与 `response_hash`
  exact；Invocation 表不保存正文。Worker restart只从该受ACL保护Artifact恢复已完成输出，不重新调用Provider。
- Public projection 只公开 requested/effective Profile、Provider/Model revision、Certification、Attempt/retry、
  terminal、latency、token availability/source、Dispatch/Response hash 与 Receipt deep link。
- Transport delta/tool candidate 只能在 Worker 内存中缓冲并完成确定性校验；terminal Outcome + Usage Receipt 原子
  提交前，不得作为 answer/public event/Agent handoff 对外释放，避免“用户已看到结果但 Authority 仍未知”。
- 本单元唯一真实外部 Provider smoke 使用已预检的 DeepSeek V4 Flash；不得调用 Claude/Anthropic，不导入 Falcon
  或其他数据。普通 unit/integration test 使用 instrumented fake transport。

## Stable Status / Reason Codes

- Internal state: `INTENT_COMMITTED | DISPATCH_MARKED | RESPONSE_OBSERVED | COMPLETED | FAILED | THROTTLED | OUTCOME_UNKNOWN`。
- Public terminal: `COMPLETED | FAILED | THROTTLED | OUTCOME_UNKNOWN`。
- Usage availability: `AVAILABLE | NOT_APPLICABLE | UNAVAILABLE`；source 为
  `PROVIDER_REPORTED | ESTIMATED | UNAVAILABLE`。确定未 dispatch 才是 `NOT_APPLICABLE`，dispatch 后缺数据为
  `UNAVAILABLE`。
- Stable preflight failures 至少覆盖：`PROVIDER_PROFILE_NOT_AVAILABLE`、`PROVIDER_CERTIFICATION_REQUIRED`、
  `PROVIDER_CONTEXT_WINDOW_UNVERIFIED`、`PROVIDER_CONTEXT_LIMIT_EXCEEDED`、`PROVIDER_OUTPUT_LIMIT_EXCEEDED`、
  `PROVIDER_CALL_LIMIT_EXCEEDED`、`PROVIDER_EGRESS_DENIED`、`PROVIDER_DISPATCH_ENVELOPE_INVALID`、
  `PROVIDER_CONTEXT_RECEIPT_MISMATCH`、`PROVIDER_WORKER_LEASE_STALE`。
- Runtime failures 至少覆盖：`PROVIDER_CREDENTIAL_UNAVAILABLE`、`PROVIDER_THROTTLED`、`PROVIDER_TIMEOUT`、
  `PROVIDER_PROTOCOL_VIOLATION`、`PROVIDER_INVOCATION_OUTCOME_UNKNOWN`、`PROVIDER_RECONCILIATION_REQUIRED`。

## Acceptance Criteria

- [ ] Workspace Default=Profile A、Conversation=Profile B 时，U2 Effective Config、Worker transport 与最终 Receipt
      全部绑定 Profile B；不得阻断或静默回退 A。
- [ ] 两个不同 Profile 的选择能产生不同且正确的 Provider/Model/Profile Revision/Certification/Invocation Receipt；
      刷新与 Worker restart 后仍从 PostgreSQL 恢复同一选择。
- [ ] Intent 在任何 Provider 网络调用前提交；intent-only 可安全恢复，STARTED 后不确定结果不会盲目重发。
- [ ] `COMPLETED/FAILED/THROTTLED/OUTCOME_UNKNOWN` 均有 exact Usage Receipt；Provider 不返回 token 数值时仍形成
      `UNAVAILABLE` Receipt 而不是伪造 0 或阻止 GO。
- [ ] Completed response 在 terminal 前提交为 protected Artifact，并由 Receipt exact引用；terminal replay可恢复
      相同输出而不产生第二次 Provider 调用。
- [ ] Context/Output/Provider-call limit、未认证 Context Window、Egress 拒绝都在零网络调用时失败并留证。
- [ ] ACTIVE lease/fence、U2 Config/Context Receipt、Profile/Certification 任一 tamper/stale/cross-scope 都在 Provider
      前失败。
- [ ] 四类 Invocation Capability 的 crash/retry/reconcile matrix 有机械测试；Unknown 只能 reconcile。
- [ ] Invocation/Usage Authority 具有 RLS、NOLOGIN owner、窄 RPC、append-only/immutable、CAS/idempotency 与
      canonical hash；无直接 DML、无历史 backfill/dual-write。
- [ ] QA Model Selector 覆盖 loading/empty/available/disabled/stale/error；不再展示或依赖 `UNBILLABLE`，并展示
      Provider、Model、Profile Revision、Certification 与 Context/Output 技术上限。
- [ ] SQL spy 与 import/surface tests 证明新路径不构造 Billing Port、不访问 Billing/Pricing/Credit 表、不公开
      Mastra 类型、Credential、原始 prompt/response。
- [ ] 唯一真实 DeepSeek V4 Flash smoke 产生 committed Invocation + Usage Receipt，并由 receipt 反向证明所选
      Profile/Model；无 Claude/Anthropic 或其他 Provider 调用。
- [ ] Contracts/Platform/Web/Worker focused tests、typecheck/build、renderer/static/fresh PostgreSQL smoke、scoped
      Biome 与独立对抗审查通过。

## Dependencies

- U1 Route/Capability/Greenfield baseline：`82a83d1`。
- U2 Effective Config/Context/Worker authority：`5853a959aec51013f4bbe008bae56df5b3be0ef5`。

## Out of Scope

- Billing、Price、FX、Credit、Balance、Settlement、Cost budget。
- U12 完整 Context 编译/压缩；U3 只消费 U2 Context Receipt 与可信 token counter。
- U20 三类 Agent Profile/Mastra Team 组合；U3 提供 framework-neutral audited Provider Port。
- Semantic Candidate/Release、Text2SQL、Report、Falcon scoring 与任何数据导入。
