# 三模式启动与 NAS 可选开发 — 技术设计

## 1. 变更边界

最小行为差距是：当前只有“本地数据库 + 本地应用”和“当前主机完整容器”两种运行方式，
`pnpm dev` 不能把数据库切到 NAS，也不能安全管理 SSH tunnel/远端 Compose。

行为实际位于根级运行协调器、Compose 拓扑与命令面，而不是 Web/Worker 业务代码。本任务预计修改：

- `scripts/local-dev-runtime.ts`：模式选择、模式固定连接环境、就绪/迁移错误指引和 tunnel 生命周期；
- `scripts/nas-runtime.ts`：远端 SSH/rsync/Compose 命令与可测试参数构造；
- `compose.nas.yaml`：NAS loopback 数据库端口与 Web 3001 override；
- `package.json`：三个主入口和 local/NAS 显式迁移入口；
- `tests/local-dev-runtime.spec.ts`、`tests/nas-runtime.spec.ts`：模式、命令、环境、Secret/quoting 和 Compose contract；
- `docs/runbooks/local-development.md`、`docs/runbooks/deployment-operations.md` 与
  `.trellis/spec/backend/local-runtime-modes.md`：长期契约与运维说明。

明确不修改业务 API、数据库 migration、Worker/Indexer 领域逻辑或现有用户并行 Web 产物。

## 2. 运行拓扑

### 2.1 `local`

```text
Local Web/Worker/Indexer/Semantic Authoring
  -> 127.0.0.1:5432 -> local Docker PostgreSQL
  -> 127.0.0.1:7687 -> local Docker Neo4j
Local Worker -> OpenSandbox disabled unless explicitly configured
```

入口：`pnpm dev:local`。协调器只启动 `postgres neo4j`；应用 profile 容器不运行，OpenSandbox 独立管理。

### 2.2 `nas`（显式选择）

```text
Local Web/Worker/Indexer/Semantic Authoring
  -> 127.0.0.1:55432 ==SSH==> NAS 127.0.0.1:55432 -> NAS PostgreSQL
  -> 127.0.0.1:7687  ==SSH==> NAS 127.0.0.1:7687  -> NAS Neo4j
Local Worker -> OpenSandbox disabled unless explicitly configured
```

入口：`pnpm dev:nas`。远端先切为 infra-only，本地停止全部 Data Agent 容器，再创建受监督 SSH tunnel、
执行只读门禁并启动本地 consumer。

### 2.3 `production-nas`

```text
Browser -> 192.168.5.41:3001 -> NAS Docker Web
NAS Docker Web/Worker/Indexer -> Compose postgres/neo4j
NAS Docker Worker -> separately managed, attested OpenSandbox when explicitly enabled
NAS Docker Worker -> Compose ClamAV
```

入口：`pnpm prod:nas`。构建/启动与迁移分离；缺 migration 时失败并提示
`pnpm prod:nas:migrate`。

## 3. 命令契约

| 命令 | 目标 | 是否写数据库 |
| --- | --- | --- |
| `pnpm dev` | 默认全本地开发，等价于 `pnpm dev:local` | 否；业务运行期除外 |
| `pnpm dev:nas` | 显式 NAS 混合开发 | 否；业务运行期除外 |
| `pnpm dev:local` | 显式全本地开发 | 否；业务运行期除外 |
| `pnpm dev:migrate:nas` | NAS 显式 migration + Ledger 复核 | 是 |
| `pnpm dev:migrate:local` | 本地显式 migration + Ledger 复核 | 是 |
| `pnpm prod:nas:migrate` | NAS 生产 migration + Ledger 复核 | 是 |
| `pnpm prod:nas` | NAS 完整容器启动；不隐式 migration | 运行期写入 |
| `pnpm docker:*` | 保留当前主机 Compose 低层兼容入口 | 与现有契约一致 |

## 4. 配置与优先级

Secret/身份仍按 `process > .env.local > .env > safe defaults` 合并，但数据库与 Neo4j endpoint
由所选模式在 dotenv 合并后固定，避免旧 `.env.local` 把 NAS 模式偷换回 localhost。只允许以下专用
非秘密变量改变 NAS 连接：

- `DATA_AGENT_NAS_SSH_HOST`，默认 `data-agent-nas`；
- `DATA_AGENT_NAS_PROJECT_DIR`，默认 `/vol1/1000/work/data-agent/current`；
- `DATA_AGENT_NAS_POSTGRES_FORWARD_PORT`，默认 `55432`；
- `DATA_AGENT_NAS_NEO4J_HTTP_FORWARD_PORT`，默认 `7474`；
- `DATA_AGENT_NAS_NEO4J_BOLT_FORWARD_PORT`，默认 `7687`；
- `DATA_AGENT_NAS_WEB_URL`，默认 `http://192.168.5.41:3001`。

不会记录或打印 `.env` 值、数据库密码、Keychain 返回值或 SSH 私钥路径内容。

## 5. SSH tunnel 与远端控制

`scripts/nas-runtime.ts` 提供纯参数构造函数和薄执行适配器：

1. 校验 SSH alias、绝对远端目录和数值端口，拒绝控制字符/相对路径；
2. 用参数数组执行 `ssh`，远端 shell 片段只由经过 POSIX quote 的常量/校验值组成；
3. 远端 Compose 固定使用 `compose.yaml + compose.nas.yaml`；
4. `infra` 会停止/移除远端无状态应用容器，再启动 `postgres neo4j`；
5. `production` 会先验证 Ledger，再带 provenance 构建并等待完整 `deploy` profile；
6. tunnel 使用 `ssh -N -o ExitOnForwardFailure=yes -L ...`，在应用启动前等待三个本地转发端口并完成
   PostgreSQL 协议探测，避免把仅存在本地 listener 的失败转发误判为 ready；
7. tunnel 非预期退出会触发本地应用协调器整体关闭；SIGINT/SIGTERM 同时关闭应用与 tunnel。

为了无交互自动运行，NAS 的 `admin` 需要 Docker socket 权限。实施时将明确记录：Docker group 等价于
root 级主机控制，只对现有管理员账户配置，并验证 SSH key 登录；不把密码写入脚本。

## 6. Compose NAS override

`compose.nas.yaml` 只定义主机差异：

- PostgreSQL `ports: !override ["127.0.0.1:55432:5432"]`；
- Neo4j `ports: !override` 为远端 loopback 7474/7687；
- Web `ports: !override ["192.168.5.41:3001:3000"]`；
- 不增加或复活退役的内置 `python-sandbox` 服务；
- 不修改容器间 `postgres:5432`、`neo4j:7687` 或 Secret 来源。

远端源码镜像目录是受控部署副本，用户数据只在 Docker named volumes 与 `backups/`；同步不得触碰
这些目录。生产构建必须注入当前 Git SHA 和 dirty boolean。

## 7. 数据迁移与恢复

1. 本地 PostgreSQL 在隔离、无端口的临时 PG17 容器中导出 roles + custom dump；
2. workspace named volume 导出 tar.gz；
3. 文件在本地和 NAS 双份保存并比对 SHA-256；
4. NAS 创建空 PG17 卷，先恢复 globals，再恢复 `data_agent`；
5. 对比 Ledger count/max/digest、user table count 和 workspace file count；
6. NAS Neo4j 使用空卷，由 Indexer 重建并检查 checkpoint；
7. 远端完整 smoke 通过后，本地对应容器保持停止，但命名卷与备份不删除。

## 8. 失败、切换与回滚

- SSH/远端 Docker/端口转发失败：本地应用不启动，输出 `NAS_*` 稳定 reason code。
- Ledger 缺失/checksum 不同：当前模式失败关闭，提示匹配的显式 migration 命令。
- NAS 不可用：用户运行 `pnpm dev:local`，本地卷原样恢复开发，不自动把远端新写入回灌本地。
- 生产启动失败：保留 PostgreSQL 卷与备份；停止失败应用容器，不执行 `down -v`。
- 模式切换不自动杀死未知宿主进程；端口被占用时返回现有 `DEV_PORT_IN_USE`/NAS reason code。

## 9. 风险与取舍

- 显式 NAS 模式依赖局域网和 SSH；断网时退出后直接运行默认 `pnpm dev` 或 `pnpm dev:local`。
- NAS 混合模式不运行本地 Data Agent 容器，可关闭本机 Docker VM；需要 Python 分析时使用独立、
  已核验的 OpenSandbox 服务，不能回退宿主执行器或旧 UDS Sandbox。
- local 与 NAS PostgreSQL 在切换后会产生不同写入历史；本任务不做双向同步，模式标签和 Runbook 必须
  明确 Authority 位置。
- Docker group 是 root 等价权限；自动化便利性以现有管理员账户为边界，不扩散到普通账户。
