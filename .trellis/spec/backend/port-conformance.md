# Port Conformance

> Hosted、Docker 与 In-Memory Adapter 必须共享 Scope、幂等、终态和错误语义。

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
authorizeBenchmarkAdapterReceipt(receipt, verifyCommitted);
authorizeSandboxExecutionReceipt(receipt, verifyCommitted);
SandboxPort.execute({
  schema_version,
  scope,
  run_id,
  execution_id,
  idempotency_key,
  language,
  payload,
  budget,
});

for (const contractCase of PORT_CONFORMANCE_CASES) {
  await contractCase.run(createAdapterHarness);
}
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
- Model Provider、External Agent 与 Benchmark Suite 使用彼此独立的版本化 Port；所有请求和响应 Artifact Reference 都必须与事件属于同一 App/Tenant/Environment/Run。
- Model Provider Port 只接受绑定同 Scope、Profile Version、Model ID 且已经 `AVAILABLE` 授权的调用。
- External Agent Port 只接受由服务端 Profile Resolver 授权的调用；请求只能收窄 Workspace Root、可写权限、Tool、Command ID 与超时预算，不能自行扩权。
- Model、External Agent 与 Benchmark 的每个流事件都必须用原始请求校验 Scope、Run、Attempt 及各自的 Request/Invocation/Adapter ID 与版本元组，不能只做孤立 Schema Parse。
- Benchmark 与 Sandbox 的成功 Receipt 必须处于规定成功终态、引用已提交并经各自 Authorizer 品牌化；通用 `isCommitted=true` 不能代替领域成功语义。
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
| Model 请求未绑定 `AVAILABLE` Profile | `MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED` |
| External Agent 请求扩大 Workspace/Permission/Budget | `EXTERNAL_AGENT_INVOCATION_NOT_AUTHORIZED` |
| 流事件与原始请求的 ID、Scope、Run、Attempt 或版本不一致 | `PORT_EVENT_CORRELATION_MISMATCH` |
| Benchmark/Sandbox 成功 Receipt 未提交或未授权 | 对应领域 Authority Error |
| Redis/Cache 丢失 | 从 PostgreSQL 权威状态重建 |

### 5. Good / Base / Bad

- Good：两个 App 使用相同业务 Key 时各自读写、去重和 Lease，互不观察。
- Base：同一请求重复投递只返回原 Command ID。
- Bad：Map 或 Redis 只以 `key`、`idempotency_key` 建索引。

### 6. 必需测试

- 两个 App/Tenant 对相同 Storage/Cache Key 隔离。
- 两个 Scope 对相同 Idempotency Key 分别创建 Command。
- 同 Scope/幂等键的同载荷重放稳定，异 Command 或异 Payload 显式冲突。
- 伪造 Lease、跨 Scope Ack、重复 Ack 与 Ack 后空队列。
- Active Lease 未到期不可重复获取；到期后新 Worker 取得更高 Fence。
- Cache 拒绝非法 TTL，在 TTL 前可读、边界时刻过期。
- Sandbox 相同规范输入重放、不同输入生成不同 Hash、同键冲突。
- Environment/Key 包含分隔符时不能发生复合键碰撞。
- Hosted、Docker、In-Memory Adapter 使用相同 Conformance Case。
- Model/External Agent 未授权调用失败；请求授权不能由调用方自证 Profile 或扩大权限。
- Model、External Agent、Benchmark 的事件在所有事件分支上都要拒绝请求关联不一致。
- Benchmark 的 `CASE_LOADED`、`SCORE_CANDIDATE`、`COMPLETED` 和 Sandbox 的响应引用跨 Scope 时失败。
- Benchmark/Sandbox 只有成功终态、已提交引用的 Receipt 能取得领域品牌。

### 7. Wrong vs Correct

#### Wrong

```ts
const storageKey = `${scope.environment}:${key}`;
records.set(storageKey, value);
```

#### Correct

```ts
const storageKey = canonicalizeJson([
  scope.environment,
  scope.app_id,
  scope.tenant_id,
  key,
]);
records.set(storageKey, value);
```
