# 本地开发与 Docker 部署双模式

## Goal

建立清晰、可重复的两套运行模式：

- 开发模式只在 Docker 中运行 PostgreSQL 与 Neo4j，Web、Durable Worker 与
  Relationship Indexer 作为本地进程运行，源代码变化能够自动重载；
- 部署模式通过 Docker Compose 构建并运行完整服务栈，不依赖宿主机上的 Node.js
  应用进程。

目标是缩短日常开发反馈周期，同时保留与部署环境一致、可验证的容器交付路径。

## Background

- 当前 `compose.yaml` 默认同时启动 PostgreSQL、Web 与 Worker；Neo4j 和
  Relationship Indexer 位于 `relationship-index` profile。
- Web 已有 `next dev --turbopack` 开发入口，但根目录没有统一的开发启动脚本。
- Relationship Indexer 有可持续运行的 CLI，并每隔固定时间轮询 PostgreSQL，依赖
  PostgreSQL 与 Neo4j。
- Worker Docker 镜像当前执行 `node apps/worker/dist/index.js`，但该入口只重新导出模块，
  没有装配并启动 Durable Run 轮询循环；当前容器会以退出码 0 立即结束并被 Compose
  重启。
- 数据库迁移是独立的一次性 Compose profile，迁移成功必须以退出码和
  `platform.migration_ledger` 证据确认。
- PostgreSQL 是语义权威；Neo4j 只是可关闭、可重建的关系查询投影。

## Requirements

- R1. 提供明确的开发基础设施命令，默认只启动 PostgreSQL 与 Neo4j 两个数据库容器，
  不启动 Docker Web、Worker 或 Relationship Indexer，避免端口冲突和旧镜像遮蔽
  本地代码。
- R2. 提供本地 Web 开发命令，使用 Next.js/Turbopack 热更新，并加载与 Docker Web
  等价的非秘密运行配置。
- R3. 提供真正可持续运行的 Durable Worker 可执行入口，并提供本地 watch 模式；同一
  入口必须可供部署镜像使用，避免本地与容器执行不同逻辑。
- R4. 默认以本地 watch/重启模式运行 Relationship Indexer，并连接 Docker 中的
  PostgreSQL 与 Neo4j；索引器故障或显式禁用时不得阻断 Web、语义治理或 PostgreSQL
  回退查询。
- R5. 保留完整 Docker 部署模式，容器间使用 Compose 服务名通信，宿主机本地开发则使用
  `127.0.0.1` 暴露端口；两种模式不得混用数据库连接地址。
- R6. 开发与部署命令必须清楚区分，并记录启动、迁移、健康检查、停止和常见端口冲突的
  操作方法。
- R7. 开发配置只引用本地 `.env`/`.env.local` 中的 Secret，不把 API Key、数据库密码或
  其他凭据提交到仓库；文档和示例只列变量名或安全默认值。
- R8. 开发命令必须能分别启动/停止单个应用进程，也应提供一个聚合命令启动所选本地
  应用进程；任一进程失败时要有可见退出状态，不得静默吞错。
- R9. 部署 Compose 的 Web、Worker 与 Relationship Indexer 必须使用构建产物运行，且
  Worker 不能再出现“正常退出后无限重启”的假运行状态。
- R10. 日常开发启动不得隐式重放或应用数据库迁移；启动流程必须先检查数据库健康与
  Migration Ledger，就绪时启动本地应用，未就绪时失败关闭并提示显式迁移命令。

## Acceptance Criteria

- [x] AC1. 执行开发基础设施命令后，`docker compose ps` 中只有 PostgreSQL 与 Neo4j
  数据库容器处于健康状态，没有 Web、Worker 或 Relationship Indexer 应用容器。
- [x] AC2. 本地 Web 启动后可访问健康/业务页面；修改前端源文件无需重建镜像即可在浏览器
  中生效。
- [x] AC3. 本地 Worker 保持运行、能够领取一个测试 Run、产生 heartbeat，并将测试 Run
  推进到明确终态；修改 Worker 源码后进程自动重启。
- [x] AC4. 默认开发模式下，本地 Relationship Indexer 的 `/live` 返回 200，能完成一次
  `IDLE` 或 `INDEXED` 周期；修改索引器源码后进程自动重启。
- [x] AC5. 禁用 Relationship Indexer/Neo4j 时，Web 与语义治理仍可用，关系搜索使用有明确
  原因码的 PostgreSQL 回退。
- [x] AC6. 完整部署命令能构建并启动全部五个长期服务；PostgreSQL、Web、Worker、Neo4j 和
  Relationship Indexer 分别通过与职责相符的健康/存活验证。
- [x] AC7. 迁移命令在开发和部署模式中都有明确入口，并用非零退出码阻断失败；成功后可在
  `platform.migration_ledger` 查到预期版本。
- [x] AC8. 仓库文档明确给出“开发模式”和“部署模式”两条命令路径，新开发者无需猜测端口、
  环境变量来源或应该运行哪个进程。

## Key Decisions

- D1. 用户选择开发模式默认同时运行 PostgreSQL 与 Neo4j 两个 Docker 数据库；三个应用
  服务全部在宿主机运行。
- D2. `pnpm dev` 可以启动并检查数据库基础设施，但不得自动应用迁移；数据库未就绪时
  输出显式迁移命令并以非零状态退出。
- D3. Worker 的本地 watch 与部署容器复用同一个可执行组合入口，环境差异只通过配置注入。
- D4. PostgreSQL 保持唯一语义与 Run Authority；Neo4j 和本地 Indexer 失败只影响图索引
  加速，不提升为 Web 启动依赖。

## Out of Scope

- 不把 PostgreSQL 或 Neo4j 改成宿主机原生安装。
- 不改变 PostgreSQL 作为语义唯一权威、Neo4j 作为可重建投影的架构边界。
- 不在本任务中增加新的业务工作流、模型 Provider 或语义能力。
- 不把生产 Secret 写入 Compose、脚本、示例环境文件或 Git 历史。
