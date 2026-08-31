# Provider Invocation Authority

> 本规范记录历史 U3 持久调用权威链，以及当前生产模型直连边界。Falcon scoring、业务数据导入和最终发布验收不属于本场景。
>
> 当前约定（2026-08-23）：所有生产模型入口统一使用服务端配置的轻量直连网关，不再要求模型认证、
> `provider_invocation_intents` / `provider_invocation_permits` 或其他持久化调用许可。既有 U3 表、RPC、
> 迁移与读取器只用于历史数据兼容、审计和回放，不得重新接入 Q&A、Semantic Authoring、Test Center 或
> Falcon 的活动调用路径。

## Scenario: 从 U2 Effective Config 发起可恢复的 Provider 调用

### 1. Scope / Trigger

- 修改 Model Selector、Q&A Run selection、Provider transport、Worker 调度、Usage Receipt 或 `10654` 时适用。
- 本节生命周期仅适用于历史持久调用记录的兼容与回放，不是新生产调用的前置条件。
- PostgreSQL 是 Intent、Permit、Dispatch、Response Observation、Terminal、Usage 与受保护 Response Artifact 的唯一权威。
- Zod Parse、Mastra event、调用方自报 hash 或进程内对象都不能授予持久 Authority。

### 2. Signatures

```text
resolve_conversation_run_selections(conversation_id uuid, expected_resource_version bigint)
begin_provider_invocation(requested_lease jsonb, requested_command jsonb)
mark_provider_invocation_dispatched(requested_lease jsonb, requested_command jsonb)
mark_provider_invocation_response_observed(requested_lease jsonb, requested_command jsonb)
commit_provider_invocation_completed(requested_lease jsonb, requested_command jsonb)
commit_provider_invocation_terminal(requested_lease jsonb, requested_command jsonb, requested_usage jsonb)
mark_provider_invocation_outcome_unknown(requested_lease jsonb, requested_command jsonb, requested_usage jsonb)
reconcile_provider_invocation_unknown(requested_authority jsonb, requested_command jsonb, requested_usage jsonb)
load_provider_invocation(requested_command jsonb)
load_provider_response_artifact(requested_command jsonb)
```

```ts
verifyBeginProviderInvocationResult(command, result);
verifyMarkProviderInvocationStartedResult(command, result);
verifyMarkProviderInvocationResponseObservedResult(command, result);
```

### 3. Contracts

- 固定生命周期为
  `INTENT_COMMITTED -> DISPATCH_MARKED -> RESPONSE_OBSERVED -> COMPLETED | FAILED | THROTTLED | OUTCOME_UNKNOWN`。
- 本地 preflight 明确未 dispatch 时可直接形成 `FAILED + NOT_APPLICABLE`；不得伪造 Dispatch 或 Response marker。
- `DISPATCH_MARKED` 只能在 transport 完成全部本地检查、即将跨真实网络 suspension point 时提交。
- `RESPONSE_OBSERVED` 是 raw-free marker，严格绑定
  `intent_id/invocation_id/scope/run_id/dispatch_hash/attempt_id/worker_fence/observation_kind/response_hash/delivery_certainty`，
  并把数据库时间与 canonical `marker_hash` 持久化。
- 正常 `COMPLETED/FAILED/THROTTLED` 必须从 exact `RESPONSE_OBSERVED` 转移；尚未观察到可信响应但调用可能已送达时，
  才允许从 `DISPATCH_MARKED` 进入 `OUTCOME_UNKNOWN`。
- `COMPLETED` 在同一事务先提交同 Run 的 protected `ProviderResponseArtifact`，再提交 Outcome 与 Usage；事务提交前不得释放正文。
- 每个终态恰好一份 Usage Receipt。Provider 未报告 token 时使用 `UNAVAILABLE`，counts 为 null；不得写 0 冒充实际用量。
- Stable Intent 不绑定 Attempt；per-attempt Permit 绑定 exact WORKER_START Context Receipt、Outbox、Command、Worker、Lease Token 与 Fence。
- Provider execution identity 固定由服务端解析的 Profile/Config/Certification/Connection proof 决定。当前生产路径只允许
  `deepseek/deepseek-v4-flash + SYSTEM_DEPLOYMENT + [AT_LEAST_ONCE_ONLY]`，且 deployment 必须等于当前 DB-resolved Capability。
- U2/U3 Contract hash 使用 `app_data_agent.u2_canonical_sha256(jsonb)`：ECMAScript 数字格式与 UTF-16 key 顺序。
  旧 Run Command payload 的 `platform.canonical_sha256(jsonb)` 是独立历史域，不能混用。
- Invocation Store、日志和公共投影不得保存 raw prompt、response、tool arguments、headers、credential、SecretRef value、URL query 或商业字段。

### 4. Validation & Error Matrix

| 条件 | 稳定结果 |
| --- | --- |
| Scope/Run/Attempt/Lease/Fence/Config/Context 任一换绑 | 网络前失败，`PROVIDER_WORKER_LEASE_STALE` 或对应 Authority error |
| Profile/Model/Certification/Deployment 不一致 | `PROVIDER_EXECUTION_PROFILE_UNAVAILABLE` / `PROVIDER_CONNECTION_PROOF_INVALID` |
| Context、Output 或 Provider-call limit 超限 | durable `REJECTED + FAILED + NOT_APPLICABLE`，Provider call count=0 |
| 未提交 Dispatch Marker 就调用 Response Observed | `PROVIDER_RESPONSE_OBSERVED_MARK_NOT_COMMITTED` |
| 同一 Observation command/hash 重放 | 返回同一 marker，`disposition=REPLAYED` |
| 同 attempt 不同 response hash/kind | `PROVIDER_RESPONSE_OBSERVED_CONFLICT` |
| 正常 terminal 试图从 `DISPATCH_MARKED` 直接提交 | `PROVIDER_INVOCATION_TRANSITION_INVALID` |
| Dispatch 后无可信响应 | `OUTCOME_UNKNOWN + UNAVAILABLE`，禁止普通 retry |
| 已完成调用重启 | 返回 recorded terminal/ref，Provider call count 不增加 |
| Response/Usage/Projection/Permit hash 或 scope 漂移 | `DATABASE_CONTRACT_INVALID`，不得释放输出 |

### 5. Good / Base / Bad Cases

- Good：`begin -> dispatch marker -> response observed -> protected response + terminal + usage`，重启读取同一 Artifact，零二次调用。
- Base：容量 preflight 拒绝提交可审计 FAILED/NOT_APPLICABLE，Permit、Marker、网络调用均为 0。
- Bad：Mastra 收到 completed event 后直接公开文本，再异步补写 Outcome/Usage。
- Bad：从 `DISPATCH_MARKED` 直接提交 COMPLETED，跳过 response hash 与 delivery certainty 的持久观察。

### 6. Tests Required

- Contracts：marker canonical hash、tamper、unknown fields、kind/hash/certainty truth table、command/result exact closure。
- Platform：RPC 参数和返回值使用异步 verifier；坏 hash/scope/attempt 映射为 non-retryable database contract error。
- Worker：fake transport 证明 Intent 在网络前、Dispatch 在 suspension point、Response Observed 在 terminal 前；abort、429、credential、unknown、restart 全矩阵零泄漏。
- PostgreSQL：fresh PG17 全迁移；RLS/NOLOGIN owner/窄 grants；Observation replay/conflict；terminal 不可绕过；stale marker recovery 的 parent revision/hash；Usage 与 Response Artifact 原子性。
- Web：Conversation Profile B 不回退 Workspace Default A；目录只投影 server-owned technical readiness，不出现 Billing/Pricing/Credit。
- Forbidden scan：U3 runtime 不得出现 raw fetch/URL、Billing/Credit/Falcon/Anthropic/Claude 依赖。

### 7. Wrong vs Correct

#### Wrong

```ts
const response = await provider.invoke(request);
await store.commitCompleted(response);
return response.text;
```

#### Correct

```ts
const permit = await store.begin(envelope);
await transport.dispatchReady(() => store.markDispatched(permit));
const observed = await store.markResponseObserved(permit, bufferedTerminal);
const committed = await store.commitTerminal(observed, bufferedTerminal);
return committed.protectedResponse;
```

只有 `committed` Authority 可以释放输出；任何持久步骤不确定都必须 load/replay，不得重调 Provider。

## Scenario: 生产模型轻量直连

### Raw-free protocol diagnostics (2026-08-31)

- 所有调用路径共用的 Mastra adapter 可在 `MODEL_STREAM_PROTOCOL_VIOLATION` 时记录固定 stage 和有界 schema issue。
  区分 AUTO 无工具非 JSON、Response Schema 不匹配、Mastra structured validation、非法 chunk/重复调用/缺终态等阶段。
- 只允许 server-owned request/Run/schema identity、dispatch 布尔值、固定 stage/code/path；未知路径替换为 `$field`。
  issue ≤8、path ≤12、index 0–63；不记录 prompt/response/tool 参数、实际值、未知键、headers、URL、Secret 或任意 error message。
- 私有日志不进入公共 Event/Artifact，不授予证据或重试权限。日志写入失败仍输出原有唯一 FAILED/OUTCOME_UNKNOWN；
  不改变 schema、delivery certainty、dispatch/terminal、业务验收或任何调用预算。
- 没有 stage 的历史失败只能报告“协议原因未确定”，不得凭新诊断追认旧失败的具体原因。
- Required tests：stage 分类、真实 adapter/bridge 生产路径、伪造 stage/未知路径/超长结构/抛异常 getter 脱敏、日志 sink 失败及终态不变。

### Contracts

- Provider、Profile、Model、上下文预算和超时仍由服务端冻结；浏览器、模型输出和调用方不得覆盖。
- 凭据只从服务端环境解析，不写入数据库、Artifact、Event、日志或浏览器投影。
- 调用请求必须绑定 exact Scope、Run、Attempt、Model 与响应 Schema，并在边界解析所有 Provider 事件。
- 不读取模型认证状态，不创建 Intent/Permit/Dispatch/Usage 权威记录，也不执行积分、额度或扣费步骤。
- 允许对明确可重试的网络、限流、超时或不可用错误做一次进程内重试；不确定是否送达时不得无限重试。
- 直连结果不是 SQL、Evidence 或业务结论权威。数据问题仍必须先走只读 Sandbox，并提交 QueryEvidence；
  通用问答输出只能作为 Run 的公开回答投影。

### Required tests

- Contract 测试证明直连请求不需要 Certification Receipt 或 Permit 仍可获得严格品牌。
- Worker 测试覆盖 Scope/Run/Attempt 换绑、缺凭据、非法请求、Provider 稳定错误码与单次重试上限。
- 真实运行证明调用前后持久 Intent/Permit 行数不增加，且公开 Event 不出现 Root/Specialist 生命周期。
