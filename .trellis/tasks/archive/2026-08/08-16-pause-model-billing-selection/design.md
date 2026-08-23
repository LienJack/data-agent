# 暂停模型计费并恢复选择设计

## Data Flow

```text
billing runtime mode
  -> PostgreSQL runnable model projection
  -> Q&A resource catalog
  -> Conversation resource switch
  -> immutable Run binding
  -> Worker billing adapter
```

## Decision

- 复用既有 `SHADOW` 作为当前阶段的暂停扣费模式：它不创建用户积分 Hold、不扣减余额，未来仍可通过权威命令恢复 `ENFORCED`。
- 新增向前迁移提供窄的环境模型目录同步函数，并强化 active catalog：只有 `SHADOW` 下由服务端确认存在环境凭据的稳定系统 Profile 才能绕过价格链进入 `ACTIVE`。
- Q&A 仍只消费 PostgreSQL runnable catalog；Web 在读取资源目录前把服务端已解析且不含凭据的系统模型元数据同步到数据库。
- 环境目录同步使用 deployment/environment 级 advisory transaction lock；并发的 React/Route 请求不能重复首次插入同一 Profile。
- PostgreSQL 的可空 `provider_connection_id` 在 Platform 边界归一化为缺省字段，再交给严格 Public Contract 解析。
- 本地部署通过既有超级管理员 `decide_billing_mode` 命令从 `ENFORCED` 切换到 `SHADOW`，不直接更新表。

## Safety

- 只有 active `SUPER_ADMIN` 可切换模式。
- `DISABLED`、缺失凭据或已归档供应商不会因暂停而变成可用。
- 环境凭据只在 Web server 判定 runtime projection；数据库只保存安全模型元数据和状态。
- 恢复 `ENFORCED` 后 active catalog 立即重新要求价格、汇率及结算链；未完成门禁的系统模型重新不可选。
- 本任务交付到 Conversation/Run binding 边界；Worker 真实 Provider/Text2SQL 执行仍按 Q&A 规范保持 `HOLD`，不能把选择成功表述成执行闭环。
