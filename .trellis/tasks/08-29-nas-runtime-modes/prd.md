# 三模式启动与 NAS 可选开发

## Goal

把 Data Agent 的启动方式收敛成三个可重复、可切换且不会混跑的运行模式。团队默认
`pnpm dev` 继续使用全本地开发拓扑；本机内存不足时显式使用 `pnpm dev:nas` 把数据库负载
移到 NAS；生产环境可在 NAS 完整容器化部署。

## Background

- 当前 `pnpm dev` 固定启动本地 Compose PostgreSQL/Neo4j，再运行宿主机 Web、Worker、
  Relationship Indexer 与 Semantic Authoring；它没有远端基础设施抽象。
- 当前 Compose 默认服务集合只包含 PostgreSQL、Neo4j；`deploy` profile 再加入 ClamAV、Web、Worker 与
  Relationship Indexer。原内置 Python Sandbox 已退役，OpenSandbox 由独立服务管理。
- NAS SSH 别名是 `data-agent-nas`，部署根目录是
  `/vol1/1000/work/data-agent/current`。NAS 的 `3000` 已被 DataFoundry 占用，宿主
  `5432` 已被系统 PostgreSQL 占用。
- 已生成迁移前可恢复备份：PostgreSQL custom dump、roles globals 和 workspace content tar；
  本地 PostgreSQL/Neo4j/ClamAV 容器当前已停止，命名卷仍保留。
- PostgreSQL 是权威数据；Neo4j 是可从 PostgreSQL 重建的投影。测试/临时 Falcon PostgreSQL
  容器不是 Data Agent 长期运行栈的一部分。

## Requirements

- R1. 提供三个用户可见运行模式：
  - `local`：本地 PostgreSQL/Neo4j + 本地 Web/Worker/Indexer；
  - `nas`：NAS PostgreSQL/Neo4j + 本地 Web/Worker/Indexer，本地不运行 Data Agent 容器；
  - `production-nas`：NAS 上完整容器化长期服务栈。
- R2. `pnpm dev` 必须等价于 `pnpm dev:local`，保持现有团队默认行为；NAS 只通过显式
  `pnpm dev:nas` 进入，不能影响其他内存充足的开发者。
- R3. NAS 开发模式通过 SSH key 自动连接，不把 SSH、sudo、数据库或 Provider Secret 写入
  仓库、日志或命令快照。NAS 地址、SSH alias、远端目录和本地转发端口允许用专用非秘密环境变量覆盖。
- R4. NAS PostgreSQL/Neo4j 只绑定远端 loopback；本地开发通过受监督的 SSH tunnel 访问，
  不把弱默认开发凭据直接暴露到局域网。
- R5. 模式切换必须避免混跑：NAS 开发模式停止 NAS Web/Worker/Indexer 等应用容器，只保留
  远端数据库；生产 NAS 模式停止本地 Data Agent 基础设施容器，并在本地应用端口被占用时失败关闭，
  不主动终止未知宿主进程。
- R6. 两种开发模式保持宿主 Worker 的现有 Sandbox 默认关闭行为；NAS 运行模式不得复活退役的 UDS
  Sandbox。需要分析能力时复用当前独立、受 attestation 约束的 OpenSandbox 契约。
- R7. 迁移必须先恢复 PostgreSQL 权威数据和 workspace content，再启动远端应用；Neo4j 使用空卷并由
  Indexer 从 PostgreSQL 重建。IPC、日志、ClamAV 签名和临时测试卷不迁移。
- R8. 日常启动继续只读验证 Migration Ledger，不隐式执行迁移。Local 与 NAS 必须各有显式迁移入口，
  错误信息给出与当前模式一致的恢复命令。
- R9. 生产 NAS 使用当前 checkout 的受控源码快照和 Git provenance 构建 amd64 镜像；远端 Web 使用
  `192.168.5.41:3001`，容器内部 PostgreSQL/Neo4j 服务名不变。
- R10. 模式命令、拓扑、端口、健康检查、数据位置、切换与回滚必须写入 Runbook，并更新
  `.trellis/spec/backend/local-runtime-modes.md` 的长期契约。
- R11. 任务只提交自己拥有的启动脚本、Compose override、测试、Runbook、Spec 和 Trellis artifacts；
  不吸收现有 `apps/web/next-env.d.ts`、`apps/web/tsconfig.tsbuildinfo` 或其他并行改动。

## Acceptance Criteria

- [x] AC1. `pnpm dev` 与 `pnpm dev:local` 使用同一路由与本地 endpoint contract，启动本地 PostgreSQL、Neo4j
  与四个受管理本地 consumer；
  数据库 DSN 指向 `127.0.0.1:5432`，Neo4j 指向 `127.0.0.1:7687`。
- [x] AC2. 只有 `pnpm dev:nas` 使用 NAS：NAS PostgreSQL/Neo4j 健康、本地 Data Agent 容器全部停止，
  SSH tunnel 存活，本地 Web/Worker/Indexer health 分别可用。
- [x] AC3. NAS 模式即使 `.env.local` 含 localhost `DATABASE_URL`，运行时仍使用模式生成的 NAS tunnel
  DSN；只有专用 NAS 配置变量可以改变 NAS host/port/remote path。
- [x] AC4. SSH tunnel 或远端 Compose 失败时，应用端口保持未启动并返回稳定非零 reason code；停止
  `pnpm dev:nas` 后 tunnel 与受管理应用进程一并退出。
- [x] AC5. `pnpm dev:migrate:local` 与 `pnpm dev:migrate:nas` 都显式执行迁移并复核 migration name/checksum；
  普通 `pnpm dev*` 不应用 SQL。
- [x] AC6. PostgreSQL 恢复后远端 Ledger count、最大 migration version 与 digest 等于备份基线；
  workspace 文件数量与归档一致。
- [x] AC7. `pnpm prod:nas` 提供 NAS 六服务构建/启动入口、Git provenance 与 3001 Web 映射；首次完整镜像
  构建已进入依赖下载，按用户指示因 NAS 镜像仓库较慢暂不等待物理启动完成。
- [x] AC8. NAS Compose contract 不包含退役的 `python-sandbox` 服务或 Dockerfile；分析执行继续使用独立
  OpenSandbox，部署与 attestation 不由本任务改写。
- [x] AC9. NAS PostgreSQL/Neo4j 不监听 LAN 地址；只能通过 SSH tunnel 或 NAS 容器网络访问。
- [x] AC10. 远端通过后本地 Data Agent PostgreSQL/Neo4j/ClamAV 容器保持停止，本地命名卷和备份保留；
  不删除任何权威数据或测试卷。
- [x] AC11. 聚焦测试、Compose config、typecheck/Biome、`git diff --check` 与 NAS 开发物理 smoke 通过；
  local 行为由既有路径与新增 contract 覆盖，production 物理 smoke 按用户指示延期，然后只提交本任务文件。

## Out of Scope

- 不改变 OpenSandbox 部署、网络或 attestation 契约。
- 不迁移或删除 Falcon scratch、临时测试容器、旧 IPC 卷、Neo4j 日志和 ClamAV 缓存。
- 不删除本地 PostgreSQL、Neo4j 或 workspace 命名卷；回收磁盘另设任务并需再次确认。
- 不改变业务 API、数据库 Schema、Migration 历史、PostgreSQL Authority 或 Neo4j 投影边界。
- 不接管 NAS 上 DataFoundry、MetaTube、QWRT 或系统 PostgreSQL。

## Key Decisions

- D1. `pnpm dev` 保持全本地开发；NAS 混合模式必须显式选择，不改变其他开发者的默认路径。
- D2. 可选 NAS 混合模式不启动分析 Sandbox；OpenSandbox 独立管理，NAS Compose 不复活旧 UDS Sandbox。
- D3. NAS 数据库端口只绑定 loopback，并由启动脚本监督 SSH tunnel。
- D4. 生产 NAS Web 使用 3001，PostgreSQL 映射使用远端 loopback 55432，以避开 NAS 既有服务。
- D5. 迁移采用 PostgreSQL 逻辑恢复，Neo4j 从权威库重建；所有本地卷保留作为回退。
