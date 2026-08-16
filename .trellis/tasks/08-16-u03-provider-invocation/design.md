# U3 Technical Design

## Authority Flow

```text
Conversation selected Profile/Datasource + exact revisions
  -> U2 Effective Config + WORKER_START Context Receipt + ACTIVE RunWorkLease
  -> resolve execution-ready Profile + exact committed Certification
  -> compile/projection/taint/capacity preflight
  -> ProviderDispatchEnvelope (raw-free, content-addressed)
  -> PostgreSQL begin_provider_invocation (Intent CAS)
  -> PostgreSQL mark DISPATCHED at the real network suspension point
  -> ephemeral ModelProviderPort transport
  -> PostgreSQL mark RESPONSE_OBSERVED (raw-free response hash/certainty)
  -> terminal Outcome + Usage Receipt in one transaction
  -> redacted PublicProviderInvocationProjection
```

PostgreSQL 是 Invocation/Usage Authority。Zod 只验证 Candidate 形状，Mastra 只实现内部 transport/composition，
二者都不能授予可持久恢复的 Authority。原始消息只在已验证 Worker 内存中进入 transport，不能被塞进 SQL、
Run payload、Mastra snapshot、日志或公共事件。

## Conversation Selection Before Dispatch

当前 QA route 把 Model/Datasource 都提交为 `INHERIT_DEFAULT`，与 Conversation 已选资源不同时会被 U2 原子 RPC
拒绝。U3 增加 PostgreSQL-backed 窄读 `resolveConversationRunSelections`：只返回 current conversation ID/version、
model profile ID/config version 与 datasource ID/resource version。QA route 由此构造 `RESOURCE_IDS` 请求；U2 RPC
仍在同事务锁 Conversation 并重验 exact ID/version，所以窄读与 acceptance 之间变化会稳定失败，不产生 TOCTOU
旁路。显示名、hash、provider 与 authorization 结论不由 Web 提交。

## Contract Layers

`packages/contracts/src/providers/provider-invocation.ts` 分离五类 wire：

1. `ProviderDispatchEnvelopeCandidate`：绑定 U2 config/context、Run/Task logical call、lease/fence、Profile/
   Certification、response/tool/budget 与 minimized payload hash，不含 raw body。
2. `ProviderInvocationIntentCandidate/Reference`：DB-owned intent id/revision/hash、idempotency key、dispatch hash 与
   frozen invocation semantics。
3. `ProviderInvocationOutcomeReceiptCandidate`：append revision，记录 DISPATCH_MARKED/RESPONSE_OBSERVED 或
   terminal；Unknown 不伪造 response。公共 STARTED 只映射 DISPATCH_MARKED。
4. `ProviderUsageReceiptCandidate`：每个 terminal 恰好一个，token counts 可 null，但 availability/source/reason 必填
   且内部闭合。
5. `PublicProviderInvocationProjection`：严格脱敏、面向 UI/Team Trace 的稳定投影。

Begin admission 是严格分支：`READY` 才返回 per-attempt Permit；`REJECTED` 在同一事务提交 stable Intent、
pre-dispatch FAILED Outcome 与 `NOT_APPLICABLE` Usage，Permit 必须为 null。Context Window 未认证、可信 token
容量超限等技术拒绝因此有可审计证据且 Provider 调用为 0；畸形输入、越权或 stale lease 仍 fail-closed 且零写。

`packages/contracts/src/ports/model-provider.ts` 保留 ephemeral transport payload 与 stream chunks，但 durable audited
入口不能由调用方自行 `authorizeModelProviderInvocation`。Audited wrapper 只能在 PostgreSQL 返回 committed
dispatch permit 后构造 transport capability；raw Provider Port 不从 Worker composition/public barrel 暴露给一般
executor。

## Profile Identity

U2 权威 identity 使用 Catalog `config_version`，当前 wire 为 `profile_version=model-profile@<config_version>`；旧的
agent-runtime static binding/Certification 使用 `1.0.0`，两者不能冒充等价。U3 的 U2-aware resolver 必须从 exact
Effective Config 构造 binding，并让 Certification/dispatch 同时认证：

- `profile_id`、Catalog config version 与 model resource hash；
- exact `profile_version=model-profile@<config_version>`；
- Provider、Model ID 与独立 adapter version；
- Context/Output constraints 与 Invocation semantics。

认证使用独立的 technical `execution_profile_hash`，只覆盖 Provider/Model/Catalog config、adapter、连接或系统部署
proof、recovery capabilities、模型能力与非商业技术约束。Pricing/Price/Credit/Balance 不进入该 hash，也不能因其
变化使执行认证失效。新增认证字段全部必填；Greenfield 不用 legacy default 或占位 hash 补齐旧 Receipt。

DeepSeek execution identity 统一为 `deepseek-v4-flash`；不得 fallback 到或把 `deepseek-v4-pro` 当作同一模型。

## Canonical Dispatch Hash

`dispatch_hash` 至少覆盖：

- App/Tenant/Environment/Workspace/Principal、run/task/logical call/invocation/idempotency identity；
- U2 `config_id/revision/hash` 与 WORKER_START Context Receipt `id/hash`；
- attempt/outbox/command/worker/lease token/fence/delivery attempt；
- requested/effective profile id、model config version/hash、provider/model/profile version；
- committed Certification ref/hash 与 invocation semantics；
- response schema、canonical tool allowlist、timeout/input/output/tool/provider-call 技术预算；
- data projection/taint receipt refs、minimized payload hash、trusted input token count 与 reserved output tokens。

Timestamp 不参与 retry identity；DB timestamp 进入 Receipt hash。所有数组 canonical sort + duplicate rejection，UUID 与
timestamp 使用 shared canonical schema。

Certification Receipt 可以来自独立的认证 Run；它必须与 Invocation 属于同一 App/Tenant/Environment，并精确认证
当前 Profile/Provider/Model/Catalog config version、binding proof 与 recovery capabilities，但不得被错误要求与查询
Run 拥有相同 `run_id`。Task 与 ProviderResponseArtifact 仍必须属于本次查询 Run。

## PostgreSQL 10654

Greenfield migration `20260725010654_app_data_agent_provider_invocation_authority` 创建：

- `provider_invocation_intents`：一次逻辑调用一个 immutable Intent；principal-scoped idempotency + request hash；
- `provider_invocation_dispatch_permits`：每个 Worker Attempt 一份 append-only、hash-covered Permit，绑定 exact
  WORKER_START Context Receipt、lease/fence 与 dispatch hash；旧 Attempt 的 Permit 不可被新 Fence 使用；
- `provider_invocation_outcomes`：append revision；STARTED/terminal/Unknown/reconcile lineage；
- `provider_invocation_usage_receipts`：terminal 一一对应的技术 Usage；
- execution-ready Profile/Conversation selection RPC 直接验证 Catalog/Connection/Certification，不读取 Billing/
  Pricing/Credit。U2 运行时 model revalidation 也改走该 execution predicate，清除旧 price-chain 门禁。

窄 RPC：

- `resolve_conversation_run_selections`：只返 exact resource identities/revisions；
- `begin_provider_invocation`：同事务锁 WORKER_START Context Receipt、Effective Config、Run/Attempt/Outbox 与当前
  Model/Profile/Certification，校验 dispatch envelope后提交 Intent；
- `mark_provider_invocation_dispatched`：只在 transport 完成全部本地 preflight、即将跨真实网络 suspension point
  时把 Intent CAS 到 DISPATCH_MARKED；
- `mark_provider_invocation_response_observed`：只在 transport 已观察到可归类的响应后提交 raw-free
  observation kind、response hash 与 delivery certainty；正常 terminal 必须消费该 marker；
- `commit_provider_invocation_completed`：在一个数据库事务中先写受保护的 Response Artifact，再原子写
  `COMPLETED` Outcome 与 Usage Receipt；相同 command/hash 重放返回原记录；
- `commit_provider_invocation_terminal`：只处理不携带 Response Artifact 的 `FAILED|THROTTLED` 与 Usage Receipt；
- `mark_provider_invocation_outcome_unknown`：仅从 STARTED，生成 UNAVAILABLE Usage；
- `reconcile_provider_invocation_unknown`：只允许 Unknown 加一条 evidence-bound terminal revision，不覆写历史；
- `load_provider_response_artifact`：读取已由 completed RPC 原子提交的固定 `ProviderResponseArtifact` strict
  document，same scope/run/invocation；Artifact content hash 与 Provider response hash 分别验证；
- `load_provider_invocation` / public projection reader：exact scope/ref/hash。

四表 FORCE RLS、append-only trigger、scope-complete PK/UQ/FK、NOLOGIN owner；backend/worker/reconciler 只有对应 RPC
execute，无直接 DML。RPC `SECURITY DEFINER SET search_path=''`，统一 DB clock/canonical hash。10654 不 backfill、
不改历史行、不建 dual path。

Intent 只保存不含 attempt-bound Context Receipt/lease/fence/dispatch hash 的稳定 invocation spec 与
`invocation_key_hash`。Permit 才保存一次 Attempt 的完整 dispatch binding。若 Permit 已提交但尚未出现
DISPATCH_MARKED，Worker takeover 可在新 Fence 下复用同 Intent 并签发新 Permit；旧 Permit 自动失效。若已出现
DISPATCH_MARKED，则是否允许新 Permit/重调必须由已认证 recovery capability 和 evidence 决定。

`COMPLETED` 的正文与技术 Usage 由同一个10654窄RPC提交：事务内先把正文写成受ACL保护、同Run的固定
`ProviderResponseArtifact`，再写只含Ref/Hash的 Outcome 与 Usage。事务整体提交前不会释放输出；若客户端未收到
数据库响应，只能重放相同 command/hash并读取已提交结果，不能再次调用Provider。这样消除“Artifact已提交但
terminal未提交”的恢复空洞，Worker restart能恢复输出，Invocation表仍不保存raw response。

## Recovery Semantics

| Observed state | Safe action |
|---|---|
| No Intent | Rebuild/validate envelope, then begin |
| INTENT_COMMITTED | Revalidate active lease and start once |
| DISPATCH_MARKED + idempotent/status-query proof | Query/reconcile; resend only with explicit proof |
| DISPATCH_MARKED + AT_LEAST_ONCE_ONLY or ambiguous transport | Mark OUTCOME_UNKNOWN; no ordinary retry |
| RESPONSE_OBSERVED | 原 Worker 可提交 exact terminal + Usage；若 Worker 已失活且正文/Usage 未提交，则由受控恢复追加 `OUTCOME_UNKNOWN`，绝不 redispatch |
| OUTCOME_UNKNOWN | Reconcile only; never overwrite or execute as new retry |
| terminal | Return recorded result/projection; no Provider call |

外部 exactly-once 不作承诺；本地 Intent/Outcome/Usage 单次接受与 immutable lineage 可证明。

## Worker Composition

`AuditedModelProvider` 接收可信 token counter、data projection/taint verifier、PostgreSQL Invocation Store 与 private
transport `ModelProviderPort`。`RunExecutionContext` 提供不可结构伪造的 provider-dispatch capability；Research
Executor 只能通过该 capability 发起调用。`run-worker-cli` 组合不导入 `billing-gated-model-provider`，也不接收
`ModelBillingPort`。

Provider transport 的 stream delta/tool candidate 在 Worker 内存中缓冲；只有 terminal Outcome/Usage Receipt 提交
后才能向 answer/public event/Agent handoff 释放。Mastra `completed`、本地字符串或 UI 状态不是 Authority。
Worker crash 后恢复顺序为：重验 lease/config ->
读取 Intent/Outcome -> reconcile unknown -> 决定返回记录或继续。

调用前的数据最小化不接受调用者自报的 `payload_hash`/`taint_hash`。U3 为既有
`AgentDataProjectionReceipt` 增加 pricing-free `agent-data-projection@2.0.0` 分支；旧 v1 语义保持不变，但不能进入
U3 Provider admission。v2 由受保护 Artifact Authority 在 `begin_provider_invocation` 前提交，冻结同 Scope/Run/
logical Request、exact execution profile hash、输入 Artifact refs、approved fields/classification、minimized payload
hash、可信 input token 数、redaction/DLP/taint policy version 与 taint hash。Dispatch Envelope 必须携带该 Receipt
的 exact Reference。Receipt ID 与 Provider Invocation/Request ID 一致，不含 Attempt/Fence；同一逻辑调用在网络前
takeover 时复用同一 immutable Receipt。stable Intent hash 与 per-attempt dispatch hash 都覆盖该稳定 Reference，后者
另覆盖 Context Receipt/Lease/Fence。PostgreSQL begin 从 Artifact
Store 加载 committed v2 document 并逐字段核对。缺失、旧版本、wrong request、hash tamper 或字段不一致都在网络
调用前 fail closed。该 v2 不包含 reservation、cost、price、credit 或其他商业字段。

## Selector and Execution Readiness

资源目录返回 server-owned Profile revision、Provider/Model、Certification、Context/Output 上限及状态：
`AVAILABLE | CERTIFICATION_REQUIRED | CREDENTIAL_UNAVAILABLE | CONTEXT_WINDOW_UNVERIFIED | DISABLED | STALE`。
`selectable` 只在执行认证与凭据条件满足时为 true；不再出现 `UNBILLABLE`。Admin 可跳 Platform Settings，Analyst
只看到稳定原因/Request Access。Conversation resource switch 仍由版本 CAS 冻结，U2 receipt 最终锁定 Profile。

## Conflict Strategy

共享工作树已有大量并行修改。优先新增独立模块/测试；对 `packages/platform/src/index.ts`、
`apps/worker/src/run-worker-cli.ts`、`research-workflow-executor.ts`、`apps/web/src/lib/qa-store.ts`、Model Selector 与 SQL
static-check 只 stage U3 精确 hunk。`apps/worker/src/mastra.ts` 的未提交 Billing wrapper 不是 U3 基线，禁止纳入提交。

## Security Review Gates

- Candidate JSON 不能伪造 durable dispatch permit 或 Authoritative brand。
- SQL begin 前网络调用计数必须为 0；terminal commit 不确定时只能 replay same hash/load state。
- Public/SQL/log/source scan 不包含 raw prompt/response/header/credential/SecretRef value。
- Profile/Certification/Config/Context/Lease/Fence stale 均 fail closed。
- U3 imports/SQL spy 不触及 Billing/Pricing/Credit；真实 smoke 只调用 DeepSeek V4 Flash 一次。
