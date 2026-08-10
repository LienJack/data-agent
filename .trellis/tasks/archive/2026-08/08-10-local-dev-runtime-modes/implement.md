# 本地开发与 Docker 部署双模式 — 实现计划

## 0. 工作区与基线

- [ ] 记录实现前 `git status --short`，保护当前与本任务无关的 Web、Test Center、模型和
  Trellis 改动；只修改本计划列出的文件。
- [ ] 读取 Backend/Relationship Index/Quality 规范和 Worker/部署 Runbook。
- [ ] 保存当前 `docker compose config`、Worker 立即退出和 Indexer profile 的
  Characterization 证据。

## 1. 先建立失败测试

- [ ] 在 Worker 测试中新增 daemon 配置、初始化、IDLE 退避、异常周期、终止信号和健康状态
  用例；验证当前没有可执行入口时失败。
- [ ] 新增 Compose 运行模式契约测试：默认长期服务只能是 PostgreSQL/Neo4j，`deploy`
  profile 必须包含 Web/Worker/Indexer，Worker CMD 不能是导出型 `dist/index.js`。
- [ ] 新增开发监督脚本测试：环境优先级、只选择目标服务、子进程失败传播、Secret 不进入
  命令/日志快照。

## 2. 实现 Worker daemon

- [ ] 新增 Worker daemon 入口与严格环境 Schema；提取可注入、可测试的 Process Factory。
- [ ] 组合 PostgreSQL Capability、Run Queue、Event Store、Research Authority、Research
  Executor 和 Run Worker Runner。
- [ ] 将固定 Authority Capability 正确注入 Research Executor，移除空 Capability 占位。
- [ ] 实现轮询、结构化日志、`/live`、信号关闭和资源释放。
- [ ] 更新 `apps/worker/package.json`：本地 watch 与生产启动脚本。
- [ ] 更新 `infra/docker/Dockerfile.worker` CMD 指向 daemon 构建产物。

## 3. 实现开发监督与命令面

- [ ] 新增根级运行模式脚本：加载根环境、注入安全默认值、选择服务、监督子进程和转发信号。
- [ ] 实现 `dev:infra`、`dev:check`、`dev:migrate`、三个单服务 watch、`dev:apps` 与
  聚合 `dev`。
- [ ] 检查 3000/5432/7474/7687/Worker Health/Indexer Health 端口，冲突时输出占用者与
  解决指引，不自动杀进程。
- [ ] 让 Web、Worker、Indexer 使用同一组 Authority/Provider 环境来源，但分别使用正确的
  localhost DSN。

## 4. 收敛 Compose 部署模式

- [ ] PostgreSQL/Neo4j 设为默认数据库基础设施，Web/Worker/Indexer 归入 `deploy` profile，
  Migration 保持一次性 profile。
- [ ] Worker 注入固定 Server Context、运行参数和健康端口；新增职责匹配的健康检查。
- [ ] 保持 Web 不依赖 Neo4j 健康；Indexer 继续等待 PostgreSQL/Neo4j 健康。
- [ ] 增加 `docker:migrate`、`docker:up`、`docker:down` 命令并验证失败码传播。

## 5. 迁移与就绪门禁

- [ ] 实现只读 Migration Ledger 检查，验证迁移文件集合、Ledger 名称和必要 Authority 映射。
- [ ] `pnpm dev` 在 Ledger 缺失时失败并提示 `pnpm dev:migrate`，不得自动应用 SQL。
- [ ] 显式迁移命令保留 `ON_ERROR_STOP=1`，成功后再次执行 Ledger 检查；失败时不启动应用。

## 6. 文档

- [ ] 新增或更新开发 Runbook，记录第一次启动、日常启动、单服务调试、停止、迁移、端口和
  环境变量名称。
- [ ] 更新部署 Runbook，明确 Migration -> `deploy` profile -> 逐服务健康验证的顺序。
- [ ] 删除“默认 Compose 同时适合热更新开发”的旧表述，保留 PostgreSQL/Neo4j Authority
  边界与 Secret 规则。

## 7. 验证门禁

- [ ] `pnpm --filter @data-agent/worker test:unit`
- [ ] 新增运行模式/Compose 聚焦测试。
- [ ] `pnpm --filter @data-agent/worker typecheck`
- [ ] `pnpm --filter @data-agent/web typecheck`
- [ ] `pnpm typecheck`
- [ ] 变更范围 Biome 与 `git diff --check`。
- [ ] `docker compose config` 与 `docker compose --profile deploy config`。
- [ ] 开发物理 Smoke：只有两个数据库容器；三个本地应用保持运行并分别证明热更新。
- [ ] Worker 真实 Run：Lease、Heartbeat、终态和停止/接管证据。
- [ ] Indexer 真实周期：`/live` 200、`IDLE/INDEXED`；禁用/停 Neo4j 后 PostgreSQL fallback。
- [ ] 部署物理 Smoke：构建镜像、显式迁移、完整五服务栈健康；Worker 不再 exit 0 重启。

## 8. 风险与回滚点

- Worker 组合是最高风险点：若真实 Run 集成未通过，不进入 Compose 切换。
- Compose profile 改名影响旧命令：文档和契约测试必须同一提交更新。
- 不删除现有数据卷；回滚只恢复脚本、profile 和镜像入口。
- 不清理用户现有 `.env`、`.env.local`、`.next` 或未提交业务改动。
