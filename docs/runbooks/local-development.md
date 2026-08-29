# Data Agent 本地开发 Runbook

## 1. 运行边界

开发提供两个显式拓扑，生产另有完整 NAS 容器模式：

- `pnpm dev` / `pnpm dev:local`：本地 Docker PostgreSQL 17、Neo4j；宿主机运行 Next.js Web、
  Durable Worker、Relationship Indexer 与 Semantic Authoring；
- `pnpm dev:nas`：NAS Docker 只运行 PostgreSQL/Neo4j，本地经受监督 SSH tunnel 访问；宿主机运行相同应用，
  本地 Data Agent 容器全部停止；
- `pnpm prod:nas`：NAS 六服务 Data Agent 容器栈，Web 使用 `http://192.168.5.41:3001`；
- PostgreSQL 是 Run 与语义权威，Neo4j 是可删除、可重建的关系投影；
- 日常启动只检查 Migration Ledger，不自动执行迁移。

宿主开发模式默认不启用分析 Sandbox。OpenSandbox 是唯一 Python 执行层，由独立服务管理，
不属于本地或 NAS Data Agent Compose 栈；需要分析能力时按 `python-sandbox-execution.md` 显式配置并核验。

不要同时运行 Docker Web/Worker/Indexer 与本地应用进程，否则旧镜像可能占用端口并遮蔽
刚修改的源码。

## 2. 第一次启动

```bash
pnpm install

# 启动并等待本地 PostgreSQL、Neo4j 健康，同时停止并移除旧的 Docker 应用容器
pnpm dev:infra:local

# 显式应用尚未登记的迁移，并再次核验 Migration Ledger
pnpm dev:migrate:local

# 检查数据库、Ledger、Authority 映射与应用端口
pnpm dev:check:local

# 启动 Web、Worker、Indexer 三个本地 watch 进程
pnpm dev:apps
```

第一次完成后，日常开发使用：

```bash
pnpm dev
```

`pnpm dev` 等价于 `pnpm dev:local`。`dev:infra`、`dev:migrate`、`dev:check` 仍是对应 local 命令的兼容别名。
Ledger 缺失或 checksum 不一致时，启动会以非零状态停止并提示执行 `pnpm dev:migrate:local`，不会隐式重放 SQL。

## 3. NAS 混合开发

首次由管理员完成一次 SSH 配置：`data-agent-nas` 使用 SSH key 登录，远端 `admin` 属于 Docker group，
sshd 设置 `AllowTcpForwarding local`。随后日常只需：

```bash
# 仅在 Ledger 有缺失 migration 时显式执行
pnpm dev:migrate:nas

# NAS 数据库 + 本地 Web/Worker/Indexer/Semantic Authoring
pnpm dev:nas
```

启动器会同步受控源码副本到 `/vol1/1000/work/data-agent/current`，但排除并保护远端 `.env`、`backups/`、
`.git`、构建缓存和 Docker named volumes。它先把 NAS 切成 infra-only，再停止本地 Data Agent 容器，建立：

```text
127.0.0.1:55432 -> NAS PostgreSQL 127.0.0.1:55432
127.0.0.1:7474  -> NAS Neo4j HTTP 127.0.0.1:7474
127.0.0.1:7687  -> NAS Neo4j Bolt 127.0.0.1:7687
```

隧道在应用启动前执行真实 PostgreSQL 协议探测。隧道退出会让受管理应用整体退出；NAS 不可用时停止该命令，
再运行默认 `pnpm dev` 回到本地卷。两个 PostgreSQL 会在切换后形成不同写入历史，不做自动双向合并。

应用端口绑定前，根协调器会按 Turbo dependency graph 构建 Workspace package、核对导出文件与 output
digest，并为 Web、Worker、Indexer、Semantic Authoring 分别写入 opaque build identity。只准备构建证明、不启动
应用时执行：

```bash
pnpm dev:build
pnpm dev:check
```

`dev:check` 只验证已有证明，不会代替 build，也不会执行 migration。

## 4. 单服务调试

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

## 5. 环境变量

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

NAS 非秘密覆盖变量为 `DATA_AGENT_NAS_SSH_HOST`、`DATA_AGENT_NAS_PROJECT_DIR`、
`DATA_AGENT_NAS_POSTGRES_FORWARD_PORT`、`DATA_AGENT_NAS_NEO4J_HTTP_FORWARD_PORT`、
`DATA_AGENT_NAS_NEO4J_BOLT_FORWARD_PORT` 与 `DATA_AGENT_NAS_WEB_URL`。数据库与 Neo4j endpoint 会在 dotenv
合并后由模式固定，旧 `.env.local` 不能把 `dev:nas` 偷换回本地数据库。

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

Falcon24 真实 Agent 验收还需要显式提供冻结 Manifest，缺失时 Worker 失败关闭。Manifest
使用 `falcon24-analysis-run-manifest@2.0.0`，绑定 Campaign 指纹以及每个真实 `run_id`、
Case、`COLD|WARM` 与 repetition；记录器只提交 Provider/语义上下文/AnalysisProgram/
加密 Python Source/Sandbox Receipt/独立 Oracle 的安全引用和 Hash，不写源码、输入行或
Provider 原文：

```bash
export FALCON24_ANALYSIS_RUN_MANIFEST=artifacts/falcon24-agent-analysis/run-manifest.json
export DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY=falcon24-strict-zero-retry@1.0.0
export DATA_AGENT_ANALYSIS_INPUT_KEY_BASE64='<32-byte-base64>'
export DATA_AGENT_ANALYSIS_PYTHON_SOURCE_KEY_BASE64='<32-byte-base64>'
```

Compose Worker 将该 Manifest 目录绑定到 `/app/artifacts/falcon24-agent-analysis`；每条
结果先进入 PostgreSQL Campaign durable stage，轨迹闭环与按 Run 回收 OpenSandbox 均
通过后才推进该 Run，不存在 pending/actual JSON 兼容路径。冷启动轮次须在每个 Run 前
重启 Worker，暖启动轮次在同一 Worker 进程连续执行。只有 5 题各 3 冷 + 3 暖共 30 条
真实结果才能进入最终 Gate。

验收必须使用 PostgreSQL Campaign Authority 串行推进，禁止用循环脚本在失败后继续：

```bash
# 仅在实际代码/冻结契约已提交且工作树 clean 后创建新 campaign
pnpm --dir apps/web falcon24:analysis:control manifest \
  --campaign-id "$FALCON24_ACCEPTANCE_CAMPAIGN_ID" --campaign-version 13

# 每个 ordinal 先 claim/submit；Run 完成后先检查完整轨迹
pnpm --dir apps/web falcon24:analysis:control submit \
  --campaign-id "$FALCON24_ACCEPTANCE_CAMPAIGN_ID" \
  --case-id falcon24-business-review-18m --variant COLD --repetition 1 --ordinal 0
pnpm --dir apps/web falcon24:analysis:control trace \
  --campaign-id "$FALCON24_ACCEPTANCE_CAMPAIGN_ID" \
  --case-id falcon24-business-review-18m --variant COLD --repetition 1 --ordinal 0

# 按 exact campaign/run 通过 OpenSandbox management API 回收；服务端把 attestation-bound
# receipt 直接写入 PostgreSQL Authority，不生成供 Finalize 信任的本地 JSON
pnpm --dir apps/worker falcon24:sandbox:reclaim -- --campaign-id "$FALCON24_ACCEPTANCE_CAMPAIGN_ID" --run-id "$RUN_ID"

# finalize 只从 PostgreSQL 读取 management-plane receipt，并要求底层 Run 已 SUCCEEDED；
# 任意本地 receipt 路径参数都不再存在
pnpm --dir apps/web falcon24:analysis:control finalize \
  --campaign-id "$FALCON24_ACCEPTANCE_CAMPAIGN_ID" \
  --case-id falcon24-business-review-18m --variant COLD --repetition 1 --ordinal 0
```

任一命令返回 HOLD 后立即停止，不自动重试、不继续后续 ordinal、不创建下一版本。按
`Root 路由 -> SQL/数据准备 -> 治理算子 -> Oracle -> Publisher -> Sandbox 回收` 固定顺序
定位。这里的 Publisher 唯一指 Oracle 通过后提交权威分析证据、图表和报告；Sandbox receipt
写入与 Campaign current 指针推进都属于最后的 Sandbox 回收关闭阶段，不得再次归类成
Publisher。`RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING`、
`RESOLUTION_TRACE_ARTIFACT_CORRUPT`、轨迹 detail 不可读、图表或报告没有精确引用同一
`QueryEvidence`，都归为 Publisher/轨迹硬失败。只有新的代码或冻结契约 commit 才能创建
新版本重新验收。

命令从当前 `WORKER_DEPLOYMENT_ID / WORKER_TENANT_ID / WORKER_PRINCIPAL_ID` 解析有效
Membership，数据库锁内签发 12 个 Artifact Domain 与一个 `REPORT_READ` Capability；
默认有效 24 小时。调用者不能指定 Capability ID，重复的 exact Manifest 不会产生第二套。

## 6. 健康检查

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

NAS 模式使用 `pnpm dev:check:nas` 做数据库、Ledger、Authority、隧道和 build readiness 门禁；NAS 上
`docker compose -f compose.yaml -f compose.nas.yaml ps` 应只有 PostgreSQL/Neo4j 运行，本地不应有 Data Agent 容器。

## 7. 端口与停止

| 服务 | 本地端口 |
| --- | --- |
| Web | 3000 |
| PostgreSQL | 5432 |
| NAS PostgreSQL tunnel | 55432 |
| Neo4j HTTP | 7474 |
| Neo4j Bolt | 7687 |
| Relationship Indexer `/live` | 9090 |
| Durable Worker `/live` | 9091 |

端口冲突时 `pnpm dev:check` 会失败并报告服务名与端口，不会自动终止未知进程。

- 停止本地应用：在 `pnpm dev`/`pnpm dev:apps` 终端按 `Ctrl-C`；
- 暂停数据库但保留容器和数据卷：`docker compose stop postgres neo4j`；
- 不要执行 `docker compose down -v`，除非明确决定永久删除本地数据库数据。

## 8. 完整 Docker 部署验证

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

NAS 完整容器模式使用独立入口：

```bash
pnpm prod:nas:migrate
pnpm prod:nas
pnpm prod:nas:down
```
