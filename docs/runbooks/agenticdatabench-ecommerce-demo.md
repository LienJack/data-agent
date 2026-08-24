# AgenticDataBench E-commerce PostgreSQL Demo 运行手册

## 当前交付状态

本 Demo 使用现有 `data_agent` PostgreSQL 数据库，不新增 PostgreSQL 服务、数据库或数据卷。业务数据通过两个独立 Schema 隔离：

- `demo_adb_ecommerce_raw`：12 张原始表；
- `demo_adb_ecommerce_mart`：14 张维度/事实表与 5 个治理视图；
- `data_agent_ecommerce_reader`：只读组角色，只能读取上述两个 Demo Schema；
- 固定数据包摘要：`sha256:54632f39e190c872d2b5c176090ebc2d3b77e135b9bb5aecc96d6bf6d0fa4518`。

Test Center 中的 `E-commerce Production` 已开放 24 道公开题预览，包括 8 道复杂题、8 道 Python 分析题和 6 道图表/报告题。当前状态仍为 `HOLD`：公开题面和 Schema 可看，但 Runner 与 Artifact Oracle 尚未完成端到端认证，所以运行、提交 SQL 和成绩发布都保持禁用。

语义资产当前也是待人工审核的 Draft：32 个指标、15 个维度、8 条关系、14 个实体、46 个中文术语和 5 个事件。未完成治理发布和 Neo4j 投影前，不应把估算的节点/边数量当作实测结果。

## 离线启动和导入

标准启动不会访问上游数据源。压缩 seed 已随仓库固定，维护者只有在显式重建数据包时才需要联网。

```bash
pnpm install
pnpm benchmark:ecommerce:verify
pnpm exec tsx scripts/render-migration.ts 10636 --verify
pnpm exec tsx scripts/render-migration.ts 10637 --verify
pnpm dev:infra
pnpm dev:migrate
pnpm dev:check
```

`pnpm dev:migrate` 会执行 ledger migration，并由一次性 migration 容器校验 gzip chunk 后导入数据。再次执行必须是同摘要 no-op。导入失败时不得写入新的 ACTIVE 数据版本。

## 绑定到本地 Workspace

先完成项目原有的 Super Admin/Workspace bootstrap，再显式授权绑定 Demo：

```bash
DATA_AGENT_ALLOW_ECOMMERCE_DEMO_BOOTSTRAP=YES \
DATA_AGENT_ECOMMERCE_WORKSPACE_SLUG=main-workspace \
pnpm bootstrap:ecommerce-demo
```

本地默认 reader 密码只用于本机开发。非 `local` 环境必须显式设置强密码：

```bash
export DATA_AGENT_ECOMMERCE_READER_PASSWORD='从密钥系统注入，不写入仓库或日志'
```

CLI 只输出 Workspace、Datasource、bundle digest 和终态，不应输出密码或连接串。重复执行应返回 `ECOMMERCE_DEMO_ALREADY_ATTACHED`，且不会创建第二个 Datasource。

## 数据和权限验收

以下查询使用管理员连接，只报告结构、计数和摘要：

```sql
select dataset_id, bundle_digest
from app_data_agent.demo_dataset_active_versions
where dataset_id = 'agenticdatabench-ecommerce';

select layer, relation_name, row_count
from demo_adb_ecommerce_mart.v_dataset_quality
order by layer, relation_name;

select count(*) as raw_tables
from information_schema.tables
where table_schema = 'demo_adb_ecommerce_raw' and table_type = 'BASE TABLE';

select count(*) as mart_tables
from information_schema.tables
where table_schema = 'demo_adb_ecommerce_mart' and table_type = 'BASE TABLE';

select count(*) as mart_views
from information_schema.views
where table_schema = 'demo_adb_ecommerce_mart';
```

预期闭包是 `12 / 14 / 5`。再使用 reader LOGIN 验证：

```sql
select count(*) from demo_adb_ecommerce_mart.fact_order;
select has_schema_privilege(current_user, 'app_data_agent', 'USAGE') as control_schema_visible;
```

第一条当前固定快照应返回 `99441`；第二条必须为 `false`。还应确认 reader 的 `INSERT/UPDATE/DELETE/CREATE` 均失败。

Workspace 绑定回执位于 `app_data_agent.demo_workspace_receipts`，它属于控制面私有数据，只能由后端权威身份核验，不得通过浏览器 API 或 Demo reader 暴露。

## Test Center 预览

启动 Web 后打开 `/tests`。页面默认选中 `E-commerce Production`，展示 24 道公开题、所需表和真实列类型。HOLD 状态下：

- 可以切题和查看公开 Schema；
- 不加载 sealed 文件，不返回 Gold SQL 或 Oracle policy；
- 复选框、Agent 执行和 SQL 提交按钮禁用；
- 服务端即使收到直接运行请求，也继续按 `runnable=false` 失败关闭。

公开预览加载器会同时校验 manifest、自身摘要、公开题集合摘要和逐题摘要。任何手工篡改都会导致预览失败。

## OpenSandbox Python 分析执行层

Python 分析只通过独立 OpenSandbox 服务运行。Worker 使用官方 SDK 创建两个不同 Sandbox：Agent Sandbox 执行有状态 Cell、读取受控 Parquet 并生成 JSON/PNG/SVG；Operator Sandbox 只执行唯一 `data_agent_stats` 注册表中的治理统计算子。OpenSandbox 不持有 PostgreSQL、Datasource、对象存储或 Provider 凭据，也不替代 SQL Sandbox、语义权威、`AnalysisProgram`、Oracle 或 Artifact/Receipt/Fence。

```bash
docker build -f infra/docker/Dockerfile.opensandbox-analysis-agent \
  --build-arg ANALYSIS_PROFILE=CORE_ANALYSIS \
  --build-arg REQUIREMENTS_LOCK=infra/docker/opensandbox-analysis-core-requirements.lock \
  -t data-agent-opensandbox-agent-core:2026-08-24 .
docker build -f infra/docker/Dockerfile.opensandbox-analysis-operator \
  -t data-agent-opensandbox-operator:2026-08-24 .
pnpm sandbox:analysis:attest
pnpm --filter @data-agent/worker exec vitest run test/runs/opensandbox-analysis-runtime.spec.ts
uv run --project services/sandbox pytest -q services/sandbox/tests/operators
```

ML 与 Causal profile 使用相同 Dockerfile，分别指定对应 lock 和镜像标签。升级依赖时必须同步更新：

1. 三个 `opensandbox-analysis-*-requirements.lock` 的 hash lock；
2. Agent/Operator 镜像摘要与 `opensandbox-analysis-attestation.json`；
3. 算子 manifest、实现源码和唯一 registry digest；
4. Cell policy、文件传输、Operator closure、超时/取消和清理探针。

本地 Docker 探针目前只证明功能可用，`secure_access=false`，不能证明生产强隔离。生产必须另行证明 Kata 或 gVisor 与 Cilium egress policy、只读根文件系统、无凭据及 release image digest；缺任一项保持 HOLD。

紧急停用设置 `ANALYSIS_SANDBOX_ENABLED=false` 并停止外部 OpenSandbox 服务。运行会明确失败，不回退旧执行器；既有 Artifact 与回执继续保留。

## 真实 Agent 作答与评分验收

先用项目既有命令把本地系统模型认证回执提交到 PostgreSQL，再显式允许一次 E-commerce 验收：

```bash
DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_CONFIRM=YES pnpm model:certify:local
DATA_AGENT_ALLOW_ECOMMERCE_AGENT_ACCEPTANCE=YES pnpm benchmark:ecommerce:acceptance
```

第二条命令默认选择 4 表 DEMO Case `ec100000-0000-4000-8000-000000000004`，并使用仓库冻结的
DeepSeek deployment 约束。它加载 Public Case 给 certified model，使用专用只读角色分别执行候选 SQL
和服务端 Sealed Gold，生成 Oracle Receipt 与 ScoreCard，写入 PostgreSQL 后再按 `batch_run_id` 回读。

`PASS` 和 `FAIL` 都是有效的真实运行证据；不得用 Fixture Agent、提交答案、预置 SQL 或 Gold 回放
替代。该命令只是 SQL 首门槛，不能把 Production Suite 从 HOLD 改成 READY；最终仍需 Hard
SQL+Python Case 真实贯通 Worker、Python Sandbox、Artifact Oracle 和浏览器回读。

## 题库和语义资产复验

```bash
pnpm benchmark:ecommerce:suite
pnpm benchmark:ecommerce:semantic
pnpm exec vitest run tests/agenticdatabench-ecommerce-bundle.spec.ts \
  tests/ecommerce-production-suite.spec.ts tests/ecommerce-semantic-bundle.spec.ts
pnpm --filter @data-agent/evals exec vitest run \
  test/ecommerce-production-dataset.spec.ts test/test-center.spec.ts
pnpm --filter @data-agent/worker exec vitest run test/runs/opensandbox-analysis-runtime.spec.ts
```

前两个生成命令是确定性维护命令；普通使用者不需要运行。语义 bundle 必须经过人工 review/publish，不能由启动脚本自动发布。

## 故障诊断

| 现象 | 检查 | 处理 |
|---|---|---|
| `DEV_MIGRATIONS_NOT_READY` | migration ledger | 执行 `pnpm dev:migrate`，不要让 `pnpm dev` 隐式迁移 |
| `ADB_ECOMMERCE_CHUNK_MISMATCH` | seed 文件大小与 SHA-256 | 恢复受版本控制的固定 chunk，不要跳过校验 |
| Workspace bootstrap 返回 HOLD | 数据版本、Workspace slug、管理员成员关系 | 修复权威状态后重试；命令本身可幂等重放 |
| Test Center 题目不显示 | suite manifest/公开题摘要 | 运行预览加载器测试；不得绕过 digest |
| Test Center 显示 HOLD | Hard Python/Worker/Artifact Oracle certification | SQL 首门槛通过后仍是当前预期状态，不要手改为 READY |
| Analysis Sandbox unavailable | OpenSandbox API、API key、镜像与 Worker 配置 | 修复服务后重试；不回退旧执行器，也不在 Worker 进程内执行 |
| Cell policy rejected | import、路径、系统调用和输出声明 | 缩小 Cell 能力；不得放宽网络、进程或任意主机文件权限 |

## 回滚和清理

优先采用功能回滚，保留审计证据：

1. 将 E-commerce suite 从 UI/服务器 allowlist 下线；
2. 设置 `ANALYSIS_SANDBOX_ENABLED=false` 并停止外部 OpenSandbox 服务；
3. 将目标 Workspace 的 Demo Datasource 标记为禁用，并轮换/revoke reader 登录；
4. 保留 migration ledger、dataset/workspace receipts、Run、Artifact 和 ScoreCard。

只有在一次性、明确命名的 disposable 数据库中，才允许执行精确 allowlist 清理两个 Demo Schema 和专用 LOGIN/role。清理前必须验证当前数据库名和目标对象清单；不得删除共享 `data_agent` 数据库、PostgreSQL volume、`app_data_agent` Schema、其他角色或用户 Artifact。生产或共享开发库没有自动 destructive rollback。

## READY 发布门禁

以下证据未全部具备前必须保持 HOLD：

- 语义 Candidate 已人工批准，PostgreSQL release 与 Neo4j projection digest 一致；
- SQL/Python Sandbox 的取消、资源耗尽和真实容器对抗测试闭合；
- Worker server-owned Python tool、持久化事件和 Artifact commit 链闭合；
- 24 题 Runner 与确定性 SQL/Artifact Oracle 完成认证；
- 至少一条复杂题真实贯穿 PostgreSQL、模型、Python Sandbox 和 ScoreCard；
- Web、数据库、migration ledger、Worker、Python Sandbox 及可选 Neo4j 健康状态分别可证明。
