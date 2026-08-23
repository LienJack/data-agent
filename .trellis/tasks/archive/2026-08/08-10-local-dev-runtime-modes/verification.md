# 验收记录

验收日期：2026-08-10

## 运行拓扑

- 开发 Compose：`docker compose config --services` 精确输出 `neo4j`、`postgres`。
- 当前开发容器：PostgreSQL 与 Neo4j 均为 `running/healthy`，没有 Web、Worker 或 Indexer
  应用容器。
- 部署 Compose：`docker compose --profile deploy config --services` 精确输出五个长期服务。
- `pnpm docker:migrate` 成功，29 个迁移与 Migration Ledger 一致。
- `pnpm docker:up` 完成真实镜像构建；PostgreSQL、Neo4j、Web、Worker、Relationship
  Indexer 五个服务全部 `healthy`。
- Web 返回 HTTP 200；Worker 与 Indexer `/live` 返回 HTTP 200 且完成 `IDLE` 周期；三个
  应用容器 `restart_count=0`。
- 验收后执行 `pnpm dev:infra`，恢复数据库-only 开发状态并保留命名数据卷。

## 本地开发

- `pnpm dev:check` 通过数据库健康、Migration Ledger、Authority 与端口门禁。
- `pnpm dev:apps` 成功启动本地 Next/Turbopack、Worker `tsx watch` 与 Indexer
  `tsx watch`；Web、Worker `/live`、Indexer `/live` 均返回 HTTP 200。
- 临时路由内容从 `dev-runtime-probe-v1` 改为 `dev-runtime-probe-v2` 后立即生效，未重启
  Next、未重建镜像；验收探针已删除。
- Worker 与 Indexer 均观察到 `IDLE` 周期，聚合进程收到 SIGINT 后子进程一并退出。

## 自动化门禁

- `pnpm test:dev-runtime`：6/6 通过。
- `pnpm --filter @data-agent/worker test:unit`：46/46 通过。
- 隔离 PostgreSQL 集成：Platform 13/13、Web 1/1、Worker 9/9 通过；覆盖真实 Lease、
  Heartbeat、Fence、终态和接管。
- Relationship fallback 聚焦测试：Semantic 8/8、Platform 6/6、Web 13/13 通过。
- Worker、Web、Agent Runtime 定向 typecheck 通过。
- 本任务 TypeScript/JSON 的定向 Biome、Shell 语法、Compose config 与 `git diff --check`
  通过。

## 工作区级已知阻塞

- 全仓 `pnpm lint` 仍被其他未提交模块的 121 个 Biome 错误阻断；本任务定向检查通过。
- 全仓 `pnpm typecheck` 仍被 `packages/evals/test/model-analysis-agent.spec.ts` 的
  `attempt_index` 非法字段阻断；本任务涉及的三个 package typecheck 均通过。
- 上述文件不属于本任务，没有在本任务中修改或纳入提交。
