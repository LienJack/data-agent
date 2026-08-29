# 三模式启动与 NAS 可选开发 — 实施计划

## 0. 基线与保护

- [x] 记录 `git status --short`，只拥有本任务列出的脚本、Compose、测试、文档、Spec 和 task 文件。
- [x] 保留现有 `apps/web/next-env.d.ts`、`apps/web/tsconfig.tsbuildinfo` 与并行工作，不纳入提交。
- [x] 核对已生成 PostgreSQL/workspace 备份 SHA-256；迁移完成前不删除本地 named volumes。

## 1. 先建立三模式契约测试

- [x] 为 `local`/`nas` 模式环境 endpoint、dotenv 覆盖防护、模式命令与 migration 指引写失败测试。
- [x] 为 SSH/远端目录/端口校验、POSIX quoting、Compose 参数、tunnel 参数和 Secret 不出现在命令中写测试。
- [x] 为 `compose.nas.yaml` 的 loopback DB ports、Web 3001 与退役 Sandbox 不复活写 contract 测试。
- [x] 保留现有 workspace freshness、provenance 和默认 Compose service contract。

## 2. 实现 NAS 运行适配器

- [x] 新增 `scripts/nas-runtime.ts`，隔离 SSH/rsync/远端 Compose 与 tunnel 生命周期。
- [x] 实现远端 infra-only、Ledger read/authority check、显式 migration、完整 production up/down。
- [x] 实现受控源码同步：仅同步项目部署副本，保护远端 `.env`、备份和 Docker named volumes。
- [x] 让 tunnel 异常和退出信号进入统一清理路径，不留下本地监听或孤儿 ssh 进程。

## 3. 扩展本地运行协调器与命令面

- [x] 把运行环境解析为显式 `local`/`nas`，模式 endpoint 在 dotenv 后固定，process Secret/身份仍保留。
- [x] `dev:local` 启动本地 `postgres neo4j`，保持旧全本地开发能力与 OpenSandbox 默认关闭行为。
- [x] 默认 `dev` 与 `dev:local` 启动全本地拓扑；只有显式 `dev:nas` 切远端 infra-only、停止
  本地 Data Agent 容器、启动 tunnel，再执行门禁与应用监督。
- [x] Local/NAS check 与 migration 分开路由，错误提示与当前模式匹配。
- [x] 增加 `prod:nas` 与 `prod:nas:migrate`；保留现有 `docker:*` 低层兼容入口。

## 4. NAS Compose 与迁移恢复

- [x] 新增 `compose.nas.yaml` 并通过 Compose v2.40 merge 验证端口不会追加旧映射。
- [x] 给 NAS `admin` 配置 Docker socket 权限并重新登录验证无交互 `docker info`；记录 root-equivalent 风险。
- [x] 同步受控源码和忽略的远端 `.env`，权限分别限制为部署可读与 Secret 600。
- [x] 上传并校验 globals、PG custom dump、workspace tar；恢复空远端 volumes。
- [x] 对比 Ledger count/max/digest、table count、workspace file count；不搬 Neo4j 脏卷。

## 5. 物理启动与切换验证

- [x] `pnpm dev` 与 `pnpm dev:local`：命令与 endpoint contract 等价；为避免重新占用本机内存不重复启动本地数据库。
- [x] `pnpm dev:nas`：远端两数据库健康、本地无 Data Agent 容器、SSH tunnel 存活、四本地 consumer 正常。
- [x] NAS supervisor TERM：应用与 tunnel 整体退出，无孤儿监听。
- [x] `pnpm prod:nas`：六服务 Compose/build contract 通过并进入真实构建；按用户指示不等待 NAS 慢速首次下载完成。
- [x] 验证后停止本地 Data Agent 基础设施/应用进程，保留本地容器定义、卷和备份。

## 6. 文档与 Spec

- [x] 更新本地 Runbook：三模式、默认全本地、显式 NAS、端口、migration、断网回退、OpenSandbox 独立管理。
- [x] 更新部署 Runbook：NAS 目录、3001、loopback DB、备份/恢复、健康与回滚。
- [x] 更新 `local-runtime-modes.md`：三模式 contract、错误矩阵、必需测试和 Wrong/Correct。

## 7. 验证与提交

- [x] `pnpm test:dev-runtime` 与新增 NAS runtime tests（25 tests）。
- [x] `docker compose config`、`docker compose --profile deploy config`、NAS merged config。
- [x] 变更范围 typecheck/Biome、`git diff --check`；全仓受并行改动阻断时如实区分。
- [x] `trellis-check` 后只 stage 本任务文件，创建一个 scoped commit；不 amend、不吸收并行文件。

## 实际验证记录（2026-08-29）

- NAS PostgreSQL：Ledger 189、最大版本 `20260725010776_app_data_agent_e1_analysis_publication`、用户表 456、roles 58；
  migration frontier `sha256:0c19d942a7c1a7ca7ffbd3d29836bbaa7efac67533265c26c5f399743064990b`。
- Workspace volume：47 files，10.9 MiB；三份远端备份 SHA-256 与本地一致。
- `pnpm dev:nas`：Web 200（最终 `/login`）、Worker/Indexer `status=ready`，稳定跨多个 audit 周期；TERM 后六个应用/转发端口无监听。
- `pnpm prod:nas`：真实执行至受控 Node dependency build；NAS 外部仓库慢，用户明确允许跳过首次完整构建等待。

## 回滚点

- 代码回滚只恢复命令路由、NAS adapter 与 override；不触碰数据库 volumes。
- NAS 数据回滚使用保留的 PG dump/workspace tar；Neo4j 再次从 PostgreSQL 重建。
- NAS 不可用时退出 `dev:nas` 后运行默认 `pnpm dev` 或 `pnpm dev:local`；不做自动双向数据合并。
