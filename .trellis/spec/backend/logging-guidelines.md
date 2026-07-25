# 日志、审计与脱敏规范

> U2 只建立结构、字段边界与失败关闭规则；具体日志库在 Worker/App 落地时选择。

## 三类记录

| 类型 | 用途 | 是否权威 |
| --- | --- | --- |
| Runtime Log | 运维诊断，可采样、可丢弃 | 否 |
| Trace/Event | Run 执行路径与性能分析 | 否，必须引用 Artifact/Event ID |
| `audit_log` | 权限、命令、Secret、Lifecycle 等治理动作 | 是，PostgreSQL 不可变记录 |

运行日志不能替代 Audit；Audit 也不能保存可回显 Credential。

## 最小结构

允许的稳定字段：

```text
timestamp
level
event_name
reason_code
app_id
tenant_id
environment
principal_id
run_id
command_id
artifact_id
outbox_id
trace_id
policy_version
duration_ms
```

字段不存在时省略，不填空字符串。公开错误只返回稳定 Reason Code 和脱敏中文消息；
数据库、Provider、Connector 的原始错误不得进入 API Response。

## 级别

- `debug`：本地或受控环境的非敏感状态；默认生产关闭。
- `info`：Run 状态迁移、Command 接受、Outbox 发布、Capability 解析成功。
- `warn`：拒绝的越界访问、幂等冲突、Lease/Fence 过期、Provider Pending/HOLD。
- `error`：数据库不可用、不可恢复的 Worker 失败、确定性契约破坏。

拒绝事件不得记录请求中的原始 Secret、Datasource URL Userinfo、SQL Value 或完整 Tool
Output。

## 禁止记录

- Authorization/Cookie/API Key/Password/Private Key/DSN 中的 Credential。
- Secret Provider 原始 locator；数据库只保存其 SHA-256。
- 用户问题中的原始敏感值、SQL Result 行、Prompt 全文或 Agent Raw Memory。
- `Error.stack` 直接返回客户端。
- 仅依赖字段名白名单放行未知嵌套对象。

在进入 Logger、Artifact、Command Payload 与 Trace 前统一调用深度脱敏/疑似明文
Secret 检测。无法证明安全的嵌套值用 `[REDACTED]`，而不是“尽量保留”。

首版 Run Command Payload 不是任意 JSON，只接受 `kind`，以及可选的 `mode: "L2"`、
`question_version`、`dataset_id`、`secret_refs: SecretRef[]`。未知字段、Question 中的
Credential、非规范 SecretRef 或明文连接串必须在数据库 I/O 前失败；SQL 端以同一
Schema 与 Canonical Hash 再验证一次。

## Audit 约束

- Audit 与对应权威状态变化必须在同一 PostgreSQL 事务内写入。
- `audit_log` 由不可变 Trigger 保护，不更新、不删除。
- `details` 只保存 ID、Hash、Version、Reason Code、Receipt Reference。
- Lifecycle、Secret Provider Effect 与 Cleanup 使用独立不可变 Receipt；Audit 只引用
  Receipt ID，不能自称外部副作用成功。

## 验证

安全测试至少断言：

1. Sink/DB/Connector 原始错误不会出现在公开结果。
2. 常见别名、`key=value`、Token 形态和未知嵌套值被脱敏。
3. Command/Artifact 中疑似明文 Secret 在数据库 I/O 前被拒绝。
4. Secret Rotate/Revoke 无 Provider Receipt 时只处于 Pending。
