# Job Center 运维手册

## 运行边界

Worker 进程同时启动 Run loop 与 Job loop，但两者使用独立的 queue、heartbeat、lease 和
fence。`GET worker:9091/live` 中：

- `run_queue_ready` 表示 Run loop 已进入轮询；
- `job_queue_ready` 表示 Job loop 已进入轮询；
- `initialized` 只有两个 loop 都 ready 时才为 `true`；
- `last_*` 与 `job_last_*` 只包含稳定状态和错误码，不含 SQL、输入、Secret 或堆栈。

任一 loop 报错时，另一 loop 继续工作。停止进程会同时触发两个 loop 的 AbortSignal；未提交
终态的 Job 由数据库 lease expiry/recovery 收敛。

## 诊断

- 公共 `GET /api/ready` 只返回最小 `{live,ready}`。
- 已登录且有 workspace read authority 时，请求
  `GET /api/ready?workspace_id=<uuid>` 可查看去敏 capability readiness。
- 工作空间任务列表：`GET /api/workspaces/:workspaceId/jobs`。
- 单任务读取/取消：`GET|DELETE /api/workspaces/:workspaceId/jobs/:jobId`。

Readiness 为 `NOT_READY` 不表示 Web 不可用。它表示缺少真实 Handler、fresh heartbeat、依赖或
规定的 output receipt；禁止通过重试 API 或手工改表伪造 READY。

## Artifact Export

Export POST 返回 `202` 和 Job submission receipt，不同步生成文件。Worker 成功后提交不可变
`ArtifactExportReceipt`，原 GET 下载路径再读取该 receipt。刷新或同键重试只回放同一 Job；
同键不同输入返回 `JOB_IDEMPOTENCY_CONFLICT`。

## 数据库验证

```bash
pnpm exec tsx scripts/render-migration.ts 10659 --verify
infra/supabase/test-support/static-check.sh
psql -v ON_ERROR_STOP=1 -f infra/supabase/test-support/37-job-center-authority-assertions.sql
```

Fresh PG 验证必须把 ecommerce 与 Falcon import hook 挂到 `/dev/null`。U10 验证不导入数据、
不运行 Falcon、不调用真实 Provider。
