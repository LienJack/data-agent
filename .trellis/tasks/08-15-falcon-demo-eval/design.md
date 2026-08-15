# Falcon 内置 Schema Demo 与全量评测闭环：技术设计

## 1. 设计摘要

本方案把固定 Falcon 快照转换为随仓库分发的 Data Agent 原生 Demo seed：28 个 SQLite 数据库预先生成按 `db_id` 拆分的 PostgreSQL bundle，在标准 `pnpm dev:migrate` 中一次性、幂等地导入现有 `postgres/data_agent/pgdata`。每个 `db_id` 保留独立 `falcon_db_*` schema；既有控制面 schema 继续承担 Workspace、权限、语义、运行和评分。Test Center 使用公开题面和当前 case schema 调用模型或 Agent，通过受限角色只读执行候选 SQL，再由 server-only expected result 做确定性判分。

```text
Fixed Falcon snapshot (500 cases / 28 SQLite DBs)
  -> offline SQLite-to-PostgreSQL bundle generator
  -> versioned per-db seed bundle committed with the project
  -> standard dev:migrate / migration container

Existing postgres / data_agent / pgdata
  -> falcon_db_01 ... falcon_db_28 (Demo data plane)
  -> migration owner + falcon_demo_reader role
  -> case-scoped read-only search_path
  -> Workspace / membership / AppCapability
  -> datasource + masked SecretRef + db_id/schema mapping
  -> semantic candidate/review/published release
  -> public case registry + sealed Oracle references
  -> run / trace / scorecard / submission receipt

Test Center
  -> public question + allowed schema/semantic context
  -> model or Data Agent
  -> PostgreSQL read-only execution
  -> deterministic Oracle or TEST submission output
  -> customer Demo and optimization reports
```

DB-GPT 提供参考闭环，但不在上述运行路径中。

## 2. 权威与隔离边界

| 资产 | 权威 | 边界 |
|---|---|---|
| Falcon 来源 | 固定 commit + 初次文件摘要 | 不自动更新 |
| Falcon 业务数据 | 现有 `data_agent` 的 `falcon_db_01` 至 `falcon_db_28` | 不进入控制面 schema |
| `db_id` 路由 | 主 PostgreSQL datasource mapping receipt | 客户端/模型不能自报 |
| Workspace/RBAC | 现有 PostgreSQL identity authority | 每次请求服务端重验 |
| 语义资产 | published semantic release | AI 只生成 Candidate |
| DEV 公开输入 | public case registry | 不含 Gold/expected |
| DEV 判分 | sealed expected result + Oracle version | Agent 进程不可读 |
| TEST 结果 | submission artifact + receipt | 本地不伪造 PASS |
| 历史运行 | 既有控制面 run/trace/scorecard | 不随 Demo schema 重建删除 |

## 3. DB-GPT 参考映射

| DB-GPT 能力 | 本项目采用方式 | 明确不采用 |
|---|---|---|
| Falcon DEV/TEST parser | 建立 TypeScript adapter 与 compatibility fixture | 运行时调用 DB-GPT Python |
| Schema + sample + question prompt | 复用信息结构并加入 semantic/authority 约束 | 复制固定英文 Prompt |
| LLM / remote Agent 双路径 | 对应 certified model 与 Data Agent profile | DB-GPT worker/model registry |
| SQL execute + compare | 复用阶段划分 | 共享 SQLite connector |
| executability/accuracy report | 纳入现有 ScoreCard | Excel 作为唯一权威 |
| 自动下载/缓存 | 不采用 | 跟随 `main` 和 1 日缓存 |
| SQLite 合库 | 不采用 | 同名表跳过 |
| `CONTAIN_MATCH` | 仅作参考诊断 | 作为正式 PASS Oracle |

DB-GPT compatibility fixture 至少覆盖 5 个 case：单表筛选、聚合、Join、排序和复杂表达式。fixture 保存 DB-GPT 解析后的题面/schema/标准结果，不依赖启动 DB-GPT 服务。

## 4. 固定快照与一次性导入

### 4.1 输入

- Repository: `https://github.com/eosphoros-ai/Falcon`
- Commit: `8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`
- DEV: 309 cases / 16 databases
- TEST: 191 cases / 12 databases
- SQLite: 28 files / 132,804,608 bytes
- CSV: 95 files / 174,827,471 bytes

bundle 生成入口只接受显式本地目录或固定 zip。生成结果按 `db_id` 拆分、压缩并随仓库分发，不依赖 Git LFS；标准首次迁移只消费 bundle，不访问网络。实现不包含 background sync、update check、latest resolution 或旧版本迁移。

### 4.2 初次验证

导入前验证：

1. LICENSE、LEGAL 和固定 commit metadata。
2. DEV/TEST 题目数量、唯一 `question_id` 和 `db_id` 集合。
3. 28 个 SQLite 路径、大小和摘要。
4. `tables.json` 与 SQLite 实际表/列的对应关系。
5. `data_agent` 中目标 `falcon_db_*` 不存在，或已存在同摘要的完成回执。

同摘要重复执行稳定返回旧 receipt；目标存在但摘要不一致时失败关闭，显式 `rebuild` 流程另行处理。

## 5. 现有 PostgreSQL 内的数据平面

### 5.1 部署拓扑

不新增 PostgreSQL service、database 或 volume，继续使用：

- service: `postgres`
- database: `data_agent`
- volume: `pgdata`
- migration owner: 现有 migration runner，仅在迁移/重建阶段写 `falcon_db_*`
- datasource role: `falcon_demo_reader`，只读、无 schema create、无 temp/extension/COPY 权限
- readiness: 既有 `pg_isready`、migration ledger，再叠加 Falcon import receipt 查询

Compose 只允许为现有 migration 容器增加只读 seed bundle mount，不增加服务。Web/Worker 日常运行不持有额外 importer secret；Falcon Workspace datasource 使用 `falcon_demo_reader` SecretRef 连接同一个 `data_agent` 数据库。

### 5.2 Schema 映射

固定映射：`db_id=1 -> falcon_db_01`，依次至 `db_id=28 -> falcon_db_28`。所有 case 执行前由 server-side registry 解析 schema，并把它写入 Execution Permit 和 datasource fingerprint。

使用 schema 而不是 28 个 PostgreSQL database 的原因：

- 一个 datasource 可浏览全量 catalog；
- PostgreSQL 连接池和 SecretRef 更简单；
- `search_path` 可以在事务内精确限制；
- 同名表仍由 schema 隔离，不会出现 DB-GPT 合库跳过。

### 5.3 SQLite 转换规则

转换器分两层：

- Raw table：保持表/列标识、行和可核验值，使用确定性 quoted identifier mapping。
- Curated view：对日期、金额、布尔、宽松 numeric 和方言差异提供 PostgreSQL 友好视图。

每个库生成 `FalconDatabaseImportReceipt`：source digest、bundle digest、schema、tables、rows、null counts、content digest、type mapping、warnings、PostgreSQL size。全局 receipt 只有在 28 个子 receipt 全部 READY 后才能 READY；重复 `dev:migrate` 遇到同摘要 receipt 时稳定跳过，异摘要则失败关闭。

### 5.4 查询安全

- 单条 `SELECT` 或受控 CTE。
- 显式事务 `READ ONLY`。
- `search_path` 只包含 case schema 与 `pg_catalog`。
- 拒绝 DDL、DML、COPY、事务控制、扩展、函数创建、多语句和跨 schema 引用。
- 强制 statement/lock timeout、row/byte limit、取消和审计。
- `falcon_demo_reader` 不授予 `platform`、`semantic`、`app_data_agent`、`auth`、`storage` 或其他控制面 schema 的 USAGE。

### 5.5 下载即见的 Seed Bundle

- `infra/falcon/` 保存 LICENSE/LEGAL、source manifest、public case manifest、类型映射和按 `db_id` 拆分的压缩 PostgreSQL seed。
- 每个 bundle 文件单独摘要并低于 GitHub 单文件限制；不要求 Git LFS，也不在首次启动时下载 Falcon。
- 现有 migration runner 在核心 schema 迁移完成后恢复缺失的 `falcon_db_*` 并写入 `platform` 中的导入回执；它不伪造用户或 Workspace。
- 本地首次执行既有 `bootstrap:superadmin` 后，由幂等 bootstrap hook 把 `falcon_demo_reader` datasource/catalog 绑定到首个 Workspace；已有部署必须由管理员显式绑定目标 Workspace。
- bundle 生成器属于维护工具，只在本任务生成 v1 或未来另立升级任务时使用；普通用户启动不需要 SQLite、Python 或 DB-GPT。

## 6. 题库与密封数据

### 6.1 Case 类型

- `PublicFalconCase`：case id、db id、问题、允许 schema/样例/知识、registry、difficulty/tags。
- `SealedFalconDevCase`：Gold SQL、一个或多个 expected result、`is_order`、normalization policy。
- `FalconTestCase`：问题和 schema，不含本地 Gold。

DEV manifest 固定为：

- DEMO 10
- TUNING 294
- LOCAL_HOLDOUT 5

TEST 191 独立为 `OFFICIAL_TEST_BLIND`，不进入本地正确率分母。

### 6.2 数据存储

Public manifest 可进入受控 benchmark root；sealed DEV payload 只能由 evaluator server 读取。Falcon 业务 PostgreSQL 内不放 Gold、expected 或 registry 标记，避免 Agent 通过 SQL 发现答案。

## 7. PostgreSQL 派生 Oracle

上游 Gold SQL 可能使用 SQLite/MaxCompute/Hive 语义，不能无条件作为 PostgreSQL SQL 执行。安装阶段执行两类验证：

1. 在固定 SQLite 上重放兼容 Gold，确认上游 answer。
2. 在 PostgreSQL 上运行经过审阅的派生 reference query 或直接比较确定性 expected result。

正式比较规则：

- 列数量和 alias contract 明确；不使用列摘要 set 掩盖重复列。
- `is_order=true` 按顺序比较，否则按行多重集比较并保留重复行。
- null、boolean、integer/decimal、date/timestamp 和 text 各自有显式 canonicalization。
- numeric tolerance 由 case/Oracle version 声明，不统一强制两位小数。
- 标准答案存在多个等价结果时，任一严格匹配可 PASS。

错误分类不折叠：`QUERY_REJECTED`、`QUERY_TIMEOUT`、`EXECUTION_ERROR`、`INFRASTRUCTURE_FAILURE`、`BAD_CASE`、`ORACLE_FAILURE`、`ORACLE_MISMATCH`。

## 8. Agent、反省与运行版本

运行前必须解析：Workspace capability、datasource mapping、case schema、主 Demo 的 active semantic release、certified model/Agent profile、预算和数据摘要。

Attempt 0 永远保留。只有确定性 `ORACLE_MISMATCH` 或可归因的 SQL 执行错误允许一次裁剪后的 Reflection；Reflection 只看到错误类别和有限结果形状，不看到 expected result。基础设施、坏题和 Oracle failure 不触发重试。

每个 run 绑定：

- Falcon snapshot/import receipt
- db id/schema/datasource fingerprint
- public case/registry manifest
- Agent/Prompt/Workflow version
- provider/profile/model certification
- semantic/knowledge release
- Oracle version
- attempt、cost、latency、trace 和 terminal classification

## 9. Demo Workspace 与 UI

### 9.1 数据浏览

Workspace-scoped Data Sources 页面展示 Falcon datasource、28 个 logical database、schema/table/column/row count/size/readiness。默认卡片展示 db24 多表复杂主 Demo，db14 作为快速 smoke 入口。

### 9.2 Test Center

- Suite overview：固定来源、500 题、28 库、导入/模型/语义 readiness。
- Dataset catalog：DEV/TEST、领域、库、表和题数。
- Case browser：DEMO/TUNING/LOCAL_HOLDOUT/TEST 可见性规则。
- Run inspector：Prompt 摘要、Agent SQL、执行结果摘要、错误、Attempt timeline、耗时和成本。
- ScoreCard：主 Demo 全量回归、db14 smoke、DEV 全量、模型/Agent baseline comparison。
- Submission：TEST 结果下载，明确“未在本地判分”。

HOLDOUT 与 TEST 的密封字段由服务端 serializer 移除，不能只靠前端隐藏。

## 10. 主 Demo 语义与复杂题阶梯

主 Demo 固定为 db24，并满足：

- 至少 7 表、40 列，实体关系覆盖一条完整业务链。
- 建立人工审核的实体、关系、维度、指标和中文 Glossary。
- 精选 10 个 DEMO case，按 Easy/Medium/Hard 固定分级。
- Hard 至少 3 题跨 4 表以上，并覆盖 CTE/子查询、窗口函数或复杂占比分析。
- 源数据瑕疵保留在 raw 层，通过 curated view 和 glossary 明确权威口径，不能静默改写 parity 数据。

db14 只保留快速 smoke 与简单路径对照。其他库只使用物理 schema 和 Falcon 提供的字段样例，避免 v1 范围失控。db24 的实体、维度、指标、公式、物理表、物理列、Join、溯源与中文术语均通过显式 Node/Edge 候选固化，并继续走人工审核发布门禁。

## 11. 运行与回滚

- 初次导入失败：事务/库级 staging 回滚，未完成的全局 receipt 不 READY。
- 某库转换失败：保留诊断，但整个 Falcon datasource 标记 NOT_READY。
- 语义失败：只影响主 Demo semantic readiness，不篡改导入数据。
- 显式重建：先停用 datasource/run entry，再只 drop/recreate 明确列举的 `falcon_db_01` 至 `falcon_db_28`；禁止删除 `data_agent` 或 `pgdata`。
- 回滚后保留控制面 schema 中的历史 run、scorecard 和 receipt，标记 datasource retired。

## 12. 测试策略

- Contract：public/sealed/test case、import receipt、db mapping、run version、submission receipt。
- Seed/Converter：28 SQLite -> 28 bundle -> 28 schemas、类型映射、同名表、null/row/content parity、离线首次安装、幂等与重建冲突。
- Authority：跨 Workspace、错误 db/schema、stale capability、SecretRef 泄漏。
- DB-GPT compatibility：至少 5 个 parser/result fixture。
- Oracle：列、行多重集、重复值、order、null、numeric/date/text、多标准答案。
- Runtime：真实 PostgreSQL + deterministic model，真实 certified model/Agent smoke。
- Recovery：Worker lease、取消、超时、重试、断点恢复。
- Web：数据目录、复杂主 Demo、db14 smoke、case/run/score、HOLDOUT/TEST 密封、submission 下载。

## 13. 不变式

1. Falcon 业务数据只进入现有 `data_agent` 的 `falcon_db_*`，永不进入控制面 schema。
2. 28 个 db_id 永不在同一个 schema 中合并。
3. 没有完整 28 库导入回执，Falcon suite 不为 READY。
4. Gold/expected/LOCAL_HOLDOUT 永不进入 Agent 输入、业务数据库或公共 API。
5. TEST 没有本地 Gold，不产生本地正式 PASS。
6. 只有确定性 Oracle 能给本地 PASS；LLM Judge 和 DB-GPT `CONTAIN_MATCH` 不能覆盖。
7. DB-GPT 仅为只读参考，不成为生产依赖。
8. 本任务不实现 Falcon 数据更新。
9. 干净 clone 的标准首次迁移无需联网或额外 benchmark installer 即可装入 Falcon；既有 Workspace bootstrap 后 UI 可见。
10. 不新增 PostgreSQL service、database 或 volume。
