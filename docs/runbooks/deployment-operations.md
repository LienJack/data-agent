# Data Agent 部署运维 Runbook

## 概述

本文档描述 Data Agent 的部署运维操作，覆盖 Docker Compose 自托管部署和 Vercel/Supabase/Upstash 托管部署两种模式。所有操作遵循 PostgreSQL-only 优先原则：Neo4j 缺失或 Redis 可丢失不影响 PostgreSQL 权威路径。

---

## 1. Docker Compose 自托管部署

### 1.1 前置条件

- Docker Engine 24+
- Docker Compose v2.20+
- 至少 2 GB 可用内存
- 端口 5432 (PostgreSQL) 和 3000 (Web) 未被占用

### 1.2 显式迁移与完整启动

```bash
# 从项目根目录显式应用尚未登记的迁移并验证 Ledger
pnpm docker:migrate

# 构建并启动 deploy profile 的完整五服务栈
pnpm docker:up

# 查看启动日志
docker compose --profile deploy logs -f
```

受支持的 `pnpm docker:up` wrapper 会把当前 checkout 的 Git SHA 与 dirty boolean 作为 Docker build args
注入。CI 或直接使用 Compose 时必须显式提供：

```bash
export DATA_AGENT_GIT_COMMIT="$(git rev-parse HEAD)"
export DATA_AGENT_GIT_DIRTY=false
docker compose --profile deploy build web worker relationship-indexer
```

缺失/非法 provenance 会令 builder 失败。builder 在 filtered build 后用 Turbo task identity 与 output digest
生成 portable runtime identity；runner 只复制对应 role 的 identity JSON，不复制 `.git`、`.turbo`、完整
attestation、绝对路径或 package digest。

裸 `docker compose up -d` 只启动 PostgreSQL 与 Neo4j，属于本地开发基础设施模式，
不会启动 Web、Worker 或 Relationship Indexer。完整部署必须使用 `deploy` profile。

### 1.3 组件

| 组件 | 容器名 | 端口 | 说明 |
|------|--------|------|------|
| PostgreSQL 17 | `data-agent-postgres` | 5432 | 主数据库，承载所有权威数据 |
| Neo4j | `data-agent-neo4j` | 7474/7687 | 可重建的语义关系投影 |
| Web App | `data-agent-web` | 3000 | Next.js 前端与 API |
| Worker | `data-agent-worker` | 容器内 9091 | 异步 Durable Worker 与 `/live` |
| Relationship Indexer | `data-agent-relationship-indexer` | 容器内 9090 | PostgreSQL 到 Neo4j 的投影 Worker |
| Migration | `data-agent-migration` | — | 一次性迁移初始化容器 |

### 1.4 健康检查

```bash
# 检查所有容器状态
docker compose --profile deploy ps

# 检查 PostgreSQL 连接
docker compose exec postgres pg_isready -U postgres -d data_agent

# 检查 Web 响应
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000

# 检查 Worker 日志
docker compose --profile deploy logs worker --tail=50

# 检查 Worker 与 Indexer 容器内存活端点
docker compose --profile deploy exec -T worker node -e \
  "fetch('http://127.0.0.1:9091/live').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)})"
docker compose --profile deploy exec -T relationship-indexer node -e \
  "fetch('http://127.0.0.1:9090/live').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)})"
```

Web、Worker 与 Indexer 响应中的 `build_id` / `generation_id` 只用于比较当前代际。Git SHA 与 dirty 状态只在
受控启动日志中出现，不属于公开 health contract。

### 1.5 数据持久化

PostgreSQL 数据存储在命名卷 `data-agent_pgdata` 中：

```bash
# 备份
docker compose exec postgres pg_dump -U postgres -d data_agent -F c > backup_$(date +%Y%m%d_%H%M%S).dump

# 恢复
docker compose exec -T postgres pg_restore -U postgres -d data_agent -F c < backup_file.dump

# 查看卷信息
docker volume inspect data-agent_pgdata
```

### 1.6 停止与清理

```bash
# 停止服务和容器（保留命名数据卷）
pnpm docker:down

# 永久删除数据卷是破坏性操作，只能在明确确认数据不再需要时另行执行。
```

### 1.7 NAS 完整容器部署

NAS 使用 SSH alias `data-agent-nas`，部署副本位于 `/vol1/1000/work/data-agent/current`。远端现有服务占用
3000 与系统 PostgreSQL 5432，因此 NAS override 固定为：Web `192.168.5.41:3001`、PostgreSQL
`127.0.0.1:55432`、Neo4j `127.0.0.1:7474/7687`。数据库端口不监听 LAN。

```bash
# 显式迁移；普通启动不隐式写 migration
pnpm prod:nas:migrate

# 同步受控源码、验证 Ledger、构建镜像并等待六服务 deploy profile
pnpm prod:nas

# 停止容器但保留全部 named volumes
pnpm prod:nas:down
```

NAS `admin` 必须能以 SSH key 无交互登录并直接访问 Docker socket；Docker group 是 root-equivalent 权限，只授予
现有管理员账户。混合开发还要求 sshd 为 `AllowTcpForwarding local`。远端 `.env` 权限为 600，源码同步明确排除
`.env`、`.env.local`、`.git`、`.trellis`、`.data`、`.next`、`.turbo`、`node_modules` 与 `dist`。

权威恢复顺序固定为：roles globals → PostgreSQL custom dump → workspace content tar。若 dump 的 data section
调用受限 owner 的校验函数，先恢复 pre-data，临时 `GRANT USAGE ON SCHEMA app_data_agent TO PUBLIC`，以
`--exit-on-error --section=data` 恢复数据后立即 REVOKE，再恢复 post-data。最后对比 Migration Ledger、用户表数、
roles 数与 workspace 文件数。Neo4j 使用空卷，由 Relationship Indexer 从 PostgreSQL 重建；不复制脏投影卷。

OpenSandbox 是独立管理的唯一 Python 执行层，不属于本 NAS Compose 栈。启用分析能力时必须按
`python-sandbox-execution.md` 单独部署并核验 endpoint、API key、固定镜像和 attestation；不得复活旧 UDS Sandbox。
NAS 首次构建受镜像仓库带宽影响时，可以先使用已验证的 `pnpm dev:nas`，待镜像缓存完成后再运行生产入口。
失败时不得执行 `down -v`；保留 `/vol1/1000/work/data-agent/backups/`、PostgreSQL/workspace named volumes 与
本地回退卷。

---

## 2. 迁移管理

### 2.1 迁移清单

应用迁移按版本号升序存放于 `infra/supabase/apps/data-agent/migrations/`：

| 迁移文件 | 版本 | 说明 |
|----------|------|------|
| `20260725010100_app_data_agent_core.sql` | 10100 | 核心 Schema |
| `20260725010200_app_data_agent_api.sql` | 10200 | API 表 |
| `20260725010300_app_data_agent_storage.sql` | 10300 | 存储层 |
| `20260725010400_app_data_agent_egress.sql` | 10400 | 出口控制 |
| `20260725010500_app_data_agent_runtime_foundation.sql` | 10500 | 运行时基础 |
| `20260725010505_app_data_agent_runtime_api.sql` | 10505 | 运行时 API |
| `20260725010510_app_data_agent_runtime_projection_invariants.sql` | 10510 | 投影不变量 |
| `20260725010520_app_data_agent_runtime_queue_lease.sql` | 10520 | 队列租约 |
| `20260725010530_app_data_agent_runtime_event_settlement.sql` | 10530 | 事件结算 |
| `20260725010540_app_data_agent_runtime_checkpoint_effect.sql` | 10540 | 检查点效果 |
| `20260725010550_app_data_agent_runtime_control.sql` | 10550 | 运行时控制 |
| `20260725010560_app_data_agent_runtime_backend_acceptance.sql` | 10560 | 后端接收 |
| `20260725010570_app_data_agent_runtime_security.sql` | 10570 | 运行时安全 |
| `20260725010580_app_data_agent_text2sql_system_store.sql` | 10580 | Text2SQL 系统存储 |
| `20260725010590_app_data_agent_u6_research_authority.sql` | 10590 | U6 研究权威 |
| `20260725010600_app_data_agent_u6_research_derivation.sql` | 10600 | U6 研究派生 (C2) |
| `20260725010601_app_data_agent_u6_research_controlled_fixture.sql` | 10601 | U6 受控 Fixture |
| `20260725010610_app_data_agent_semantic_control_plane.sql` | 10610 | 语义控制平面 |
| `20260725010615_app_data_agent_semantic_published_bridge.sql` | 10615 | 已发布桥接 |

### 2.2 迁移维护清单

- `u6-migration-maintenance-manifest.json` — 10590 迁移维护清单
- `u6-c2-migration-maintenance-manifest.json` — 10600 迁移维护清单
- `u9-semantic-migration-maintenance-manifest.json` — 10610 + 10615 迁移维护清单

### 2.3 验证迁移顺序

```bash
# 验证所有迁移文件按版本号排序无冲突
ls -1 infra/supabase/apps/data-agent/migrations/*.sql | sort -c
```

### 2.4 回滚策略

PostgreSQL 迁移采用 additive compatibility 策略，不生成 `DOWN` 迁移。回滚通过以下方式实现：

1. **版本回退**：将 `semantic_active_pointer` 指向旧版本
2. **数据保留**：迁移只添加列和表，不删除
3. **功能回滚**：通过发布/回滚 RPC 控制 active pointer

---

## 3. 发布与回滚

### 3.1 发布流程

```bash
# 1. 运行验证
pnpm verify:release

# 2. 如果 verify:release 返回 GO，运行全量测试
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:deploy:docker

# 3. Docker 部署：迁移成功后再启动应用
pnpm docker:migrate
pnpm docker:up
```

`verify:release` 会强制执行 Web/Worker 依赖构建，随后重新读取 Turbo dry-run identity、核对实际 outputs，
并生成 `workspace_build_integrity` receipt。任一 task hash、export、output digest 或 provenance 不一致都返回
`HOLD`，不能用已有旧 `dist` 继续发布。它只检查 Migration Ledger/manifest readiness，不自动执行 SQL。

### 3.2 回滚流程

```bash
# 1. 停止当前版本
pnpm docker:down

# 2. 回滚到上一版本（使用 git checkout 或保留的旧镜像）
git checkout <previous-release-tag>
pnpm docker:migrate
pnpm docker:up
```

### 3.3 语义发布回滚

```bash
# 通过 API 或 RPC 回滚语义发布
# RPC 名称：semantic_rollback_release
# 参数：release_id, reason
```

---

## 4. Worker 运维

### 4.1 Worker 重启

```bash
# 重启 Worker
docker compose --profile deploy restart worker

# 查看重启后的恢复日志
docker compose --profile deploy logs worker --tail=50
```

Worker 重启后自动从 PostgreSQL 恢复未完成的 Run：

- 检查 Lease 是否过期
- 重新 Claim 超时的 Run
- 恢复 Checkpoint 状态
- 继续执行

### 4.2 Outbox 恢复

如果 Worker 在 Outbox 消息发送前崩溃，重启后自动恢复：

```bash
# 检查 Outbox 状态
docker compose exec postgres psql -U postgres -d data_agent \
  -c "SELECT count(*) FROM app_data_agent.outbox WHERE status = 'PENDING';"

# 手动触发 Outbox 发布
docker compose exec postgres psql -U postgres -d data_agent \
  -c "SELECT app_data_agent.publish_pending_outbox();"
```

### 4.3 备份与恢复

```bash
# 全量备份
docker compose exec postgres pg_dump -U postgres -d data_agent -F c > /tmp/full_backup.dump

# 从备份恢复
docker compose exec -T postgres pg_restore -U postgres -d data_agent -F c --clean < /tmp/full_backup.dump
```

---

## 5. 托管部署（Vercel / Supabase / Upstash）

### 5.1 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgres://user:pass@host:5432/data_agent` |
| `NEXT_PUBLIC_APP_URL` | 应用 URL | `https://data-agent.vercel.app` |
| `UPSTASH_REDIS_URL` | Upstash Redis 地址 | `https://...upstash.io` |

### 5.2 部署步骤

```bash
# 1. 构建并部署到 Vercel
vercel --prod

# 2. 运行数据库迁移（通过 Supabase 或直接 psql）
psql "$DATABASE_URL" -f infra/supabase/platform/migrations/20260725000100_platform_foundation.sql
# 按顺序运行所有应用迁移

# 3. 验证部署
curl -s https://data-agent.vercel.app/api/health
```

### 5.3 共享 Supabase 隔离

多个应用共享同一 Supabase Project 时：

- 通过 `app_data_agent` Schema 命名空间隔离
- 通过 RLS 策略实现租户级数据隔离
- 通过 `app_id` + `tenant_id` 复合键区分数据

---

## 6. 监控与告警

### 6.1 关键指标

| 指标 | 正常范围 | 告警阈值 |
|------|----------|----------|
| PostgreSQL 连接数 | < 50 | > 80 |
| Worker 队列深度 | < 100 | > 500 |
| 迁移执行时间 | < 5 min | > 10 min |
| 出队到执行延迟 | < 1 s | > 5 s |

### 6.2 日志查看

```bash
# 实时日志
docker compose --profile deploy logs -f --tail=100

# 按服务过滤
docker compose --profile deploy logs -f web
docker compose --profile deploy logs -f worker
docker compose logs -f postgres
```

---

## 7. 故障恢复

### 7.0 `PERSISTENCE_TRANSACTION_FAILED` 定位顺序

1. 比较 Web/Worker/Indexer health 的 `build_id` 与 `generation_id`；
2. 核对部署 receipt 的 `workspace_build_integrity` generation；
3. 查服务端 `persistence_transaction_failed`，按 correlation、operation、SQLSTATE、process role 和 build ID
   定位；
4. 核对 `migration_ready` 与 `migration_frontier`；
5. 最后按 correlation/时间窗口查询 PostgreSQL 日志。

浏览器只保留稳定 `PERSISTENCE_TRANSACTION_FAILED` code 与脱敏 message。安全日志禁止包含 raw Error、SQL、
parameters、stack、DSN、Secret 或任意额外对象。

### 7.1 PostgreSQL 崩溃恢复

```bash
# 检查 PostgreSQL 日志
docker compose logs postgres --tail=100

# 重启 PostgreSQL
docker compose restart postgres

# 验证数据完整性
docker compose exec postgres psql -U postgres -d data_agent -c "VACUUM VERBOSE ANALYZE;"
```

### 7.2 Worker 崩溃恢复

Worker 是[无状态](/docs/runbooks/durable-run-runtime.md)设计，所有状态存储在 PostgreSQL 中：

```bash
# 重启 Worker
docker compose --profile deploy restart worker

# 检查恢复的 Run
docker compose --profile deploy logs worker --tail=50 | grep -i "recover\|resume\|restart"
```

### 7.3 迁移失败恢复

```bash
# 查看迁移失败日志
docker compose logs migration --tail=50

# 修复后重新运行迁移
pnpm docker:migrate
```

---

## 8. 安全操作

### 8.1 密钥轮转

```bash
# 更新 PostgreSQL 密码
docker compose exec postgres psql -U postgres -c "ALTER USER postgres PASSWORD '<new-password>';"

# 更新 compose.yaml 中的环境变量
```

### 8.2 网络策略

- Web 服务暴露 3000 端口
- 当前自托管 Compose 将 PostgreSQL 5432 映射到宿主机；生产主机必须用防火墙限制访问。
- Worker 与 Relationship Indexer 的健康端口只在 Compose 网络内使用，不映射到宿主机。

---

## 9. 版本兼容性

| 组件 | 最低版本 | 推荐版本 |
|------|----------|----------|
| PostgreSQL | 17 | 17 |
| Node.js | 24 | 24 LTS |
| pnpm | 10.33 | 10.33+ |
| Docker Engine | 24 | 27 |
| Docker Compose | 2.20 | 2.30+ |

---

## 10. 参考文档

- [Durable Run Runtime Runbook](/docs/runbooks/durable-run-runtime.md)
- [Provider Credentialed Certification](/docs/runbooks/provider-credentialed-certification.md)
- [U9 迁移维护清单](/infra/supabase/apps/data-agent/u9-semantic-migration-maintenance-manifest.json)
- [U6 迁移维护清单](/infra/supabase/apps/data-agent/u6-migration-maintenance-manifest.json)
