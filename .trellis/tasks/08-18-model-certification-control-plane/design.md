# 模型认证控制面与前端入口技术设计

## Flow

```text
点击认证
  -> SUPER_ADMIN 校验
  -> 服务端读取当前 catalog config 与 API Key
  -> GET provider /models（一次）
  -> 非空数组
  -> 更新 model_catalog_entries 的认证字段
  -> Q&A 读取 PASS 并设为 selectable
```

## Data

现有 `model_catalog_entries` 增加五个内部字段：

- `api_authenticated_config_version`
- `api_authenticated_at`
- `api_authentication_response_count`
- `api_authentication_idempotency_key`
- `api_authenticated_by`

不新增认证表、证书、hash 或 resolver。只有 `api_authenticated_config_version = config_version` 时状态为
`PASS`。API 响应正文不持久化。

## API

- `GET /api/admin/model-certifications`：读取安全状态视图。
- `POST /api/admin/models/:modelProfileId/certifications`：同步请求一次 `/models` 并记录结果。
- 数据库只有 `record_model_api_authentication` 与 `list_model_api_authentication_views` 两个窄函数。

## UI

设置页显示两态按钮和同步 loading。成功后重新读取状态；失败保留旧状态。Q&A 只用 `PASS` 覆盖模型
选择 readiness，不修改 Worker 或 Provider Invocation 执行链。
