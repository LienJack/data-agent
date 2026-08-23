# Workspace / Identity / Billing Reason Code Matrix

| Boundary | Condition | Public reason code | Retryable |
| --- | --- | --- | --- |
| Session | Cookie/session 缺失 | `AUTH_SESSION_REQUIRED` | 否 |
| Session | Session 无效、过期或撤销 | `AUTH_SESSION_INVALID` | 否 |
| Sign-up | 调用公开注册端点 | `AUTH_SIGNUP_DISABLED` | 否 |
| Identity | app user 已停用 | `APP_USER_DISABLED` | 否 |
| Workspace | workspace 不存在、无成员或跨 scope 对象探测 | `WORKSPACE_ACCESS_DENIED` | 否 |
| Workspace | workspace 已归档且请求写入 | `WORKSPACE_ARCHIVED` | 否 |
| RBAC | 有成员但角色不允许操作 | `WORKSPACE_ROLE_DENIED` | 否 |
| Identity command | 同 idempotency key 异规范输入 | `IDENTITY_OPERATION_CONFLICT` | 否 |
| Identity side effect | 认证 session/password 副作用未完成 | `IDENTITY_OPERATION_RETRY_REQUIRED` | 是 |
| Recovery | 操作会移除最后一个 active superadmin | `LAST_SUPER_ADMIN_REQUIRED` | 否 |
| Price/FX | 缺 active price、FX 或可计价维度 | `BILLING_PRICE_CHAIN_INCOMPLETE` | 否 |
| Credit | available 小于 conservative hold | `BILLING_BALANCE_INSUFFICIENT` | 否 |
| Billing | 同 operation key 异规范输入 | `BILLING_OPERATION_CONFLICT` | 否 |
| Billing | usage/价格/实际费用不确定或 actual 超 hold | `BILLING_REVIEW_REQUIRED` | 否 |
| Semantic import | 版本、hash、大小或内容无效 | `SEMANTIC_IMPORT_INVALID` | 否 |
| Semantic import | datasource ref 尚未全部显式映射 | `SEMANTIC_DATASOURCE_MAPPING_REQUIRED` | 否 |

公开错误只包含 code、脱敏 message 和 retryable；认证库、数据库、Provider 原始错误不进入
响应。对象不存在与越权在 workspace 业务边界统一为 `WORKSPACE_ACCESS_DENIED`。
