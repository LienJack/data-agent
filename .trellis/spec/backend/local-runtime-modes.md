# 本地开发与 Docker 运行模式

> 开发时容器化数据库与不可信代码执行边界；部署时再容器化全部长期应用服务。

## 场景：修改本地启动、Worker 入口或 Compose 拓扑

### 1. 范围 / 触发条件

- 修改根级 `dev*` / `docker*` 命令、`compose.yaml`、Worker daemon、Indexer 或迁移脚本时适用。
- PostgreSQL 仍是 Run 与语义权威；Neo4j 仅是可重建关系投影，不能成为 Web 启动依赖。

### 2. 签名

```text
pnpm dev:infra     # 当前 PostgreSQL + Neo4j；Sandbox 落地后再加入 python-sandbox
pnpm dev:migrate   # 显式应用缺失迁移并核验 Ledger
pnpm dev:check     # 只读健康、Ledger、Authority 和端口门禁
pnpm dev           # dev:infra -> dev:check -> 三个本地 watch 进程
pnpm docker:migrate
pnpm docker:up     # deploy profile 的五个长期服务
pnpm docker:down   # 移除容器，保留命名数据卷

DATA_AGENT_ALLOW_QA_READINESS_BOOTSTRAP=YES \
NODE_OPTIONS=--conditions=react-server \
pnpm --filter @data-agent/web exec tsx src/cli/bootstrap-qa-readiness.ts

GET worker:9091/live
GET relationship-indexer:9090/live
python-sandbox health  # 通过受控 IPC/容器 healthcheck，不开放公共 TCP 端口
```

### 3. 契约

- 在 Python Sandbox 实现前，Compose 默认服务集合仍精确为 `postgres, neo4j`，`deploy`
  profile 再加 `web, worker, relationship-indexer`。完成该能力时，默认集合改为
  `postgres, neo4j, python-sandbox`，`deploy` 再加三个应用服务，`migrate` 仍是一次性服务；
  对应 Contract 测试必须与功能提交原子更新，不能提前宣称第六个服务健康。
- `python-sandbox` 无数据库连接、无公共 TCP、无外网和宿主项目/数据/Secret 挂载；仅允许
  专用 IPC socket 目录。宿主 Worker 与容器 Worker 必须使用同一版本协议，executor OS
  身份不能读取 supervisor socket。
- 本地 Web 使用 Next/Turbopack，Worker 和 Indexer 使用 `tsx watch`。Worker 的
  watch 与 Docker CMD 必须执行同一个 `run-worker-cli` 组合入口。
- 宿主机 DSN 使用 `127.0.0.1`；容器 DSN 使用 Compose 服务名
  `postgres` / `neo4j`，不得混用。
- 本地环境优先级是 `process > .env.local > .env > safe defaults`；Secret 只能来自
  运行时环境，不得输出值。
- `SEMANTIC_GOVERNANCE_BACKEND=postgres`、`SEMANTIC_EXPLORER_ENABLED=true`与
  `SEMANTIC_RELATIONSHIP_INDEX_ENABLED=true` 在两种模式保持一致。Neo4j 不可用时
  Explorer 走 PostgreSQL fallback，Web 与 Governance 继续可用。
- `pnpm dev` 只读 Migration Ledger，不得隐式执行 SQL。迁移只由显式
  migrate 命令执行，并要求 `ON_ERROR_STOP=1` 与名称/checksum 精确复核。
- Q&A readiness bootstrap 只允许显式 CLI：确认变量必须精确为
  `DATA_AGENT_ALLOW_QA_READINESS_BOOTSTRAP=YES`，`NODE_ENV=production` 必须返回
  `QA_READINESS_PRODUCTION_FORBIDDEN`。页面加载、`pnpm dev` 和 Run POST 均不得隐式调用。
- Readiness 顺序固定为 role Model revisions -> Schema Snapshot -> Workspace Defaults -> 九 Skill/三 Profile；
  Profile 必须最后激活。所有写入走现有 Port/RPC，operation/idempotency identity 必须稳定；重复执行返回
  `QA_READINESS_ALREADY_READY`，不得增加 Head 或 Defaults revision。
- Worker `/live` 只表示进程、数据库 Authority 与 Runner 已初始化。未配置
  `WORKER_RESEARCH_AUTHORITY_CAPABILITY_ID` 时可轮询 Queue，但 Artifact 提交必须以
  `RESEARCH_ARTIFACT_AUTHORITY_NOT_CONFIGURED` 失败关闭。

### 4. 校验与错误矩阵

| 条件 | 稳定结果 |
| --- | --- |
| PostgreSQL/Neo4j 容器不健康 | `DEV_DATABASE_NOT_HEALTHY:<service>` |
| Ledger 缺失或 checksum 不同 | `DEV_MIGRATIONS_NOT_READY:*`，提示 `pnpm dev:migrate` |
| 固定 Server Context 无 Authority | `DEV_AUTHORITY_MAPPING_NOT_READY` |
| 3000/9090/9091 已占用 | `DEV_PORT_IN_USE:<service>:<port>` |
| 既有 Next dev lock 仍对应存活进程 | `DEV_NEXT_PROCESS_ALREADY_RUNNING:<pid>:<port>` |
| Docker/Next 构建后根级 Vitest 扫描 `.next/standalone` | 排除 `**/.next/**`，只执行源码测试 |
| Worker 配置越界 | `WORKER_CONFIG_INVALID` 并非零退出 |
| U6 Authority Capability 未配置 | Run 进入明确 `FAILED`，Reason Code 不泄漏 Secret |
| Readiness 未显式确认 | `QA_READINESS_EXPLICIT_CONFIRMATION_REQUIRED`，零数据库访问 |
| Readiness 在 production 执行 | `QA_READINESS_PRODUCTION_FORBIDDEN`，零数据库访问 |
| Datasource/Semantic/认证模型不齐 | 稳定 `QA_READINESS_*_REQUIRED` 或底层公开 reason code；不得激活 Profile |

### 5. Good / Base / Bad

- Good：`pnpm dev` 先移除三个无状态应用容器，核验数据库后启动本地 watch。
- Good：首次本地 demo 使用显式 readiness CLI，完成后再次执行得到 `QA_READINESS_ALREADY_READY`。
- Base：只调试 Worker 时执行 `pnpm dev:infra && pnpm dev:worker`。
- Bad：同时运行 Docker Web/Worker/Indexer 与本地应用，或让日常启动自动重放迁移。
- Bad：在 Q&A POST 里按需写 Defaults/Profile，或直接 INSERT Registry 表来消除 400。

### 6. 必需测试

- Compose Contract：断言 default 只有两个数据库，`deploy` 精确为五个长期服务。
- Python Sandbox 落地时同步把 Compose Contract 更新为 default 三个基础设施服务、deploy
  六个长期服务，并断言 sandbox 无网络/数据库 Secret/公共端口、只读 root 与硬资源限制。
- Worker Unit/Integration：严格 env、IDLE 退避、日志脱敏、Lease/Heartbeat/Fence/终态。
- Migration：已应用版本跳过，缺失版本应用，checksum 漂移非零退出。
- Q&A readiness：未确认/production 零调用、步骤顺序、早期失败不激活 Profile、真实本地执行与幂等重跑；
  浏览器 POST 必须从 readiness 400 变为 201。
- 在执行过 Next/Docker 生产构建的工作区运行根级 Vitest 时，命令必须显式使用
  `--exclude '**/.next/**'`，避免把 `.next/standalone` 中复制的测试文件当作源码重复执行。
- 物理 Smoke：三个本地应用热更新；当前五容器 healthy；Python Sandbox 落地后六容器
  分别 healthy；停 Neo4j 时 Web/Explorer/Governance 仍可用且关系搜索返回稳定 fallback
  reason。Sandbox 不健康时 SQL-only 路径可用，但 Python case 与 Production Readiness
  必须失败关闭。

### 7. Wrong vs Correct

#### Wrong

```bash
docker compose up -d  # 误以为这是完整部署，或一边运行容器应用一边做热更新
pnpm exec vitest run apps/web/test/integration/example.spec.ts  # 构建后可能重复扫描 .next
```

#### Correct

```bash
pnpm dev              # 开发：Docker 数据库 + 本地 watch
pnpm docker:migrate && pnpm docker:up  # 部署：显式迁移 + 五服务容器
pnpm exec vitest run --exclude '**/.next/**' apps/web/test/integration/example.spec.ts
DATA_AGENT_ALLOW_QA_READINESS_BOOTSTRAP=YES NODE_OPTIONS=--conditions=react-server \
  pnpm --filter @data-agent/web exec tsx src/cli/bootstrap-qa-readiness.ts
```
