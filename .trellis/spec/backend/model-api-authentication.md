# Model API Authentication

> 模型认证是可选的管理端连通性诊断，不是生产模型调用或 Q&A 选择的前置条件。
> 模型可调用性由服务端 Provider/Model binding、环境凭据与 Workspace authority 决定。

## Scenario: 用一次模型目录请求诊断 Provider 连通性

### 1. Scope / Trigger

- 修改设置页认证按钮、认证 API 或模型目录认证字段时适用。
- 本流程只证明服务端凭据能读取非空模型目录，不是模型能力或质量认证。
- 新代码不得把本流程接入模型调用、Semantic Authoring、Test Center、Falcon 或 Q&A readiness。

### 2. Signatures

```text
GET  /api/admin/model-certifications
POST /api/admin/models/:modelProfileId/certifications
platform.record_model_api_authentication(deployment_id uuid, principal_id uuid, command jsonb) -> jsonb
platform.list_model_api_authentication_views(deployment_id uuid, principal_id uuid) -> jsonb
```

### 3. Contracts

- 浏览器 body：`model-certification-start@1.0.0`、profile、正整数 config version、8-128 字符幂等键。
- 数据库 command：`model-api-authentication@1.0.0`，另加 1-1000 的 `response_item_count`。
- 状态仅为 `NOT_CERTIFIED | PASS`；没有 Job、进度或证书引用。
- `PASS` 仅在认证 config version 等于模型当前 config version 时有效。
- Provider 响应正文、Header、Credential 和 URL query 不得持久化或公开。
- 活动生产入口不读取 `PASS/NOT_CERTIFIED`，不创建认证记录，也不因缺少认证记录禁用模型。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 非 `SUPER_ADMIN` | `SUPER_ADMIN_REQUIRED`，不请求 Provider |
| path/body 或 config 不匹配 | 稳定 4xx，不写状态 |
| API Key 缺失 | `MODEL_CREDENTIAL_NOT_CONFIGURED` |
| `/models` 失败或格式错误 | 脱敏 discovery error，不写状态 |
| `/models` 空数组 | `MODEL_CERTIFICATION_RESPONSE_EMPTY` |
| 同幂等键相同参数 | 返回原 `PASS` |

### 5. Good / Base / Bad Cases

- Good：非空目录 -> 写当前 config `PASS` -> 管理员看到诊断成功。
- Base：未认证或 config 已变化 -> `NOT_CERTIFIED`，不影响 Q&A 选择或 Provider 调用。
- Bad：创建 Job/Worker/认证证书来完成一次同步连通性检查。

### 6. Tests Required

- Route：非空成功、空响应、权限拒绝、path/body mismatch、无 Secret。
- Repository/SQL：参数闭合、幂等、config stale、回滚后无测试状态。
- Q&A：没有认证记录或认证记录过期时仍按 Model Control 与 Workspace authority 选择模型。
- 回归：配置有效且服务端凭据存在时，即使没有认证记录也能完成直连；调用前后认证记录不增加。
- Browser：按钮 loading、成功刷新、错误保留状态、移动端无溢出。

### 7. Wrong vs Correct

#### Wrong

```ts
await enqueueJob({ kind: "MODEL_CERTIFICATION" });
```

#### Correct

```ts
const models = await fetchProviderModelCatalog(serverOwnedConnection);
if (models.length === 0) return MODEL_CERTIFICATION_RESPONSE_EMPTY;
await repository.recordModelAuthentication(context, {
  model_profile_id: profileId,
  expected_config_version: configVersion,
  response_item_count: models.length,
  idempotency_key: idempotencyKey,
});
```
