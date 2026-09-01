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
- AUTO JSON.parse 失败可附私有 `response` 测量：固定 finish_reason、EMPTY/WHITESPACE/NON_JSON 分类、
  fullOutput/streamed 文本 UTF-8 字节数、非空 text-delta 数、已观察工具数及可用 output token 数。
  仅有限枚举与非负 safe integer；未知枚举归 unknown、非法/缺失计数归 null，其他键一律不投影。
  这是区分空响应、Provider length 结束和内容格式问题的观测，不是响应正文、恢复证据或额度完整凭据。
  没有该测量的旧失败不能补推原因；JSON mode 不是成功保证，不以计数补造文本、提取 JSON 或重放调用。
  测试须使用固定 DeepSeek SDK + Mastra 的离线 SSE 验证空/空白/length/非JSON/fence 分类、原失败终态、
  一次 fetch、marker 顺序及无原文泄漏；恶意字段、无穷/负/小数计数和异常 getter 均须脱敏失败关闭。
- Required tests：stage 分类、真实 adapter/bridge 生产路径、伪造 stage/未知路径/超长结构/抛异常 getter 脱敏、日志 sink 失败及终态不变。

### 完整空响应的确定拒绝

- AUTO 原 stream 已完整 drain、getFullOutput 成功、无 error/abort/工具活动，结束为 stop/length，
  最终及已观察文本都仅空白，且已报告 usage 不越过冻结预算时，可生成包内不可序列化的空响应标记。
  Adapter 仅在已 dispatch 且持有该标记时返回 `FAILED/MODEL_RESPONSE_EMPTY`、known、retryable=false。
  日志 stage/计数、同形 Error、模型输出均不是该标记。
- 同一 AUTO JSON.parse 拒绝边界，在上述完整结束、无活动、预算约束下，非空原文本还必须与逐块观察文本完全相等，
  才生成独立的包内不可序列化标记，返回 `FAILED/MODEL_RESPONSE_INVALID_JSON`、known、retryable=false。
  这不是修复/接收 JSON：不提取 fence、不删除 prose、不重新格式化。缺失/未知 finish、断流、文本不一致、
  native 工具活动/错误、超预算，以及合法 JSON 的 Schema 错误，仍走原失败路径；REQUIRED/零工具流程不变。
- ModelProviderEvent 的 KNOWN FAILED 仅允许上述两个 reason 且不可重试。持久 transport 映射到现有
  `PROVIDER_PROTOCOL_VIOLATION` known FAILED；先 ResponseObserved、再原 terminal RPC，call_count=1、
  recovery_action=NONE、response_ref/hash=null，不产出成功响应或伪造已报告 token。无新 DB authority/RPC/migration。
- 只有 terminal 持久化成功后的该 reason+certainty 组合产生 `PROVIDER_RESPONSE_REJECTED`。
  restart 从持久 outcome 读取相同结果，不重派原调用；commit 失败不向 Root 提供恢复反馈。
  Root 可先 checkpoint 再用不同 logical invocation 开始下一正常决策，消耗原四回合预算，不是 Provider retry。
- 旧 OUTCOME_UNKNOWN 不重新分类、不用日志补收据、不重放；其他响应协议错误也不因此恢复。
  必测真实 SDK 一次 fetch、空/非 JSON stop/length、断流/未知 finish/超预算/native 活动反例、复制诊断无效、终态重放零网络、
  checkpoint 失败零后续调用和四回合耗尽。此分类适用于 AUTO；REQUIRED/无工具流程不变。
  固定 SDK 可能把不完整 native 输入转成候选 `{}`；transport COMPLETED 不等于工具接收，Host 必须严格拒绝非法参数，
  且不得将此原工具活动重新归类为纯文本拒绝。

### Contracts

- Provider、Profile、Model、上下文预算和超时仍由服务端冻结；浏览器、模型输出和调用方不得覆盖。
- DeepSeek 的 server-owned AUTO+tools 使用原 SDK JSON mode，仅约束文本语法，不强制工具、注入新业务信息或增加调用。
  `json_object` 由固定 SDK 从 `responseFormat:{type:"json"}` 产生；固定 `Return JSON.` prefix 必须在真实 SDK 离线 wire 测试中锁定。
  不剥离 fence/prose、不兜底重写 JSON、不接受空内容；原 Response Schema 与 dispatcher marker/终态/不重放边界不变。
  REQUIRED 和其他 Provider 默认保持原行为；不能由用户 payload 开关这项部署策略。
- 零工具调用默认继续使用 Mastra Structured Output。只有 server-owned `ServerModelResponseSchemaRegistry` 对 exact schema version
  固定 `delivery_mode=JSON_TEXT` 时，才允许同一次调用使用原 SDK JSON mode；当前 Semantic selection schema 以及带内部
  `final_summary_constraint` 的 request-isolated Analysis FINAL schema 启用。原始完整文本必须
  先 `JSON.parse`，再通过同一个注册 Zod strict schema 并 canonicalize；空白、非 JSON、Markdown fence、尾随 prose、错类型、额外字段和
  schema mismatch 全部失败关闭。禁止提取局部 JSON、修补模型文本、增加 Provider 调用、跳过 schema 或把该模式用于工具调用。
- `JSON_TEXT` 必须把 registry 从同一 Zod schema 确定性生成的 canonical JSON Schema 原样加入该次服务端 system instructions；不能只发
  `json_object` 语法约束后要求模型从自然语言猜嵌套类型。该 schema instruction 与原业务 system instruction 均进入 trusted UTF-8 upper
  bound；registry 保留 exact canonical bytes，模型、用户与题库不能提供或覆盖 schema。返回值仍按完整原文严格验证，不允许利用 schema
  instruction 增加 Host coercion、默认值或 repair。
- Semantic selection 的 selected/candidate/ambiguity ID 数组是 set-like provider 表示。其 exact provider schema 先用原强 ID schema
  验证并拒绝重复项，再只按 JavaScript 默认字符串顺序确定性规范化数组；随后执行与最终 intent 相同的跨字段约束，且 production team tool
  必须再次通过原 canonical intent strict schema。Host 不得增删/替换 ID、operation 或 ambiguity，不得读取题面决定 membership，也不得把
  该窄 canonicalization 扩展到自由文本、SQL、公式、窗口或其他 response schema。
- `JSON_TEXT` 是 build-bound 服务端部署策略，不进入用户请求或模型输出。Trusted token upper bound 仍按完整注册 schema 计算；
  dispatch marker、usage、known empty/invalid JSON 分类、protected response commit 与不重放边界不变。私有协议诊断只记录固定
  `JSON_TEXT_RESPONSE_INVALID_JSON` stage 与有界计数，不能记录原文或反向授予成功。
- 凭据只从服务端环境解析，不写入数据库、Artifact、Event、日志或浏览器投影。
- 调用请求必须绑定 exact Scope、Run、Attempt、Model 与响应 Schema，并在边界解析所有 Provider 事件。
- 不读取模型认证状态，不创建 Intent/Permit/Dispatch/Usage 权威记录，也不执行积分、额度或扣费步骤。
- 允许对明确可重试的网络、限流、超时或不可用错误做一次进程内重试；不确定是否送达时不得无限重试。
- 直连结果不是 SQL、Evidence 或业务结论权威。数据问题仍必须先走只读 Sandbox，并提交 QueryEvidence；
  通用问答输出只能作为 Run 的公开回答投影。
- Analysis FINAL可携带内部Executor在原Oracle后生成的`final_summary_constraint`，不是浏览器或模型提供的Schema。
  仅对该调用建立原两字段响应的literal收窄并固定`JSON_TEXT`交付，约束内容进入task hash；共享registry、无约束Analysis请求及
  其他响应协议不变。该交付仍只发原一次零工具JSON-mode调用，完整原文须通过同一literal Zod strict schema。
  TOOL阶段、空白/超长约束在网络前拒绝；不能把不匹配的模型文本替换成服务端文本后伪称原响应。
  业务来源/解释接收和恢复仍由 [Analysis反馈契约](./analysis-agent-feedback.md) 及原阶段权威验证。

### Required tests

- Contract 测试证明直连请求不需要 Certification Receipt 或 Permit 仍可获得严格品牌。
- Worker 测试覆盖 Scope/Run/Attempt 换绑、缺凭据、非法请求、Provider 稳定错误码与单次重试上限。
- Agent Runtime 离线真实 SDK wire 测试覆盖 server-owned `JSON_TEXT` 的一次 DeepSeek fetch、`json_object`、零 tools、strict PASS、
  exact canonical schema system instruction、schema mismatch、空白与非 JSON；默认 schema 仍走 Structured Output，用户请求不能选择
  delivery mode 或提供 schema instruction。
- Worker测试证明只有带合法内部约束的Analysis FINAL建立request-isolated literal schema并使用`JSON_TEXT`；无约束FINAL仍走默认
  Structured Output，TOOL/空白/超长约束在Provider调用前拒绝，两个约束互不污染且改变task hash。
- Contracts/Worker 测试覆盖 Semantic provider set canonicalization、final strict reparse、重复/非法 ID、未知字段、空 intent 与 operation
  未绑定失败关闭，并证明实际 registry 使用 provider-only schema。
- 真实运行证明调用前后持久 Intent/Permit 行数不增加，且公开 Event 不出现 Root/Specialist 生命周期。
