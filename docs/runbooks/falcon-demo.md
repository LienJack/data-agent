# Falcon 内置 Demo 与评测运行手册

## 固定范围

Falcon v1 固定上游 commit `8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`，随仓库分发
28 个压缩 PostgreSQL seed、500 道公开题面和服务端密封 DEV 真值。范围恒定为：

- DEV 309 题：DEMO 10、TUNING 294、LOCAL_HOLDOUT 5；
- TEST 191 题：只生成 submission，不在本地计算准确率；
- 主 Demo：`falcon_db_24`，9 表、70 列、17 题；
- 快速 smoke：`falcon_db_14`，4 表、18 列、32 题。

Falcon 复用现有 `postgres` 服务、`data_agent` database 和 `pgdata` volume。业务数据只进入
`falcon_db_01` 至 `falcon_db_28`，不会新建第二套 PostgreSQL，也不会把 Gold/expected 写入业务
schema。

## 首次启动与幂等验证

标准迁移会离线校验并导入随仓库分发的 seed：

```bash
pnpm dev:infra
pnpm dev:migrate
pnpm falcon:bundle:verify
```

成功必须同时满足 28 库、500 题、DEV 309、TEST 191、5 个 DB-GPT compatibility fixture 和
不可变 `FalconImportReceipt`。重复执行 `pnpm dev:migrate` 会按 source digest 幂等跳过，不能用
“schema 存在”替代 READY 回执。

首次导入的观测增量约 260 MB；实际字节数保存在 import receipt 的
`database_size_before_bytes`、`database_size_after_bytes` 和逐库 `postgres_size_bytes` 中。

## 绑定工作空间

先完成正常超级管理员/工作空间 bootstrap，再对明确的工作空间绑定：

```bash
pnpm falcon:workspace:attach --workspace-id "$FALCON_DEMO_WORKSPACE_ID"
pnpm falcon:workspace:verify --workspace-id "$FALCON_DEMO_WORKSPACE_ID"
```

命令只输出 masked SecretRef、datasource fingerprint、默认 `falcon_db_24` 和 28 个 logical
database 摘要，不输出密码或完整 DSN。运行时角色 `falcon_demo_reader` 默认只读，控制面 schema
无权限；case executor 还会拒绝跨 case schema、DDL/DML、多语句和超预算查询。

## db24 本体候选

在发布前生成并验证 Agent 候选：

```bash
pnpm falcon:semantic:publish --workspace-id "$FALCON_DEMO_WORKSPACE_ID"
```

命令从真实 PostgreSQL 重新认证 Join，生成 9 个业务主体、17 个维度、21 个指标、21 个公式、
9 张物理表、70 个物理列和 10 个中文术语。`blinkit_inventory` 与
`blinkit_inventoryNew` 保持两个独立原始快照，不自动 UNION 或推断覆盖关系。

输出位于 `artifacts/falcon-semantic/`，终态固定为 `REVIEW_REQUIRED`。Agent 只能生成/修改
Candidate；人工必须核对 coverage receipt、公式口径和物理 Join 证据后，才可通过语义治理页面
Review 与 Publish。脚本不会绕过审批直接激活语义版本。

## 运行与判分

```bash
pnpm falcon:demo:smoke --workspace-id "$FALCON_DEMO_WORKSPACE_ID"
pnpm falcon:eval:batch --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope db14
pnpm falcon:eval:batch --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope db24
pnpm falcon:eval:batch --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope dev
pnpm falcon:submission --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope test
```

`demo:smoke` 必须由严格 PostgreSQL result-equivalence Oracle 给出 PASS。当前 batch 命令的
`select 1` 是全链路 pipeline probe，只证明 32/17/309 个 case 均完成执行与分类，不冒充模型准确率。
正式模型成绩必须从 Test Center 选择 certified model/Data Agent，由服务端加载密封 expected、保留
Attempt 0/最多一次 Reflection，并持久化 ScoreCard。

TEST submission 输出 SQL CSV、trace id 和 receipt，`local_accuracy` 必须为 `null`。

## 浏览器验收

1. 进入工作空间的“数据源”，确认 `Falcon 28 库固定快照` 正常且默认 schema 为
   `falcon_db_24`；
2. 进入“能力测试”，选择 `Falcon Text2SQL`；
3. 确认公开列表为 495 题，TEST 191 题全部不可本地运行，页面不出现 Gold、expected 或
   LOCAL_HOLDOUT；
4. 运行主 Demo 题，查看 Agent SQL、Attempt、Oracle 分类和 ScoreCard；
5. TEST 页面只允许生成/下载 submission，不展示伪造准确率。

## 诊断

- `FALCON_BUNDLE_DIGEST_MISMATCH`：seed 或 manifest 被修改，停止运行并恢复固定 bundle；
- `FALCON_READY_RECEIPT_SCHEMA_DRIFT`：READY 回执与 28 schema 不一致，失败关闭；
- `FALCON_WORKSPACE_BINDING_NOT_READY`：检查工作空间管理员权限、SecretRef 和 datasource；
- `FALCON_DB24_ONTOLOGY_COVERAGE_INVALID`：候选缺少主体、维度、公式、物理或术语关系，不得发布；
- `QUERY_REJECTED`：SQL 越过只读、单语句或 case schema 边界；
- `ORACLE_MISMATCH`：SQL 可执行但结果不等价，可触发一次不泄漏真值的有界 Reflection。

## 安全重建与回滚

重建是显式运维动作，不属于普通启动。先停用 Falcon datasource/运行入口，读取
`infra/falcon/v1/source-manifest.json` 的精确 `source_digest`，再在 migration 容器中同时设置：

```text
FALCON_REBUILD=YES
FALCON_REBUILD_CONFIRM=<exact source_digest>
```

Importer 只枚举删除 `falcon_db_01` 至 `falcon_db_28`，不会接受 glob、database、volume 或工作区
根目录作为删除目标。回滚后保留控制面中的历史 run、ScoreCard 和 import receipt；不要删除
`data_agent` database 或 `pgdata` volume。
