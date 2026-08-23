# Data Agent 本地开发 Runbook

## 1. 运行边界

本地开发固定采用以下拓扑：

- Docker：PostgreSQL 17、Neo4j；
- 宿主机：Next.js Web、Durable Worker、Relationship Indexer；
- PostgreSQL 是 Run 与语义权威，Neo4j 是可删除、可重建的关系投影；
- 日常启动只检查 Migration Ledger，不自动执行迁移。

不要同时运行 Docker Web/Worker/Indexer 与本地应用进程，否则旧镜像可能占用端口并遮蔽
刚修改的源码。

## 2. 第一次启动

```bash
pnpm install

# 启动并等待 PostgreSQL、Neo4j 健康，同时停止并移除旧的 Docker 应用容器
pnpm dev:infra

# 显式应用尚未登记的迁移，并再次核验 Migration Ledger
pnpm dev:migrate

# 检查数据库、Ledger、Authority 映射与应用端口
pnpm dev:check

# 启动 Web、Worker、Indexer 三个本地 watch 进程
pnpm dev:apps
```

第一次完成后，日常开发使用：

```bash
pnpm dev
```

`pnpm dev` 的顺序是 `dev:infra -> 可选 dev:admin-sync -> dev:check -> dev:apps`。Ledger 缺失或 checksum
不一致时，它会以非零状态停止并提示执行 `pnpm dev:migrate`，不会隐式重放 SQL。

应用端口绑定前，根协调器会按 Turbo dependency graph 构建 Workspace package、核对导出文件与 output
digest，并为 Web、Worker、Indexer、Semantic Authoring 分别写入 opaque build identity。只准备构建证明、不启动
应用时执行：

```bash
pnpm dev:build
pnpm dev:check
```

`dev:check` 只验证已有证明，不会代替 build，也不会执行 migration。

## 3. 单服务调试

```bash
pnpm dev:web       # Next.js / Turbopack，端口 3000
pnpm dev:worker    # Durable Worker watch，/live 端口 9091
pnpm dev:indexer   # Relationship Indexer watch，/live 端口 9090
```

Worker 与 Indexer 均使用 `tsx watch`。修改对应 `apps/worker/src/**` 文件后，进程自动
重启；Web 源码变化由 Next.js/Turbopack 热更新。

修改 `packages/**`、package manifest、lockfile、`turbo.json` 或根 TypeScript 配置时，协调器会先停止受影响
进程，再合并变更、重建并核对新 generation。构建失败期间旧进程不会继续占用端口；修复文件后协调器会自动
重试。不要直接运行 `next dev`、`tsx watch` 或 `node packages/*/dist/**`，这些 raw 命令不属于受支持入口，
会绕过 freshness gate。

聚合命令收到 `SIGINT`/`SIGTERM` 时会转发给三个子进程。任一子进程意外退出时，其余
进程也会被停止，聚合命令返回非零状态，避免留下半套运行环境。

## 4. 环境变量

本地运行脚本按以下优先级合并环境：

```text
当前进程环境 > 根目录 .env.local > 根目录 .env > 可提交的本地默认值
```

Secret 只放在 Git 忽略的 `.env` 或 `.env.local`，不要写入 Compose、文档或提交历史。
常用变量名：

- `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`ZAI_API_KEY`；Platform 的 server-only Runtime Config
  边界临时兼容 `DeepSeekAPIKey`、`MoonshotAPIKey` / `KimiAPIKey`、`GLMAPIKey`。规范变量始终优先，
  兼容提升只记录变量名与 reason code，不记录值；连续两个 release 无使用证据后删除别名；
- `SEMANTIC_DEPLOYMENT_ID`、`SEMANTIC_TENANT_ID`、`SEMANTIC_PRINCIPAL_ID`；
- `SEMANTIC_EXPLORER_ENABLED`、`SEMANTIC_RELATIONSHIP_INDEX_ENABLED`；
- `WORKER_DEPLOYMENT_ID`、`WORKER_TENANT_ID`、`WORKER_PRINCIPAL_ID`；
- `WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET`（严格 JSON，按 12 个 Artifact Domain 与
  `REPORT_READ` 分别填写数据库签发的 Capability ID）；
- `NEO4J_PASSWORD`。

本地超级管理员可选同步使用以下变量名（值只写入 Git 忽略的 `.env` / `.env.local`）：

```dotenv
DATA_AGENT_LOCAL_SUPERADMIN_SYNC=YES
DATA_AGENT_BOOTSTRAP_EMAIL=<desired-superadmin-email>
DATA_AGENT_BOOTSTRAP_USERNAME=<unique-lowercase-login-name>
DATA_AGENT_BOOTSTRAP_NAME=<display-name-for-first-create>
DATA_AGENT_BOOTSTRAP_PASSWORD=<non-empty-secret-without-practical-maximum-length>
DATA_AGENT_BOOTSTRAP_WORKSPACE_SLUG=main-workspace
DATA_AGENT_BOOTSTRAP_WORKSPACE_NAME=Main Workspace
```

可先单独运行 `pnpm dev:admin-sync`。相同 email/username/password 返回 `UNCHANGED`，不提升
授权版本；发生变化时原子更新凭证、撤销旧会话并保留同一 `principal_id`、工作空间角色、
积分余额和历史账单。开关未精确设置为 `YES` 时完全跳过；production、非 `local`
deployment、非 `postgres` executor、目标邮箱冲突或多 active 超级管理员都会失败关闭。
`pnpm dev:check` 始终只读，不执行同步。

未配置 `WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET` 时，Worker 进程和 Queue 轮询保持
可用，但研究 Artifact 提交失败关闭为 `RESEARCH_ARTIFACT_AUTHORITY_NOT_CONFIGURED`；
`/live` 会显示 `research_authority_configured=false`。不要用随机 ID 或空对象冒充数据库
签发的 U6 Authority Capability。旧的单 ID 变量不再读取；跨 Domain 复用一个 Capability
会破坏数据库 Authority 边界，因此没有兼容入口。

本地 PostgreSQL migration ready 后，由 Provisioner 签发完整集合并注入当前 shell：

```bash
export WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET="$(pnpm --silent dev:research-authority)"
```

命令从当前 `WORKER_DEPLOYMENT_ID / WORKER_TENANT_ID / WORKER_PRINCIPAL_ID` 解析有效
Membership，数据库锁内签发 12 个 Artifact Domain 与一个 `REPORT_READ` Capability；
默认有效 24 小时。调用者不能指定 Capability ID，重复的 exact Manifest 不会产生第二套。

## 5. 健康检查

```bash
docker compose ps
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:9091/live
curl --fail http://127.0.0.1:9090/live
```

正常开发模式的 `docker compose ps` 中只有 `data-agent-postgres` 与
`data-agent-neo4j` 运行；Web、Worker、Indexer 应显示为宿主机进程，而不是容器。
`pnpm dev:infra` 只移除这三个无状态应用容器，不删除 PostgreSQL 或 Neo4j
的数据卷。

`/`、Worker `/live` 与 Indexer `/live` 返回的 `build_id`、`generation_id` 是可公开比较的 opaque ID。
它们一致地指向当前受控 generation，但不会暴露 Git SHA、绝对路径或 package digest。

页面出现 `PERSISTENCE_TRANSACTION_FAILED` 时，按以下顺序定位，不要先反复刷新或猜缓存：

1. 记录 Web/Worker/Indexer health 的 `build_id` 与 `generation_id`；
2. 查看协调器最后接受的 generation；
3. 在服务端日志查 `persistence_transaction_failed` 的 correlation、operation、SQLSTATE 与 process role；
4. 核对 `migration_ready` / `migration_frontier`；
5. 最后按 correlation 与时间范围查 PostgreSQL 日志。

安全诊断不会输出 SQL、参数、数据库 message、stack、DSN 或 Secret。

## 6. 端口与停止

| 服务 | 本地端口 |
| --- | --- |
| Web | 3000 |
| PostgreSQL | 5432 |
| Neo4j HTTP | 7474 |
| Neo4j Bolt | 7687 |
| Relationship Indexer `/live` | 9090 |
| Durable Worker `/live` | 9091 |

端口冲突时 `pnpm dev:check` 会失败并报告服务名与端口，不会自动终止未知进程。

- 停止本地应用：在 `pnpm dev`/`pnpm dev:apps` 终端按 `Ctrl-C`；
- 暂停数据库但保留容器和数据卷：`docker compose stop postgres neo4j`；
- 不要执行 `docker compose down -v`，除非明确决定永久删除本地数据库数据。

## 7. 完整 Docker 部署验证

完整容器模式不是热更新开发入口：

```bash
pnpm docker:migrate
pnpm docker:up
docker compose --profile deploy ps
```

停止完整栈但保留数据卷：

```bash
pnpm docker:down
```

`pnpm docker:up` 会从当前 checkout 注入 Git SHA 与 dirty boolean。直接运行 `docker compose --profile deploy
build` 时必须显式设置 `DATA_AGENT_GIT_COMMIT` 和 `DATA_AGENT_GIT_DIRTY=true|false`；缺失或非法值会在镜像
构建阶段失败关闭。镜像只携带每个进程的 portable identity，不携带本地 `.turbo` 或完整 attestation。

部署细节见 [deployment-operations.md](./deployment-operations.md)。
