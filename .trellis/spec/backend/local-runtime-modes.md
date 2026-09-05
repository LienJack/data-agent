# 本地开发与 Docker 运行模式

> 开发时容器化数据库与不可信代码执行边界；部署时再容器化全部长期应用服务。

## 场景：修改本地启动、Worker 入口或 Compose 拓扑

### 1. 范围 / 触发条件

- 修改根级 `dev*` / `docker*` 命令、`compose.yaml`、Worker daemon、Indexer 或迁移脚本时适用。
- PostgreSQL 仍是 Run 与语义权威；Neo4j 仅是可重建关系投影，不能成为 Web 启动依赖。

### 2. 签名

```text
pnpm dev:infra:local     # 本地 PostgreSQL + Neo4j
pnpm dev:infra:nas       # NAS PostgreSQL + Neo4j；停止本地 Data Agent 容器
pnpm dev:migrate:local   # 本地显式应用缺失迁移并核验 Ledger
pnpm dev:migrate:nas     # NAS 显式应用缺失迁移并核验 Ledger
pnpm dev:check:local     # 本地只读健康、Ledger、Authority 和端口门禁
pnpm dev:check:nas       # NAS 只读门禁与 SSH tunnel 探测
pnpm dev:build     # 构建并证明全部受管理 consumer，不绑定端口
pnpm dev           # 等价于 dev:local；本地数据库 + 四个本地 consumer
pnpm dev:nas       # NAS 数据库 + 受监督 SSH tunnel + 四个本地 consumer
pnpm prod:nas:migrate
pnpm prod:nas      # NAS 六服务 Data Agent 容器栈
pnpm docker:migrate
pnpm docker:up     # 当前主机 deploy profile
pnpm docker:down   # 移除容器，保留命名数据卷

DATA_AGENT_ALLOW_QA_READINESS_BOOTSTRAP=YES \
NODE_OPTIONS=--conditions=react-server \
pnpm --filter @data-agent/web exec tsx src/cli/bootstrap-qa-readiness.ts

GET worker:9091/live
GET relationship-indexer:9090/live
OpenSandbox health  # 独立管理；按 python-sandbox-execution.md 验证 endpoint 与 attestation
```

### 3. 契约

- Compose 默认服务集合精确为 `postgres, neo4j`，`deploy` profile 再加
  `clamav, web, worker, relationship-indexer`，`migrate` 是一次性服务。已退役的内置
  `python-sandbox` 服务和 Dockerfile 不得复活。
- OpenSandbox 是唯一 Python 执行层并独立于本 Compose 栈部署；启用分析能力时必须按
  `python-sandbox-execution.md` 配置 endpoint、API key、固定镜像与 attestation。它不是数据库权威，
  不得获得 PostgreSQL、Datasource、对象存储或 Provider 凭据。
- NAS Docker 使用 OpenSandbox 时另读 [控制面与端口预检](./opensandbox-nas-runtime.md)：
  端口探测和 Docker 必须同主机，真实双沙箱无模型验证不能由单独 health 代替。
- 本地 Web 使用 Next/Turbopack，Worker 和 Indexer 使用 `tsx watch`。Worker 的
  watch 与 Docker CMD 必须执行同一个 `run-worker-cli` 组合入口。
- 所有公开 dev 入口必须先经过根级 freshness coordinator。Coordinator 以 Turbo task hash 作为 input
  identity，以实际 output digest 验证磁盘产物；package/root input 变化时先停止 affected consumer，构建
  失败期间不得恢复旧 generation。raw `next dev` / `tsx watch` / `node dist` 不属于受支持入口。
- Workspace build attestation v2 必须分别保存 Turbo dry-run 的 `outputs` 与 `excludedOutputs`，并把两个规范集合都纳入
  task/build identity；output walker 使用同一 exclude 集合。Turbo 对空排除集合可能返回 `null` 或省略字段，统一规范为 `[]`。
  `.next/cache/**` 等显式排除项不得影响 output digest；非排除产物变化仍必须失败关闭。v1 只允许按历史 hash 公式读取/核验，
  新 writer 不得继续签发 v1。
- Web/Worker/Indexer/Semantic Authoring 在任何数据库或端口访问前必须加载与 role 匹配的绝对路径 runtime
  identity。公开 health 只暴露 opaque `build_id` / `generation_id`；Git、路径、task/output digest 只留在
  受控证据或启动日志。
- Docker/Release 必须复用同一 output verifier。镜像 builder 接受显式 Git SHA/dirty provenance，runner 只
  复制 portable identity；不得复制 `.git`、本地 `.turbo`、完整 attestation 或公开 package digest。
- persistence transaction 失败的公开 code/message 保持脱敏；进程级 diagnostics subscriber 必须幂等、
  reference-counted，并只记录 operation、correlation、SQLSTATE、process role 与 opaque build identity。
- local 宿主 DSN 使用 `127.0.0.1:5432`；NAS 宿主 DSN 使用 SSH tunnel
  `127.0.0.1:55432`，Neo4j 使用 `127.0.0.1:7687`；容器 DSN 使用 Compose 服务名
  `postgres` / `neo4j`，不得混用。模式 endpoint 必须在 dotenv 合并后固定。
- 本地环境优先级是 `process > .env.local > .env > safe defaults`；Secret 只能来自
  运行时环境，不得输出值。
- Web、Worker、Semantic Authoring、Certification 和根级 CLI 必须复用
  `@data-agent/platform/runtime-config` 的 server-only 边界加载根目录 dotenv 并归一化 Provider 变量；
  App 与业务模块只能读取规范变量。规范变量优先于旧别名，兼容诊断只能包含变量名和 reason code，
  不得包含 Secret 值。旧别名由 Retirement Surface Ledger 管理，连续两个 release 无使用证据后删除。
- `SEMANTIC_GOVERNANCE_BACKEND=postgres`、`SEMANTIC_EXPLORER_ENABLED=true`与
  `SEMANTIC_RELATIONSHIP_INDEX_ENABLED=true` 在两种模式保持一致。Neo4j 不可用时
  Explorer 走 PostgreSQL fallback，Web 与 Governance 继续可用。
- `pnpm dev` / `pnpm dev:nas` 只读 Migration Ledger，不得隐式执行 SQL。迁移只由匹配当前模式的显式
  migrate 命令执行，并要求 `ON_ERROR_STOP=1` 与名称/checksum 精确复核。
- NAS 数据库只绑定远端 loopback。SSH tunnel 必须使用 `ExitOnForwardFailure`，在应用启动前执行远端
  PostgreSQL 协议探测；只存在本地 SSH listener 不能视为 ready。tunnel 退出必须停止全部受管理 consumer。
- 单文件 workspace watcher 必须比较内容 digest；macOS 文件属性/访问事件在内容未变时不得触发 consumer 重建。
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
| Ledger 缺失或 checksum 不同 | `DEV_MIGRATIONS_NOT_READY:*`，提示匹配模式的 migrate 命令 |
| NAS SSH/Compose/转发失败 | `NAS_*` 稳定 reason，应用端口保持未启动 |
| 固定 Server Context 无 Authority | `DEV_AUTHORITY_MAPPING_NOT_READY` |
| 3000/9090/9091 已占用 | `DEV_PORT_IN_USE:<service>:<port>` |
| 既有 Next dev lock 仍对应存活进程 | `DEV_NEXT_PROCESS_ALREADY_RUNNING:<pid>:<port>` |
| Turbo graph 缺 consumer/package | `DEV_WORKSPACE_BUILD_GRAPH_INVALID`，零应用端口 |
| source/root input 与证明不同 | `DEV_WORKSPACE_BUILD_STALE`，停止 affected consumer |
| output 缺失或被替换 | `DEV_WORKSPACE_BUILD_OUTPUT_MISSING/MISMATCH`，失败关闭 |
| output/excluded glob 缺失、重复、绝对路径、越界或 include/exclude 冲突 | `DEV_WORKSPACE_BUILD_GRAPH_INVALID`，不生成证明 |
| build 中输入继续变化 | 丢弃旧 generation，合并后重建 |
| build 失败 | `DEV_WORKSPACE_BUILD_FAILED`，保持 blocked；后续变化/显式 retry 可恢复 |
| runtime identity 缺失/非法/role 不符 | `RUNTIME_BUILD_IDENTITY_*`，数据库与 health 端口均未创建 |
| Docker Git provenance 缺失/非法 | `RELEASE_BUILD_GIT_*_INVALID`，镜像构建失败 |
| persistence transaction 失败 | 公开脱敏；服务端 safe event 可按 correlation/build 定位 |
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

- Compose Contract：断言 default 精确为 PostgreSQL/Neo4j，`deploy` 精确为六个长期服务，
  并断言已退役的内置 `python-sandbox` 服务和 Dockerfile 没有复活。
- Runtime mode：断言 `dev == dev:local`、显式 `dev:nas`、dotenv 后 endpoint 固定、NAS loopback port merge、
  SSH quoting/tunnel 生命周期和内容摘要 watcher。
- Worker Unit/Integration：严格 env、IDLE 退避、日志脱敏、Lease/Heartbeat/Fence/终态。
- Runtime Config：覆盖 repo root / Web / Worker cwd、dotenv 幂等、规范变量优先、旧别名提升、
  缺失配置失败关闭和诊断不含 Secret。
- Migration：已应用版本跳过，缺失版本应用，checksum 漂移非零退出。
- Workspace freshness：graph/attestation contract、source 已变但旧 dist、output tamper、build 中漂移、burst
  coalescing、失败恢复、signal cleanup、四 role guard 与 opaque health identity；另覆盖 `excludedOutputs=null/omitted`、
  cache mutation 不漂移、非 cache mutation 拒绝、v1 read-only/v2 writer。
- Docker/Release：Web/Worker/Indexer identity 存在；非法 provenance、stale/tampered output 非零；runner 不含
  `.git`、`.turbo`、完整 attestation、绝对路径或 package digest。
- Diagnostics：重复 bootstrap 只有一个 subscriber；logger throw 不改变公开事务结果；SQL/message/params/
  stack/DSN/Secret 不进入日志。
- Q&A readiness：未确认/production 零调用、步骤顺序、早期失败不激活 Profile、真实本地执行与幂等重跑；
  浏览器 POST 必须从 readiness 400 变为 201。
- 在执行过 Next/Docker 生产构建的工作区运行根级 Vitest 时，命令必须显式使用
  `--exclude '**/.next/**'`，避免把 `.next/standalone` 中复制的测试文件当作源码重复执行。
- 物理 Smoke：local/NAS 开发的四个本地 consumer health；完整 deploy 六容器分别 healthy；停 Neo4j 时
  Web/Explorer/Governance 仍可用且关系搜索返回稳定 fallback
  reason。外部 OpenSandbox 不健康时 SQL-only 路径可用，但 Python case 与 Production Readiness
  必须失败关闭。

### 7. Wrong vs Correct

#### Wrong

```bash
docker compose up -d  # 误以为这是完整部署，或一边运行容器应用一边做热更新
next dev              # 绕过根级 freshness coordinator
node packages/platform/dist/index.js  # 直接相信可能过期的 output
pnpm exec vitest run apps/web/test/integration/example.spec.ts  # 构建后可能重复扫描 .next
```

#### Correct

```bash
pnpm dev              # 开发：Docker 数据库 + 本地 watch
pnpm dev:nas          # 低内存开发：NAS 数据库 + SSH tunnel + 本地 watch
pnpm dev:build && pnpm dev:check:local  # 只刷新并核对受管理 build 证明
pnpm prod:nas:migrate && pnpm prod:nas  # NAS 完整容器部署
pnpm exec vitest run --exclude '**/.next/**' apps/web/test/integration/example.spec.ts
DATA_AGENT_ALLOW_QA_READINESS_BOOTSTRAP=YES NODE_OPTIONS=--conditions=react-server \
pnpm --filter @data-agent/web exec tsx src/cli/bootstrap-qa-readiness.ts
```

### 8. 浏览器与测试容器资源生命周期

- 每批浏览器、数据库或 Sandbox 测试开始前，先记录本任务已有的浏览器主进程/会话、Docker 容器名称与状态、端口及内存占用。
  Chrome Helper/Renderer 是同一浏览器的子进程，不能按子进程数误判为多个浏览器；命令行与日志不得暴露凭据。
- 浏览器测试默认只保留一个本任务会话及一个活动测试页面，跨题复用页面或标签；需要第二页面验证交互时，用完立即关闭。
  不得为每题、重试或恢复重复启动 Chrome，也不得同时运行多套浏览器自动化引擎。使用现有用户浏览器时只关闭本任务创建的页面。
  若必须重新启动，先按 session/profile/PID 确认并关闭失效的测试实例，再验证其子进程已退出；不得执行全局 `pkill Chrome`。
- 数据库与端到端测试串行执行，默认只运行一个当前批次的 scratch 数据库。确需源库物理复制时，可临时恢复一个精确绑定的源库；
  一次性 restore/verify 容器使用 `--rm` 并串行退出。历史失败批次保留证据及数据卷，停止或移除其容器后再启动后继批次。
  普通开发库、live authority、其他任务服务不计入可清理的临时资源，不得以资源回收为由切换数据库 binding 或修改权威数据。
- OpenSandbox 仅在分析预检或分析题需要时启动一个控制面和一个活动 Sandbox。若既有验收明确要求双沙箱隔离，可在该项期间保留两个，
  并在完成后立刻回收。不得因租约过期或失败而累积旧 Sandbox；回收前核对 task/attempt 标签、挂载、连接与保留证据。
- 构建、全量单测、数据库测试和浏览器 E2E 不并行争用内存；资源紧张时先降低本任务并发，并关闭已完成的临时服务。
  NAS 模式维持 OrbStack 关闭，不能为某条测试脚本重新启动本地 VM。
- 完成、失败、暂停或执行中断后，都必须复查本任务浏览器主进程、子进程、容器状态/数量、监听端口和内存；
  终端命令退出或收到 Ctrl-C 不能代替资源已退出的证据。确需保留的运行资源要记录名称、用途和恢复 checkpoint。
  删除只能针对已核实的本任务临时容器或实例；保留数据卷、镜像和审计记录，禁止全局 Docker prune。
